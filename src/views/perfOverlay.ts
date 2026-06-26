// DOM perf overlay. Plain HTML/CSS so it costs the Pixi pipeline nothing. The
// instrument we rely on at the population checkpoint: if logic-tick-ms or render-ms
// blow the budget, we see it here. (Adapted from swarmr: agents instead of enemies,
// self-throttles by frame count, shows sim-speed.)

import type { Loop } from "../core/loop";

const BUDGET_LOGIC_MS = 4;
const BUDGET_RENDER_MS = 8;
const THROTTLE_FRAMES = 12; // ~5Hz DOM writes at 60fps

export class PerfOverlay {
  private el: HTMLElement;
  private frames = 0;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Call once per rendered frame; throttles its own DOM writes. */
  update(loop: Loop, agentCount: number): void {
    if (++this.frames < THROTTLE_FRAMES) return;
    this.frames = 0;

    const logic = loop.updateMs.toFixed(2);
    const render = loop.renderMs.toFixed(2);
    const logicFlag = loop.updateMs > BUDGET_LOGIC_MS ? " !" : "";
    const renderFlag = loop.renderMs > BUDGET_RENDER_MS ? " !" : "";

    this.el.textContent =
      `fps      ${loop.fps.toFixed(0)}\n` +
      `logic    ${logic}ms / ${BUDGET_LOGIC_MS}ms${logicFlag}\n` +
      `render   ${render}ms / ${BUDGET_RENDER_MS}ms${renderFlag}\n` +
      `ticks    ${loop.ticksLastFrame}\n` +
      `simspeed ${loop.simSpeed.toFixed(1)}x\n` +
      `agents   ${agentCount}`;
  }
}
