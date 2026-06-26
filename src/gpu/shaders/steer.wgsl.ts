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
const GENE_COUNT = 17u;
const G_KC = 6u;   // KIN_COHESION
const G_SE = 7u;   // SEPARATION
const G_RA = 8u;   // RESOURCE_ATTRACT
const G_TA = 9u;   // THREAT_AVOID
const G_WA = 10u;  // WANDER
const SENSE_STRIDE = 7u;
const TAU = 6.2831853071795864;

struct Params {
  count    : u32,
  resGridW : u32,
  resGridH : u32,
  seed     : u32,   // per-frame wander seed (GPU determinism domain)
  resCellW : f32,
  resCellH : f32,
  _p0      : f32,
  _p1      : f32,
};

@group(0) @binding(0) var<uniform>             P        : Params;
@group(0) @binding(1) var<storage, read>       posX     : array<f32>;
@group(0) @binding(2) var<storage, read>       posY     : array<f32>;
@group(0) @binding(3) var<storage, read>       genes    : array<f32>;
@group(0) @binding(4) var<storage, read>       senseOut : array<f32>;
@group(0) @binding(5) var<storage, read>       res      : array<f32>;
@group(0) @binding(6) var<storage, read_write> steerOut : array<f32>;

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

  // --- resource gradient: toward the richer of the 4-neighbor cells ---
  let gw = i32(P.resGridW);
  let gh = i32(P.resGridH);
  var cx = clamp(i32(floor(xi / P.resCellW)), 0, gw - 1);
  var cy = clamp(i32(floor(yi / P.resCellH)), 0, gh - 1);
  let xl = select(cx, cx - 1, cx > 0);
  let xr = select(cx, cx + 1, cx < gw - 1);
  let yu = select(cy, cy - 1, cy > 0);
  let yd = select(cy, cy + 1, cy < gh - 1);
  let rowc = cy * gw;
  var rgx = res[u32(rowc + xr)] - res[u32(rowc + xl)];
  var rgy = res[u32(yd * gw + cx)] - res[u32(yu * gw + cx)];
  {
    let l = sqrt(rgx * rgx + rgy * rgy);
    if (l > 1e-4) { rgx = rgx / l; rgy = rgy / l; } else { rgx = 0.0; rgy = 0.0; }
  }

  // --- wander: a per-agent seeded unit vector (GPU determinism domain) ---
  let h = hashU32((i * 2654435761u) ^ P.seed);
  let ang = (f32(h) / 4294967296.0) * TAU;
  let wx = cos(ang);
  let wy = sin(ang);

  // --- weighted blend ---
  let bi = i * GENE_COUNT;
  let kc = genes[bi + G_KC];
  let se = genes[bi + G_SE];
  let ra = genes[bi + G_RA];
  let ta = genes[bi + G_TA];
  let wa = genes[bi + G_WA];

  var dx = kc * cohX + se * sepX + ra * rgx + ta * avX + wa * wx;
  var dy = kc * cohY + se * sepY + ra * rgy + ta * avY + wa * wy;
  let l = sqrt(dx * dx + dy * dy);
  if (l > 1e-4) { dx = dx / l; dy = dy / l; } else { dx = 0.0; dy = 0.0; }

  steerOut[i * 2u + 0u] = dx;
  steerOut[i * 2u + 1u] = dy;
}
`;
