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
  const spacing = BRIDGE.roadSpacing;
  const width = BRIDGE.roadWidth;
  const ground = PASSABILITY.defaultCost; // normal ground (1) — the only state that hardens

  // Row-major scan (top → bottom). A candidate (normal ground worn past the threshold) hardens only if
  // its COLUMN holds no OTHER road within `spacing` rows — a vertical exclusion. Roads within `width`
  // rows are this road's own body (allowed up to `width` tall); a road farther than that but within
  // `spacing` is a SEPARATE road too close → block. Horizontal neighbours are never checked, so a road
  // extends freely along the crossing → straight horizontal lanes, `width` cells thick, kept
  // ≥ spacing+1 apart. (Scanning top-down, the upper road forms first and reserves the gap below it.)
  for (let cy = 0; cy < GH; cy++) {
    const row = cy * GW;
    for (let cx = 0; cx < GW; cx++) {
      const c = row + cx;
      if (pass[c]! !== ground || trail[c]! < threshold) continue;
      let blocked = false;
      let body = 0;
      for (let d = 1; d <= spacing && !blocked; d++) {
        const yu = cy - d, yd = cy + d;
        const near = d < width; // within the road's own thickness → body, else a separate road
        if (yu >= 0 && isRoad(pass, yu * GW + cx)) { if (near) body++; else blocked = true; }
        if (yd < GH && isRoad(pass, yd * GW + cx)) { if (near) body++; else blocked = true; }
      }
      if (!blocked && body < width) pass[c] = road;
    }
  }
}
