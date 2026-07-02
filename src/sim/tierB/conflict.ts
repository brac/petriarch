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
import { AMITY } from "../../data/amity";
import { TERRITORY } from "../../data/territory";
import { MORPH } from "../../data/morphology";
import { STIGMERGY } from "../../data/stigmergy";
import { NEIGHBOR_STRIDE } from "../../state/pools";
import { resCellIndex } from "../grid";

// Reused scratch for the own-query (non-think-tick) path — zero alloc per call.
const ownNbr: number[] = [];

// Below this |homeI - homeJ| a contest doesn't inform the defender-win-rate diagnostic (both
// combatants equally at-home or equally away) — don't count it in the study ratio.
const HOME_CONTEST_EPS = 0.05;

// Home-ground match ∈ [0,1]: how well signature (sa,sb,sc) matches the claim on cell `c`. 1 = the
// cell is held by your own kind (mean claim signature within the same-group threshold), 0 = a full
// sigThreshold away OR the cell is neutral ground (claim magnitude below minMag). Zero-alloc; the
// arrays and scalars are passed in so this stays a plain top-level function, not a hot-path closure.
function homeMatch(
  mag: Float32Array, sigA: Float32Array, sigB: Float32Array, sigC: Float32Array,
  c: number, sa: number, sb: number, sc: number, minMag: number, sigT: number,
): number {
  const m = mag[c]!;
  // `m <= 0` as well as `m < minMag`: minMag can be slid to 0 in the dev panel, and an unclaimed cell
  // (m == 0, sig == 0) would then pass `m < minMag` and hit 1/0 → 0*Infinity = NaN, which propagates
  // into si/sj and silently corrupts the `si >= sj` fight resolution (NaN comparisons are false).
  if (m < minMag || m <= 0) return 0;
  const inv = 1 / m;
  const dA = sigA[c]! * inv - sa;
  const dB = sigB[c]! * inv - sb;
  const dC = sigC[c]! * inv - sc;
  const h = 1 - Math.sqrt(dA * dA + dB * dB + dC * dC) / sigT;
  return h < 0 ? 0 : h > 1 ? 1 : h;
}

