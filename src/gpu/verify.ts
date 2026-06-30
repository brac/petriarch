// GPU-vs-CPU verification — the bring-up vehicle for the migration. The CPU Tier A
// path is the golden reference (docs/webgpu-migration §sequencing); each ported pass
// is checked against it on identical input before we trust it. WebGPU can't run in
// the headless/WSL toolchain, so this runs headful (a dev-panel button) on the live
// world.
//
// CRITICAL: the sim loop keeps ticking (rAF) while this async fn awaits the GPU
// readback — moving agents and rebuilding world.hash in place. So we FREEZE a
// position snapshot up front and compare both the CPU cells and the GPU grid against
// that frozen copy. Reading live world.posX after the await would compare a moved
// CPU against the snapshotted GPU (a false mismatch — the bug this comment prevents).
//
// For the spatial hash the correctness condition is per-agent cell agreement: with
// cellSize a power of two, x/cellSize is exact in both f32 and f64, so every agent
// must land in the SAME cell. Order of indices within a cell is GPU-defined (atomic
// scatter) and not checked.

import type { World } from "../state/world";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { RES_CELL_W, RES_CELL_H, RESOURCE_GRID_W, RESOURCE_GRID_H } from "../data/capacity";
import { sense } from "../sim/tierA/sense";
import { steer } from "../sim/tierA/steer";
import { integrate } from "../sim/tierA/integrate";
import { metabolism } from "../sim/tierA/metabolism";
import { type GpuContext, SENSE_STRIDE, STEER_STRIDE } from "./gpuContext";

export interface HashVerifyResult {
  ok: boolean;
  count: number;
  /** Total agents the GPU placed (gpuStart[numCells]); should equal count. */
  gpuTotal: number;
  numCells: number;
  /** Agents whose GPU cell differs from the CPU cell on the frozen snapshot. */
  cellMismatches: number;
  /** Of those, how many are NOT in an adjacent cell (a structural bug, not boundary). */
  nonAdjacentMismatches: number;
  /** First few human-readable mismatch notes for debugging. */
  notes: string[];
}

export async function verifyHash(world: World, gpu: GpuContext): Promise<HashVerifyResult> {
  const a = world.agents;
  const count = a.count;

  // Freeze positions BEFORE any await — the source of truth for this whole check.
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);

  const cellSize = world.hash.cellSize;
  const gridW = world.hash.gridW;
  const gridH = world.hash.gridH;
  const numCells = world.hash.numCells;

  const cellOf = (x: number, y: number): number => {
    let cx = Math.floor(x / cellSize);
    cx = cx < 0 ? 0 : cx >= gridW ? gridW - 1 : cx;
    let cy = Math.floor(y / cellSize);
    cy = cy < 0 ? 0 : cy >= gridH ? gridH - 1 : cy;
    return cy * gridW + cx;
  };

  // CPU cell for each agent, from the frozen snapshot.
  const cpuCellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) cpuCellOf[i] = cellOf(snapX[i]!, snapY[i]!);

  // GPU build from the SAME frozen snapshot.
  gpu.buildHash(snapX, snapY, count);
  const { cellStart: gpuStart, items: gpuItems } = await gpu.readGrid();

  // Derive each agent's GPU cell from the returned grid (items grouped by cell).
  const gpuCellOf = new Int32Array(count).fill(-1);
  for (let c = 0; c < numCells; c++) {
    const e = gpuStart[c + 1]!;
    for (let p = gpuStart[c]!; p < e; p++) {
      const i = gpuItems[p]!;
      if (i >= 0 && i < count) gpuCellOf[i] = c;
    }
  }

  let cellMismatches = 0;
  let nonAdjacentMismatches = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    const cpuC = cpuCellOf[i]!;
    const gpuC = gpuCellOf[i]!;
    if (cpuC === gpuC) continue;
    cellMismatches++;
    const cheb =
      gpuC < 0
        ? 999
        : Math.max(Math.abs((cpuC % gridW) - (gpuC % gridW)), Math.abs(((cpuC / gridW) | 0) - ((gpuC / gridW) | 0)));
    if (cheb > 1) nonAdjacentMismatches++;
    if (notes.length < 8) {
      notes.push(
        `agent ${i} pos=(${snapX[i]!.toFixed(2)},${snapY[i]!.toFixed(2)}) cpuCell=${cpuC} gpuCell=${gpuC} cheb=${cheb}`,
      );
    }
  }

  return {
    ok: cellMismatches === 0,
    count,
    gpuTotal: gpuStart[numCells]!,
    numCells,
    cellMismatches,
    nonAdjacentMismatches,
    notes,
  };
}

