# Petriarch — Phase 0: Foundational Setup

## Context

Petriarch is a greenfield browser a-life god game. The repo currently holds **only** `CLAUDE.md` and four design docs (`docs/genome.md`, `simulation-systems.md`, `webgpu-migration.md`, `tooling.md`) — there is no `src/`, no `package.json`, no build. The project deliberately reuses the proven engine architecture from the adjacent **swarmr** repo (`/mnt/c/Users/Ben Bracamonte/Work/swarmr`): SoA typed-array pools, a zero-allocation hot path, a fixed-timestep loop, a uniform-grid spatial hash, seeded RNG, and a batched PixiJS v8 renderer.

**Phase 0 builds the scaffold and core infrastructure that must exist before any Milestone-1 gameplay/evolution system.** No evolution, no steering, no conflict logic — those are Milestone 1. Phase 0's job is to stand up the project skeleton, port the reusable swarmr engine pieces, define the data contracts (genome, capacity), allocate the World/pools, wire the fixed-timestep loop + controls, and initialize the full Pixi rendering pipeline.

**Confirmed scope decisions (from the user):**
- **Compile-only skeleton.** Success = `npm run typecheck` passes under strict TS and `npm run dev` shows an empty letterboxed canvas with a perf overlay idling at 60 fps. Sim systems are stubs; the renderer initializes the pipeline but draws zero agents (population starts at 0). No random-walk demo.
- **60 Hz** sim tick (`TICK_DT = 1/60`), not swarmr's 240.
- **World = 1920×1080**, letterboxed. **One `ParticleContainer`** with per-particle dynamic tint (`dynamic: { color: true }`).

---

## Reusable swarmr code (verified APIs)

Source paths under `/mnt/c/Users/Ben Bracamonte/Work/swarmr/`.

**Port near-verbatim** (header comment updated to Petriarch context):
- `src/core/rng.ts` → `src/core/rng.ts`. `class Rng { constructor(seed); next(); range(min,max); int(min,max) }`. The single randomness source; one instance owned by `World`.
- `src/core/spatialHash.ts` → `src/core/spatialHash.ts`. `class SpatialHash { constructor(cellSize, worldW, worldH, capacity); build(posX, posY, count); queryNeighbors(x, y, out); queryRing(cx, cy, r, out) }`. Allocation-free; cell c's entities are `items[cellStart[c]..cellStart[c+1]]`. Construct with `capacity = MAX_AGENTS`.

**Port then adapt:**
- `src/core/loop.ts` → `src/core/loop.ts`. Currently `TICK_HZ = 240`, `MAX_TICKS_PER_FRAME = 8`, RAF accumulator with spiral-of-death guard (`if (ticks >= MAX_TICKS_PER_FRAME) accumulator = 0`) and an `alpha` for interpolation. **Changes:** set `TICK_HZ = 60`; add `public simSpeed = 1`; multiply raw frame time (after the 0.25s clamp) by `simSpeed` before accumulating; raise the per-frame drain cap to `MAX_TICKS_PER_FRAME * Math.max(1, Math.round(simSpeed))`. **`TICK_DT` never changes** — determinism preserved. `simSpeed = 0` pauses the sim while render continues.
- `src/core/pool.ts` → inline/import inside `src/views/netRenderer.ts` only (`class Pool<T>` for pooled Pixi objects — transient FX later). **Not** used for agent state; agents are raw typed arrays.
- `src/state/gameState.ts` → `src/state/world.ts`. Keep the "single mutable world; systems mutate, views read; rebuildable from state any frame" pattern and the `WORLD_W`/`WORLD_H` named exports (set to 1920/1080). Strip all swarmr domain fields (enemies, projectiles, gems, boss, weapons).
- `src/state/enemies.ts` (SoA class template) → `src/state/pools.ts` (`Agents` class).
- `src/views/renderer.ts` → `src/views/netRenderer.ts`. Reuse the `Application.init()` config, `app.ticker.stop()` + manual `renderer.render(stage)`, `layout()` letterbox (`scale = Math.min(sw/WORLD_W, sh/WORLD_H)`, centered, on resize, using `renderer.screen`), `world = new Container()` camera root, `buildParticlePool()` helper, `OFFSCREEN = -10000` parking, `blendMode = 'add'`, and `renderer.generateTexture(new Graphics().circle(0,0,r).fill(0xffffff))` for the node texture. Strip atlas/floor/enemy/projectile/gem/boss specifics.
- `src/views/perfOverlay.ts` → `src/views/perfOverlay.ts`. Rename entity→agent labels.

