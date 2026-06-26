// Fixed-timestep loop. Logic ticks at a fixed rate (60Hz) decoupled from render.
// Gameplay never reads wall-clock delta directly — systems get a constant dt. The
// sim clock is independent of render and speed-controllable: `simSpeed` scales how
// fast the clock runs (headful fast-forward) WITHOUT changing TICK_DT, so runs stay
// deterministic (CLAUDE.md rule 6/8). Render gets an interpolation alpha.
// (Adapted from swarmr: 240→60Hz, plus the simSpeed control.)

export interface LoopCallbacks {
  /** Fixed logic step. dt is constant (see TICK_DT). */
  update: (dt: number) => void;
  /** Render. alpha in [0,1) = fraction into the next pending tick. */
  render: (alpha: number) => void;
}

import { TICK_DT } from "./time";

// Base cap on logic ticks per frame. If the tab stalls, we drop simulated time
// rather than spiral trying to catch up (spiral-of-death guard). At simSpeed > 1
// the cap scales so fast-forward can fire extra ticks per frame.
const MAX_TICKS_PER_FRAME = 8;
// Hard ceiling on ticks/frame at ANY sim-speed. Past this, fast-forward visibly
// slows down rather than running e.g. 64 sequential heavy ticks (the chug). At
// 60fps this still keeps up with the 8× slider; raise it to allow faster runs.
const MAX_TICKS_HARD = 16;

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;

  /**
   * Sim-speed multiplier (sim-speed control, distinct from the intensity slider).
   * 1 = realtime; >1 = fast-forward; 0 = paused (render keeps running over a frozen
   * sim). TICK_DT is never changed, so determinism holds at any speed.
   */
  simSpeed = 1;

  // Perf instrumentation, read by the overlay.
  updateMs = 0;
  renderMs = 0;
  fps = 0;
  ticksLastFrame = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    let rawFrameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp pathological frame gaps (alt-tab, breakpoint) to avoid a flood.
    if (rawFrameTime > 0.25) rawFrameTime = 0.25;
    // Sim-speed scales the clock. simSpeed=0 → no time accrues → sim pauses.
    // (rawFrameTime stays real for fps; only the sim accumulator is scaled.)
    this.accumulator += rawFrameTime * this.simSpeed;

    // --- fixed logic ticks --- (cap scales with simSpeed, then a hard ceiling)
    const cap = Math.min(
      MAX_TICKS_HARD,
      MAX_TICKS_PER_FRAME * Math.max(1, Math.round(this.simSpeed)),
    );
    let ticks = 0;
    const t0 = performance.now();
    while (this.accumulator >= TICK_DT && ticks < cap) {
      this.cb.update(TICK_DT);
      this.accumulator -= TICK_DT;
      ticks++;
    }
    // If we hit the tick cap, shed the backlog so we don't spiral next frame.
    if (ticks >= cap) this.accumulator = 0;
    this.updateMs = performance.now() - t0;
    this.ticksLastFrame = ticks;

    // --- render with interpolation alpha ---
    const alpha = this.accumulator / TICK_DT;
    const r0 = performance.now();
    this.cb.render(alpha);
    this.renderMs = performance.now() - r0;

    // --- fps (0.5s rolling, real wall-clock) ---
    this.fpsAccum += rawFrameTime;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.rafId = requestAnimationFrame(this.frame);
  };
}
