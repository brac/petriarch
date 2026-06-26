// Intensity slider → three coupled runtime knobs (CLAUDE.md rule 8): live
// population, THINK_INTERVAL, and neighbor-sample budget. It is both a perf knob
// (degrade gracefully on weak machines; crank on the 3090) and a design knob.
// Distinct from sim-speed (loop.simSpeed): intensity = how heavy each agent is,
// sim-speed = how fast the clock runs.
//
// Zero-allocation: World owns one IntensityState; the slider handler mutates it in
// place via applyIntensity(). Systems read world.intensity each tick.

import {
  MAX_AGENTS,
  MIN_POP,
  THINK_INTERVAL_MIN,
  THINK_INTERVAL_MAX,
  NEIGHBOR_BUDGET_MIN,
  NEIGHBOR_BUDGET_MAX,
} from "../data/capacity";

export interface IntensityState {
  /** Target live population (filled fraction of MAX_AGENTS). Gates spawning. */
  activeCount: number;
  /** Ticks between cognitive updates (sense+steer). 1 at max, MAX at min. */
  thinkInterval: number;
  /** Max neighbors sampled per agent in the sense pass. */
  neighborBudget: number;
}

/** Default state (full intensity) before the slider is read. */
export function createIntensityState(): IntensityState {
  return {
    activeCount: MAX_AGENTS,
    thinkInterval: THINK_INTERVAL_MIN,
    neighborBudget: NEIGHBOR_BUDGET_MAX,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map slider value s∈[0,1] into the three knobs, mutating `state` in place.
 * s=1 (max): full population, think every tick, full neighbor block.
 * s=0 (min): MIN_POP agents, think every THINK_INTERVAL_MAX ticks, capped neighbors.
 */
export function applyIntensity(state: IntensityState, s: number): void {
  const t = s < 0 ? 0 : s > 1 ? 1 : s;
  state.activeCount = Math.round(lerp(MIN_POP, MAX_AGENTS, t));
  // Higher intensity → smaller interval (more thinking). Min 1 tick.
  state.thinkInterval = Math.max(
    THINK_INTERVAL_MIN,
    Math.round(lerp(THINK_INTERVAL_MAX, THINK_INTERVAL_MIN, t)),
  );
  state.neighborBudget = Math.round(lerp(NEIGHBOR_BUDGET_MIN, NEIGHBOR_BUDGET_MAX, t));
}
