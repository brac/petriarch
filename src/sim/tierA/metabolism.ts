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
  const { posX, posY, velX, velY, energy, age, genes, count } = a;
  const res = world.resources;
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

    let e = energy[i]! - drain;

    // Intake from the resource cell underfoot (capped by availability and headroom).
    const c = resCellIndex(posX[i]!, posY[i]!);
    const avail = res[c]!;
    if (avail > 0) {
      const maxE = size * SIM.maxEnergyPerSize;
      const room = maxE - e;
      if (room > 0) {
        // EFFICIENCY = more energy per unit resource (its benefit): we deplete `take`
        // of the cell and credit `take * effGain` energy. So efficient bodies are
        // gentler on the field for the same energy — a sustainable niche.
        const effGain = 1 + MORPH.effIntakeBonus * efficiency;
        // Bigger mouths harvest faster (SIZE^intakeSizeExp), so big bodies can
        // accumulate energy fast enough to breed and to hold rich patches.
        const baseTake =
          COSTS.intakeSizeExp === 1
            ? COSTS.intakeRate * size
            : COSTS.intakeRate * Math.pow(size, COSTS.intakeSizeExp);
        let take = baseTake;
        if (take > avail) take = avail;
        const roomTake = room / effGain; // resource that would exactly fill the headroom
        if (take > roomTake) take = roomTake;
        e += take * effGain;
        res[c] = avail - take;
      }
    }

    energy[i] = e;
  }
}