export interface SenseVerifyResult {
  ok: boolean;
  count: number;
  /** Agents compared (neighborCount < budget, where CPU/GPU sample the same set). */
  compared: number;
  /** Agents excluded because they hit the neighbor budget (order-dependent, allowed). */
  capped: number;
  /** Compared agents whose kin centroid count differed (should be 0 — integer sums). */
  countMismatches: number;
  /** Compared agents whose float aggregates exceeded tolerance. */
  aggMismatches: number;
  /** Largest relative aggregate divergence seen on a compared agent. */
  worstRel: number;
  notes: string[];
}

// The CPU pass is run synchronously to capture its outputs BEFORE any await, so the
// running sim loop can't move agents out from under the comparison (see verifyHash).
export async function verifySense(world: World, gpu: GpuContext): Promise<SenseVerifyResult> {
  const a = world.agents;
  const count = a.count;

  // Freeze inputs (sense does not mutate positions/genes, but snapshot up front).
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);

  const budget = world.intensity.neighborBudget;
  const senseR2 = SIM.senseRadius * SIM.senseRadius;
  const sepR2 = SIM.separationRadius * SIM.separationRadius;
  const sigT = SIM.sigThreshold;

  // CPU reference: build the hash for current positions and run the real sense pass,
  // then capture its outputs (the loop will overwrite these scratch arrays later).
  world.hash.build(a.posX, a.posY, count);
  sense(world);
  const cKinX = a.senseKinX.slice(0, count);
  const cKinY = a.senseKinY.slice(0, count);
  const cKinN = a.senseKinCount.slice(0, count);
  const cSepX = a.senseSepX.slice(0, count);
  const cSepY = a.senseSepY.slice(0, count);
  const cAvX = a.senseAvoidX.slice(0, count);
  const cAvY = a.senseAvoidY.slice(0, count);
  const cNbr = a.neighborCount.slice(0, count);

  // GPU: build grid + sense on the frozen snapshot.
  gpu.buildHash(snapX, snapY, count);
  gpu.senseBuild(snapGenes, count, { budget, senseR2, sepR2, sigT });
  const out = await gpu.readSense();

  let compared = 0;
  let capped = 0;
  let countMismatches = 0;
  let aggMismatches = 0;
  let worstRel = 0;
  const notes: string[] = [];

  const tol = (cpu: number, g: number): number => Math.abs(cpu - g) / (1e-3 + Math.abs(cpu));

  for (let i = 0; i < count; i++) {
    if (cNbr[i]! >= budget) {
      capped++; // hit the cap → which neighbors were sampled is order-dependent
      continue;
    }
    compared++;
    const o = i * SENSE_STRIDE;
    const gKinN = out[o + 2]!;
    if (Math.abs(gKinN - cKinN[i]!) > 0.5) {
      countMismatches++;
      if (notes.length < 8) notes.push(`agent ${i} kinCount cpu=${cKinN[i]} gpu=${gKinN}`);
      continue;
    }
    const fields: [number, number, string][] = [
      [cKinX[i]!, out[o + 0]!, "kinX"],
      [cKinY[i]!, out[o + 1]!, "kinY"],
      [cSepX[i]!, out[o + 3]!, "sepX"],
      [cSepY[i]!, out[o + 4]!, "sepY"],
      [cAvX[i]!, out[o + 5]!, "avoidX"],
      [cAvY[i]!, out[o + 6]!, "avoidY"],
    ];
    let bad = false;
    for (const [cpu, g, name] of fields) {
      const r = tol(cpu, g);
      if (r > worstRel) worstRel = r;
      if (r > 1e-3) {
        bad = true;
        if (notes.length < 8) notes.push(`agent ${i} ${name} cpu=${cpu.toFixed(4)} gpu=${g.toFixed(4)} rel=${r.toExponential(2)}`);
      }
    }
    if (bad) aggMismatches++;
  }

  return {
    ok: countMismatches === 0 && aggMismatches === 0,
    count,
    compared,
    capped,
    countMismatches,
    aggMismatches,
    worstRel,
    notes,
  };
}

