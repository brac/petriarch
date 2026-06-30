# Petriarch — Trade Phase 4c: the round trip (carriers, not migrants)

## STATUS (WIP — paused mid-tuning) — what's next
**CPU machinery BUILT + typechecks** (committed): `carryState`/`homeGood` in pools (spawn/kill/snapshot
**v9**), `data/caravan.ts`, the Tier-B `caravan.ts` 3-state machine (FORAGE→OUTBOUND→RETURN), steer
reads state to pick the scent target, breed-only-at-home gate in reproduce, wired into step + both
gpuSim paths. **NOT yet working:** carriers don't complete round trips — the headless study shows
`carry%`(return) ≈ 0: agents commit to OUTBOUND but **die mid-gap before loading in region B**, because
two foodless crossings on energy-as-cargo is too costly when they commit under-provisioned (commitFrac
0.7 ⇒ home-good 70% but total reserve ~35%).

**Key finding already banked:** a *continuous* provisioning gate (P4b) can't produce committed travel
(agents dip toward the gap, the gate cuts the pull as they deplete, they retreat — first 2-state study
was fully inert: home% 100%, carry% 0). That's why the OUTBOUND committed state exists. See
[[petriarch-longrange-fields]].

**NEXT (resume here):**
1. **Finish the commitFrac sweep** (the run was killed): does `commit0.95` (set off only when nearly
   full on the home good) let round trips COMPLETE (carry% > 0)? `tools/crossing.ts` is already the
   sweep (commit-OFF / 0.7 / 0.85 / 0.95, with the new `out%` OUTBOUND metric). Quick to re-run
   headless. If carry% climbs with commitFrac → P4c-v1 viable, just tune; bake commitFrac + loadFrac.
2. **If energy-cargo round trips stay infeasible even at 0.95** (two crossings cost > a full store) →
   escalate to **Fork ② = dedicated non-consumed cargo store**: the agent carries cargo metabolism
   can't burn, so it only needs survival-fuel for ITSELF and delivers the goods intact. Or cheaper
   crossing (a caravan in-transit metabolic discount / narrower gap).
3. **Fix the distinctness metric:** `home%` is flawed — `homeGood` is set at BIRTH, so a migrant's
   offspring re-home to the new region and home% reads ~100% regardless. Use signature-separation
   between regions (or track lineage origin) to actually detect society-blurring.
4. **GPU port (4c-4) is NOT started** — deferred until the CPU behaviour is validated (mirrors
   P4a-cpu→P4a-gpu). When done: pack `carryState`+`homeGood` into one u32 → steer binding 11→12, bump
   the device limit, state-branch the scent target in steer.wgsl, Playwright-verify (seed-sweep the
   flake). See [[petriarch-adding-a-gpu-field]].

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
