// Tier B — CPU, symbolic/stateful. Energy ≥ (REPRO_THRESHOLD × max energy) → spend
// energy and emit FERTILITY offspring into fresh pool slots. Each offspring's genome
// is the parent's slice plus seeded noise scaled by the parent's MUTABILITY, clamped
// to GENE_RANGE (docs/genome.md §Mutation model). Signature genes mutate like any
// other — that drift is what creates new tribes over generations.
//
// NOT a fitness function (CLAUDE.md rule 10): the only gate is "fed enough to
// breed". We never score agents and preferentially breed the high scorers.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT, GENE_RANGE } from "../../data/genome";
import { SIM } from "../../data/sim";
import { WORLD_W, WORLD_H } from "../../data/capacity";

export function reproduce(world: World): void {
  const a = world.agents;
  const { energy, posX, posY, genes, lineageId } = a;
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
    const e = energy[i]!;
    if (e < threshE) continue;

    const invest = threshE * SIM.reproInvestFrac;
    if (e - invest <= 1) continue; // never breed yourself to death
    energy[i] = e - invest;

    const litter = Math.max(1, Math.round(genes[bi + GENE.FERTILITY]!));
    const perChild = invest / litter;
    // Mutation scale modulated by the parent's MUTABILITY, with a floor so it can
    // drift but never lock to zero.
    const mut = SIM.baseMutationScale * (SIM.mutabilityFloor + genes[bi + GENE.MUTABILITY]!);
    const lin = lineageId[i]!;
    const px = posX[i]!;
    const py = posY[i]!;

    for (let c = 0; c < litter; c++) {
      if (a.count >= cap) break;
      let jx = px + rng.range(-SIM.birthJitter, SIM.birthJitter);
      let jy = py + rng.range(-SIM.birthJitter, SIM.birthJitter);
      if (jx < 0) jx = 0;
      else if (jx > WORLD_W) jx = WORLD_W;
      if (jy < 0) jy = 0;
      else if (jy > WORLD_H) jy = WORLD_H;
      const k = a.spawn(jx, jy, perChild, lin);
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
