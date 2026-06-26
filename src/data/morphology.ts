// Milestone 2 morphology tunables (docs/genome.md §future body genes). Each body gene
// MUST carry a real tradeoff (the genome design law) — a benefit and a cost — so it
// stays a live variable instead of drifting to an extreme. These scale the benefit/cost
// of RESILIENCE and EFFICIENCY; the headless evolution harness tunes them until both
// genes hold variance (distinct body types coexist) rather than flooring/ceiling.
//
// Mutable (no `as const`) so the dev panel can tune them live, like SIM/COSTS/CONFLICT.

export const MORPH = {
  // EFFICIENCY [0,1]: digestion. Benefit = more energy per resource; cost = slower.
  effIntakeBonus: 0.4, // intake gain ×(1 + bonus·eff)  → up to +40% energy/resource
  effSpeedPenalty: 0.5, // max speed ×(1 − penalty·eff) → up to −50% speed

  // RESILIENCE [0,1]: armor. Benefit = less conflict/hazard damage; cost = heavier.
  resDamageReduction: 0.7, // conflict loser damage ×(1 − reduction·res)
  resHazardReduction: 0.5, // hazard drain ×(1 − reduction·res)
  resMovePenalty: 1.0, // movement drain term ×(1 + penalty·res) → up to 2× move cost
};
