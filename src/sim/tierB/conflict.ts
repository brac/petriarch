// Tier B — CPU, symbolic/stateful. Resolve contests at contested resource sites:
// when a signature-dissimilar pair meets and at least one is aggressive, they
// fight (contact-damage resolution, strength scaled by SIZE). Ships in Milestone 1
// — without it borders are mush (docs/simulation-systems.md §Conflict). STUB — M1.

import type { World } from "../../state/world";

export function conflict(_world: World): void {
  // TODO Milestone 1: query world.hash at contested cells; resolve fights via the
  // swarmr contact-damage pattern; energy loss / death to the loser.
}
