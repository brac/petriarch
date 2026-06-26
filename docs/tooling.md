# Petriarch — Tooling Harness

Tuning an evolving system by eye alone is guesswork. This harness turns it into experiment: run fast without rendering, log what the population is *doing* at the generation level, reproduce any surprising run exactly, and fork an interesting moment to A/B different perturbations.

**Ordering note:** the headful sim (Milestone 1) comes first — its success test is *watching* the system. Headless is **not optional**; it's how tuning becomes tractable. It just lands in the tooling pass immediately *after* the headful substrate is watchable. Don't treat headless as the definition of milestone-1 success.

The three tools reinforce each other: **headless + seeded + snapshot** is what makes "did distinct strategies emerge and persist, or did it collapse?" answerable in seconds and reproducibly.

---

## 1. Headless fast-forward + stats

A no-render run mode (`npm run headless`, `tools/headless.ts`) that ticks the sim as fast as the CPU allows and logs population-level stats periodically (per "generation" — e.g. every N ticks, or per mean-lifespan interval).

**Stats to log each interval:**
- Population size; births and deaths since last interval.
- **Lineage count** — cluster agents by signature (distance threshold in tag-space) and count distinct clusters. This is the headline number: *are distinct lineages persisting?*
- Per-gene **mean and variance** across the live population (all 15 genes). Variance collapsing toward zero on a gene = the population converged on that axis (possibly fine, possibly a missing tradeoff). Variance staying high = a real strategy split.
- Optional: dominant strategy fingerprints (e.g. centroid genome of each lineage cluster) so you can name what's coexisting ("fast-greedy" vs "big-territorial").

Output as CSV/JSON lines so you can chart runs (gene variance over time, lineage count over time) without a UI.

**The question it answers:** run headless for many generations across seeds and resource settings — do multiple lineages persist, or does everything converge to one optimum every time? If it always collapses, the genome lacks tension (fix the tradeoffs in `genome.md` before adding features).

**Headful fast-forward is separate:** the sim-speed/tick-rate control in the HUD speeds up the clock *while you watch* (milestone 1). Headless is for runs too long/many to watch.

---

## 2. Seeded reproducibility

Everything random flows through one `mulberry32` instance (`core/rng.ts`) — mutation, spawn jitter, conflict rolls, wander. A run is fully determined by `(seed, initial conditions, dev params, the sequence of god-perturbations)`. So:
- A surprising outcome ("this seed produced three stable lineages") is reproducible — re-run the seed, watch it happen again.
- Debugging "why did this lineage win" is tractable because the run is deterministic.
- Headless statistical sweeps are meaningful (vary one param, hold the seed, compare).

**Caveat for the GPU phase:** GPU float and atomic-ordering differences mean the WebGPU path won't be bit-identical to CPU. Treat the CPU path as the **golden reference** for determinism/debugging; the GPU path is seeded-but-its-own-domain. (Noted in `webgpu-migration.md`.)

Expose the seed in the dev panel; allow entering a seed to replay.

---

## 3. Snapshot / restore

Serialize the **entire** world state — all SoA pools (positions, velocities, energy, age, full genome buffer, active set), the resource field, the RNG state, the tick count, and dev params — to a blob, and restore it exactly.

Uses:
- **Fork an interesting moment.** Hit an emergent frontier war or a speciation event, snapshot, then try different god-perturbations from the identical starting point to compare outcomes (A/B the same world).
- **Regression fixtures.** Save worlds that previously broke or collapsed; restore them after a change to confirm the fix.
- **Long-run checkpoints.** Resume a long evolutionary run without re-simulating from t=0.

Because RNG state is part of the snapshot, a restore + same actions reproduces exactly (CPU path).

---

## Dev panel (where these surface in the UI)

`views/devPanel.ts`, alongside the milestone-1 controls:
- **Intensity slider** (population × think-interval × neighbor budget).
- **Sim-speed / tick-rate** (headful fast-forward).
- **Seed** field (view current, enter to replay).
- **Base mutation scale** slider.
- **Resource regrowth rate** + **distribution** (clumped ↔ scattered) — the map-selects-strategy lever.
- **Snapshot / Restore** buttons (download/upload the world blob).
- **Run headless** trigger (or note that it's a CLI run via `npm run headless`).
- Live readout: population, lineage count, per-gene variance sparkline (cheap, optional).

These are dev-facing; the player-facing god tools (bloom, hazard, smite) are separate (`sim/tierB/god.ts`, surfaced in the main HUD).

---

## Build sequencing for tooling

1. Milestone 1 headful substrate is watchable (see `simulation-systems.md`).
2. Add seeded-run plumbing if not already (RNG state exposure, seed replay) — small, since `mulberry32` is already the only source.
3. Add headless run mode + stats logging.
4. Add snapshot/restore.
5. Use all three to tune the genome tradeoffs until distinct lineages reliably persist across seeds/maps — *then* move to the WebGPU port and Milestone 2.
