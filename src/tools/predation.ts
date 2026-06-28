// PREDATION study (temporary research harness; run with vite-node like headless/spike).
// Question: can SIZE+AGGRESSION form a viable, self-sustaining PREDATOR niche that
// COEXISTS with small foragers, instead of small-fast foragers always winning — WITHOUT
// concentrating food so hard the population starves? (docs/BUGS.md "Predation payoff".)
//
// Imports use project-relative specifiers so the data objects are the SINGLE shared
// instance the sim reads live (a scratchpad copy gets a 2nd instance → overrides no-op).
//
// Metrics (live population, tail-averaged over seeds):
//   pop        = population (must stay healthy; collapse = the predators starved the world)
//   sizeMean   = mean SIZE gene (range 0.3..3.0)  — baseline confirms "small dominates"
//   predFrac   = fraction with SIZE>1.3 AND AGGRESSION>0.5 (big+aggressive = predator)
//   forFrac    = fraction with SIZE<1.0 (small forager)
//   corrSA     = Pearson corr(SIZE, AGGRESSION) — >0 means the big ones are the aggressive
//                ones (a coherent predator strategy, not noise)
//   aggrMean   = mean AGGRESSION
// WANT: predFrac meaningfully > 0 AND forFrac meaningfully > 0 (coexistence), pop healthy,
//   corrSA positive. AVOID: pop collapse, or predators wiping foragers (forFrac→0).

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { CONFLICT } from "../data/conflict";
import { COSTS } from "../data/costs";

interface Metrics { pop: number; sizeMean: number; sizeSD: number; predFrac: number; forFrac: number; corrSA: number; aggrMean: number }

function metrics(w: World): Metrics {
  const a = w.agents; const g = a.genes; const n = a.count;
  if (n === 0) return { pop: 0, sizeMean: NaN, sizeSD: NaN, predFrac: NaN, forFrac: NaN, corrSA: NaN, aggrMean: NaN };
  let sS = 0, sA = 0, sSS = 0, sAA = 0, sSA = 0, pred = 0, forg = 0;
  for (let i = 0; i < n; i++) {
    const s = g[i * GENE_COUNT + GENE.SIZE]!;
    const ag = g[i * GENE_COUNT + GENE.AGGRESSION]!;
    sS += s; sA += ag; sSS += s * s; sAA += ag * ag; sSA += s * ag;
    if (s > 1.3 && ag > 0.5) pred++;
    if (s < 1.0) forg++;
  }
  const mS = sS / n, mA = sA / n;
  const varS = sSS / n - mS * mS, varA = sAA / n - mA * mA;
  const cov = sSA / n - mS * mA;
  const corr = varS > 1e-9 && varA > 1e-9 ? cov / Math.sqrt(varS * varA) : 0;
  return { pop: n, sizeMean: mS, sizeSD: Math.sqrt(varS < 0 ? 0 : varS), predFrac: pred / n, forFrac: forg / n, corrSA: corr, aggrMean: mA };
}

const DEF = {
  sizeSpeedFactor: SIM.sizeSpeedFactor,
  stealFrac: CONFLICT.stealFrac, loserDamage: CONFLICT.loserDamage, aggressionThreshold: CONFLICT.aggressionThreshold,
  contestResourceMin: CONFLICT.contestResourceMin, cooldownTicks: CONFLICT.cooldownTicks, range: CONFLICT.range,
  intakeSizeExp: COSTS.intakeSizeExp, sizeDrain: COSTS.sizeDrain,
};
type Override = Partial<typeof DEF>;
function restore(): void {
  SIM.sizeSpeedFactor = DEF.sizeSpeedFactor;
  CONFLICT.stealFrac = DEF.stealFrac; CONFLICT.loserDamage = DEF.loserDamage; CONFLICT.aggressionThreshold = DEF.aggressionThreshold;
  CONFLICT.contestResourceMin = DEF.contestResourceMin; CONFLICT.cooldownTicks = DEF.cooldownTicks; CONFLICT.range = DEF.range;
  COSTS.intakeSizeExp = DEF.intakeSizeExp; COSTS.sizeDrain = DEF.sizeDrain;
}
function apply(o: Override): void {
  const so = SIM as unknown as Record<string, number>;
  const co = CONFLICT as unknown as Record<string, number>;
  const ko = COSTS as unknown as Record<string, number>;
  for (const key of Object.keys(o)) {
    const v = (o as Record<string, number>)[key]!;
    if (key === "sizeSpeedFactor") so[key] = v;
    else if (key === "intakeSizeExp" || key === "sizeDrain") ko[key] = v;
    else co[key] = v; // the rest are CONFLICT.*
  }
}

