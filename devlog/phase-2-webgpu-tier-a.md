---
title: "Porting Petriarch's Tier A sim to WebGPU for 20,000 agents"
date: 2026-06-26
project: "petriarch"
phase: 2
tags: [webgpu, wgsl, gpu, performance, simulation]
draft: true
summary: "Every per-agent Tier A pass moves to WGSL compute kernels, verified against the CPU golden reference, scaling the sim to 20k agents on an RTX 3090."
repo_ref: "2f0645162d8457c045693471551077745f6924dc"
decisions:
  - what: "One compute pass per Tier A kernel, not one pass for the chain"
    why: "WebGPU only synchronizes memory between passes, not between dispatchWorkgroups"
    alternatives: ["Single pass with multiple dispatches (corrupted cell offsets)"]
  - what: "Treat the GPU as its own determinism domain; CPU stays the golden reference"
    why: "Atomic scatter/CAS execute in thread order, so same-seed runs diverge"
    alternatives: ["Force bit-identical CPU/GPU output"]
  - what: "Resource intake as a bitcast atomic<u32> compare-exchange clamp loop"
    why: "WGSL has no atomic float; conserves energy under the one shared Tier A write"
    alternatives: ["Non-atomic write (loses/duplicates resource under contention)"]
benchmarks:
  - metric: "agent count on GPU (RTX 3090)"
    value: "20,000"
    target: "MAX_AGENTS raised 5,000 -> 20,000 for real GPU headroom"
  - metric: "per-tick GPU sync (20k agents, max)"
    value: "~4ms/tick mapAsync"
    target: "the profiling wall — compute was microseconds, Tier B ~0.6ms/tick"
  - metric: "GPU vs CPU statistical equivalence @ 250 ticks"
    value: "GPU pop 813 / meanSIZE 1.596 vs CPU pop 760 / 1.623"
    target: "same equilibrium + regime, differing only in chaotic detail"
  - metric: "steer kernel verify vs CPU golden reference"
    value: "0 mismatches, worstAbs ~3e-4"
    target: "deterministic blend matches CPU on the same seed"
---

## What shipped

All five Tier A passes — spatial hash, sense, steer, integrate, metabolism — now run as WGSL compute kernels resident in GPU buffers, wired into a runnable loop via an async pump (press `g`). State stays on the GPU across the whole chain in one submission; the CPU reads it back once per tick and runs the symbolic Tier B systems — conflict, reproduce, death — unchanged. `MAX_AGENTS` went from 5,000 to 20,000, and the sim ran headful on an RTX 3090.

## Decisions

The buffer contract made the port mechanical: every Tier A pass reads flat structure-of-arrays typed arrays at fixed strides and writes one output buffer, so `global_invocation_id.x` maps 1:1 onto the agent index and only the host language changes.

We treated the GPU as its own determinism domain instead of forcing bit-identical output. The scatter and metabolism atomics execute in thread-dependent order, so same-seed runs diverge (verified: 863 vs 861 agents across two runs). The CPU path stays the golden reference for snapshots and headless runs; GPU correctness is "statistically equivalent + stable," not reproducible.

Resource intake was the one shared write in Tier A. WGSL has no atomic float, so the resource buffer is bound as `array<atomic<u32>>` holding f32 bit patterns and intake is a bitcast compare-exchange clamp loop — conserving energy but order-dependent under contention. Each pass was verified against the live CPU pass on the same seed before moving on.

## What broke

Encoding the four hash kernels in one compute pass corrupted nearly every cell offset: WebGPU synchronizes memory between passes, not between `dispatchWorkgroups`, so `scan` read `counts` before `count` finished. Fix was one compute pass per kernel.

The steer kernel silently failed, leaving zero-init output — WGSL refuses to infer precedence between `*` and `^`, so the shader never compiled. Capturing `device` uncapturederror events surfaced it. Separately, `steerOutBuf` lacked `COPY_DST`, so integrate's verify "passed" on leftover buffer contents until we noticed.

Verifies also raced the rAF loop: comparing a moved CPU snapshot against the GPU's earlier one produced false plus/minus one-cell mismatches. Every verify now freezes its inputs before the first await.

## Numbers

Profiling on the 3090 at 20k agents, max everything, found the wall was the per-tick GPU sync (~4ms/tick `mapAsync`), not compute (microseconds) and not Tier B (conflict ~0.3, death ~0.1, hash ~0.2 ms/tick — the earlier "71ms" was the population-explosion transient). Collapsing seven readback sync points into a single `mapAsync` and adding a one-frame-latency pipeline hid most of that at ~1 tick/frame.

## Next

Trade — the first authored social layer — built on this substrate, and the first Tier A/GPU change since the port.
