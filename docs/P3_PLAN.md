# Petriarch — Trade Phase 3: the TRADE-vs-AGGRESSION tension

> **Goal (brac's own words, from BUGS.md):** *"After an initial period of conflict, once trade
> starts to take over, the conflict should lessen more and more."* Make peace-through-commerce a
> real, evolved, **visible** dynamic — not a coincidence.

This is CLAUDE.md build-order #5 (authored social layer) and the payoff Phase 2 deferred. Phase 2
built trade, made it visible, and validated it — but the 2d study **falsified the easy win**: local
barter is *partner-limited* and *barely pays*, so the TRADE gene only drifts and conflict never
recedes. P3's job is to give trade a real edge over raiding at the frontier, so selection pushes
TRADE up where it pays and AGGRESSION down where trade is the better move — and so the **frontier
visibly cools** as commerce takes hold.

P3 is **entirely Tier B / CPU** (conflict, trade, a new stigmergy field). No WGSL kernel touches, so
the verify surface is typecheck + headless + the study harness — **no GPU re-verify needed**. (Tier A
sense/steer/integrate/metabolism are untouched.)

---

## What we learned in Phase 2 (the constraints P3 must respect)

1. **Local trade is partner-limited.** Within a region everyone is identically A-surplus;
   complementary (A-surplus ↔ B-surplus) pairs only exist *at the frontier* where two societies
   meet. → P3 mechanics operate mainly at that border seam. That's fine — "border market" is a great
   emergent place — but **P3 will not make trade flourish world-wide. That's P4 (carriers).** Be
   honest about the ceiling.
2. **The raider/merchant split today is a linkage artifact, not trade-evolved** (corrTA ≈ −0.3 even
   with trade OFF). P3's success bar is to make TRADE select up *because trading pays*, measured
   against a trade-OFF control — not just to see a negative corrTA.
3. **A latent crossover already exists in the code** (good news): conflict robs the loser's energy
   but deposits it **all into store A** (`energy[winner]`, conflict.ts:132), and raiding is lossy
   (`stealFrac 0.8` → 20% destroyed). So **raiding never improves your breeding balance** (you need
   *both* stores high to breed; raiding just piles up A), while **trade does**. The tension is
   already half-built — P3 makes it bite and makes it visible.

---

## The mechanic: an `amity` stigmergy field that trade writes and conflict reads

One new CPU grid field, modeled exactly on `danger` (same 80×45 grid, same deposit→diffuse→decay
loop in `stigmergy.ts`). This is the cleanest delivery of brac's exact ask and it honors every
invariant.

**Write (trade.ts):** every successful barter stamps `amity` into the trade's cell, scaled by the
swap volume `t` — `amity[c] += AMITY.perTradeVolume * t`. (Mirror of how combat stamps `danger`.)

**Read (conflict.ts):** before resolving a fight, soften it by local amity. Two options (pick in 3b
by study): either **raise the effective `aggressionThreshold`** by `AMITY.suppress * amity[c]` (a
pacified cell needs a *more* committed aggressor to start a fight), or **probability-skip** the fight
with `p = min(1, AMITY.suppress * amity[c])` via the seeded RNG. Both make a cell where commerce has
taken hold stop generating fights. Recommend the **threshold-raise** form first: deterministic,
no extra RNG draw, and it reads naturally as "trust raises the bar for violence."

**Decay (stigmergy.ts):** `amity` diffuses + decays like `danger` (add one `diffuseDecay` call).
Decay is the crucial part — **peace is not permanent.** Stop trading and the seam cools back to
contestable; that's what makes it a *dynamic* (conflict→trade→peace→, repeatable) and not a one-way
ratchet.

### Why this delivers the dynamic
- Two **complementary** societies that meet and trade → repeated swaps stamp amity → the seam's fights
  get suppressed → both societies sit at the border breeding (trade fixed their balance) instead of
  grinding → **danger fades, conflict visibly lessens "more and more"** exactly as described.
- A pair that **raids** instead stamps `danger`, not `amity` → the seam stays hot, both stay
  imbalanced (raiding piles up the wrong nutrient) → they can't out-breed the traders next door.
- Over generations: at complementary frontiers, **TRADE selects up** (traders breed more) and
  **AGGRESSION selects down** (its fights are suppressed there and pay less) — a genuine
  *spatially-conditioned* tension, the thing the 2d study found missing. The predation niche
  elsewhere (predators hunting prey over food, the BUGS.md study) is **untouched**, because amity only
  accumulates where trade happens — so we don't flatten the SIZE×AGGRESSION predator class.

### How it honors the invariants
- **Rule 10 (no fitness function):** amity is pure stigmergy — it reads trade *events* and gene
  *values*, stamps a field, and conflict reads the field. Same class as `danger`/`claim`. No agent is
  ever scored and preferentially bred.
- **Tradeoff invariant (no pure-bonus mechanic):** amity is **exploitable by design.** A pacified
  zone suppresses *defenders'* aggression too, so a high-AGGRESSION raider can move into a flourishing
  market and raid with reduced resistance — a "betrayal/sack-the-market" niche. That's the cost that
  keeps amity from maxing out into permanent universal peace. (If it over-collapses the mechanic in
  the study, tune via decay/stamp rates; do **not** remove the exploit — it's the tradeoff.)
- **Tier discipline:** Tier B only. Amity never reaches the GPU. If we *later* want agents to steer
  toward safe markets, that's a steer-kernel change and a separate, GPU-verified phase — explicitly
  **not** in P3.

---

## The design fork (pick one — recommendation first)

**A. `amity` field alone (RECOMMENDED).** Smallest change that delivers the headline dynamic, and the
latent raid/trade breeding crossover already supplies the selection gradient. Ship it, study it, and
only add a sharpener if TRADE still doesn't select up.

**B. amity field + "raid steals the *deficit* nutrient" sharpener.** In addition, change conflict so
the winner robs into whichever store it is *poorer* in — wait, that *helps* the raider; the correct
sharpener is the opposite: make the raid **destroy** more of the victim's scarce store (lower
effective `stealFrac` on the deficit nutrient) so raiding a complementary neighbor is sharply
negative-sum on the breeding axis. Bigger selection gradient for TRADE, but it also perturbs the
tuned predation niche — more knobs to re-validate. **Hold in reserve** for 3b if A's gradient is too
weak.

**C. raid-or-trade hard exclusivity gene-gate (NOT recommended).** Force one axis (high TRADE forecloses
fighting, high AGGRESSION forecloses trading). Cleaner story but collapses the 2-D merchant/raider/
loner/warlord-trader strategy space P2 deliberately built, and removes the spatial nuance amity gives.
Don't — it throws away the richness.

I recommend **A**, with B's sharpener pre-specified and ready if the 3b study shows TRADE not selecting.

---

## Substeps (each ends green: typecheck + headless + study)

- **3a — the amity field. ✅ DONE (fork A).** `world.amity: Float32Array` allocated + serialized
  (snapshot **v7**, two-restore self-consistency verified incl. the field). New `src/data/amity.ts`
  (`perTradeVolume 2.5`, `diffuse 0.12`, `decay 0.985`, `suppress 0.12`). `trade.ts` stamps amity per
  swap-volume; `stigmergy.ts` diffuses+decays it; `conflict.ts` raises the effective
  `aggressionThreshold` by `suppress·amity[cell]` (deterministic threshold-raise form). Diagnostic
  counters `a.fightTotal` / `a.fightSuppressedTotal` (pools, not serialized); headless gains
  `amityMx / trd/k / fgt/k / sup/k` columns. Tier B only — no WGSL touch, runs identically in CPU +
  GPU paths (both call the same Tier-B fns). Smoke (seed 24301, 6k): amityMx peaks 2–7 at frontier
  markets, `sup/k` climbs 44→456 as markets establish while `fgt/k` stays ~8000 (predation niche
  intact), pop 7238 / 16 lineages / genes varying — lever demonstrably active, far from universal
  peace. **Defaults are a conservative starting point; 3b tunes them on the ON/OFF study.**
  *(original 3a scope below, for reference)* Add `world.amity: Float32Array(N)` (world.ts, snapshot vN+1, init zero).
  Add `AMITY` tunables to a new `src/data/amity.ts` (or fold into `stigmergy.ts`):
  `perTradeVolume`, `diffuse`, `decay`, `suppress`. Stamp in `trade.ts`; add the `diffuseDecay` call
  in `stigmergy.ts`; read+suppress in `conflict.ts`. Snapshot bump + headless REPORT line
  (mean amity, suppressed-fight count). Typecheck + a smoke headless run.
- **3b — the study. ✅ DONE.** New harness `src/tools/amitycheck.ts` (amity-ON vs amity-OFF vs
  trade-OFF + a decay sweep, with a **frontier-local danger** metric — danger in amity-marked cells,
  the clean causal test the global fight-count masked). **KEY FINDING: amity bites on PERSISTENCE,
  not magnitude.** The magnitude sweep (suppress→0.5, vol→5) did almost nothing (peak amity capped
  ~4, <1% of fights suppressed) — at fast decay each deposit faded before the next sparse frontier
  trade. SLOW decay (0.998) was the unlock: a recurring market accumulates a broad standing peace.
  16k×4-seed confirm of the winning "strong" config (suppress 0.3, decay 0.998, vol 4): pacified
  cells 13→245, global fights/k 5176→4357 (−16% vs trade-only), frontier danger 0.20→0.16, TRADE
  selects up 0.45→0.49 (variance held), corrTA flips positive, breedReady highest (66.9%), predation
  niche intact (predF 3.9%, corrSA ~0), no universal peace. **Baked into `src/data/amity.ts`.**
  Effects are real but gentle by design — the dramatic flourishing is P4's job. *(original 3b scope:)*
  Extend `src/tools/tradecheck.ts` (or a new `src/tools/amitycheck.ts`) — trade+amity ON vs trade-ON-amity-OFF vs trade-OFF, tail-averaged, ≥3 seeds.
  **Confirm-or-falsify metrics:**
  - `tradeMean` rises **and holds variance** under amity-ON vs the OFF control (TRADE *selects*, not
    drifts) — the headline.
  - `dangerMean at frontier` and `fights/k` **drop** under amity-ON (conflict recedes — brac's ask).
  - `breedReady` and pop hold or rise (peace isn't starving anyone).
  - predation niche intact: `predFrac` / `corrSA` ≈ the BUGS.md baseline (we didn't flatten predators).
  - **Falsification triggers:** amity maxes out → universal permanent peace (decay too slow / stamp
    too strong → tune); OR betrayal exploit collapses trade (raiders sack every market → tune
    suppress down / decay up); OR TRADE still flat vs OFF → escalate to fork **B**'s sharpener.
  Tune `AMITY.*` on the harness exactly like the predation/repro/speciation studies; bake the winning
  defaults into data with the study numbers in the comment (project convention).
- **3c — the visual. ✅ DONE.** Amity renders as a warm-**gold** pax-haze cell layer (mirror of
  `drawDanger`; tints `data/amity.ts renderAlpha 0.5 / renderMagFull 2.5`, tuned to the live field's
  mass not its peak — a browser probe showed peak ~5 but the mass sits in [0.5,2], so a low magFull
  lights the broad district, not just the hottest cells). Gold chosen (brac) to match the gold
  trade-pulses → unified commerce language; war = red + white sparks, commerce = gold glow. Always-on
  ambient, gated on nothing (per [[intensity-is-perf-not-visual]]). Plus a **pax view toggle ('a')**
  mirroring border-mode ('v'): ghosts nodes, hides the kin mesh + ground/resource layers, and pushes
  danger+amity to full alpha so the war/commerce map pops on the dark field — the clearest way to
  watch conflict recede as a seam pacifies. Verified headful on the real GPU (Chrome-devtools): gold
  districts + red war-zones read unmistakably. Typecheck clean.

---

## What P3 explicitly does NOT do (so we stay honest)
- It does **not** make trade flourish away from the frontier — partner-scarcity is structural; **P4
  carriers** (demand-directed travel across the dead zone) is what spreads complementary partners.
- It does **not** touch the GPU path. If steering-toward-markets is ever wanted, that's a later,
  separately-verified Tier A change.
- It does **not** add a treaty/territory layer (that's the next authored system *after* trade,
  build-order #5→ "territory/treaties"). Amity is a soft, decaying field, not a formal border.

## Related
- Memory: [[petriarch-trade-foundation]] (phase plan; P2 falsification), [[petriarch-adding-a-gene]]
  (not needed — no new gene), [[petriarch-evolution-tuning]] (make a gene's upside actually pay —
  the lens for 3b), [[petriarch-predation-niche]] (the niche 3b must not flatten),
  [[brac-decisions-and-optimization]] (present forks + recommend — this doc's fork section).
- Code anchors: `src/sim/tierB/{trade,conflict,stigmergy}.ts`, `src/data/{trade,conflict,stigmergy}.ts`,
  `src/tools/tradecheck.ts`, `src/state/world.ts` (field alloc), `src/tools/snapshot.ts` (version bump).
</content>
</invoke>
