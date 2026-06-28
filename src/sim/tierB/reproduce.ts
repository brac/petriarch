// Tier B — CPU, symbolic/stateful. Energy ≥ (REPRO_THRESHOLD × max energy) → spend
// energy and emit FERTILITY offspring into fresh pool slots. Each offspring's genome
// is the parent's slice plus seeded noise scaled by the parent's MUTABILITY, clamped
// to GENE_RANGE (docs/genome.md §Mutation model). Signature genes mutate like any
// other — that drift is what creates new tribes over generations.
//
// NOT a fitness function (CLAUDE.md rule 10): the gates are "fed enough to breed" (stored
// energy) and "standing where there's food to feed the litter" (local resource). Both read
// energy/environment, never the genome — we never score agents and breed the high scorers.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT, GENE_RANGE } from "../../data/genome";
import { SIM } from "../../data/sim";
import { WORLD_W, WORLD_H, RES_CELL_W, RES_CELL_H, RESOURCE_GRID_W, RESOURCE_GRID_H } from "../../data/capacity";

export function reproduce(world: World): void {
  const a = world.agents;
  const { energy, energyB, posX, posY, genes, lineageId } = a;
  const res = world.resources;
  const resB = world.resourceB;
  const rng = world.rng;

  // Population cap = the intensity slider's target (never above pool capacity).
  const cap = Math.min(a.capacity, world.intensity.activeCount);

  // Snapshot count: offspring are appended past n, so they aren't iterated this tick.
  const n = a.count;
  for (let i = 0; i < n; i++) {
    if (a.count >= cap) break;
    const bi = i * GENE_COUNT;
    const size = genes[bi + GENE.SIZE]!;
    const maxE = size * SIM.maxEnergyPerSize;
    const threshE = genes[bi + GENE.REPRO_THRESHOLD]! * maxE;
    // Dual-nutrient diet: breeding needs BOTH stores above threshold (a balanced supply).
    // A resident rich in its home nutrient but short on the other can't breed until it gets
    // the scarce one — the demand trade will relieve. Survival (death.ts) needs only the sum.
    const eA = energy[i]!;
    const eB = energyB[i]!;
    if (eA < threshE || eB < threshE) continue;

    const invest = threshE * SIM.reproInvestFrac;
    if (eA - invest <= 1 || eB - invest <= 1) continue; // never breed yourself to death

    const litter = Math.max(1, Math.round(genes[bi + GENE.FERTILITY]!));
    const px = posX[i]!;
    const py = posY[i]!;

    // Environmental food-gate: don't breed into a food desert — offspring spawn within ~1
    // cell (birthJitter) and would just starve at birth (the wasteful born→die churn). Sum
    // the resource in the parent's 3×3 resource-cell block and require it to cover the
    // litter. Reads the FIELD, not the genome → not a fitness score; it just defers breeding
    // until the agent reaches food (its energy is kept, not spent). reproMinLocalFood=0 → off.
    if (SIM.reproMinLocalFood > 0) {
      let cx = (px / RES_CELL_W) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= RESOURCE_GRID_W) cx = RESOURCE_GRID_W - 1;
      let cy = (py / RES_CELL_H) | 0;
      if (cy < 0) cy = 0;
      else if (cy >= RESOURCE_GRID_H) cy = RESOURCE_GRID_H - 1;
      const x0 = cx > 0 ? cx - 1 : cx;
      const x1 = cx < RESOURCE_GRID_W - 1 ? cx + 1 : cx;
      const y0 = cy > 0 ? cy - 1 : cy;
      const y1 = cy < RESOURCE_GRID_H - 1 ? cy + 1 : cy;
      let localFood = 0;
      for (let ny = y0; ny <= y1; ny++) {
        const row = ny * RESOURCE_GRID_W;
        for (let nx = x0; nx <= x1; nx++) localFood += res[row + nx]! + resB[row + nx]!;
      }
      if (localFood < SIM.reproMinLocalFood * litter) continue; // desert → defer breeding
    }

    energy[i] = eA - invest;
    energyB[i] = eB - invest;
    const perChild = invest / litter; // per offspring, of EACH nutrient store
    // Mutation scale modulated by the parent's MUTABILITY, with a floor so it can
    // drift but never lock to zero.
    const mut = SIM.baseMutationScale * (SIM.mutabilityFloor + genes[bi + GENE.MUTABILITY]!);
    const lin = lineageId[i]!;

    for (let c = 0; c < litter; c++) {
      if (a.count >= cap) break;
      let jx = px + rng.range(-SIM.birthJitter, SIM.birthJitter);
      let jy = py + rng.range(-SIM.birthJitter, SIM.birthJitter);
      if (jx < 0) jx = 0;
      else if (jx > WORLD_W) jx = WORLD_W;
      if (jy < 0) jy = 0;
      else if (jy > WORLD_H) jy = WORLD_H;
      const k = a.spawn(jx, jy, perChild, lin, perChild);
      if (k < 0) break;
      const bk = k * GENE_COUNT;
      for (let g = 0; g < GENE_COUNT; g++) {
        const range = GENE_RANGE[g]!;
        // Triangular noise (sum of two uniforms) — cheap, zero-mean, seeded.
        const tri = rng.next() * 2 - 1 + (rng.next() * 2 - 1);
        let v = genes[bi + g]! + tri * mut * (range[1] - range[0]);
        if (v < range[0]) v = range[0];
        else if (v > range[1]) v = range[1];
        genes[bk + g] = v;
      }
    }
  }
}
