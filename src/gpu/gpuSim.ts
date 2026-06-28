// The GPU-backed sim tick: the Tier A chain runs GPU-resident, Tier B stays on CPU.
// Mirrors sim/step.ts (the CPU canonical tick) but offloads hash/sense/steer/integrate/
// metabolism to the compute pipeline. Because update() in the fixed-timestep loop is
// synchronous and GPU readback is async, this is driven by a separate async pump (see
// main.ts), NOT the fixed-timestep accumulator.
//
// Two deliberate simplifications (correctness-first; optimize later):
//  - FULL state re-upload + readback every tick. Tier B (conflict/reproduce/death)
//    mutates the agent pool on the CPU each tick, so the GPU is re-synced wholesale
//    rather than tracking deltas.
//  - ALWAYS think. The CPU think-gate (THINK_INTERVAL) is a CPU perf optimization; the
//    GPU runs sense/steer cheaply every tick, and always-think keeps the resident
//    steer cache aligned across CPU swap-remove (death) without mirroring the swaps to
//    GPU buffers. Intensity still controls population + neighbor budget.
//
// The GPU is its own determinism domain (wander RNG, intake order) — it will NOT track
// a CPU run tick-for-tick, by design (docs/webgpu-migration).

import type { World } from "../state/world";
import type { GpuContext } from "./gpuContext";
import { TICK_DT } from "../core/time";
import { SIM } from "../data/sim";
import { resources } from "../sim/tierB/resources";
import { stigmergy } from "../sim/tierB/stigmergy";
import { conflict } from "../sim/tierB/conflict";
import { reproduce } from "../sim/tierB/reproduce";
import { death } from "../sim/tierB/death";

/** Last-tick timing split (ms), for the perf overlay: GPU round-trip vs CPU Tier B,
 *  with Tier B broken down per phase so the hot one is visible. */
export const gpuTiming = {
  gpuMs: 0,
  tierBMs: 0,
  hashMs: 0,
  conflictMs: 0,
  reproduceMs: 0,
  deathMs: 0,
};

export async function simStepGpu(world: World, gpu: GpuContext): Promise<void> {
  const a = world.agents;
  world.tick++;
  world.time += TICK_DT;

  const t0 = performance.now();
  resources(world); // 1 — Tier B: regrow the field, age out the hazard
  stigmergy(world); // 1b — claim/territory field (CPU; claim never goes to the GPU)
  const tAfterRes = performance.now();

  const count = a.count;
  if (count > 0) {
    gpu.uploadState(a.posX, a.posY, a.velX, a.velY, a.energy, a.age, a.genes, count);
    gpu.uploadResources(world.resources);
    gpu.uploadDanger(world.danger);
    gpu.uploadPassability(world.passability);

    const senseP = {
      budget: world.intensity.neighborBudget,
      senseR2: SIM.senseRadius * SIM.senseRadius,
      sepR2: SIM.separationRadius * SIM.separationRadius,
      sigT: SIM.sigThreshold,
    };
    const hz = world.hazard;
    const hazP = { active: hz.life > 0, x: hz.x, y: hz.y, r2: hz.r * hz.r };

    gpu.runTierA(count, true, world.tick, senseP, hazP); // 2-5 — Tier A resident chain

    // One combined, zero-alloc readback straight into the world pools (one sync point).
    await gpu.downloadAll(a.posX, a.posY, a.velX, a.velY, a.energy, a.age, world.resources, count);
  }
  const tAfterGpu = performance.now();

  // Tier B on the read-back state. conflict does its OWN hash query (no GPU neighbor
  // cache), so the hash must be current.
  world.hash.build(a.posX, a.posY, count); // 6
  const tHash = performance.now();
  conflict(world, false); // 7
  const tConflict = performance.now();
  reproduce(world); // 8
  const tReproduce = performance.now();
  death(world); // 9
  const tDeath = performance.now();

  gpuTiming.gpuMs = tAfterGpu - tAfterRes; // upload + Tier A + readback (the sync)
  gpuTiming.hashMs = tHash - tAfterGpu;
  gpuTiming.conflictMs = tConflict - tHash;
  gpuTiming.reproduceMs = tReproduce - tConflict;
  gpuTiming.deathMs = tDeath - tReproduce;
  gpuTiming.tierBMs = tAfterRes - t0 + (tDeath - tAfterGpu); // resources + all of Tier B
}