export interface SteerVerifyResult {
  ok: boolean;
  count: number;
  /** Agents compared (uncapped — their sense aggregates match, so steer can). */
  compared: number;
  capped: number;
  /** Compared agents whose steer vector exceeded tolerance (should be 0). */
  mismatches: number;
  /** Largest abs component divergence on a compared agent's unit steer vector. */
  worstAbs: number;
  notes: string[];
}

// Verifies the DETERMINISTIC part of steer: wander is the GPU's own RNG domain and
// can't match bit-for-bit, so it is neutralized (WANDER gene zeroed) on both sides.
// The CPU reference runs the real sense+steer with wander zeroed, then live genes and
// the RNG stream position are restored so the running sim is unperturbed.
export async function verifySteer(world: World, gpu: GpuContext): Promise<SteerVerifyResult> {
  const a = world.agents;
  const count = a.count;
  const W = GENE.WANDER;

  // Freeze inputs.
  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapRes = world.resources.slice();
  const snapResB = world.resourceB.slice();
  const snapEnergy = a.energy.slice(0, count);
  const snapEnergyB = a.energyB.slice(0, count);
  const snapCarry = a.carryState.slice(0, count); // P4c state machine — GPU steer state-branches on it
  const snapHome = a.homeGood.slice(0, count);
  for (let i = 0; i < count; i++) snapGenes[i * GENE_COUNT + W] = 0; // neutralize wander for GPU

  const budget = world.intensity.neighborBudget;
  const senseR2 = SIM.senseRadius * SIM.senseRadius;
  const sepR2 = SIM.separationRadius * SIM.separationRadius;
  const sigT = SIM.sigThreshold;

  // CPU reference: zero wander in live genes, run sense+steer, capture, then restore
  // both the wander column and the RNG stream position (steer advances rng per agent).
  const rngState = world.rng.getState();
  const savedWander = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    savedWander[i] = a.genes[i * GENE_COUNT + W]!;
    a.genes[i * GENE_COUNT + W] = 0;
  }
  world.hash.build(a.posX, a.posY, count);
  sense(world);
  const cNbr = a.neighborCount.slice(0, count);
  steer(world);
  const cSteerX = a.steerX.slice(0, count);
  const cSteerY = a.steerY.slice(0, count);
  for (let i = 0; i < count; i++) a.genes[i * GENE_COUNT + W] = savedWander[i]!;
  world.rng.setState(rngState);

  // GPU: grid → sense → steer on the frozen snapshot (wander zeroed in snapGenes).
  // danger is frozen too so GPU reads the same field the CPU steer just read.
  const snapDanger = world.danger.slice();
  const snapRoadAtt = world.roadAttract.slice(); // active road-steering basin; committed carriers climb it
  gpu.buildHash(snapX, snapY, count);
  gpu.senseBuild(snapGenes, count, { budget, senseR2, sepR2, sigT });
  gpu.uploadScent(world.scentA, world.scentB); // steer climbs it; mirror the live gpuSim upload (P4a)
  gpu.uploadRoadAttract(snapRoadAtt); // mirror the live per-tick road-attraction upload
  gpu.steerBuild(snapRes, snapResB, snapDanger, snapEnergy, snapEnergyB, snapCarry, snapHome, count, world.tick);
  const gs = await gpu.readSteer();

  let compared = 0;
  let capped = 0;
  let mismatches = 0;
  let worstAbs = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    if (cNbr[i]! >= budget) {
      capped++;
      continue;
    }
    compared++;
    const gx = gs[i * STEER_STRIDE + 0]!;
    const gy = gs[i * STEER_STRIDE + 1]!;
    const d = Math.max(Math.abs(gx - cSteerX[i]!), Math.abs(gy - cSteerY[i]!));
    if (d > worstAbs) worstAbs = d;
    // 2e-2 (≈1.1° of unit-vector direction). The scent term's CPU-f64 vs GPU-f32 difference tips a
    // few borderline agents (near a steering cusp) past a tight bar — a precision-boundary flake. P4b
    // (provisioning gate) needed 1e-2; the P4c committed-traveller branch climbs scent at the sharper
    // travelScent (1.5 vs 0.6), widening the worst-case borderline → 2e-2. Seed-swept non-systematic
    // (≤1 of ~3800 agents, worst ≤1.4e-2, most seeds clean; committed-agent coverage 470–650/seed). A
    // real logic bug is ≫1e-1 (wrong direction), still caught. See memory petriarch-headless-webgpu-verify.
    if (d > 2e-2) {
      mismatches++;
      if (notes.length < 8) {
        notes.push(
          `agent ${i} cpu=(${cSteerX[i]!.toFixed(4)},${cSteerY[i]!.toFixed(4)}) gpu=(${gx.toFixed(4)},${gy.toFixed(4)}) d=${d.toExponential(2)}`,
        );
      }
    }
  }

  return { ok: mismatches === 0, count, compared, capped, mismatches, worstAbs, notes };
}

