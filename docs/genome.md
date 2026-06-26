# Petriarch — Genome Spec

The genome is the heart of the project. Every gene is a `float` stored in a flat SoA buffer. The **design law** is: *no gene may be purely good.* Every gene either carries a direct metabolic cost or trades off against another gene. A gene with no cost will max out across the whole population and cease to be a variable — that's a bug, not a feature. The goal is a space where **multiple distinct strategies coexist** because the optima are *frequency-dependent* (the best strategy depends on what everyone else is doing), not a single global optimum the whole population converges to.

There is **no fitness function.** Selection is only: agents that stay fed and reproduce leave more copies. The genes below shape *how* an agent tries to do that; the environment decides which attempts pay off.

---

## Buffer layout (the contract)

Genes live in one flat `Float32Array`, agent `i`'s genome at `[i * GENE_COUNT .. i * GENE_COUNT + GENE_COUNT)`. Indices are constants in `src/data/genome.ts`. Access is **always** `genes[i * GENE_COUNT + GENE_X]`. This layout is identical to what a WGSL compute shader binds, which is what makes the Tier A steering pass a mechanical port.

```ts
// src/data/genome.ts
export const GENE = {
  // --- metabolic / body ---
  SIZE:            0,
  METABOLIC_RATE:  1,
  REPRO_THRESHOLD: 2,
  LIFESPAN:        3,
  FERTILITY:       4,
  MUTABILITY:      5,
  // --- steering / behavior ---
  KIN_COHESION:    6,
  SEPARATION:      7,
  RESOURCE_ATTRACT:8,
  THREAT_AVOID:    9,
  WANDER:          10,
  AGGRESSION:      11,
  // --- social tag ---
  SIG_A:           12,
  SIG_B:           13,
  SIG_C:           14,
} as const;

export const GENE_COUNT = 15;

// Per-gene [min, max] for clamping after mutation. Tunable.
export const GENE_RANGE: Record<number, [number, number]> = { /* ... */ };
```

`GENE_COUNT` is the stride. Adding a future gene = append an index, bump the count, extend ranges — pools and shaders read the constant, so nothing else changes structurally.

---

## Metabolic / body genes (the cost backbone)

These define what an agent *is* and carry the energy costs everything else trades against.

### `SIZE`
Scales max energy storage, conflict strength, and move cost. Bigger = wins fights, survives famine longer, but burns more energy and needs more food. **The master tradeoff gene** — most other genes partly trade against it. Aggression without size is suicide; size without food income is starvation.

### `METABOLIC_RATE`
How fast energy converts to action (speed / think responsiveness) vs. how slowly it drains. High = quick, reactive, but starves fast. Low = sluggish but endures scarcity. Produces the **fast-greedy vs. slow-enduring** lineage split when fighting against `SIZE`.

### `REPRO_THRESHOLD`
Energy required to reproduce. The r/K axis (part 1). Low = breed early/often/cheap, fragile individuals (swarm). High = hoard energy, breed rarely into well-provisioned offspring. Interacts with `FERTILITY` to make a 2D reproductive-strategy space.

### `LIFESPAN` (senescence) — *chosen body gene*
Ticks before age-decline sets in; past it, metabolic drain rises and/or conflict strength falls (senescence). Long-lived agents accumulate energy and out-last famines but naturally pair with slow breeding — a long life is wasted if you also breed fast and cheap, because you'll be out-bred. Short-lived agents *must* breed young or vanish. Trades against `REPRO_THRESHOLD`. Gives the **ancient slow dynasty vs. fast-burning swarm** axis.

### `FERTILITY` (litter size) — *chosen body gene*
Offspring produced per reproduction event. High = many offspring splitting the parent's energy (each starts poorer, more fragile). Low = few well-provisioned offspring (each starts richer). The r/K axis made explicit (part 2). With `REPRO_THRESHOLD` this gives a full reproductive-strategy plane: cheap-and-many, cheap-and-few, costly-and-many, costly-and-few — each viable under different resource regimes.

### `MUTABILITY` (self-mutation rate) — *chosen body gene*
The per-agent mutation rate this agent applies to *its own* offspring. **A gene that controls evolution itself.** High-mutability lineages adapt fast to player perturbation but throw many nonviable offspring (wasted energy). Low-mutability lineages breed true and stable but adapt slowly. This should self-tune: under heavy player meddling, high-mutability lineages should win; in stable worlds, low-mutability should dominate. The most artificial-life-research gene of the set and the most likely to produce a genuinely surprising result. Implementation note: mutation reads `genes[i*GENE_COUNT + MUTABILITY]` instead of a global constant — a small change to the reproduce system, no architectural impact. `MUTABILITY` mutates itself at a small floor rate so it can never lock to zero.

