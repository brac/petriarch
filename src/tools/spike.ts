// SPIKE: speciation study (temporary research harness; run with vite-node like headless).
// Goal — find tunings that INCREASE diversity BETWEEN societies (more distinct tag-space
// clusters that persist) while INCREASING cohesion WITHIN each society (each cluster
// internally uniform in signature AND behavior). These pull against each other through the
// mutation knob, so the study looks for combinations that move both the right way.
//
// IMPORTANT: imports use the SAME project-relative specifiers the sim uses, so the data
// objects (SIM/RESOURCES/COGNITION) are the SINGLE shared instance the sim reads live.
// (A scratchpad copy importing via a different path got a second instance and the
// overrides silently no-op'd — every config came out identical.)
//
// Metrics (live population, averaged over the run tail + seeds):
//   species   = # tag-space clusters with >= minSize members (between-diversity, want UP)
//   withinSig = mean within-species signature spread, normalized   (monoethnic, want DOWN)
//   withinBeh = mean within-species behavior-gene spread, normalized(monoculture, want DOWN)
//   F         = Calinski-Harabasz F-ratio in SIG space = between/within (want UP)
//   sizeMean  = mean SIZE gene (small-dominates check)

import { createWorld, type World } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT, GENE_RANGE } from "../data/genome";
import { SIM } from "../data/sim";
import { RESOURCES } from "../data/resources";
import { COGNITION } from "../data/cognition";

// Fixed measurement ruler: cluster/score every config at this tag-space radius regardless
// of the sim's own sigThreshold, so species counts are comparable across configs.
const REF_SIGT = 0.22;

const SA = GENE.SIG_A, SB = GENE.SIG_B, SC = GENE.SIG_C;
const BEH = [GENE.SIZE, GENE.METABOLIC_RATE, GENE.REPRO_THRESHOLD, GENE.FERTILITY, GENE.KIN_COHESION, GENE.SEPARATION, GENE.RESOURCE_ATTRACT, GENE.THREAT_AVOID, GENE.AGGRESSION];

interface Metrics { pop: number; lin: number; species: number; withinSig: number; withinBeh: number; between: number; F: number; sizeMean: number }

function metrics(w: World, sigT: number): Metrics {
  const a = w.agents; const g = a.genes; const n = a.count;
  if (n === 0) return { pop: 0, lin: 0, species: 0, withinSig: NaN, withinBeh: NaN, between: NaN, F: NaN, sizeMean: NaN };

  const t2 = sigT * sigT;
  const lead: number[][] = [];
  const members: number[][] = [];
  for (let i = 0; i < n; i++) {
    const A = g[i * GENE_COUNT + SA]!, B = g[i * GENE_COUNT + SB]!, C = g[i * GENE_COUNT + SC]!;
    let best = -1;
    for (let L = 0; L < lead.length; L++) {
      const dl = lead[L]!; const da = dl[0]! - A, db = dl[1]! - B, dc = dl[2]! - C;
      if (da * da + db * db + dc * dc < t2) { best = L; break; }
    }
    if (best < 0) { best = lead.length; lead.push([A, B, C]); members.push([]); }
    members[best]!.push(i);
  }

  const minSize = Math.max(15, Math.round(0.02 * n));
  const species: number[] = [];
  for (let L = 0; L < members.length; L++) if (members[L]!.length >= minSize) species.push(L);
  const k = species.length;

  let ox = 0, oy = 0, oz = 0, ntot = 0;
  const cen: number[][] = [];
  for (const L of species) {
    const m = members[L]!; let sx = 0, sy = 0, sz = 0;
    for (const i of m) { sx += g[i * GENE_COUNT + SA]!; sy += g[i * GENE_COUNT + SB]!; sz += g[i * GENE_COUNT + SC]!; }
    cen.push([sx / m.length, sy / m.length, sz / m.length]);
    ox += sx; oy += sy; oz += sz; ntot += m.length;
  }
  ox /= ntot; oy /= ntot; oz /= ntot;

  let withinSS = 0, betweenSS = 0, withinSigSD = 0, wW = 0;
  for (let s = 0; s < k; s++) {
    const L = species[s]!; const m = members[L]!; const c = cen[s]!;
    let ss = 0;
    for (const i of m) {
      const da = g[i * GENE_COUNT + SA]! - c[0]!, db = g[i * GENE_COUNT + SB]! - c[1]!, dc = g[i * GENE_COUNT + SC]! - c[2]!;
      ss += da * da + db * db + dc * dc;
    }
    withinSS += ss; withinSigSD += Math.sqrt(ss / m.length) * m.length; wW += m.length;
    const ba = c[0]! - ox, bb = c[1]! - oy, bc = c[2]! - oz;
    betweenSS += m.length * (ba * ba + bb * bb + bc * bc);
  }
  const F = k > 1 && withinSS > 1e-9 ? (betweenSS / (k - 1)) / (withinSS / (ntot - k)) : 0;

  let withinBeh = 0, wB = 0;
  for (const L of species) {
    const m = members[L]!; let sdSum = 0;
    for (const gene of BEH) {
      const r = GENE_RANGE[gene]!; const span = r[1] - r[0];
      let mean = 0; for (const i of m) mean += g[i * GENE_COUNT + gene]!; mean /= m.length;
      let v = 0; for (const i of m) { const d = g[i * GENE_COUNT + gene]! - mean; v += d * d; }
      sdSum += Math.sqrt(v / m.length) / span;
    }
    withinBeh += (sdSum / BEH.length) * m.length; wB += m.length;
  }

  let between = 0;
  for (let s = 0; s < k; s++) { const c = cen[s]!; const ba = c[0]! - ox, bb = c[1]! - oy, bc = c[2]! - oz; between += ba * ba + bb * bb + bc * bc; }
  between = k > 0 ? Math.sqrt(between / k) : 0;

  let sizeMean = 0; for (let i = 0; i < n; i++) sizeMean += g[i * GENE_COUNT + GENE.SIZE]!; sizeMean /= n;
  const lins = new Set<number>(); for (let i = 0; i < n; i++) lins.add(a.lineageId[i]!);

  return { pop: n, lin: lins.size, species: k, withinSig: wW ? withinSigSD / wW : NaN, withinBeh: wB ? withinBeh / wB : NaN, between, F, sizeMean };
}

