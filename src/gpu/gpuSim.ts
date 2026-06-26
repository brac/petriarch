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
import { conflict } from "../sim/tierB/conflict";
import { reproduce } from "../sim/tierB/reproduce";
import { death } from "../sim/tierB/death";

/** Last-tick timing split (ms), for the perf overlay: GPU round-trip vs CPU Tier B. */
export const gpuTiming = { gpuMs: 0, tierBMs: 0 };

export async function simStepGpu(world: World, gpu: GpuContext): Promise<void> {
  const a = world.agents;
  world.tick++;
  world.time += TICK_DT;

  const t0 = performance.now();
  resources(world); // 1 — Tier B: regrow the field, age out the hazard
  const tAfterRes = performance.now();

  const count = a.count;
  if (count > 0) {
    gpu.uploadState(a.posX, a.posY, a.velX, a.velY, a.energy, a.age, a.genes, count);
    gpu.uploadResources(world.resources);

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
  conflict(world, false); // 7
  reproduce(world); // 8
  death(world); // 9

  gpuTiming.gpuMs = tAfterGpu - tAfterRes; // upload + Tier A + readback (the sync)
  gpuTiming.tierBMs = tAfterRes - t0 + (performance.now() - tAfterGpu); // CPU Tier B
}
