// GPU-vs-CPU verification — the bring-up vehicle for the migration. The CPU Tier A
// path is the golden reference (docs/webgpu-migration §sequencing); each ported pass
// is checked against it on identical input before we trust it. WebGPU can't run in
// the headless/WSL toolchain, so this runs headful (a dev-panel button) on the live
// world.
//
// For the spatial hash: cellStart must match the CPU EXACTLY (counting is
// order-independent, prefix sum is deterministic). The order of indices *within* a
// cell is GPU-defined (atomic scatter), so per-cell contents are compared as a
// multiset — that divergence is permitted by the buffer contract.

import type { World } from "../state/world";
import type { GpuContext } from "./gpuContext";

export interface HashVerifyResult {
  ok: boolean;
  count: number;
  numCells: number;
  /** Cells whose prefix-sum offset differed from the CPU (should be 0). */
  cellStartMismatches: number;
  /** Cells whose index multiset differed from the CPU (should be 0). */
  cellSetMismatches: number;
  /** First few human-readable mismatch notes for debugging. */
  notes: string[];
}

export async function verifyHash(world: World, gpu: GpuContext): Promise<HashVerifyResult> {
  const a = world.agents;
  const count = a.count;

  // CPU golden reference for the current positions.
  world.hash.build(a.posX, a.posY, count);
  const cpuStart = world.hash.cellStart;
  const cpuItems = world.hash.items;
  const numCells = world.hash.numCells;

  // GPU build from the same positions.
  gpu.buildHash(a.posX, a.posY, count);
  const { cellStart: gpuStart, items: gpuItems } = await gpu.readGrid();

  let cellStartMismatches = 0;
  let cellSetMismatches = 0;
  const notes: string[] = [];

  for (let c = 0; c <= numCells; c++) {
    if (cpuStart[c]! !== gpuStart[c]!) {
      cellStartMismatches++;
      if (notes.length < 8) notes.push(`cellStart[${c}] cpu=${cpuStart[c]} gpu=${gpuStart[c]}`);
    }
  }

  // Compare each cell's index set (sorted), only where the offsets agree.
  for (let c = 0; c < numCells; c++) {
    const s = cpuStart[c]!;
    const e = cpuStart[c + 1]!;
    if (gpuStart[c]! !== s || gpuStart[c + 1]! !== e) continue; // counted above
    const cpuCell: number[] = [];
    const gpuCell: number[] = [];
    for (let p = s; p < e; p++) {
      cpuCell.push(cpuItems[p]!);
      gpuCell.push(gpuItems[p]!);
    }
    cpuCell.sort((x, y) => x - y);
    gpuCell.sort((x, y) => x - y);
    let same = true;
    for (let k = 0; k < cpuCell.length; k++) {
      if (cpuCell[k] !== gpuCell[k]) {
        same = false;
        break;
      }
    }
    if (!same) {
      cellSetMismatches++;
      if (notes.length < 8) notes.push(`cell ${c}: cpu={${cpuCell}} gpu={${gpuCell}}`);
    }
  }

  return {
    ok: cellStartMismatches === 0 && cellSetMismatches === 0,
    count,
    numCells,
    cellStartMismatches,
    cellSetMismatches,
    notes,
  };
}
