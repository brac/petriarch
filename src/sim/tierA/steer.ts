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

const TAU = Math.PI * 2;

export function steer(world: World): void {
  const a = world.agents;
  const { posX, posY, genes, steerX, steerY, count } = a;
  const res = world.resources;
  const danger = world.danger;
  const rng = world.rng;
  const gw = RESOURCE_GRID_W;
  const gh = RESOURCE_GRID_H;

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

  for (let i = 0; i < count; i++) {
    const bi = i * GENE_COUNT;
    const xi = posX[i]!;
    const yi = posY[i]!;

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

    // --- resource gradient: toward the richer of the 4-neighbor cells ---
    // (FOOD off => skip the 4 resource-cell samples entirely)
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
      rgx = res[rowc + xr]! - res[rowc + xl]!;
      rgy = res[yd * gw + cx]! - res[yu * gw + cx]!;
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

    // --- wander: a seeded unit vector. Always advance the shared RNG stream so it
    // stays deterministic regardless of the WANDER toggle; gate the contribution. ---
    const ang = rng.next() * TAU;
    const wx = Math.cos(ang);
    const wy = Math.sin(ang);

    // --- weighted blend (Genes × level; mask gates each term, wander unscaled) ---
    const kc = onKin ? genes[bi + GENE.KIN_COHESION]! * level : 0;
    const se = onSep ? genes[bi + GENE.SEPARATION]! * level : 0;
    const ra = onFood ? genes[bi + GENE.RESOURCE_ATTRACT]! * level : 0;
    const ta = onAvoid ? genes[bi + GENE.THREAT_AVOID]! * level : 0;
    // danger descent shares the THREAT_AVOID gene (fearfulness); aggressive lineages
    // evolve low THREAT_AVOID → ignore death zones (the doc's aggression-gating).
    const da = onDanger ? genes[bi + GENE.THREAT_AVOID]! * level : 0;
    const wa = onWander ? genes[bi + GENE.WANDER]! : 0;

    let dx = kc * cohX + se * sepX + ra * rgx + ta * avX + da * dgx + wa * wx;
    let dy = kc * cohY + se * sepY + ra * rgy + ta * avY + da * dgy + wa * wy;

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
