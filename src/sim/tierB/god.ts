// Tier B — CPU, symbolic/stateful. Player perturbation tools — the god changes the
// WORLD, never an individual (CLAUDE.md rule: no direct agent control). Bloom (drop
// a resource-rich zone), hazard/famine (drain/kill zone), smite (remove agents in
// an area). STUB — implemented in Milestone 1.

import type { World } from "../../state/world";

/** Drop a resource-rich zone; clusters race for it. */
export function bloom(_world: World, _x: number, _y: number, _radius: number): void {
  // TODO Milestone 1: raise world.resources cells within radius.
}

/** Drop an energy-draining / lethal zone; a lineage is culled or driven to migrate. */
export function hazard(_world: World, _x: number, _y: number, _radius: number): void {
  // TODO Milestone 1: mark a hazard region metabolism/death read.
}

/** Remove agents within an area. */
export function smite(_world: World, _x: number, _y: number, _radius: number): void {
  // TODO Milestone 1: kill agents inside radius via world.hash + agents.kill().
}
