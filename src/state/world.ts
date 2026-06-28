// The World: a single mutable object owning everything (CLAUDE.md one-line
// architecture). Pure systems read it and mutate it; dumb views read it and draw.
// A view can be destroyed and rebuilt from World state on any frame. There is no
// state anywhere else.

import { Rng } from "../core/rng";
import { SpatialHash } from "../core/spatialHash";
import { createIntensityState, type IntensityState } from "../core/intensity";
import { Agents } from "./pools";
import { PASSABILITY } from "../data/passability";
import {
  MAX_AGENTS,
  HASH_CELL_SIZE,
  WORLD_W,
  WORLD_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
  MAX_SPARKS,
  GOD_QUEUE_CAP,
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

/** A single active god-hazard zone (energy-draining). life>0 means active. */
export interface Hazard {
  x: number;
  y: number;
  r: number;
  life: number;
}

/** Pooled conflict-spark events: positions the renderer flashes, reset each frame. */
export interface SparkPool {
  readonly x: Float32Array;
  readonly y: Float32Array;
  count: number;
}

/** Buffered god-perturbation commands (SoA, pre-allocated). Player input enqueues here;
 *  the sim drains it at a fixed point each tick (god.ts drainGod). This is what makes the
 *  god tools work in GPU mode: bloom/smite touch resources/energy that the GPU readback
 *  overwrites, so a direct mid-frame mutation races and is lost ~half the time. Applying
 *  on the drain — right before the per-tick GPU upload — closes the race. `arg` carries a
 *  per-command scalar (e.g. paint cost). See god.ts for the command codes. */
export interface GodQueue {
  readonly type: Int32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly r: Float32Array;
  readonly arg: Float32Array;
  count: number;
}

export interface World {
  readonly agents: Agents;
  readonly hash: SpatialHash;
  readonly rng: Rng;
  /** Resource field: flat RESOURCE_GRID_W × RESOURCE_GRID_H energy grid (Tier B). */
  readonly resources: Float32Array;
  /** Per-cell regrow target (the capacity field, shaped at init by clumping). */
  readonly resourceCap: Float32Array;
  // Nutrient B: a SECOND resource field seeded in a separate region from nutrient A
  // (= `resources`). Foundation for two-good trade (sim/init.ts two-region worldgen).
  // Phase 0: regrown + rendered but NOT yet consumed (Phase 1's dual-nutrient diet makes
  // it edible). CPU-only like the claim field — never uploaded to the GPU. Same grid.
  readonly resourceB: Float32Array;
  readonly resourceCapB: Float32Array;
  // Stigmergy `claim` (territory) field — continuous signature-accumulation, same
  // grid as resources. Mean signature = claimSig{A,B,C}/claimMag → the depositing
  // tribe's hue. Deposited/diffused/decayed by tierB/stigmergy.ts; render-only.
  readonly claimMag: Float32Array;
  readonly claimSigA: Float32Array;
  readonly claimSigB: Float32Array;
  readonly claimSigC: Float32Array;
  // Stigmergy `danger` field — deposited on death (death.ts), diffused/decayed by
  // tierB/stigmergy.ts, read by steer as a descend gradient (flee). Same grid.
  readonly danger: Float32Array;
  // Passability (movement-cost) field — static admin/construction substrate, same grid.
  // Default 1 (normal ground); a painted ocean/wall is a huge sentinel cost. Read in the
  // integrate hot path (CPU + GPU) to block/throttle the step; written by the paint tool
  // (god.ts) and, later, the construction tier. Never decays. See data/passability.ts.
  readonly passability: Float32Array;
  readonly hazard: Hazard;
  readonly sparks: SparkPool;
  /** Buffered god commands, drained once per tick before the GPU upload (see GodQueue). */
  readonly god: GodQueue;
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
    resourceCap: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    resourceB: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    resourceCapB: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    claimMag: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    claimSigA: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    claimSigB: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    claimSigC: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    danger: new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H),
    // Default ground cost is 1, not 0 — fill after allocation (zero would read as a
    // free/super-fast cell to the integrator's throttle).
    passability: ((): Float32Array => {
      const p = new Float32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
      p.fill(PASSABILITY.defaultCost);
      return p;
    })(),
    hazard: { x: 0, y: 0, r: 0, life: 0 },
    sparks: { x: new Float32Array(MAX_SPARKS), y: new Float32Array(MAX_SPARKS), count: 0 },
    god: {
      type: new Int32Array(GOD_QUEUE_CAP),
      x: new Float32Array(GOD_QUEUE_CAP),
      y: new Float32Array(GOD_QUEUE_CAP),
      r: new Float32Array(GOD_QUEUE_CAP),
      arg: new Float32Array(GOD_QUEUE_CAP),
      count: 0,
    },
    intensity: createIntensityState(),
    lineage: { count: 0, nextId: 1 },
    tick: 0,
    time: 0,
    thinkTimer: 0,
  };
}
