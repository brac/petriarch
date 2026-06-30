// Tier B — CPU, symbolic/stateful. The carry/return state machine that turns crossers into CARRIERS
// (docs/P4C_PLAN.md §P4c) — the round trip that makes long-distance trade real instead of migration.
//
// Per agent, each tick: flip carryState by where it is (which region's scent dominates) + how loaded
// it is on the AWAY good. A forage agent that has reached the away region AND filled up on the away
// good flips to `return`; a returning agent that has crossed back into its home region flips to
// `forage`. steer reads carryState: forage → climb the lacked good's scent (P4a/b); return → climb the
// HOME good's scent (head home). NOT a fitness function (reads position + energy + the static scent
// field, never a quality score — rule 10). Branchy per-agent state → Tier B, never the GPU (rule 4);
// steer only READS the resulting flag.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { CARAVAN } from "../../data/caravan";
import { resCellIndex } from "../grid";

/** Home nutrient at a birth position: 0 = A, 1 = B, whichever region's scent dominates the cell.
 *  Used by reproduce/seed to stamp an offspring's home from where it's born. */
export function homeGoodAt(world: World, x: number, y: number): number {
  const c = resCellIndex(x, y);
  return world.scentA[c]! >= world.scentB[c]! ? 0 : 1;
}

// carryState: 0 = FORAGE (forage home region locally, build up the home good), 2 = OUTBOUND (committed
// crossing to the far region, full scent pull, ignore the provisioning gate), 1 = RETURN (committed
// crossing home with the loaded far good). The cycle: forage → (home good full) → outbound → (away good
// loaded) → return → (home reached) → forage.
export function caravan(world: World): void {
  const a = world.agents;
  const { posX, posY, energy, energyB, genes, carryState, homeGood, count } = a;
  const scentA = world.scentA;
  const scentB = world.scentB;
  const commitFrac = CARAVAN.commitFrac;
  const loadFrac = CARAVAN.loadFrac;
  const maxEPerSize = SIM.maxEnergyPerSize;

  for (let i = 0; i < count; i++) {
    const home = homeGood[i]!;
    const maxStore = genes[i * GENE_COUNT + GENE.SIZE]! * maxEPerSize;
    const homeStore = home === 0 ? energy[i]! : energyB[i]!;
    const awayStore = home === 0 ? energyB[i]! : energy[i]!;
    const s = carryState[i]!;

    if (s === 0) {
      // FORAGE → OUTBOUND: provisioned (home good filled) and still needing the away good → set off.
      if (homeStore >= commitFrac * maxStore && awayStore < loadFrac * maxStore) carryState[i] = 2;
    } else if (s === 2) {
      // OUTBOUND → RETURN: must ACTUALLY have reached the far region (away-good scent dominates the
      // cell) AND be loaded on the away good. Without the geographic check, ordinary barter near home
      // tops up awayStore past loadFrac and the agent flickers OUTBOUND→RETURN→FORAGE without ever
      // crossing — inflating the round-trip counters with non-journeys (P4c metric/behaviour bug).
      const c = resCellIndex(posX[i]!, posY[i]!);
      const homeScent = home === 0 ? scentA[c]! : scentB[c]!;
      const awayScent = home === 0 ? scentB[c]! : scentA[c]!;
      if (awayScent > homeScent && awayStore >= loadFrac * maxStore) { carryState[i] = 1; a.caravanLoaded++; }
    } else {
      // RETURN → FORAGE: crossed back into the home region (home-good scent dominates the cell).
      const c = resCellIndex(posX[i]!, posY[i]!);
      const homeScent = home === 0 ? scentA[c]! : scentB[c]!;
      const awayScent = home === 0 ? scentB[c]! : scentA[c]!;
      if (homeScent >= awayScent) { carryState[i] = 0; a.caravanDelivered++; }
    }
  }
}