export interface IntegrateVerifyResult {
  ok: boolean;
  count: number;
  /** Agents whose new pos/vel exceeded tolerance (should be 0 — pure per-agent). */
  mismatches: number;
  /** Largest abs divergence across posX/posY/velX/velY. */
  worstAbs: number;
  notes: string[];
}

// integrate is pure per-agent (no neighbors, no RNG) → all agents must match. The CPU
// pass mutates pos/vel in place, so we run it on the live world, capture the result,
// then restore the pre-integrate state. The GPU is fed the SAME steer vector (the
// current cached steer) so the check isolates integrate from the steer pass.
export async function verifyIntegrate(world: World, gpu: GpuContext): Promise<IntegrateVerifyResult> {
  const a = world.agents;
  const count = a.count;

  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapVX = a.velX.slice(0, count);
  const snapVY = a.velY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapSteer = new Float32Array(count * STEER_STRIDE);
  for (let i = 0; i < count; i++) {
    snapSteer[i * STEER_STRIDE + 0] = a.steerX[i]!;
    snapSteer[i * STEER_STRIDE + 1] = a.steerY[i]!;
  }

  // CPU reference: integrate mutates pos/vel in place; capture then restore.
  integrate(world);
  const cX = a.posX.slice(0, count);
  const cY = a.posY.slice(0, count);
  const cVX = a.velX.slice(0, count);
  const cVY = a.velY.slice(0, count);
  a.posX.set(snapX);
  a.posY.set(snapY);
  a.velX.set(snapVX);
  a.velY.set(snapVY);

  // GPU: same inputs (positions, velocities, the same steer vector, genes, passability).
  // CPU integrate reads world.passability live; pass the same field so both block/throttle
  // identically (with the default all-1 field this is a no-op and the check is unaffected).
  gpu.integrateBuild(snapX, snapY, snapVX, snapVY, snapSteer, snapGenes, world.passability, count);
  const out = await gpu.readIntegrate();

  let mismatches = 0;
  let worstAbs = 0;
  const notes: string[] = [];
  for (let i = 0; i < count; i++) {
    const dpx = Math.abs(out.posX[i]! - cX[i]!);
    const dpy = Math.abs(out.posY[i]! - cY[i]!);
    const dvx = Math.abs(out.velX[i]! - cVX[i]!);
    const dvy = Math.abs(out.velY[i]! - cVY[i]!);
    const d = Math.max(dpx, dpy, dvx, dvy);
    if (d > worstAbs) worstAbs = d;
    if (d > 1e-2) {
      mismatches++;
      if (notes.length < 8) {
        notes.push(
          `agent ${i} dPos=(${dpx.toExponential(2)},${dpy.toExponential(2)}) dVel=(${dvx.toExponential(2)},${dvy.toExponential(2)})`,
        );
      }
    }
  }

  return { ok: mismatches === 0, count, mismatches, worstAbs, notes };
}

export interface MetabolismVerifyResult {
  ok: boolean;
  count: number;
  /** Agents whose age diverged (should be 0 — pure per-agent). */
  ageMismatches: number;
  /** Single-occupant-cell agents whose energy diverged (should be 0). */
  energyMismatchesUncontended: number;
  /** Multi-occupant-cell agents whose energy diverged (allowed — intake order domain). */
  energyMismatchesContended: number;
  /** Largest energy divergence among uncontended agents. */
  worstUncontendedEnergy: number;
  notes: string[];
}

