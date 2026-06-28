// Tier A — the GPU port of sim/tierA/sense.ts. Per agent: gather the 3×3 cell
// neighborhood from the resident grid (cellStart/items), and over in-range neighbors
// (capped at the intensity budget) accumulate the kin centroid, the separation push,
// and the threat-avoidance push. Same arithmetic as the CPU pass; only the host
// language changes (docs/webgpu-migration buffer contract).
//
// The seven aggregates are written interleaved into one buffer (stride 7) so the
// pass stays within the default storage-buffer-per-stage limit:
//   [kinX, kinY, kinCount, sepX, sepY, avoidX, avoidY]
//
// The neighbor budget makes the result order-dependent when it caps; within-cell
// order is GPU-defined (atomic scatter), so a capped agent may diverge from the CPU
// (permitted). Uncapped agents see the same neighbor SET → sums match to float
// tolerance, counts match exactly.

export const SENSE_WGSL = /* wgsl */ `
const GENE_COUNT = 17u;
const G_SIZE  = 0u;
const G_AGGRO = 11u;
const G_SIGA  = 12u;
const G_SIGB  = 13u;
const G_SIGC  = 14u;
const OUT_STRIDE = 7u;

struct Params {
  count    : u32,
  gridW    : u32,
  gridH    : u32,
  budget   : u32,
  cellSize : f32,
  senseR2  : f32,
  sepR2    : f32,
  sigT     : f32,
};

@group(0) @binding(0) var<uniform>             P         : Params;
@group(0) @binding(1) var<storage, read>       posX      : array<f32>;
@group(0) @binding(2) var<storage, read>       posY      : array<f32>;
@group(0) @binding(3) var<storage, read>       genes     : array<f32>;
@group(0) @binding(4) var<storage, read>       cellStart : array<u32>;
@group(0) @binding(5) var<storage, read>       items     : array<u32>;
@group(0) @binding(6) var<storage, read_write> out       : array<f32>;

fn clampCX(x: f32) -> i32 { return clamp(i32(floor(x / P.cellSize)), 0, i32(P.gridW) - 1); }
fn clampCY(y: f32) -> i32 { return clamp(i32(floor(y / P.cellSize)), 0, i32(P.gridH) - 1); }

@compute @workgroup_size(64)
fn senseMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }

  let xi = posX[i];
  let yi = posY[i];
  let bi = i * GENE_COUNT;
  let sa = genes[bi + G_SIGA];
  let sb = genes[bi + G_SIGB];
  let sc = genes[bi + G_SIGC];

  var kinX = 0.0;
  var kinY = 0.0;
  var kinN = 0.0;
  var sepX = 0.0;
  var sepY = 0.0;
  var avoidX = 0.0;
  var avoidY = 0.0;

  let cx = clampCX(xi);
  let cy = clampCY(yi);

  // Pass 1: count in-radius neighbors. Mirrors CPU sense.ts — the budget caps how many
  // we process, but keeping the FIRST budget-many skews the sample up-left (cells scan
  // top-left to bottom-right) and drifts the population down-right; instead subsample
  // evenly across the candidates, which needs the total up front.
  var nIn: u32 = 0u;
  for (var gy = cy - 1; gy <= cy + 1; gy = gy + 1) {
    if (gy < 0 || gy >= i32(P.gridH)) { continue; }
    for (var gx = cx - 1; gx <= cx + 1; gx = gx + 1) {
      if (gx < 0 || gx >= i32(P.gridW)) { continue; }
      let c = u32(gy) * P.gridW + u32(gx);
      let e = cellStart[c + 1u];
      for (var p = cellStart[c]; p < e; p = p + 1u) {
        let j = items[p];
        if (j == i) { continue; }
        let dx = posX[j] - xi;
        let dy = posY[j] - yi;
        if (dx * dx + dy * dy > P.senseR2) { continue; }
        nIn = nIn + 1u;
      }
    }
  }
  let take = select(P.budget, nIn, nIn < P.budget); // min(nIn, budget)

  // Pass 2: Bresenham-select take-many evenly-spread in-radius neighbors (spatially
  // uniform, no directional bias). nIn <= budget => take = nIn => every neighbor kept
  // (same SET as the CPU pass = uncapped parity; capped agents may still diverge on
  // within-cell scatter order, as before).
  var acc: u32 = nIn >> 1u; // half-bucket phase: centers picks, kills the tail-skew residual
  for (var gy = cy - 1; gy <= cy + 1; gy = gy + 1) {
    if (gy < 0 || gy >= i32(P.gridH)) { continue; }
    for (var gx = cx - 1; gx <= cx + 1; gx = gx + 1) {
      if (gx < 0 || gx >= i32(P.gridW)) { continue; }
      let c = u32(gy) * P.gridW + u32(gx);
      let e = cellStart[c + 1u];
      for (var p = cellStart[c]; p < e; p = p + 1u) {
        let j = items[p];
        if (j == i) { continue; }
        let dx = posX[j] - xi;
        let dy = posY[j] - yi;
        let d2 = dx * dx + dy * dy;
        if (d2 > P.senseR2) { continue; }
        acc = acc + take;
        if (acc < nIn) { continue; }
        acc = acc - nIn;

        let bj = j * GENE_COUNT;
        let dsa = genes[bj + G_SIGA] - sa;
        let dsb = genes[bj + G_SIGB] - sb;
        let dsc = genes[bj + G_SIGC] - sc;
        let sigDist = sqrt(dsa * dsa + dsb * dsb + dsc * dsc);

        if (d2 < P.sepR2 && d2 > 1e-4) {
          let inv = 1.0 / sqrt(d2);
          sepX = sepX - dx * inv;
          sepY = sepY - dy * inv;
        }

        if (sigDist < P.sigT) {
          kinX = kinX + posX[j];
          kinY = kinY + posY[j];
          kinN = kinN + 1.0;
        } else if (d2 > 1e-4) {
          let threat = genes[bj + G_SIZE] * (0.5 + genes[bj + G_AGGRO]);
          let inv = 1.0 / sqrt(d2);
          avoidX = avoidX - dx * inv * threat;
          avoidY = avoidY - dy * inv * threat;
        }
      }
    }
  }

  let o = i * OUT_STRIDE;
  out[o + 0u] = kinX;
  out[o + 1u] = kinY;
  out[o + 2u] = kinN;
  out[o + 3u] = sepX;
  out[o + 4u] = sepY;
  out[o + 5u] = avoidX;
  out[o + 6u] = avoidY;
}
`;
