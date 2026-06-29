// AMITY study (P3 / 3b — temporary research harness; run with vite-node like headless/
// predation/tradecheck). Question: does the amity field (trade WRITES, conflict READS to
// suppress fights) make the TRADE-vs-AGGRESSION tension REAL — i.e. does conflict RECEDE at
// trading frontiers and does the TRADE gene SELECT UP — without collapsing the world into
// universal peace or flattening the predation niche? (docs/P3_PLAN.md §3b.)
//
// Imports are project-relative so the data objects are the SINGLE shared instance the sim
// reads live (a 2nd instance from a scratchpad copy would make overrides no-op).
//
// The three core configs isolate amity's contribution:
//   trade-OFF   tradeThreshold > gene max → no trade at all (and so no amity)  — the baseline
//   amity-OFF   trade ON, suppress 0      → plain Phase-2 trade, amity inert    — the control
//   amity-ON    trade ON, suppress > 0    → the P3 coupling                     — the treatment
// amity's effect = amity-ON vs amity-OFF: fights/danger should DROP and TRADE should select
// HIGHER under ON. (Phase 2 already showed trade-ON pop ≈ trade-OFF — local trade barely pays;
// 3b asks whether the amity coupling changes that.)
//
// Metrics (live population, tail-averaged over seeds):
//   pop        population (collapse / starvation guard)
//   TRADE      mean±sd TRADE gene — WANT: amity-ON > amity-OFF, variance held (selects, not drifts)
//   AGGR       mean AGGRESSION
//   corrTA     Pearson(TRADE, AGGR) — the merchant/raider linkage
//   trades/k   barter swaps per 1000 ticks
//   fights/k   resolved fights per 1000 ticks — KEY: amity-ON should be LOWER (conflict recedes)
//   suppr/k    amity-averted fights per 1000 ticks (0 by construction when amity-OFF)
//   dangerMn   mean danger field — corroborates conflict recession (violence footprint)
//   amityMx    peak amity at the hottest market — is the field reaching suppression magnitude
//   breedRdy   fraction with BOTH stores above repro threshold (trade's payoff channel)
//   predFrac   SIZE>1.3 & AGGR>0.5 (predator niche — must NOT be flattened vs baseline)
//   corrSA     Pearson(SIZE, AGGR) — predator-class coherence (must hold vs baseline)

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { TRADE } from "../data/trade";
import { AMITY } from "../data/amity";

interface M {
  pop: number; tradeMean: number; tradeSd: number; aggrMean: number; corrTA: number;
  dangerMn: number; dngFront: number; frontCells: number; amityMx: number; breedReady: number;
  predFrac: number; corrSA: number;
  tradesPerK: number; fightsPerK: number; supprPerK: number;
}

function meanField(f: Float32Array): number { let s = 0; for (let k = 0; k < f.length; k++) s += f[k]!; return s / f.length; }
function maxField(f: Float32Array): number { let m = 0; for (let k = 0; k < f.length; k++) if (f[k]! > m) m = f[k]!; return m; }

// Frontier mask cutoff: cells with amity above this are "trade frontiers". The mask exists in
// BOTH amity-ON and amity-OFF (deposit happens regardless of suppress), so comparing danger in
// these cells ON-vs-OFF is the clean CAUSAL test of "does the frontier cool" — unbiased by the
// global fight count, which is dominated by predation spread across the whole map.
const FRONTIER_CUTOFF = 0.5;

// Instantaneous metrics (the per-K rates are added by runConfig from cumulative-counter deltas).
function snap(w: World): Omit<M, "tradesPerK" | "fightsPerK" | "supprPerK"> {
  const a = w.agents; const g = a.genes; const n = a.count;
  let sT = 0, sA = 0, sTT = 0, sAA = 0, sTA = 0;
  let sS = 0, sSS = 0, sSA = 0, pred = 0;
  let breed = 0;
  for (let i = 0; i < n; i++) {
    const bi = i * GENE_COUNT;
    const T = g[bi + GENE.TRADE]!, A = g[bi + GENE.AGGRESSION]!, S = g[bi + GENE.SIZE]!;
    sT += T; sA += A; sTT += T * T; sAA += A * A; sTA += T * A;
    sS += S; sSS += S * S; sSA += S * A;
    if (S > 1.3 && A > 0.5) pred++;
    const maxE = S * SIM.maxEnergyPerSize;
    const thr = g[bi + GENE.REPRO_THRESHOLD]! * maxE;
    if (a.energy[i]! >= thr && a.energyB[i]! >= thr) breed++;
  }
  const mT = sT / n, mA = sA / n, mS = sS / n;
  const vT = sTT / n - mT * mT, vA = sAA / n - mA * mA, vS = sSS / n - mS * mS;
  const covTA = sTA / n - mT * mA, covSA = sSA / n - mS * mA;
  const corrTA = vT > 1e-9 && vA > 1e-9 ? covTA / Math.sqrt(vT * vA) : 0;
  const corrSA = vS > 1e-9 && vA > 1e-9 ? covSA / Math.sqrt(vS * vA) : 0;
  // Frontier-local danger: mean danger over cells the amity field marks as trade frontiers.
  const am = w.amity, dg = w.danger;
  let dF = 0, nF = 0;
  for (let c = 0; c < am.length; c++) if (am[c]! > FRONTIER_CUTOFF) { dF += dg[c]!; nF++; }
  return {
    pop: n, tradeMean: mT, tradeSd: Math.sqrt(vT < 0 ? 0 : vT), aggrMean: mA, corrTA,
    dangerMn: meanField(w.danger), dngFront: nF > 0 ? dF / nF : 0, frontCells: nF,
    amityMx: maxField(w.amity), breedReady: breed / n,
    predFrac: pred / n, corrSA,
  };
}

