# Petriarch — Bridge / road (the construction tier)

> The first **construction** layer. Carriers crossing the deadly gap leave behind a permanent
> STRUCTURE — a road — that makes the crossing survivable, so trade flourishes. This is the
> pressure-release valve on the tension P4c created (the crossing is individually lethal: most carriers
> starve mid-gap). It's the construction tier the `passability` field was always reserved for.

## The problem (measured)

P4c made the round trip *work* and net-positive in aggregate, but the individual crossing stays deadly:
~34% of the population commits OUTBOUND, but only ~38/k actually reach the far side and load — **most
carriers starve in the foodless gap before crossing.** Watching it, you see a stream of deaths in transit.

## The mechanic (brac's)

Traders building the route leave material that hardens into a **road** — a low-passability lane the
`integrate` pass already reads as "faster" (cost < 1 → step ×1/cost, CPU **and** GPU). A faster crossing =
fewer ticks starving in the foodless gap = **survivable**. Roads form from both societies' carriers (the
scent cones funnel both into the same corridor) and meet in the middle. Once a road exists it's safer than
crossing solo, so traffic concentrates on it (passively — the scent already funnels them there).

Reuses two existing systems wholesale, so there is **no new GPU kernel**:
- **`trail`** (P4d) — committed carriers already deposit it, concentrated in the barren gap. The road's
  precursor: where trail accumulates, carriers have worn a path.
- **`passability`** — the movement-cost field integrate already reads every tick (CPU + GPU). A road is
  just a cell with cost < 1. CPU-source field, uploaded each tick → GPU reads it, no readback race.

## MVP (DONE)

- `data/bridge.ts` — `setThreshold` (trail magnitude that hardens a cell), `roadCost` (0.4 = 2.5× faster),
  `maxRoadNeighbors` (anti-clump), render tint/alpha.
- `sim/tierB/bridge.ts` (Tier B, CPU) — row-major scan: a normal-ground cell with `trail ≥ setThreshold`
  hardens to `roadCost`, with a **VERTICAL-exclusion anti-clump** for straight, spaced roads (not a
  checker): a cell hardens only if no OTHER road lies within `roadSpacing` rows in its own COLUMN. Roads
  within `roadWidth` rows are this road's body (a lane that many cells thick); a road farther but within
  `roadSpacing` is a separate road too close → blocked. Horizontal neighbours are never checked, so a road
  extends freely along the crossing → straight horizontal lanes, `roadWidth` cells thick, kept
  ≥ `roadSpacing`+1 apart. Permanent (passability never decays) = "a permanent structure." Skips ocean +
  existing road. Runs after `stigmergy` (trail current), before `integrate` reads passability — both paths.
- `views/netRenderer.ts` — `drawBridge`: gold lane on every road cell (the trail thickening into a paved
  road). `views/devPanel.ts` — Bridge group (setThreshold / roadCost / roadSpacing / roadWidth /
  renderAlpha), live.
- Snapshot: passability is already serialized (v10) → roads persist free.

**Validated** (`tools/bridgecheck.ts`, OFF vs ON, 2 seeds × 8k). The anti-clump trades raw throughput for
a clean road shape — the sparser the roads, the fewer carriers ride them at once:
- full plaza (no anti-clump): deliv/k 76 (+100%), roadCells 1663 — but paves the whole gap solid.
- 8-neighbour ≤2 (lattice): deliv/k 55 (+45%), roadCells 886 — branchy checker.
- **vertical-exclusion spacing 4 / width 2 (current): deliv/k 49 (+29%), trade +30%, roadCells 542** —
  straight 2-wide horizontal lanes, no checker. Headful-verified on the 3090 (Playwright screenshot).

## Active road-steering (DONE) — "all agents use the bridge"

Passive roads only help carriers already on a lane. Active steering converges committed carriers ONTO the
nearest lane: a `roadAttract` field (`state/world.ts`) is deposited at road cells + widely diffused
(`bridge.ts`, attractDiffuse 0.28) into a smooth basin peaking on the lanes; committed carriers in steer
climb its gradient (`sim/tierA/steer.ts`), and the supply-scent then carries them ALONG the lane (on the
lane the basin is ~flat, so it doesn't stall the crossing).

**KEY FINDING — inverted-U on `attractPull` (`tools/bridgecheck.ts` sweep):** deliv/k OFF 38 → passive 49
→ **pull 0.5 = 70** → pull 1.3 = 47. A STRONG pull makes carriers detour/zigzag across the lane (a
sideways diversion that costs more than the road saves) — WORSE than passive. A GENTLE pull (baked **0.5**)
nudges nearby carriers onto the lane without diverting → deliv/k 70, nearly the full-plaza's 76 but with
clean spaced roads. +84% completed round trips over no-bridge. Visible headful (3090 screenshot): bright
continuous horizontal gold highways with carriers flowing along them (traffic reinforces the lanes →
they grow). GPU-verified: packed `roadAttract` into the scent buffer's 3rd slice (no new binding), steer
reads it in the committed branch; steer.ok + chain.ok across 5 seeds ×2 runs (worst steer 0.01 < 2e-2,
chain 0.076 < 1e-1 — same flake band P4c-4 already calibrated). Dev-panel `roadPull` slider (0 = passive).

## Deferred polish (not MVP)

- **Explicit "less food on the road":** a metabolism move-drain discount on road cells. Probably
  unneeded — faster already cuts total starvation. Would need a GPU metab read + verify.
- **Road decay-if-unused:** so abandoned routes fade instead of littering the map (trades off the
  "permanent structure" framing).

## Related
- `data/passability.ts` (the road substrate), `sim/tierA/integrate.ts` (the cost<1 speed-up, CPU+GPU),
  `sim/tierB/stigmergy.ts` (trail deposit), [[petriarch-trade-foundation]], docs/P4C_PLAN.md (P4c/P4d).
