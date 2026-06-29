// Tier B — CPU, symbolic/stateful. The first COOPERATIVE social system (the counterpart to
// conflict): at a NON-HOSTILE encounter between two COMPLEMENTARY agents — one rich in
// nutrient A / poor in B, the other the reverse — they barter-swap energy toward balance.
// Each gives a low-marginal-value surplus for a high-value deficit, so BOTH move closer to
// the both-stores-high breeding condition (reproduce.ts). The swap conserves each nutrient
// per-agent, so it changes who can BREED, not who survives (death.ts gates on the sum).
//
// Non-hostile = the complement of conflict's fight condition (dissimilar + aggressive): kin,
// or any pair where both are non-aggressive — so two peaceful rival societies can trade.
// NOT a fitness function (rule 10): eligibility/amount read energy + the environment-of-
// neighbors + the TRADE/AGGRESSION genes' VALUES, never a quality score.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { CONFLICT } from "../../data/conflict";
import { TRADE } from "../../data/trade";
import { AMITY } from "../../data/amity";
import { NEIGHBOR_STRIDE } from "../../state/pools";
import { resCellIndex } from "../grid";

// Reused scratch for the own-query (non-think-tick / GPU-mode) path — zero alloc per call.
const ownNbr: number[] = [];

// Runs every tick (like conflict). On a think tick it reuses the neighbor cache sense built
// (`useCache`); otherwise it does its own hash query.
export function trade(world: World, useCache: boolean): void {
  const a = world.agents;
  const { posX, posY, energy, energyB, genes, count, neighborList, neighborCount } = a;
  const hash = world.hash;
  const pulses = world.tradePulses;
  const maxPulses = pulses.x.length;
  const amity = world.amity;
  const amityPerVol = AMITY.perTradeVolume;

  const range2 = TRADE.range * TRADE.range;
  const sigT = SIM.sigThreshold;
  const aggT = CONFLICT.aggressionThreshold;
  const tradeTh = TRADE.tradeThreshold;
  const imbMin = TRADE.imbalanceMin;
  const rate = TRADE.rate;
  const maxEPerSize = SIM.maxEnergyPerSize;

  for (let i = 0; i < count; i++) {
    const imbI = energy[i]! - energyB[i]!;
    if (imbI < imbMin && imbI > -imbMin) continue; // i ~balanced → nothing worth trading

    const bi = i * GENE_COUNT;
    const tradeI = genes[bi + GENE.TRADE]!;
    if (tradeI <= tradeTh) continue; // i unwilling to trade

    const xi = posX[i]!;
    const yi = posY[i]!;
    const sa = genes[bi + GENE.SIG_A]!;
    const sb = genes[bi + GENE.SIG_B]!;
    const sc = genes[bi + GENE.SIG_C]!;
    const aggi = genes[bi + GENE.AGGRESSION]!;

    let nbase: number;
    let nc: number;
    let list: Int32Array | number[];
    if (useCache) {
      nbase = i * NEIGHBOR_STRIDE;
      nc = neighborCount[i]!;
      list = neighborList;
    } else {
      hash.queryNeighbors(xi, yi, ownNbr);
      nbase = 0;
      nc = ownNbr.length;
      list = ownNbr;
    }

    for (let k = 0; k < nc; k++) {
      const j = list[nbase + k]!;
      if (j <= i) continue; // each unordered pair once; also skips self
      const dx = posX[j]! - xi;
      const dy = posY[j]! - yi;
      if (dx * dx + dy * dy > range2) continue;

      const bj = j * GENE_COUNT;
      if (genes[bj + GENE.TRADE]! <= tradeTh) continue; // j unwilling

      // Non-hostile? (skip pairs that conflict would resolve as a fight)
      const dsa = genes[bj + GENE.SIG_A]! - sa;
      const dsb = genes[bj + GENE.SIG_B]! - sb;
      const dsc = genes[bj + GENE.SIG_C]! - sc;
      const dissimilar = Math.sqrt(dsa * dsa + dsb * dsb + dsc * dsc) >= sigT;
      const aggj = genes[bj + GENE.AGGRESSION]!;
      if (dissimilar && (aggi >= aggT || aggj >= aggT)) continue; // they'd fight, not trade

      // Complementary imbalance? one A-surplus, one B-surplus.
      const imbJ = energy[j]! - energyB[j]!;
      let aSup: number;
      let bSup: number;
      if (imbI >= imbMin && imbJ <= -imbMin) {
        aSup = i;
        bSup = j;
      } else if (imbJ >= imbMin && imbI <= -imbMin) {
        aSup = j;
        bSup = i;
      } else {
        continue; // not complementary (same-sign or one is balanced)
      }

      // Swap toward balance: the A-surplus agent gives A, the B-surplus gives B. The amount is
      // bounded by the smaller surplus (½ exactly balances it) and the receivers' headroom.
      const surplusA = energy[aSup]! - energyB[aSup]!; // > 0
      const surplusB = energyB[bSup]! - energy[bSup]!; // > 0
      const minTrade = tradeI < genes[bj + GENE.TRADE]! ? tradeI : genes[bj + GENE.TRADE]!;
      let t = rate * minTrade * 0.5 * (surplusA < surplusB ? surplusA : surplusB);
      const roomAsupB = genes[aSup * GENE_COUNT + GENE.SIZE]! * maxEPerSize - energyB[aSup]!;
      const roomBsupA = genes[bSup * GENE_COUNT + GENE.SIZE]! * maxEPerSize - energy[bSup]!;
      if (t > roomAsupB) t = roomAsupB;
      if (t > roomBsupA) t = roomBsupA;
      if (t <= 0) continue;

      energy[aSup] = energy[aSup]! - t; // nutrient A: aSup → bSup
      energy[bSup] = energy[bSup]! + t;
      energyB[bSup] = energyB[bSup]! - t; // nutrient B: bSup → aSup
      energyB[aSup] = energyB[aSup]! + t;
      a.tradeTotal++;
      // Stamp amity at the exchange, scaled by swap volume — commerce pacifies its seam
      // (conflict.ts reads this to suppress fights). Mirror of conflict's danger stamp.
      const ac = resCellIndex(xi, yi);
      amity[ac] = amity[ac]! + amityPerVol * t;
      // Emit a gold pulse at the exchange (the renderer's trade mesh).
      if (pulses.count < maxPulses) {
        pulses.x[pulses.count] = (xi + posX[j]!) * 0.5;
        pulses.y[pulses.count] = (yi + posY[j]!) * 0.5;
        pulses.count++;
      }
      break; // i initiates at most one trade per tick
    }
  }
}
