// Tier A — GPU-portable, buffer contract. Per-agent, uniform, parallel.
// Neighbor-gather via the spatial hash (every THINK_INTERVAL ticks), capped by the
// intensity neighbor budget. Reads positions + the hash; writes a neighbor buffer
// the steer pass consumes. STUB — implemented in Milestone 1.

import type { World } from "../../state/world";

export function sense(_world: World): void {
  // TODO Milestone 1: gather same/different-signature neighbors via world.hash,
  // honoring world.intensity.neighborBudget. Strictly buffer-contract (no branchy
  // symbolic logic) so the WGSL port is a mechanical body-rewrite.
}
