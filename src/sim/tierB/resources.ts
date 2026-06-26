// Tier B — CPU, symbolic/stateful. Deplete (on consumption) and regrow the
// resource field. Regrowth rate + spatial distribution are the single biggest lever
// on which strategies win (docs/genome.md). Runs first each tick. STUB — M1.

import type { World } from "../../state/world";

export function resources(_world: World): void {
  // TODO Milestone 1: regrow world.resources toward cell capacity (data/resources).
}
