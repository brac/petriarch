// P4c DIAGNOSTIC probe (temporary research harness, vite-node). The commitFrac sweep showed carry% ≈ 0
// (no completed round trips) at every commitFrac. This settles WHY, to pick the next fork:
//   - If OUTBOUND carriers pile up in the GAP and almost none reach the away region (awaySide ≈ 0) with
//     a draining reserve → they DIE CROSSING. The cargo medium isn't the wall, the crossing cost is →
//     Fork 2b (non-consumed cargo) or a cheaper crossing.
//   - If many OUTBOUND carriers REACH the away region (awaySide high) but their awayStore never climbs to
//     loadFrac (awayLoad ≪ 1) → they reach B but can't load → a cheaper loadFrac tweak might save 2a.
//
// One config (commit0.7 — highest commitment, best signal), seeds 11/22/33, tail-averaged.

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { CARAVAN } from "../data/caravan";
import { WORLD_W } from "../data/capacity";

const GAP_LO = 0.43 * WORLD_W, GAP_HI = 0.57 * WORLD_W;

interface P {
  pop: number; outF: number;            // population; OUTBOUND fraction of pop
  // where the OUTBOUND agents are (fractions of the OUTBOUND set):
  oHome: number; oGap: number; oAway: number;
  // among OUTBOUND: how close awayStore is to the loadFrac flip (1.0 = at threshold), and total reserve
  // (frac of maxStore) — split by where they are, to separate "starving in the gap" from "can't load".
  awayLoadGap: number; awayLoadAway: number;  // mean awayStore/(loadFrac*maxStore)
  resGap: number; resAway: number;            // mean (eA+eB)/maxStore
}

const ZERO: P = { pop: 0, outF: 0, oHome: 0, oGap: 0, oAway: 0, awayLoadGap: 0, awayLoadAway: 0, resGap: 0, resAway: 0 };

function snap(w: World): P {
  const a = w.agents; const g = a.genes; const n = a.count;
  const loadFrac = CARAVAN.loadFrac;
  let out = 0, oHome = 0, oGap = 0, oAway = 0;
  let awayLoadGapSum = 0, awayLoadAwaySum = 0, resGapSum = 0, resAwaySum = 0;
  let nGap = 0, nAway = 0;
  for (let i = 0; i < n; i++) {
    if (a.carryState[i]! !== 2) continue; // OUTBOUND only
    out++;
    const home = a.homeGood[i]!;
    const x = a.posX[i]!;
    const inGap = x >= GAP_LO && x <= GAP_HI;
    // away region: home A (0) → right side (x > GAP_HI); home B (1) → left side (x < GAP_LO).
    const inAway = home === 0 ? x > GAP_HI : x < GAP_LO;
    const maxStore = g[i * GENE_COUNT + GENE.SIZE]! * SIM.maxEnergyPerSize;
    const eA = a.energy[i]!, eB = a.energyB[i]!;
    const awayStore = home === 0 ? eB : eA;
    const awayLoad = awayStore / (loadFrac * maxStore); // 1.0 = ready to flip to RETURN
    const res = (eA + eB) / maxStore;
    if (inGap) { oGap++; nGap++; awayLoadGapSum += awayLoad; resGapSum += res; }
    else if (inAway) { oAway++; nAway++; awayLoadAwaySum += awayLoad; resAwaySum += res; }
    else oHome++;
  }
  const o = out || 1;
  return {
    pop: n, outF: out / n,
    oHome: oHome / o, oGap: oGap / o, oAway: oAway / o,
    awayLoadGap: nGap ? awayLoadGapSum / nGap : 0,
    awayLoadAway: nAway ? awayLoadAwaySum / nAway : 0,
    resGap: nGap ? resGapSum / nGap : 0,
    resAway: nAway ? resAwaySum / nAway : 0,
  };
}

function run(commitFrac: number, seeds: number[], ticks: number, tail: number): P {
  const acc: P = { ...ZERO };
  let nseed = 0;
  const saveCommit = CARAVAN.commitFrac;
  for (const seed of seeds) {
    CARAVAN.commitFrac = commitFrac;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const samples: P[] = [];
    let alive = true;
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (w.agents.count === 0) { alive = false; break; }
      if (t > ticks - tail && t % 1000 === 0) samples.push(snap(w));
    }
    if (!alive || samples.length === 0) continue;
    const m: P = { ...ZERO };
    for (const s of samples) for (const k of Object.keys(s)) (m as unknown as Record<string, number>)[k]! += (s as unknown as Record<string, number>)[k]! / samples.length;
    for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! += (m as unknown as Record<string, number>)[k]!;
    nseed++;
  }
  CARAVAN.commitFrac = saveCommit;
  const d = nseed || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return acc;
}

const SEEDS = [11, 22, 33], TICKS = 8000, TAIL = 3000;
const m = run(0.7, SEEDS, TICKS, TAIL);
const pc = (v: number) => (v * 100).toFixed(1).padStart(5);
const f = (v: number) => v.toFixed(2).padStart(5);
console.log(`# P4c probe — commit0.7 — seeds ${SEEDS.join(",")} ticks ${TICKS} tail ${TAIL}`);
console.log(`# OUTBOUND carriers: where are they, are they loading, are they starving?`);
console.log(`pop ${m.pop.toFixed(0)}   out ${pc(m.outF)}% of pop`);
console.log(`OUTBOUND location:  home ${pc(m.oHome)}%   gap ${pc(m.oGap)}%   away-region ${pc(m.oAway)}%`);
console.log(`awayStore/loadThr:  in-gap ${f(m.awayLoadGap)}   in-away ${f(m.awayLoadAway)}    (1.00 = ready to flip to RETURN)`);
console.log(`total reserve/max:  in-gap ${f(m.resGap)}   in-away ${f(m.resAway)}    (starvation check)`);
