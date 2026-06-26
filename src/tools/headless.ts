// Headless fast-forward + per-generation stats (no render). NOT optional — it's how
// tuning becomes experiment (docs/tooling.md) — but it comes AFTER the headful
// substrate is watchable, so this is a STUB for now. The npm "headless" script
// prints a notice until the tooling pass wires a TS runner.
//
// The shape is deliberate: build a World from a seed, step the same fixed-tick
// system order main.ts uses (minus rendering), and log lineage/gene/population
// stats per generation. Determinism comes for free from the seeded Rng.

import { createWorld } from "../state/world";

export interface HeadlessOptions {
  seed: number;
  ticks: number;
}

export function runHeadless(opts: HeadlessOptions): void {
  const world = createWorld(opts.seed);
  // TODO tooling pass: import the Tier A/B passes and run the canonical tick order
  // for opts.ticks, logging stats every generation. For now, just prove the World
  // builds deterministically headless.
  for (let t = 0; t < opts.ticks; t++) {
    world.tick++;
    world.hash.build(world.agents.posX, world.agents.posY, world.agents.count);
  }
  // eslint-disable-next-line no-console
  console.log(`headless: seed=${opts.seed} ticks=${world.tick} pop=${world.agents.count}`);
}