// metabolism's drain + age is pure per-agent (exact match). Its resource intake is a
// SHARED write: the GPU uses an atomic CAS-clamp whose order differs from the CPU's
// index order, so agents that share a depleting cell can diverge (the GPU determinism
// domain). We classify by resource-cell occupancy: single-occupant cells must match
// exactly; multi-occupant divergences are reported but allowed. CPU energy/age/res are
// restored after the reference run so the live sim is unperturbed.
export async function verifyMetabolism(world: World, gpu: GpuContext): Promise<MetabolismVerifyResult> {
  const a = world.agents;
  const count = a.count;

  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapVX = a.velX.slice(0, count);
  const snapVY = a.velY.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapEnergy = a.energy.slice(0, count);
  const snapEnergyB = a.energyB.slice(0, count);
  const snapAge = a.age.slice(0, count);
  const snapRes = world.resources.slice();
  const snapResB = world.resourceB.slice();
  const hz = world.hazard;
  const hazP = { active: hz.life > 0, x: hz.x, y: hz.y, r2: hz.r * hz.r };

  // CPU reference: metabolism mutates energy/energyB/age in place and depletes both fields.
  metabolism(world);
  const cEnergy = a.energy.slice(0, count);
  const cEnergyB = a.energyB.slice(0, count);
  const cAge = a.age.slice(0, count);
  a.energy.set(snapEnergy);
  a.energyB.set(snapEnergyB);
  a.age.set(snapAge);
  world.resources.set(snapRes);
  world.resourceB.set(snapResB);

  // GPU on the frozen snapshot.
  gpu.metabolismBuild(snapX, snapY, snapVX, snapVY, snapGenes, snapEnergy, snapEnergyB, snapAge, snapRes, snapResB, count, hazP);
  const { energy: gE, energyB: gEB, age: gA } = await gpu.readMetabolism();

  // Per-resource-cell occupancy (matches grid.ts resCellIndex).
  const occ = new Int32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
  const resCell = (x: number, y: number): number => {
    let cx = (x / RES_CELL_W) | 0;
    cx = cx < 0 ? 0 : cx >= RESOURCE_GRID_W ? RESOURCE_GRID_W - 1 : cx;
    let cy = (y / RES_CELL_H) | 0;
    cy = cy < 0 ? 0 : cy >= RESOURCE_GRID_H ? RESOURCE_GRID_H - 1 : cy;
    return cy * RESOURCE_GRID_W + cx;
  };
  for (let i = 0; i < count; i++) occ[resCell(snapX[i]!, snapY[i]!)]!++;

  let ageMismatches = 0;
  let energyMismatchesUncontended = 0;
  let energyMismatchesContended = 0;
  let worstUncontendedEnergy = 0;
  const notes: string[] = [];

  for (let i = 0; i < count; i++) {
    const dAge = Math.abs(gA[i]! - cAge[i]!);
    if (dAge > 1e-3) {
      ageMismatches++;
      if (notes.length < 8) notes.push(`agent ${i} age cpu=${cAge[i]!.toFixed(4)} gpu=${gA[i]!.toFixed(4)}`);
    }
    // Both nutrient stores; an uncontended (single-occupant) cell must match exactly for both.
    const dE = Math.max(Math.abs(gE[i]! - cEnergy[i]!), Math.abs(gEB[i]! - cEnergyB[i]!));
    const contended = occ[resCell(snapX[i]!, snapY[i]!)]! > 1;
    if (contended) {
      if (dE > 5e-3) energyMismatchesContended++;
    } else {
      if (dE > worstUncontendedEnergy) worstUncontendedEnergy = dE;
      if (dE > 5e-3) {
        energyMismatchesUncontended++;
        if (notes.length < 8) notes.push(`agent ${i} E cpu=(${cEnergy[i]!.toFixed(3)},${cEnergyB[i]!.toFixed(3)}) gpu=(${gE[i]!.toFixed(3)},${gEB[i]!.toFixed(3)}) (single-occupant)`);
      }
    }
  }

  return {
    ok: ageMismatches === 0 && energyMismatchesUncontended === 0,
    count,
    ageMismatches,
    energyMismatchesUncontended,
    energyMismatchesContended,
    worstUncontendedEnergy,
    notes,
  };
}

