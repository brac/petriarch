# Feature: Cybernetic Mechanics (theme-native layer)

> **Status:** new feature / design direction for an in-progress project. This is the layer that makes Petriarch specifically a **cyber-net** sim, not a civilization-of-little-people sim. Builds on stigmergy fields, cognition (weighted-sum moves + genes), the network graph, and ratchets/history.

## Core reframe (state up front)

The "little people in huts" framing silently imports human assumptions: agents are discrete, bodies are bounded, death is final, communication is local and slow, identity is fixed. **Electronic agents obey none of these.** Dropping each assumption unlocks a mechanic with no hut equivalent — and all of them are cheap reads/writes on the existing stack.

The hut model asks *"what would little people build?"* The cyber model asks *"what would a population of processes compute, transmit, and become?"* Build toward the second question.

These are electronic agents. Mechanics should exploit that, not hide it.

---

## Mechanic 1 — Merge / fork (bodies aren't bounded)

Huts can't fuse two villagers into one; processes can.

- Under defined conditions (proximity + matching species + sufficient surplus/quorum), two or more agents **fuse** into a single higher-capacity unit: more internal state, higher cognition weight, larger carry capacity.
- An overloaded unit can **fork** back into several agents.
- Implications: growth gains a second axis beyond reproduction — **concentration**. A merged super-agent might be the only unit able to cross a high-cost barrier, or to run the forage/return cycle at higher throughput, or to hold enough state for advanced behavior.
- Cost: two agents' state combining into one slot (and the inverse). GPU-natural.
- **This is the single biggest divergence from the hut model.** Population stops being the only measure of power; density/concentration becomes one too.

**Tradeoff (per project invariant):** a merged unit is one big target, loses the swarm's spatial coverage, and a single death removes a lot of accumulated state. Concentration trades resilience for capacity.

---

## Mechanic 2 — Death-as-data (death isn't final, it's a state)

A dead agent leaves recoverable **state**, not just a `danger` deposit. Three sub-mechanics:

- **Horizontal gene transfer:** a species can *read dead agents' genes off the field* and incorporate them — adopting traits from the fallen (bacteria do this; huts can't). Lets a species acquire capability without evolving it.
- **Corruption (a literal virus):** agents/fields can carry a `corrupted` flag that **spreads on contact and degrades behavior**. A propagating malware-like force through the population — first-class, not flavor.
- **Resurrection:** a high-tech species rebuilds a dead one's state from ruins (ties to the persistence ratchet).

Death-as-data is the most thematically cyber mechanic available, and it's all reads/writes already in the pipeline.

**Tradeoff:** reading the dead exposes you to corruption riding the same channel; salvage and infection share a vector.

---

## Mechanic 3 — Conversion conflict (identity is mutable)

The hut model's only conflict verb is "kill." Cyber agents have a second: **convert / infect / recruit.**

- Border conflict can **flip the loser's species allegiance** (rewrite the species tag, recolor live) instead of reducing their count.
- War becomes **propagation**, not attrition. A species can win by converting rather than killing.
- Produces entirely different map dynamics: a slow viral/ideological takeover vs. a violent front. Different species (by gene-weight) could favor one mode or the other.
- Cost: one gene-weight (kill-lean vs. convert-lean) + a tag rewrite on resolution.

**Tradeoff:** converts may carry residual traits/corruption from their old species; a converted population is less genetically pure and potentially a fifth column.

---

## Mechanic 4 — The on-net broadcast bus (communication isn't local)

Stigmergy fields are mouth-to-mouth: spatial, slow, distance-limited. Networked agents get a **non-spatial channel**.

- A species-wide **broadcast register**: any sufficiently-connected agent can write it; all connected members read it instantly, regardless of map distance.
- The cyber answer to "how does the collective coordinate across the map without the signal diffusing away."
- **Gate it behind the network graph: you must be ON the net to use the net.** Only depot-connected agents get bus access. Disconnected clusters fall back to slow field-signaling.

This creates the **on-net vs. off-net tension** — arguably the most ownable mechanic in the project. Being networked is a real mechanical advantage (instant coordination); being cut off is a real penalty (back to diffusion-speed). Severing an enemy's network (destroying depots/edges) becomes a strategic act: you knock them off the bus.

**Tradeoff:** the bus is an attack surface — corruption (Mechanic 2) propagating over the broadcast register hits the whole connected species at once. Connectivity is power and exposure simultaneously.

---

## Mechanic 5 — Swarm as computational substrate (the model-pushing frontier)

The deeper reframe: stop treating the agents as a thing the computer simulates, and start treating the population as a computer that *computes*. Three escalating stages.

### 5a — The swarm as a circuit
Trail networks already solve shortest-path. Push it: structures + connections form a graph that carries signal, and you can **pose the dish actual problems** — drop two points and see if the population wires a path; introduce a gradient and see if it implements routing/sorting. "How powerful is this civilization" becomes "what can this substrate compute."

### 5b — Programs as a heritable, tradeable resource
The genome encodes not just traits but **behavior fragments** — tiny instruction sequences (the weighted-sum is already a micro-program). These can be **traded, stolen, or transmitted like the food good** on trade routes. A trade edge can carry *code*, not just resources. Tech transfer becomes literal software distribution: an advanced species' behavior-program propagates along trade edges to a less advanced one.

### 5c — Self-modifying ruleset (EXPERIMENTAL — research spike, not a planned feature)
The furthest push: built structures don't just change movement cost, they change **the rules the sim runs**. A "compiler" structure that, while a quorum maintains it, alters a field constant or unlocks a new agent instruction. The population modifying its own ruleset = the cybernetic endgame: a system that programs itself.

> **Flag for Claude Code:** treat 5c as a **research spike**, not a roadmap item. It is high-risk (trivially destabilizing — self-modification can blow up the equilibrium or the framerate), needs heavy guardrails (bounded rule changes, reversibility), and should be prototyped in isolation on a tiny population before anything else touches it. Do not plan it into the main build sequence; scope it as an experiment with a kill switch.

---

## Build order

1. **Conversion conflict** (Mechanic 3) — smallest change (gene-weight + tag rewrite), immediately changes war's feel. Good first proof of the theme.
2. **Death-as-data** (Mechanic 2) — HGT first, then corruption, then resurrection. Corruption needs a containment story before it's let loose.
3. **Merge/fork** (Mechanic 1) — needs care around state combination; verify a merged unit's tradeoffs actually bite.
4. **On-net bus** (Mechanic 4) — requires the network graph to exist first; gate access on depot-connection.
5. **Swarm-as-circuit** (5a) — once networks + structures are stable, pose the dish a problem and measure.
6. **Programs-as-resource** (5b) — behavior fragments on trade edges.
7. **Self-modifying ruleset** (5c) — research spike only, isolated, guarded, kill-switched. Not in the main sequence.

## Invariants (carry from the project)

- **Every mechanic carries a tradeoff** — each above has one specified; preserve them. Concentration vs. resilience, salvage vs. infection, conversion vs. purity, connectivity vs. exposure.
- **Closed system** — all of this is internal to the rules. No external information enters agent decisions.
- **Cheap on the stack** — every mechanic here is reads/writes/tags/flags, not per-agent brains. If an implementation starts needing per-agent heavy compute, it's wrong.
- **Theme test** — for any new mechanic, ask: does this have a hut equivalent? If yes, it's probably not exploiting the cyber framing. The good ones (merge, death-as-data, conversion, on/off-net, self-compute) don't.
