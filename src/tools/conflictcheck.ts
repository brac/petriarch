// CONFLICT-RECESSION study (temporary research harness; run with vite-node like territorycheck).
// Question (BUGS "So much conflict"): does global conflict actually LESSEN over a long run as trade /
// amity take over and territory borders harden — or does fights/k stay flat? The player expects
// "after an initial period of conflict, once trade starts to take over the conflict lessens more and
// more." The 3b amity study measured a −16% steady-state recession (fights/k 5176→4357) but never the
// TIME-TREND; territory (T1/T2) is now active and may reduce contest FREQUENCY (fewer mixed-tribe
// cells) on top of amity's frequency suppression. This logs a per-window time series so we can see the
// arc, not just a tail average.
//
// Project-relative imports so we read the SAME live tunables the sim uses (a scratchpad copy would
// desync). Single long seed by default (the trend is per-run, not cross-seed) — pass args to change.
//   npx vite-node src/tools/conflictcheck.ts -- 20000 2000 11
//     ticks(20000)  window(2000)  seed(11)

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { AMITY } from "../data/amity";
import { RESOURCE_GRID_W, RESOURCE_GRID_H } from "../data/capacity";

const N_CELLS = RESOURCE_GRID_W * RESOURCE_GRID_H;

// A cell counts as "pacified" once its amity is high enough to meaningfully raise the fight threshold
// (amity render treats [1,3] as the standing district; 1 is a conservative floor).
const PACIFIED_MIN = 1.0;

function pacifiedCells(w: World): number {
  const am = w.amity;
  let n = 0;
  for (let c = 0; c < N_CELLS; c++) if (am[c]! >= PACIFIED_MIN) n++;
  return n;
}

const TICKS = Number(process.argv[2]) || 20000;
const WINDOW = Number(process.argv[3]) || 2000;
const SEED = Number(process.argv[4]) || 11;

const w = createWorld(SEED);
initResourceField(w);
seedPopulation(w);
const a = w.agents;

function pad(v: number, width: number, dd = 0): string {
  return (isNaN(v) ? "NaN" : v.toFixed(dd)).padStart(width);
}

console.log(`# CONFLICT-RECESSION time-trend — seed ${SEED}, ${TICKS} ticks, ${WINDOW}-tick windows`);
console.log(`# amity decay ${AMITY.decay} suppress ${AMITY.suppress} perTradeVolume ${AMITY.perTradeVolume}`);
console.log(`# WANT: if trade pacifies over time, fgt/k should DECLINE across windows while pacified cells`);
console.log(`#   and trd/k RISE. Flat fgt/k = conflict does not recede (the bug). pop guards collapse.`);
console.log(`#  window       pop    fgt/k  supp/k   pacified   trd/k   dlv/k`);

// Cumulative-counter snapshots at each window boundary → per-window deltas.
let fPrev = 0, sPrev = 0, tPrev = 0, dPrev = 0;
const kWin = WINDOW / 1000;
for (let t = 1; t <= TICKS; t++) {
  simStep(w);
  if (a.count === 0) {
    console.log(`# population COLLAPSED at tick ${t} — aborting`);
    break;
  }
  if (t % WINDOW === 0) {
    const fgtK = (a.fightTotal - fPrev) / kWin;
    const supK = (a.fightSuppressedTotal - sPrev) / kWin;
    const trdK = (a.tradeTotal - tPrev) / kWin;
    const dlvK = (a.caravanDelivered - dPrev) / kWin;
    fPrev = a.fightTotal; sPrev = a.fightSuppressedTotal; tPrev = a.tradeTotal; dPrev = a.caravanDelivered;
    const label = `${t - WINDOW + 1}-${t}`.padStart(12);
    console.log(`${label}  ${pad(a.count, 8)}  ${pad(fgtK, 7)}  ${pad(supK, 6)}  ${pad(pacifiedCells(w), 9)}  ${pad(trdK, 6)}  ${pad(dlvK, 6)}`);
  }
}
