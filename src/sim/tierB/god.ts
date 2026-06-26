// Tier B — CPU, symbolic/stateful. Player perturbation tools — the god changes the
// WORLD, never an individual (CLAUDE.md rule: no direct agent control). These run
// on player input (one-shot), not in the per-tick hot path.

import type { World } from "../../state/world";
import { RESOURCES } from "../../data/resources";
import {
  RES_CELL_W,
  RES_CELL_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
} from "../../data/capacity";

// Reused scratch for smite victim collection (one-shot, but avoid per-click churn).
const victims: number[] = [];
const neighborScratch: number[] = [];

/** Resource bloom: raise cells within radius to a rich capacity they regrow toward. */
export function bloom(world: World, x: number, y: number, r: number): void {
  const { resources, resourceCap } = world;
  const r2 = r * r;
  const cap = RESOURCES.bloomCapacity;
  let cx0 = ((x - r) / RES_CELL_W) | 0;
  let cx1 = ((x + r) / RES_CELL_W) | 0;
  let cy0 = ((y - r) / RES_CELL_H) | 0;
  let cy1 = ((y + r) / RES_CELL_H) | 0;
  if (cx0 < 0) cx0 = 0;
  if (cy0 < 0) cy0 = 0;
  if (cx1 >= RESOURCE_GRID_W) cx1 = RESOURCE_GRID_W - 1;
  if (cy1 >= RESOURCE_GRID_H) cy1 = RESOURCE_GRID_H - 1;
  for (let cy = cy0; cy <= cy1; cy++) {
    const py = (cy + 0.5) * RES_CELL_H;
    for (let cx = cx0; cx <= cx1; cx++) {
      const px = (cx + 0.5) * RES_CELL_W;
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy > r2) continue;
      const c = cy * RESOURCE_GRID_W + cx;
      if (resourceCap[c]! < cap) resourceCap[c] = cap;
      resources[c] = cap;
    }
  }
}

/** Hazard zone: an energy-draining region that fades over hazardTicks. */
export function hazard(world: World, x: number, y: number, r: number): void {
  const hz = world.hazard;
  hz.x = x;
  hz.y = y;
  hz.r = r;
  hz.life = RESOURCES.hazardTicks;
}

/** Smite: remove agents within radius (collect then swap-remove descending). */
export function smite(world: World, x: number, y: number, r: number): void {
  const a = world.agents;
  const { posX, posY } = a;
  const r2 = r * r;

  victims.length = 0;
  // The hash (rebuilt each tick) covers a 3×3 block ≈ 192px wide — enough for the
  // smite radius. Filter that candidate set by true distance.
  world.hash.queryNeighbors(x, y, neighborScratch);
  const m = neighborScratch.length;
  for (let k = 0; k < m; k++) {
    const i = neighborScratch[k]!;
    const dx = posX[i]! - x;
    const dy = posY[i]! - y;
    if (dx * dx + dy * dy <= r2) victims.push(i);
  }
  // Kill highest index first so swap-remove never invalidates a pending victim.
  victims.sort((p, q) => q - p);
  for (let v = 0; v < victims.length; v++) a.kill(victims[v]!);
}
