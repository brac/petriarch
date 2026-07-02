// TERRITORY study (T1 — temporary research harness; run with vite-node like amitycheck/predation).
// Question: does HOME-GROUND DEFENSE (the claim field becomes a conflict modifier — a defender on its
// own turf fights harder) actually harden borders — WITHOUT collapsing the world into a frozen
// monoculture or flattening the predation/trade niches? (docs/TERRITORY_PLAN.md.)
//
// Project-relative imports so TERRITORY is the SINGLE shared instance the sim reads live (a scratchpad
// copy would make the override a no-op).
//
// Configs isolate defBonus's contribution:
//   OFF     defBonus 0    → claim stays render-only, pre-Territory behavior (bit-identical) — baseline
//   ON      defBonus 0.6  → home-ground defense at the shipped default                      — treatment
//   strong  defBonus 1.0  → stronger edge (trend check — does more defense over-freeze borders?)
//
// Metrics (live population, tail-averaged over seeds):
//   pop        population (collapse / starvation guard)
//   defWin     homeWin/homeContest — DEFENDER-WIN-RATE, the clean causal readout: ~0.5 at OFF, must
//              RISE with defBonus (proof the mechanic bites). Contests where one fighter is meaningfully
//              more at-home; did the more-home one win.
//   atHome     fraction of agents standing on cells whose mean claim signature matches their own
//              (homeMatch>0.5) — a BORDER-HARDENING proxy: less cross-region interpenetration ⇒ higher.
//   sigVar     mean per-channel signature variance across the pop — DIVERSITY guard: must NOT collapse
//              toward 0 (that would be the frozen monoculture the invariant forbids).
//   fights/k   resolved fights per 1000 ticks
//   TRADE      mean±sd TRADE gene — trade niche (variance held)
//   predFrac   SIZE>1.3 & AGGR>0.5 — predator niche (must NOT be flattened vs OFF)
//   corrSA     Pearson(SIZE, AGGR) — predator-class coherence (must hold vs OFF)

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { TERRITORY } from "../data/territory";
import { resCellIndex } from "../sim/grid";

interface M {
  pop: number; atHome: number; invFrac: number; sigVar: number;
  tradeMean: number; tradeSd: number; aggrMean: number;
  predFrac: number; corrSA: number;
  fightsPerK: number; tradesPerK: number; delivPerK: number; defWin: number;
}

const ZERO: M = {
  pop: 0, atHome: 0, invFrac: 0, sigVar: 0, tradeMean: 0, tradeSd: 0, aggrMean: 0,
  predFrac: 0, corrSA: 0, fightsPerK: 0, tradesPerK: 0, delivPerK: 0, defWin: 0,
};

// Instantaneous metrics (fightsPerK + defWin come from cumulative-counter deltas in runConfig).
function snap(w: World): Omit<M, "fightsPerK" | "tradesPerK" | "delivPerK" | "defWin"> {
  const a = w.agents; const g = a.genes; const n = a.count;
  const sigT = SIM.sigThreshold;
  const mag = w.claimMag, csA = w.claimSigA, csB = w.claimSigB, csC = w.claimSigC;
  let sT = 0, sTT = 0;
  let sS = 0, sSS = 0, sA = 0, sAA = 0, sSA = 0, pred = 0; // SIZE/AGGR moments
  let saSum = 0, sbSum = 0, scSum = 0, saaSum = 0, sbbSum = 0, sccSum = 0; // signature moments
  let atHome = 0, invaders = 0, onClaim = 0;
  for (let i = 0; i < n; i++) {
    const bi = i * GENE_COUNT;
    const T = g[bi + GENE.TRADE]!, A = g[bi + GENE.AGGRESSION]!, S = g[bi + GENE.SIZE]!;
    sT += T; sTT += T * T;
    sS += S; sSS += S * S; sA += A; sAA += A * A; sSA += S * A;
    if (S > 1.3 && A > 0.5) pred++;
    const sa = g[bi + GENE.SIG_A]!, sb = g[bi + GENE.SIG_B]!, sc = g[bi + GENE.SIG_C]!;
    saSum += sa; sbSum += sb; scSum += sc;
    saaSum += sa * sa; sbbSum += sb * sb; sccSum += sc * sc;
    // Territory occupancy: match this agent's signature to the claim on its cell.
    const c = resCellIndex(a.posX[i]!, a.posY[i]!);
    const m = mag[c]!;
    if (m >= TERRITORY.minMag) {
      onClaim++; // standing on someone's claimed turf (foreground for the invasion rate)
      const inv = 1 / m;
      const dA = csA[c]! * inv - sa, dB = csB[c]! * inv - sb, dC = csC[c]! * inv - sc;
      const match = 1 - Math.sqrt(dA * dA + dB * dB + dC * dC) / sigT;
      if (match > 0.5) atHome++;       // deep in own turf
      else if (match < 0.3) invaders++; // trespasser on foreign claimed turf — should be repelled
    }
  }
  const mT = sT / n, mS = sS / n, mA = sA / n;
  const vT = sTT / n - mT * mT, vS = sSS / n - mS * mS, vA = sAA / n - mA * mA;
  const covSA = sSA / n - mS * mA;
  const corrSA = vS > 1e-9 && vA > 1e-9 ? covSA / Math.sqrt(vS * vA) : 0;
  const vSa = saaSum / n - (saSum / n) ** 2, vSb = sbbSum / n - (sbSum / n) ** 2, vSc = sccSum / n - (scSum / n) ** 2;
  return {
    pop: n, atHome: atHome / n, invFrac: onClaim > 0 ? invaders / onClaim : 0, sigVar: (vSa + vSb + vSc) / 3,
    tradeMean: mT, tradeSd: Math.sqrt(vT < 0 ? 0 : vT), aggrMean: mA,
    predFrac: pred / n, corrSA,
  };
}

