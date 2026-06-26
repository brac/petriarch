// Tier B — CPU, symbolic/stateful. Energy ≤ 0 or senescence past LIFESPAN → remove
// via the pool's O(1) swap-remove. Because swap-remove invalidates the swapped-in
// index, iterate carefully (scan downward or collect-then-apply). STUB — M1.

import type { World } from "../../state/world";

export function death(_world: World): void {
  // TODO Milestone 1: collect dead indices (energy<=0 || age>lifespan), then
  // world.agents.kill() them without skipping the swapped-in slot.
}
