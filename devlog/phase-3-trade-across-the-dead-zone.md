---
title: "Trade caravans crossing Petriarch's dead zone"
date: 2026-06-30
project: "petriarch"
phase: 3
tags: [trade, stigmergy, emergence, simulation, gpu]
draft: true
summary: "The first authored social layer: supply-scent, a provisioning gate, and a round-trip carry cycle turn two isolated societies into trading partners."
repo_ref: "2604eb266d642bd1d8817f9b0a85fc1a820e54a6"
decisions:
  - what: "Geography-anchored supply-scent cone, not a deposited demand field"
    why: "A deficit field tracked population density and herded agents to their own centre"
    alternatives: ["Deficit-broadcast demand field", "Diffused capacity field (decays to noise across the gap)"]
  - what: "Provisioning as an energy-reserve gate on the scent term"
    why: "Only well-fed agents cross; cleaner and subsumes the hoard/discount/gene levers"
    alternatives: ["Emergent hoard-then-cross", "In-transit metabolic discount", "A provisioning gene"]
  - what: "Round-trip carry/return state machine, home = claim-field gradient"
    why: "Carriers must return or the two societies merge (colonization, the opposite of trade)"
    alternatives: ["One-way crossing/settlement", "Kin-centroid home", "Stored birth-cell origin"]
  - what: "Slow amity decay (0.998)"
    why: "Amity bites on persistence, not magnitude; fast decay faded before the next frontier trade"
    alternatives: ["Fast decay with cranked suppress/volume (<1% of fights suppressed)"]
benchmarks:
  - metric: "pacified frontier cells (amity study, 16k x 4 seeds)"
    value: "13 -> 245"
    target: "a broad trading district, not one hot pixel"
  - metric: "global fights/k, amity on vs the trade-only control"
    value: "5176 -> 4357 (-16%); the same run is -26% against the no-trade baseline, which starts from a different fights/k"
    target: "conflict recedes globally, not just relocates"
  - metric: "cross-gap trade under supply-scent (3 seeds x 8k, weight 0.6)"
    value: "+31% (874 -> 1145/k), traffic 1.2% -> 1.9%"
    target: "sustained cross-gap flux, was ~0; weight 1.0 = migration not trade"
  - metric: "provisioning gate recovery (provisionFloor 0.45)"
    value: "+700 pop (8128 -> 8828), +5.6pts breed, survival tax halved -12% -> -5%"
    target: "the gap becomes a filter, not a wall"
---

## What shipped

Petriarch's first authored social layer: two societies now trade complementary goods across a barren, foodless gap. Agents climb a long-range supply-scent toward the nutrient they lack, a provisioning gate lets only the well-fed attempt the crossing, and a carry/return state machine hauls cargo home so goods move both ways without the populations emigrating. Carriers then harden a visible caravan road across the dead zone, and a slow-decaying amity field cools the frontier into a pacified market. This was the first Tier A/GPU change since the WebGPU port — the scent and gate terms ship in `steer.wgsl`, re-verified on the 3090.

## Decisions

The keystone was long-range reach. A deposited demand field was the intuitive choice but failed (below), so we anchored a static, monotonic supply-scent cone to each nutrient's region and had deficit-weighted agents climb it. Weight 0.6 was the cap — at 1.0 region A empties (migration, not trade).

Provisioning became a single energy-reserve gate on the scent pull rather than the three planned levers; the gate subsumed two of them and lures only agents with the reserve to survive.

The round trip was non-negotiable: without a return leg the two societies blur into one, so cargo is carried, not consumed, and "home" reuses the existing claim-field gradient.

## What broke

The deficit-broadcast demand field failed outright. With both regions eaten to scarcity, agents are hungry on both nutrients, so demand tracked population density and peaked inside each region — climbing it herded agents toward their own centre and gap traffic went down. A spatial probe proved it before the scent-cone rewrite. Diffusing the capacity field was tried first and also rejected — it decays the far signal to noise, never monotonic across the 20-cell gap.

On amity, cranking suppress to 0.5 and per-trade volume to 5 did almost nothing — peak amity capped near 4, under 1% of fights suppressed — because at fast decay each deposit faded before the next sparse frontier trade. Slow decay (0.998) was the unlock.

The provisioning gate's nonlinearity nudged the CPU-f64/GPU-f32 steer divergence up for a few borderline agents; a seed-sweep (0–3 of ~3900 agents) showed it non-systematic, so we recalibrated verify tolerances rather than chase a phantom logic bug.

## Numbers

Amity numbers come from `amitycheck.ts` (16k x 4 seeds), which runs three configs: no-trade (the baseline), trade-only with suppression off (the control), and the amity coupling. The winning config pushed pacified cells 13 -> 245 and cut global fights/k 5176 -> 4357, which is -16% against the trade-only control and -26% against the no-trade baseline. Those two percentages are measured off different baselines, so 5176 -> 4357 is the -16% pair, not the -26% one. TRADE selection edged 0.45 -> 0.49. The study ran at 3b, before the phase-4 carriers existed in the codebase, so the recession is the amity field's doing, not the caravans'. The crossing numbers come from `crossing.ts` (3 seeds x 8k). A later conflict-recession study (seed 11, 20k ticks) confirmed the thesis globally: per-capita fights fell 70% (1.25 -> 0.38/k/agent) as commerce took over.

## Next

Territory — the second social layer — where societies fight harder on home ground and hold coherent borders.
