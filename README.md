# Petriarch

**A browser-based artificial-life god game.** A population of agents genuinely *evolves* — their behavior and bodies are genome-driven, with no authored fitness function. You are a god who **perturbs** the world (bloom resources, drop hazards, smite a region) but never controls an individual. On top of the evolved substrate sit authored social systems — conflict, then trade — that agents *participate in* but do not invent.

The aesthetic is **cyber-net / netrunner**: agents are glowing nodes, kin-cohesion is drawn as lit network edges, lineages are hues, and a "tribe" looks like a lit-up mesh. Speciation is visible as colour drift.

> North star: the Simpsons "Treehouse of Horror" petri-dish civilization — a closed world that rises, wars, advances, and worships on fast-forward — pushed as far as the stack allows.

---

## What it does today

- **~20,000 agents** simulated on the GPU via **WebGPU / WGSL** (developed on an RTX 3090), rendered with **PixiJS v8**.
- Agents carry genetic traits — size, metabolism, social connection, aggression — and forage a regrowing food field, consume, reproduce, and die. Selection is purely environmental: *agents that stay fed and breed leave more copies.* Nothing scores or hand-picks them.
- **Emergent behavior you can watch:** same-lineage clumping, border conflict over food, predation niches, and the beginnings of **trade** between non-fighting groups across a dead zone.
- Two first-class live controls — an **intensity** slider (how heavy each agent is: population, think-interval, neighbor budget) and a **sim-speed** slider (how fast the clock runs) — plus a **cognition** knob and a dev panel of live tunables.

## Architecture in one line

> A single mutable `World` owns everything. Pure **systems** read it and mutate it on a fixed timestep over **structure-of-arrays typed-array pools**. Dumb **views** read it and draw. The hot path allocates nothing. Per-agent work is written as flat-buffer passes, so it ports to WebGPU compute with no redesign.

Some load-bearing rules (the full contract is in [`CLAUDE.md`](CLAUDE.md)):

- **SoA, always.** Agents are not objects; each gene/field is its own typed array of length `MAX_AGENTS`.
- **Zero allocation in the hot path.** Pre-allocate at capacity, reuse, swap-remove on death.
- **Tier A vs Tier B.** Tier A (sensing, steering, integration, metabolism) is GPU-portable and written to a strict buffer contract. Tier B (reproduction, conflict, trade, god-tools, stats) stays on the CPU.
- **Seeded PRNG everywhere.** One `mulberry32` instance — runs are reproducible from a seed, which is how snapshots, headless runs, and "why did this lineage win" debugging stay deterministic.
- **No authored evolution.** There is no fitness function; the environment selects.

## Getting started

Requires **Node 20+**.

```bash
npm install
npm run dev        # Vite dev server — open the printed localhost URL
npm run build      # type-check + production build to dist/ (static bundle)
npm run typecheck  # type-check only
npm run headless   # fast-forward + per-generation stats, no render
```

A WebGPU-capable browser (recent Chrome/Edge) is recommended to exercise the GPU path; the simulation also runs on the CPU. `dist/` is a static bundle you can host anywhere (Cloudflare Pages, GitHub Pages).

> A hosted demo is not deployed yet.

## Project layout

```
src/
  core/    loop, seeded rng, spatial hash, intensity control
  state/   the World, SoA typed-array pools
  sim/
    tierA/ GPU-portable passes (sense, steer, integrate, metabolism)
    tierB/ CPU-only systems (reproduce, death, conflict, trade, resources, god-tools)
  gpu/     WebGPU compute context + WGSL kernels
  data/    ALL tunables (genome, costs, conflict, resources, capacity)
  views/   cyber-net renderer, HUD, dev panel
  tools/   headless fast-forward, snapshot/restore
docs/      design specs and roadmap
```

## Documentation

- [`docs/genome.md`](docs/genome.md) — the genome: genes, costs, and tradeoffs
- [`docs/simulation-systems.md`](docs/simulation-systems.md) — systems, tiers, and rendering
- [`docs/webgpu-migration.md`](docs/webgpu-migration.md) — the buffer contract and the GPU port
- [`docs/tooling.md`](docs/tooling.md) — headless runs, snapshots, seeded harness
- [`docs/PETRIARCH design log and roadmap.md`](docs/PETRIARCH%20design%20log%20and%20roadmap.md) — the long-range plan and design invariants
- [`CLAUDE.md`](CLAUDE.md) — the architectural contract every change must respect

## Tech stack

TypeScript (strict) · Vite · PixiJS v8 (WebGL render) · WebGPU / WGSL (Tier A compute)

## License

[MIT](LICENSE) © Ben Bracamonte
