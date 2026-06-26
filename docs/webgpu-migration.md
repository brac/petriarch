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

Gotcha #2 (also found on hardware): a verify runs `async` while the rAF sim loop
keeps ticking — moving agents and rebuilding `world.hash` in place across every
`await`. Comparing live `world` state after the readback compares a *moved* CPU
against the GPU's earlier snapshot (false ±1-cell mismatches, plus swap-remove
reassigning agent indices on births/deaths). Every GPU verify must **freeze a
snapshot of the inputs before the first await** and compare both sides against that
copy. Applies to the sense/steer/integrate/metabolism verifies too.

**Step 4a — sense (bring-up, in progress).** `src/gpu/shaders/sense.wgsl.ts` ports
sim/tierA/sense.ts: per agent, gather the 3×3 neighborhood from the resident grid and
accumulate the kin centroid / separation / threat-avoidance aggregates, capped at the
intensity budget. The seven aggregates are written **interleaved** (stride 7) into one
buffer so the pass stays within the default 8-storage-buffers-per-stage limit
(posX, posY, genes, cellStart, items, out = 6). `GpuContext.senseBuild` uploads genes +
params and dispatches; `readSense` de-interleaves on readback.

Verify: a **"verify GPU sense (max intensity)"** button. The neighbor budget makes the
result order-dependent when it caps, and within-cell order is GPU-defined — so the
verify compares only **uncapped** agents (`neighborCount < budget`), where CPU and GPU
see the same neighbor SET: kin counts must match exactly (integer sums), float
aggregates within tolerance (~1e-3 rel). Run at max intensity (budget 64) so almost
nothing caps. The kernel algorithm was validated against the CPU pass in Node (a TS
mirror) — exact counts, worstRel ~6e-8 — so the button confirms WGSL compile + GPU
execution + the bind-group plumbing.

Not yet ported: the shared `neighborList`/`neighborCount` cache the CPU sense records
for conflict to reuse. When sense moves to the GPU permanently, conflict (Tier B, CPU)
will need its own neighbor source (its own hash query, or a readback) — a wiring
decision for the readback step, not this verify.

**Step 4b — steer (done, verified).** `src/gpu/shaders/steer.wgsl.ts` ports
sim/tierA/steer.ts: reads the resident `senseOut` aggregates + genes + the resource
field, blends cohesion/separation/threat/resource-gradient/wander into one unit vector
(output stride 2). The grid→sense→steer chain now stays GPU-resident (steer reads
senseOut directly). Wander is the GPU's own determinism domain (a per-agent hash RNG
seeded by index + a per-frame seed) — it cannot match the CPU's single shared
mulberry32 advanced in index order. The verify neutralizes it (WANDER gene zeroed on
both sides; CPU genes + RNG state restored after) and checks the deterministic blend:
0 mismatches, worstAbs ~3e-4 over uncapped agents.

Verification is now **self-serve and headless** via `tools/gpu-verify` (Playwright +
Chrome SwiftShader). It caught a bug the Node algorithm-mirror never could: WGSL
refuses to infer precedence between `*` and `^` and requires explicit parens
(`(i * k) ^ seed`) — the shader failed to compile, the pipeline was invalid, and every
steer submit silently failed leaving the output zero-init. Lesson: a real-device WGSL
compile is part of the test; capture `device` uncapturederror events when a pass
returns all-zeros.

**Step 5a — integrate (done, verified).** `src/gpu/shaders/integrate.wgsl.ts` ports
sim/tierA/integrate.ts: pure per-agent physics (accelerate toward the cached steer,
clamp to gene-derived max speed, move, reflect off bounds). Output interleaved stride 4
[posX, posY, velX, velY]; persistent velocity buffers added. The verify feeds CPU and
GPU the SAME steer vector (current cached steer) to isolate integrate from steer, runs
the real CPU pass in place then restores pre-integrate state. All agents match (no
neighbor/RNG caveats): 0 mismatches, worstAbs ~1.6e-3 (f32 noise on positions up to
1920).

