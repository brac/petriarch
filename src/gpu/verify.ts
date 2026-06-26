// GPU-vs-CPU verification — the bring-up vehicle for the migration. The CPU Tier A
// path is the golden reference (docs/webgpu-migration §sequencing); each ported pass
// is checked against it on identical input before we trust it. WebGPU can't run in
// the headless/WSL toolchain, so this runs headful (a dev-panel button) on the live
// world.
//
// CRITICAL: the sim loop keeps ticking (rAF) while this async fn awaits the GPU
// readback — moving agents and rebuilding world.hash in place. So we FREEZE a
// position snapshot up front and compare both the CPU cells and the GPU grid against
// that frozen copy. Reading live world.posX after the await would compare a moved
// CPU against the snapshotted GPU (a false mismatch — the bug this comment prevents).
//
// For the spatial hash the correctness condition is per-agent cell agreement: with
// cellSize a power of two, x/cellSize is exact in both f32 and f64, so every agent
// must land in the SAME cell. Order of indices within a cell is GPU-defined (atomic
// scatter) and not checked.

import type { World } from "../state/world";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { sense } from "../sim/tierA/sense";
import { steer } from "../sim/tierA/steer";
import { integrate } from "../sim/tierA/integrate";
import { type GpuContext, SENSE_STRIDE, STEER_STRIDE, INTEGRATE_STRIDE } from "./gpuContext";

export interface HashVerifyResult {
  ok: boolean;
  count: number;
  /** Total agents the GPU placed (gpuStart[numCells]); should equal count. */
  gpuTotal: number;
  numCells: number;
  /** Agents whose GPU cell differs from the CPU cell on the frozen snapshot. */
  cellMismatches: number;
  /** Of those, how many are NOT in an adjacent cell (a structural bug, not boundary). */
  nonAdjacentMismatches: number;
  /** First few human-readable mismatch notes for debugging. */
  notes: string[];
}

export async function verifyHash(world: World, gpu: GpuContext): Promise<HashVerifyResult> {
  const a = world.agents;
  const count = a.count;

  // Freeze positions BEFORE any await — the source of truth for this whole check.
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);

  const cellSize = world.hash.cellSize;
  const gridW = world.hash.gridW;
  const gridH = world.hash.gridH;
  const numCells = world.hash.numCells;

  const cellOf = (x: number, y: number): number => {
    let cx = Math.floor(x / cellSize);
    cx = cx < 0 ? 0 : cx >= gridW ? gridW - 1 : cx;
    let cy = Math.floor(y / cellSize);
    cy = cy < 0 ? 0 : cy >= gridH ? gridH - 1 : cy;
    return cy * gridW + cx;
  };

  // CPU cell for each agent, from the frozen snapshot.
  const cpuCellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) cpuCellOf[i] = cellOf(snapX[i]!, snapY[i]!);

  // GPU build from the SAME frozen snapshot.
  gpu.buildHash(snapX, snapY, count);
  const { cellStart: gpuStart, items: gpuItems } = await gpu.readGrid();

  // Derive each agent's GPU cell from the returned grid (items grouped by cell).
  const gpuCellOf = new Int32Array(count).fill(-1);
  for (let c = 0; c < numCells; c++) {
    const e = gpuStart[c + 1]!;
    for (let p = gpuStart[c]!; p < e; p++) {
      const i = gpuItems[p]!;
      if (i >= 0 && i < count) gpuCellOf[i] = c;
    }
  }

  let cellMismatches = 0;
  let nonAdjacentMismatches = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    const cpuC = cpuCellOf[i]!;
    const gpuC = gpuCellOf[i]!;
    if (cpuC === gpuC) continue;
    cellMismatches++;
    const cheb =
      gpuC < 0
        ? 999
        : Math.max(Math.abs((cpuC % gridW) - (gpuC % gridW)), Math.abs(((cpuC / gridW) | 0) - ((gpuC / gridW) | 0)));
    if (cheb > 1) nonAdjacentMismatches++;
    if (notes.length < 8) {
      notes.push(
        `agent ${i} pos=(${snapX[i]!.toFixed(2)},${snapY[i]!.toFixed(2)}) cpuCell=${cpuC} gpuCell=${gpuC} cheb=${cheb}`,
      );
    }
  }

  return {
    ok: cellMismatches === 0,
    count,
    gpuTotal: gpuStart[numCells]!,
    numCells,
    cellMismatches,
    nonAdjacentMismatches,
    notes,
  };
}

export interface SenseVerifyResult {
  ok: boolean;
  count: number;
  /** Agents compared (neighborCount < budget, where CPU/GPU sample the same set). */
  compared: number;
  /** Agents excluded because they hit the neighbor budget (order-dependent, allowed). */
  capped: number;
  /** Compared agents whose kin centroid count differed (should be 0 — integer sums). */
  countMismatches: number;
  /** Compared agents whose float aggregates exceeded tolerance. */
  aggMismatches: number;
  /** Largest relative aggregate divergence seen on a compared agent. */
  worstRel: number;
  notes: string[];
}