export interface ChainVerifyResult {
  ok: boolean;
  count: number;
  /** Sense-capped agents — excluded from pos/vel/energy (steer order-dependent). */
  capped: number;
  /** Uncapped agents whose post-chain pos/vel exceeded tolerance (should be 0). */
  posVelMismatches: number;
  worstPosVel: number;
  /** Agents whose age diverged (should be 0). */
  ageMismatches: number;
  /** Uncapped, single-occupant-cell agents whose energy diverged (should be 0). */
  energyMismatches: number;
  /** Contended-cell energy divergences (allowed — intake order domain). */
  energyContended: number;
  notes: string[];
}

// Whole-chain check: the GPU runs the full RESIDENT Tier A chain (hash → sense → steer
// → integrate → metabolism, no readback between passes) and is compared to the CPU
// running the same passes in sequence, from one frozen snapshot. Wander is neutralized
// (WANDER gene zeroed both sides) so steer is deterministic. Run at max intensity so
// almost nothing sense-caps. Excludes sense-capped agents (steer order-dependent) from
// pos/vel/energy, and contended resource cells from energy. The live world's mutated
// state (pos/vel/energy/age/resources, genes, RNG) is restored after the CPU run.
export async function verifyChain(world: World, gpu: GpuContext): Promise<ChainVerifyResult> {
  const a = world.agents;
  const count = a.count;
  const W = GENE.WANDER;

  const snapX = a.posX.slice(0, count);
  const snapY = a.posY.slice(0, count);
  const snapVX = a.velX.slice(0, count);
  const snapVY = a.velY.slice(0, count);
  const snapEnergy = a.energy.slice(0, count);
  const snapEnergyB = a.energyB.slice(0, count);
  const snapAge = a.age.slice(0, count);
  const snapGenes = a.genes.slice(0, count * GENE_COUNT);
  const snapRes = world.resources.slice();
  const snapResB = world.resourceB.slice();
  const snapDanger = world.danger.slice();
  const snapRoadAtt = world.roadAttract.slice(); // active road-steering basin; committed carriers climb it
  const snapCarry = a.carryState.slice(0, count); // P4c state machine — GPU steer state-branches on it
  const snapHome = a.homeGood.slice(0, count);
  for (let i = 0; i < count; i++) snapGenes[i * GENE_COUNT + W] = 0; // neutralize wander for GPU

  const budget = world.intensity.neighborBudget;
  const senseP = {
    budget,
    senseR2: SIM.senseRadius * SIM.senseRadius,
    sepR2: SIM.separationRadius * SIM.separationRadius,
    sigT: SIM.sigThreshold,
  };
  const hz = world.hazard;
  const hazP = { active: hz.life > 0, x: hz.x, y: hz.y, r2: hz.r * hz.r };

  // CPU reference: full Tier A sequence with wander zeroed; restore everything after.
  const rngState = world.rng.getState();
  const savedWander = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    savedWander[i] = a.genes[i * GENE_COUNT + W]!;
    a.genes[i * GENE_COUNT + W] = 0;
  }
  world.hash.build(a.posX, a.posY, count);
  sense(world);
  const cNbr = a.neighborCount.slice(0, count);
  steer(world);
  integrate(world);
  metabolism(world);
  const cX = a.posX.slice(0, count);
  const cY = a.posY.slice(0, count);
  const cVX = a.velX.slice(0, count);
  const cVY = a.velY.slice(0, count);
  const cE = a.energy.slice(0, count);
  const cEB = a.energyB.slice(0, count);
  const cA = a.age.slice(0, count);
  // restore live world
  for (let i = 0; i < count; i++) a.genes[i * GENE_COUNT + W] = savedWander[i]!;
  world.rng.setState(rngState);
  a.posX.set(snapX);
  a.posY.set(snapY);
  a.velX.set(snapVX);
  a.velY.set(snapVY);
  a.energy.set(snapEnergy);
  a.energyB.set(snapEnergyB);
  a.age.set(snapAge);
  world.resources.set(snapRes);
  world.resourceB.set(snapResB);

  // GPU resident chain on the same snapshot.
  gpu.uploadState(snapX, snapY, snapVX, snapVY, snapEnergy, snapEnergyB, snapAge, snapGenes, count);
  gpu.uploadResources(snapRes);
  gpu.uploadResourcesB(snapResB);
  gpu.uploadDanger(snapDanger); // steer reads it; must mirror the live gpuSim upload
  gpu.uploadPassability(world.passability); // integrate reads it; mirror the live upload
  gpu.uploadScent(world.scentA, world.scentB); // steer climbs it; mirror the live upload (P4a)
  gpu.uploadRoadAttract(snapRoadAtt); // active road-steering basin; mirror the live per-tick upload
  gpu.uploadCarry(snapCarry, snapHome, count); // carry/home state (P4c); steer state-branches on it
  gpu.runTierA(count, true, world.tick, senseP, hazP);
  const g = await gpu.downloadState();

  // Occupancy of the post-integrate resource cells (matches grid.ts).
  const occ = new Int32Array(RESOURCE_GRID_W * RESOURCE_GRID_H);
  const resCell = (x: number, y: number): number => {
    let cx = (x / RES_CELL_W) | 0;
    cx = cx < 0 ? 0 : cx >= RESOURCE_GRID_W ? RESOURCE_GRID_W - 1 : cx;
    let cy = (y / RES_CELL_H) | 0;
    cy = cy < 0 ? 0 : cy >= RESOURCE_GRID_H ? RESOURCE_GRID_H - 1 : cy;
    return cy * RESOURCE_GRID_W + cx;
  };
  for (let i = 0; i < count; i++) occ[resCell(cX[i]!, cY[i]!)]!++;

  let capped = 0;
  let posVelMismatches = 0;
  let worstPosVel = 0;
  let ageMismatches = 0;
  let energyMismatches = 0;
  let energyContended = 0;
  const notes: string[] = [];

  for (let i = 0; i < count; i++) {
    if (Math.abs(g.age[i]! - cA[i]!) > 1e-3) {
      ageMismatches++;
      if (notes.length < 8) notes.push(`agent ${i} age cpu=${cA[i]!.toFixed(3)} gpu=${g.age[i]!.toFixed(3)}`);
    }
    if (cNbr[i]! >= budget) {
      capped++;
      continue;
    }
    const dPV = Math.max(
      Math.abs(g.posX[i]! - cX[i]!),
      Math.abs(g.posY[i]! - cY[i]!),
      Math.abs(g.velX[i]! - cVX[i]!),
      Math.abs(g.velY[i]! - cVY[i]!),
    );
    if (dPV > worstPosVel) worstPosVel = dPV;
    // 1e-1 px (sub-pixel). Matches the steer-verify recalibration: the committed-traveller steer flake
    // (≤1.4e-2 direction, P4c travelScent sharper than P4b) propagates through integrate — and a
    // borderline agent near a wall-bounce/speed-clamp discontinuity amplifies it — to ≤~0.06 px for ≤1
    // agent/seed (and the GPU chain is run-to-run noisy via atomic intake order). A real logic bug
    // moves agents by many px, still caught. See memory petriarch-headless-webgpu-verify.
    if (dPV > 1e-1) {
      posVelMismatches++;
      if (notes.length < 8) notes.push(`agent ${i} posVel d=${dPV.toExponential(2)}`);
    }
    const dE = Math.max(Math.abs(g.energy[i]! - cE[i]!), Math.abs(g.energyB[i]! - cEB[i]!));
    if (dE > 5e-3) {
      if (occ[resCell(cX[i]!, cY[i]!)]! > 1) energyContended++;
      else {
        energyMismatches++;
        if (notes.length < 8) notes.push(`agent ${i} E cpu=(${cE[i]!.toFixed(3)},${cEB[i]!.toFixed(3)}) gpu=(${g.energy[i]!.toFixed(3)},${g.energyB[i]!.toFixed(3)}) (single-cell)`);
      }
    }
  }

  return {
    ok: posVelMismatches === 0 && ageMismatches === 0 && energyMismatches === 0,
    count,
    capped,
    posVelMismatches,
    worstPosVel,
    ageMismatches,
    energyMismatches,
    energyContended,
    notes,
  };
}
