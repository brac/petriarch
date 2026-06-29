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

// 3b STUDY RESULT (src/tools/amitycheck.ts, 4 seeds × 16k, tail 12-16k) — these defaults are the
// "strong" config that won the decay sweep. KEY FINDING: amity bites on PERSISTENCE, not magnitude.
// Cranking perTradeVolume/suppress alone did almost nothing (peak amity capped ~4, <1% of fights
// suppressed) — because at the old fast decay each deposit faded before the next sparse frontier
// trade, so amity never accumulated. SLOW decay (0.998) lets a recurring border market build a
// broad standing peace: pacified-cell count 13→245, global fights/k 5176→4357 (−16% vs trade-only,
// −26% vs no-trade), frontier danger 0.20→0.16, TRADE selects up 0.45→0.49 (variance held), corrTA
// flips positive (warlord-traders viable), breedReady highest (66.9%) — all while the predation
// niche holds (predF 3.9%, corrSA ~0) and the world stays violent (4357 fights/k = no universal
// peace). Effects are real but GENTLE by design: P3 builds the tension + recession; P4 (carriers
// concentrating trade into routes) is where it flourishes.
export const AMITY = {
  /** amity stamped per unit of swapped energy (trade.ts). Mirror of dangerPerDamage. */
  perTradeVolume: 4,
  /** 4-neighbor blend fraction [0,1] — keep tight so a market pacifies its own seam, not the map. */
  diffuse: 0.12,
  /** per-tick multiplier (<1 → fades). SLOW (well past danger's 0.99) so a recurring frontier market
   *  ACCUMULATES a standing peace — the unlock (see 3b note above). "A fight is a flash, a trade
   *  relationship is a foundation": amity must outlast danger. Still <1 → an abandoned market re-heats. */
  decay: 0.998,
  /** conflict's effective aggressionThreshold is raised by suppress·amity[cell]; a high-amity cell
   *  needs a more-committed aggressor to start a fight (threshold crosses the gene max → no fights). */
  suppress: 0.3,
}; // mutable: the dev panel / study harness tunes these live