// One-frame-latency pipeline: submit a tick's GPU Tier A, then apply the PREVIOUS
// tick's result (its readback has had a frame to finish on the GPU, so the await
// doesn't stall) and run that tick's Tier B. Fully hides the GPU sync at ~1 tick/frame;
// at higher sim-speed the ticks are sequentially dependent through CPU Tier B, so only
// the last tick's readback per frame overlaps render. The rendered world lags the
// latest GPU submit by one tick (imperceptible).
export class GpuPipeline {
  private inflightCount: number | null = null;
  private pendingMap: Promise<undefined> | null = null;

  constructor(private gpu: GpuContext) {}

  /** Apply the in-flight tick's readback to the pools and run its Tier B. */
  private finalize(world: World): void {
    const a = world.agents;
    this.gpu.finishReadback(a.posX, a.posY, a.velX, a.velY, a.energy, a.age, world.resources, this.inflightCount!);
    const tHash0 = performance.now();
    world.hash.build(a.posX, a.posY, a.count);
    const tHash = performance.now();
    conflict(world, false);
    const tConflict = performance.now();
    reproduce(world);
    const tReproduce = performance.now();
    death(world);
    gpuTiming.hashMs = tHash - tHash0;
    gpuTiming.conflictMs = tConflict - tHash;
    gpuTiming.reproduceMs = tReproduce - tConflict;
    gpuTiming.deathMs = performance.now() - tReproduce;
    gpuTiming.tierBMs = performance.now() - tHash0;
    this.inflightCount = null;
    this.pendingMap = null;
  }

  /** Advance one tick (pipelined). Call once per frame for a fully-hidden sync. */
  async tick(world: World): Promise<void> {
    const a = world.agents;

    let stall = 0;
    if (this.pendingMap) {
      const s0 = performance.now();
      await this.pendingMap; // resolved already if a frame elapsed → no stall
      stall = performance.now() - s0;
      this.finalize(world);
    }

    // Start the next tick on the freshly-finalized pools.
    const u0 = performance.now();
    world.tick++;
    world.time += TICK_DT;
    resources(world);
    stigmergy(world); // claim/territory field (CPU; claim never goes to the GPU)
    const count = a.count;
    if (count > 0) {
      this.gpu.uploadState(a.posX, a.posY, a.velX, a.velY, a.energy, a.age, a.genes, count);
      this.gpu.uploadResources(world.resources);
      this.gpu.uploadDanger(world.danger);
      this.gpu.uploadPassability(world.passability);
      const senseP = {
        budget: world.intensity.neighborBudget,
        senseR2: SIM.senseRadius * SIM.senseRadius,
        sepR2: SIM.separationRadius * SIM.separationRadius,
        sigT: SIM.sigThreshold,
      };
      const hz = world.hazard;
      const hazP = { active: hz.life > 0, x: hz.x, y: hz.y, r2: hz.r * hz.r };
      this.gpu.runTierA(count, true, world.tick, senseP, hazP);
      this.pendingMap = this.gpu.submitReadback(count);
      this.inflightCount = count;
    }
    gpuTiming.gpuMs = stall + (performance.now() - u0); // sync stall + submit/upload
  }

  /** Drain any in-flight tick (call when leaving GPU mode so the buffer isn't left mapped). */
  async flush(world: World): Promise<void> {
    if (this.pendingMap) {
      await this.pendingMap;
      this.finalize(world);
    }
  }
}
