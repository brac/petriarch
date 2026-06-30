# Petriarch — Trade Phase 4c: the round trip (carriers, not migrants)

## STATUS (DONE — round trip works, tuned/baked, GPU-verified on the 3090) — what's next

**P4c COMPLETE.** CPU round trip works + baked (loadFrac 0.40), and the GPU port (4c-4) is verified on
the real 3090 (NVIDIA Ampere). The committed-traveller + carry-state logic now runs in `steer.wgsl`:
`carryState`+`homeGood` packed into one `u32` (binding 12, device limit 11→12), state-branched scent
target + committed suppression (zero kin-cohesion + local food, scent at `travelScent`). Uploaded each
think tick (`uploadCarry`) in both gpuSim paths; both verifies snapshot+feed the packed state. GPU
verify (real Chrome → 3090, 1200-tick warmup so 470–650 committed agents/seed exercise the new branch):
**steer.ok + chain.ok across 5 seeds, two runs.** Recalibrated tolerances (committed branch's sharper
travelScent widens the f32/f64 flake): steer 1e-2→**2e-2** (worst ≤1.4e-2), chain 5e-2→**1e-1** (worst
≤0.06px, ≤1 agent/seed, run-to-run noisy via atomic intake). Non-systematic precision flake, documented
in verify.ts. P4c is now FULLY on the GPU — no remaining non-parity. See [[petriarch-adding-a-gpu-field]].

**NEXT:** P4d — the headful payoff (below). The trade arc's compute is done.

---

## STATUS (superseded — kept for history) — round trip WORKS + tuned/baked
**The round trip is real and honest.** Two bugs found+fixed turned the inert P4c into completing
caravans:
1. **Symbolic-only commitment** — flipping to OUTBOUND changed only the scent *target*; the pull
   (`gene·0.6`) was outvoted ~2:1 by kin-cohesion + local food (`gene·1.0` each), so committed agents
   never left home (probe: 93% of OUTBOUND still home-side). FIX = **committed-traveller steer**
   (`steer.ts`): in OUTBOUND/RETURN, suppress kin-cohesion AND local foraging entirely and follow scent
   at `CARAVAN.travelScent` (1.5) so a carrier detaches from the pack and beelines across. Separation +
   danger-avoid stay on.
2. **Flicker-inflated completions** — OUTBOUND→RETURN had no geographic check, so ordinary barter near
   home topped up `awayStore` past `loadFrac` and agents flickered OUTBOUND→RETURN→FORAGE without
   crossing (counter read 1840/k of non-journeys). FIX = require `awayScent > homeScent` (actually in
   the far region) to flip (`caravan.ts`).