function runConfig(name: string, o: Override, seeds: number[], ticks: number): Metrics & { name: string } {
  const acc: Metrics = { pop: 0, sizeMean: 0, sizeSD: 0, predFrac: 0, forFrac: 0, corrSA: 0, aggrMean: 0 };
  let nseed = 0;
  for (const seed of seeds) {
    restore(); apply(o);
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const samples: Metrics[] = [];
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (w.agents.count === 0) break;
      if (t >= ticks - 2000 && t % 1000 === 0) samples.push(metrics(w));
    }
    if (samples.length === 0 && w.agents.count > 0) samples.push(metrics(w));
    if (samples.length === 0) continue; // collapsed
    const m: Metrics = { pop: 0, sizeMean: 0, sizeSD: 0, predFrac: 0, forFrac: 0, corrSA: 0, aggrMean: 0 };
    for (const s of samples) for (const key of Object.keys(m)) (m as unknown as Record<string, number>)[key]! += (s as unknown as Record<string, number>)[key]! / samples.length;
    for (const key of Object.keys(acc)) (acc as unknown as Record<string, number>)[key]! += (m as unknown as Record<string, number>)[key]!;
    nseed++;
  }
  for (const key of Object.keys(acc)) (acc as unknown as Record<string, number>)[key]! /= (nseed || 1);
  return { name, ...acc };
}

function fmt(m: Metrics & { name: string }): string {
  const p = (v: number, w: number, d = 2): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${m.name.padEnd(20)} pop${p(m.pop, 6, 0)} | SIZE${p(m.sizeMean, 5)}±${p(m.sizeSD, 4)} predFrac${p(m.predFrac * 100, 6, 1)}% forFrac${p(m.forFrac * 100, 6, 1)}% corrSA${p(m.corrSA, 6)} aggr${p(m.aggrMean, 5)}`;
}

const SEEDS = [11, 22, 33, 44];
const TICKS = 18000;

// Phase 3: LONG-horizon stability. contest-0.5 looked great at 10k but at 18k (seed 24301)
// drifts toward a big-aggressive monoculture (AGGR SD collapses, foragers squeezed out). So
// re-test the knee at 18k, tail-averaged over the LATE window (16-18k), looking for a value
// where forFrac stays robust and sizeSD stays WIDE (a real mix), not a slow tip.
const CONFIGS: [string, Override][] = [
  ["baseline", {}],
  ["contest-1.5", { contestResourceMin: 1.5 }],
  ["contest-1.25", { contestResourceMin: 1.25 }],
  ["contest-1.0", { contestResourceMin: 1.0 }],
  ["contest-0.75", { contestResourceMin: 0.75 }],
  ["contest-0.5", { contestResourceMin: 0.5 }],
];

console.log(`# PREDATION study phase 3 (LONG-horizon stability) — seeds ${SEEDS.join(",")} ticks ${TICKS}, tail 16-18k`);
console.log(`# WANT: predFrac>0 AND forFrac>0 (coexistence), pop healthy, corrSA>0`);
for (const [name, o] of CONFIGS) console.log(fmt(runConfig(name, o, SEEDS, TICKS)));
