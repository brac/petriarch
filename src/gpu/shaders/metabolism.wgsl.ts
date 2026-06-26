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
const GENE_COUNT = 15u;
const G_SIZE     = 0u;
const G_MR       = 1u;
const G_LIFESPAN = 3u;

struct Params {
  count            : u32,
  resGridW         : u32,
  resGridH         : u32,
  hazActive        : u32,
  dt               : f32,
  baseDrain        : f32,
  sizeDrain        : f32,
  moveCost         : f32,
  senescenceDrain  : f32,
  hazardDrain      : f32,
  intakeRate       : f32,
  intakeSizeExp    : f32,
  maxEnergyPerSize : f32,
  resCellW         : f32,
  resCellH         : f32,
  hzX              : f32,
  hzY              : f32,
  hzR2             : f32,
  _p0              : f32,
  _p1              : f32,
};

@group(0) @binding(0) var<uniform>             P      : Params;
@group(0) @binding(1) var<storage, read>       posX   : array<f32>;
@group(0) @binding(2) var<storage, read>       posY   : array<f32>;
@group(0) @binding(3) var<storage, read>       velX   : array<f32>;
@group(0) @binding(4) var<storage, read>       velY   : array<f32>;
@group(0) @binding(5) var<storage, read>       genes  : array<f32>;
@group(0) @binding(6) var<storage, read_write> energy : array<f32>;
@group(0) @binding(7) var<storage, read_write> age    : array<f32>;
@group(0) @binding(8) var<storage, read_write> res    : array<atomic<u32>>;

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

  let ag = age[i] + P.dt;
  age[i] = ag;

  let vx = velX[i];
  let vy = velY[i];
  let speed = sqrt(vx * vx + vy * vy);

  var drain = P.baseDrain + (size * P.sizeDrain + speed * size * P.moveCost) * mr;

  let onset = lifespan * 0.8;
  if (ag > onset) {
    drain = drain + P.senescenceDrain * ((ag - onset) / (lifespan * 0.2 + 1e-3));
  }

  if (P.hazActive != 0u) {
    let dx = posX[i] - P.hzX;
    let dy = posY[i] - P.hzY;
    if (dx * dx + dy * dy < P.hzR2) { drain = drain + P.hazardDrain; }
  }

  var e = energy[i] - drain;

  // --- intake from the resource cell underfoot (atomic CAS-clamp) ---
  let maxE = size * P.maxEnergyPerSize;
  let room = maxE - e;
  if (room > 0.0) {
    var intakeBase = select(P.intakeRate * pow(size, P.intakeSizeExp), P.intakeRate * size, P.intakeSizeExp == 1.0);
    let desired = min(intakeBase, room);
    if (desired > 0.0) {
      let c = resCell(posX[i], posY[i]);
      loop {
        let oldBits = atomicLoad(&res[c]);
        let oldVal = bitcast<f32>(oldBits);
        if (oldVal <= 0.0) { break; }
        let g = min(desired, oldVal);
        let r = atomicCompareExchangeWeak(&res[c], oldBits, bitcast<u32>(oldVal - g));
        if (r.exchanged) { e = e + g; break; }
      }
    }
  }

  energy[i] = e;
}
`;
