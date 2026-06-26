# Petriarch — Simulation Systems & Authoring Order

This doc covers the systems that make the world run, the **order** to build them in (and why that order), and the cyber-net **rendering spec**. Read `CLAUDE.md` for the architectural rules these systems must obey, and `genome.md` for the genes they read.

The guiding principle for ordering: **build the substrate that genuinely evolves first; layer authored systems on top one at a time; and author conflict before any cooperation, because cooperation is only interesting as relief from a tension the player can already see.**

---

## Tier map (which systems go to GPU)

- **Tier A (GPU-portable, buffer-contract passes):** `sense`, `steer`, `integrate`, `metabolism`.
- **Tier B (CPU, symbolic/stateful):** `reproduce`, `death`, `conflict`, `resources`, `god`, lineage stats.

Per-tick order within a sim step:
1. `resources` (Tier B) — deplete/regrow the field.
2. `sense` (Tier A) — gather neighbors via spatial hash (every `THINK_INTERVAL` ticks).
3. `steer` (Tier A) — genome → steering vector (every `THINK_INTERVAL` ticks; cached otherwise).
4. `integrate` (Tier A) — apply steering, move, write positions (every tick).
5. `metabolism` (Tier A) — energy drain + resource intake (every tick).
6. `conflict` (Tier B) — resolve contests at contested resource sites.
7. `reproduce` (Tier B) — energy-threshold births into freed slots, mutated.
8. `death` (Tier B) — energy ≤ 0 or senescence → swap-remove.
9. rebuild spatial hash for next tick.

Thinking (2–3) is decoupled from acting (4) via `THINK_INTERVAL`, same accumulator idea swarmr uses for logic/render.

---

## Milestone 1 — the headful substrate (the whole project's proof)

**Goal:** *you watch a population evolve visibly distinct behavioral strategies that cluster into rival groups, and your god-perturbations visibly change outcomes.* If this is interesting to watch, the project is alive. If it's boring, you found out in weeks, not months.

Built in milestone 1:

### Pools & world state
SoA typed-array pools at `MAX_AGENTS` (5000, one constant). Per-agent arrays: position x/y, velocity x/y, energy, age, steering x/y (cached between thinks), alive-flag (or packed active set `[0,count)`), plus the genome buffer (`GENE_COUNT` floats per agent). Free-slot stack for O(1) birth; swap-remove for O(1) death.

### Resource field
A lightweight grid of resource sites that deplete when consumed and regrow over time. Regrowth rate and spatial distribution are tunable (dev sliders) — clumped vs scattered is the single biggest lever on which strategies win. This is the entire selection pressure: no fitness function, just "is there food here, can you hold it, can you breed before you starve."

### Metabolism (Tier A)
Energy drains per tick (scaled by `SIZE`, `METABOLIC_RATE`, movement, senescence past `LIFESPAN`). Energy gained from standing on/consuming a resource site (scaled later by future `EFFICIENCY`). Energy ≤ 0 → flagged for death.

### Steering-from-genes (Tier A)
The core behavior pass. For each agent (every `THINK_INTERVAL`): gather neighbors via spatial hash, compute weighted steering from `KIN_COHESION` (toward signature-similar neighbors), `SEPARATION`, `RESOURCE_ATTRACT`, `THREAT_AVOID`, `WANDER`. Output one steering vector to the steering buffer; `integrate` consumes it. **This is the pass whose WGSL port matters most — keep it strictly buffer-contract.**

### Reproduction & death (Tier B)
Energy ≥ `REPRO_THRESHOLD` → spend energy, emit `FERTILITY` offspring into freed slots, each genome = parent + mutation scaled by parent `MUTABILITY` (see `genome.md`). Death on starvation or senescence via swap-remove. Offspring inherit a mutated signature → speciation over generations.

