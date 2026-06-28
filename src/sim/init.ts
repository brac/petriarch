// World initialization (Tier B, runs once at startup, never in the hot path):
// seed the resource capacity field and the founding population. All randomness
// flows through world.rng so a seed fully reproduces a run.

import type { World } from "../state/world";
import type { Rng } from "../core/rng";
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
 * Shape ONE region's capacity field (into `cap`): a soft regional baseline (ambient food
 * peaking at the anchor, falling to 0 by the elliptical spread edge so the inter-region gap
 * stays barren) plus `nClumps` rich veins scattered within the region box. Runs once at
 * init (not a hot path), centers/spreads in CELL coords.
 */
function seedRegion(
  cap: Float32Array,
  rng: Rng,
  cxCell: number,
  cyCell: number,
  sxCell: number,
  syCell: number,
  baseAmp: number,
  clumpAmp: number,
  nClumps: number,
): void {
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;
  const cellCap = RESOURCES.cellCapacity;

  // Soft regional baseline (elliptical falloff to 0 at the spread edge).
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const nx = (cx - cxCell) / sxCell;
      const ny = (cy - cyCell) / syCell;
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= 1) continue;
      const c = cy * gw + cx;
      const v = cap[c]! + baseAmp * (1 - d);
      cap[c] = v > cellCap ? cellCap : v;
    }
  }

  // Rich veins, placed within the region box (anchor ± spread).
  for (let k = 0; k < nClumps; k++) {
    let ccx = (cxCell + rng.range(-sxCell, sxCell)) | 0;
    if (ccx < 0) ccx = 0;
    else if (ccx >= gw) ccx = gw - 1;
    let ccy = (cyCell + rng.range(-syCell, syCell)) | 0;
    if (ccy < 0) ccy = 0;
    else if (ccy >= gh) ccy = gh - 1;
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
        const v = cap[c]! + clumpAmp * falloff;
        cap[c] = v > cellCap ? cellCap : v;
      }
    }
  }
}

/**
 * Two-good worldgen: nutrient A (`resources`) clumps in a LEFT region, nutrient B
 * (`resourceB`) in a RIGHT region, with a barren gap between (foundation for inter-region
 * trade — see docs/BUGS.md). `clumpCount` is split evenly A/B; each field starts at
 * `startFrac` of its capacity. Same clump shape as before, just region-gated per nutrient.
 */
export function initResourceField(world: World): void {
  const { resources, resourceCap, resourceB, resourceCapB, rng } = world;
  const R = RESOURCES;
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;

  resourceCap.fill(0);
  resourceCapB.fill(0);

  const baseAmp = R.cellCapacity * (1 - R.clumping);
  const clumpAmp = R.cellCapacity - baseAmp;
  const nClumps = R.clumping > 0 ? R.clumpCount : 0;
  const halfA = nClumps >> 1;
  const halfB = nClumps - halfA;

  const cyCell = R.regionCenterY * gh;
  const sxCell = R.regionSpreadX * gw;
  const syCell = R.regionSpreadY * gh;

  // A-region (left) → resourceCap; B-region (right) → resourceCapB.
  seedRegion(resourceCap, rng, R.regionACenterX * gw, cyCell, sxCell, syCell, baseAmp, clumpAmp, halfA);
  seedRegion(resourceCapB, rng, R.regionBCenterX * gw, cyCell, sxCell, syCell, baseAmp, clumpAmp, halfB);

  const sf = R.startFrac;
  for (let c = 0; c < resourceCap.length; c++) {
    resources[c] = resourceCap[c]! * sf;
    resourceB[c] = resourceCapB[c]! * sf;
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
