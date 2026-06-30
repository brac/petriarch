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
  /** ANTI-CLUMP — straight, spaced roads, not a checker (brac's "each bridge prevents another road for a
   *  moderate distance"). The crossing is HORIZONTAL (left region ↔ right region), so roads run along x;
   *  the anti-clump is VERTICAL. A cell hardens only if NO OTHER road lies within `roadSpacing` rows in
   *  its own column (horizontal extension is unrestricted → straight roads; vertical stacking is blocked
   *  → spacing). So parallel roads are kept ≥ roadSpacing+1 cells apart. */
  roadSpacing: 4,
  /** Road thickness in cells. A road is allowed to be this many rows tall before the spacing rule blocks
   *  the next row — so a road reads as a proper lane, not a 1-px line. */
  roadWidth: 2,
  /** render: a hardened road draws as a gold lane (the diffuse gold trail THICKENING into a paved road —
   *  one commerce-gold language). Mid-gold + moderate alpha so the additive layer reads as gold, not a
   *  blown-out white block. */
  renderTint: 0xf0b030,
  renderAlpha: 0.6,
}; // mutable: the dev panel tunes these live
