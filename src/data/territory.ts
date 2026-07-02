// Territory tunables (Tier B; data-driven, read live by conflict.ts). The second authored
// social layer (CLAUDE.md build-order #5: trade → TERRITORY/treaties → tech; docs/TERRITORY_PLAN.md).
//
// HOME-GROUND DEFENSE: the `claim` stigmergy field (each cell's mean signature = whoever holds it)
// stops being render-only and becomes a CONFLICT modifier. A combatant fighting on a cell whose
// mean signature matches its own gets a strength bonus (defending home turf); an invader on foreign
// or neutral ground gets none. Borders harden, invasions get repelled, a home market is defensible.
//
// Tradeoff invariant (CLAUDE.md — no civ mechanic is a pure bonus): the edge is PURELY LOCAL. It
// taxes mobility (raiders + long-haul carriers fight weak abroad, in tension with the trade layer)
// and punishes overextension (a sprawling empire spreads claim thin → cells drop below minMag → no
// defense). Self-limiting, not a runaway. Rule-10 safe: environmental/stigmergy-mediated (where you
// stand × signature match), never a per-agent score that gets bred. CPU-only → no WGSL / no GPU
// re-verify (conflict + claim both live on the CPU).

export const TERRITORY = {
  /** Strength multiplier at full home-match: si *= (1 + defBonus * homeMatch), homeMatch ∈ [0,1].
   *  0.6 → a defender deep in its own claim fights 1.6× as hard; a ~2× SIZE predator still wins, so
   *  borders firm up without becoming impregnable. defBonus 0 disables the layer (the study's OFF). */
  defBonus: 0.6,
  /** Claim magnitude below which a cell is NEUTRAL ground — no defender edge. Keeps empty land and
   *  freshly-contested seams neutral, and makes overextension (thin claim) forfeit the bonus. Also
   *  the neutral-land cutoff for the steer term below (no pull toward unclaimed cells). */
  minMag: 0.5,

  // --- T2: claim-affinity STEERING (Tier A; steer.ts + steer.wgsl). Home-ground DEFENSE (above) only
  // changes who wins a fight — the study proved that's spatially invisible (borders stay mush because
  // nothing steers on claim). This term makes agents ACT on territory: climb the gradient of
  // affinity A_i(cell) = claimMag·match_i (match = signature vs the cell's mean claim), so an agent is
  // pulled toward its own dense turf and NOT drawn into foreign/empty land → societies stop
  // interpenetrating and the rendered hue-border sharpens. Gene-scaled by KIN_COHESION (tribalism: the
  // same gene that pulls toward kin now also holds turf) → the tradeoff is a homebody-defender vs
  // wanderer-trader axis. ZEROED for committed carriers (a trade mission must not be pulled home).
  /** steer weight multiplier: term = KIN_COHESION × level × steerWeight × unit(∇ affinity). GENTLE by
   *  the inverted-U (the sweep: 0.3 hardens borders best — atHome +6.5pts, border fights −14%; stronger
   *  regresses AND softens the predation niche). Trade stays intact (committed carriers ignore it). */
  steerWeight: 0.3,
  /** foreign-repulsion: affinity = claimMag·(match − foreignRepel·(1−match)), so ENEMY turf (match→0)
   *  becomes NEGATIVE affinity and actively pushes invaders out (not just failing to attract). 0 =
   *  attract-to-own only; higher = steeper seam. Sharpens the border without a stronger overall pull. */
  foreignRepel: 0,
}; // mutable: the dev panel / study harness tunes these live
