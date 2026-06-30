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
  const axCell = R.regionACenterX * gw;
  const bxCell = R.regionBCenterX * gw;
  const cf = R.regionCrossFrac;

  // Each region grows its DOMINANT nutrient at full strength + a trace of the other (the
  // cross-crop, so a dual-nutrient population survives locally and trade has something to
  // relieve). A-region → mostly resourceCap (A); B-region → mostly resourceCapB (B).
  seedRegion(resourceCap, rng, axCell, cyCell, sxCell, syCell, baseAmp, clumpAmp, halfA);
  seedRegion(resourceCapB, rng, axCell, cyCell, sxCell, syCell, baseAmp * cf, clumpAmp * cf, halfA);
  seedRegion(resourceCapB, rng, bxCell, cyCell, sxCell, syCell, baseAmp, clumpAmp, halfB);
  seedRegion(resourceCap, rng, bxCell, cyCell, sxCell, syCell, baseAmp * cf, clumpAmp * cf, halfB);

  const sf = R.startFrac;
  for (let c = 0; c < resourceCap.length; c++) {
    resources[c] = resourceCap[c]! * sf;
    resourceB[c] = resourceCapB[c]! * sf;
  }

  buildScent(world);
}

/**
 * Build the static supply-scent fields (P4a): a smooth long-range CONE peaking at each nutrient's
 * region anchor, so the gradient points straight at that region from ANYWHERE — uniform magnitude, no
 * gap-valley, no edge artifacts. A B-deficient agent climbs scentB → pulled across the barren gap
 * toward the B-region (the long-range REACH the local 4-neighbour food gradient can't provide). Built
 * once here and rebuilt on snapshot restore. Anchored to the worldgen's region centres (environmental
 * geography, not a fitness score — rule 10). NOTE: assumes one anchor per nutrient (the two-region
 * worldgen); a multi-region map would want a distance-transform from each nutrient's dominant cells
 * instead (diffusion decays the far signal to noise — tried, doesn't reach). data/scent.ts tunes the
 * steer weight; the cone reaches the whole map by construction.
 */
export function buildScent(world: World): void {
  const { scentA, scentB } = world;
  const R = RESOURCES;
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;
  const axA = R.regionACenterX * gw;
  const axB = R.regionBCenterX * gw;
  const ay = R.regionCenterY * gh;
  const reach = Math.hypot(gw, gh); // covers the whole map → a gentle pull everywhere
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const c = cy * gw + cx;
      const dyc = cy - ay;
      const dA = Math.hypot(cx - axA, dyc);
      const dB = Math.hypot(cx - axB, dyc);
      scentA[c] = reach - dA; // peaks at anchor A, decreases with distance → climb = toward A
      scentB[c] = reach - dB;
    }
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

    // Start with a fraction of this body's max energy in BOTH nutrient stores (each store
    // caps at maxE; dual-nutrient diet — see metabolism.ts).
    const maxE = genes[base + GENE.SIZE]! * SIM.maxEnergyPerSize;
    agents.energy[i] = maxE * SIM.startEnergyFrac;
    agents.energyB[i] = maxE * SIM.startEnergyFrac;
  }

  // Build the hash so the first think tick has neighbors.
  world.hash.build(agents.posX, agents.posY, agents.count);
}
