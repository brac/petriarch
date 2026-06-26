// Bootstrap: build the World, the views, and the fixed-timestep loop, then wire
// them together. update() runs the systems in the canonical per-tick order each
// fixed tick; render() draws the current state. The World is a single mutable
// object — systems mutate it, views only read it.

import { Loop } from "./core/loop";
import { createWorld, type World } from "./state/world";
import { WORLD_W, WORLD_H } from "./data/capacity";
import { initResourceField, seedPopulation } from "./sim/init";
import { simStep } from "./sim/step";
import { NetRenderer } from "./views/netRenderer";
import { PerfOverlay } from "./views/perfOverlay";
import { Hud } from "./views/hud";
import { DevPanel } from "./views/devPanel";
import { bloom, hazard, smite } from "./sim/tierB/god";
import { RESOURCES } from "./data/resources";

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
  initResourceField(world);
  seedPopulation(world);

  const renderer = new NetRenderer();
  const perf = new PerfOverlay(perfEl);
  const hud = new Hud(world, {
    intensity: intensityEl,
    simSpeed: simSpeedEl,
    pop: popEl,
  });

  const devEl = document.getElementById("devpanel");
  if (devEl) new DevPanel(devEl);

  // One fixed tick: the canonical sim order (docs/simulation-systems.md §Tier map),
  // with thinking (sense+steer) decoupled from acting via the think timer.
  const loop = new Loop({
    update(): void {
      simStep(world); // the canonical fixed tick (shared with headless)
    },
    render(alpha: number): void {
      renderer.render(world, alpha);
      perf.update(loop, world.agents.count);
      hud.update();
    },
  });

  // Hud's sim-speed slider drives the loop; wire it now that the loop exists.
  hud.attachLoop(loop);

  void renderer.init(appEl).then(() => {
    wireGodTools(appEl, renderer, world);
    loop.start();
  });
}

// God toolkit — the player perturbs the world, never an individual:
//   left-click   → resource bloom    (clusters race for it)
//   right-click  → hazard zone       (a lineage is culled or driven to migrate)
//   shift-click / X → smite          (thin the population in an area)
function wireGodTools(canvasEl: HTMLElement, renderer: NetRenderer, world: World): void {
  let lastX = WORLD_W / 2;
  let lastY = WORLD_H / 2;

  canvasEl.addEventListener("contextmenu", (e) => e.preventDefault());

  canvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
    const w = renderer.screenToWorld(e.clientX, e.clientY);
    lastX = w.x;
    lastY = w.y;
    if (e.button === 2) {
      hazard(world, w.x, w.y, RESOURCES.hazardRadius);
    } else if (e.button === 0 && e.shiftKey) {
      smite(world, w.x, w.y, RESOURCES.smiteRadius);
    } else if (e.button === 0) {
      bloom(world, w.x, w.y, RESOURCES.bloomRadius);
    }
  });

  canvasEl.addEventListener("pointermove", (e: PointerEvent) => {
    const w = renderer.screenToWorld(e.clientX, e.clientY);
    lastX = w.x;
    lastY = w.y;
  });

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "x" || e.key === "X") smite(world, lastX, lastY, RESOURCES.smiteRadius);
  });
}

main();
