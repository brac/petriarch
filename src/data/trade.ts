// Trade tunables (Tier B). The first COOPERATIVE social system: at a non-hostile encounter
// (the complement of conflict's fight condition) two agents with COMPLEMENTARY nutrient
// imbalances barter-swap toward balance — each sheds a low-marginal-value surplus for a
// high-value deficit, so both move closer to the both-stores-high breeding condition. The
// swap conserves each nutrient (value comes from reallocation, not creation), so it changes
// who can BREED, not who survives. See src/sim/tierB/trade.ts.

export const TRADE = {
  /** agents within this distance (px) can barter. */
  range: 40,
  /** both partners' TRADE gene must exceed this to trade at all (else unwilling). */
  tradeThreshold: 0.1,
  /** skip agents whose two stores are already ~balanced (|energy − energyB| below this) —
   *  they have nothing worth trading and it bounds the scan. */
  imbalanceMin: 3,
  /** swap amount = rate · min(both TRADE genes) · ½·min(the two surpluses), capped by the
   *  receivers' headroom. 0.5 ≈ balance in ~2 trades; lower = slower, gentler exchange. */
  rate: 0.5,
}; // mutable: the dev panel tunes these live