const DEF = {
  baseMutationScale: SIM.baseMutationScale, mutabilityFloor: SIM.mutabilityFloor, sigThreshold: SIM.sigThreshold,
  founderTribes: SIM.founderTribes, initialPop: SIM.initialPop,
  clumping: RESOURCES.clumping, clumpCount: RESOURCES.clumpCount, regrowthRate: RESOURCES.regrowthRate, cellCapacity: RESOURCES.cellCapacity,
  level: COGNITION.level, mask: COGNITION.mask,
};
function restore(): void {
  SIM.baseMutationScale = DEF.baseMutationScale; SIM.mutabilityFloor = DEF.mutabilityFloor; SIM.sigThreshold = DEF.sigThreshold;
  SIM.founderTribes = DEF.founderTribes; SIM.initialPop = DEF.initialPop;
  RESOURCES.clumping = DEF.clumping; RESOURCES.clumpCount = DEF.clumpCount; RESOURCES.regrowthRate = DEF.regrowthRate; RESOURCES.cellCapacity = DEF.cellCapacity;
  COGNITION.level = DEF.level; COGNITION.mask = DEF.mask;
}
type Override = Partial<typeof DEF>;
function apply(o: Override): void {
  const so = SIM as unknown as Record<string, number>;
  const ro = RESOURCES as unknown as Record<string, number>;
  for (const key of Object.keys(o)) {
    const v = (o as Record<string, number>)[key]!;
    if (key === "baseMutationScale" || key === "mutabilityFloor" || key === "sigThreshold" || key === "founderTribes" || key === "initialPop") so[key] = v;
    else if (key === "clumping" || key === "clumpCount" || key === "regrowthRate" || key === "cellCapacity") ro[key] = v;
    else if (key === "level") COGNITION.level = v;
    else if (key === "mask") COGNITION.mask = v;
  }
}

function runConfig(name: string, o: Override, seeds: number[], ticks: number): Metrics & { name: string } {
  const acc: Metrics = { pop: 0, lin: 0, species: 0, withinSig: 0, withinBeh: 0, between: 0, F: 0, sizeMean: 0 };
  let nseed = 0;
  for (const seed of seeds) {
    restore(); apply(o);
    const w = createWorld(seed);
    initResourceField(w); seedPopulation(w);
    const samples: Metrics[] = [];
    for (let t = 1; t <= ticks; t++) {
      simStep(w);
      if (w.agents.count === 0) break;
      if (t >= ticks - 2000 && t % 1000 === 0) samples.push(metrics(w, REF_SIGT));
    }
    if (samples.length === 0 && w.agents.count > 0) samples.push(metrics(w, REF_SIGT));
    if (samples.length === 0) continue;
    const m: Metrics = { pop: 0, lin: 0, species: 0, withinSig: 0, withinBeh: 0, between: 0, F: 0, sizeMean: 0 };
    for (const s of samples) for (const key of Object.keys(m)) (m as unknown as Record<string, number>)[key]! += (s as unknown as Record<string, number>)[key]! / samples.length;
    for (const key of Object.keys(acc)) (acc as unknown as Record<string, number>)[key]! += (m as unknown as Record<string, number>)[key]!;
    nseed++;
  }
  for (const key of Object.keys(acc)) (acc as unknown as Record<string, number>)[key]! /= (nseed || 1);
  return { name, ...acc };
}

function fmt(m: Metrics & { name: string }): string {
  const p = (v: number, w: number, d = 2): string => (isNaN(v) ? "NaN" : v.toFixed(d)).padStart(w);
  return `${m.name.padEnd(22)} pop${p(m.pop, 6, 0)} lin${p(m.lin, 5, 0)} | species${p(m.species, 5, 1)} F${p(m.F, 8)} withinSig${p(m.withinSig, 8, 4)} withinBeh${p(m.withinBeh, 8, 4)} between${p(m.between, 6, 3)} | SIZE${p(m.sizeMean, 6)}`;
}

const SEEDS = [11, 22, 33, 44];
const TICKS = 10000;

// Phase 3: nail the between↔within frontier and confirm it PERSISTS (10k ticks, 4 seeds).
const CONFIGS: [string, Override][] = [
  ["baseline", {}],
  ["found16", { founderTribes: 16 }],
  ["found20", { founderTribes: 20 }],
  ["mut.06+found16", { baseMutationScale: 0.06, founderTribes: 16 }],
  ["mut.06+found20", { baseMutationScale: 0.06, founderTribes: 20 }],
  ["mut.07+found16", { baseMutationScale: 0.07, founderTribes: 16 }],
  ["mut.06+found24", { baseMutationScale: 0.06, founderTribes: 24 }],
];

console.log(`# SPIKE speciation phase 3 (frontier+persistence) — seeds ${SEEDS.join(",")} ticks ${TICKS}, ruler sigT=${REF_SIGT}`);
console.log(`# want: species UP, F UP, withinSig DOWN, withinBeh DOWN`);
for (const [name, o] of CONFIGS) console.log(fmt(runConfig(name, o, SEEDS, TICKS)));