// Runs EVERY tick so conflict pressure is intensity-invariant (it no longer rides
// on the think cadence). On a think tick it reuses the neighbor cache sense just
// built (`useCache`); on other ticks it does its own cheap hash query — but only
// for the agents actually standing on contestable food, so the cost is bounded.
export function conflict(world: World, useCache: boolean): void {
  const a = world.agents;
  const { posX, posY, energy, energyB, genes, fightCd, count, neighborList, neighborCount } = a;
  const res = world.resources;
  const danger = world.danger;
  const amity = world.amity;
  const amitySuppress = AMITY.suppress;
  // Territory (home-ground defense): the claim field becomes a conflict modifier.
  const claimMag = world.claimMag;
  const claimSigA = world.claimSigA;
  const claimSigB = world.claimSigB;
  const claimSigC = world.claimSigC;
  const defBonus = TERRITORY.defBonus;
  const territoryMinMag = TERRITORY.minMag;
  const hash = world.hash;
  const rng = world.rng;
  const sparks = world.sparks;

  const range2 = CONFLICT.range * CONFLICT.range;
  const sigT = SIM.sigThreshold;
  const aggT = CONFLICT.aggressionThreshold;
  const maxSparks = sparks.x.length;

  // Cooldowns tick down by 1 (conflict runs every tick) — real-tick denominated.
  for (let i = 0; i < count; i++) {
    if (fightCd[i]! > 0) fightCd[i] = fightCd[i]! - 1;
  }

  for (let i = 0; i < count; i++) {
    if (fightCd[i]! > 0) continue;
    const xi = posX[i]!;
    const yi = posY[i]!;
    const ci = resCellIndex(xi, yi);
    // Only fight over food worth contesting.
    if (res[ci]! < CONFLICT.contestResourceMin) continue;

    const bi = i * GENE_COUNT;
    const sa = genes[bi + GENE.SIG_A]!;
    const sb = genes[bi + GENE.SIG_B]!;
    const sc = genes[bi + GENE.SIG_C]!;
    const aggi = genes[bi + GENE.AGGRESSION]!;
    const sizi = genes[bi + GENE.SIZE]!;
    // Amity (accumulated trade) raises the bar for violence in this cell — a pacified
    // border market suppresses fights (P3). High enough amity pushes aggTeff past the
    // gene max → no fight starts here, so commerce visibly cools the seam.
    const aggTeff = aggT + amitySuppress * amity[ci]!;

    // Neighbor source: sense's cache on think ticks, else a fresh query.
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
      // Suppression: a pair willing under the base threshold but not the amity-raised one
      // is a fight commerce averted — count it as a P3 diagnostic, then skip.
      if (aggi < aggTeff && aggj < aggTeff) {
        if (aggi >= aggT || aggj >= aggT) a.fightSuppressedTotal++;
        continue; // neither willing enough to fight here
      }

      // Resolve: stronger SIZE×aggression (with a seeded roll) wins — plus HOME-GROUND DEFENSE:
      // each fighter is boosted by how well its signature matches the claim on the cell it stands on
      // (Territory T1). A defender deep in its own turf fights up to (1+defBonus)× as hard; an invader
      // on foreign/neutral ground gets no bonus → borders harden, invasions get repelled. The edge is
      // purely local, so it taxes mobility (raiders/carriers fight weak abroad) — the tradeoff.
      const sizj = genes[bj + GENE.SIZE]!;
      const homeI = homeMatch(claimMag, claimSigA, claimSigB, claimSigC, ci, sa, sb, sc, territoryMinMag, sigT);
      const cj = resCellIndex(posX[j]!, posY[j]!);
      const homeJ = homeMatch(claimMag, claimSigA, claimSigB, claimSigC, cj,
        genes[bj + GENE.SIG_A]!, genes[bj + GENE.SIG_B]!, genes[bj + GENE.SIG_C]!, territoryMinMag, sigT);
      // rng draws stay in i-then-j order so defBonus 0 is bit-identical to pre-Territory behavior.
      const rollI = rng.next();
      const rollJ = rng.next();
      const si = sizi * (0.5 + aggi) * (0.5 + rollI) * (1 + defBonus * homeI);
      const sj = sizj * (0.5 + aggj) * (0.5 + rollJ) * (1 + defBonus * homeJ);
      let winner: number;
      let loser: number;
      let winSize: number;
      if (si >= sj) {
        winner = i;
        loser = j;
        winSize = sizi;
      } else {
        winner = j;
        loser = i;
        winSize = sizj;
      }
      // The loser takes SIZE-scaled damage; the winner ROBS a fraction of it. These
      // spoils are what make SIZE+AGGRESSION pay — a predator strategy that competes
      // with small-fast-forager. Predation is lossy (stealFrac < 1) so it transfers
      // energy rather than creating it; carrying capacity stays food-bound.
      // The loser's RESILIENCE armors it against the blow (its benefit).
      const loserRes = genes[loser * GENE_COUNT + GENE.RESILIENCE]!;
      const dmg = CONFLICT.loserDamage * winSize * (1 - MORPH.resDamageReduction * loserRes);
      // Dual-nutrient: the blow drains the loser's TOTAL energy, proportionally across both
      // stores, so combat stays lethal on the sum (death.ts). The winner robs a fraction as
      // fuel into its A store.
      const leA = energy[loser]!;
      const leB = energyB[loser]!;
      const le = leA + leB;
      if (le > 1e-6) {
        energy[loser] = leA - dmg * (leA / le);
        energyB[loser] = leB - dmg * (leB / le);
      } else {
        energy[loser] = leA - dmg;
      }
      // Stamp danger at the violence, scaled by damage dealt (a kill is the biggest
      // blow → the biggest stamp). Combat-only: natural deaths (starvation, senescence)
      // leave no fear, so the field marks active frontiers, not the whole map.
      const dc = resCellIndex(posX[loser]!, posY[loser]!);
      danger[dc] = danger[dc]! + STIGMERGY.dangerPerDamage * dmg;
      const stolen = (le > 0 ? (dmg < le ? dmg : le) : 0) * CONFLICT.stealFrac;
      if (stolen > 0) {
        const wMaxE = winSize * SIM.maxEnergyPerSize;
        const we = energy[winner]! + stolen;
        energy[winner] = we > wMaxE ? wMaxE : we;
      }
      fightCd[i] = CONFLICT.cooldownTicks;
      fightCd[j] = CONFLICT.cooldownTicks;
      a.fightTotal++;
      // Defender-win-rate diagnostic: for contests where one fighter is meaningfully more at-home,
      // did the more-home combatant win? ratio homeWin/homeContest = ~0.5 at defBonus 0, rises with it.
      if (homeI - homeJ > HOME_CONTEST_EPS || homeJ - homeI > HOME_CONTEST_EPS) {
        a.homeContestTotal++;
        const moreHome = homeI > homeJ ? i : j;
        if (winner === moreHome) a.homeWinTotal++;
      }

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
