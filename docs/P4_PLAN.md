# Petriarch — Trade Phase 4: long-distance trade (carriers across the dead zone)

> **The end goal (brac's, stated at the start of the trade arc):** *societies trading over a
> DISTANCE — across a desert/ocean where no life lives in between.* This is what the whole trade
> foundation was built toward. P1 made the two goods; P2 made barter; P3 made the tension + local
> cooling. P4 is where trade **flourishes** — goods physically crossing the gap, a route emerging.

## The blocker, literally

The deficit-seeking steer (`sim/tierA/steer.ts`) reads only the **4 neighbour cells** of the
resource grid. Inside a region's edge that's enough to climb toward the other nutrient. But across
the **barren gap** there is no nutrient within a cell's reach, so the gradient is **zero out there** —
a B-starved agent in region A literally has no signal pointing toward region B. Trade stays pinned to
the thin frontier where the two societies already touch (exactly the partner-scarcity the P2 study
found). P4 gives agents a long-range **reason** and a survivable **way** to cross, carry, and route.

## The architectural cost (read before starting)

**P4 is the first Tier A / GPU change since the WebGPU port.** Steer reading new fields = **WGSL
kernel edits + GPU re-verify** (see [[petriarch-adding-a-gene]], [[petriarch-chrome-devtools-mcp-verify]]) —
unlike P3, which was entirely Tier B / CPU. It also adds **per-agent state** (a carry-state int + a
non-consumed cargo store) → pools + snapshot bump. This is the most invasive phase since the port;
budget for the GPU round-trip on every sub-phase that touches steer. The cognition mask-bank
(`COG.FOOD…DANGER`, `data/cognition.ts`) is the documented extension point — new steer terms append
as `COG.DEMAND`/`COG.TRAIL` bits, gene-weighted × level, and a cleared bit must **skip the sample**
(the Knob-B perf contract).

## Scope boundary

- **Desert crossing only.** The gap is barren-but-**passable** (default passability 1; confirmed in
  `init.ts` — the inter-region gap is a food desert, not painted ocean). F1–F6 reach a desert.
  **Ocean (impassable) is out of scope** — it needs a later port/boat/corridor abstraction.
- **The carry-cycle is authored; the ROUTE emerges.** Per `docs/PETRIARCH FEATURE cognition.md`, the
  forage/return state machine is "the one genuinely new mechanism" and is allowed to be authored (this
  IS the authored social layer). But the trade *route* self-organizes via trail reinforcement — not
  drawn. No per-agent brains: state is one int + field reads + genes (CLAUDE.md intelligence-locus).
- **Round-trip, not migration.** A carrier must come HOME. If agents merely cross and settle on the
  far side, the two societies blur into one — that's colonization, the *opposite* of "two societies
  trading." The return leg (P4c) is what keeps the societies distinct while connecting them, so it's
  **essential to the goal, not optional.**

---

## Sub-phases (each ships green: typecheck + GPU verify + headless study)

### P4a — the long-range REACH — ✅ DONE (CPU + GPU verified)
**Built + studied (crossing.ts).** Steer gains a `COG.DEMAND` term that climbs a long-range supply
field weighted by per-nutrient deficit, so a B-deficient agent is pulled across the gap toward the
B-region — the reach the local 4-neighbour food gradient can't provide.
**KEY PIVOT (DECISION ① reversed): demand → supply-scent.** A deposit-deficit "where it's wanted"
field FAILED — with regions eaten to scarcity, agents are hungry on both nutrients, so demand tracked
POPULATION DENSITY and peaked inside each region; climbing it herded agents toward their own centre
(gap% went *down*). A spatial probe proved it. Fix = geography-anchored **supply scent**: a static
smooth CONE peaking at each nutrient's region anchor (built once in `init.ts buildScent`, rebuilt on
restore). Diffusing the capacity field was tried first and rejected — diffusion decays the far signal
to noise + edge artifacts, never monotonic across a 20-cell gap; the analytic cone is monotonic from
anywhere. Climb scentX weighted by DEFICIT of X (the long-range twin of the local food term).
**Result (crossing.ts, 3 seeds × 8k, weight 0.6 = the sweet spot):** gap traffic 1.2%→1.9%, trade
+31% (874→1145/k), imbalance 0.083→0.070, left/right balance held (44.5/53.6). At weight 1.0 region A
starts emptying (migration, not trade) → 0.6 is the cap. **Honest cost:** pop −12%, breed-readiness
−13pts — crossing the foodless gap is *unprovisioned*, so it costs energy/lives. **This proves P4a and
P4b are coupled: the reach works but pays a survival tax until provisioning (P4b) makes the crossing
cheap.** Snapshot v8 (+scentA/B), determinism verified. **GPU PORTED + VERIFIED** (P4a-gpu): the scent term is
in steer.wgsl, scentA+B packed into one storage buffer at binding 11, device limit bumped 10→11,
scentWeight in steer param slot 11, uploaded each tick (static, mirrors passability). Re-verified on
the real 3090 (nvidia ampere) via the headless Playwright runner: **steer 0 mismatches** (worstAbs
0.0018) with the default mask (incl. DEMAND) → the scent path matches the CPU golden reference;
hash/sense/integrate/chain all green.
*(original P4a scope below, for reference)*

