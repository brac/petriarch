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

## OPEN — Bigger map
We need a much larger map. At 20k the agents all do this weird swimming down and to the
right. I think if we increased the world size then we could resolve that issue and allow
for more emergent behaviors since we will not be running a separation sim.
— NOTE: a *uniform* down-right drift across the whole population smells like a directional
bias (a sign/RNG/wander asymmetry or an integration drift), not only crowding — worth
diagnosing the drift direction independently before assuming map size alone fixes it.
