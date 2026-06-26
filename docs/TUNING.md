# Petriarch — Tuning & Polish Notes

A living list of values to tune and design/UX items to address, captured while
watching Milestone 1 run headful. **Numbers in `src/data/*` are first-pass.** The
two levers that matter most (docs/genome.md): base mutation scale, and resource
regrowth + distribution.

The natural home for the *controls* is the **Tooling pass** (`src/views/devPanel.ts`
— currently a stub): expose these as live dev sliders so tuning becomes experiment,
not edit-refresh. Until then, edit the data file and refresh.

---

## A. Values to expose as dev sliders (Tooling pass)

| Lever | Constant(s) | File | Current |
|---|---|---|---|
| **Movement amount** | `baseMaxSpeed`, `steerAccel`, `wallBounce`, `sizeSpeedFactor` | `src/data/sim.ts` | 95, 6, 0.5, 0.3 |
| **Food available** | `cellCapacity`, `clumping`, `clumpCount`, `startFrac` | `src/data/resources.ts` | 14, 0.7, 14, 0.35 |
| **Regrowth rate** | `regrowthRate` | `src/data/resources.ts` | 0.045 |
| **Intake rate** | `intakeRate`, `intakeSizeExp` | `src/data/costs.ts` | 1.1, 1.0 |
| **Metabolic costs** | `baseDrain` (flat), `sizeDrain`, `moveCost`, `senescenceDrain` | `src/data/costs.ts` | 0.05, 0.05, 0.0009, 0.25 |
| **Mutation scale** | `baseMutationScale`, `mutabilityFloor` | `src/data/sim.ts` | 0.08, 0.05 |
| **Reproduction** | `reproInvestFrac`, `birthJitter` | `src/data/sim.ts` | 0.7, 14 |
| **Conflict** | `range`, `aggressionThreshold`, `loserDamage`, `stealFrac`, `cooldownTicks`, `contestResourceMin` | `src/data/conflict.ts` | 45, 0.45, 10, 0.8, 18, 2 |
| **Sensing** | `senseRadius`, `separationRadius`, `sigThreshold` | `src/data/sim.ts` | 60, 26, 0.22 |
| **God radii/strength** | `bloom*`, `hazard*`, `smite*` | `src/data/resources.ts` | — |
| **Population / seeding** | `initialPop`, `founderTribes`, `MAX_AGENTS` | `src/data/sim.ts`, `capacity.ts` | 700, 8, 5000 |

Also wire the standard dev controls noted in CLAUDE.md: seed entry, snapshot/restore,
pause, and the headless trigger.

---

## B. Balance goals (ongoing tuning, from headless + headful observation)

1. ~~**Make scarcity — not the population cap — the binding constraint.**~~ DONE.
   Two changes: (a) `baseDrain` is now a **flat** cost not scaled by METABOLIC_RATE
   (`metabolism.ts`), so evolution can't drive drain → 0 and push carrying capacity
   past the cap; (b) lowered food supply (`regrowthRate` 0.06→0.045, `cellCapacity`
   20→14, `startFrac` 0.6→0.35 to kill the initial boom). Result: equilibrates
   ~2000-2400 at full intensity (cap 5000), food-bound at every intensity (≈2348 at
   55%), with mild famine/regrowth oscillation. Side effect: METABOLIC_RATE regained
   its tradeoff (rises under scarcity — you must move to find patchy food). Tuned
   empirically via a headless sweep across seeds.
2. ~~**Give SIZE a real tradeoff.**~~ DONE. SIZE floored because big bodies (a) bred
   far slower yet ate at a flat rate, (b) were crippled by the size→speed penalty so
   they foraged badly, and (c) gained nothing from winning fights. Three changes:
   - **Predation spoils** — the fight winner robs `stealFrac` (0.8) of the loser's
     lost energy (`conflict.ts`). Winning now pays → a predator strategy exists.
   - **Size-scaled intake** — `intakeSizeExp` (1.0): bigger mouths harvest faster
     (`metabolism.ts`), so big bodies can accumulate energy to breed.
   - **Softer size→speed penalty** — `sizeSpeedFactor` 0.6→0.3 (`integrate.ts`), so
     big bodies still forage in a patchy world.
   - Plus more frequent contests (`range` 30→45, `contestResourceMin` 4→2).
   Result: frequency-dependent coexistence — SIZE variance sd 0.16–0.34, a viable
   big-predator niche (2–18% big depending on seed), population still food-bound.
3. **Watch mutability** — it correctly trends toward the floor in a stable world; if
   you start perturbing heavily it should rise. Good signal to validate after god
   tools get used a lot.

---

## C. Design / UX items (brac flagged while watching)

1. ~~**Kin-edge visibility is wrongly tied to intensity.**~~ DONE — decoupled from
   the intensity perf knob; edges now always draw, capped at `EDGE_MAX` with `EDGE_K`
   per agent. Future option: give them their own density slider/toggle in the dev
   panel. `src/views/netRenderer.ts` (`EDGE_*`).
2. **Spark design** — iterate the conflict-spark look (now an expanding white-hot
   ring). Refine shape/color/lifetime. `src/views/netRenderer.ts` (`SPARK_*`).
3. **Conflict frequency reads low once tribes segregate** — sparks fall off as tribes
   form territories (emergent, not a bug). Consider a subtle persistent "frontier"
   highlight so a cold border still reads, not just live sparks.
4. **Intensity mildly affects evolution, not just perf.** `conflict` runs at the
   think cadence (a CPU win), so at low intensity (higher `THINK_INTERVAL`) contests
   resolve less often → weaker predation selection → less SIZE diversity (e.g. ~0%
   big at 55% vs 2–18% at full). Acceptable tradeoff for now; future options: run
   conflict every tick again (costs the extra broadphase), or scale its rolls by the
   think interval so per-tick conflict pressure is intensity-invariant.

---

## D. Renderer cost follow-ups (CLAUDE.md discipline; do before/with GPU pass)

- Kin-edge mesh uses `Graphics.clear()` + redraw each frame (not zero-alloc). Move to
  a reused vertex/line buffer per the rendering spec.
- Resource glow + node + spark layers are already pooled ParticleContainers (good).
