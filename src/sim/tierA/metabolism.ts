// Tier A — GPU-portable, buffer contract. Runs every tick: drain energy (scaled by
// SIZE, METABOLIC_RATE, movement, senescence past LIFESPAN) and add intake from the
// resource field. Energy ≤ 0 is flagged for the death pass. STUB — implemented in
// Milestone 1.

import type { World } from "../../state/world";

export function metabolism(_world: World): void {
  // TODO Milestone 1: energy[i] -= drain(genes, vel); energy[i] += intake(resources).
}
