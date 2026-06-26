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

    const ag = age[i]! + dt;
    age[i] = ag;

    const vx = velX[i]!;
    const vy = velY[i]!;
    const speed = Math.sqrt(vx * vx + vy * vy);

    let drain = (COSTS.baseDrain + size * COSTS.sizeDrain + speed * size * COSTS.moveCost) * mr;

    // Senescence: drain ramps once past 80% of lifespan.
    const onset = lifespan * 0.8;
    if (ag > onset) {
      drain += COSTS.senescenceDrain * ((ag - onset) / (lifespan * 0.2 + 1e-3));
    }

    // Hazard zone drain.
    if (hazActive) {
      const dx = posX[i]! - hz.x;
      const dy = posY[i]! - hz.y;
      if (dx * dx + dy * dy < hzR2) drain += COSTS.hazardDrain;
    }

    let e = energy[i]! - drain;

    // Intake from the resource cell underfoot (capped by availability and headroom).
    const c = resCellIndex(posX[i]!, posY[i]!);
    const avail = res[c]!;
    if (avail > 0) {
      const maxE = size * SIM.maxEnergyPerSize;
      const room = maxE - e;
      if (room > 0) {
        let gain: number = COSTS.intakeRate;
        if (gain > avail) gain = avail;
        if (gain > room) gain = room;
        e += gain;
        res[c] = avail - gain;
      }
    }

    energy[i] = e;
  }
}
