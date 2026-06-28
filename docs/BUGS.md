# BUGS

## FIXED — Clicking in GPU mode doesn't register
Most of the time clicking the field while in gpu mode doesn't do anything. sometimes it
does do the thing, like a food bloom but most of the time nothing happens.

**Cause:** god tools mutated `world.resources` / agent `energy`/`alive` directly on the
input event, but in GPU mode the per-tick readback (`downloadAll`/`finishReadback`)
overwrites those same pools with the GPU's copy. A click landing between the upload and
the readback was clobbered — so ~half of clicks vanished, nondeterministically. (Ocean
paint never had this because `passability` is CPU-source-of-truth: uploaded, never read
back.) **Fix:** input now ENQUEUES commands (`enqueueGod`) and the sim applies them on
`drainGod()` at a fixed point each tick, right before the GPU upload. Verified in-browser
on real WebGPU: bloom `1.47 → 30` survives a full GPU tick; smite clears its radius and
the kills persist.

## FIXED — Paint Food + food spawn doesn't work in GPU mode
Same readback race as above (food bloom writes `resources`). Fixed by the god queue.
Food is now also a **paint**, mirroring ocean: press **F** to toggle food-paint, left-drag
paints food, shift-drag erases it.

## FIXED — Ocean Activity (food growing in painted ocean)
I paint a very wide ocean. Given enough time the agents seem to eat into the ocean...
food is spawning in the ocean.

**Cause:** `resources()` regrew every cell toward its capacity with no passability check.
**Fix:** ocean/wall cells (passability ≥ blockThreshold) are now a hard dead zone —
`resources()` forces them to 0 every tick (clears food already present when a cell is
painted, and auto-restores regrow when the barrier is erased). Verified: blooming *onto*
ocean leaves the cell at 0.

## PARTIAL — Sawtoothing / live heap graph
I saw in the heap graph sawtooth patterns. We may need to optimize. Can I view the same
graphs in gpu mode as in cpu mode? I had before a live heap size graph bar — where was
that?

Added a live `heap   NN.NMB` line to the perf overlay (top-left), visible in BOTH CPU and
GPU mode — the same number Chrome DevTools' Performance Monitor graphs (`⋮ → More tools →
Performance monitor → JS heap size`), so you can watch it live either way. The
steady-state sawtooth investigation (is anything allocating in the hot path?) is still
OPEN — fold into a profiling pass.

I found the JS heap size in Performance monitor. Without food paint it's a little sawtooh from 47-70 mb. with f paint on like crazy it's big sawtooh between 75 and 200. I know I'm slamming it, but is it worth our time to optimize this further. I shoudl point out my base, small saw tooth is GPU mode full sim full cognition

**VERDICT (not worth it now):** a sawtooth that returns to its floor (~47) = healthy GC
reclaim, NOT a leak (a leak shows a rising floor / monotonic climb). Frame budget is met
(logic ~1.8/4ms, render ~3.1/8ms, 120fps) so GC causes no hitches — absolute MB doesn't
matter, pauses do. The base churn is outside the sim hot path: the WebGPU per-tick
readback (mapAsync returns a fresh ArrayBuffer each sync) + Pixi render geometry; the
zero-alloc invariant is about the per-agent sim systems, which are alloc-free by design.
The 75–200 food-paint spike = population booming toward 20k → more render churn (+ a
screenToWorld object per pointer event), not a hot-path violation. REVISIT only if frame
stutter correlates with GC, or the sawtooth FLOOR climbs over minutes. Optional cheap
insurance: a ~15s allocation-timeline with render minimized to confirm the sim path is
flat.

## OPEN — Reproduction and Food availability
Agents are reproducing because they have enough food to reproduce but they do not have
enough food to keep the new ones alive. I think they are dying immediately. Could we
prevent reproduction if there is not enough food to support the offspring for at least a
little time? — Candidate for the evolution-tuning pass (gate reproduction on local food).

## OPEN — Small sizes dominate
The smaller sized agents always dominate eventually. I think this is because they can
consume food more efficiently than the larger agents? How could we adjust that? —
Tradeoff-invariant issue; address in the evolution study below.

## OPEN — SPIKE: Do a study yourself
Using headless mode, run the simulation, look at the winners and losers and consider how
we could adjust their weightings and genes to increase diversification amounts species
while also increasing monoculture and monoethic society within the individual species.
Include in your study various combinations of the sliders the same end, increasing
diversification between societies while increasing monoculture/monoethnic traits within
individual societies.

## OPEN — Borders
There are clear borders in some cases. Could we have a display to only show those borders
between societies?

## FIXED — Down-right drift at 20k (was conflated with "bigger map")
At 20k the whole population swam down-and-to-the-right. Diagnosed as a *directional
sampling bias*, NOT crowding or map size: `sense` keeps the first `neighborBudget` (64)
in-radius neighbors, but `SpatialHash.queryNeighbors` emits the 3×3 cells top-left →
bottom-right, so the kept neighbors skew up-left and the leftover separation push drives
everyone down-right. It only bit at 20k because that's where in-radius count (~109) first
exceeds the 64 cap; below a few thousand agents the cap never triggers.

**Proven** with a headless drift probe (seed 24301, 20k agents): mean velocity
`(+10.6, +15.7)` px/s and centroid drift `(+9.0, +13.8)` px with the cap; both collapse to
the noise floor when the cap is lifted.

**Fix:** instead of taking the *first* `budget` neighbors, `sense` now **even-subsamples**
them — pass 1 counts in-radius neighbors, pass 2 Bresenham-selects `min(nIn, budget)`
evenly spread across the candidate list (spatially uniform → no directional bias), with a
half-bucket phase offset (`acc = nIn>>1`) so selection doesn't skew toward either end.
Mirrored in the WGSL `sense` kernel. Same sample SIZE as before (conflict's neighbor cache
stays filled), just unbiased selection; uncapped agents still see the identical full set so
GPU/CPU parity holds.

**Verified:** post-fix drift probe `centroid (−0.04, +0.23)` ≈ the uncapped baseline; real-
3090 GPU dense-20k run `centroid (−0.13, +0.05)`, mean vel ~0; verify suite green across 3
seeds (hash/sense/steer/integrate/metabolism/chain, 0 mismatches); headless evolution
unchanged; typecheck clean.

## OPEN — Bigger map (feature, now decoupled from the drift)
Still want a much larger world for more emergent behavior / less forced crowding — but this
is now a pure feature request, NOT a drift fix (the down-right swim above was a sampling
bias, not map size). Real work: WORLD_W/H touch the spatial hash grid, the resource field
grid, and the GPU uniforms — size it as a deliberate change, not a drift workaround.
