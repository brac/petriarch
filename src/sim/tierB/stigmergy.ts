// Tier B — CPU, symbolic/stateful. Field evolution stays on the CPU (like resources):
// the GPU never evolves grid fields, it only reads them. The `claim` (territory) field
// is continuous signature-accumulation — each cell holds a presence magnitude plus the
// presence-weighted signature vector. Every tick: agents DEPOSIT into their cell, then
// all four accumulators DIFFUSE (4-neighbor blend) and DECAY (fade) with identical
// rates, so mean signature (claimSig/claimMag → the tribe's hue) is preserved while the
// magnitude slowly fades. Render-only for now (netRenderer.drawClaim).

import type { World } from "../../state/world";
import { GENE, GENE_COUNT } from "../../data/genome";
import { STIGMERGY } from "../../data/stigmergy";
import { AMITY } from "../../data/amity";
import { TRAIL } from "../../data/trail";
import { RESOURCES } from "../../data/resources";
import { resCellIndex } from "../grid";
import { RESOURCE_GRID_W, RESOURCE_GRID_H } from "../../data/capacity";

const GW = RESOURCE_GRID_W;
const GH = RESOURCE_GRID_H;
const N = GW * GH;

// Preallocated diffuse back-buffer (neighbor reads can't be done in place). Reused
// across all four fields each tick — zero per-tick allocation.
const scratch = new Float32Array(N);

export function stigmergy(world: World): void {
  const a = world.agents;
  const { posX, posY, genes, count } = a;
  const mag = world.claimMag;
  const sa = world.claimSigA;
  const sb = world.claimSigB;
  const sc = world.claimSigC;

  // --- deposit: each agent stamps its cell with presence + its signature (claim); a committed
  // CARRIER also stamps the trail channel (P4d) — its path lights up as a caravan route ---
  const d = STIGMERGY.claimDeposit;
  const td = TRAIL.deposit;
  const trail = world.trail;
  const carryState = a.carryState;
  const capA = world.resourceCap;
  const capB = world.resourceCapB;
  const invCap = 1 / RESOURCES.cellCapacity;
  for (let i = 0; i < count; i++) {
    const c = resCellIndex(posX[i]!, posY[i]!);
    const bi = i * GENE_COUNT;
    mag[c] = mag[c]! + d;
    sa[c] = sa[c]! + d * genes[bi + GENE.SIG_A]!;
    sb[c] = sb[c]! + d * genes[bi + GENE.SIG_B]!;
    sc[c] = sc[c]! + d * genes[bi + GENE.SIG_C]!;
    // OUTBOUND/RETURN carriers draw the route — but WEIGHTED BY LOCAL BARRENNESS so it lights up the
    // DEAD-ZONE crossing and fades in the fed home regions ("trading over a dead zone", P4d). This also
    // keeps the route gold (gap) spatially clear of the amity gold (regions) so they don't blend.
    if (carryState[i]! !== 0) {
      const fed = (capA[c]! + capB[c]!) * invCap;
      const barren = fed >= 1 ? 0 : 1 - fed;
      // SQUARED so the route concentrates in the TRULY dead center (the gap) and drops out of the
      // regions' barren sub-patches between food clumps — a crisp crossing, not a map-wide gold wash.
      if (barren > 0) trail[c] = trail[c]! + td * barren * barren;
    }
  }

  // --- claim diffuse + decay (identical rates on all four → mean signature preserved) ---
  const k = STIGMERGY.claimDiffuse;
  const decay = STIGMERGY.claimDecay;
  diffuseDecay(mag, k, decay);
  diffuseDecay(sa, k, decay);
  diffuseDecay(sb, k, decay);
  diffuseDecay(sc, k, decay);

  // --- danger diffuse + decay (deposit is event-driven, in death.ts) ---
  diffuseDecay(world.danger, STIGMERGY.dangerDiffuse, STIGMERGY.dangerDecay);

  // --- amity diffuse + decay (deposit is event-driven, in trade.ts) ---
  diffuseDecay(world.amity, AMITY.diffuse, AMITY.decay);
  // --- trail diffuse + decay (deposited above by committed carriers; render-only, P4d) ---
  diffuseDecay(trail, TRAIL.diffuse, TRAIL.decay);
  // (supply-scent is STATIC — built once in init.ts buildScent, not evolved per tick.)
}

// next = ((1-k)*cur + k*avg4(neighbors)) * decay, edges clamped. Writes via scratch
// so neighbor reads see the pre-diffuse field, then copies back into `field`.
function diffuseDecay(field: Float32Array, k: number, decay: number): void {
  const km = 1 - k;
  for (let cy = 0; cy < GH; cy++) {
    const row = cy * GW;
    const up = cy > 0 ? row - GW : row;
    const dn = cy < GH - 1 ? row + GW : row;
    for (let cx = 0; cx < GW; cx++) {
      const idx = row + cx;
      const xl = cx > 0 ? idx - 1 : idx;
      const xr = cx < GW - 1 ? idx + 1 : idx;
      const avg4 = (field[xl]! + field[xr]! + field[up + cx]! + field[dn + cx]!) * 0.25;
      scratch[idx] = (km * field[idx]! + k * avg4) * decay;
    }
  }
  field.set(scratch);
}