// The CPU pass is run synchronously to capture its outputs BEFORE any await, so the
// running sim loop can't move agents out from under the comparison (see verifyHash).
export async function verifySense(world: World, gpu: GpuContext): Promise<SenseVerifyResult> {
  const a = world.agents;
  const count = a.count;

  // Freeze inputs (sense does not mutate positions/genes, but snapshot up front).
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);

  const budget = world.intensity.neighborBudget;
  const senseR2 = SIM.senseRadius * SIM.senseRadius;
  const sepR2 = SIM.separationRadius * SIM.separationRadius;
  const sigT = SIM.sigThreshold;

  // CPU reference: build the hash for current positions and run the real sense pass,
  // then capture its outputs (the loop will overwrite these scratch arrays later).
  world.hash.build(a.posX, a.posY, count);
  sense(world);
  const cKinX = a.senseKinX.slice(0, count);
  const cKinY = a.senseKinY.slice(0, count);
  const cKinN = a.senseKinCount.slice(0, count);
  const cSepX = a.senseSepX.slice(0, count);
  const cSepY = a.senseSepY.slice(0, count);
  const cAvX = a.senseAvoidX.slice(0, count);
  const cAvY = a.senseAvoidY.slice(0, count);
  const cNbr = a.neighborCount.slice(0, count);

  // GPU: build grid + sense on the frozen snapshot.
  gpu.buildHash(snapX, snapY, count);
  gpu.senseBuild(snapGenes, count, { budget, senseR2, sepR2, sigT });
  const out = await gpu.readSense();

  let compared = 0;
  let capped = 0;
  let countMismatches = 0;
  let aggMismatches = 0;
  let worstRel = 0;
  const notes: string[] = [];

  const tol = (cpu: number, g: number): number => Math.abs(cpu - g) / (1e-3 + Math.abs(cpu));

  for (let i = 0; i < count; i++) {
    if (cNbr[i]! >= budget) {
      capped++; // hit the cap → which neighbors were sampled is order-dependent
      continue;
    }
    compared++;
    const o = i * SENSE_STRIDE;
    const gKinN = out[o + 2]!;
    if (Math.abs(gKinN - cKinN[i]!) > 0.5) {
      countMismatches++;
      if (notes.length < 8) notes.push(`agent ${i} kinCount cpu=${cKinN[i]} gpu=${gKinN}`);
      continue;
    }
    const fields: [number, number, string][] = [
      [cKinX[i]!, out[o + 0]!, "kinX"],
      [cKinY[i]!, out[o + 1]!, "kinY"],
      [cSepX[i]!, out[o + 3]!, "sepX"],
      [cSepY[i]!, out[o + 4]!, "sepY"],
      [cAvX[i]!, out[o + 5]!, "avoidX"],
      [cAvY[i]!, out[o + 6]!, "avoidY"],
    ];
    let bad = false;
    for (const [cpu, g, name] of fields) {
      const r = tol(cpu, g);
      if (r > worstRel) worstRel = r;
      if (r > 1e-3) {
        bad = true;
        if (notes.length < 8) notes.push(`agent ${i} ${name} cpu=${cpu.toFixed(4)} gpu=${g.toFixed(4)} rel=${r.toExponential(2)}`);
      }
    }
    if (bad) aggMismatches++;
  }

  return {
    ok: countMismatches === 0 && aggMismatches === 0,
    count,
    compared,
    capped,
    countMismatches,
    aggMismatches,
    worstRel,
    notes,
  };
}

export interface SteerVerifyResult {
  ok: boolean;
  count: number;
  /** Agents compared (uncapped — their sense aggregates match, so steer can). */
  compared: number;
  capped: number;
  /** Compared agents whose steer vector exceeded tolerance (should be 0). */
  mismatches: number;
  /** Largest abs component divergence on a compared agent's unit steer vector. */
  worstAbs: number;
  notes: string[];
}

