// The spatial-hash counting sort as four compute kernels — the GPU analogue of
// core/spatialHash.ts::build (docs/webgpu-migration §"Spatial hash on the GPU").
// One broadphase, ported once; everything downstream (sense, conflict, edges) reads
// the same cellStart/items layout the CPU produces.
//
// The cell math is byte-for-byte the CPU's clampCX/clampCY: floor(coord/cellSize)
// clamped to [0, gridDim-1]. Positions are always in [0, WORLD] (integrate clamps),
// so floor == trunc and this matches `(x/cellSize)|0` exactly. cellStart comes out
// identical to the CPU (counting is order-independent); only the order of indices
// *within* a cell differs (atomic scatter), which the verify treats as a multiset.
//
// Bindings (one layout, reused by all four entry points):
//   0 Params (uniform)         5 items     : array<u32>            (read_write)
//   1 posX : array<f32>        6 cursor    : array<atomic<u32>>    (read_write)
//   2 posY : array<f32>
//   3 counts    : array<atomic<u32>> (read_write)
//   4 cellStart : array<u32>          (read_write)

export const HASH_WGSL = /* wgsl */ `
struct Params {
  count    : u32,   // active agents
  gridW    : u32,
  gridH    : u32,
  numCells : u32,   // gridW * gridH
  cellSize : f32,
  worldW   : f32,
  worldH   : f32,
  _pad     : u32,
};

@group(0) @binding(0) var<uniform>             P         : Params;
@group(0) @binding(1) var<storage, read>       posX      : array<f32>;
@group(0) @binding(2) var<storage, read>       posY      : array<f32>;
@group(0) @binding(3) var<storage, read_write> counts    : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellStart : array<u32>;
@group(0) @binding(5) var<storage, read_write> items     : array<u32>;
@group(0) @binding(6) var<storage, read_write> cursor    : array<atomic<u32>>;

fn cellOf(x: f32, y: f32) -> u32 {
  var cx = i32(floor(x / P.cellSize));
  cx = clamp(cx, 0, i32(P.gridW) - 1);
  var cy = i32(floor(y / P.cellSize));
  cy = clamp(cy, 0, i32(P.gridH) - 1);
  return u32(cy) * P.gridW + u32(cx);
}

// Zero the per-cell counters before counting/scatter. Dispatched over numCells.
@compute @workgroup_size(64)
fn clearCells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c = gid.x;
  if (c >= P.numCells) { return; }
  atomicStore(&counts[c], 0u);
  atomicStore(&cursor[c], 0u);
}

// Tally agents per cell. Dispatched over count.
@compute @workgroup_size(64)
fn count(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let c = cellOf(posX[i], posY[i]);
  atomicAdd(&counts[c], 1u);
}

// Exclusive prefix sum of counts -> cellStart (length numCells+1). numCells is tiny
// (~510 for the default world), so a single-thread serial scan is exact and cheap.
// Dispatched as exactly one workgroup of one invocation.
@compute @workgroup_size(1)
fn scan() {
  var acc: u32 = 0u;
  for (var c: u32 = 0u; c < P.numCells; c = c + 1u) {
    cellStart[c] = acc;
    acc = acc + atomicLoad(&counts[c]);
  }
  cellStart[P.numCells] = acc;
}

// Scatter each agent index into its cell's slice using an atomic write cursor.
// Order within a cell is nondeterministic (atomics) — a deliberate divergence from
// the CPU that the buffer contract permits. Dispatched over count.
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let c = cellOf(posX[i], posY[i]);
  let slot = atomicAdd(&cursor[c], 1u);
  items[cellStart[c] + slot] = i;
}
`;
