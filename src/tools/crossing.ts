// CARAVAN study (P4c — round trip; temporary research harness, run with vite-node). Question: does the
// carry/return state machine (+ breed-only-at-home) turn crossers into CARRIERS that round-trip and
// deliver the far good home — so trade FLOURISHES — WITHOUT the two societies blurring into one
// (migration) or carriers oscillating to death? (docs/P4C_PLAN.md §P4c.)
//
// Compares P4b-base (no return: loadFrac > 1 so nobody flips to return; breed anywhere) vs carry
// (return on, breed anywhere) vs carry+home (return on + breed-only-at-home = full P4c).
//
// Metrics (live population, tail-averaged over seeds):
//   pop       population (collapse / oscillate-to-death guard)
//   gap%      fraction standing in the barren gap — shuttle traffic
//   carry%    fraction in RETURN state — are carriers forming
//   home%     fraction standing in their HOME region (home-good scent dominates their cell) — society
//             distinctness: HIGH = lineages stay on their own side (trade), LOW = blurred (migration)
//   trd/k     barter swaps per 1000 ticks (delivery shows up as more trade at home)
//   imbal     mean |eA−eB|/maxE — lower = stores better balanced (goods reaching both sides)
//   breed%    fraction with BOTH stores above repro threshold

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { CARAVAN } from "../data/caravan";
import { WORLD_W } from "../data/capacity";
import { resCellIndex } from "../sim/grid";

const GAP_LO = 0.43 * WORLD_W, GAP_HI = 0.57 * WORLD_W; // barren middle (regions ~0.24/0.76, spread ~0.19)

interface M { pop: number; gapF: number; outF: number; carryF: number; homeF: number; trdK: number; loadK: number; delivK: number; imbal: number; breedF: number }

function snap(w: World): Omit<M, "trdK" | "loadK" | "delivK"> {
  const a = w.agents; const g = a.genes; const n = a.count;
  const sa = w.scentA, sb = w.scentB;
  let gap = 0, out = 0, carry = 0, home = 0, breed = 0, imb = 0;
  for (let i = 0; i < n; i++) {
    const x = a.posX[i]!;
    if (x >= GAP_LO && x <= GAP_HI) gap++;
    if (a.carryState[i]! === 2) out++;       // OUTBOUND (committed, going for the away good)
    if (a.carryState[i]! === 1) carry++;     // RETURN (loaded, heading home)
    // home? the agent's home-good scent dominates its cell.
    const c = resCellIndex(x, a.posY[i]!);
    const hs = a.homeGood[i]! === 0 ? sa[c]! : sb[c]!;
    const as = a.homeGood[i]! === 0 ? sb[c]! : sa[c]!;
    if (hs >= as) home++;
    const bi = i * GENE_COUNT;
    const maxE = g[bi + GENE.SIZE]! * SIM.maxEnergyPerSize;
    const eA = a.energy[i]!, eB = a.energyB[i]!;
    imb += Math.abs(eA - eB) / maxE;
    const thr = g[bi + GENE.REPRO_THRESHOLD]! * maxE;
    if (eA >= thr && eB >= thr) breed++;
  }
  return { pop: n, gapF: gap / n, outF: out / n, carryF: carry / n, homeF: home / n, imbal: imb / n, breedF: breed / n };
}

const ZERO: M = { pop: 0, gapF: 0, outF: 0, carryF: 0, homeF: 0, trdK: 0, loadK: 0, delivK: 0, imbal: 0, breedF: 0 };
const DEF_COMMIT = CARAVAN.commitFrac;
const DEF_LOAD = CARAVAN.loadFrac;
const DEF_TRAVEL = CARAVAN.travelScent;
const DEF_HOME = CARAVAN.breedHomeOnly;
const TAIL = 3000;

function runConfig(name: string, commitFrac: number, loadFrac: number, travelScent: number, breedHome: boolean, seeds: number[], ticks: number): M & { name: string } {
  const acc: M = { ...ZERO };
  let nseed = 0;
  for (const seed of seeds) {
    CARAVAN.commitFrac = commitFrac;
    CARAVAN.loadFrac = loadFrac;
    CARAVAN.travelScent = travelScent;
    CARAVAN.breedHomeOnly = breedHome;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let trade0 = 0, load0 = 0, deliv0 = 0; const samples: Array<Omit<M, "trdK" | "loadK" | "delivK">> = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === ticks - TAIL) { trade0 = a.tradeTotal; load0 = a.caravanLoaded; deliv0 = a.caravanDelivered; }
      if (t > ticks - TAIL && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m: M = { ...ZERO };
    for (const s of samples) for (const k of Object.keys(s)) (m as unknown as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    m.trdK = (a.tradeTotal - trade0) / (TAIL / 1000);
    m.loadK = (a.caravanLoaded - load0) / (TAIL / 1000);
    m.delivK = (a.caravanDelivered - deliv0) / (TAIL / 1000);
    for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! += (m as unknown as Record<string, number>)[k]!;
    nseed++;
  }
  CARAVAN.commitFrac = DEF_COMMIT; CARAVAN.loadFrac = DEF_LOAD; CARAVAN.travelScent = DEF_TRAVEL; CARAVAN.breedHomeOnly = DEF_HOME;
  const d = nseed || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return { name, ...acc };
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, d = 1): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${m.name.padEnd(12)} pop${p(m.pop, 6, 0)} | gap${p(m.gapF * 100, 4)}% out${p(m.outF * 100, 5)}% load/k${p(m.loadK, 5, 0)} deliv/k${p(m.delivK, 5, 0)} home${p(m.homeF * 100, 5)}% | ` +
    `trd/k${p(m.trdK, 6, 0)} imbal${p(m.imbal, 6, 3)} breed${p(m.breedF * 100, 5)}%`;
}

const SEEDS = [11, 22];
const TICKS = 6000;

console.log(`# CARAVAN study (P4c) — loadFrac × travelScent tuning @ commit0.7 — seeds ${SEEDS.join(",")} ticks ${TICKS}, tail ${TAIL}`);
console.log(`# deliv/k = COMPLETED cross-gap round trips per 1k (geo-gated, real). load/k−deliv/k = return mortality.`);
console.log(`#   WANT: deliv/k UP, return-mortality DOWN, pop toward control baseline, breed recovered, no blur.`);
const CONFIGS: Array<[string, number, number, number, boolean]> = [
  // name, commitFrac, loadFrac, travelScent, breedHomeOnly
  ["OFF(ctrl)", 9.0, 0.85, 1.5, true],   // never commit (control = P4b baseline)
  ["L.70 T1.5", 0.7, 0.70, 1.5, true],   // current best from the last sweep
  ["L.55 T1.5", 0.7, 0.55, 1.5, true],
  ["L.40 T1.5", 0.7, 0.40, 1.5, true],
  ["L.55 T2.0", 0.7, 0.55, 2.0, true],
  ["L.40 T2.0", 0.7, 0.40, 2.0, true],
];
for (const [name, cf, lf, ts, bh] of CONFIGS) console.log(fmt(runConfig(name, cf, lf, ts, bh, SEEDS, TICKS)));
