# Feature: Passability Field (movement-cost substrate)

> **Status:** new feature, added to an in-progress project. This is a foundational substrate that several existing/planned systems will write into. Build the field + its read points first, then the admin paint tool as its first writer. Emergent construction (the walls/roads tier) becomes a later writer into the *same* field with no rework.

## Summary

Introduce a single **passability field**: one `r32float` storage texture at food-grid resolution, where each cell holds a **movement cost**. Agent movement reads it every tick; high cost slows or blocks a step. This one field unifies three needs that would otherwise be separate systems:

1. **Static admin barriers** — oceans and borders painted at setup, never decay. (Immediate need: lets us seed species in separate areas so they grow on their own resource before contact.)
2. **Emergent construction** — walls and roads written by agents in the later construction tier, into this same field.
3. **Terrain variety** — slow/fast ground as cost values between the extremes.

Cost-based, not binary, from the start. Binary (passable/impassable) is just the special case where cost is 1 or max.

## Cost model

- Default cell cost: **1** (normal ground).
- **Ocean / hard border:** cost = **MAX** (sentinel; treat as impassable).
- **Wall** (emergent, later tier): cost = **MAX**.
- **Road** (emergent, later tier): cost **< 1** (e.g. 0.25) — cheaper than normal ground.
- Anything in between is available for terrain (swamp, etc.) later.

Design intent: **roads are how a settlement pays down a barrier.** Cost is the currency; roads buy movement through expensive terrain. Keep the field continuous so this relationship holds without special-casing.

## Movement read

Each tick, agent movement samples the target cell's cost:

- If cost = MAX → step is blocked. Clamp / reflect / re-pick direction (match existing movement-resolution style).
- Otherwise → cost scales the step (higher cost = slower / lower probability of committing the move; implementation to match current movement model — speed scalar or move-probability, whichever the agent kernel already uses).

This is the only mandatory new read in the agent kernel.

## Diffusion interaction — PER-CHANNEL, not a blanket rule

The stigmergy fields (`trail`, `claim`, `danger`) diffuse. A barrier does **not** block all of them uniformly. Each channel's diffuse pass samples the passability field and applies its own rule:

| Field | Blocked by MAX-cost cells (ocean/wall)? | Rationale |
|---|---|---|
| `trail` | **YES** — does not diffuse across | trade/movement routing cannot cross water or walls |
| `claim` | **NO** — diffuses across | territory/influence is *sensed* across a sea border |
| `danger` | **NO** — diffuses across | fear of death carries over water |

Net effect of a painted ocean between two basins: species **cannot route or move** to each other (no trail, no crossing), but **can sense** each other's territory pressure and death across the water. Separation of *logistics* from *perception* — intentional.

> Implementation note: this means the diffuse passes need read access to the passability field, and the per-channel rule is a branch on whether that channel respects MAX-cost as a diffusion barrier. Do **not** implement a single global "wall blocks diffusion" flag — it must be per-channel as tabled above.

## Admin paint tool (first writer)

A setup-time authoring tool that writes static cost values into the field:

- Paint **ocean / border** (cost = MAX) to partition the map into isolated basins.
- This is the **seeding mechanism**: paint barriers, drop a different species into each basin, let each grow on its own resource, then (optionally) open a channel or let them reach contact.
- Static writes only — painted cells do not decay.

Tool scope for now: paint MAX-cost barriers. Painting arbitrary cost (terrain brushes) is a nice-to-have, not required for the seeding use case.

## Later writer (no rework needed)

The emergent construction tier writes into this **same field**: wall = MAX, road = low cost. No second system, no migration. When that tier lands, it inherits the movement read and the per-channel diffusion rules already in place. Walls block `trail` and movement but (per the table) still let `claim`/`danger` diffuse — confirm this is the desired behavior for emergent walls too, or override per structure type if not.

## Build order

1. Add passability field texture (default 1) — alongside the stigmergy fields; same kind of object.
2. Wire the movement read in the agent kernel (cost scales/blocks the step).
3. Update the three diffuse passes to sample passability with the **per-channel** rules above.
4. Build the admin paint tool (MAX-cost barriers, static, no decay) — unblocks seeding species in separate basins immediately.
5. (Later tier) point emergent construction at the same field as an additional writer.

## Verification checkpoint

After steps 1–4: paint an ocean splitting the map, seed two different species on either side. Confirm: neither crosses; no trail leaks across; but each basin's `claim` and `danger` fields bleed over the water and are visible on the far side. Confirm a low-cost painted strip (proto-road) lets agents move faster through it. Document results before wiring the emergent-construction writer.

## Implementation status (v1 — landed)

Build-order steps 1–4 are implemented:

- **Field** — `world.passability` (`Float32Array`, RES grid, default-filled to `1`). Tunables in `src/data/passability.ts` (`defaultCost`, `oceanCost`, `blockThreshold`, brush, render tints). Persisted in snapshots (format **v4**).
- **Movement read** — in `integrate` (Tier A, both CPU `sim/tierA/integrate.ts` and GPU `shaders/integrate.wgsl.ts`): sample the target cell's cost; `cost ≥ blockThreshold` → impassable (stay + reflect, like a world bound); `cost ≠ 1` → step scaled by `1/cost` (the road/swamp hook, dormant until those costs are painted). GPU buffer + `uploadPassability` + grown int-params + bind-group binding 7. With the default all-1 field both branches are no-ops, so the GPU pass stays bit-identical to the CPU reference — `verifyIntegrate`/`verifyChain` upload the field and remain green.
- **Admin paint tool** — `paintPassability`/`clearBarriers` in `god.ts`. **Press `B`** to toggle ocean-paint, then left-drag paints an impassable barrier, shift-drag erases; "clear barriers" button + hint in the dev panel.
- **Render** — blue ocean overlay (a passability cell layer just above the dark field), `netRenderer.drawPassability`.

**Diffusion (step 3) is intentionally a no-op for now:** the only per-channel rule that bites is "`trail` blocked by MAX-cost," and `trail` isn't built yet. `claim`/`danger` already diffuse over every cell (range governed by decay, no passability branch) — which is exactly the committed behavior. Wire the `trail` barrier-block when the `trail` channel lands.

**Not yet done / follow-ups:**
- GPU verifies (`verify integrate` / `verify chain`) re-run headful to reconfirm green — expected unaffected (no-op default field), not yet re-run in this session.
- Seeding *distinct* species per basin is not added to `init`; the founding population is already spread map-wide, so painting a mid-map ocean partitions existing tribes — enough to watch the no-cross / claim-bleed behavior. A dedicated basin-seeder is a future nicety.
- Agents standing in a cell at the instant it's painted ocean become trapped (every move blocks) — acceptable; a "smite-on-paint" option was deliberately left out to keep the tool single-purpose.
- `trail` channel + its barrier-block rule; emergent construction as the second writer (wall = MAX, road < 1).
