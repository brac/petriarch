// All capacity + world-scale tunables. Changing population capacity is editing
// MAX_AGENTS here and nowhere else (CLAUDE.md rule 9). Code reads data; you edit
// data. Several values are PLACEHOLDERS to be calibrated in Milestone 1 (noted).

/** Pool capacity. Every typed array allocates to this. One number to change. */
export const MAX_AGENTS = 5000;

/** World is authored at a fixed size; the renderer letterboxes it to the window. */
export const WORLD_W = 1920;
export const WORLD_H = 1080;

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

// --- spatial hash --- (PLACEHOLDER: calibrate to the real sensing/conflict radius
// once sense.ts defines it in Milestone 1.)
export const HASH_CELL_SIZE = 48;

// --- resource field grid --- (PLACEHOLDER dims; ~24px cells over the world.)
export const RESOURCE_GRID_W = 80;
export const RESOURCE_GRID_H = 45;
