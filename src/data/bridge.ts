// Bridge / road tunables (Tier B; data-driven, read live). The construction tier the passability field
// was built for (data/passability.ts: "roads … a later tier are continuous costs < 1 (faster)").
//
// THE MECHANIC (brac's): the gap crossing is individually DEADLY — most carriers starve mid-gap before
// reaching the far side. So traders building the route should leave behind a permanent STRUCTURE that
// makes the crossing survivable. A heavily-travelled trail cell (carriers funnelling through it, P4d)
// HARDENS into a road: a low-passability lane the integrate pass already reads as "faster" (cost < 1 →
// step ×1/cost) on BOTH CPU and GPU. Faster crossing = fewer ticks starving in the foodless gap =
// survivable → the trickle of completed round trips becomes a flow, and trade flourishes. Roads form
// from both societies' carriers (the scent cones funnel both into the same corridor) and meet in the
// middle. Render-adjacent / Tier B: writes the passability field (CPU-source, uploaded to the GPU each
// tick — no GPU kernel change, no race; see memory petriarch-gpu-god-tools-race).

export const BRIDGE = {
  /** A trail cell HARDENS into road once its accumulated carrier-traffic magnitude reaches this. High
   *  so only the hottest funnelled lane sets (a road, not a paved plaza) — the MVP's anti-clump. */
  setThreshold: 4.0,
  /** Passability cost written into a hardened road cell. < 1 → integrate speeds the step by 1/cost, so
   *  0.4 = 2.5× faster across the gap → ~2.5× fewer ticks of foodless-gap starvation. Tune toward the
   *  crossing being clearly survivable without making roads a teleporter. */
  roadCost: 0.4,
  /** ANTI-CLUMP (brac's "each bridge prevents other bridges around it"): a cell hardens only if it has
   *  AT MOST this many road cells in its 8-neighbourhood. With a row-major scan this stops a hot block
   *  paving solid — the first row hardens, the row below sees 3 road-neighbours above and is blocked →
   *  a ~1-cell-tall road ALONG the (horizontal) crossing, not a plaza. A road can still extend at its
   *  tips (1 neighbour), so it grows lengthwise, not widthwise. */
  maxRoadNeighbors: 2,
  /** render: a hardened road draws as a gold lane (the diffuse gold trail THICKENING into a paved road —
   *  one commerce-gold language). Mid-gold + moderate alpha so the additive layer reads as gold, not a
   *  blown-out white block. */
  renderTint: 0xf0b030,
  renderAlpha: 0.6,
}; // mutable: the dev panel tunes these live
