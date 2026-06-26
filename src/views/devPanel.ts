// Dev panel: mutation rate, resource regrowth, seed, snapshot/restore, headless
// trigger (CLAUDE.md project layout). STUB — built out alongside the tooling pass.
// Not yet wired into main; lives here so the path is stable.

import type { World } from "../state/world";

export class DevPanel {
  constructor(_world: World) {
    // TODO: dev sliders for base mutation scale + resource regrowth (the two knobs
    // that matter most — docs/genome.md §Mutation model), plus snapshot/restore.
  }
}