**Honest numbers** (`tools/crossing.ts`, loadFrac sweep @ commit0.7, geo-gate on): real cross-gap
deliveries **~10–16/k** (was a flicker-inflated 1840); **trade volume 2×** (947→2057/k); imbalance
.093→.081 (goods move both ways). `loadFrac` **0.70 > 0.85** (16 vs 10 deliv/k). Return-trip mortality
~⅓ (load/k 23 → deliv/k 16: a third load but die crossing back — the energy-cargo tax). COST: pop −5%,
breed 51%→41% (carriers trade instead of breeding — "trade pays" hasn't flipped net-positive yet).

New diagnostics: `caravanLoaded`/`caravanDelivered` counters in pools (deliv/k = the true completion
rate; carry% stock is misleading — RETURN leg is brief). `tools/probe.ts` = OUTBOUND location/load/
starvation bucketing (the tool that caught bug #1). Metric flaw #3 (`home%` re-homes at birth) still
open but less load-bearing now that deliv/k exists.

**Key finding banked:** a *continuous* provisioning gate (P4b) can't produce committed travel; a
discrete OUTBOUND state + a steer that actually suppresses the home-pull is what crosses the gap. See
[[petriarch-longrange-fields]].

**TUNED + BAKED (net-positive reached on energy-cargo — Fork 2b NOT needed).** `loadFrac`×`travelScent`
sweep @ commit0.7 (2 seeds / 6k ticks). Baked **`loadFrac` 0.40** (commitFrac 0.7, travelScent 1.5 keep
defaults). The knee: a *smaller* required cargo lets carriers turn around sooner with fuel to spare →
they survive the return and complete far more trips:

```
                pop    out%  load/k deliv/k  trd/k imbal breed%   (return-mortality = load−deliv)
OFF(ctrl)      8054    0.0      0     0       947  .093  51.3
L.70 T1.5      7691   34.5     23    16      2057  .081  40.8   ← pop −5%, mortality 7  (was the WIP state)
L.55 T1.5      8185   19.7     43    40      1686  .078  48.3   ← pop recovers, mortality 3
L.40 T1.5  →   8218   11.2     45    45      1575  .079  49.5   ← BAKED: mortality 0, pop ≥ baseline, breed ~back
```

At 0.40: **deliv/k 45** (vs 16 at 0.85), **return-mortality ~0** (load=deliv), **pop 8218 ≥ the 8054
no-caravan baseline**, breed 49.5% (≈51.3% baseline), imbalance .093→.079 (goods move both ways). The
−5% trade tax from P4a/b has flipped non-negative while real caravans cross. (Higher loads carry more
per trip but fewer complete and more die crossing back — net worse; 0.40 wins.) Trade-off noted:
delivered *flux* = trips×cargo-per-trip, so 0.40's lighter loads partly offset trip count, but imbal is
flat vs 0.55 so net goods movement holds.

**NEXT (resume here):**
1. **GPU port (4c-4)** — the only remaining P4c work. CPU behaviour is now baked, so mirror P4a-cpu→gpu.
   Pack `carryState`+`homeGood` into one u32 → steer 11→12 bindings (bump device limit), state-branch the
   scent target AND the committed-traveller suppression (zero kin-cohesion + local food when
   `carryState≠0`, scent at `travelScent`) in `steer.wgsl`, Playwright-verify on the 3090 (seed-sweep the
   flake). NOTE: GPU steer is currently NON-PARITY (CPU-only committed-traveller logic). See
   [[petriarch-adding-a-gpu-field]].
2. **P4d** (deferred): render the route — trail stigmergy → glowing caravan lines across the gap (the
   literal picture of "societies trading over a dead zone"). The headful payoff.
3. **Open (low priority):** metric flaw #3 (`home%` re-homes at birth) — superseded by deliv/k for the
   completion question, but if society-blur ever needs measuring, use signature-separation not home%.
   If a future fork wants *more delivered flux* (not just more trips), revisit Fork ② (non-consumed
   cargo) — but net-positive is already met without it.

---


> **The keystone of the whole trade arc.** P4a gave agents the *reach* to cross the gap; P4b made the
> crossing *survivable*. But they still produce **migration**, not trade: an agent crosses to the far
> region, gets the good it lacked, reaches balance — and **settles there**. Goods end up where the
> agent ends up. P4c makes the agent **come home** with the far good, so goods move *both ways* and the
> two societies stay distinct. This is what turns "nomads chasing food" into "two societies trading
> over distance" — and where the −5% population tax should finally flip net-positive.

## The core problem (measured, not assumed)

The crossing study (P4a/b) showed left/right population balance *holds* (~45/54) and gap traffic stays
low (~1.5%) even with the reach + provisioning on. Why no oscillation? **Deficit-seeking damps at
balance.** Once a crosser trades/eats its way to balanced stores in the far region, *both* deficits are
low → the scent pull (deficit-weighted) goes quiet → it settles and breeds locally. Nothing pulls it
home. So P4c must add (1) a **return drive** that survives reaching balance, and (2) a reason carrying
**pays**, so carrier behaviour is selected rather than drifting out.

## The cargo trap (the subtle, decisive constraint)

The obvious "carry the good home in your `energyB` store" **doesn't work**: the return crossing is over
the *foodless* gap, so metabolism burns `energyB` for survival — **the agent eats its own cargo en
route and arrives empty.** This is exactly why P2 deferred "a non-consumed cargo store … to P4 for long
hauls." Delivering a good home requires carrying it in a store that survival can't touch. That is the
central design fork below.

---

## Three design forks (recommendation first; brac picks)

### FORK ① — what drives the RETURN
- **(1a) Explicit carry/return state machine (RECOMMENDED).** A per-agent `carryState`
  (forage / return). After loading the far good, flip to `return` and head home *regardless of
  deficit* (overrides the damped deficit-seeking); at home, flip back to `forage`. This is the
  cognition doc's "one genuinely new mechanism," and it's the only option that reliably produces a
  round trip. Cost: per-agent state + a Tier-B transition pass + a "home" signal (Fork ③).
- **(1b) Emergent oscillation.** Lean on the *rotating* deficit (after gaining B you're now A-poor →
  scent pulls you back toward A). Elegant, no state — but the study shows it's damped at balance, so
  it'd need a destabiliser (lower the worldgen cross-crop so agents stay deficient, or a "committed
  traveller" momentum). Riskier, less legible, harder to tune. *Hold as a fallback.*

### FORK ② — cargo (the carry medium)
- **(2a) Lossy energy-as-cargo (START HERE).** No new store: the carrier loads its `energyB` high in
  region B and the return burn eats *some* of it; it delivers the remainder by bartering to B-poor kin
  at home (existing `trade.ts`). Zero new per-agent floats, no metabolism change — fastest to a
  watchable round trip. **Risk:** if the crossing burn eats most of the cargo, delivery is negligible.
  Measure delivered-flux in the study; if it's too lossy, escalate to (2b).
- **(2b) Dedicated non-consumed cargo store.** `cargo` (+ which-good) that metabolism *exempts*, loaded
  at the far region and unloaded into the home barter pool. Lossless, "correct," and the true F2
  primitive — but adds per-agent state + a metabolism carve-out + load/unload rules + GPU plumbing.
  *Do this in 4c-stage-2 only if (2a)'s delivery is too lossy to matter.*

### FORK ③ — the "home" signal (revisiting P4-plan DECISION ③)
- **(3a) `homeGood` bit (RECOMMENDED).** One bit per agent set at spawn from the birth cell
  (`scentA[cell] > scentB[cell]` → home = A). In `return`, climb the **home good's scent** (reuses the
  P4a scent cones — no new field) → heads to the home region. Cheapest (1 bit, GPU-packable), composes
  with the state machine, inherited implicitly via birth location.
- (3b) Stored origin (x,y): exact home point, 2 floats, steer toward it — but +2 GPU buffers (binding
  pressure) and stale if the tribe migrates.
- (3c) Claim-field gradient: most "alive," but the claim field is **CPU-only** → steer reading it means
  uploading claim to the GPU (another buffer + the diffused-signature filter math). Too costly now.

**Recommended P4c-v1 = 1a + 2a + 3a:** a carry/return state machine, lossy energy-cargo, homeGood-bit
return target. Smallest thing that produces a real round trip; measure delivery; upgrade ②→2b only if
needed.

---

## Sub-steps (each green: headless study + GPU verify)

- **4c-1 — state + steer (CPU).** Add `carryState: Uint8Array` + `homeGood: Uint8Array` to `pools`
  (set in `spawn` from birth-cell scent; swap-removed in `kill`; snapshot bump). steer reads
  `carryState`: `forage` → climb the lacked good's scent (today, P4a/b); `return` → climb the home
  good's scent (homeGood). Headless: confirm a `return`-flagged agent heads home.
- **4c-2 — transitions + delivery (Tier B `caravan.ts`).** forage→return when the agent is *in the
  away region* (home-good scent low) AND *loaded* (away-good store high / deficit satisfied);
  return→forage when *home* (home-good scent high). Delivery = the existing `trade.ts` barter once the
  B-rich carrier is back among B-poor home kin (so no new unload code for 2a). Provisioning gate (P4b)
  still gates *setting out*, not the return (a returner commits).
- **4c-3 — study + tune (headless `caravan.ts` tool).** New metrics: **round-trips/k**, **delivered
  away-good flux into the home region**, society-distinctness (left/right balance + signature
  separation must HOLD — if they blur, it's still migration), pop/breed vs P4b (want net-positive),
  carrier fraction. Tune the load/arrival thresholds. **Falsify:** societies merge (distinctness
  collapses), or carriers oscillate to death (pop drops), or delivery ≈ 0 (→ escalate to cargo 2b).
- **4c-4 — GPU port + verify.** Pack `carryState`+`homeGood` into one `u32`/agent → one storage buffer
  (steer 11→12 bindings → bump device limit to 12). steer.wgsl flips scent target by state. Re-verify
  on the 3090 via the Playwright runner (seed-sweep the steer/chain flake as in P4b).

## Architecture notes
- **New per-agent state** must be: written in `spawn`, swap-copied in `kill` (every new array), and
  added to `snapshot` (v9). `homeGood` derives from birth position so offspring inherit their parent's
  region implicitly.
- **GPU binding pressure** is now the recurring constraint: steer goes 11→12 storage buffers (pack the
  two u8 states into one u32). If a later fork needs cargo on the GPU too, pack aggressively.
- **Tier split:** the transition pass (`caravan.ts`) is **Tier B** (symbolic/stateful — branchy state
  logic, never GPU, per CLAUDE.md rule 4). steer only *reads* the resulting state (Tier A).
- **Testing (already in the toolbox):** headless vite-node studies (`tools/caravan.ts`) for behaviour +
  tuning, Playwright/Chrome on the real 3090 for GPU parity. Both used throughout P4a/b.

## Success = the end goal, finally
A carrier crosses with provisions, loads the far good, returns home, and barters it to kin — so the
home region's *away-good* stock visibly rises from returning carriers, the two societies stay
distinct (no blur), shuttle traffic is watchable across the gap, and pop/breed turns net-positive vs
P4b. Then **P4d** renders the route (trail stigmergy → glowing caravan lines) — the literal picture of
"societies trading over a dead zone."

## Related
- [[petriarch-trade-foundation]] (F2 cargo / F5 carry-return / F6 provisioning; phase plan),
  [[petriarch-headless-and-experiments]] (vite-node study harness), [[petriarch-headless-webgpu-verify]]
  (Playwright/3090 verify + the steer seed-flake), [[petriarch-chrome-devtools-mcp-verify]],
  [[petriarch-adding-a-gene]] (only if Fork ② ends up needing a gene).
- Code anchors: `state/pools.ts` (spawn/kill + new arrays), `sim/init.ts` (set homeGood at seed),
  `sim/tierB/caravan.ts` (NEW transition pass), `sim/tierA/steer.ts` + `gpu/shaders/steer.wgsl.ts`
  (state-gated scent target), `gpu/gpuContext.ts` (packed-state buffer), `sim/tierB/trade.ts`
  (delivery via barter at home), `tools/crossing.ts`→`tools/caravan.ts` (the study), `tools/snapshot.ts`
  (v9).
