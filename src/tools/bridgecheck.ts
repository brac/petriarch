// Bridge MVP validation (temporary, vite-node). Does the road — hot trail HARDENING into a fast
// passability lane — make the deadly gap crossing survivable, so completed round trips climb? Compares
// bridge OFF (setThreshold huge → nothing ever hardens) vs ON, on fresh same-seed worlds.
//
// Metrics (tail-averaged over seeds): pop; load/k = OUTBOUND→RETURN flips per 1k (carriers that crossed
// + loaded); deliv/k = RETURN→home flips per 1k (COMPLETED round trips — the survival signal); mort =
// load/k − deliv/k (loaded-but-died-returning); trd/k = barter/1k; roadCells = hardened cells at the end
// (how much road formed). WANT (ON vs OFF): deliv/k UP, pop UP, roadCells > 0, no collapse.

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { BRIDGE } from "../data/bridge";

const SEEDS = [11, 22], TICKS = 8000, TAIL = 3000;
const DEF_THRESH = BRIDGE.setThreshold;

interface M { pop: number; loadK: number; delivK: number; trdK: number; road: number }
const ZERO: M = { pop: 0, loadK: 0, delivK: 0, trdK: 0, road: 0 };

function roadCells(w: World): number {
  const p = w.passability; let n = 0;
  for (let c = 0; c < p.length; c++) if (p[c]! > 0 && p[c]! < 1) n++;
  return n;
}

function run(name: string, threshold: number): M & { name: string } {
  const acc: M = { ...ZERO };
  let ns = 0;
  for (const seed of SEEDS) {
    BRIDGE.setThreshold = threshold;
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const a = w.agents;
    let load0 = 0, deliv0 = 0, trade0 = 0; const pops: number[] = [];
    let alive = true;
    for (let t = 1; t <= TICKS; t++) {
      simStep(w);
      if (a.count === 0) { alive = false; break; }
      if (t === TICKS - TAIL) { load0 = a.caravanLoaded; deliv0 = a.caravanDelivered; trade0 = a.tradeTotal; }
      if (t > TICKS - TAIL && t % 1000 === 0) pops.push(a.count);
    }
    if (!alive || pops.length === 0) continue;
    acc.pop += pops.reduce((s, v) => s + v, 0) / pops.length;
    acc.loadK += (a.caravanLoaded - load0) / (TAIL / 1000);
    acc.delivK += (a.caravanDelivered - deliv0) / (TAIL / 1000);
    acc.trdK += (a.tradeTotal - trade0) / (TAIL / 1000);
    acc.road += roadCells(w);
    ns++;
  }
  BRIDGE.setThreshold = DEF_THRESH;
  const d = ns || 1;
  for (const k of Object.keys(acc)) (acc as unknown as Record<string, number>)[k]! /= d;
  return { name, ...acc };
}

function fmt(m: M & { name: string }): string {
  const p = (v: number, w: number, dp = 0) => v.toFixed(dp).padStart(w);
  const mort = m.loadK - m.delivK;
  return `${m.name.padEnd(10)} pop${p(m.pop, 6)} | load/k${p(m.loadK, 5)} deliv/k${p(m.delivK, 5)} mort${p(mort, 5)} | trd/k${p(m.trdK, 6)} | roadCells${p(m.road, 6)}`;
}

console.log(`# Bridge MVP study — seeds ${SEEDS.join(",")} ticks ${TICKS} tail ${TAIL} — roadCost ${BRIDGE.roadCost}`);
console.log(`# WANT ON vs OFF: deliv/k UP, mort DOWN, pop UP, roadCells > 0.`);
console.log(fmt(run("bridge-OFF", 1e9)));   // threshold unreachable → no roads ever
console.log(fmt(run("bridge-ON", DEF_THRESH)));
