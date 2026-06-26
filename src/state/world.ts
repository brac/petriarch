// The World: a single mutable object owning everything (CLAUDE.md one-line
// architecture). Pure systems read it and mutate it; dumb views read it and draw.
// A view can be destroyed and rebuilt from World state on any frame. There is no
// state anywhere else.

import { Rng } from "../core/rng";
import { SpatialHash } from "../core/spatialHash";
import { createIntensityState, type IntensityState } from "../core/intensity";
import { Agents } from "./pools";
import {
  MAX_AGENTS,
  HASH_CELL_SIZE,
  WORLD_W,
  WORLD_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
} from "../data/capacity";

// Re-exported so views and gameplay math import world extents from one place.
export { WORLD_W, WORLD_H };

/** Lineage bookkeeping (Tier B). STUB — filled by the lineage-stats system in M1. */
export interface LineageStats {
  /** Distinct lineages currently alive. */
  count: number;
  /** Next lineage id to hand out. */
  nextId: number;
}

export interface World {
  readonly agents: Agents;
  readonly hash: SpatialHash;
  readonly rng: Rng;
  /** Resource field: flat RESOURCE_GRID_W × RESOURCE_GRID_H energy grid (Tier B). */
  readonly resources: Float32Array;
  readonly intensity: IntensityState;
  readonly lineage: LineageStats;

  // Sim clock (advanced by the fixed-timestep loop; never wall-clock).
  tick: number;
  time: number;
  /** Counts ticks toward the next think (sense+steer) — see CLAUDE.md rule 6. */
  thinkTimer: number;
}

/** Build a fresh, empty world from a seed. Everything pre-allocated at capacity. */
export function createWorld(seed: number): World {
  return {
    agents: new Agents(MAX_AGENTS),
    hash: new SpatialHash(HASH_CELL_SIZE, WORLD_W, WORLD_H, MAX_AGENTS),
    rng: new Rng(seed),
    resources: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    intensity: createIntensityState(),
    lineage: { count: 0, nextId: 1 },
    tick: 0,
    time: 0,
    thinkTimer: 0,
  };
}