> **Morphology body genes (Milestone 2).** `RESILIENCE` (index 15, **implemented**) —
> armor: less conflict loser-damage + hazard drain, paid for by heavier movement; holds
> a frequency-dependent tradeoff (armored vs unarmored body types coexist). `EFFICIENCY`
> (index 16, **implemented**) — digestion: more energy per *unit* resource (depletes less
> of the field for the same energy — a sustainable niche), paid for by lower max speed;
> raises carrying capacity as it spreads. Tunables in `src/data/morphology.ts`; effects
> live in metabolism (intake/move/hazard), integrate (speed), conflict (damage). Visual:
> RESILIENCE desaturates the node (metallic), EFFICIENCY lightens it (`netRenderer`).
> Still a stub: `SENSORY_RANGE` (perception radius — costs energy per tick and enlarges
> the spatial-hash query, so it needs a variable-size neighbor query; deferred).

---

## Steering / behavior genes (Tier A — read by the steering pass)

Read every `THINK_INTERVAL` ticks to compute a weighted steering vector. All trade off against each other or carry exposure costs.

### `KIN_COHESION`
Pull toward genetically-*similar* neighbors (similarity read from the signature genes). High = tight tribes with group defense, but heavy resource competition *within* the cluster. Low = loners — no group protection, but no in-group competition. Tribalism has a real cost, which is what keeps loners viable.

### `SEPARATION`
Personal-space repulsion. Trades directly against `KIN_COHESION`: too low and clusters self-crowd and starve locally; too high and they can't cohere. Together these two set cluster density — and thus how mesh-like the cyber-net skin looks.

### `RESOURCE_ATTRACT`
Pull toward resource sites. Looks purely good, so its cost is **exposure**: high attraction draws the agent into contested sites where it meets dissimilar agents. Greedy = fed but in danger. This is the gene that makes the conflict layer bite.

### `THREAT_AVOID`
Flee from dissimilar/aggressive neighbors. Trades directly against `RESOURCE_ATTRACT` (the food is where the danger is) and against `AGGRESSION`. Cowards survive but cede resources — a viable distinct "fleeing lineage" strategy, not just a loss condition.

### `WANDER`
Random-exploration drive (seeded). Costs energy (moving for no immediate gain) but discovers new resource sites as old ones deplete. Pure homebodies get trapped on dying resources; pure wanderers waste energy. Keeps migration in the gene pool — important once resources clump/deplete.

### `AGGRESSION`
Likelihood of contesting (fight) vs. ceding (flee) when meeting a dissimilar agent at a resource. Trades against `THREAT_AVOID`, gated by `SIZE` (aggression without size is suicide). The distribution of aggression across a cluster decides whether a frontier is a hot war or a cold standoff.

---

## Social-tag genes (the source of group identity)

### `SIG_A`, `SIG_B`, `SIG_C`
A 2–3 dimensional **genetic tag** — a point in tag-space. **Not directly selected.** It's the value `KIN_COHESION` and the conflict rule *read* to decide "same group vs. different group" (similarity = distance in tag-space under a threshold). Because the tag drifts under mutation, lineages slowly diverge in tag-space — and that divergence *is* the creation of new tribes. You never author a tribe; a tribe is a cluster of agents close in tag-space that cohere to each other and contest outsiders.

**Rendering hook:** map the signature to hue (see `simulation-systems.md` §Rendering). You then literally *watch speciation as colour drift* — one lineage's hue sweeping the map, or a cluster splitting into two diverging colours at a frontier.

---

## Mutation model

On reproduction (Tier B, `sim/tierB/reproduce.ts`):

1. Offspring genome = copy of parent's genome buffer slice into a freed pool slot.
2. For each gene, with probability/scale derived from the parent's `MUTABILITY` gene, add seeded Gaussian-ish noise (use the mulberry32 stream — never `Math.random()`).
3. Clamp each gene to its `GENE_RANGE`.
4. `MUTABILITY` itself mutates at a small floor rate so it can drift but never lock to zero.
5. Signature genes mutate like any other — this is what drives speciation.

Two global tuning knobs matter more than any single gene value, exposed as dev sliders:

- **Base mutation scale** — too low: no diversity, the population freezes; too high: no lineage persists, it's noise. (Per-agent `MUTABILITY` modulates around this base.)
- **Resource regrowth rate & spatial distribution** — clumped resources favor territorial hoarders; scattered resources favor wanderers. *The map selects for strategy.* This is a lever both you (dev) and the player (god) pull.

---

## Why this doesn't collapse to one optimum

The optima are **frequency-dependent**, a rock-paper-scissors-ish dynamic that emerges from the tradeoffs — you don't author it:

- In a world full of aggressive hoarders, a fast-breeding coward lineage thrives in the margins.
- In a world of cowards, an aggressor sweeps.
- Which then makes cowardice pay again.

Add the reproductive plane (`REPRO_THRESHOLD` × `FERTILITY` × `LIFESPAN`) and the evolvability axis (`MUTABILITY`), and there is no single point that wins against all comers under all maps. That churn is the game.

**Success test for the genome (run in milestone 1, headful; later confirmed headless):** distinct strategies emerge *and persist* — e.g. a fast-greedy lineage and a big-territorial lineage coexisting, or one out-competing the other under different resource layouts. If the population converges to one boring optimum every run, the genome lacks tension — add/strengthen a tradeoff before adding features.
