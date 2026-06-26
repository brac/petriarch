# Feature: Passability Field (movement-cost substrate)

> **Status:** new feature, added to an in-progress project. Foundational substrate that several existing/planned systems write into. Build the field + its read points first, then the admin paint tool as its first writer. Emergent construction (walls/roads) becomes a later writer into the *same* field with no rework.

## Summary

Introduce a single **passability field**: one `r32float` storage texture at food-grid resolution, where each cell holds a **movement cost**. Agent movement reads it every tick; high cost slows or blocks a step. This one field unifies three needs that would otherwise be separate systems:

1. **Static admin barriers** — oceans and borders painted at setup, never decay. (Immediate need: seed species in separate areas so they grow on their own resource before contact.)
2. **Emergent construction** — walls and roads written by agents in the later construction tier, into this same field.
3. **Terrain variety** — slow/fast ground as cost values between the extremes.

Cost-based, not binary, from the start. Binary (passable/impassable) is just the special case where cost is 1 or max.

## Cost model

- Default cell cost: **1** (normal ground).
- **Ocean / hard border:** cost = **MAX** (sentinel; treat as impassable to movement).
- **Wall** (emergent, later tier): cost = **MAX**.
- **Road** (emergent, later tier): cost **< 1** (e.g. 0.25) — cheaper than normal ground.
- Anything in between is available for terrain (swamp, etc.) later.

Design intent: **roads are how a settlement pays down a barrier.** Cost is the currency; roads buy movement through expensive terrain. Keep the field continuous so this relationship holds without special-casing.

## Movement read

Each tick, agent movement samples the target cell's cost:

- If cost = MAX → step is blocked. Clamp / reflect / re-pick direction (match existing movement-resolution style).
- Otherwise → cost scales the step (higher cost = slower / lower move-probability; match the current movement model — speed scalar or move-probability, whichever the agent kernel already uses).

This is the only mandatory new read in the agent kernel.

## Diffusion interaction — the key behavior

The stigmergy fields (`trail`, `claim`, `danger`) diffuse. The intended behavior is NOT a blanket "barrier blocks diffusion" rule and NOT "diffusion ignores the ocean." It's this:

**`trail` is blocked by MAX-cost cells. `claim` and `danger` diffuse normally everywhere — including over water — and fade with distance via their existing decay.**

### Why claim/danger need no special ocean rule

Agents can't enter the ocean, so **nothing deposits claim or danger in the water.** But the fields these agents deposit on the **coast** diffuse outward like anywhere else. Diffusion + decay has a finite range, so:

- A species on the shore **claims the beach** — its claim field is strong at the coastline and falls off into the water.
- Across a **narrow strait**, that fade reaches the far shore: the two basins sense each other faintly at the water's edge. This is the "goes across" behavior — it's just normal short-range diffusion reaching a nearby coast, not the ocean being transparent.
- Across a **wide ocean**, the same fade dies out before reaching the other side. No special cutoff needed — decay handles it. Wide water = effective separation; narrow water = sensed-but-not-crossable.

So the range of claim/danger over water is an **emergent function of ocean width vs. the field's diffusion/decay constants** — not a hard rule. Tune the decay constant to set how far "a little ways" is.

### Summary table

| Field | Respects MAX-cost as a diffusion barrier? | Behavior at an ocean |
|---|---|---|
| `trail` | **YES** — does not diffuse into/across MAX-cost cells | trade/movement routing cannot cross water or walls |
| `claim` | **NO** — diffuses normally, fades with distance | claims the beach; reaches a near shore across a narrow strait; dies out over a wide ocean |
| `danger` | **NO** — diffuses normally, fades with distance | same as claim: short-range bleed from the coast, no long-range crossing |

> Implementation notes:
> - All diffuse passes need read access to the passability field.
> - For `trail`: branch on MAX-cost to block exchange into those cells.
> - For `claim`/`danger`: **no passability branch at all** — they diffuse over every cell including ocean. Their range is governed purely by the diffuse + decay constants. Do NOT add a wall/ocean check to these two; the fade-with-distance is the whole mechanism.
> - The "a little ways, not across" requirement is a **tuning target on the decay constant**, not a hard barrier. Pick decay so a typical strait is crossed by the fade and a typical wide ocean is not.

## Admin paint tool (first writer)

A setup-time authoring tool that writes static cost values into the field:

- Paint **ocean / border** (cost = MAX) to partition the map into isolated basins.
- This is the **seeding mechanism**: paint barriers, drop a different species into each basin, let each grow on its own resource, then let them reach contact.
- Static writes only — painted cells do not decay.

Tool scope for now: paint MAX-cost barriers. Arbitrary-cost terrain brushes are a nice-to-have, not required for seeding.

## Later writer (no rework needed)

The emergent construction tier writes into this **same field**: wall = MAX, road = low cost. No second system, no migration; it inherits the movement read and the diffusion rules already in place. A wall blocks `trail` and movement but (per the table) does not stop `claim`/`danger` diffusion — confirm that's desired for emergent walls, or override per structure type if fortifications should also cut off claim bleed.

## Build order

1. Add passability field texture (default 1) — alongside the stigmergy fields; same kind of object.
2. Wire the movement read in the agent kernel (cost scales/blocks the step).
3. Update the diffuse passes: `trail` gets a MAX-cost block; `claim`/`danger` get **no** passability branch (diffuse everywhere, fade via decay).
4. Build the admin paint tool (MAX-cost barriers, static, no decay) — unblocks seeding species in separate basins immediately.
5. (Later tier) point emergent construction at the same field as an additional writer.

## Verification checkpoint

After steps 1–4: paint a **narrow strait** and a **wide ocean** on the same map, seed a different species in each region. Confirm:
- No species crosses water; no `trail` leaks across either.
- Each species' `claim` is strong on its own beach and fades into the water.
- Across the **narrow strait**, the claim/danger fade reaches the far shore (faint sensing).
- Across the **wide ocean**, claim/danger die out before reaching the other side.
- Tune the `claim`/`danger` decay constant until "a little ways" matches the strait-vs-ocean cutoff you want.
- A low-cost painted strip (proto-road) lets agents move faster through it.

Document results before wiring the emergent-construction writer.
