# Petriarch — CLAUDE.md

Petriarch is a browser-based artificial-life god game. A population of agents genuinely **evolves** its behavior and body (genome-driven, no authored fitness function). The player is a god who **perturbs** the world — never controls individuals. On top of the evolved substrate sit **authored** social/economic systems (conflict first, then trade, then later layers) that the agents *participate in* but do not invent.

The aesthetic is **cyber-net / netrunner**: agents are glowing nodes, kin-cohesion is drawn as lit network edges, lineages are hues, and a "tribe" looks like a lit-up mesh. Speciation is visible as colour drift.

This file is the contract every change must respect. Read it before touching the simulation.

---

## The one-line architecture

> A single mutable `World` owns everything. Pure **systems** read it and mutate it on a fixed timestep over **structure-of-arrays typed-array pools**. Dumb **views** read it and draw. The hot path allocates nothing. Per-agent work is written as flat-buffer passes so it ports to WebGPU compute with no redesign.

This is the swarmr architecture (proven to hold thousands of entities at frame budget) applied to a-life. If a proposed change violates SoA, the buffer contract, or zero-allocation, it is wrong by default — flag it instead of doing it.

---

## Non-negotiable rules

1. **SoA over typed arrays, always.** Agents are *not* objects. Each gene/field is its own `Float32Array`/`Int32Array` of length `MAX_AGENTS`. Agent `i`'s data is at index `i` of each array. There is no `Agent` class, no array of structs, no per-agent closures or behavior objects. The array *is* the pool.

2. **Zero allocation in the hot path.** No `new`, no array literals, no object spread, no closures created per-tick or per-agent inside any system that runs over the population. Pre-allocate once at capacity. Reuse. Death is an O(1) swap-remove; birth reuses a freed slot. Damage numbers / transient visuals use pooled sprites (swarmr pattern). Verify with the browser heap timeline: steady-state allocation profile must be flat.

3. **The buffer contract (this is what makes WebGPU a slot-in).** Every **Tier A** system is a pure pass: `(read-only input buffers) -> (write output buffer)`. It reads flat typed arrays at fixed strides and writes one output buffer. It never walks linked structures, never mutates a buffer it's also reading in a way another agent depends on mid-pass, never holds a reference into the middle of an agent's data across calls. Gene access is always `genes[i * GENE_COUNT + GENE_X]`. If a system obeys this, its WGSL port is a mechanical body-rewrite with an identical buffer contract. **Do not break this discipline for convenience — it is the whole migration plan.** See `docs/webgpu-migration.md`.

4. **Tier A vs Tier B — know which tier you're writing.**
   - **Tier A (GPU-portable, per-agent, uniform, parallel):** sensing/neighbor-gather, steering-from-genes, integration, metabolism. Written to the buffer contract. Destined for compute shaders.
   - **Tier B (stays CPU — symbolic, branchy, stateful, bookkeeping):** reproduction/death (pool swap-remove), conflict resolution bookkeeping, all authored social/economic systems, god-tools, lineage stats. These never go to the GPU.
   - When adding a system, state its tier in a header comment. A Tier A system that needs branchy symbolic logic is a design smell — split it.

5. **All spatial queries go through the spatial-hash abstraction.** No ad-hoc O(n²) distance loops anywhere. The uniform-grid hash powers kin-sensing, resource-sensing, and conflict — exactly as it powered targeting in swarmr. There is *one* broadphase to port to GPU (counting-sort grid with atomics); keep it that way.

6. **Fixed timestep; decouple thinking from acting.** Integration runs every tick. "Decide what to do" (steering-from-genes) runs every `THINK_INTERVAL` ticks and writes a steering vector the integrator consumes — same accumulator pattern swarmr uses for logic/render, applied to cognition. Gameplay never reads wall-clock delta. The sim clock is independent of render and is **speed-controllable** (see rule 8).

7. **Seeded PRNG for everything random.** One `mulberry32` instance; every random call goes through it (mutation, spawn jitter, conflict rolls). Runs must be reproducible from a seed — this is how we debug "why did this lineage win" and how snapshot/restore and headless runs stay deterministic. No `Math.random()` anywhere in the sim.

8. **Intensity slider is a first-class control, built in milestone 1.** It drives, together: live population (filled fraction of `MAX_AGENTS`), `THINK_INTERVAL` (think every tick at max → every 8th at min), and neighbor-sample budget (full 3×3 cell neighborhood at max → capped at min). It is both a perf knob (degrade gracefully on weak machines; crank on the 3090) and a design knob. Separately, a **tick-rate / sim-speed control** lets the player speed up time while watching (headful fast-forward). These are two different controls: intensity = how heavy each agent is, sim-speed = how fast the clock runs.

9. **Data-driven tunables.** All numbers — gene count and indices, mutation rates, resource regrowth, metabolic costs, conflict params, capacity — live in `src/data/`. Code reads data; you edit data. `MAX_AGENTS` is a single constant; changing capacity is editing one number.

