// Tier A — GPU-portable, buffer contract. Runs every tick: age the agent, drain
// energy (baseline + SIZE + movement, all scaled by METABOLIC_RATE, plus senescence
// past LIFESPAN and any active hazard), then take intake from the resource cell it
// stands on (depleting that cell). Energy ≤ 0 is left for the death pass to cull.
//
// Buffer-contract note: the resource-cell depletion is the one shared write in this
// pass — on CPU it's deterministic by index order; the WGSL port needs an atomic
// subtract on the resource buffer (same as the hash's atomics). Everything else is
// pure per-agent.

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { SIM } from "../../data/sim";
import { COSTS } from "../../data/costs";
import { MORPH } from "../../data/morphology";
import { TICK_DT } from "../../core/time";
import { resCellIndex } from "../grid";

export function metabolism(world: World): void {
  const a = world.agents;
  const { posX, posY, velX, velY, energy, energyB, age, genes, count } = a;
  const res = world.resources;
  const resB = world.resourceB;
  const hz = world.hazard;
  const dt = TICK_DT;
  const hazActive = hz.life > 0;
  const hzR2 = hz.r * hz.r;

  for (let i = 0; i < count; i++) {
    const bi = i * GENE_COUNT;
    const size = genes[bi + GENE.SIZE]!;
    const mr = genes[bi + GENE.METABOLIC_RATE]!;
    const lifespan = genes[bi + GENE.LIFESPAN]!;
    const resilience = genes[bi + GENE.RESILIENCE]!;
    const efficiency = genes[bi + GENE.EFFICIENCY]!;

    const ag = age[i]! + dt;
    age[i] = ag;

    const vx = velX[i]!;
    const vy = velY[i]!;
    const speed = Math.sqrt(vx * vx + vy * vy);

    // A flat baseline cost every agent pays just to exist — NOT scaled by
    // METABOLIC_RATE, so evolution can't drive drain to ~0 by minimizing it (which
    // would push carrying capacity above the population cap and stop scarcity from
    // binding). The active costs (size upkeep, movement) still scale with metabolism.
    // RESILIENCE makes movement heavier (armor is costly to haul) — its tradeoff cost.
    const moveDrain = speed * size * COSTS.moveCost * (1 + MORPH.resMovePenalty * resilience);
    let drain = COSTS.baseDrain + (size * COSTS.sizeDrain + moveDrain) * mr;

    // Senescence: drain ramps once past 80% of lifespan.
    const onset = lifespan * 0.8;
    if (ag > onset) {
      drain += COSTS.senescenceDrain * ((ag - onset) / (lifespan * 0.2 + 1e-3));
    }

    // Hazard zone drain — RESILIENCE armors against it.
    if (hazActive) {
      const dx = posX[i]! - hz.x;
      const dy = posY[i]! - hz.y;
      if (dx * dx + dy * dy < hzR2) drain += COSTS.hazardDrain * (1 - MORPH.resHazardReduction * resilience);
    }

    // Dual-nutrient diet (Phase 1): two stores, eA (nutrient A) + eB (nutrient B). The
    // metabolic drain is split PROPORTIONALLY across the two stores — you burn whatever you
    // have, so a store at 0 contributes nothing and survival rides on the SUM (death.ts
    // culls on eA+eB ≤ 0). Reproduction needs BOTH stores high (reproduce.ts) — that's the
    // demand for the scarce nutrient that trade will relieve.
    let eA = energy[i]!;
    let eB = energyB[i]!;
    const total = eA + eB;
    if (total > 1e-6) {
      eA -= drain * (eA / total);
      eB -= drain * (eB / total);
    } else {
      eA -= drain; // both already empty → let it go negative; the death pass culls the sum
    }

    // Intake nutrient A from `res` into eA, nutrient B from `resB` into eB. Each store caps
    // at maxStore; EFFICIENCY (more energy per unit) + size-scaled mouth as before.
    const maxStore = size * SIM.maxEnergyPerSize;
    const effGain = 1 + MORPH.effIntakeBonus * efficiency;
    const baseTake =
      COSTS.intakeSizeExp === 1
        ? COSTS.intakeRate * size
        : COSTS.intakeRate * Math.pow(size, COSTS.intakeSizeExp);
    const c = resCellIndex(posX[i]!, posY[i]!);

    const availA = res[c]!;
    const roomA = maxStore - eA;
    if (availA > 0 && roomA > 0) {
      let take = baseTake;
      if (take > availA) take = availA;
      const rt = roomA / effGain;
      if (take > rt) take = rt;
      eA += take * effGain;
      res[c] = availA - take;
    }

    const availB = resB[c]!;
    const roomB = maxStore - eB;
    if (availB > 0 && roomB > 0) {
      let take = baseTake;
      if (take > availB) take = availB;
      const rt = roomB / effGain;
      if (take > rt) take = rt;
      eB += take * effGain;
      resB[c] = availB - take;
    }

    energy[i] = eA;
    energyB[i] = eB;
  }
}
