// Tier A — the GPU port of sim/tierA/metabolism.ts. Per agent: age, drain energy
// (baseline + size + movement, scaled by metabolism; plus senescence past 80% of
// lifespan and any active hazard), then take intake from the resource cell underfoot.
//
// The drain + age half is pure per-agent and matches the CPU exactly. The intake is
// the one SHARED write in the whole Tier A set: many agents on one cell deplete it.
// WGSL has no atomic float, so the resource buffer is treated as atomic<u32> holding
// f32 bit patterns (the SAME bytes steer reads as array<f32>), and intake is a
// CAS-clamp loop: read current, take g = min(desired, current), compare-exchange the
// reduced value, retry on contention. This conserves resources (energy granted ==
// resource removed) but is ORDER-DEPENDENT under contention — which agent wins scarce
// resource differs from the CPU's index order (the GPU determinism domain). With
// plentiful supply (avail never binds) every agent gets its full gain → exact match.

export const METABOLISM_WGSL = /* wgsl */ `
const GENE_COUNT = 17u;
const G_SIZE     = 0u;
const G_MR       = 1u;
const G_LIFESPAN = 3u;
const G_RES      = 15u; // RESILIENCE
const G_EFF      = 16u; // EFFICIENCY

struct Params {
  count              : u32,
  resGridW           : u32,
  resGridH           : u32,
  hazActive          : u32,
  dt                 : f32,
  baseDrain          : f32,
  sizeDrain          : f32,
  moveCost           : f32,
  senescenceDrain    : f32,
  hazardDrain        : f32,
  intakeRate         : f32,
  intakeSizeExp      : f32,
  maxEnergyPerSize   : f32,
  resCellW           : f32,
  resCellH           : f32,
  hzX                : f32,
  hzY                : f32,
  hzR2               : f32,
  resMovePenalty     : f32,
  resHazardReduction : f32,
  effIntakeBonus     : f32,
  _p0                : f32,
  _p1                : f32,
  _p2                : f32,
};

@group(0) @binding(0) var<uniform>             P      : Params;
@group(0) @binding(1) var<storage, read>       posX   : array<f32>;
@group(0) @binding(2) var<storage, read>       posY   : array<f32>;
@group(0) @binding(3) var<storage, read>       velX   : array<f32>;
@group(0) @binding(4) var<storage, read>       velY   : array<f32>;
@group(0) @binding(5) var<storage, read>       genes  : array<f32>;
@group(0) @binding(6) var<storage, read_write> energy  : array<f32>;
@group(0) @binding(7) var<storage, read_write> age     : array<f32>;
@group(0) @binding(8) var<storage, read_write> res     : array<atomic<u32>>;
@group(0) @binding(9) var<storage, read_write> energyB : array<f32>;            // nutrient-B store
@group(0) @binding(10) var<storage, read_write> resB   : array<atomic<u32>>;    // nutrient-B field

fn resCell(x: f32, y: f32) -> u32 {
  let cx = clamp(i32(floor(x / P.resCellW)), 0, i32(P.resGridW) - 1);
  let cy = clamp(i32(floor(y / P.resCellH)), 0, i32(P.resGridH) - 1);
  return u32(cy) * P.resGridW + u32(cx);
}

@compute @workgroup_size(64)
fn metabolismMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }

  let bi = i * GENE_COUNT;
  let size = genes[bi + G_SIZE];
  let mr = genes[bi + G_MR];
  let lifespan = genes[bi + G_LIFESPAN];
  let resilience = genes[bi + G_RES];
  let efficiency = genes[bi + G_EFF];

  let ag = age[i] + P.dt;
  age[i] = ag;

  let vx = velX[i];
  let vy = velY[i];
  let speed = sqrt(vx * vx + vy * vy);

  // RESILIENCE makes movement heavier (its cost).
  let moveDrain = speed * size * P.moveCost * (1.0 + P.resMovePenalty * resilience);
  var drain = P.baseDrain + (size * P.sizeDrain + moveDrain) * mr;

  let onset = lifespan * 0.8;
  if (ag > onset) {
    drain = drain + P.senescenceDrain * ((ag - onset) / (lifespan * 0.2 + 1e-3));
  }

  if (P.hazActive != 0u) {
    let dx = posX[i] - P.hzX;
    let dy = posY[i] - P.hzY;
    if (dx * dx + dy * dy < P.hzR2) {
      drain = drain + P.hazardDrain * (1.0 - P.resHazardReduction * resilience); // armored
    }
  }

  // Dual-nutrient diet: split the drain PROPORTIONALLY across the two stores (you burn what
  // you have; survival rides on the sum — death.ts on the CPU). Mirrors CPU metabolism.ts.
  var eA = energy[i];
  var eB = energyB[i];
  let tot = eA + eB;
  if (tot > 1e-6) {
    eA = eA - drain * (eA / tot);
    eB = eB - drain * (eB / tot);
  } else {
    eA = eA - drain;
  }

  // --- intake (atomic CAS-clamp) of EACH nutrient into its store ---
  let maxE = size * P.maxEnergyPerSize;
  let effGain = 1.0 + P.effIntakeBonus * efficiency;
  let baseTake = select(P.intakeRate * pow(size, P.intakeSizeExp), P.intakeRate * size, P.intakeSizeExp == 1.0);
  let c = resCell(posX[i], posY[i]);

  let roomA = maxE - eA;
  if (roomA > 0.0) {
    let desiredTake = min(baseTake, roomA / effGain);
    if (desiredTake > 0.0) {
      loop {
        let oldBits = atomicLoad(&res[c]);
        let oldVal = bitcast<f32>(oldBits);
        if (oldVal <= 0.0) { break; }
        let take = min(desiredTake, oldVal);
        let r = atomicCompareExchangeWeak(&res[c], oldBits, bitcast<u32>(oldVal - take));
        if (r.exchanged) { eA = eA + take * effGain; break; }
      }
    }
  }
  let roomB = maxE - eB;
  if (roomB > 0.0) {
    let desiredTake = min(baseTake, roomB / effGain);
    if (desiredTake > 0.0) {
      loop {
        let oldBits = atomicLoad(&resB[c]);
        let oldVal = bitcast<f32>(oldBits);
        if (oldVal <= 0.0) { break; }
        let take = min(desiredTake, oldVal);
        let r = atomicCompareExchangeWeak(&resB[c], oldBits, bitcast<u32>(oldVal - take));
        if (r.exchanged) { eB = eB + take * effGain; break; }
      }
    }
  }

  energy[i] = eA;
  energyB[i] = eB;
}
`;
