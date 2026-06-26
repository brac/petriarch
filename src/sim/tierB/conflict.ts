// Tier B — CPU, symbolic/stateful. The reason the world is watchable: at contested
// resource patches, a signature-dissimilar pair where at least one is aggressive
// fights. Strength = SIZE × AGGRESSION × a seeded roll; the loser takes
// SIZE-scaled damage (which the death pass may then cull). A per-agent cooldown
// keeps a frontier a grind rather than an instant wipe. Each contest emits a spark
// the renderer flashes — a war looks like two meshes fraying at a seam.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { CONFLICT } from "../../data/conflict";
import { resCellIndex } from "../grid";

// Reused neighbor scratch (zero alloc per call).
const neighbors: number[] = [];

export function conflict(world: World): void {
  const a = world.agents;
  const { posX, posY, energy, genes, fightCd, count } = a;
  const res = world.resources;
  const hash = world.hash;
  const rng = world.rng;
  const sparks = world.sparks;

  const range2 = CONFLICT.range * CONFLICT.range;
  const sigT = SIM.sigThreshold;
  const aggT = CONFLICT.aggressionThreshold;
  const maxSparks = sparks.x.length;

  // Tick down fight cooldowns.
  for (let i = 0; i < count; i++) {
    if (fightCd[i]! > 0) fightCd[i] = fightCd[i]! - 1;
  }

  for (let i = 0; i < count; i++) {
    if (fightCd[i]! > 0) continue;
    const xi = posX[i]!;
    const yi = posY[i]!;
    // Only fight over food worth contesting.
    if (res[resCellIndex(xi, yi)]! < CONFLICT.contestResourceMin) continue;

    const bi = i * GENE_COUNT;
    const sa = genes[bi + GENE.SIG_A]!;
    const sb = genes[bi + GENE.SIG_B]!;
    const sc = genes[bi + GENE.SIG_C]!;
    const aggi = genes[bi + GENE.AGGRESSION]!;
    const sizi = genes[bi + GENE.SIZE]!;

    hash.queryNeighbors(xi, yi, neighbors);
    const m = neighbors.length;
    for (let k = 0; k < m; k++) {
      const j = neighbors[k]!;
      if (j <= i) continue; // each unordered pair once; also skips self
      if (fightCd[j]! > 0) continue;
      const dx = posX[j]! - xi;
      const dy = posY[j]! - yi;
      if (dx * dx + dy * dy > range2) continue;

      const bj = j * GENE_COUNT;
      const dsa = genes[bj + GENE.SIG_A]! - sa;
      const dsb = genes[bj + GENE.SIG_B]! - sb;
      const dsc = genes[bj + GENE.SIG_C]! - sc;
      if (Math.sqrt(dsa * dsa + dsb * dsb + dsc * dsc) < sigT) continue; // same group

      const aggj = genes[bj + GENE.AGGRESSION]!;
      if (aggi < aggT && aggj < aggT) continue; // neither willing to fight

      // Resolve: stronger SIZE×aggression (with a seeded roll) wins.
      const sizj = genes[bj + GENE.SIZE]!;
      const si = sizi * (0.5 + aggi) * (0.5 + rng.next());
      const sj = sizj * (0.5 + aggj) * (0.5 + rng.next());
      let loser: number;
      let winSize: number;
      if (si >= sj) {
        loser = j;
        winSize = sizi;
      } else {
        loser = i;
        winSize = sizj;
      }
      energy[loser] = energy[loser]! - CONFLICT.loserDamage * winSize;
      fightCd[i] = CONFLICT.cooldownTicks;
      fightCd[j] = CONFLICT.cooldownTicks;

      // Emit a spark at the seam.
      if (sparks.count < maxSparks) {
        sparks.x[sparks.count] = (xi + posX[j]!) * 0.5;
        sparks.y[sparks.count] = (yi + posY[j]!) * 0.5;
        sparks.count++;
      }
      break; // i fights at most once per tick
    }
  }
}
