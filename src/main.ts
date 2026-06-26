// Bootstrap: build the World, the views, and the fixed-timestep loop, then wire
// them together. update() runs the systems in the canonical per-tick order each
// fixed tick; render() draws the current state. The World is a single mutable
// object — systems mutate it, views only read it.

import { Loop } from "./core/loop";
import { createWorld } from "./state/world";
import { NetRenderer } from "./views/netRenderer";
import { PerfOverlay } from "./views/perfOverlay";
import { Hud } from "./views/hud";

// Tier A (GPU-portable) passes.
import { sense } from "./sim/tierA/sense";
import { steer } from "./sim/tierA/steer";
import { integrate } from "./sim/tierA/integrate";
import { metabolism } from "./sim/tierA/metabolism";
// Tier B (CPU, symbolic) systems.
import { resources } from "./sim/tierB/resources";
import { conflict } from "./sim/tierB/conflict";
import { reproduce } from "./sim/tierB/reproduce";
import { death } from "./sim/tierB/death";

// Fixed seed → reproducible runs (debugging, snapshot/restore, headless). Override
// with ?seed=N in the URL.
const DEFAULT_SEED = 0x5eed;

function main(): void {
  const appEl = document.getElementById("app");
  const perfEl = document.getElementById("perf");
  const intensityEl = document.getElementById("intensity");
  const simSpeedEl = document.getElementById("simspd");
  const popEl = document.getElementById("pop");
  if (
    !appEl ||
    !perfEl ||
    !popEl ||
    !(intensityEl instanceof HTMLInputElement) ||
    !(simSpeedEl instanceof HTMLInputElement)
  ) {
    throw new Error("Petriarch: missing required DOM elements");
  }

  const seedParam = new URLSearchParams(window.location.search).get("seed");
  const seed = seedParam !== null ? Number(seedParam) >>> 0 : DEFAULT_SEED;

  const world = createWorld(seed);

  const renderer = new NetRenderer();
  const perf = new PerfOverlay(perfEl);
  const hud = new Hud(world, {
    intensity: intensityEl,
    simSpeed: simSpeedEl,
    pop: popEl,
  });

  // One fixed tick: the canonical sim order (docs/simulation-systems.md §Tier map),
  // with thinking (sense+steer) decoupled from acting via the think timer.
  const loop = new Loop({
    update(dt: number): void {
      world.tick++;
      world.time += dt;

      resources(world); // 1 — deplete/regrow the field (Tier B)

      // 2-3 — think every THINK_INTERVAL ticks; steer output is cached between.
      if (++world.thinkTimer >= world.intensity.thinkInterval) {
        world.thinkTimer = 0;
        sense(world);
        steer(world);
      }

      integrate(world); // 4 — apply steering, move (Tier A, every tick)
      metabolism(world); // 5 — energy drain + intake (Tier A, every tick)
      conflict(world); // 6 — contests at resource sites (Tier B)
      reproduce(world); // 7 — energy-threshold births into free slots (Tier B)
      death(world); // 8 — starvation / senescence swap-remove (Tier B)

      // 9 — rebuild the spatial hash for next tick's sense pass.
      world.hash.build(world.agents.posX, world.agents.posY, world.agents.count);
    },
    render(alpha: number): void {
      renderer.render(world, alpha);
      perf.update(loop, world.agents.count);
      hud.update();
    },
  });

  // Hud's sim-speed slider drives the loop; wire it now that the loop exists.
  hud.attachLoop(loop);

  void renderer.init(appEl).then(() => loop.start());
}

main();
