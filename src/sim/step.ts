// The canonical fixed sim tick — the single source of truth for system order, used
// by BOTH the headful loop (main.ts) and the headless runner (tools/headless.ts) so
// they can never drift. Advances one TICK_DT of sim time over the World.
//
// Order (docs/simulation-systems.md §Tier map): resources → [sense → steer] →
// integrate → metabolism → conflict → trade → reproduce → death → rebuild hash. Thinking
// (sense+steer) is gated to every THINK_INTERVAL ticks; its steering output is
// cached for the integrator to consume every tick. Conflict runs every tick,
// reusing the neighbor cache on think ticks.

import type { World } from "../state/world";
import { TICK_DT } from "../core/time";
import { sense } from "./tierA/sense";
import { steer } from "./tierA/steer";
import { integrate } from "./tierA/integrate";
import { metabolism } from "./tierA/metabolism";
import { resources } from "./tierB/resources";
import { stigmergy } from "./tierB/stigmergy";
import { conflict } from "./tierB/conflict";
import { trade } from "./tierB/trade";
import { caravan } from "./tierB/caravan";
import { reproduce } from "./tierB/reproduce";
import { death } from "./tierB/death";
import { drainGod } from "./tierB/god";

export function simStep(world: World): void {
  world.tick++;
  world.time += TICK_DT;

  drainGod(world); // 0 — apply buffered god perturbations before any system reads the world
  resources(world); // 1
  stigmergy(world); // 1b — claim/territory field (deposit → diffuse → decay)

  let didThink = false;
  if (++world.thinkTimer >= world.intensity.thinkInterval) {
    world.thinkTimer = 0;
    didThink = true;
    sense(world); // 2
    steer(world); // 3
  }

  integrate(world); // 4
  metabolism(world); // 5
  caravan(world); // 5b — carry/return state machine (reads updated pos+energy; steer reads its flag)
  conflict(world, didThink); // 6
  trade(world, didThink); // 6b — cooperative barter at non-hostile complementary encounters
  reproduce(world); // 7
  death(world); // 8

  world.hash.build(world.agents.posX, world.agents.posY, world.agents.count); // 9
}