### Conflict (Tier B) — *in milestone 1, and the reason it's watchable*
When a dissimilar pair (signature distance over threshold) contests the same resource site and at least one has high `AGGRESSION`, they fight: contact-damage resolution (reuse swarmr's contact-damage pattern), strength scaled by `SIZE`. Outcome: energy loss / death to the loser.

Why conflict is in milestone 1 and not deferred:
- **Without it, borders are mush.** Dissimilar clusters interpenetrate into colour soup; you can't *see* territories. With it, clusters get hard edges, frontiers form, and the cyber-net skin reads as rival meshes grinding at a seam.
- **It's the cheapest system** — you already have contact damage from swarmr.
- **It creates the tension every later cooperative system relieves.** Trade/treaties are pointless in a world with no conflict; build conflict first so cooperation is *earned*.

### God toolkit (Tier B) — perturbation, never control
- **Resource bloom** — drop a resource-rich zone; watch clusters race for it.
- **Hazard / famine zone** — drop a zone that drains energy or kills; watch a lineage get culled or driven to migrate.
- **Smite** — remove individual(s) in an area.

No direct agent control. The player is a god who changes the *world*, and the population responds. The success test is partly "does the system respond to perturbation in legible ways" — blooms pull, hazards repel/cull, smites thin.

### Controls built in milestone 1
- **Intensity slider** — population × `THINK_INTERVAL` × neighbor budget (perf + design knob; see CLAUDE.md rule 8).
- **Sim-speed / tick-rate control** — speed up the clock while watching (headful fast-forward). Distinct from intensity.

### Milestone-1 success (headful, watchable)
You run it, you watch, and you see: distinct strategies emerge and persist; clusters form along signature lines and hold territory; frontiers where dissimilar clusters fight; colour drift as lineages speciate; and your perturbations visibly reshaping the outcome. **This is not a headless test** — headless comes next as a tool, but success here is your eyes on the running sim.

---

## Tooling pass (right after the substrate is watchable)

Headless is **not optional** — it's how tuning becomes experiment rather than guesswork — it simply comes *after* milestone 1 is headful-watchable. See `tooling.md`. In short: no-render fast-forward + per-generation stats (lineage count, gene mean/variance, population, births/deaths), snapshot/restore, and seeded reproducible runs. This trio answers "did distinct strategies emerge and persist, or did it collapse?" without watching, and lets you fork an interesting run to A/B perturbations.

---

## WebGPU migration (after tooling)

Port Tier A passes + spatial hash to compute shaders. Slot-in, not redesign — the buffer contract is what bought that. The intensity slider at max becomes "big loads on the 3090." See `webgpu-migration.md`.

---

## Milestone 2 — bodies evolve

Morphology genes (the documented stubs: `RESILIENCE`, `EFFICIENCY`, `SENSORY_RANGE`, and form/capability genes) so agents evolve *bodies*, not just behavior weights. Rendering reflects morphology (node size/shape/effects driven by body genes). Append gene indices; pools and shaders read `GENE_COUNT`, so this is additive.

---

## Authored social/economic layer (after Milestone 2)

Each layer is a deliberate subsystem (Tier B) the agents *participate in* — not something that "emerges." Be honest about that: the substrate genuinely evolves; these are RimWorld-style authored systems on top of it. The ordering is chosen so each new system relieves a tension the previous ones created.

1. **Trade — the first cooperative system.** When two groups that are *not* currently fighting (signature-distinct but below an aggression/contest threshold) have complementary surpluses, they exchange. Simplest cooperative mechanic; directly motivates everything after it.
2. **Territory / treaties.** Borders become formal; non-aggression and access agreements protect trade routes. A pressure-release valve on conflict, now that trade is worth protecting.
3. **Technology accumulation.** Pooled group surplus accumulates into capabilities (effects on metabolism, conflict, resource yield). Emerges *from* trade + territory creating stable surplus.

Each is bolted onto a substrate already proven to evolve and cluster — never a prerequisite for milestone 1.

---

## Rendering spec — the cyber-net / netrunner skin

Built in milestone 1 (the success test is headful). PixiJS v8 / WebGL, batched containers, same throughput discipline as swarmr. Rendering is a **dumb view**: it reads world state and draws; it never mutates the sim and can be destroyed/rebuilt from state on any frame.

### Visual language
- **Agent = node.** A glowing point/disc. Node **hue = signature** (map `SIG_A/B/C` → HSL or a 3D→colour projection). Node **size** = `SIZE` gene (and later morphology). Node **brightness/alpha** = energy (dim when starving, bright when fed) — so you can see famines sweep as a cluster dims.
- **Kin-cohesion = lit edges.** Draw faint glowing lines between nearby *signature-similar* agents (the same neighbor pairs `KIN_COHESION` reads — reuse the spatial-hash query, don't recompute). A tribe becomes a **lit-up network mesh.** Edge density tracks cluster cohesion; you literally see tight tribes vs. loose loners.
- **Conflict = fraying seam.** At contested frontiers, dissimilar clusters' meshes meet and edges break/spark. A war *looks like* two meshes grinding and fraying at a seam — render contest events as brief bright sparks/glitches on the contested edge.
- **Speciation = colour drift.** Because hue = signature and signature drifts under mutation, you watch a lineage's colour sweep the map, or a cluster split into two diverging hues at a frontier. This is the payoff of the abstract skin — emergent clustering reads as *profound* rather than as "why didn't they sign a treaty."
- **God tools = world-layer FX.** Resource bloom = a glowing field; hazard = a dark/red glitch zone; smite = a sharp flash. Player actions read as god-scale interventions on the net.

### Performance discipline
- Batched `ParticleContainer`-style draw for nodes (swarmr pattern). Thousands of nodes must stay under render budget.
- **Edges are the cost risk.** Cap edges per agent (e.g. draw to the k nearest same-signature neighbors only), and gate edge rendering by the intensity slider — at low intensity, draw fewer/no edges; at high intensity (3090), draw the full mesh. Edges use a pooled line buffer; **zero per-frame allocation** for edges (don't churn graphics objects — write into a reused geometry/vertex buffer).
- Rendering reads the *same* spatial-hash neighbor data the sim already computed; it must not run its own O(n²) neighbor pass.
- Render is decoupled from the fixed sim tick; at high sim-speed the view samples current state and draws — it never blocks the sim.

### Why 2D abstract (not 3D) for milestone 1
A 2D top-down abstract field in Pixi is cheaper, faster to iterate, and the cyber aesthetic reads great flat. The abstract framing also sets player expectation to "a-life experiment" (where emergent clustering reads as wonder) rather than "Black & White" (where authored-vs-emergent social seams would show). If genuinely-3D depth/light-scatter is ever wanted, that's Three.js *for rendering only*, with the sim kept separate — a later, optional direction, not milestone 1.
