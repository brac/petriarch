// GPU-vs-CPU verification — the bring-up vehicle for the migration. The CPU Tier A
// path is the golden reference (docs/webgpu-migration §sequencing); each ported pass
// is checked against it on identical input before we trust it. WebGPU can't run in
// the headless/WSL toolchain, so this runs headful (a dev-panel button) on the live
// world.
//
// For the spatial hash the meaningful invariant is per-agent cell agreement: every
// agent must land in the SAME grid cell the CPU assigns it (cellSize 64 is a power of
// two, so x/64 is exact in both f32 and f64 — there is no legitimate rounding
// divergence). cellStart is reported too, but a single misplaced agent shifts every
// downstream prefix sum, so per-agent cell mismatch is the precise signal. The order
// of indices *within* a cell is GPU-defined (atomic scatter) and not checked.

import type { World } from "../state/world";
import type { GpuContext } from "./gpuContext";

export interface HashVerifyResult {
  ok: boolean;
  count: number;
  /** Total agents the GPU placed (gpuStart[numCells]); should equal count. */
  gpuTotal: number;
  numCells: number;
  /** Agents whose GPU cell differs from the CPU cell (should be 0). */
  cellMismatches: number;
  /** Of those, how many are NOT in an adjacent cell (a structural bug, not boundary). */
  nonAdjacentMismatches: number;
  /** Cells whose prefix-sum offset differed from the CPU. */
  cellStartMismatches: number;
  /** First few human-readable mismatch notes for debugging. */
  notes: string[];
}

export async function verifyHash(world: World, gpu: GpuContext): Promise<HashVerifyResult> {
  const a = world.agents;
  const count = a.count;
  const posX = a.posX;
  const posY = a.posY;

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

  // CPU golden reference for the current positions.
  world.hash.build(posX, posY, count);
  const cpuStart = world.hash.cellStart;

  // GPU build from the same positions.
  gpu.buildHash(posX, posY, count);
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
    const cpuC = cellOf(posX[i]!, posY[i]!);
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
        `agent ${i} pos=(${posX[i]!.toFixed(2)},${posY[i]!.toFixed(2)}) cpuCell=${cpuC} gpuCell=${gpuC} cheb=${cheb}`,
      );
    }
  }

  let cellStartMismatches = 0;
  for (let c = 0; c <= numCells; c++) if (cpuStart[c]! !== gpuStart[c]!) cellStartMismatches++;

  return {
    ok: cellMismatches === 0,
    count,
    gpuTotal: gpuStart[numCells]!,
    numCells,
    cellMismatches,
    nonAdjacentMismatches,
    cellStartMismatches,
    notes,
  };
}