---

## Deliverables

### 1. Project scaffold (repo root)
- `package.json` — `"type": "module"`; deps: `pixi.js` ^8; devDeps: `typescript` ^5.7, `vite` ^6, `@types/node`. Scripts: `dev` (vite), `build` (`tsc --noEmit && vite build`), `typecheck` (`tsc --noEmit`), `headless` (stub script, e.g. `node --experimental-strip-types src/tools/headless.ts` or wired in Milestone-2 tooling — leave a working no-op).
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`. (Path aliases optional; skip if they add friction.)
- `vite.config.ts` — plain Vite, output `dist/`.
- `index.html` — `<div id="app">` with the canvas mount, a perf overlay `<div id="perf">` (styled in CSS: fixed, monospace, `pointer-events:none`), intensity `<input id="intensity" type="range">` (0–1), sim-speed `<input id="simspd" type="range">` (0.1–8), and a `<span id="pop">` population counter.
- `.gitignore` (node_modules, dist).

### 2. Data contracts — `src/data/`
- `genome.ts` — the authoritative contract from `docs/genome.md`:
  - `export const GENE = { SIZE:0, METABOLIC_RATE:1, REPRO_THRESHOLD:2, LIFESPAN:3, FERTILITY:4, MUTABILITY:5, KIN_COHESION:6, SEPARATION:7, RESOURCE_ATTRACT:8, THREAT_AVOID:9, WANDER:10, AGGRESSION:11, SIG_A:12, SIG_B:13, SIG_C:14 } as const;`
  - `export const GENE_COUNT = 15;`
  - `export const GENE_RANGE: Record<number, [number, number]>` — populate all 15 with **placeholder** plausible bounds (flagged for tuning at Milestone-1 start). The clamp `Math.max(GENE_RANGE[g][0], Math.min(GENE_RANGE[g][1], v))` must compile and be correct now.
- `capacity.ts` — `MAX_AGENTS = 5000`, `THINK_INTERVAL` default `8`, `HASH_CELL_SIZE` (placeholder `48`), resource-grid dims (placeholder `RESOURCE_GRID_W=80`, `RESOURCE_GRID_H=45`), `WORLD_W=1920`, `WORLD_H=1080` (or re-export from world). One file to change capacity.
- `costs.ts`, `conflict.ts`, `resources.ts` — **stub** tunable modules (empty/placeholder exports) so Milestone-1 systems import from a real path.

### 3. Core infra — `src/core/`
- `rng.ts`, `spatialHash.ts` — ported (above).
- `loop.ts` — ported + 60 Hz + `simSpeed` (above).
- `intensity.ts` — `export interface IntensityState { activeCount; thinkInterval; neighborBudget }` and `computeIntensity(slider: number): IntensityState` (or mutate-in-place to stay zero-alloc). Maps slider→ population in `[MIN_POP, MAX_AGENTS]`, `thinkInterval` 8→1, `neighborBudget` capped→full. Written to `world.intensityState`.

### 4. State — `src/state/`
- `pools.ts` — `class Agents` (SoA). All `Float32Array(MAX_AGENTS)`: `posX, posY, velX, velY, energy, age, steerX, steerY`; `lineageId: Int32Array(MAX_AGENTS)`; `alive: Uint8Array(MAX_AGENTS)`; `genes: Float32Array(MAX_AGENTS * GENE_COUNT)`; `count: number`. Methods: `spawn(...)` (guard `count >= capacity` → return -1; write all fields; `count++`; zero-alloc), `kill(i)` (swap-remove: `arr[i]=arr[count]` for every array; genome via `genes.copyWithin(i*GENE_COUNT, count*GENE_COUNT, (count+1)*GENE_COUNT)`; `count--`). Pure packed active set `[0,count)` (swap-remove only) — sufficient per the user's note that reproduction runs in Tier B after the main passes; a free-slot stack can be added in Milestone 1 if mid-pass births are needed.
- `world.ts` — `interface World` + `createWorld(seed): World`. Owns `agents: Agents`, `hash: SpatialHash`, `rng: Rng`, `resources: Float32Array` (grid), `intensityState`, `tick`, `time`, `thinkTimer`, `lineageStats` (stub). Exports `WORLD_W`, `WORLD_H`.

### 5. Sim skeleton — `src/sim/` (all stubs, correct signatures + tier header comment)
- `tierA/`: `sense.ts`, `steer.ts`, `integrate.ts`, `metabolism.ts` — each `(world: World) => void`, header `// Tier A — GPU-portable, buffer contract`. Empty bodies (or a `// TODO Milestone 1`).
- `tierB/`: `reproduce.ts`, `death.ts`, `conflict.ts`, `resources.ts`, `god.ts` — `(world: World) => void`, header `// Tier B — CPU, symbolic`.

