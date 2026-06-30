// Tier A — the GPU port of sim/tierA/steer.ts. Per agent: turn the sensed aggregates
// (kin centroid / separation / threat, read from the resident senseOut buffer) plus a
// resource-gradient pull and a wander term into one unit steering direction, weighted
// by the behavior genes. Output is two floats per agent (stride 2) consumed by the
// integrate kernel next.
//
// Wander is the one term that cannot match the CPU bit-for-bit: the CPU advances a
// single shared mulberry32 once per agent in index order, which a parallel kernel
// can't replicate. Per docs/webgpu-migration, the GPU is its OWN seeded determinism
// domain — here a per-agent hash RNG (seeded by index + a per-frame seed). The verify
// neutralizes wander (WANDER gene zeroed on both sides) to check the deterministic
// blend exactly; the wander term's distribution is validated separately.
//
// senseOut interleave (stride 7): [kinX, kinY, kinCount, sepX, sepY, avoidX, avoidY].

export const STEER_WGSL = /* wgsl */ `
const GENE_COUNT = 18u;
const G_SIZE = 0u; // body size → max store per nutrient (deficit-seeking)
const G_KC = 6u;   // KIN_COHESION
const G_SE = 7u;   // SEPARATION
const G_RA = 8u;   // RESOURCE_ATTRACT
const G_TA = 9u;   // THREAT_AVOID
const G_WA = 10u;  // WANDER
const SENSE_STRIDE = 7u;
const TAU = 6.2831853071795864;

// Cognition term bits (must match src/data/cognition.ts COG.*)
const COG_FOOD   = 1u;
const COG_KIN    = 2u;
const COG_SEP    = 4u;
const COG_AVOID  = 8u;
const COG_WANDER = 16u;
const COG_DANGER = 32u;
const COG_DEMAND = 64u; // long-range supply-scent climb (P4a)

struct Params {
  count    : u32,
  resGridW : u32,
  resGridH : u32,
  seed     : u32,   // per-frame wander seed (GPU determinism domain)
  resCellW : f32,
  resCellH : f32,
  cogLevel : f32,   // [0,1] global ceiling on deliberate terms (Ant rung)
  cogMask  : u32,   // enabled-term bitmask
  dangerGain    : f32, // danger |gradient| → pull slope (magnitude-sensitive)
  dangerMaxPull : f32, // danger pull ceiling
  maxEnergyPerSize : f32, // store cap per nutrient = SIZE·this (deficit-seeking)
  scentWeight : f32, // long-range supply-scent pull strength (P4a)
  provisionFloor : f32, // P4b: reserve floor below which an agent won't undertake the crossing
};

@group(0) @binding(0) var<uniform>             P        : Params;
@group(0) @binding(1) var<storage, read>       posX     : array<f32>;
@group(0) @binding(2) var<storage, read>       posY     : array<f32>;
@group(0) @binding(3) var<storage, read>       genes    : array<f32>;
@group(0) @binding(4) var<storage, read>       senseOut : array<f32>;
@group(0) @binding(5) var<storage, read>       res      : array<f32>;
@group(0) @binding(6) var<storage, read_write> steerOut : array<f32>;
@group(0) @binding(7) var<storage, read>       danger   : array<f32>;
@group(0) @binding(8) var<storage, read>       resB     : array<f32>;  // nutrient-B field
@group(0) @binding(9) var<storage, read>       energy   : array<f32>;  // nutrient-A store
@group(0) @binding(10) var<storage, read>      energyB  : array<f32>;  // nutrient-B store
// Packed supply-scent: scentA in [0, nCells), scentB in [nCells, 2·nCells) (P4a; static).
@group(0) @binding(11) var<storage, read>      scent    : array<f32>;

fn hashU32(x: u32) -> u32 {
  var v = x;
  v = v ^ 61u ^ (v >> 16u);
  v = v + (v << 3u);
  v = v ^ (v >> 4u);
  v = v * 0x27d4eb2du;
  v = v ^ (v >> 15u);
  return v;
}

@compute @workgroup_size(64)
fn steerMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }

  let xi = posX[i];
  let yi = posY[i];
  let o = i * SENSE_STRIDE;

  // --- cohesion: toward the kin centroid ---
  var cohX = 0.0;
  var cohY = 0.0;
  let kinN = senseOut[o + 2u];
  if (kinN > 0.0) {
    cohX = senseOut[o + 0u] / kinN - xi;
    cohY = senseOut[o + 1u] / kinN - yi;
    let l = sqrt(cohX * cohX + cohY * cohY);
    if (l > 1e-4) { cohX = cohX / l; cohY = cohY / l; } else { cohX = 0.0; cohY = 0.0; }
  }

  // --- separation (already a sum of repulsions) ---
  var sepX = senseOut[o + 3u];
  var sepY = senseOut[o + 4u];
  {
    let l = sqrt(sepX * sepX + sepY * sepY);
    if (l > 1e-4) { sepX = sepX / l; sepY = sepY / l; } else { sepX = 0.0; sepY = 0.0; }
  }

  // --- threat avoidance ---
  var avX = senseOut[o + 5u];
  var avY = senseOut[o + 6u];
  {
    let l = sqrt(avX * avX + avY * avY);
    if (l > 1e-4) { avX = avX / l; avY = avY / l; } else { avX = 0.0; avY = 0.0; }
  }

  // --- resource gradient: DEFICIT-SEEKING over both nutrients (mirrors CPU steer.ts). Each
  // nutrient's 4-neighbor gradient is weighted by how short this agent is on it, so a
  // B-starved agent is pulled toward nutrient B. (FOOD off skips the reads.)
  let onFood = (P.cogMask & COG_FOOD) != 0u;
  var rgx = 0.0;
  var rgy = 0.0;
  if (onFood) {
    let gw = i32(P.resGridW);
    let gh = i32(P.resGridH);
    var cx = clamp(i32(floor(xi / P.resCellW)), 0, gw - 1);
    var cy = clamp(i32(floor(yi / P.resCellH)), 0, gh - 1);
    let xl = select(cx, cx - 1, cx > 0);
    let xr = select(cx, cx + 1, cx < gw - 1);
    let yu = select(cy, cy - 1, cy > 0);
    let yd = select(cy, cy + 1, cy < gh - 1);
    let rowc = cy * gw;
    let maxStore = genes[i * GENE_COUNT + G_SIZE] * P.maxEnergyPerSize;
    let dA = clamp(1.0 - energy[i] / maxStore, 0.0, 1.0);
    let dB = clamp(1.0 - energyB[i] / maxStore, 0.0, 1.0);
    rgx = (res[u32(rowc + xr)] - res[u32(rowc + xl)]) * dA + (resB[u32(rowc + xr)] - resB[u32(rowc + xl)]) * dB;
    rgy = (res[u32(yd * gw + cx)] - res[u32(yu * gw + cx)]) * dA + (resB[u32(yd * gw + cx)] - resB[u32(yu * gw + cx)]) * dB;
    let l = sqrt(rgx * rgx + rgy * rgy);
    if (l > 1e-4) { rgx = rgx / l; rgy = rgy / l; } else { rgx = 0.0; rgy = 0.0; }
  }

  // --- danger gradient: DESCEND (flee toward the safer of the 4-neighbor cells) ---
  let onDanger = (P.cogMask & COG_DANGER) != 0u;
  var dgx = 0.0;
  var dgy = 0.0;
  if (onDanger) {
    let gw = i32(P.resGridW);
    let gh = i32(P.resGridH);
    var cx = clamp(i32(floor(xi / P.resCellW)), 0, gw - 1);
    var cy = clamp(i32(floor(yi / P.resCellH)), 0, gh - 1);
    let xl = select(cx, cx - 1, cx > 0);
    let xr = select(cx, cx + 1, cx < gw - 1);
    let yu = select(cy, cy - 1, cy > 0);
    let yd = select(cy, cy + 1, cy < gh - 1);
    let rowc = cy * gw;
    // negate the ascent gradient → point away from rising danger
    dgx = danger[u32(rowc + xl)] - danger[u32(rowc + xr)];
    dgy = danger[u32(yu * gw + cx)] - danger[u32(yd * gw + cx)];
    // magnitude-sensitive: pull = min(|grad|*gain, maxPull), direction preserved
    let l = sqrt(dgx * dgx + dgy * dgy);
    if (l > 1e-4) {
      let pull = min(l * P.dangerGain, P.dangerMaxPull);
      let s = pull / l;
      dgx = dgx * s; dgy = dgy * s;
    } else { dgx = 0.0; dgy = 0.0; }
  }

  // --- supply-scent gradient: long-range pull toward where the LACKED nutrient grows (P4a;
  // mirrors CPU steer.ts). Climb scentX weighted by deficit of X; scent is a static cone that
  // reaches across the barren gap where the local food gradient is zero. (DEMAND off skips it.)
  let onDemand = (P.cogMask & COG_DEMAND) != 0u;
  var dmx = 0.0;
  var dmy = 0.0;
  if (onDemand) {
    let gw = i32(P.resGridW);
    let gh = i32(P.resGridH);
    let nCells = u32(gw * gh);
    var cx = clamp(i32(floor(xi / P.resCellW)), 0, gw - 1);
    var cy = clamp(i32(floor(yi / P.resCellH)), 0, gh - 1);
    let xl = select(cx, cx - 1, cx > 0);
    let xr = select(cx, cx + 1, cx < gw - 1);
    let yu = select(cy, cy - 1, cy > 0);
    let yd = select(cy, cy + 1, cy < gh - 1);
    let rowc = cy * gw;
    let maxStore = genes[i * GENE_COUNT + G_SIZE] * P.maxEnergyPerSize;
    let sA = clamp(1.0 - energy[i] / maxStore, 0.0, 1.0);
    let sB = clamp(1.0 - energyB[i] / maxStore, 0.0, 1.0);
    dmx = (scent[u32(rowc + xr)] - scent[u32(rowc + xl)]) * sA
        + (scent[nCells + u32(rowc + xr)] - scent[nCells + u32(rowc + xl)]) * sB;
    dmy = (scent[u32(yd * gw + cx)] - scent[u32(yu * gw + cx)]) * sA
        + (scent[nCells + u32(yd * gw + cx)] - scent[nCells + u32(yu * gw + cx)]) * sB;
    let l = sqrt(dmx * dmx + dmy * dmy);
    if (l > 1e-4) { dmx = dmx / l; dmy = dmy / l; } else { dmx = 0.0; dmy = 0.0; }
  }

  // --- wander: a per-agent seeded unit vector (GPU determinism domain) ---
  let h = hashU32((i * 2654435761u) ^ P.seed);
  let ang = (f32(h) / 4294967296.0) * TAU;
  let wx = cos(ang);
  let wy = sin(ang);

  // --- weighted blend (Genes × level; mask gates each term, wander unscaled) ---
  let lvl = P.cogLevel;
  let bi = i * GENE_COUNT;
  let kc = select(0.0, genes[bi + G_KC] * lvl, (P.cogMask & COG_KIN) != 0u);
  let se = select(0.0, genes[bi + G_SE] * lvl, (P.cogMask & COG_SEP) != 0u);
  let ra = select(0.0, genes[bi + G_RA] * lvl, onFood);
  let ta = select(0.0, genes[bi + G_TA] * lvl, (P.cogMask & COG_AVOID) != 0u);
  // danger descent shares THREAT_AVOID (fearfulness); aggressive lineages evolve low
  // THREAT_AVOID → ignore death zones.
  let da = select(0.0, genes[bi + G_TA] * lvl, onDanger);
  // scent shares RESOURCE_ATTRACT (foraging drive) × level × scentWeight × provisioning gate (P4b:
  // only a well-fed agent crosses), mirrors CPU steer.ts.
  var dm = 0.0;
  if (onDemand) {
    let maxStore = genes[bi + G_SIZE] * P.maxEnergyPerSize;
    let reserve = (energy[i] + energyB[i]) / (2.0 * maxStore);
    let gate = clamp((reserve - P.provisionFloor) / (1.0 - P.provisionFloor), 0.0, 1.0);
    dm = genes[bi + G_RA] * lvl * P.scentWeight * gate;
  }
  let wa = select(0.0, genes[bi + G_WA], (P.cogMask & COG_WANDER) != 0u);

  var dx = kc * cohX + se * sepX + ra * rgx + ta * avX + da * dgx + dm * dmx + wa * wx;
  var dy = kc * cohY + se * sepY + ra * rgy + ta * avY + da * dgy + dm * dmy + wa * wy;
  let l = sqrt(dx * dx + dy * dy);
  if (l > 1e-4) { dx = dx / l; dy = dy / l; } else { dx = 0.0; dy = 0.0; }

  steerOut[i * 2u + 0u] = dx;
  steerOut[i * 2u + 1u] = dy;
}
`;
