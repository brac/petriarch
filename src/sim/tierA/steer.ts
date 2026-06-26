// Tier A — GPU-portable, buffer contract. The core behavior pass and the one whose
// WGSL port matters most. Every THINK_INTERVAL ticks, compute a weighted steering
// vector per agent from the behavior genes (KIN_COHESION, SEPARATION,
// RESOURCE_ATTRACT, THREAT_AVOID, WANDER) over the sensed neighbors, and write it
// to agents.steerX/steerY for integrate to consume. STUB — implemented in M1.

import type { World } from "../../state/world";

export function steer(_world: World): void {
  // TODO Milestone 1: genes[i*GENE_COUNT + GENE.X] → steering vector. Cached in
  // steerX/steerY between thinks. Keep strictly to the flat-buffer contract.
}
