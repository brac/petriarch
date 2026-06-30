// CROSSING study (P4a — temporary research harness; run with vite-node like the others). Question:
// does the long-range DEMAND field (steer climbs demandX weighted by surplus of X) make agents
// actually CROSS the barren inter-region gap — producing traffic in the dead zone and trade/breeding
// across distance — without collapsing the population into a stampede or a merged monoculture?
// (docs/P4_PLAN.md §P4a.) Compares demand-OFF (mask bit cleared) vs demand-ON at a few weights.
//
// Imports are project-relative so the data objects are the SINGLE shared instance the sim reads live.
//
// Metrics (live population, tail-averaged over seeds):
//   pop       population (collapse / stampede guard)
//   gap%      fraction of agents standing in the barren gap band — the DIRECT crossing signal
//             (≈0 without demand: nothing draws life into the foodless middle)
//   left/rt%  fraction in the A-region (left) / B-region (right) — should stay BALANCED (a crossing
//             economy), not collapse to one side (a stampede/migration that merges the societies)
//   trd/k     barter swaps per 1000 ticks — does the crossing produce trade
//   imbal     mean |energyA−energyB|/maxE — demand should LOWER it (complements meet → rebalance)
//   breed%    fraction with BOTH stores above repro threshold (the payoff channel)

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { SCENT } from "../data/scent";
import { COG, COG_ALL, COGNITION } from "../data/cognition";
import { WORLD_W } from "../data/capacity";

// Gap band (fractions of WORLD_W): regions sit at ~0.24 / ~0.76 with spread ~0.19, so the barren
// middle is ~[0.43, 0.57]. Left region < 0.43, right region > 0.57.
const GAP_LO = 0.43 * WORLD_W;
const GAP_HI = 0.57 * WORLD_W;

interface M { pop: number; gapF: number; leftF: number; rightF: number; trdK: number; imbal: number; breedF: number }

function snap(w: World): Omit<M, "trdK"> {
  const a = w.agents; const g = a.genes; const n = a.count;
  let gap = 0, left = 0, right = 0, breed = 0, imb = 0;
  for (let i = 0; i < n; i++) {
    const x = a.posX[i]!;
    if (x < GAP_LO) left++;
    else if (x > GAP_HI) right++;
    else gap++;
    const bi = i * GENE_COUNT;
    const maxE = g[bi + GENE.SIZE]! * SIM.maxEnergyPerSize;
    const eA = a.energy[i]!, eB = a.energyB[i]!;
    imb += Math.abs(eA - eB) / maxE;
    const thr = g[bi + GENE.REPRO_THRESHOLD]! * maxE;
    if (eA >= thr && eB >= thr) breed++;
  }
  return { pop: n, gapF: gap / n, leftF: left / n, rightF: right / n, imbal: imb / n, breedF: breed / n };
}

const ZERO: M = { pop: 0, gapF: 0, leftF: 0, rightF: 0, trdK: 0, imbal: 0, breedF: 0 };
const DEF_MASK = COGNITION.mask;
const DEF_WEIGHT = SCENT.weight;
const TAIL = 3000;

function runConfig(name: string, demandOn: boolean, weight: number, seeds: number[], ticks: number): M & { name: string } {
  const acc: M = { ...ZERO };
  let nseed = 0;
  for (const seed of seeds) {
    COGNITION.mask = demandOn ? COG_ALL : (COG_ALL & ~COG.DEMAND);
    SCENT.weight = weight;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let trade0 = 0; const samples: Array<Omit<M, "trdK">> = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - TAIL) trade0 = a.tradeTotal;
      if (t > ticks - TAIL && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m: M = { ...ZERO };
    for (const s of samples) for (const k of Object.keys(s)) (m as unknown as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    m.trdK = (a.tradeTotal - trade0) / (TAIL / 1000);
    for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! += (m as unknown as Record<string, number>)[k]!;
    nseed++;
  }
  COGNITION.mask = DEF_MASK; SCENT.weight = DEF_WEIGHT;
  const d = nseed || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return { name, ...acc };
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, d = 1): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${m.name.padEnd(12)} pop${p(m.pop, 6, 0)} | gap${p(m.gapF * 100, 5)}% left${p(m.leftF * 100, 5)}% right${p(m.rightF * 100, 5)}% | ` +
    `trd/k${p(m.trdK, 6, 0)} imbal${p(m.imbal, 6, 3)} breed${p(m.breedF * 100, 5)}%`;
}

const SEEDS = [11, 22, 33];
const TICKS = 8000;

console.log(`# CROSSING study (P4a) — seeds ${SEEDS.join(",")} ticks ${TICKS}, tail ${TAIL}`);
console.log(`# WANT demand-ON: gap% UP from ~0 (agents cross the dead zone), left/right stay BALANCED (not a one-side`);
console.log(`#   stampede), trd/k UP + imbal DOWN (complements meet across the gap), pop healthy. FALSIFY: pop collapse,`);
console.log(`#   or one region empties (migration not trade), or gap% stays ~0 (signal can't reach).`);
const CONFIGS: Array<[string, boolean, number]> = [
  ["demand-OFF", false, 0],
  ["weight0.3", true, 0.3],
  ["weight0.6", true, 0.6],
  ["weight1.0", true, 1.0],
];
for (const [name, on, wt] of CONFIGS) console.log(fmt(runConfig(name, on, wt, SEEDS, TICKS)));
