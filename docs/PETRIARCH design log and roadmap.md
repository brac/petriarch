# Petriarch — Design Log & Forward Roadmap

> Record of the design conversation and the forward-facing plan. Companion to the individual feature specs. North star: the Simpsons "Treehouse of Horror" petri-dish civilization — a closed world that rises, wars, advances, and worships on fast-forward — pushed as far as the stack allows.

## What Petriarch is (current state)

GPU artificial-life sim. ~20,000 agents via WebGPU/WGSL on an RTX 3090, rendered with PixiJS v8. Agents have genetic traits (size, metabolism, social connection, aggression-leaning behavior); they forage on a regrowing food grid, consume, reproduce. Current emergent behavior: same-species clumping with border conflict over food; a fast green species reaches monoculture at the regrowth cap. Agents currently move randomly.

## The through-line of this design session

The project's center of gravity shifted from "an ecosystem" toward "a civilization." The unifying realizations, in order:

1. **Civilization needs structure agents can't get from local competition alone** — stigmergy (agents writing the environment), persistent non-local links (the "net"), and a construction/state layer.
2. **The current equilibrium is stable** — adding mechanisms won't destabilize the green monoculture unless every civilization mechanic carries a **tradeoff/vulnerability**, not a pure bonus. (Design invariant.)
3. **Intelligence shouldn't live in individual agents** — at 20k on one GPU, per-agent brains aren't affordable. Intelligence lives in the agent's *reading of shared fields*, the *fields themselves* (collective memory), and the *genome* (tuned by selection).
4. **Cognition is one weighted sum** — so it's tunable with a slider (global scalar) + a toggle bank (which inputs exist; doubles as a performance control for smaller/weaker runs).
5. **Civilization = the state that does NOT decay back to equilibrium** — ratchets (persistence, tech, faction memory, focal points) give the world a *history*. The difference between an ecosystem and a civilization is that the civilization's late ticks are shaped by its early ones.
6. **Collective consciousness is a phase transition, not a brain** — make group behavior depend on aggregate state that only exists at scale (quorum thresholds, aggregate fields). Emergent, not declared.

## Companion feature specs produced

- **PETRIARCH_NET_LAYER.md** — the original four-phase plan: stigmergy fields → civilization tiers → structure layer → network graph (hybrid emergent-node / explicit-edge). Trade/war/construction run as a tiny CPU graph over depots; 20k agents stay on-GPU.
- **PETRIARCH_FEATURE_passability.md** — the movement-cost substrate. One cost field; admin paint tool (oceans/borders) as first writer, emergent walls/roads as later writer. Per-channel diffusion: `trail` blocked by barriers; `claim`/`danger` diffuse everywhere and fade with distance (claim the beach, reach across a narrow strait, die over a wide ocean — tuned via decay constant). Cost-based so roads pay down barriers.
- **PETRIARCH_FEATURE_cognition.md** — tunable cognition as a weighted-sum move decision. Knob A: live `cognitionLevel` scalar. Knob B: input toggle bank (experiment + perf; disabled terms must SKIP the texture sample). Presets Worm/Ant/Colony/Evolved. Forage/return state machine = the one genuinely new mechanism (and the prerequisite for trade). At the evolved rung, `final_weight = slider × gene`.
- **PETRIARCH_FEATURE_ratchets_history.md** — persistence ratchet (ruins outlive builders) → tech ratchet (sticky per-species tech) → faction memory matrix (species×species hostility) → focal-point/"worship" field → observer god-tools. Principle: make the world keep score.
- **PETRIARCH_FEATURE_collective_cognition.md** — aggregate fields + quorum thresholds → collective behavior as a phase transition. Records WHY external-LLM-for-agents was rejected (breaks the closed system; architectural mismatch; it's intervention not emergence) and parks "consult Claude about the dish" in the observer god-tool layer instead.

## Forward roadmap (suggested global order)

This sequences the feature docs into one build path. Each doc has its own internal checkpoints; respect those gates.

1. **Passability substrate + admin paint** (PETRIARCH_FEATURE_passability) — foundational; unblocks seeding species in separate basins. Build before/with stigmergy fields.
2. **Stigmergy fields** (NET_LAYER Phase 1) — `trail`/`claim`/`danger` with the per-channel diffusion rules from the passability doc. Observe before building more.
3. **Cognition: Ant rung** (FEATURE_cognition) — weighted-sum moves reading those fields; wire the slider + toggle bank from the start. This is the biggest apparent intelligence jump.
4. **Civilization tiers + structure layer** (NET_LAYER Phases 2–3) — local accumulators, settled state, walls/roads/depots writing into the passability field.
5. **Cognition: Colony rung + forage/return state machine** (FEATURE_cognition) — more field terms; the state machine that unlocks hauling/trade.
6. **Network graph** (NET_LAYER Phase 4) — depots → CPU nodes, trail-ridge edges, trade/war/construction on the graph.
7. **Ratchets & history** (FEATURE_ratchets_history) — persistence (ruins) → tech → faction memory → focal points. This is what turns the running sim into a world with a past.
8. **Cognition: Evolved rung** (FEATURE_cognition) — behavior weights into the genome; `final = slider × gene`; archetypes emerge from selection.
9. **Collective cognition** (FEATURE_collective_cognition) — aggregate fields + quorum phase transitions, once population-scale dynamics are stable.
10. **Observer god-tools** (ratchets Step 5) — generalize the paint tool into plagues/resources/idols; optionally a "consult Claude about the dish" tool for the operator (not the agents).

## Standing invariants (apply throughout)

- **Tradeoff invariant:** no civilization mechanic is a pure bonus. Settling raises visibility; construction locks reproduction surplus; roads are exploitable by invaders. Civilization is expensive and vulnerable, not strictly better.
- **Intelligence locus:** never per-agent brains. Fields + reading + genome only.
- **Closed system:** no external information enters the agents' decision loop. External oracle (Claude) is an operator tool, not an agent capability.
- **History over headcount:** prefer mechanisms that make the world persist/accumulate/remember over mechanisms that just add agents or raise individual complexity.
- **Build-then-observe:** each layer ships and is watched in isolation before the next; the stigmergy fields alone may produce most of the desired structure.
