// Tier A — GPU-portable, buffer contract. Per-agent, uniform, parallel.
// Neighbor-gather via the spatial hash (every THINK_INTERVAL ticks), capped by the
// intensity neighbor budget. Writes per-agent aggregates (kin cohesion target,
// separation push, threat-avoidance push) that the steer pass turns into a vector.
// Reads only flat buffers + the hash; writes only the sense scratch arrays.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";

// Reused scratch for the neighbor query — grown once, never per-call (zero alloc).
const neighbors: number[] = [];

export function sense(world: World): void {
  const a = world.agents;
  const { posX, posY, genes, count } = a;
  const hash = world.hash;
  const budget = world.intensity.neighborBudget;
  const senseR2 = SIM.senseRadius * SIM.senseRadius;
  const sepR2 = SIM.separationRadius * SIM.separationRadius;
  const sigT = SIM.sigThreshold;

  for (let i = 0; i < count; i++) {
    const xi = posX[i]!;
    const yi = posY[i]!;
    const bi = i * GENE_COUNT;
    const sa = genes[bi + GENE.SIG_A]!;
    const sb = genes[bi + GENE.SIG_B]!;
    const sc = genes[bi + GENE.SIG_C]!;

    let kinX = 0;
    let kinY = 0;
    let kinN = 0;
    let sepX = 0;
    let sepY = 0;
    let avoidX = 0;
    let avoidY = 0;

    hash.queryNeighbors(xi, yi, neighbors);
    const m = neighbors.length;
    let sampled = 0;
    for (let k = 0; k < m; k++) {
      const j = neighbors[k]!;
      if (j === i) continue;
      const dx = posX[j]! - xi;
      const dy = posY[j]! - yi;
      const d2 = dx * dx + dy * dy;
      if (d2 > senseR2) continue;
      if (++sampled > budget) break;

      const bj = j * GENE_COUNT;
      const dsa = genes[bj + GENE.SIG_A]! - sa;
      const dsb = genes[bj + GENE.SIG_B]! - sb;
      const dsc = genes[bj + GENE.SIG_C]! - sc;
      const sigDist = Math.sqrt(dsa * dsa + dsb * dsb + dsc * dsc);

      // Separation: repel from anyone very close (1/d weighting, away from them).
      if (d2 < sepR2 && d2 > 1e-4) {
        const inv = 1 / Math.sqrt(d2);
        sepX -= dx * inv;
        sepY -= dy * inv;
      }

      if (sigDist < sigT) {
        // Kin: accumulate position so steer can pull toward the kin centroid.
        kinX += posX[j]!;
        kinY += posY[j]!;
        kinN++;
      } else if (d2 > 1e-4) {
        // Non-kin threat: repel, weighted by their SIZE × aggression.
        const threat = genes[bj + GENE.SIZE]! * (0.5 + genes[bj + GENE.AGGRESSION]!);
        const inv = 1 / Math.sqrt(d2);
        avoidX -= dx * inv * threat;
        avoidY -= dy * inv * threat;
      }
    }

    a.senseKinX[i] = kinX;
    a.senseKinY[i] = kinY;
    a.senseKinCount[i] = kinN;
    a.senseSepX[i] = sepX;
    a.senseSepY[i] = sepY;
    a.senseAvoidX[i] = avoidX;
    a.senseAvoidY[i] = avoidY;
  }
}