**Step 5b — metabolism (done, verified).** `src/gpu/shaders/metabolism.wgsl.ts` ports
sim/tierA/metabolism.ts. The drain + age half is pure per-agent (exact match). The
resource intake is the one SHARED write in Tier A: WGSL has no atomic float, so the
resource buffer is treated as `array<atomic<u32>>` holding f32 bit patterns (the SAME
bytes steer reads as `array<f32>` — bound two ways), and intake is a **bitcast
CAS-clamp loop**: read current, take `g = min(desired, current)`, compare-exchange the
reduced value, retry on contention. This conserves resources (energy granted ==
resource removed) but is ORDER-DEPENDENT under contention (which agent wins scarce
resource differs from the CPU's index order — the GPU determinism domain, same family
as sense's neighbor cap and the hash's within-cell order). The verify classifies by
resource-cell occupancy: single-occupant cells must match exactly (age + energy);
multi-occupant divergences are reported but allowed. Result: age 0 diffs, uncontended
energy 0 diffs (worst ~8e-6), 0 contended diffs (resources not binding at this density).

A latent bug surfaced via the device-error capture: `steerOutBuf` lacked `COPY_DST`, so
integrate's verify upload of an explicit steer vector silently failed and integrate
"passed" only on leftover buffer contents. Fixed; integrate now passes for real.

**All Tier A passes are ported and verified** (hash, sense, steer, integrate,
metabolism) via `tools/gpu-verify` — gpuErrors empty, all green.

**Step 6a — resident Tier A chain (done, verified).** `GpuContext` now has a resident
path: `uploadState`/`uploadResources` → `runTierA(count, think, seed, senseP, hz)` →
`downloadState`/`downloadResources`. `runTierA` encodes the whole chain in ONE
submission — on think ticks hash → sense → steer, every tick integrate → metabolism —
each pass its own compute pass (auto inter-pass barriers). State stays in GPU buffers
across all passes (no readback between them — the buffer contract's payoff). integrate
was refactored to write pos/vel IN PLACE so metabolism reads the moved positions, just
like the CPU order. `verifyChain` runs the full resident chain vs the full CPU sequence
(wander neutralized) from one snapshot: posVel 0 diffs (worst ~1.6e-3, same as
standalone integrate — chaining adds no error), age 0, energy 0 (uncontended). The
per-pass `*Build` verifies still pass after the refactor.

**Step 6b — wired into the loop (done, verified).** `src/gpu/gpuSim.ts::simStepGpu` is
the GPU-backed tick: resources (CPU) → uploadState/uploadResources → runTierA (resident
Tier A) → downloadState/downloadResources → conflict/reproduce/death (CPU). Driven by a
separate **async pump** in main.ts (chosen over one-frame pipelining): press **`g`** to
stop the fixed-timestep loop and run one (or `simSpeed`) awaited GPU tick per rAF frame,
then render. Two correctness-first simplifications: FULL state re-upload+readback each
tick (Tier B mutates the pool on CPU), and ALWAYS think (the CPU think-gate is a CPU-only
perf trick; always-think also keeps the resident steer cache aligned across CPU
swap-remove without mirroring swaps to the GPU). conflict does its OWN hash query (no GPU
neighbor cache).

Verified headless (tools/gpu-verify): 250 GPU ticks run with gpuErrors empty and the
population/evolution stay statistically equivalent to the CPU loop from the same seed —
GPU pop 813 / meanSIZE 1.596 vs CPU pop 760 / meanSIZE 1.623 (same equilibrium + regime,
differing only in chaotic detail = the GPU determinism domain).

**The Tier A migration is functionally complete: every pass on the GPU, resident, and
wired into a runnable loop.** Remaining is optimization, not correctness: this full-sync
software-SwiftShader path is slower than CPU at small N — the win needs a real GPU and
reduced per-tick sync (upload only birth deltas, read back only what Tier B needs, keep
the agent pool GPU-resident across Tier B). Then crank intensity, profile, raise
MAX_AGENTS.
