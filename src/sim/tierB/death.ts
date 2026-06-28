// Tier B — CPU, symbolic/stateful. Energy ≤ 0 (starvation / lost a fight) or age ≥
// LIFESPAN (senescence) → remove via the pool's O(1) swap-remove. We iterate
// downward so a swapped-in agent (always from a higher, already-checked index) is
// never skipped or rechecked.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";

export function death(world: World): void {
  const a = world.agents;
  const { energy, energyB, age, genes } = a;

  let i = a.count;
  while (i > 0) {
    i--;
    const lifespan = genes[i * GENE_COUNT + GENE.LIFESPAN]!;
    // Starvation gates on the SUM of the two nutrient stores (dual-nutrient diet): an agent
    // rich in one nutrient and empty of the other still LIVES (scarcity throttles breeding,
    // not survival — reproduce.ts). Danger is NOT deposited here — natural deaths leave no
    // fear; only combat KILLS stamp danger, in conflict.ts where the lethal blow lands.
    if (energy[i]! + energyB[i]! <= 0 || age[i]! >= lifespan) {
      a.kill(i);
    }
  }
}
