// Tier A — GPU-portable, buffer contract. Runs every tick: accelerate velocity
// toward the cached steering target, clamp to a gene-derived max speed, move, and
// reflect off world bounds. Consumes agents.steerX/steerY (a unit direction written
// by steer every THINK_INTERVAL). Bigger bodies are slower; faster metabolism is
// quicker — both tradeoffs the genome pays for elsewhere.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { WORLD_W, WORLD_H } from "../../data/capacity";
import { TICK_DT } from "../../core/time";

export function integrate(world: World): void {
  const a = world.agents;
  const { posX, posY, velX, velY, steerX, steerY, genes, count } = a;
  const dt = TICK_DT;
  const accel = SIM.steerAccel;
  const bounce = SIM.wallBounce;

  for (let i = 0; i < count; i++) {
    const bi = i * GENE_COUNT;
    const size = genes[bi + GENE.SIZE]!;
    const mr = genes[bi + GENE.METABOLIC_RATE]!;
    // px/sec: faster metabolism speeds up, bigger size slows down.
    const maxSpeed = (SIM.baseMaxSpeed * (0.4 + 0.6 * mr)) / (0.4 + 0.6 * size);

    const dvx = steerX[i]! * maxSpeed;
    const dvy = steerY[i]! * maxSpeed;

    const vx0 = velX[i]!;
    const vy0 = velY[i]!;
    let vx = vx0 + (dvx - vx0) * accel * dt;
    let vy = vy0 + (dvy - vy0) * accel * dt;

    // Clamp to max speed.
    const sp2 = vx * vx + vy * vy;
    const ms2 = maxSpeed * maxSpeed;
    if (sp2 > ms2 && sp2 > 1e-6) {
      const s = maxSpeed / Math.sqrt(sp2);
      vx *= s;
      vy *= s;
    }

    let nx = posX[i]! + vx * dt;
    let ny = posY[i]! + vy * dt;

    // Reflect off bounds so agents stay in-world.
    if (nx < 0) {
      nx = 0;
      vx = -vx * bounce;
    } else if (nx > WORLD_W) {
      nx = WORLD_W;
      vx = -vx * bounce;
    }
    if (ny < 0) {
      ny = 0;
      vy = -vy * bounce;
    } else if (ny > WORLD_H) {
      ny = WORLD_H;
      vy = -vy * bounce;
    }

    posX[i] = nx;
    posY[i] = ny;
    velX[i] = vx;
    velY[i] = vy;
  }
}