// Verifies the DETERMINISTIC part of steer: wander is the GPU's own RNG domain and
// can't match bit-for-bit, so it is neutralized (WANDER gene zeroed) on both sides.
// The CPU reference runs the real sense+steer with wander zeroed, then live genes and
// the RNG stream position are restored so the running sim is unperturbed.
export async function verifySteer(world: World, gpu: GpuContext): Promise<SteerVerifyResult> {
  const a = world.agents;
  const count = a.count;
  const W = GENE.WANDER;

  // Freeze inputs.
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapRes = world.resources.slice();
  for (let i = 0; i < count; i++) snapGenes[i * GENE_COUNT + W] = 0; // neutralize wander for GPU

  const budget = world.intensity.neighborBudget;
  const senseR2 = SIM.senseRadius * SIM.senseRadius;
  const sepR2 = SIM.separationRadius * SIM.separationRadius;
  const sigT = SIM.sigThreshold;

  // CPU reference: zero wander in live genes, run sense+steer, capture, then restore
  // both the wander column and the RNG stream position (steer advances rng per agent).
  const rngState = world.rng.getState();
  const savedWander = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    savedWander[i] = a.genes[i * GENE_COUNT + W]!;
    a.genes[i * GENE_COUNT + W] = 0;
  }
  world.hash.build(a.posX, a.posY, count);
  sense(world);
  const cNbr = a.neighborCount.slice(0, count);
  steer(world);
  const cSteerX = a.steerX.slice(0, count);
  const cSteerY = a.steerY.slice(0, count);
  for (let i = 0; i < count; i++) a.genes[i * GENE_COUNT + W] = savedWander[i]!;
  world.rng.setState(rngState);

  // GPU: grid → sense → steer on the frozen snapshot (wander zeroed in snapGenes).
  gpu.buildHash(snapX, snapY, count);
  gpu.senseBuild(snapGenes, count, { budget, senseR2, sepR2, sigT });
  gpu.steerBuild(snapRes, count, world.tick);
  const gs = await gpu.readSteer();

  let compared = 0;
  let capped = 0;
  let mismatches = 0;
  let worstAbs = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    if (cNbr[i]! >= budget) {
      capped++;
      continue;
    }
    compared++;
    const gx = gs[i * STEER_STRIDE + 0]!;
    const gy = gs[i * STEER_STRIDE + 1]!;
    const d = Math.max(Math.abs(gx - cSteerX[i]!), Math.abs(gy - cSteerY[i]!));
    if (d > worstAbs) worstAbs = d;
    if (d > 2e-3) {
      mismatches++;
      if (notes.length < 8) {
        notes.push(
          `agent ${i} cpu=(${cSteerX[i]!.toFixed(4)},${cSteerY[i]!.toFixed(4)}) gpu=(${gx.toFixed(4)},${gy.toFixed(4)}) d=${d.toExponential(2)}`,
        );
      }
    }
  }

  return { ok: mismatches === 0, count, compared, capped, mismatches, worstAbs, notes };
}

export interface IntegrateVerifyResult {
  ok: boolean;
  count: number;
  /** Agents whose new pos/vel exceeded tolerance (should be 0 — pure per-agent). */
  mismatches: number;
  /** Largest abs divergence across posX/posY/velX/velY. */
  worstAbs: number;
  notes: string[];
}

// integrate is pure per-agent (no neighbors, no RNG) → all agents must match. The CPU
// pass mutates pos/vel in place, so we run it on the live world, capture the result,
// then restore the pre-integrate state. The GPU is fed the SAME steer vector (the
// current cached steer) so the check isolates integrate from the steer pass.
export async function verifyIntegrate(world: World, gpu: GpuContext): Promise<IntegrateVerifyResult> {
  const a = world.agents;
  const count = a.count;

  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapVX = a.velX.slice(0, count);
  const snapVY = a.velY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapSteer = new Float32Array(count * STEER_STRIDE);
  for (let i = 0; i < count; i++) {
    snapSteer[i * STEER_STRIDE + 0] = a.steerX[i]!;
    snapSteer[i * STEER_STRIDE + 1] = a.steerY[i]!;
  }

  // CPU reference: integrate mutates pos/vel in place; capture then restore.
  integrate(world);
  const cX = a.posX.slice(0, count);
  const cY = a.posY.slice(0, count);
  const cVX = a.velX.slice(0, count);
  const cVY = a.velY.slice(0, count);
  a.posX.set(snapX);
  a.posY.set(snapY);
  a.velX.set(snapVX);
  a.velY.set(snapVY);

  // GPU: same inputs (positions, velocities, the same steer vector, genes).
  gpu.integrateBuild(snapX, snapY, snapVX, snapVY, snapSteer, snapGenes, count);
  const out = await gpu.readIntegrate();

  let mismatches = 0;
  let worstAbs = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * INTEGRATE_STRIDE;
    const dpx = Math.abs(out[o + 0]! - cX[i]!);
    const dpy = Math.abs(out[o + 1]! - cY[i]!);
    const dvx = Math.abs(out[o + 2]! - cVX[i]!);
    const dvy = Math.abs(out[o + 3]! - cVY[i]!);
    const d = Math.max(dpx, dpy, dvx, dvy);
    if (d > worstAbs) worstAbs = d;
    if (d > 1e-2) {
      mismatches++;
      if (notes.length < 8) {
        notes.push(
          `agent ${i} dPos=(${dpx.toExponential(2)},${dpy.toExponential(2)}) dVel=(${dvx.toExponential(2)},${dvy.toExponential(2)})`,
        );
      }
    }
  }

  return { ok: mismatches === 0, count, mismatches, worstAbs, notes };
}
