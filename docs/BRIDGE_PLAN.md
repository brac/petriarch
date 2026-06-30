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
  hardens to `roadCost`, **but only if ≤ `maxRoadNeighbors` of its 8 neighbours are already road** (the
  anti-clump — keeps a road ~1 cell wide instead of paving the gap solid; with a row-major scan the row
  below a fresh road is blocked → roads run along the horizontal crossing). Permanent (passability never
  decays) = "a permanent structure." Skips ocean + existing road. Runs after `stigmergy` (trail current),
  before `integrate` reads passability — both tick paths.
- `views/netRenderer.ts` — `drawBridge`: gold lane on every road cell (the trail thickening into a paved
  road). `views/devPanel.ts` — Bridge group (setThreshold / roadCost / maxRoadNbr / renderAlpha), live.
- Snapshot: passability is already serialized (v10) → roads persist free.

**Validated** (`tools/bridgecheck.ts`, OFF vs ON, 2 seeds × 8k): deliv/k **38 → 55 (+45%)**, trade **1224
→ 1732 (+41%)**, pop steady, roadCells ~886. (Full-plaza, no anti-clump: deliv/k 76 but it paves the whole
gap.) Headful-verified on the 3090 (Playwright screenshot): a gold road lattice across the dead zone
linking two distinctly-hued societies.

## Deferred polish (not MVP)

- **Crispness:** `maxRoadNeighbors 1` (pure single-cell lines) vs 2 (branching lattice) — live-tunable;
  pick by taste. Roads still slowly widen over very long runs (permanent + edge growth).
- **Explicit "less food on the road":** a metabolism move-drain discount on road cells. Probably
  unneeded — faster already cuts total starvation. Would need a GPU metab read + verify.
- **Active "steer toward the bridge":** a Tier-A steer attractor toward roads (+ GPU port + verify) so
  agents actively converge on the lane rather than benefiting passively. A full sub-phase.
- **Road decay-if-unused:** so abandoned routes fade instead of littering the map (trades off the
  "permanent structure" framing).

## Related
- `data/passability.ts` (the road substrate), `sim/tierA/integrate.ts` (the cost<1 speed-up, CPU+GPU),
  `sim/tierB/stigmergy.ts` (trail deposit), [[petriarch-trade-foundation]], docs/P4C_PLAN.md (P4c/P4d).
