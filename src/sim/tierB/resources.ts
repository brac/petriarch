// Tier B — CPU, symbolic/stateful. Runs first each tick: regrow every cell toward
// its capacity, and age out an active hazard zone. Depletion happens in metabolism
// (consumption); this is the counter-pressure that keeps the world alive.

import type { World } from "../../state/world";
import { RESOURCES } from "../../data/resources";

export function resources(world: World): void {
  const res = world.resources;
  const cap = world.resourceCap;
  const rate = RESOURCES.regrowthRate;
  const n = res.length;
  for (let c = 0; c < n; c++) {
    const target = cap[c]!;
    const v = res[c]! + rate;
    res[c] = v > target ? target : v;
  }

  // Hazard zones fade over time.
  if (world.hazard.life > 0) world.hazard.life--;
}