### P4a (original scope) — the long-range demand field
A per-nutrient **demand** stigmergy field (same grid as resources/danger/amity, CPU/Tier B
deposit+diffuse+decay). Agents deposit their per-nutrient **deficit** into their cell each tick; it
diffuses **widely** (high diffusion / slow decay) so the signal **reaches across the gap** and fades
over distance — the passability doc's "claim the beach, reach across a narrow strait, die over a wide
ocean," tuned by the decay constant. Steer gains a `COG.DEMAND` term: climb the demand gradient for
the nutrient you're short on (later: the nutrient you CARRY). GPU: add `demandA/demandB` as steer
storage bindings, port the gradient read to WGSL, re-verify.
- **Success:** B-starved A-agents now steer across the gap toward region B (today they cannot) →
  first sustained cross-gap traffic, measured headless (cross-gap flux > 0, was ~0).
- **OPEN DECISION ①:** demand = "where the good is **WANTED**" (deficit broadcast — a carrier climbs
  the demand for what it holds → heads to the society that lacks it) vs "where the good **IS**"
  (availability). **Recommend deficit-broadcast** — emergent, symmetric, and it's what directs a
  *carrier* (P4c) rather than just a hungry forager.
- **OPEN DECISION ②:** new `DEMAND` gene, or reuse `RESOURCE_ATTRACT`? Recommend **reuse
  RESOURCE_ATTRACT × level** at first (no gene-add, no GENE_COUNT churn) — split into its own gene
  only if selection needs to separate "local forager" from "long-haul carrier."

### P4b — provisioning (SURVIVE the crossing)
Crossing the barren gap drains both stores with no intake; survival = the sum (`death.ts`). Make a
crossing **survivable-but-costly** (tradeoff invariant — a crossing must have a real death risk).
Levers, cheapest first: (a) **emergent only** — agents that hoard before crossing make it; tune gap
width / drain so *some* survive; (b) a small in-transit metabolic discount when moving fast & directed
(a "caravan" efficiency); (c) a provisioning gene (carry a reserve). **Recommend (a) + tune**, adding
(b)/(c) only if crossings essentially never succeed.
- **Success:** a meaningful fraction of crossers arrive alive — the gap is a *filter*, not a wall;
  crossing deaths are a visible cost, not zero and not total.

