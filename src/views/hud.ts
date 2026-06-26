// HUD: the two first-class milestone-1 controls (CLAUDE.md rule 8) plus the live
// population readout. The intensity slider mutates world.intensity in place; the
// sim-speed slider writes loop.simSpeed. A dumb view — it reads World and DOM, and
// writes only the control state the sim already exposes.
//
// Two-phase wiring: intensity is wired at construction; sim-speed is wired by
// attachLoop() once the Loop exists (the Loop's render callback references the Hud,
// so the Loop is built after it).

import type { World } from "../state/world";
import type { Loop } from "../core/loop";
import { applyIntensity } from "../core/intensity";

export interface HudElements {
  intensity: HTMLInputElement;
  simSpeed: HTMLInputElement;
  pop: HTMLElement;
}

export class Hud {
  private world: World;
  private els: HudElements;

  constructor(world: World, els: HudElements) {
    this.world = world;
    this.els = els;

    // Seed intensity from the DOM's initial value, then track input.
    applyIntensity(world.intensity, parseFloat(els.intensity.value));
    els.intensity.addEventListener("input", () => {
      applyIntensity(world.intensity, parseFloat(els.intensity.value));
    });
  }

  /** Wire the sim-speed slider to the loop (called once the loop is constructed). */
  attachLoop(loop: Loop): void {
    loop.simSpeed = parseFloat(this.els.simSpeed.value);
    this.els.simSpeed.addEventListener("input", () => {
      loop.simSpeed = parseFloat(this.els.simSpeed.value);
    });
  }

  /** Call once per rendered frame. */
  update(): void {
    this.els.pop.textContent = String(this.world.agents.count);
  }
}
