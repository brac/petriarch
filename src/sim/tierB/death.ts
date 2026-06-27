// Tier B — CPU, symbolic/stateful. Energy ≤ 0 (starvation / lost a fight) or age ≥
// LIFESPAN (senescence) → remove via the pool's O(1) swap-remove. We iterate
// downward so a swapped-in agent (always from a higher, already-checked index) is
// never skipped or rechecked.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { STIGMERGY } from "../../data/stigmergy";
import { resCellIndex } from "../grid";

export function death(world: World): void {
  const a = world.agents;
  const { posX, posY, energy, age, genes } = a;
  const danger = world.danger;
  const dep = STIGMERGY.dangerDeposit;

  let i = a.count;
  while (i > 0) {
    i--;
    const lifespan = genes[i * GENE_COUNT + GENE.LIFESPAN]!;
    if (energy[i]! <= 0 || age[i]! >= lifespan) {
      // Deposit danger at the dying agent's cell (read position before swap-remove).
      const c = resCellIndex(posX[i]!, posY[i]!);
      danger[c] = danger[c]! + dep;
      a.kill(i);
    }
  }
}
