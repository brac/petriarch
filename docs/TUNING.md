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
| **Movement amount** | `baseMaxSpeed`, `steerAccel`, `wallBounce` | `src/data/sim.ts` | 95, 6, 0.5 |
| **Food available** | `cellCapacity`, `clumping`, `clumpCount`, `startFrac` | `src/data/resources.ts` | 20, 0.7, 14, 0.6 |
| **Regrowth rate** | `regrowthRate` | `src/data/resources.ts` | 0.06 |
| **Intake rate** | `intakeRate` | `src/data/costs.ts` | 1.1 |
| **Metabolic costs** | `baseDrain`, `sizeDrain`, `moveCost`, `senescenceDrain` | `src/data/costs.ts` | 0.04, 0.05, 0.0009, 0.25 |
| **Mutation scale** | `baseMutationScale`, `mutabilityFloor` | `src/data/sim.ts` | 0.08, 0.05 |
| **Reproduction** | `reproInvestFrac`, `birthJitter` | `src/data/sim.ts` | 0.7, 14 |
| **Conflict** | `range`, `aggressionThreshold`, `loserDamage`, `cooldownTicks`, `contestResourceMin` | `src/data/conflict.ts` | 30, 0.45, 6, 18, 4 |
| **Sensing** | `senseRadius`, `separationRadius`, `sigThreshold` | `src/data/sim.ts` | 60, 26, 0.22 |
| **God radii/strength** | `bloom*`, `hazard*`, `smite*` | `src/data/resources.ts` | — |
| **Population / seeding** | `initialPop`, `founderTribes`, `MAX_AGENTS` | `src/data/sim.ts`, `capacity.ts` | 700, 8, 5000 |

Also wire the standard dev controls noted in CLAUDE.md: seed entry, snapshot/restore,
pause, and the headless trigger.

---

## B. Balance goals (ongoing tuning, from headless + headful observation)

1. **Make scarcity — not the population cap — the binding constraint.** Population
   currently pins at `MAX_AGENTS`/`activeCount` because food outpaces death. Lower
   `regrowthRate` / `cellCapacity` or raise `COSTS` so the equilibrium sits below the
   cap and famines actually sweep. This is what turns selection on.
2. **Give SIZE a real tradeoff.** It drifts toward its floor (~0.4) because small
   cheap bodies breed fastest and big bodies rarely cash in their fight advantage. A
   gene pinned at one end is a "bug by definition" (CLAUDE.md). Fix by making food
   scarce (so contests decide survival) and/or raising `CONFLICT.loserDamage`.
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

---

## D. Renderer cost follow-ups (CLAUDE.md discipline; do before/with GPU pass)

- Kin-edge mesh uses `Graphics.clear()` + redraw each frame (not zero-alloc). Move to
  a reused vertex/line buffer per the rendering spec.
- Resource glow + node + spark layers are already pooled ParticleContainers (good).