const DEF = { defBonus: TERRITORY.defBonus, steerWeight: TERRITORY.steerWeight, foreignRepel: TERRITORY.foreignRepel };
function restore(): void { TERRITORY.defBonus = DEF.defBonus; TERRITORY.steerWeight = DEF.steerWeight; TERRITORY.foreignRepel = DEF.foreignRepel; }

const TAIL = 4000;

// defBonus fixed 0.6, steerWeight fixed 0.3 (the T2 sweep winner); foreignRepel is the T2b sweep lever
// (enemy turf → negative affinity, actively pushing invaders out — sharpen the seam).
function runConfig(name: string, foreignRepel: number, seeds: number[], ticks: number): M & { name: string } {
  const acc: M = { ...ZERO };
  let nseed = 0;
  for (const seed of seeds) {
    restore(); TERRITORY.defBonus = 0.6; TERRITORY.steerWeight = 0.3; TERRITORY.foreignRepel = foreignRepel;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let fight0 = 0, hc0 = 0, hw0 = 0, trade0 = 0, deliv0 = 0;
    const samples: Array<Omit<M, "fightsPerK" | "tradesPerK" | "delivPerK" | "defWin">> = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - TAIL) {
        fight0 = a.fightTotal; hc0 = a.homeContestTotal; hw0 = a.homeWinTotal;
        trade0 = a.tradeTotal; deliv0 = a.caravanDelivered;
      }
      if (t > ticks - TAIL && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m: M = { ...ZERO };
    for (const s of samples) for (const k of Object.keys(s)) (m as unknown as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    m.fightsPerK = (a.fightTotal - fight0) / (TAIL / 1000);
    m.tradesPerK = (a.tradeTotal - trade0) / (TAIL / 1000);
    m.delivPerK = (a.caravanDelivered - deliv0) / (TAIL / 1000);
    const hc = a.homeContestTotal - hc0;
    m.defWin = hc > 0 ? (a.homeWinTotal - hw0) / hc : 0;
    for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! += (m as unknown as Record<string, number>)[k]!;
    nseed++;
  }
  restore();
  const d = nseed || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return { name, ...acc };
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, dd = 2): string => (isNaN(v) ? "NaN" : v.toFixed(dd)).padStart(w);
  return `${m.name.padEnd(9)} pop${p(m.pop, 6, 0)} | invFrac${p(m.invFrac * 100, 6, 1)}% atHome${p(m.atHome * 100, 6, 1)}% ` +
    `sigVar${p(m.sigVar, 7, 4)} defWin${p(m.defWin * 100, 6, 1)}% fgt/k${p(m.fightsPerK, 6, 0)} | ` +
    `trd/k${p(m.tradesPerK, 6, 0)} dlv/k${p(m.delivPerK, 5, 0)} TRADE${p(m.tradeMean, 5)}±${p(m.tradeSd, 4)} predF${p(m.predFrac * 100, 5, 1)}% corrSA${p(m.corrSA, 6)}`;
}

// Fast directional read by default (2 seeds × 8k). For the long-horizon CONFIRM lock, run:
//   npx vite-node src/tools/territorycheck.ts -- 16000 4
const TICKS = Number(process.argv[2]) || 8000;
const NSEEDS = Number(process.argv[3]) || 2;
const SEEDS = [11, 22, 33, 44].slice(0, NSEEDS);

console.log(`# TERRITORY study (T2b foreign-REPEL sweep; defBonus 0.6, steerWeight 0.3) — seeds ${SEEDS.join(",")} ticks ${TICKS}, tail ${TAIL}`);
console.log(`# WANT: invFrac DROPS further / atHome UP as foreignRepel rises (enemy turf pushes invaders out —`);
console.log(`#   a sharper seam), WITHOUT killing trade (trd/k,dlv/k) or collapsing sigVar/predF. repel0 == T2 (attract-only).`);
const CONFIGS: Array<[string, number]> = [
  ["repel0", 0.0],
  ["repel0.5", 0.5],
  ["repel1.0", 1.0],
  ["repel1.5", 1.5],
];
for (const [name, fr] of CONFIGS) console.log(fmt(runConfig(name, fr, SEEDS, TICKS)));
