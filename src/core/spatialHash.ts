// Uniform-grid broadphase — the one spatial abstraction (CLAUDE.md rule 5). All
// spatial queries (kin-sensing, resource-sensing, conflict, and the renderer's
// kin-edges) go through this; no ad-hoc O(n²) loops anywhere. It is the single
// thing that ports to a GPU counting-sort grid with atomics (docs/webgpu-migration).
//
// Implemented as a flat counting-sort grid over typed arrays (not a Map): every
// tick we bucket all agents into `items`, grouped by cell, with `cellStart` giving
// each cell's slice. No hashing, no per-query allocation — cell c's agents are
// items[cellStart[c]..cellStart[c+1]]. (Ported verbatim from swarmr.)

export class SpatialHash {
  readonly cellSize: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly numCells: number;

  // cellStart[c]..cellStart[c+1] is cell c's slice of `items`. Length numCells+1.
  readonly cellStart: Int32Array;
  // agent indices grouped by cell after build(). Length = capacity.
  readonly items: Int32Array;

  // Scratch reused across builds — never reallocated.
  private counts: Int32Array;
  private entityCell: Int32Array;

  constructor(cellSize: number, worldW: number, worldH: number, capacity: number) {
    this.cellSize = cellSize;
    this.gridW = Math.ceil(worldW / cellSize);
    this.gridH = Math.ceil(worldH / cellSize);
    this.numCells = this.gridW * this.gridH;
    this.cellStart = new Int32Array(this.numCells + 1);
    this.counts = new Int32Array(this.numCells);
    this.entityCell = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  /** Clamp a world x to a valid column. */
  clampCX(x: number): number {
    let cx = (x / this.cellSize) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.gridW) cx = this.gridW - 1;
    return cx;
  }

  /** Clamp a world y to a valid row. */
  clampCY(y: number): number {
    let cy = (y / this.cellSize) | 0;
    if (cy < 0) cy = 0;
    else if (cy >= this.gridH) cy = this.gridH - 1;
    return cy;
  }

  /**
   * Rebuild the grid from an agent SoA (positions in parallel arrays, active set in
   * [0,count)). Counting sort: tally per cell, prefix-sum into cellStart, then
   * scatter indices into items. Allocation-free; reuses all scratch.
   */
  build(posX: Float32Array, posY: Float32Array, count: number): void {
    const { counts, cellStart, items, entityCell, gridW, numCells } = this;
    counts.fill(0);

    // Tally per cell; remember each agent's cell so the scatter pass is cheap.
    for (let i = 0; i < count; i++) {
      const c = this.clampCY(posY[i]!) * gridW + this.clampCX(posX[i]!);
      entityCell[i] = c;
      counts[c]!++;
    }

    // Prefix sum → start offsets.
    let acc = 0;
    for (let c = 0; c < numCells; c++) {
      cellStart[c] = acc;
      acc += counts[c]!;
    }
    cellStart[numCells] = acc;

    // Scatter: reuse counts as a per-cell write cursor.
    counts.fill(0);
    for (let i = 0; i < count; i++) {
      const c = entityCell[i]!;
      items[cellStart[c]! + counts[c]!] = i;
      counts[c]!++;
    }
  }

  /**
   * Collect agent indices in the 3×3 block of cells around (x, y) into `out` (a
   * caller-owned reused scratch array). For the hottest paths, iterate
   * cellStart/items directly instead of going through this.
   */
  queryNeighbors(x: number, y: number, out: number[]): number[] {
    out.length = 0;
    const cx = this.clampCX(x);
    const cy = this.clampCY(y);
    const { cellStart, items, gridW, gridH } = this;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= gridH) continue;
      const rowBase = gy * gridW;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= gridW) continue;
        const c = rowBase + gx;
        const end = cellStart[c + 1]!;
        for (let p = cellStart[c]!; p < end; p++) out.push(items[p]!);
      }
    }
    return out;
  }

  /**
   * Collect agent indices in the square ring of cells at Chebyshev distance `r`
   * from cell (cx, cy) into `out`. r=0 is the single center cell. Used by nearest
   * search: scan outward ring by ring until a candidate appears.
   */
  queryRing(cx: number, cy: number, r: number, out: number[]): number[] {
    out.length = 0;
    if (r === 0) {
      this.appendCell(cx, cy, out);
      return out;
    }
    for (let dx = -r; dx <= r; dx++) {
      this.appendCell(cx + dx, cy - r, out);
      this.appendCell(cx + dx, cy + r, out);
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      this.appendCell(cx - r, cy + dy, out);
      this.appendCell(cx + r, cy + dy, out);
    }
    return out;
  }

  private appendCell(cx: number, cy: number, out: number[]): void {
    if (cx < 0 || cx >= this.gridW || cy < 0 || cy >= this.gridH) return;
    const c = cy * this.gridW + cx;
    const end = this.cellStart[c + 1]!;
    for (let p = this.cellStart[c]!; p < end; p++) out.push(this.items[p]!);
  }
}
