// Tier A — GPU-portable, buffer contract. Runs every tick: apply the cached
// steering vector to velocity, move, write new positions, keep agents in-bounds.
// Consumes agents.steerX/steerY (written by steer every THINK_INTERVAL). STUB —
// implemented in Milestone 1.

import type { World } from "../../state/world";

export function integrate(_world: World): void {
  // TODO Milestone 1: velX/velY += steer; posX/posY += vel; clamp to world bounds.
}
