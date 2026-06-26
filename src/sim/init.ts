// World initialization (Tier B, runs once at startup, never in the hot path):
// seed the resource capacity field and the founding population. All randomness
// flows through world.rng so a seed fully reproduces a run.

import type { World } from "../state/world";
import { GENE, GENE_COUNT, GENE_RANGE } from "../data/genome";
import { SIM } from "../data/sim";
import { RESOURCES } from "../data/resources";
import {
  WORLD_W,
  WORLD_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
} from "../data/capacity";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Shape the per-cell capacity field: a low uniform baseline plus a few rich veins
 * (count/strength driven by `clumping`). resources start at startFrac of capacity.
 * Clumped fields favor territorial hoarders; flatter fields favor wanderers.
 */
export function initResourceField(world: World): void {
  const { resources, resourceCap, rng } = world;
  const { cellCapacity, clumping, clumpCount, startFrac } = RESOURCES;
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;

  const base = cellCapacity * (1 - clumping);
  resourceCap.fill(base);

  const amp = cellCapacity - base;
  const clumps = clumping > 0 ? clumpCount : 0;
  for (let k = 0; k < clumps; k++) {
    const ccx = rng.int(0, gw);
    const ccy = rng.int(0, gh);
    const rad = rng.range(3, 8);
    const rad2 = rad * rad;
    const x0 = Math.max(0, (ccx - rad) | 0);
    const x1 = Math.min(gw - 1, (ccx + rad) | 0);
    const y0 = Math.max(0, (ccy - rad) | 0);
    const y1 = Math.min(gh - 1, (ccy + rad) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx - ccx;
        const dy = cy - ccy;
        const d2 = dx * dx + dy * dy;
        if (d2 > rad2) continue;
        const falloff = 1 - d2 / rad2;
        const c = cy * gw + cx;
        const v = resourceCap[c]! + amp * falloff;
        resourceCap[c] = v > cellCapacity ? cellCapacity : v;
      }
    }
  }

  for (let c = 0; c < resourceCap.length; c++) {
    resources[c] = resourceCap[c]! * startFrac;
  }
}

/**
 * Spawn the founding population: `founderTribes` distinct signatures (so initial
 * tribes are visible), each agent a random genome drawn within GENE_RANGE with its
 * signature jittered around its tribe's. No fitness selection — just a starting
 * gene pool the environment will sort out.
 */
export function seedPopulation(world: World): void {
  const { agents, rng } = world;
  const tribes = SIM.founderTribes;

  // Founder signatures (a point in tag-space per tribe).
  const sigA = new Float32Array(tribes);
  const sigB = new Float32Array(tribes);
  const sigC = new Float32Array(tribes);
  for (let f = 0; f < tribes; f++) {
    sigA[f] = rng.next();
    sigB[f] = rng.next();
    sigC[f] = rng.next();
  }

  const genes = agents.genes;
  for (let n = 0; n < SIM.initialPop; n++) {
    const f = rng.int(0, tribes);
    const x = rng.range(0, WORLD_W);
    const y = rng.range(0, WORLD_H);
    const i = agents.spawn(x, y, 0, f);
    if (i < 0) break; // at capacity

    const base = i * GENE_COUNT;
    for (let g = 0; g < GENE_COUNT; g++) {
      const range = GENE_RANGE[g]!;
      genes[base + g] = rng.range(range[0], range[1]);
    }
    // Override the signature with the tribe's, jittered, so tribes read as clusters.
    genes[base + GENE.SIG_A] = clamp01(sigA[f]! + rng.range(-0.05, 0.05));
    genes[base + GENE.SIG_B] = clamp01(sigB[f]! + rng.range(-0.05, 0.05));
    genes[base + GENE.SIG_C] = clamp01(sigC[f]! + rng.range(-0.05, 0.05));

    // Start with a fraction of this body's max energy (max scales with SIZE).
    const maxE = genes[base + GENE.SIZE]! * SIM.maxEnergyPerSize;
    agents.energy[i] = maxE * SIM.startEnergyFrac;
  }

  // Build the hash so the first think tick has neighbors.
  world.hash.build(agents.posX, agents.posY, agents.count);
}
