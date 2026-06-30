// Supply-scent tunables (Tier A field; static, built once at init, read by steer). The long-range
// REACH for long-distance trade (docs/P4_PLAN.md §P4a).
//
// The blocker: the deficit-seeking resource gradient (steer.ts) reads only the 4 NEIGHBOUR cells, so
// across the barren inter-region gap it's zero — an agent has no signal pointing toward the other
// region. FIRST ATTEMPT (a demand field — agents deposit per-nutrient deficit) FAILED: with the
// regions eaten down to scarcity, agents are hungry on BOTH nutrients, so demand just tracked
// POPULATION DENSITY and peaked inside each region — climbing it herded agents toward their own
// centre, AWAY from the gap (crossing study + spatial probe, P4a). FIX = geography-anchored SUPPLY
// SCENT: a widely-diffused, STATIC beacon of where each nutrient GROWS (built from the resource-
// capacity field at init). A B-deficient agent climbs the B-scent (peaked in region B) → pulled
// across the gap toward the actual source. Anchored to geography, not to where hungry agents are.
//
// Static → zero per-tick cost (built once in init.ts buildScent; rebuilt on snapshot restore). The
// long-range version of the existing local deficit-seeking food gradient. Not a fitness score (reads
// the resource FIELD + gene VALUES — rule 10).

export const SCENT = {
  /** steer term strength: scent pull = RESOURCE_ATTRACT gene × cognition level × this × provisionGate.
   *  A global knob (no new gene — P4a DECISION ②) so the long-haul pull is tunable vs local foraging.
   *  The cone (init.ts buildScent) reaches the whole map by construction. */
  weight: 0.6,
  /** PROVISIONING (P4b): the scent pull is gated by total energy reserve so only a WELL-FED agent
   *  undertakes the crossing (and by construction has the reserve to survive the foodless gap), while
   *  a low-energy agent ignores the far scent and forages locally. gate = clamp((reserve−floor)/
   *  (1−floor), 0, 1), reserve = (energyA+energyB)/(2·maxStore). Below this floor → no crossing; at
   *  full stores → full pull. The tradeoff: a crosser spends its reserve to reach the other good. */
  provisionFloor: 0.45,
}; // mutable: the dev panel / study harness tunes these live
