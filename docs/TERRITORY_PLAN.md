# Territory / Treaties — Plan

The **second authored social layer** (CLAUDE.md build-order #5: `trade → territory/treaties →
tech`). Trade is complete (societies barter, amity cools frontiers, carriers run roads across the
dead zone). Now: **borders become formal, and defending home turf means something** — the
pressure-release valve on conflict, now that there is a home worth holding and a trade route worth
protecting.

## The gap this fills

`claim` (territory) already exists as a **render-only** stigmergy field: each cell accumulates a
presence magnitude + a presence-weighted signature vector, so `claimSig{A,B,C}/claimMag` = the mean
signature (hue) of whoever holds that cell (`src/sim/tierB/stigmergy.ts`). Nothing *reads* it for
gameplay — it only tints the ground. Territory = **give `claim` teeth.**

(`amity` already delivers a *cell-local* treaty — trade writes it, conflict reads it to suppress
fights where commerce happens. The pairwise/faction "treaty relationship" is deferred; it needs
discrete-faction substrate and overlaps the later faction-memory ratchet. T1 is the territory half.)

**Status (shipped):** T1 (home-ground defense) **and** T2 (claim-affinity steering, CPU + GPU) both
landed and are ON by default (`defBonus 0.6`, `steerWeight 0.3`, `foreignRepel 0`). GPU steer/chain
re-verified on the 3090 (worstAbs ≤ 1.4e-3 « 2e-2). Study `repel0` config confirms the mechanic
bites: defWin 55.5% (>50%), atHome 57.1%, sigVar held (0.067, no monoculture), trade + predation
niches intact. The `foreignRepel` sweep found >0 doesn't help — 0 kept. See `src/data/territory.ts`.

## T1 — Home-ground defense (the core, brac-picked)

**Mechanic (Tier B, CPU-only — `conflict.ts`).** At fight resolution, each combatant gets a strength
bonus proportional to how well its own signature matches the mean signature of the claim on the cell
it stands on:

```
homeMatch(cell, sig) = claimMag[cell] < minMag ? 0
                     : clamp(1 - |sig - claimSig[cell]/claimMag[cell]| / sigThreshold, 0, 1)
si = SIZE_i*(0.5+agg_i)*(0.5+roll) * (1 + defBonus * homeMatch(cell_i, sig_i))
sj = SIZE_j*(0.5+agg_j)*(0.5+roll) * (1 + defBonus * homeMatch(cell_j, sig_j))
```

- `homeMatch` reuses `SIM.sigThreshold` (the same "same-group" cutoff conflict already uses) as the
  normalizer: 1 when you sit on turf claimed by your own kind, 0 a full threshold away.
- Gated by `minMag`: cells with too little accumulated claim are **neutral ground** — no defender
  edge. Empty land and freshly-contested seams confer nothing.
- A defender deep in its own claim fights up to `1+defBonus`× as hard; an invader on foreign turf
  gets `homeMatch≈0` → no bonus. Borders harden; invasions get repelled; a home market is
  defensible → trade routes anchored on it are worth protecting.

**Tradeoff (the standing invariant — no civ mechanic is a pure bonus):** the advantage is *purely
local*. It taxes mobility — raiders and long-haul carriers who leave home fight *weak* on foreign or
neutral ground, in direct tension with the trade layer we just built (crossing the gap is already a
survival tax; now it's a combat tax too). And it punishes overextension: holding a large territory
spreads `claim` magnitude thin (it diffuses + decays), dropping cells below `minMag` → a sprawling
empire has *weaker* per-cell defense than a compact one. Self-limiting, not a runaway.

**Rule-10 safe:** environmental, stigmergy-mediated. The field confers advantage by *where you are*
and whether your signature matches the local accumulated claim — never a per-agent quality score that
gets preferentially bred. Same shape as `amity`. No GPU touch (conflict + claim are both CPU) → **no
WGSL edit, no GPU re-verify.**

## Tunables (`src/data/territory.ts`, dev-panel live)

- `defBonus` — strength multiplier at full home-match (start 0.6 → a full-home defender is 1.6×; a
  2× SIZE predator still wins, so it hardens borders without making them impregnable).
- `minMag` — claim magnitude below which a cell is neutral ground (start 0.5).

## Verification

- `npm run typecheck`.
- `src/tools/territorycheck.ts` — OFF (`defBonus 0`) vs ON. Instrument `conflict.ts` with pooled
  `homeWinTotal`/`homeContestTotal` counters (not serialized, like `fightTotal`): the **defender
  win-rate** (fraction of contests won by the higher-home combatant) is the clean causal readout —
  ~0.5 at OFF, should climb with `defBonus`. Guard rails: population healthy, lineage/signature
  diversity NOT collapsed into a frozen monoculture, and the **predation + trade niches hold**
  (predF, corrSA, TRADE variance vs baseline — reuse the amitycheck/predation metric set).
- No GPU verify (CPU-only). No snapshot bump (claim fields already serialized; no new persistent
  state).

## Deferred

- Pairwise/faction treaties (a faction×faction relation matrix; peace away from the market). Needs
  discrete-faction bucketing — closer to the faction-memory ratchet (roadmap step 7).
- ~~Territorial *steering* (agents avoid trespassing on foreign claim) — a Tier-A/GPU change.~~
  **DONE (T2):** claim-affinity steering shipped, CPU (`steer.ts`) + GPU (`steer.wgsl.ts`),
  gene-scaled by KIN_COHESION, zeroed for committed carriers.
- Rendering: the border view (`v`) + `drawClaim` already show turf; a "hardened border" visual can
  come if the study says borders visibly firm up and want emphasis.
