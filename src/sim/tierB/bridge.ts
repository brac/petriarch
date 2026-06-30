// Tier B — CPU, symbolic/stateful. The construction tier: heavily-travelled caravan trail HARDENS into
// a permanent road (docs/P4C_PLAN.md §bridge). Reads the `trail` stigmergy field (deposited by committed
// carriers, P4d) and writes the `passability` field (the movement-cost texture integrate already reads,
// CPU + GPU): a cell whose carrier traffic has crossed BRIDGE.setThreshold becomes a low-cost lane the
// integrator speeds the step across (cost < 1 → ×1/cost). A faster crossing = fewer ticks starving in
// the foodless gap = the deadly crossing becomes survivable, so completed round trips climb.
//
// Permanent: passability never decays, so a road, once laid, persists ("a permanent structure made of
// resources no longer edible" — brac). Only NORMAL GROUND hardens (passability == defaultCost); ocean
// /walls (≥ block) and existing roads (< 1) are skipped — idempotent and O(grid). NOT a fitness
// function (reads field magnitude + geography, never an agent score — rule 10). Tier B, never the GPU;
// passability is CPU-source and uploaded each tick, so the GPU integrate reads the road with no kernel
// change and no readback race (see memory petriarch-gpu-god-tools-race).

import type { World } from "../../state/world";
import { BRIDGE } from "../../data/bridge";
import { PASSABILITY } from "../../data/passability";
import { RESOURCE_GRID_W, RESOURCE_GRID_H } from "../../data/capacity";

const GW = RESOURCE_GRID_W;
const GH = RESOURCE_GRID_H;

/** A road cell = passability in (0,1) (ground is 1, ocean ≫ 1). */
function isRoad(pass: Float32Array, c: number): boolean {
  const v = pass[c]!;
  return v > 0 && v < 1;
}

export function bridge(world: World): void {
  const trail = world.trail;
  const pass = world.passability;
  const threshold = BRIDGE.setThreshold;
  const road = BRIDGE.roadCost;
  const maxNbr = BRIDGE.maxRoadNeighbors;
  const ground = PASSABILITY.defaultCost; // normal ground (1) — the only state that hardens

  // Row-major scan. A candidate (normal ground worn past the threshold) hardens only if its
  // 8-neighbourhood holds ≤ maxRoadNeighbors road cells — the anti-clump that keeps a road ~1 cell
  // wide instead of paving the whole gap. Because earlier-in-scan cells harden first, the row above a
  // fresh road blocks the row below (3 road-neighbours) → the road runs along the horizontal crossing.
  for (let cy = 0; cy < GH; cy++) {
    const row = cy * GW;
    const up = cy > 0 ? row - GW : -1;
    const dn = cy < GH - 1 ? row + GW : -1;
    for (let cx = 0; cx < GW; cx++) {
      const c = row + cx;
      if (pass[c]! !== ground || trail[c]! < threshold) continue;
      const hasL = cx > 0, hasR = cx < GW - 1;
      let nbr = 0;
      if (hasL && isRoad(pass, c - 1)) nbr++;
      if (hasR && isRoad(pass, c + 1)) nbr++;
      if (up >= 0) {
        if (isRoad(pass, up + cx)) nbr++;
        if (hasL && isRoad(pass, up + cx - 1)) nbr++;
        if (hasR && isRoad(pass, up + cx + 1)) nbr++;
      }
      if (dn >= 0) {
        if (isRoad(pass, dn + cx)) nbr++;
        if (hasL && isRoad(pass, dn + cx - 1)) nbr++;
        if (hasR && isRoad(pass, dn + cx + 1)) nbr++;
      }
      if (nbr <= maxNbr) pass[c] = road;
    }
  }
}
