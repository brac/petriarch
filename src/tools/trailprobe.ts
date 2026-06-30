// P4d calibration probe (temporary, vite-node). The caravan-trail render needs TRAIL.renderMagFull set
// to the field's actual MASS so a travelled LANE saturates (full alpha) while faint one-off paths stay
// dim. This runs the headless CPU sim until carriers are crossing, then reports the trail-field
// magnitude distribution — overall and specifically in the GAP corridor (where the routes form).

import { createWorld } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { WORLD_W, RESOURCE_GRID_W, RES_CELL_W } from "../data/capacity";

const GAP_LO = 0.43 * WORLD_W, GAP_HI = 0.57 * WORLD_W;
const GW = RESOURCE_GRID_W;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i]!;
}

function report(label: string, vals: number[]): void {
  const nz = vals.filter((v) => v > 1e-4).sort((a, b) => a - b);
  const max = vals.reduce((m, v) => (v > m ? v : m), 0);
  const above = (t: number) => vals.filter((v) => v >= t).length;
  console.log(
    `${label.padEnd(10)} cells>0 ${String(nz.length).padStart(5)} | max ${max.toFixed(2).padStart(7)} | ` +
      `p50 ${pct(nz, 0.5).toFixed(2)} p90 ${pct(nz, 0.9).toFixed(2)} p99 ${pct(nz, 0.99).toFixed(2)} | ` +
      `≥1 ${above(1)}  ≥2 ${above(2)}  ≥3 ${above(3)}  ≥5 ${above(5)}`,
  );
}

const SEED = 11, TICKS = 6000;
const w = createWorld(SEED);
initResourceField(w); seedPopulation(w);
for (let t = 1; t <= TICKS; t++) simStep(w);

const trail = w.trail;
const all: number[] = [], gap: number[] = [];
for (let c = 0; c < trail.length; c++) {
  const v = trail[c]!;
  all.push(v);
  const cx = c % GW;
  const x = cx * RES_CELL_W;
  if (x >= GAP_LO && x <= GAP_HI) gap.push(v);
}

// how many carriers right now (context for the deposit rate)
const a = w.agents; let committed = 0;
for (let i = 0; i < a.count; i++) if (a.carryState[i]! !== 0) committed++;

console.log(`# P4d trail-field probe — seed ${SEED} ticks ${TICKS} — pop ${a.count}, committed ${committed}`);
console.log(`# want renderMagFull ≈ the lane magnitude (p90-p99 of the GAP cells) so travelled routes saturate`);
report("ALL", all);
report("GAP", gap);
