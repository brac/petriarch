# Feature: Agent Cognition (tunable, slider-driven)

> **Status:** new feature for an in-progress project. Builds on the existing stigmergy fields and genetic-reproduction systems. Core principle below must be respected: **intelligence does not live in individual agents as brains/NNs/behavior-trees.** With ~20k agents in WGSL on a single GPU, per-agent brains are not affordable. Intelligence lives in three GPU-cheap places: the agent's *reading of shared fields*, the *fields themselves* (collective memory), and the *genome* (tuned by selection). Do not propose per-agent neural nets.

## Core architecture: cognition is one weighted sum

Every level of cognition is the **same move-decision sum** with more terms enabled and/or higher weights. This is what makes cognition tunable with a slider — "more cognition" = "more terms, higher weight," nothing structurally new per rung.

```
move =  w_rand   · random
      + w_food   · ∇food
      + w_trail  · ∇trail
      + w_danger · (−∇danger)      // descend danger
      + w_kin    · ∇kin            // toward same-species density
      + w_claim  · ∇claim
      + ...                        // one term per readable field
```

- **Worm:** only `w_rand` nonzero → random walk (current behavior).
- **Ant:** `w_food`, `w_danger` on → gradient-following. This is the single biggest cognition jump and it's nearly free (a few texture reads). Build this first.
- **Colony:** more channels in the sum (`trail`, `kin`, `claim`) → environment stores more computation; species "knows" things no individual holds.
- **Evolved:** the `w_*` come from genes; selection tunes them; archetypes (bee-like, wolf-like) emerge as gene-weight combinations, not hand-coded roles.

## Two independent tuning knobs

### Knob A — global cognition scalar (the live slider)

A single uniform `cognitionLevel ∈ [0,1]`, pushed to the kernel per frame, scaling the non-random terms against `w_rand`:

- `0` → fields ignored, pure random walk (worm).
- `1` → full action on gradients.
- Dragging the slider changes all 20k agents **live** — no recompile, no restart. One uniform.

This is the primary tuning/experimentation control.

### Knob B — input toggle bank (behavior isolation AND performance)

A bitmask of enabled terms: `food`, `trail`, `danger`, `kin`, `claim`, + `stateMachine` (see below). Disabled term → dropped from the sum.

Two purposes at once:
1. **Experiment:** isolate which channel produces which emergent behavior (food+danger only, vs. +trail, vs. +kin).
2. **Performance / smaller runs:** each enabled field term costs N texture reads per agent per tick. Disabling a term removes its sampling. This is the knob for running on weaker hardware than the 3090.

> **Build note (critical for the perf benefit):** a disabled term must **skip the texture sample**, not sample-then-multiply-by-zero. Implement as either (a) branch on a per-term uniform flag — safe here because all 20k agents take the same branch, no warp divergence — or (b) a few compiled kernel variants (cheap / medium / full) keyed to the mask. Branch-on-uniform is simpler and preferred. If terms are sampled then zeroed, the performance knob does nothing.

## Presets on top of the same machinery

A preset is just a `(cognitionLevel, enabledMask)` pair. The slider fine-tunes within/between presets.

| Preset | cognitionLevel | Enabled terms |
|---|---|---|
| Worm | 0 | rand only |
| Ant | 0.7 | food, danger |
| Colony | 0.9 | food, danger, trail, kin |
| Evolved | gene-driven | all + state machine, weights from genome |

## The forage/return state machine (the one genuinely new mechanism)

Pure gradient-following has a ceiling: agents can't act on **internal state** ("I'm carrying food → switch from seek-food to return-to-density"). Add a tiny per-agent state: an integer enum of 2–3 states (`forage` / `return` / optionally `flee`), with transitions driven by field reads + a couple of genes.

- Cost: one int in agent state + a switch in the kernel. **Not** a brain.
- This is the prerequisite for trade — hauling goods between depots requires a carry/return cycle.
- Exposed as its own toggle in Knob B; off → agents revert to stateless gradient-followers.

This is the rung to plan as real new work. Everything else is reads + genes bolted onto the existing kernel.

## Intelligence-locus reference (state up front so it isn't violated)

| Locus | Mechanism | Cost |
|---|---|---|
| Individual (reactive) | reads local field gradients, biases move | ~free (texture reads) |
| Environment (collective memory) | stigmergy channels store/compute info no agent holds; trail reinforce-on-use / decay-on-disuse = colony learning a route | cheap (more passes) |
| Genome (slow optimizer) | behavior weights are genes; reproduction mutates, selection tunes; different species evolve different cognition | ~free (more genes + mutation) |

"Bee" / "wolf" behaviors are **points in the evolved gene-weight space**, not engineering milestones. Bee-like ≈ high trail-weight + high kin-weight. Wolf-like ≈ high prey/food-weight + high kin-weight + low danger-weight. Do not hand-code these; let them evolve.

## Slider × gene resolution (avoid the conflict at the top rung)

At the Evolved rung, `cognitionLevel` is no longer a single global constant — per-agent behavior weights come from the genome. To keep the UI slider and the genome from fighting over the same number:

**final_weight = slider_global_multiplier × gene_baseline**

- Genes set each agent's per-term baseline weights.
- The slider is a **global multiplier / ceiling** scaling all genetic values at once.
- At lower presets (Worm…Colony) genes are unused and the slider sets weights directly.

State this explicitly in the implementation so the two systems compose instead of overwrite.

## Build order

1. **Ant rung:** add the weighted-sum move decision with `food` + `danger` gradient terms reading the existing fields. Wire `cognitionLevel` uniform (Knob A) and the toggle mask (Knob B) from the start — even with two terms. Verify slider live-changes behavior worm↔ant.
2. **Colony rung:** add `trail`, `kin`, `claim` terms to the sum. Confirm each toggle isolates a behavior and that disabling skips the sample (check perf delta).
3. **State machine:** add forage/return(/flee) integer state + transitions. Toggle-gated. Verify it's the prerequisite for carry/haul behavior.
4. **Evolved rung:** move per-term weights into the genome; apply `final = slider × gene`. Confirm archetypes emerge from selection (don't assign them). Confirm slider now acts as global ceiling.

## Verification checkpoints

- After rung 1: slider at 0 = random walk, slider at 1 = agents climb food / flee danger. Live drag visibly changes 20k agents.
- After rung 2: toggling `trail` off collapses route-following; toggling `kin` off collapses flocking. Confirm a disabled term's GPU cost actually drops (it skips the sample).
- After rung 3: agents with food switch to return-state and head toward density; toggling state machine off reverts to wandering gradient-followers.
- After rung 4: two species under different selection pressure evolve measurably different weight profiles. Slider scales all of them as a global ceiling without overriding genetic differences.