### 6. Views — `src/views/`
- `netRenderer.ts` — initialize the **full** Pixi pipeline (so Milestone 1 only fills the per-frame body): `Application.init` (webgl, autoDensity, resolution=dpr), `app.ticker.stop()`, camera `Container`, letterbox `layout()`, generate the white-circle node texture, build **one** `ParticleContainer` sized `MAX_AGENTS` with `dynamic: { color: true }`, all particles parked at `OFFSCREEN`. A `render(world, alpha)` method that loops `for i in [0, count)` (count is 0 in Phase 0, so it draws nothing), parks `[count, high)`, then `renderer.render(stage)`. Include `sigToHue(genes, i)` and `hslToRgb` helpers (used at count 0 now, ready for M1). Establish the layer order: background → edge Graphics (empty stub) → node ParticleContainer → UI.
- `perfOverlay.ts` — ported; reads loop perf fields + `world.agents.count`.
- `hud.ts` — wire `#intensity` → `computeIntensity` → `world.intensityState`; `#simspd` → `loop.simSpeed`; `#pop` ← `world.agents.count`.
- `devPanel.ts` — stub.

### 7. Bootstrap + tools
- `src/main.ts` — create `World` (seed from URL param or constant), construct `netRenderer`, `perfOverlay`, `hud`, instantiate `Loop`. `update(dt)` runs the canonical 9-step order (all stubs) **+** the THINK_INTERVAL gate, ending with `world.hash.build(agents.posX, agents.posY, agents.count)`:
  ```
  resources(world)
  if (++world.thinkTimer >= world.intensityState.thinkInterval) { world.thinkTimer = 0; sense(world); steer(world) }
  integrate(world); metabolism(world); conflict(world); reproduce(world); death(world)
  world.hash.build(agents.posX, agents.posY, agents.count)
  ```
  `render(alpha)` calls `netRenderer.render` + `perfOverlay` update. `loop.start()`.
- `src/tools/headless.ts` — stub (no-op or minimal tick loop), so the `headless` script resolves.

---

## Verification

1. `npm install` succeeds.
2. `npm run typecheck` → 0 errors under `strict` + `noUncheckedIndexedAccess`.
3. `npm run dev` → browser shows a **letterboxed dark canvas** that rescales correctly on window resize and HiDPI, with the perf overlay (monospace, top-left) idling at ~60 fps, population counter reading `0`. No agents drawn (expected).
4. Moving the **sim-speed** slider changes `loop.simSpeed` (verify via overlay ticks-per-frame; sim runs faster though nothing visible moves yet). Moving the **intensity** slider updates `world.intensityState` (log or overlay to confirm).
5. `npm run build` → produces a static `dist/` bundle.
6. Sanity grep: no `Math.random(` anywhere under `src/sim/` or `src/core/` (RNG-only discipline).
7. Spot-check zero-alloc shape: `Agents.spawn`/`kill` contain no `new`/array-literals (manual read; full heap-timeline check deferred to Milestone 1 when agents actually move).

---

## Notes / deferred to Milestone 1 (not Phase 0)
- Per-frame node draw body (hue/size/alpha mapping), kin-edge rendering, conflict spark FX.
- Real bodies for all `sim/` stubs (sense/steer/integrate/metabolism/reproduce/death/conflict/resources/god).
- Final `GENE_RANGE` tuning values, `HASH_CELL_SIZE` calibration to the real sensing radius, resource-grid sizing.
- Free-slot stack (only if mid-pass births become necessary).
- Headless stats, snapshot/restore (Tooling pass, after Milestone 1).