### P4c — carry/return state machine + cargo (the ROUND TRIP = real trade)
Per-agent integer **state** (`forage`/`return`) + a **non-consumed cargo store** (the piece P2
explicitly deferred to P4). Forage = seek your deficit (today). On taking on surplus/cargo at the far
region → flip to **return**: head **home** (up your own claim-field gradient — long-range via its
diffusion) carrying the good, cargo NOT metabolized en route. At home: deposit/trade the cargo, flip
to forage. State int lives in `pools`; transitions in a Tier B pass; steer reads state to choose the
gradient (forage→demand, return→home). Snapshot/version bump for the new fields.
- **Success:** region A's B-stock rises from returning carriers **without A's population emigrating** —
  goods move both ways, societies stay put = trade over distance, not merger.
- **OPEN DECISION ③:** "home" = claim-field gradient (recommended — exists, long-range) vs sensed
  kin-centroid (short-range) vs birth-cell (needs stored origin). Claim gradient is the cheapest
  long-range "home" signal and reuses an existing field.

### P4d — trail reinforcement + the caravan visual (the ROUTE emerges + is SEEN)
A **trail** stigmergy field carriers deposit on; steer reads it (`COG.TRAIL`) so a used route
self-reinforces (reinforce-on-use / decay-on-disuse — the colony learning a path). Render the trail as
glowing **caravan lines** across the gap — the cyber-net trade-mesh over *distance*, the visual payoff.
- **Success:** a persistent, visible trade route across the dead zone that concentrates traffic; paint
  an ocean across it and watch it reroute or die (the god-tool interaction).

---

## Where the payoff lands
P3's TRADE selection was real but **gentle** (0.45→0.49) — by design, because local barter is
partner-limited. P4 is the mechanism that was always meant to pay it off: carriers bring complementary
partners together across the gap, so trade should finally **select hard** and a cross-gap economy
appears. If P4 lands and TRADE *still* doesn't select up, that's the signal the two-good model itself
needs richer demand (a both-nutrients-to-breed pressure is already there; a consumption pressure could
be added) — but that's a contingency, not the plan.

## Recommended starting point
**Start with P4a (the demand field).** It's the keystone — nothing downstream works without the
long-range reach — *and* it's the smallest self-contained Tier-A/GPU change, so it de-risks the
GPU re-entry before the heavier state-machine work in P4c. It alone produces the first visible
cross-gap traffic: a concrete, watchable proof before committing to the full caravan system.

## Honest sizing
This is a **multi-session** phase — four sub-phases, three of which touch the GPU kernels + re-verify,
plus new per-agent state and a snapshot bump. It's the biggest single phase since the WebGPU port.
The four sub-phases are independently shippable and watchable, so we land and watch each before the
next (build-then-observe).

## Related
- Memory: [[petriarch-trade-foundation]] (the F0–F6 foundation + this phase plan), [[petriarch-adding-a-gene]]
  (if DECISION ② adds a DEMAND gene — the full kernel checklist), [[petriarch-chrome-devtools-mcp-verify]]
  (headful GPU re-verify on the 3090), [[petriarch-gpu-god-tools-race]] (CPU-field-to-GPU upload
  ordering — relevant when steer reads new CPU-source fields), [[intensity-is-perf-not-visual]] (don't
  gate the caravan trail render on the intensity slider).
- Docs: `PETRIARCH FEATURE cognition.md` (forage/return SM = the prerequisite, the toggle-bank
  contract), `PETRIARCH_FEATURE_passability.md` (the diffusion decay-constant = the "reach across the
  gap" lever), `simulation-systems.md` (Tier map), `webgpu-migration.md` (the buffer contract the
  steer kernel edits must keep).
- Code anchors: `sim/tierA/steer.ts` + `gpu/shaders/steer.wgsl.ts` (the demand/trail/state reads),
  `sim/tierB/stigmergy.ts` (+ demand/trail field evolution), `data/cognition.ts` (`COG` mask bits),
  `state/pools.ts` (carry-state int + cargo store), `sim/init.ts` (the barren-gap worldgen),
  `tools/snapshot.ts` (version bump), `views/netRenderer.ts` (the caravan trail render).
