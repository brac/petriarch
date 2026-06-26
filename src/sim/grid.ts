// Resource-grid index helpers shared by the systems that read/write the field
// (steer, metabolism, conflict, god). Pure arithmetic, no allocation.

import {
  RES_CELL_W,
  RES_CELL_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
} from "../data/capacity";

/** Clamp a world (x, y) to its flat resource-cell index. */
export function resCellIndex(x: number, y: number): number {
  let cx = (x / RES_CELL_W) | 0;
  if (cx < 0) cx = 0;
  else if (cx >= RESOURCE_GRID_W) cx = RESOURCE_GRID_W - 1;
  let cy = (y / RES_CELL_H) | 0;
  if (cy < 0) cy = 0;
  else if (cy >= RESOURCE_GRID_H) cy = RESOURCE_GRID_H - 1;
  return cy * RESOURCE_GRID_W + cx;
}
