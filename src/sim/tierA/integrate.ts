// Tier A — GPU-portable, buffer contract. Runs every tick: accelerate velocity
// toward the cached steering target, clamp to a gene-derived max speed, move, and
// reflect off world bounds. Consumes agents.steerX/steerY (a unit direction written
// by steer every THINK_INTERVAL). Bigger bodies are slower; faster metabolism is
// quicker — both tradeoffs the genome pays for elsewhere.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { MORPH } from "../../data/morphology";
import { PASSABILITY } from "../../data/passability";
import { WORLD_W, WORLD_H } from "../../data/capacity";
import { resCellIndex } from "../grid";
import { TICK_DT } from "../../core/time";

export function integrate(world: World): void {
  const a = world.agents;
  const { posX, posY, velX, velY, steerX, steerY, genes, count } = a;
  const passability = world.passability;
  const block = PASSABILITY.blockThreshold;
  const dt = TICK_DT;
  const accel = SIM.steerAccel;
  const bounce = SIM.wallBounce;

  for (let i = 0; i < count; i++) {
    const bi = i * GENE_COUNT;
    const size = genes[bi + GENE.SIZE]!;
    const mr = genes[bi + GENE.METABOLIC_RATE]!;
    const efficiency = genes[bi + GENE.EFFICIENCY]!;
    // px/sec: faster metabolism speeds up, bigger size slows down (penalty
    // strength = SIM.sizeSpeedFactor, mild enough that big bodies still forage).
    // EFFICIENCY trades speed for digestion — efficient bodies are sluggish foragers.
    const k = SIM.sizeSpeedFactor;
    const maxSpeed =
      ((SIM.baseMaxSpeed * (0.4 + 0.6 * mr)) / (1 - k + k * size)) * (1 - MORPH.effSpeedPenalty * efficiency);

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

    // Passability: sample the target cell's movement cost. An ocean/wall (cost ≥ block)
    // is impassable — stay put and reflect off the coast, like a world bound. Costed
    // terrain (cost ≠ 1) scales the step: < 1 speeds it (road), > 1 slows it (swamp).
    // With the default all-1 field both branches are no-ops (and the GPU pass matches).
    const cost = passability[resCellIndex(nx, ny)]!;
    if (cost >= block) {
      nx = posX[i]!;
      ny = posY[i]!;
      vx = -vx * bounce;
      vy = -vy * bounce;
    } else if (cost !== 1) {
      const s = 1 / cost;
      nx = posX[i]! + (nx - posX[i]!) * s;
      ny = posY[i]! + (ny - posY[i]!) * s;
      if (nx < 0) nx = 0;
      else if (nx > WORLD_W) nx = WORLD_W;
      if (ny < 0) ny = 0;
      else if (ny > WORLD_H) ny = WORLD_H;
    }

    posX[i] = nx;
    posY[i] = ny;
    velX[i] = vx;
    velY[i] = vy;
  }
}
