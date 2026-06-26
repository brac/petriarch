// The cyber-net skin (a dumb view). Reads World and draws it; holds no gameplay
// logic and never mutates the sim — it can be destroyed and rebuilt from state on
// any frame. Owns the Pixi Application and the letterbox transform: the world is
// authored at a fixed WORLD_W × WORLD_H and scaled-to-fit, so gameplay math never
// depends on window size — only this final transform does.
//
// Layers (bottom→top): dark field → resource glow (one ParticleContainer of cell
// quads) → kin-cohesion edges (a lit mesh) → agent nodes (one batched
// ParticleContainer) → conflict sparks (pooled) → border. Node hue = signature,
// size = SIZE gene, brightness = energy. Edges/sparks are gated/capped so the skin
// stays under render budget (docs/simulation-systems.md §Rendering).

import { Application, Container, Graphics, Particle, ParticleContainer } from "pixi.js";
import type { Texture } from "pixi.js";
import type { World } from "../state/world";
import {
  WORLD_W,
  WORLD_H,
  MAX_AGENTS,
  MAX_SPARKS,
  RESOURCE_GRID_W,
  RESOURCE_GRID_H,
  RES_CELL_W,
  RES_CELL_H,
} from "../data/capacity";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";
import { RESOURCES } from "../data/resources";

const OFFSCREEN = -10000;
const NODE_TEX_RADIUS = 16; // node texture radius (px); per-agent scale multiplies it
const NODE_SCALE = 0.5; // SIZE gene → sprite scale
const RES_MAX_ALPHA = 0.5; // a full resource cell's glow alpha
const RES_TINT = 0x2ec86a; // food green
const SPARK_TINT = 0xffffff; // conflict flash — white-hot ring, not an organism hue
const SPARK_DECAY = 0.13; // alpha lost per render frame (~8-frame flash)
// Kin-edge cost guards.
const EDGE_TINT = 0x00ffcc;
const EDGE_ALPHA = 0.16;
const EDGE_MAX = 4000; // hard cap on edges drawn per frame
const EDGE_K = 3; // edges per agent

export class NetRenderer {
  readonly app = new Application();
  private world = new Container(); // camera root (world space)
  private edgeLayer = new Graphics();

  private nodeContainer!: ParticleContainer;
  private nodeParticles: Particle[] = [];
  private nodeHigh = 0;

  private resParticles: Particle[] = [];

  private sparkContainer!: ParticleContainer;
  private sparkParticles: Particle[] = [];
  private sparkLife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;

  // Reused scratch for edge neighbor queries (zero alloc per frame).
  private edgeNbr: number[] = [];

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05070a,
      antialias: true,
      resizeTo: parent,
      preference: "webgl",
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    parent.appendChild(this.app.canvas);

    const field = new Graphics().rect(0, 0, WORLD_W, WORLD_H).fill(0x0b0d12);
    const border = new Graphics()
      .rect(0, 0, WORLD_W, WORLD_H)
      .stroke({ width: 2, color: 0x00ffcc, alpha: 0.35 });

    // --- resource glow layer: one cell-sized quad per grid cell, color dynamic ---
    const cellTex = this.app.renderer.generateTexture(
      new Graphics().rect(0, 0, RES_CELL_W, RES_CELL_H).fill(0xffffff),
    );
    const resContainer = this.buildResourceLayer(cellTex);

    // --- node texture + pool ---
    const nodeTex = this.app.renderer.generateTexture(
      new Graphics().circle(0, 0, NODE_TEX_RADIUS).fill(0xffffff),
    );
    const nodePool = this.buildPool(nodeTex, MAX_AGENTS, { position: true, color: true, vertex: true });
    this.nodeContainer = nodePool.container;
    this.nodeParticles = nodePool.particles;

    // --- spark pool --- a hollow ring so a contest reads as an expanding
    // shockwave (an *event*), unmistakable against the filled organism discs.
    const sparkTex = this.app.renderer.generateTexture(
      new Graphics().circle(0, 0, 13).stroke({ width: 3, color: 0xffffff }),
    );
    const sparkPool = this.buildPool(sparkTex, MAX_SPARKS, { position: true, color: true });
    this.sparkContainer = sparkPool.container;
    this.sparkParticles = sparkPool.particles;

