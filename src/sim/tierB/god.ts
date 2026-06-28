// Tier B — CPU, symbolic/stateful. Player perturbation tools — the god changes the
// WORLD, never an individual (CLAUDE.md rule: no direct agent control). These run
// on player input (one-shot), not in the per-tick hot path.
//
// Input does NOT call the mutators directly — it enqueues a command (enqueueGod) that
// the sim applies on drainGod() at a fixed point each tick. That ordering is what makes
// the tools correct in GPU mode: bloom/smite write resources/energy buffers the GPU
// reads back and overwrites, so a direct mid-frame mutation races the readback and is
// lost intermittently. Draining right before the per-tick upload closes the race; the
// passability paint never raced (the GPU only reads it) but routes through here too for
// one uniform input path.

import type { World } from "../../state/world";
import { RESOURCES } from "../../data/resources";
import { PASSABILITY } from "../../data/passability";
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

/** Food-brush eraser: zero the resource field within radius. Leaves resourceCap intact
 *  so ordinary regrow refills the patch over time (an erase, not a permanent scar). */
export function drainFood(world: World, x: number, y: number, r: number): void {
  const { resources } = world;
  const r2 = r * r;
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
      resources[cy * RESOURCE_GRID_W + cx] = 0;
    }
  }
}

/**
 * Admin paint: write a static movement cost into the passability field within radius
 * (the first writer into that field — docs/PETRIARCH_FEATURE_passability). Paint
 * `oceanCost` to carve an impassable basin border; paint `defaultCost` to erase. Static,
 * never decays. Same cell-loop shape as bloom.
 */
export function paintPassability(world: World, x: number, y: number, r: number, cost: number): void {
  const pass = world.passability;
  const r2 = r * r;
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
      pass[cy * RESOURCE_GRID_W + cx] = cost;
    }
  }
}

/** Reset the whole passability field to normal ground (wipe all painted barriers). */
export function clearBarriers(world: World): void {
  world.passability.fill(PASSABILITY.defaultCost);
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

// --- god command queue ---------------------------------------------------------------
// Player input enqueues these; drainGod() applies them once per tick at a fixed point.

/** Command codes for the god queue (world.god.type). */
export const GOD = {
  Bloom: 0, // resource bloom / food brush — arg unused
  Smite: 1, // remove agents in radius — arg unused
  Hazard: 2, // energy-draining zone — arg unused
  PaintPass: 3, // write passability cost — arg = cost
  FoodErase: 4, // food-brush eraser — arg unused
} as const;

/** Buffer a god command. Dropped (no-op) if the frame's queue is already full. */
export function enqueueGod(
  world: World,
  type: number,
  x: number,
  y: number,
  r: number,
  arg = 0,
): void {
  const q = world.god;
  if (q.count >= q.type.length) return;
  const i = q.count++;
  q.type[i] = type;
  q.x[i] = x;
  q.y[i] = y;
  q.r[i] = r;
  q.arg[i] = arg;
}

/** Apply and clear all buffered god commands. Called once per tick before any system
 *  reads the world (and, in GPU mode, before the upload that would otherwise lose them).
 *  smite reads world.hash, so the hash must be current — it is, rebuilt at the end of the
 *  previous tick (and after the GPU readback in the pipelined path). */
export function drainGod(world: World): void {
  const q = world.god;
  for (let i = 0; i < q.count; i++) {
    const x = q.x[i]!;
    const y = q.y[i]!;
    const r = q.r[i]!;
    switch (q.type[i]) {
      case GOD.Bloom:
        bloom(world, x, y, r);
        break;
      case GOD.Smite:
        smite(world, x, y, r);
        break;
      case GOD.Hazard:
        hazard(world, x, y, r);
        break;
      case GOD.PaintPass:
        paintPassability(world, x, y, r, q.arg[i]!);
        break;
      case GOD.FoodErase:
        drainFood(world, x, y, r);
        break;
    }
  }
  q.count = 0;
}
