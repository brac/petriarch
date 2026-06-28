// All capacity + world-scale tunables. Changing population capacity is editing
// MAX_AGENTS here and nowhere else (CLAUDE.md rule 9). Code reads data; you edit
// data. Several values are PLACEHOLDERS to be calibrated in Milestone 1 (noted).

/** Pool capacity. Every typed array allocates to this. One number to change.
 * 20000 gives the GPU path real headroom on a discrete GPU; raise further to stress
 * it (CPU Tier B — conflict/reproduce/death/hash — becomes the wall before the GPU). */
export const MAX_AGENTS = 20000;

/** World is authored at a fixed size; the renderer letterboxes it to the window. 3840×2160
 * = 4× the area of the original 1920×1080, for a much larger map (agent cap unchanged, so the
 * population grows ~4× toward it as the bigger world's food supports it — same local density,
 * more room for migration/speciation). Everything spatial derives from these: the resource/
 * claim/danger grids, the spatial hash (ceil(W/cellSize)), the GPU buffers + uniforms, and the
 * renderer letterbox. Re-verify the GPU path after changing them (grid dims feed the kernels). */
export const WORLD_W = 3840;
export const WORLD_H = 2160;

// --- intensity slider mapping (see core/intensity.ts) ---
/** Live population floor at intensity 0 (max intensity → MAX_AGENTS). */
export const MIN_POP = 100;
/** Ticks between cognitive updates: 1 at max intensity, THINK_INTERVAL_MAX at min. */
export const THINK_INTERVAL_MIN = 1;
export const THINK_INTERVAL_MAX = 8;
/** Default think interval before the slider sets it. */
export const THINK_INTERVAL = THINK_INTERVAL_MAX;
/** Neighbor-sample budget: capped at min intensity, full 3×3 block at max. */
export const NEIGHBOR_BUDGET_MIN = 8;
export const NEIGHBOR_BUDGET_MAX = 64;

// --- spatial hash --- cell ~ the sense radius so a 3×3 block covers a query.
export const HASH_CELL_SIZE = 64;

/** Max simultaneous conflict sparks the renderer can show (pooled). */
export const MAX_SPARKS = 256;

/** Max god-perturbation commands buffered between sim ticks. A fast drag-paint enqueues
 *  one per pointer event, so this only needs to cover a single frame's worth of input. */
export const GOD_QUEUE_CAP = 512;

// --- resource field grid --- ~24px cells over the 3840×2160 world (grid doubled with the
// world so the cell size — and thus food/territory granularity — stays the same, just more
// of it). RES_CELL_W/H below stay 24×24.
export const RESOURCE_GRID_W = 160;
export const RESOURCE_GRID_H = 90;
export const RES_CELL_W = WORLD_W / RESOURCE_GRID_W;
export const RES_CELL_H = WORLD_H / RESOURCE_GRID_H;
