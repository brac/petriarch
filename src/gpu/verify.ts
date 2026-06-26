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
import { GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { sense } from "../sim/tierA/sense";
import { type GpuContext, SENSE_STRIDE } from "./gpuContext";

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
