# Petriarch — WebGPU Migration Plan

The intent: WebGPU is a **slot-in**, not a rewrite. We build Tier A systems CPU-side now, but written to the exact flat-buffer contract a compute shader binds, so porting a pass means rewriting one function's *body* in WGSL while its buffer contract stays identical. Turning the intensity slider to max then means "run big loads on the 3090." This is a near-term destination, not a someday-maybe — architect for it from day one, port when the slider/profiler demands it.

Rendering stays PixiJS (WebGL). WebGPU is added as a **parallel compute context** for the simulation only. The CPU keeps the symbolic Tier B systems and reads back the small amount of state it needs.

---

## What ports and what doesn't

**Tier A → compute shaders** (per-agent, uniform, parallel):
- `sense` — neighbor gather over the spatial hash.
- `steer` — genome → steering vector.
- `integrate` — apply steering, move, write positions.
- `metabolism` — energy drain + intake.
- The **spatial hash** itself (the one broadphase) — GPU counting-sort grid with atomics.

**Tier B → stays CPU** (symbolic, branchy, stateful, bookkeeping):
- `reproduce` / `death` (pool swap-remove, free-slot management).
- `conflict` resolution bookkeeping.
- All authored social/economic systems (trade, territory, tech).
- `god` tools, lineage stats, snapshot/restore.

The split is exactly the Tier A/Tier B line from `CLAUDE.md`. If that line is respected while writing CPU code, the port is mechanical.

---

## The buffer contract (what makes it mechanical)

Each Tier A pass is `(read-only input buffers) → (one write output buffer)`:

- **Genome:** one flat `Float32Array`, agent `i` at `[i*GENE_COUNT .. +GENE_COUNT)`. Gene access always `genes[i*GENE_COUNT + GENE_X]`. This is *identical* to a `@group(0) @binding(n) var<storage, read> genes: array<f32>;` bound in WGSL and indexed the same way.
- **Positions/velocities/energy/age:** flat typed arrays, one element per agent, index = agent id.
- **Steering output:** a flat buffer the pass writes and `integrate` reads — never read-modify-write across agents in a way another agent depends on mid-pass.
- **No struct-of-arrays-of-structs, no nested objects, no references into the middle of an agent's data held across calls.**

A CPU pass that obeys this maps 1:1 onto a WGSL kernel where `global_invocation_id.x` is the agent index and the same flat arrays are storage buffers. The arithmetic is the same; only the host language changes.

### Discipline that must hold *now* (CPU phase) to keep the port free
1. Tier A passes read flat arrays at fixed strides — no convenience objects, no `agent.genes.kinCohesion` accessors that hide the layout.
2. All neighbor queries go through the spatial-hash abstraction (one thing to port).
3. No branchy symbolic logic inside a Tier A pass (that's a Tier B smell). Keep them arithmetic and uniform — branch-light, ideally branch-free where cheap.
4. A pass writes one output buffer; it does not mutate shared state other agents read in the same pass.
5. Decouple think (sense+steer) from act (integrate) via `THINK_INTERVAL` — on GPU this becomes "run the steer kernel every N frames, the integrate kernel every frame," which is trivial if it's already structured that way.

---

## Spatial hash on the GPU

The CPU uniform-grid counting-sort hash has a direct GPU analogue:
1. Compute each agent's cell id (kernel).
2. Counting-sort agents into cells using atomic counters (build cell-start/cell-count buffers).
3. Each agent reads its 3×3 cell neighborhood from the sorted buffer.

Keep *all* spatial queries (sim sensing, conflict proximity, and the renderer's edge-drawing neighbor lookup) going through this one abstraction so there is exactly one broadphase to port and everything downstream benefits at once.

---

## Readback strategy

The GPU does the per-agent grind; the CPU reads back only what Tier B needs:
- Positions (for rendering + god-tool hit-testing).
- Whatever aggregate/per-agent state conflict, reproduce, and stats require (energy, signature, flags).

Minimize readback size and frequency. Where a Tier B system can run on a slightly stale snapshot (e.g. lineage stats), let it, rather than stalling the pipeline. Reproduction/death need accurate energy/flags, so read those back each sim step; cosmetic stats can sample less often.

---

## Intensity slider ↔ GPU

The same slider that degrades gracefully on weak hardware is what you crank on the 3090:
- **Population** — filled fraction of `MAX_AGENTS` (default 5000; raise the constant for genuinely large GPU loads).
- **`THINK_INTERVAL`** — steer kernel cadence.
- **Neighbor budget** — cells/neighbors sampled per agent.

On CPU at milestone 1 these tune to stay at frame budget headful. Post-port, max intensity is the "big loads" mode. Keep `MAX_AGENTS` and these three parameters as the only things that change to scale up — no structural edits.

---

## Recommended sequencing

1. Milestone 1 fully on CPU, Tier A passes written to the buffer contract (no GPU yet).
2. Tooling pass (headless/stats/snapshot) — also validates determinism, which you'll want to preserve across the port (note: GPU floating-point and atomic ordering can diverge from CPU bit-for-bit; treat the GPU path as its own seeded-but-not-CPU-identical determinism domain, and keep the CPU path as the golden reference for debugging).
3. Port the spatial hash first (everything depends on it), verify against the CPU reference.
4. Port `sense` → `steer` → `integrate` → `metabolism`, one at a time, each verified against the CPU pass on the same seed before moving on.
5. Wire readback; keep Tier B on CPU unchanged.
6. Crank the slider; profile; raise `MAX_AGENTS`.

Do **not** start the port until milestone 1 is watchable and the tooling exists — the buffer-contract discipline means you lose nothing by waiting, and you gain a CPU golden reference to verify the GPU against.

---

## Progress

**Step 3 — spatial hash (bring-up, in progress).** The counting-sort grid is ported
to four compute kernels (`src/gpu/shaders/hash.wgsl.ts`: `clearCells` / `count` /
`scan` / `scatter`) hosted by `src/gpu/gpuContext.ts` (owns the device + buffers at
capacity) over `src/gpu/device.ts` (graceful-null device acquisition — no WebGPU ⇒
stay on CPU). The cell math is byte-for-byte the CPU's `clampCX/clampCY`, so
`cellStart` comes out identical to the reference; only the order of indices *within*
a cell differs (atomic scatter), which the contract permits.

Verification: `src/gpu/verify.ts` + a **"verify GPU hash"** button in the dev panel
build the CPU and GPU grids from the same live positions and compare `cellStart`
exactly and each cell's index set as a multiset. WebGPU can't run in the WSL/vite-node
toolchain, so this runs **headful**. The kernel *algorithm* was separately validated
against the CPU reference in Node (a TS reimplementation of the kernels) across seeds
and step counts — all exact; what the in-browser button confirms is the WGSL
compilation + GPU atomic execution. The GPU path is isolated behind the button and
does **not** touch the sim loop yet; the CPU path is unchanged.

Gotcha (found on real hardware): WebGPU only guarantees memory synchronization
**between** compute passes, not between successive `dispatchWorkgroups` inside one
pass. The four kernels have read/write hazards on each other (`counts`, `cellStart`,
`cursor`), so each gets its **own** compute pass in `buildHash` — a single pass let
`scan` read `counts` before `count` finished, corrupting nearly every cell offset.
The same per-pass-barrier discipline applies when chaining the Tier A kernels.

**Next:** confirm the button passes on real hardware, then keep grid state resident on
the GPU and port `sense` reading it, then `steer` → `integrate` → `metabolism`, each
verified against the CPU pass before wiring readback into the loop.