10. **No authored evolution.** There is no fitness function. Selection is *only* "agents that stay fed and breed leave more copies." Never add code that scores agents and preferentially breeds the high scorers — that defeats the entire project. The environment selects; we don't.

---

## Capacity & targets

- `MAX_AGENTS` default **5000**, trivially adjustable (one constant). Pools allocate to this.
- Milestone-1 CPU target: hold the population at frame budget headful, swarmr-style (logic tick well under budget, render cheap). The 3090 + WebGPU path is the intended destination for genuinely large loads — turning the intensity slider to max is explicitly "try big loads on the GPU."
- Render is **not** on milestone-1's critical path for *correctness* (the success test is watching real emergent behavior), but the cyber-net skin is built in milestone 1 because the success test is **headful** — you watch it run. See `docs/simulation-systems.md` §Rendering.

---

## Project layout

```
src/
  main.ts              # bootstrap: world, views, loop, lifecycle
  core/
    loop.ts            # fixed-timestep accumulator + sim-speed control
    rng.ts             # mulberry32 (the only randomness source)
    spatialHash.ts     # uniform-grid broadphase (the one thing to port to GPU)
    intensity.ts       # intensity slider -> population/think-interval/neighbor-budget
  state/
    world.ts           # the World: all SoA pools + resource field + lineage bookkeeping
    pools.ts           # typed-array allocation at MAX_AGENTS, swap-remove, free-slot reuse
  sim/
    tierA/             # GPU-portable passes, written to the buffer contract
      sense.ts         # neighbor gather via spatial hash
      steer.ts         # steering-from-genes -> steering buffer
      integrate.ts     # apply steering, move, write positions
      metabolism.ts    # energy drain + resource intake
    tierB/             # CPU-only, symbolic/stateful
      reproduce.ts     # energy threshold -> mutated offspring into free slot
      death.ts         # energy<=0 / senescence -> swap-remove
      conflict.ts      # dissimilar + aggressive contest at resources
      resources.ts     # resource field deplete/regrow
      god.ts           # player perturbation tools (bloom, hazard, smite)
  data/                # ALL tunables (genome.ts, costs.ts, conflict.ts, resources.ts, capacity.ts)
  views/
    netRenderer.ts     # cyber-net skin (Pixi): nodes, kin-edges, hue=lineage
    hud.ts             # population, lineage count, sliders (intensity, sim-speed)
    devPanel.ts        # mutation rate, regrowth, seed, snapshot/restore, headless trigger
  tools/
    headless.ts        # no-render fast-forward + per-generation stats logging
    snapshot.ts        # serialize/restore full world state
docs/
  genome.md
  simulation-systems.md
  webgpu-migration.md
  tooling.md
```

---

## Build & run

Requires Node 20+. PixiJS v8 (WebGL) for rendering now; a parallel **WebGPU compute context** is added for Tier A when the slider demands it (rendering stays Pixi). TypeScript strict. Vite.

```
npm install
npm run dev          # Vite dev server
npm run build        # type-check + production build to dist/ (static bundle)
npm run typecheck    # type-check only
npm run headless     # run tools/headless.ts: fast-forward + stats, no render
```

`dist/` is a static bundle — host anywhere (Cloudflare Pages, GitHub Pages). Deploy convention follows brac.dev.

---

## Build order (authoritative — see docs/simulation-systems.md for detail)

1. **Milestone 1 (headful substrate):** pools + genome + resources/metabolism/reproduction/death + steering-from-genes + spatial hash + **conflict** + cyber-net renderer + intensity slider + sim-speed control. Success = *you watch distinct strategies emerge and cluster into rival groups, and perturbing the world visibly changes outcomes.* Conflict is in milestone 1 — without it, borders are mush and there's nothing to watch.
2. **Tooling pass:** headless fast-forward + per-generation stats, snapshot/restore, seeded-run harness. Headless is **not optional** — it's how tuning becomes experiment — it just comes *after* the headful substrate is watchable.
3. **WebGPU migration:** port Tier A passes + spatial hash to compute. Slot-in, not redesign (that's what the buffer contract bought us).
4. **Milestone 2:** morphology genes — bodies evolve, not just behavior weights.
5. **Authored social layer:** **trade first** (the first *cooperative* system — surplus meets surplus between non-fighting groups), then territory/treaties, then tech accumulation. Each is a pressure-release valve on a tension conflict already created.

---

## Things that are bugs by definition

- A gene with no cost / no tradeoff (it'll max out across the population and stop being a variable).
- A fitness function that scores and preferentially breeds agents.
- Any `new` / allocation inside a per-population loop.
- An O(n²) distance loop bypassing the spatial hash.
- A Tier A system with branchy symbolic logic, or one that breaks the flat-buffer contract.
- `Math.random()` anywhere in the sim.
- Direct player control of an individual agent (the player is a god, not a puppeteer).
- Treating headless mode as the definition of milestone-1 success (it's a tool; success is headful and watchable).