const ZERO: M = {
  pop: 0, tradeMean: 0, tradeSd: 0, aggrMean: 0, corrTA: 0, dangerMn: 0, dngFront: 0,
  frontCells: 0, amityMx: 0, breedReady: 0, predFrac: 0, corrSA: 0,
  tradesPerK: 0, fightsPerK: 0, supprPerK: 0,
};

const DEF = { suppress: AMITY.suppress, perTradeVolume: AMITY.perTradeVolume, decay: AMITY.decay, tradeThreshold: TRADE.tradeThreshold };
interface Override { suppress?: number; perTradeVolume?: number; decay?: number; tradeThreshold?: number }
function restore(): void { AMITY.suppress = DEF.suppress; AMITY.perTradeVolume = DEF.perTradeVolume; AMITY.decay = DEF.decay; TRADE.tradeThreshold = DEF.tradeThreshold; }
function apply(o: Override): void {
  if (o.suppress !== undefined) AMITY.suppress = o.suppress;
  if (o.perTradeVolume !== undefined) AMITY.perTradeVolume = o.perTradeVolume;
  if (o.decay !== undefined) AMITY.decay = o.decay;
  if (o.tradeThreshold !== undefined) TRADE.tradeThreshold = o.tradeThreshold;
}

const TAIL = 4000; // average the last 4000 ticks; per-K rates over that window

function runConfig(name: string, o: Override, seeds: number[], ticks: number): M & { name: string } {
  const acc: M = { ...ZERO };
  let nseed = 0;
  for (const seed of seeds) {
    restore(); apply(o);
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let trade0 = 0, fight0 = 0, suppr0 = 0;
    const samples: Array<Omit<M, "tradesPerK" | "fightsPerK" | "supprPerK">> = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - TAIL) { trade0 = a.tradeTotal; fight0 = a.fightTotal; suppr0 = a.fightSuppressedTotal; }
      if (t > ticks - TAIL && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m: M = { ...ZERO };
    for (const s of samples) for (const k of Object.keys(s)) (m as unknown as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    m.tradesPerK = (a.tradeTotal - trade0) / (TAIL / 1000);
    m.fightsPerK = (a.fightTotal - fight0) / (TAIL / 1000);
    m.supprPerK = (a.fightSuppressedTotal - suppr0) / (TAIL / 1000);
    for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! += (m as unknown as Record<string, number>)[k]!;
    nseed++;
  }
  restore();
  const d = nseed || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return { name, ...acc };
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, d = 2): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${m.name.padEnd(14)} pop${p(m.pop, 6, 0)} | TRADE${p(m.tradeMean, 5)}±${p(m.tradeSd, 4)} corrTA${p(m.corrTA, 6)} ` +
    `trd/k${p(m.tradesPerK, 6, 0)} fgt/k${p(m.fightsPerK, 6, 0)} sup/k${p(m.supprPerK, 6, 0)} ` +
    `dngMn${p(m.dangerMn, 6, 2)} dngFront${p(m.dngFront, 6, 2)} fCells${p(m.frontCells, 5, 0)} amtMx${p(m.amityMx, 6, 1)} brd${p(m.breedReady * 100, 5)}% | ` +
    `AGGR${p(m.aggrMean, 5)} predF${p(m.predFrac * 100, 5, 1)}% corrSA${p(m.corrSA, 6)}`;
}

const OFF_THRESHOLD = 2; // > TRADE gene max (1) → nobody trades
const SEEDS = [11, 22, 33, 44];
const TICKS = 16000;

console.log(`# AMITY study (P3/3b CONFIRM — long horizon) — seeds ${SEEDS.join(",")} ticks ${TICKS}, tail ${TAIL}`);
console.log(`# Lock the v2 finding at 16k: does the 'strong' config hold dngFront DOWN vs amity-OFF, and does TRADE selection`);
console.log(`#   strengthen over a longer window? WANT strong: dngFront << amity-OFF, TRADE up (holds sd), predF/corrSA ~ baseline.`);
const CONFIGS: Array<[string, Override]> = [
  ["trade-OFF", { tradeThreshold: OFF_THRESHOLD }],        // baseline: no trade at all
  ["amity-OFF", { suppress: 0 }],                          // control: trade on, suppression off
  ["strong", { suppress: 0.3, decay: 0.998, perTradeVolume: 4 }], // the winning P3 config
];
for (const [name, o] of CONFIGS) console.log(fmt(runConfig(name, o, SEEDS, TICKS)));
