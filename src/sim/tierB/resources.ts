// Tier B — CPU, symbolic/stateful. Runs first each tick: regrow every cell toward
// its capacity, and age out an active hazard zone. Depletion happens in metabolism
// (consumption); this is the counter-pressure that keeps the world alive.

import type { World } from "../../state/world";
import { RESOURCES } from "../../data/resources";
import { PASSABILITY } from "../../data/passability";

export function resources(world: World): void {
  const res = world.resources;
  const cap = world.resourceCap;
  const pass = world.passability;
  const block = PASSABILITY.blockThreshold;
  const rate = RESOURCES.regrowthRate;
  const n = res.length;
  for (let c = 0; c < n; c++) {
    // Ocean/wall cells are a dead zone: never grow food (and clear any that was already
    // there when the cell got painted). This enforces it every tick, so erasing the
    // barrier auto-restores regrow next tick — no separate bookkeeping on the paint tool.
    if (pass[c]! >= block) {
      res[c] = 0;
      continue;
    }
    const target = cap[c]!;
    const v = res[c]! + rate;
    res[c] = v > target ? target : v;
  }

  // Hazard zones fade over time.
  if (world.hazard.life > 0) world.hazard.life--;
}
