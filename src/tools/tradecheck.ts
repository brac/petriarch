// 2d trade study: does lowering the worldgen cross-crop make the scarce nutrient BITE so
// that trade PAYS (TRADE gene selects up) — without collapsing the population — and does a
// raider/merchant split emerge? Compares trade-ON vs trade-OFF at each cross-crop level
// (OFF = tradeThreshold above the gene max → nobody trades), so the population gap shows
// trade's rescue value. Imports are project-relative (shared singleton data objects).

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { RESOURCES } from "../data/resources";
import { TRADE } from "../data/trade";

interface M {
  pop: number; tradeMean: number; tradeSd: number; aggrMean: number; corrTA: number;
  tradesPerK: number; breedReady: number; meanImbal: number; merchFrac: number; raiderFrac: number;
}

// Instantaneous gene/balance metrics (trade rate is added by runConfig from tradeTotal deltas).
function snap(w: World): Omit<M, "tradesPerK"> {
  const a = w.agents; const g = a.genes; const n = a.count;
  let sT = 0, sA = 0, sTT = 0, sAA = 0, sTA = 0, breed = 0, imbal = 0, merch = 0, raid = 0;
  for (let i = 0; i < n; i++) {
    const bi = i * GENE_COUNT;
    const T = g[bi + GENE.TRADE]!, A = g[bi + GENE.AGGRESSION]!;
    sT += T; sA += A; sTT += T * T; sAA += A * A; sTA += T * A;
    if (T > 0.6 && A < 0.4) merch++;
    if (A > 0.6 && T < 0.4) raid++;
    const size = g[bi + GENE.SIZE]!; const maxE = size * SIM.maxEnergyPerSize;
    const eA = a.energy[i]!, eB = a.energyB[i]!;
    imbal += Math.abs(eA - eB) / maxE;
    const thr = g[bi + GENE.REPRO_THRESHOLD]! * maxE;
    if (eA >= thr && eB >= thr) breed++;
  }
  const mT = sT / n, mA = sA / n;
  const vT = sTT / n - mT * mT, vA = sAA / n - mA * mA, cov = sTA / n - mT * mA;
  const corr = vT > 1e-9 && vA > 1e-9 ? cov / Math.sqrt(vT * vA) : 0;
  return {
    pop: n, tradeMean: mT, tradeSd: Math.sqrt(vT < 0 ? 0 : vT), aggrMean: mA, corrTA: corr,
    breedReady: breed / n, meanImbal: imbal / n, merchFrac: merch / n, raiderFrac: raid / n,
  };
}

const DEF_CROSS = RESOURCES.regionCrossFrac;
const DEF_TRADE_TH = TRADE.tradeThreshold;

function runConfig(name: string, crossFrac: number, tradeOff: boolean, seeds: number[], ticks: number): M & { name: string } {
  const acc = { pop: 0, tradeMean: 0, tradeSd: 0, aggrMean: 0, corrTA: 0, tradesPerK: 0, breedReady: 0, meanImbal: 0, merchFrac: 0, raiderFrac: 0 };
  let nseed = 0;
  for (const seed of seeds) {
    RESOURCES.regionCrossFrac = crossFrac;
    TRADE.tradeThreshold = tradeOff ? 2 : DEF_TRADE_TH; // 2 > gene max(1) → no trade
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let traded0 = 0; const samples: Array<Omit<M, "tradesPerK">> = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - 3000) traded0 = a.tradeTotal;
      if (t >= ticks - 2000 && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m = { pop: 0, tradeMean: 0, tradeSd: 0, aggrMean: 0, corrTA: 0, breedReady: 0, meanImbal: 0, merchFrac: 0, raiderFrac: 0 };
    for (const s of samples) for (const k of Object.keys(m)) (m as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    for (const k of Object.keys(m)) (acc as Record<string, number>)[k]! += (m as Record<string, number>)[k]!;
    acc.tradesPerK += (a.tradeTotal - traded0) / 3; // per 1000 ticks over the 3000-tick tail
    nseed++;
  }
  RESOURCES.regionCrossFrac = DEF_CROSS;
  TRADE.tradeThreshold = DEF_TRADE_TH;
  const d = nseed || 1;
  const out = { name } as M & { name: string };
  for (const k of Object.keys(acc)) (out as unknown as Record<string, number>)[k] = (acc as Record<string, number>)[k]! / d;
  return out;
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, dg = 2): string => (isNaN(v) ? "NaN" : v.toFixed(dg)).padStart(w);
  return `${m.name.padEnd(16)} pop${p(m.pop, 6, 0)} | TRADE${p(m.tradeMean, 5)}±${p(m.tradeSd, 4)} trades/k${p(m.tradesPerK, 6, 0)} breedRdy${p(m.breedReady * 100, 5)}% imbal${p(m.meanImbal, 6, 3)} | AGGR${p(m.aggrMean, 5)} corrTA${p(m.corrTA, 6)} merch${p(m.merchFrac * 100, 5)}% raid${p(m.raiderFrac * 100, 5)}%`;
}

const SEEDS = [11, 22];
const TICKS = 5000;

console.log(`# trade study (2d) — seeds ${SEEDS.join(",")} ticks ${TICKS} tail-avg`);
console.log(`# WANT as cross-crop drops: trades UP, TRADE selects UP (holds variance), pop survives (ON >> OFF), raider/merchant split (corrTA<0)`);
const CONFIGS: Array<[string, number, boolean]> = [
  ["cross.22", 0.22, false],
  ["cross.15", 0.15, false],
  ["cross.10", 0.10, false],
  ["cross.06", 0.06, false],
  ["cross.10-OFF", 0.10, true],
  ["cross.06-OFF", 0.06, true],
];
for (const [name, cf, off] of CONFIGS) console.log(fmt(runConfig(name, cf, off, SEEDS, TICKS)));
