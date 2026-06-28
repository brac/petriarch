# Feature: Ratchets & History (the civilization layer)

> **Status:** new feature for an in-progress project. Builds on stigmergy fields, civilization tiers, structure layer, and genetics. North star: the Simpsons "Treehouse of Horror" petri-dish-civilization — a world that rises, wars, advances, and worships on fast-forward. What makes that read as *civilization* is not agent intelligence; it's **history** — the past accumulating and constraining the present.

## Core principle (state up front)

**Everything in Petriarch currently decays back to equilibrium. Civilization is the state that does NOT decay back.** Food regrows to a cap, claim fades, trails evaporate, dead agents disperse. A petri-dish civilization needs **ratchets**: state that accumulates and persists, decoupled from the agents that made it, so the sim has a *history* instead of only a *present*. The difference between an ecosystem (what Petriarch already is) and a civilization (the goal) is that the civilization's tick 10,000 is shaped by everything that happened in ticks 1–9,999.

Cognition makes agents act smart now. Ratchets make the world remember. This doc is the "remember" half.

---

## Step 1 — Persistence ratchet (highest civilization-feel per effort)

Generalize the structure layer: built things **outlive their builders**.

- When a species builds a depot/wall/road and then dies out, the structure **stays** as a **ruin**.
- Later species **find, reuse, or build on** ruins.
- Result: the map accumulates the layered remains of dead civilizations — **archaeological time**. A map showing three dead civs' ruins *reads* as a world with history before anything else is even smart.

Mostly "stop deleting structures when the owner dies." Add: an `ownerless`/`ruin` flag on structure cells; reuse rules (a new species claiming a ruin gets a head-start vs. building from scratch).

**Checkpoint:** let a species build, then drive it extinct (plague god-tool / famine). Confirm structures persist as ruins and a later species can occupy/extend them.

---

## Step 2 — Tech / knowledge ratchet (the "fast-forward" magic)

Per-species (or per-region) **tech level**: an integer that **only ratchets up**, never falls back.

- Rises when conditions met: surplus accumulated, population sustained over N ticks, depots networked.
- Each level **unlocks persistent rule changes**: better food conversion, longer-range trail, stronger walls, eventually ranged conflict.
- **Stickiness is the point:** a species at tech 3 that gets battered down to a few agents **does not forget** — it rebuilds faster than a fresh species. Knowledge persists through population crashes.
- That asymmetry (knowledge survives population loss) is what lets some species pull ahead and *stay* ahead → the precondition for an arms race.

This is a per-species ratchet version of the civ-tier system; the difference from tiers is **no fallback** and **per-species memory**.

**Checkpoint:** confirm tech rises with sustained surplus, unlocks stick, and a crashed-but-high-tech species recovers faster than a new low-tech one.

---

## Step 3 — Faction memory matrix (standing grudges & alliances)

Species currently are just genetic clusters. Give species **persistent relational state**.

- A **species×species hostility matrix**: a small float matrix (NOT per-agent), updated on conflict events, decaying slowly.
- Border bloodshed raises hostility between that pair → standing rivalry that carries into the next encounter.
- Pairs that never fight can drift toward trade-preference / low hostility → proto-alliance.
- Cheap: a few floats per species pair. Turns one-off skirmishes into "the blue species has always hated the green species."

**Checkpoint:** two species that fought at a border show elevated hostility on next contact (faster escalation); two that never met interact more peaceably.

---

## Step 4 — Focal-point / "worship" field (optional, the literal Simpsons joke)

Can't get literal religion; can get its mechanical shadow.

- A **focal-point field**: a strong attractor that isn't food/safety — a monument, a high-tech depot, or an admin-placed "idol."
- Give species an evolvable **gene-weight toward focal points, decoupled from survival utility**.
- If high-social species drift toward congregating at a non-functional focal point → **proto-ritual**: behavior organized around a thing that is not food or safety.
- Cheap: one more field + one more gene-weight. Whether it emerges is an **experiment, not a guarantee** — that's the point.

**Checkpoint:** place a focal point with no survival value; observe whether high-social/high-focal-weight species congregate/orient around it.

---

## Step 5 — Observer / intervention layer (you are Lisa)

The scene's framing: someone watches and occasionally intervenes. The admin paint tool already started this — make it first-class.

- **God-tools:** drop resources, plagues, barriers, focal points; watch civilizations respond.
- Not civilization mechanics per se — the **instrument** that makes the dish legible and lets you probe how far the systems go.
- Reframe: Petriarch is a **terrarium you can poke**. Half the project's value is the poking.

(See the collective-cognition doc: any "consult an external oracle about the dish" capability belongs HERE as an explicit god-tool you trigger, never as an emergent agent ability.)

**Checkpoint:** each god-tool produces a legible, observable response in the civilizations.

---

## Build order

1. Persistence ratchet (ruins outlive builders) — cheapest civilization-feel, do first.
2. Tech ratchet (sticky per-species tech level + persistent unlocks).
3. Faction memory matrix (species×species hostility).
4. Focal-point field + gene-weight (experiment).
5. Observer god-tools (generalize the paint tool).

## Meta-principle for Claude Code

Build toward **history, not more agents.** Every step here is a variation on one idea: *make the world keep score.* Persistence (structures outlive builders), accumulation (tech only ratchets up), memory (factions hold grudges), focal points (meaning attaches to places). Nothing here makes an individual agent smarter — it makes the world unable to fully reset.
