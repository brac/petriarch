// Caravan (carry/return) tunables — the round-trip state machine that turns crossers into CARRIERS
// (docs/P4C_PLAN.md §P4c). Tier B (the transition pass is symbolic/stateful; steer only reads the
// resulting state). The mechanic (brac's): a carrier fills up on the FAR good before turning around,
// so even though the foodless return burns some of it, it arrives still rich and barters the surplus
// to home kin — no dedicated cargo store needed (energy IS the cargo, lossy but full-load makes
// delivery meaningful). Reproduction is gated to the HOME region so carriers don't breed mid-transit
// (which also reinforces society-distinctness — A-lineages breed in region A).

export const CARAVAN = {
  /** forage→OUTBOUND: a forager commits to a round trip once it has filled its HOME good to this
   *  fraction of max — provisioned for the journey ("fill up before setting off"). Committed crossing
   *  ignores the provisioning gate (it won't retreat mid-gap), so it actually reaches the far region. */
  commitFrac: 0.7,
  /** OUTBOUND→RETURN: flips once the AWAY good is filled to this fraction (loaded up in the far region)
   *  — returns with a deliverable surplus, not a token amount. Symmetric to commitFrac. */
  loadFrac: 0.85,
  /** Gate reproduction to the home region (home-good scent dominates the cell). Blocks away-region and
   *  mid-gap births → carriers breed only once home. Set false to A/B-test the effect. */
  breedHomeOnly: true,
  /** Committed-traveller scent weight (OUTBOUND/RETURN). A committed carrier suppresses kin-cohesion and
   *  local foraging entirely and follows the scent at THIS weight (vs SCENT.weight in forage) so it
   *  actually detaches from the home pack and beelines across the gap. The probe showed flag-only
   *  commitment is outvoted ~2:1 by cohesion+food; this makes scent dominate. Tune up if carriers still
   *  don't cross (out% in the gap stays ~0), down if returners overshoot / ignore threats. */
  travelScent: 1.5,
}; // mutable: the dev panel / study harness tunes these live
