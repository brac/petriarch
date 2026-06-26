// Tier B — CPU, symbolic/stateful. Energy ≥ REPRO_THRESHOLD → spend energy, emit
// FERTILITY offspring into free pool slots, each genome = parent's slice + seeded
// mutation scaled by the parent's MUTABILITY gene, clamped to GENE_RANGE
// (docs/genome.md §Mutation model). All randomness via world.rng. STUB — M1.
//
// NOT a fitness function: we never score and preferentially breed high scorers
// (CLAUDE.md rule 10). Only "fed enough to breed" gates reproduction.

import type { World } from "../../state/world";

export function reproduce(_world: World): void {
  // TODO Milestone 1: for each agent over threshold, spawn() offspring, copy genome
  // slice, mutate via world.rng scaled by parent MUTABILITY, clamp to GENE_RANGE.
  // Respect world.intensity.activeCount as the population cap.
}