    // Layer order.
    this.world.addChild(
      field,
      resContainer,
      this.edgeLayer,
      this.nodeContainer,
      this.sparkContainer,
      border,
    );
    this.app.stage.addChild(this.world);

    this.app.ticker.stop(); // our fixed-timestep Loop owns timing
    this.layout();
    window.addEventListener("resize", this.layout);
  }

  /** Read state and draw one frame. No decisions here. */
  render(world: World, _alpha: number): void {
    this.drawResources(world);
    this.drawNodes(world);
    this.drawEdges(world);
    this.drawSparks(world);
    this.app.renderer.render(this.app.stage);
  }

  /** Convert a DOM/client point to world coordinates (for god-tool placement). */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const s = this.world.scale.x;
    return {
      x: (clientX - rect.left - this.world.x) / s,
      y: (clientY - rect.top - this.world.y) / s,
    };
  }

  // --- draw passes ---

  private drawResources(world: World): void {
    const res = world.resources;
    const parts = this.resParticles;
    const inv = 1 / RESOURCES.cellCapacity;
    for (let c = 0; c < parts.length; c++) {
      let v = res[c]! * inv;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      parts[c]!.alpha = v * RES_MAX_ALPHA;
    }
  }

  private drawNodes(world: World): void {
    const a = world.agents;
    const { posX, posY, energy, genes, count } = a;
    const parts = this.nodeParticles;
    for (let i = 0; i < count; i++) {
      const p = parts[i]!;
      p.x = posX[i]!;
      p.y = posY[i]!;
      const size = genes[i * GENE_COUNT + GENE.SIZE]!;
      const sc = size * NODE_SCALE;
      p.scaleX = sc;
      p.scaleY = sc;
      p.tint = nodeTint(genes, i);
      const maxE = size * SIM.maxEnergyPerSize;
      p.alpha = 0.3 + 0.7 * clamp01(energy[i]! / maxE);
    }
    for (let i = count; i < this.nodeHigh; i++) {
      parts[i]!.x = OFFSCREEN;
      parts[i]!.y = OFFSCREEN;
    }
    this.nodeHigh = count;
  }

  // Kin mesh: faint lines to a few same-signature neighbors. Always drawn (render
  // is cheap), capped at EDGE_MAX with EDGE_K per agent — independent of the
  // intensity perf knob. Uses the sim's spatial hash (already built this tick).
  private drawEdges(world: World): void {
    const g = this.edgeLayer;
    g.clear();

    const a = world.agents;
    const { posX, posY, genes, count } = a;
    const hash = world.hash;
    const nbr = this.edgeNbr;
    const senseR2 = SIM.senseRadius * SIM.senseRadius;
    const sigT = SIM.sigThreshold;
    let edges = 0;

    for (let i = 0; i < count && edges < EDGE_MAX; i++) {
      const xi = posX[i]!;
      const yi = posY[i]!;
      const bi = i * GENE_COUNT;
      const sa = genes[bi + GENE.SIG_A]!;
      const sb = genes[bi + GENE.SIG_B]!;
      const sc = genes[bi + GENE.SIG_C]!;
      hash.queryNeighbors(xi, yi, nbr);
      const m = nbr.length;
      let drawn = 0;
      for (let k = 0; k < m && drawn < EDGE_K; k++) {
        const j = nbr[k]!;
        if (j <= i) continue; // each pair once
        const dx = posX[j]! - xi;
        const dy = posY[j]! - yi;
        if (dx * dx + dy * dy > senseR2) continue;
        const bj = j * GENE_COUNT;
        const dsa = genes[bj + GENE.SIG_A]! - sa;
        const dsb = genes[bj + GENE.SIG_B]! - sb;
        const dsc = genes[bj + GENE.SIG_C]! - sc;
        if (Math.sqrt(dsa * dsa + dsb * dsb + dsc * dsc) >= sigT) continue;
        g.moveTo(xi, yi).lineTo(posX[j]!, posY[j]!);
        drawn++;
        if (++edges >= EDGE_MAX) break;
      }
    }
    if (edges > 0) g.stroke({ width: 1, color: EDGE_TINT, alpha: EDGE_ALPHA });
  }

  private drawSparks(world: World): void {
    const sp = world.sparks;
    const parts = this.sparkParticles;
    const life = this.sparkLife;

    // Ingest new conflict events into the rolling pool.
    for (let s = 0; s < sp.count; s++) {
      const slot = this.sparkCursor;
      const p = parts[slot]!;
      p.x = sp.x[s]!;
      p.y = sp.y[s]!;
      p.tint = SPARK_TINT;
      life[slot] = 1;
      this.sparkCursor = (this.sparkCursor + 1) % parts.length;
    }
    sp.count = 0; // consumed

    // Decay all live sparks.
    for (let k = 0; k < parts.length; k++) {
      const l = life[k]!;
      if (l <= 0) continue;
      const nl = l - SPARK_DECAY;
      const p = parts[k]!;
      if (nl <= 0) {
        life[k] = 0;
        p.x = OFFSCREEN;
        p.y = OFFSCREEN;
        p.alpha = 0;
      } else {
        life[k] = nl;
        p.alpha = nl;
        const s = 0.3 + (1 - nl) * 2.7; // expand outward (shockwave) as it fades
        p.scaleX = s;
        p.scaleY = s;
      }
    }
  }

  // --- builders ---

  private buildResourceLayer(tex: Texture): ParticleContainer {
    const particles: Particle[] = [];
    for (let cy = 0; cy < RESOURCE_GRID_H; cy++) {
      for (let cx = 0; cx < RESOURCE_GRID_W; cx++) {
        particles.push(
          new Particle({
            texture: tex,
            tint: RES_TINT,
            anchorX: 0,
            anchorY: 0,
            x: cx * RES_CELL_W,
            y: cy * RES_CELL_H,
            alpha: 0,
          }),
        );
      }
    }
    const container = new ParticleContainer({
      dynamicProperties: { position: false, color: true, vertex: false },
      texture: tex,
      particles,
    });
    container.blendMode = "add";
    container.update();
    this.resParticles = particles;
    return container;
  }

  private buildPool(
    tex: Texture,
    capacity: number,
    dynamic: { position?: boolean; color?: boolean; vertex?: boolean },
  ): { container: ParticleContainer; particles: Particle[] } {
    const particles: Particle[] = [];
    for (let i = 0; i < capacity; i++) {
      particles.push(
        new Particle({
          texture: tex,
          tint: 0x00ffcc,
          anchorX: 0.5,
          anchorY: 0.5,
          x: OFFSCREEN,
          y: OFFSCREEN,
        }),
      );
    }
    const container = new ParticleContainer({ dynamicProperties: dynamic, texture: tex, particles });
    container.blendMode = "add";
    container.update();
    return { container, particles };
  }

  private layout = (): void => {
    const { width: sw, height: sh } = this.app.renderer.screen;
    const scale = Math.min(sw / WORLD_W, sh / WORLD_H);
    this.world.scale.set(scale);
    this.world.position.set((sw - WORLD_W * scale) / 2, (sh - WORLD_H * scale) / 2);
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Signature → hue → packed RGB. Phase-1: SIG_A drives hue, SIG_B/C nudge it so all
// three tag dimensions show as colour drift (docs/genome.md).
function nodeTint(genes: Float32Array, i: number): number {
  const bi = i * GENE_COUNT;
  let h = genes[bi + GENE.SIG_A]! + 0.15 * (genes[bi + GENE.SIG_B]! - genes[bi + GENE.SIG_C]!);
  h = ((h % 1) + 1) % 1;
  return hslToRgb(h, 0.85, 0.55);
}

function hslToRgb(h: number, s: number, l: number): number {
  if (s === 0) {
    const v = Math.round(l * 255);
    return (v << 16) | (v << 8) | v;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
