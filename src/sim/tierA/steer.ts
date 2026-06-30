// Tier A — GPU-portable, buffer contract. The core behavior pass (the one whose
// WGSL port matters most). Every THINK_INTERVAL ticks, combine the sensed
// aggregates with the behavior genes, a resource-gradient pull, and a seeded wander
// into one unit steering direction, cached in agents.steerX/steerY for integrate to
// consume every tick. Each gene weight is a tradeoff (docs/genome.md).

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import {
  RES_CELL_W,
  RES_CELL_H,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
} from "../../data/capacity";
import { COG, COGNITION } from "../../data/cognition";
import { STIGMERGY } from "../../data/stigmergy";
import { SCENT } from "../../data/scent";
import { CARAVAN } from "../../data/caravan";
import { BRIDGE } from "../../data/bridge";
import { SIM } from "../../data/sim";

const TAU = Math.PI * 2;

export function steer(world: World): void {
  const a = world.agents;
  const { posX, posY, energy, energyB, genes, steerX, steerY, carryState, homeGood, count } = a;
  const res = world.resources;
  const resB = world.resourceB;
  const danger = world.danger;
  const scA = world.scentA;
  const scB = world.scentB;
  const roadAtt = world.roadAttract;
  const attractPull = BRIDGE.attractPull;
  const rng = world.rng;
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;
  const maxEPerSize = SIM.maxEnergyPerSize;

  // Cognition knobs (Ant rung): `level` scales the deliberate terms against the
  // always-on wander; `mask` gates each term. Read once per pass (no per-agent alloc).
  const level = COGNITION.level;
  const mask = COGNITION.mask;
  const onFood = (mask & COG.FOOD) !== 0;
  const onKin = (mask & COG.KIN) !== 0;
  const onSep = (mask & COG.SEP) !== 0;
  const onAvoid = (mask & COG.AVOID) !== 0;
  const onWander = (mask & COG.WANDER) !== 0;
  const onDanger = (mask & COG.DANGER) !== 0;
  const onDemand = (mask & COG.DEMAND) !== 0;
  const scentWeight = SCENT.weight;
  const provFloor = SCENT.provisionFloor;
  const provSpan = 1 - provFloor;
  const travelScent = CARAVAN.travelScent;

  for (let i = 0; i < count; i++) {
    const bi = i * GENE_COUNT;
    const xi = posX[i]!;
    const yi = posY[i]!;
    const maxStore = genes[bi + GENE.SIZE]! * maxEPerSize; // shared by food (deficit) + demand (surplus)

    // --- cohesion: toward the kin centroid ---
    let cohX = 0;
    let cohY = 0;
    const kinN = a.senseKinCount[i]!;
    if (kinN > 0) {
      cohX = a.senseKinX[i]! / kinN - xi;
      cohY = a.senseKinY[i]! / kinN - yi;
      const l = Math.sqrt(cohX * cohX + cohY * cohY);
      if (l > 1e-4) {
        cohX /= l;
        cohY /= l;
      } else {
        cohX = 0;
        cohY = 0;
      }
    }

    // --- separation (already a sum of repulsions) ---
    let sepX = a.senseSepX[i]!;
    let sepY = a.senseSepY[i]!;
    {
      const l = Math.sqrt(sepX * sepX + sepY * sepY);
      if (l > 1e-4) {
        sepX /= l;
        sepY /= l;
      } else {
        sepX = 0;
        sepY = 0;
      }
    }

    // --- threat avoidance ---
    let avX = a.senseAvoidX[i]!;
    let avY = a.senseAvoidY[i]!;
    {
      const l = Math.sqrt(avX * avX + avY * avY);
      if (l > 1e-4) {
        avX /= l;
        avY /= l;
      } else {
        avX = 0;
        avY = 0;
      }
    }

    // --- resource gradient: DEFICIT-SEEKING over both nutrients (Phase 1). For each
    // nutrient the gradient points toward its richer 4-neighbor cell; each is weighted by how
    // SHORT this agent is on that nutrient (deficit 0..1), so a B-starved agent is pulled
    // toward nutrient B — across the gap toward the other region (the demand trade relieves).
    // (FOOD off => skip the samples entirely.)
    let rgx = 0;
    let rgy = 0;
    if (onFood) {
      let cx = (xi / RES_CELL_W) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= gw) cx = gw - 1;
      let cy = (yi / RES_CELL_H) | 0;
      if (cy < 0) cy = 0;
      else if (cy >= gh) cy = gh - 1;
      const xl = cx > 0 ? cx - 1 : cx;
      const xr = cx < gw - 1 ? cx + 1 : cx;
      const yu = cy > 0 ? cy - 1 : cy;
      const yd = cy < gh - 1 ? cy + 1 : cy;
      const rowc = cy * gw;
      let dA = 1 - energy[i]! / maxStore;
      if (dA < 0) dA = 0;
      else if (dA > 1) dA = 1;
      let dB = 1 - energyB[i]! / maxStore;
      if (dB < 0) dB = 0;
      else if (dB > 1) dB = 1;
      rgx = (res[rowc + xr]! - res[rowc + xl]!) * dA + (resB[rowc + xr]! - resB[rowc + xl]!) * dB;
      rgy = (res[yd * gw + cx]! - res[yu * gw + cx]!) * dA + (resB[yd * gw + cx]! - resB[yu * gw + cx]!) * dB;
      const l = Math.sqrt(rgx * rgx + rgy * rgy);
      if (l > 1e-4) {
        rgx /= l;
        rgy /= l;
      } else {
        rgx = 0;
        rgy = 0;
      }
    }

    // --- danger gradient: DESCEND (flee toward the safer of the 4-neighbor cells) ---
    // (DANGER off => skip the 4 danger-cell samples entirely)
    let dgx = 0;
    let dgy = 0;
    if (onDanger) {
      let cx = (xi / RES_CELL_W) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= gw) cx = gw - 1;
      let cy = (yi / RES_CELL_H) | 0;
      if (cy < 0) cy = 0;
      else if (cy >= gh) cy = gh - 1;
      const xl = cx > 0 ? cx - 1 : cx;
      const xr = cx < gw - 1 ? cx + 1 : cx;
      const yu = cy > 0 ? cy - 1 : cy;
      const yd = cy < gh - 1 ? cy + 1 : cy;
      const rowc = cy * gw;
      // negate the ascent gradient → point away from rising danger
      dgx = danger[rowc + xl]! - danger[rowc + xr]!;
      dgy = danger[yu * gw + cx]! - danger[yd * gw + cx]!;
      // Magnitude-sensitive: pull = min(|grad|*gain, maxPull), direction preserved.
      // Strong/fresh danger flees hard; faint/old danger is ignored (no noise amp).
      const l = Math.sqrt(dgx * dgx + dgy * dgy);
      if (l > 1e-4) {
        let pull = l * STIGMERGY.dangerGain;
        if (pull > STIGMERGY.dangerMaxPull) pull = STIGMERGY.dangerMaxPull;
        const s = pull / l;
        dgx *= s;
        dgy *= s;
      } else {
        dgx = 0;
        dgy = 0;
      }
    }

    // --- supply-scent gradient (P4a/b/c). State machine (carryState): FORAGE → climb the LACKED
    // good's scent, deficit-weighted + provisioning-gated (only the well-fed set off, P4b). RETURN →
    // climb the HOME good's scent at full strength (a committed carrier heads home with its cargo,
    // P4c). The cone is a widely-smooth STATIC beacon, so this 4-neighbour read points across the
    // barren gap where the local food gradient is zero. (DEMAND off => skip the samples.) ---
    let dmx = 0;
    let dmy = 0;
    let scentGate = 0;
    let raX = 0; // road-attraction gradient (committed carriers converge onto the nearest lane)
    let raY = 0;
    if (onDemand) {
      let cx = (xi / RES_CELL_W) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= gw) cx = gw - 1;
      let cy = (yi / RES_CELL_H) | 0;
      if (cy < 0) cy = 0;
      else if (cy >= gh) cy = gh - 1;
      const xl = cx > 0 ? cx - 1 : cx;
      const xr = cx < gw - 1 ? cx + 1 : cx;
      const yu = cy > 0 ? cy - 1 : cy;
      const yd = cy < gh - 1 ? cy + 1 : cy;
      const rowc = cy * gw;
      let sA: number;
      let sB: number;
      if (carryState[i]! === 0) {
        // FORAGE: deficit-weighted toward what you lack; gated by reserve (provisioning, P4b).
        sA = 1 - energy[i]! / maxStore;
        if (sA < 0) sA = 0;
        else if (sA > 1) sA = 1;
        sB = 1 - energyB[i]! / maxStore;
        if (sB < 0) sB = 0;
        else if (sB > 1) sB = 1;
        const reserve = (energy[i]! + energyB[i]!) / (2 * maxStore);
        const g = (reserve - provFloor) / provSpan;
        scentGate = g < 0 ? 0 : g > 1 ? 1 : g;
      } else {
        // Committed crossing (full gate): OUTBOUND (2) climbs the AWAY good's scent, RETURN (1) climbs
        // the HOME good's scent. seekA = does this leg seek nutrient A?
        const seekHome = carryState[i]! === 1;
        const seekA = (homeGood[i]! === 0) === seekHome;
        sA = seekA ? 1 : 0;
        sB = seekA ? 0 : 1;
        scentGate = 1;
        // Road attraction (committed only): ascend the roadAttract basin toward the nearest lane. The
        // supply-scent (below) then carries the carrier ALONG the lane; on the lane the basin is ~flat
        // so it doesn't stall the crossing. "All agents use the bridge."
        raX = roadAtt[rowc + xr]! - roadAtt[rowc + xl]!;
        raY = roadAtt[yd * gw + cx]! - roadAtt[yu * gw + cx]!;
        const rl = Math.sqrt(raX * raX + raY * raY);
        if (rl > 1e-4) {
          raX /= rl;
          raY /= rl;
        } else {
          raX = 0;
          raY = 0;
        }
      }
      dmx = (scA[rowc + xr]! - scA[rowc + xl]!) * sA + (scB[rowc + xr]! - scB[rowc + xl]!) * sB;
      dmy = (scA[yd * gw + cx]! - scA[yu * gw + cx]!) * sA + (scB[yd * gw + cx]! - scB[yu * gw + cx]!) * sB;
      const l = Math.sqrt(dmx * dmx + dmy * dmy);
      if (l > 1e-4) {
        dmx /= l;
        dmy /= l;
      } else {
        dmx = 0;
        dmy = 0;
      }
    }

    // --- wander: a seeded unit vector. Always advance the shared RNG stream so it
    // stays deterministic regardless of the WANDER toggle; gate the contribution. ---
    const ang = rng.next() * TAU;
    const wx = Math.cos(ang);
    const wy = Math.sin(ang);

    // --- weighted blend (Genes × level; mask gates each term, wander unscaled) ---
    // A COMMITTED carrier (OUTBOUND/RETURN) becomes a lone traveller: kin-cohesion and local foraging
    // are suppressed so it detaches from the home pack and beelines on the scent across the gap (the
    // probe showed flag-only commitment is outvoted ~2:1 by cohesion+food and never crosses). Separation
    // + danger-avoid stay on (don't pile up, don't walk into death zones). P4c.
    const committed = carryState[i]! !== 0;
    const kc = onKin && !committed ? genes[bi + GENE.KIN_COHESION]! * level : 0;
    const se = onSep ? genes[bi + GENE.SEPARATION]! * level : 0;
    const ra = onFood && !committed ? genes[bi + GENE.RESOURCE_ATTRACT]! * level : 0;
    const ta = onAvoid ? genes[bi + GENE.THREAT_AVOID]! * level : 0;
    // danger descent shares the THREAT_AVOID gene (fearfulness); aggressive lineages
    // evolve low THREAT_AVOID → ignore death zones (the doc's aggression-gating).
    const da = onDanger ? genes[bi + GENE.THREAT_AVOID]! * level : 0;
    // scent shares the RESOURCE_ATTRACT gene (foraging drive). Forage: × SCENT.weight × provisioning
    // ramp (P4b). Committed: × CARAVAN.travelScent (dominates, scentGate is already 1) so the lone
    // traveller actually crosses (P4c).
    const dm = onDemand ? genes[bi + GENE.RESOURCE_ATTRACT]! * level * (committed ? travelScent : scentWeight * scentGate) : 0;
    // road attraction: a committed carrier converges onto the nearest road lane (universal × level, not
    // gene-scaled — every carrier uses the bridge). Composes with dm (scent moves it along the lane).
    const rp = onDemand && committed ? attractPull * level : 0;
    const wa = onWander ? genes[bi + GENE.WANDER]! : 0;

    let dx = kc * cohX + se * sepX + ra * rgx + ta * avX + da * dgx + dm * dmx + rp * raX + wa * wx;
    let dy = kc * cohY + se * sepY + ra * rgy + ta * avY + da * dgy + dm * dmy + rp * raY + wa * wy;

    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1e-4) {
      dx /= l;
      dy /= l;
    } else {
      dx = 0;
      dy = 0;
    }
    steerX[i] = dx;
    steerY[i] = dy;
  }
}
