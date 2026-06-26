// Headless fast-forward + per-generation stats (no render). This is how tuning
// becomes experiment rather than guesswork (docs/tooling.md): run the SAME
// canonical tick the headful sim runs (src/sim/step.ts), with no Pixi, and log
// population / lineage / births / deaths / gene mean±sd at a fixed interval.
// Deterministic from the seed.
//
// Run:  npm run headless -- --ticks 8000 --interval 1000 --seed 24301
//       npm run headless -- --intensity 0.55 --csv > run.csv

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { applyIntensity } from "../core/intensity";
import { GENE, GENE_COUNT } from "../data/genome";

export interface HeadlessOptions {
  seed: number;
  ticks: number;
  interval: number;
  /** null = leave intensity at full default; else applyIntensity(0..1). */
  intensity: number | null;
  csv: boolean;
}

// Genes reported each sample (mean, with sd for the strategy-defining ones).
const REPORT: ReadonlyArray<{ key: string; gene: number; sd: boolean }> = [
  { key: "SIZE", gene: GENE.SIZE, sd: true },
  { key: "MR", gene: GENE.METABOLIC_RATE, sd: false },
  { key: "REPRO", gene: GENE.REPRO_THRESHOLD, sd: false },
  { key: "LIFE", gene: GENE.LIFESPAN, sd: false },
  { key: "FERT", gene: GENE.FERTILITY, sd: false },
  { key: "MUT", gene: GENE.MUTABILITY, sd: false },
  { key: "AGGR", gene: GENE.AGGRESSION, sd: true },
];

function meanSd(w: World, gene: number): [number, number] {
  const a = w.agents;
  if (a.count === 0) return [NaN, NaN];
  let s = 0;
  for (let i = 0; i < a.count; i++) s += a.genes[i * GENE_COUNT + gene]!;
  const m = s / a.count;
  let v = 0;
  for (let i = 0; i < a.count; i++) {
    const d = a.genes[i * GENE_COUNT + gene]! - m;
    v += d * d;
  }
  return [m, Math.sqrt(v / a.count)];
}

// Distinct living lineages (reused Set, cleared each sample — not a hot path).
const lineageSet = new Set<number>();
function lineageCount(w: World): number {
  const a = w.agents;
  lineageSet.clear();
  for (let i = 0; i < a.count; i++) lineageSet.add(a.lineageId[i]!);
  return lineageSet.size;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function runHeadless(opts: HeadlessOptions): void {
  const w = createWorld(opts.seed);
  initResourceField(w);
  seedPopulation(w);
  if (opts.intensity !== null) applyIntensity(w.intensity, opts.intensity);

  const a = w.agents;
  let prevBorn = a.bornTotal; // baseline so founders aren't counted as births
  let prevDied = a.diedTotal;

  // Header.
  const cols = ["tick", "pop", "lin", "+born", "-died", ...REPORT.map((r) => r.key)];
  if (opts.csv) {
    console.log(cols.join(","));
  } else {
    const head =
      pad("tick", 7) + pad("pop", 7) + pad("lin", 5) + pad("born", 7) + pad("died", 7) +
      "  " + REPORT.map((r) => pad(r.key, r.sd ? 12 : 7)).join(" ");
    console.log(head);
    console.log("-".repeat(head.length));
  }

  const sample = (): void => {
    const born = a.bornTotal - prevBorn;
    const died = a.diedTotal - prevDied;
    prevBorn = a.bornTotal;
    prevDied = a.diedTotal;
    const lin = lineageCount(w);

    if (opts.csv) {
      const vals = REPORT.map((r) => meanSd(w, r.gene)[0].toFixed(3));
      console.log([w.tick, a.count, lin, born, died, ...vals].join(","));
    } else {
      let row =
        pad(String(w.tick), 7) + pad(String(a.count), 7) + pad(String(lin), 5) +
        pad(String(born), 7) + pad(String(died), 7) + "  ";
      row += REPORT.map((r) => {
        const [m, sd] = meanSd(w, r.gene);
        return pad(r.sd ? `${m.toFixed(2)}±${sd.toFixed(2)}` : m.toFixed(2), r.sd ? 12 : 7);
      }).join(" ");
      console.log(row);
    }
  };

  for (let t = 1; t <= opts.ticks; t++) {
    simStep(w);
    if (a.count === 0) {
      console.log(`# population collapsed to 0 at tick ${t}`);
      return;
    }
    if (t % opts.interval === 0) sample();
  }
}

// --- CLI ---
function argVal(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : def;
}

function main(): void {
  const intensityRaw = argVal("intensity", "");
  const opts: HeadlessOptions = {
    seed: parseInt(argVal("seed", "24301"), 10) >>> 0, // 24301 = 0x5eed
    ticks: parseInt(argVal("ticks", "8000"), 10),
    interval: parseInt(argVal("interval", "1000"), 10),
    intensity: intensityRaw === "" ? null : parseFloat(intensityRaw),
    csv: process.argv.includes("--csv"),
  };
  if (!opts.csv) {
    console.log(
      `# petriarch headless — seed=${opts.seed} ticks=${opts.ticks} ` +
        `interval=${opts.interval} intensity=${opts.intensity ?? "full"}`,
    );
  }
  runHeadless(opts);
}

main();
