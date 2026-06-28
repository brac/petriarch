// REPRODUCTION food-gate study (temporary research harness; vite-node like headless).
// Question: does gating reproduction on LOCAL food (SIM.reproMinLocalFood, reproduce.ts)
// cut the wasteful "breed into a desert → offspring starve at birth" churn WITHOUT
// suppressing the population or freezing evolution?
//
// Imports use project-relative specifiers so SIM is the single shared instance.
//
// Metrics (tail-averaged over seeds; rates over the last 3000 ticks):
//   pop        = equilibrium population
//   birth/1k   = births per 1000 ticks   } if the gate kills wasteful births, BOTH fall
//   death/1k   = deaths per 1000 ticks   } together while pop holds → less churn, same cap
//   meanAge    = mean living age (s)      — rises if fewer offspring die young
//   meanE%     = mean living energy / maxE — rises if the population is healthier
//   starve%    = fraction of living that are young (<2s) AND nearly starved (<15% maxE):
//                the reproduce-into-desert victims caught alive mid-death. WANT this DOWN.

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";

interface Inst { pop: number; meanAge: number; meanEFrac: number; starveFrac: number }

function inst(w: World): Inst {
  const a = w.agents; const g = a.genes; const n = a.count;
  if (n === 0) return { pop: 0, meanAge: NaN, meanEFrac: NaN, starveFrac: NaN };
  let sAge = 0, sE = 0, starve = 0;
  for (let i = 0; i < n; i++) {
    const size = g[i * GENE_COUNT + GENE.SIZE]!;
    const maxE = size * SIM.maxEnergyPerSize;
    const ef = a.energy[i]! / maxE;
    const age = a.age[i]!;
    sAge += age; sE += ef;
    if (age < 2.0 && ef < 0.15) starve++;
  }
  return { pop: n, meanAge: sAge / n, meanEFrac: sE / n, starveFrac: starve / n };
}

interface Row { name: string; pop: number; birthRate: number; deathRate: number; meanAge: number; meanEFrac: number; starveFrac: number }

const DEF_MINFOOD = SIM.reproMinLocalFood;

function runConfig(name: string, minFood: number, seeds: number[], ticks: number): Row {
  const acc = { pop: 0, birthRate: 0, deathRate: 0, meanAge: 0, meanEFrac: 0, starveFrac: 0 };
  let nseed = 0;
  for (const seed of seeds) {
    SIM.reproMinLocalFood = minFood;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let born0 = 0, died0 = 0;
    const samples: Inst[] = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - 3000) { born0 = a.bornTotal; died0 = a.diedTotal; }
      if (t >= ticks - 2000 && t % 1000 === 0) samples.push(inst(w));
    }
    if (!alive || samples.length === 0) continue;
    const m = { pop: 0, meanAge: 0, meanEFrac: 0, starveFrac: 0 };
    for (const s of samples) { m.pop += s.pop / samples.length; m.meanAge += s.meanAge / samples.length; m.meanEFrac += s.meanEFrac / samples.length; m.starveFrac += s.starveFrac / samples.length; }
    acc.pop += m.pop; acc.meanAge += m.meanAge; acc.meanEFrac += m.meanEFrac; acc.starveFrac += m.starveFrac;
    acc.birthRate += (a.bornTotal - born0) / 3; // per 1000 ticks over the 3000-tick tail
    acc.deathRate += (a.diedTotal - died0) / 3;
    nseed++;
  }
  SIM.reproMinLocalFood = DEF_MINFOOD;
  const d = nseed || 1;
  return { name, pop: acc.pop / d, birthRate: acc.birthRate / d, deathRate: acc.deathRate / d, meanAge: acc.meanAge / d, meanEFrac: acc.meanEFrac / d, starveFrac: acc.starveFrac / d };
}

function fmt(r: Row): string {
  const p = (v: number, w: number, d = 1): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${r.name.padEnd(14)} pop${p(r.pop, 6, 0)} | birth/1k${p(r.birthRate, 7, 0)} death/1k${p(r.deathRate, 7, 0)} | meanAge${p(r.meanAge, 6)}s meanE${p(r.meanEFrac * 100, 5)}% starve${p(r.starveFrac * 100, 5)}%`;
}

const SEEDS = [11, 22, 33];
const TICKS = 8000;
const SWEEP = [0, 2, 4, 8, 16, 32]; // SIM.reproMinLocalFood per offspring (0 = gate off)

console.log(`# REPRODUCTION food-gate study — seeds ${SEEDS.join(",")} ticks ${TICKS} (tail-averaged)`);
console.log(`# WANT: birth/death churn DOWN + starve% DOWN, pop & meanAge healthy (not suppressed)`);
for (const mf of SWEEP) console.log(fmt(runConfig(`minFood-${mf}`, mf, SEEDS, TICKS)));
