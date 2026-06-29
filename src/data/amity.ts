// Amity stigmergy field tunables (Tier B; data-driven, read live). The TRADE-vs-
// AGGRESSION tension (docs/P3_PLAN.md): trade WRITES amity, conflict READS it.
//
// Amity is a grid field (same 80×45 grid as resources/danger) that successful barters
// deposit into — scaled by swap volume — and that conflict reads to SUPPRESS fights in
// pacified cells (a flourishing border market stops generating violence → "once trade
// takes over, conflict lessens"). It DIFFUSES + DECAYS like danger, so peace is not
// permanent: stop trading and the seam cools back to contestable. Tradeoff invariant
// (CLAUDE.md): suppression applies to defenders too, so a raider can sack a pacified
// market — that exploit is the cost that keeps amity from maxing into universal peace.
//
// Pure stigmergy: reads trade EVENTS + gene VALUES, never an agent quality score
// (rule 10). Stays CPU/Tier B — never uploaded to the GPU. See src/sim/tierB/{trade,
// conflict,stigmergy}.ts.

export const AMITY = {
  /** amity stamped per unit of swapped energy (trade.ts). Mirror of dangerPerDamage. Sized so
   *  a busy frontier market's peak amity (~3–5) × `suppress` clears the typical AGGRESSION, i.e.
   *  pacifies the seam — while quiet cells stay contestable. 3a starting point; 3b tunes on the
   *  ON/OFF study harness (the predation/repro/speciation-study convention). */
  perTradeVolume: 2.5,
  /** 4-neighbor blend fraction [0,1] — keep tight so a market pacifies its own seam, not the map. */
  diffuse: 0.12,
  /** per-tick multiplier (<1 → fades). Faster than danger's so peace lapses when trade stops. */
  decay: 0.985,
  /** conflict's effective aggressionThreshold is raised by suppress·amity[cell]; a high-amity cell
   *  needs a more-committed aggressor to start a fight (threshold crosses the gene max → no fights). */
  suppress: 0.12,
}; // mutable: the dev panel / study harness tunes these live
