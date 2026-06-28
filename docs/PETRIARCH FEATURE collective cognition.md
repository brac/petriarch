# Feature: Collective Cognition (emergent, not declared)

> **Status:** new feature / design direction for an in-progress project. Builds on the cognition layer (weighted-sum agent moves, gene-weights), stigmergy fields, and the ratchets/history layer. Premise: these are electronic agents — alone, each is a couple of branches and some values. The goal is that **enough of them together think in more complex ways as a whole**, where the "thinking" is computation distributed across many agents that no single agent performs.

## Core principle (state up front, do not violate)

**You do not give the collective a brain. You make the collective's behavior depend on aggregate state that only exists when there are enough of them.** Collective cognition is a **phase transition**: below a population/density, the aggregate field signal is too weak to cross thresholds and they're just agents; above it, the aggregate crosses thresholds and the group acts as a unit. Consciousness-as-phase-transition. This is GPU-cheap (field reads + thresholds) and, crucially, **emergent rather than hard-coded** — which is the only version worth building.

## Why the obvious alternatives are wrong (record the reasoning)

Two tempting paths were considered and deliberately NOT taken as agent capabilities:

**A. "Hit a milestone → unlock a bigger decision tree."** Has legs *as a mechanic* (it's the tech ratchet) but it is NOT collective consciousness — it's individual agents being more complex, the exact thing the 20k-on-one-GPU constraint resists. Use it as a cognition tier; do not mistake it for emergence.

**B. "Agents reach a level → get Claude API access to ask for info/improvements." REJECTED as an agent capability.** Reasons, recorded so this doesn't get reintroduced:
1. **Breaks the closed system.** Petriarch's whole meaning is that intelligence emerges *from within the rules*. An external LLM injecting information turns an artificial-life experiment into a chatbot wearing a swarm as a costume — borrowed intelligence, not grown.
2. **Architectural mismatch.** Sim ticks at frame rate over 20k GPU agents; an API call is seconds of latency, rate-limited, returns *language*. Translating "a paragraph" into "a WGSL buffer change" is itself the hard part, and that translation layer — not the agents — would be doing the thinking.
3. **"Ask for improvements" = Claude improves them, they receive it.** That's divine intervention with an API key, not self-improvement.

> **Where B legitimately lives:** the **observer/god-tool layer.** YOU (as Lisa) may consult Claude about the state of your dish as an explicit intervention you trigger. The agents reaching into Claude themselves is out of scope. Keep this boundary.

## The version with legs — collective mind = field state

The substrate already exists: a trail network finding the shortest path between two food sources is the colony solving a problem no individual ant understands — distributed computation, literally. Extend that:

### 1. Aggregate fields as the medium of thought
Add channels meaningful only at population scale:
- **Population-pressure gradient** — crowding/scarcity as a field.
- **Consensus-direction field** — blurred average of many agents' movement intents.
A migration that emerges when enough agents' individual pressure-reads align is the swarm "deciding" to move. No agent decided; the **field** decided.

### 2. Quorum thresholds → collective state changes (the legitimate "milestone")
The GPU-cheap, genuinely-collective version of "hit a milestone":
- Read **local density** of same-species agents from a field (NOT a global counter).
- When it exceeds a threshold, the **group** unlocks a behavior: coordinated build, mass migration, swarm-assault.
- The unlock is keyed to **collective mass**, so it is a property of the many, not the one.
- This is quorum sensing (how real bacteria collectively "decide") — and it's a texture read.

### 3. The species as the thinking unit
Stack: faction-memory (ratchets doc) + tech ratchet + quorum behaviors + aggregate fields. The **species** becomes the entity with memory, goals, and decisions — while every individual stays a couple of branches and some values. That is the collective consciousness: emergent, distributed, owned — not declared.

## The reframe in one line

Below a population, the aggregate signal is too weak to cross thresholds — just agents. Above it, the aggregate crosses thresholds and the group acts as a unit. **Make collective behavior depend on aggregate state that only exists at scale.**

## Build order

1. Add aggregate fields: population-pressure gradient; consensus-direction (blur of intents).
2. Add quorum-threshold reads (local same-species density) gating group behaviors: start with one — e.g. mass migration when pressure quorum is crossed.
3. Wire one quorum-unlocked collective action end to end; confirm it fires only above a density and stops below it (the phase transition).
4. Layer additional quorum behaviors (coordinated build, swarm-assault) once the first works.
5. (Observer layer, separate) optional god-tool: you consult Claude about dish state. Explicitly NOT an agent capability.

## Verification checkpoints

- Aggregate fields read correctly: pressure rises with crowding, consensus-direction reflects majority intent.
- Quorum behavior exhibits a **phase transition**: below threshold density → agents behave individually; above → the group acts as a unit. Sweep population/density and confirm the transition is sharp, not gradual.
- The collective action is genuinely emergent: no global flag triggered it, only local aggregate state crossing a threshold.
