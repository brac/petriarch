# Petriarch — Network & Civilization Layer: Implementation Spec

> Hand this to Claude Code as the planning brief. It describes **what** to build and the **ordering constraints**, not the final code. Produce a phased implementation plan with checkpoints; do not jump ahead to later phases before earlier ones are verified in-sim.

## Context

Petriarch is a GPU agent-life simulation: ~20,000 units processed via WebGPU/WGSL on an RTX 3090, rendered with PixiJS v8. Agents carry genetic traits (size, metabolism, social connection, aggression-leaning behavior) and forage on a regrowing food grid. Current emergent behavior: same-species clumping with border conflict over food; a fast-metabolizing green species reaches monoculture at the regrowth cap.

We are adding three stacked layers to push the sim from flat competition into emergent civilization (territory, trade, war, construction). The layers are **stigmergy → civilization tiers → network graph**, built strictly in that order.

## Hard ordering constraint

Each phase ships and is observed *in isolation* before the next begins. The phase-1 stigmergy fields may produce most of the desired emergent structure on their own; we do not want to over-build. Claude Code should plan visible verification checkpoints between phases and explicitly pause for human review at each.

## Architecture principle (read before planning)

The current monoculture equilibrium is **stable**. Adding mechanisms will NOT automatically destabilize it — if higher tiers are pure bonuses, we just get a *better-farming* monoculture. Every civilization mechanic must introduce a **tradeoff or vulnerability**, not a strict upgrade:

- Settling raises visibility → bigger raid target.
- Construction locks surplus that could have gone to reproduction.
- Roads are exploitable by invaders, not just usable by builders.

Bake costs/vulnerabilities in from the start. This is a design invariant, not a polish step.

---

## Phase 1 — Stigmergy field channels

Add a small stack of environment field channels at the same resolution as the food grid. These are `r32float` storage textures, each a **ping-pong pair** (read previous / write next) with a diffuse + decay compute pass — same shape as the existing food regrowth pass.

**Channels:**

| Channel | Deposited by | Decay | Purpose / emergent read |
|---|---|---|---|
| `trail` | agents carrying food toward a dense cluster | fast | follow gradient up = proto trade route |
| `claim` | agent presence (species-tagged) | slow | territory; borders = two species' claim both nonzero |
| `danger` | agent death | medium | aggressive genes ignore it; cultivator genes flee up-gradient |

**Agent wiring:**
- Deposit into `trail` when returning food to high-density area.
- Deposit into `claim` continuously by presence, tagged by species.
- Deposit into `danger` on death event.
- Behavior response to `danger` gradient is gated by existing aggression gene — this is how the "fight vs. avoid" archetypes emerge from genetics already present. No new agent state required for this.

**Performance:** three extra channels over 20k agents is trivial on a 3090. Diffuse+decay passes mirror existing food pass.

**Checkpoint (STOP here):** Run and observe. Expected: borders sharpen into no-man's-lands, trail ridges form between clusters and food, cultivator-gene clusters avoid danger zones. Do not start Phase 2 until this is confirmed visually. Document what emerged.

---

## Phase 2 — Civilization metric & settled state (Tier 1)

Do **not** gate on a global metric — gate locally so regions develop independently.

**Coarse grid:** overlay a coarse accumulator grid (e.g. each coarse cell = 32×32 fine cells). Per coarse cell, accumulate:
- agent count,
- summed stored food surplus,
- average social-connection gene.

When the accumulator crosses a threshold, flip the coarse cell to **settled**.

**Tier 1 (cultivation) effect:** settled cell gets food regrowth ×1.5 and a raised food cap. The green species naturally triggers this and becomes the "farmer" baseline.

**Checkpoint (STOP here):** Confirm regions differentiate — some settle, some stay nomadic — and that settling correlates with high-social/low-aggression genetics. Verify Tier 1 does not simply accelerate monoculture (watch for the failure mode). Document.

---

## Phase 3 — Higher tiers & structure layer (Tiers 2–3)

Add a **structure layer**: per world-cell state holding built structures, independent of which agent occupies the cell.

**Tier 2 (storage):** in settled cells, surplus food persists across famine ticks instead of decaying (granary). Enables a region to survive bad patches → enables export.

**Tier 3 (construction):** a settled cell can spend stored surplus to write into the structure layer:
- **wall** — blocks agent movement and field diffusion,
- **road** — cheaper trail-following,
- **depot** — a network node (consumed by Phase 4).

**Tradeoff enforcement (required, per architecture principle):**
- Construction spends surplus that would otherwise fund reproduction.
- Settled/built cells carry higher `claim` → more visible → larger raid magnet.
- Roads are usable by invaders too.

**Checkpoint (STOP here):** Confirm archetypes fall out naturally — aggressive clusters spend surplus on conflict and stay nomadic; high-social cultivators reach Tier 3 and build. Confirm built regions are vulnerable, not strictly dominant. Document.

---

## Phase 4 — The network graph (hybrid emergent-node / explicit-edge)

Keep all 20k agents fully on-GPU (physics + stigmergy). Run civilization logic as a **tiny CPU graph** over depots only — dozens to low hundreds of nodes, never 20k.

**Nodes:** Tier-3 depots promote to CPU graph nodes (a small list).

**Edges:** form when a sustained `trail` ridge connects two depots for N ticks. Edge "bandwidth" = function of trail ridge strength.

**GPU→CPU readback:** copy per-depot accumulator buffer every ~10–30 ticks (NOT per frame). One small buffer copy. Plan the cadence and buffer layout explicitly.

**Graph logic (CPU, on node graph only):**
- **Trade:** surplus node linked to deficit node → flow food along edge, capped by bandwidth. Reduces deficit-node famine death; raises source influence.
- **War:** two nodes with colliding territory + aggressive dominant genes → contested edge. Resolve as attrition weighted by stored surplus + agent count. Loser's depot reverts to unsettled, its `claim` field collapses, agents disperse.
- **Construction (graph-level):** a node spends surplus to upgrade an edge (road = permanent decay-immune high trail) or fortify (wall ring blocking enemy `claim` diffusion).

**Why hybrid over field-only:** a pure-field approach (routes/wars as implicit texture patterns) is fully GPU-native and scales trivially, but you cannot *query* "who trades with whom." The hybrid keeps agents on-GPU while making civilization queryable on a tiny CPU graph. We want queryable.

**Checkpoint:** Observe trade routes forming/collapsing, wars redistributing territory, fortification altering border dynamics. Document.

---

## Deliverables expected from Claude Code

1. A phased plan mapping these four phases to concrete tasks, with the STOP/verify checkpoints preserved as gates.
2. For Phase 1: WGSL for the three-channel deposit + diffuse/decay passes, and the agent deposit/response wiring.
3. For Phase 2–3: coarse accumulator design, settled-state transitions, structure-layer cell format.
4. For Phase 4: CPU node-graph data model, edge-formation rule, and the GPU→CPU readback cadence/buffer layout.

Respect the ordering constraint and the tradeoff invariant throughout. Surface any place where a proposed mechanic is a pure bonus with no cost — that's a design bug.
