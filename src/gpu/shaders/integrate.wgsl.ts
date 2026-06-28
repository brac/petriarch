// Tier A — the GPU port of sim/tierA/integrate.ts. Pure per-agent physics (no
// neighbors, no RNG): accelerate velocity toward the cached steer target, clamp to a
// gene-derived max speed, move, reflect off world bounds. Reads the steer vector
// (stride 2) and genes; reads AND writes positions/velocities IN PLACE — each
// invocation touches only its own index, so this is hazard-free and lets the resident
// Tier A chain feed the moved positions straight into metabolism (matching the CPU
// pass order integrate → metabolism).

export const INTEGRATE_WGSL = /* wgsl */ `
const GENE_COUNT = 17u;
const G_SIZE = 0u;
const G_MR   = 1u;
const G_EFF  = 16u; // EFFICIENCY

struct Params {
  count           : u32,
  accel           : f32,
  bounce          : f32,
  worldW          : f32,
  worldH          : f32,
  sizeSpeedK      : f32,
  baseMaxSpeed    : f32,
  dt              : f32,
  effSpeedPenalty : f32,
  resGridW        : u32,
  resGridH        : u32,
  resCellW        : f32,
  resCellH        : f32,
  passBlock       : f32, // target cost >= this → impassable (ocean/wall)
  _p0             : f32,
  _p1             : f32,
};

@group(0) @binding(0) var<uniform>             P           : Params;
@group(0) @binding(1) var<storage, read_write> posX        : array<f32>;
@group(0) @binding(2) var<storage, read_write> posY        : array<f32>;
@group(0) @binding(3) var<storage, read_write> velX        : array<f32>;
@group(0) @binding(4) var<storage, read_write> velY        : array<f32>;
@group(0) @binding(5) var<storage, read>       steer       : array<f32>;
@group(0) @binding(6) var<storage, read>       genes       : array<f32>;
@group(0) @binding(7) var<storage, read>       passability : array<f32>;

@compute @workgroup_size(64)
fn integrateMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }

  let bi = i * GENE_COUNT;
  let size = genes[bi + G_SIZE];
  let mr = genes[bi + G_MR];
  let efficiency = genes[bi + G_EFF];
  let k = P.sizeSpeedK;
  let maxSpeed = ((P.baseMaxSpeed * (0.4 + 0.6 * mr)) / (1.0 - k + k * size)) * (1.0 - P.effSpeedPenalty * efficiency);

  let dvx = steer[i * 2u + 0u] * maxSpeed;
  let dvy = steer[i * 2u + 1u] * maxSpeed;

  let vx0 = velX[i];
  let vy0 = velY[i];
  var vx = vx0 + (dvx - vx0) * P.accel * P.dt;
  var vy = vy0 + (dvy - vy0) * P.accel * P.dt;

  let sp2 = vx * vx + vy * vy;
  let ms2 = maxSpeed * maxSpeed;
  if (sp2 > ms2 && sp2 > 1e-6) {
    let s = maxSpeed / sqrt(sp2);
    vx = vx * s;
    vy = vy * s;
  }

  var nx = posX[i] + vx * P.dt;
  var ny = posY[i] + vy * P.dt;

  if (nx < 0.0) { nx = 0.0; vx = -vx * P.bounce; }
  else if (nx > P.worldW) { nx = P.worldW; vx = -vx * P.bounce; }
  if (ny < 0.0) { ny = 0.0; vy = -vy * P.bounce; }
  else if (ny > P.worldH) { ny = P.worldH; vy = -vy * P.bounce; }

  // Passability (mirror of CPU integrate): sample the target cell's movement cost. An
  // ocean/wall (cost >= passBlock) is impassable — stay put and reflect off the coast.
  // Costed terrain (cost != 1) scales the step: <1 road (faster), >1 swamp (slower).
  // Default all-1 field → both branches are no-ops, so this matches the CPU pass exactly.
  let gw = i32(P.resGridW);
  let gh = i32(P.resGridH);
  let cx = clamp(i32(floor(nx / P.resCellW)), 0, gw - 1);
  let cy = clamp(i32(floor(ny / P.resCellH)), 0, gh - 1);
  let cost = passability[u32(cy * gw + cx)];
  if (cost >= P.passBlock) {
    nx = posX[i];
    ny = posY[i];
    vx = -vx * P.bounce;
    vy = -vy * P.bounce;
  } else if (cost != 1.0) {
    let s = 1.0 / cost;
    nx = posX[i] + (nx - posX[i]) * s;
    ny = posY[i] + (ny - posY[i]) * s;
    nx = clamp(nx, 0.0, P.worldW);
    ny = clamp(ny, 0.0, P.worldH);
  }

  posX[i] = nx;
  posY[i] = ny;
  velX[i] = vx;
  velY[i] = vy;
}
`;
