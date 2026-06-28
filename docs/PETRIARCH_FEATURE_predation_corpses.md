# Feature: Predation, Corpses & the Energy Economy

> **Status:** FOUNDATIONAL feature for an in-progress project — should have been early. It changes the sim's **energy economy**, which everything else (cognition, civilization, cyber mechanics) sits on top of. Treat as a retrofit to the core, not a bolt-on. Builds on genetics, combat, stigmergy fields, and ties directly into the cyber "death-as-data" mechanic.

## Why this is foundational (state up front)

Currently the only energy source is the food grid — every agent ultimately eats plants. That is *why green wins*: shortest path to energy. Letting agents eat each other adds a **second trophic level**: other agents become a resource, so population density itself becomes food. This breaks the green monoculture **without nerfing green** — a predator doesn't compete with green for plants, it eats the things that eat plants. The result is a real **food web** instead of one big farm.

This is not a combat tweak. It is the predator / prey / scavenger triangle, and it must be designed as **three roles**, not one "can eat" flag.

## Core design: the corpse is a real entity (decouple kill from meal)

Do NOT make eating an instant energy transfer on combat win. When an agent dies (combat, starvation, or age) it drops a **corpse**: a real, temporary entity holding the dead agent's stored energy + a **decaying copy of its genes**.

Why corpse-as-entity is the right design:

- **Separates the three roles cleanly.** Predator *makes* corpses (wins combat). Carnivore *eats* fresh corpses it didn't necessarily make. Scavenger/corpse-eater *specializes* in corpses others left. Three genes, three niches — the corpse entity lets them coexist instead of collapsing into one "eat" action.
- **Creates a decomposition timeline.** Corpse freshness decays: full energy when fresh, less as it rots, eventually gone. Corpse-eaters race the rot.
- **It IS death-as-data** (cyber doc). A corpse is recoverable state on the field; eating it is the horizontal-gene-transfer vector. Corpse-eater traits and "read dead agents' genes" are the same mechanic — this feature grounds that one.

## Gene cluster (separate genes, not one slider — so archetypes combine)

- **Carnivory** — does the agent gain energy from eating agents/corpses at all? (0 = pure herbivore, ignores corpses; 1 = full carnivore.) Splits the population into trophic levels by itself.
- **Kill-to-eat drive** — after winning combat, likelihood of consuming the loser vs. just displacing them. ("Not guaranteed, genes tell them to.") High = active predator; low = territorial, not predatory.
- **Consumption purpose** — what the gained energy does: **feed** (restore own energy) vs. **fuel reproduction** (eating triggers a breed event). Same meal, different downstream. Breed-on-kill species boom then crash their own food source — self-limiting and interesting.
- **Corpse preference (scavenger)** — appetite for old/found corpses specifically. High = vulture niche: eats what it didn't kill, races the rot, low combat investment.
- **Cannibalism tolerance** — will it eat its OWN species? Big dial. Tolerant species survive famine by eating their own (brutal, resilient); intolerant ones starve together but stay cohesive. Flips behavior at population extremes — worth its own gene.

### Emergent archetypes (evolved, never assigned)
- **Predator:** high carnivory + high kill-drive + low corpse-pref.
- **Scavenger:** high carnivory + low kill-drive + high corpse-pref.
- **Cannibal-survivor:** high cannibalism tolerance, dormant until famine.
- **Breed-on-kill swarm:** high kill-drive + reproduction-purpose.

## Tradeoffs (per project invariant — carnivory must COST, or everything evolves to eat everything)

- **Carnivores eat plants poorly or not at all** — specializing into meat trades the reliable food grid for an unreliable, mobile food source. Predators starve when prey thins; herbivores never run out of grass. Classic predator boom-bust — self-balancing.
- **Hunting is combat, combat is risk** — making corpses means fighting means sometimes *becoming* the corpse. Predation is high-variance energy.
- **Corpse-eating risks corruption** — salvage and infection share a vector (cyber doc). Eating the dead can transmit a `corrupted` flag. Scavengers trade safety for the rot they eat.
- **Cannibalism degrades cohesion** — eating your own raises local `danger` / lowers `claim`, fraying the clumping that makes a species strong.

## Optional: the nutrient loop (closes the ecosystem — high feel-of-life payoff)

On corpse expiry (fully rotted), deposit into a **nutrient field** that boosts local food regrowth. Closes the cycle:

```
plants → herbivores → predators → corpses → nutrients → plants
```

A *complete ecosystem*, not a food chain with a dead end. Death feeds the soil. One extra field write on corpse expiry; makes the whole dish feel alive because matter stops vanishing and starts cycling. Recommended.

## Build order

1. **Corpse entity** — on any death, drop a corpse holding stored energy + decaying gene copy + freshness timer. Render them (little corpses). This alone is visible and grounds everything else.
2. **Carnivory + eating** — agents with carnivory gain energy by consuming corpses (and/or fresh kills). Wire energy transfer through the corpse, not instant-on-win.
3. **Kill-to-eat drive** — post-combat consume-vs-displace roll driven by the gene. Now predators actively make-and-eat.
4. **Corpse preference / scavenger niche** — appetite for old corpses; verify a low-combat scavenger archetype can survive on others' kills.
5. **Cannibalism tolerance** — own-species eating, gated by gene; verify famine-survival behavior at population extremes.
6. **Consumption purpose** — feed vs. breed-on-kill split.
7. **Corruption tie-in** — corpse-eating as a `corrupted`-flag vector (coordinate with cyber death-as-data).
8. **Nutrient loop** (optional, recommended) — rotted corpses → nutrient field → food regrowth.

## Verification checkpoints

- Corpses appear on death, hold energy, decay in freshness, expire.
- A carnivore species sustains itself on corpses/kills and does NOT thrive on plants — confirm the trophic split (carnivores starve when prey thins).
- Predator/prey populations show boom-bust oscillation rather than monoculture — this is the green-monoculture break.
- A scavenger archetype survives primarily on corpses it didn't make.
- Cannibalism activates as a famine survival behavior in tolerant species and is absent in intolerant ones.
- (If built) nutrient loop visibly boosts regrowth where corpses rotted — matter cycles rather than vanishes.

## Note for Claude Code

This touches the **energy economy** that later features assume. Sequence it BEFORE deep balancing of cognition/civilization tiers, since those were tuned against a plants-only economy and predation changes the baseline. Re-verify the green-monoculture behavior after this lands — it should no longer be the default equilibrium.
