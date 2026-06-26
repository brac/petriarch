// The cyber-net skin (a dumb view). Reads World and draws it; holds no gameplay
// logic and never mutates the sim — it can be destroyed and rebuilt from state on
// any frame. Owns the Pixi Application and the letterbox transform: the world is
// authored at a fixed WORLD_W × WORLD_H and scaled-to-fit, so gameplay math never
// depends on window size — only this final transform does. (Renderer technique
// ported from swarmr: a single batched ParticleContainer of pooled node sprites.)
//
// PHASE 0: the pipeline is fully wired but population is 0, so it draws an empty
// letterboxed field. The per-frame node mapping below (hue=signature, scale=SIZE,
// alpha=energy) and the kin-edge layer come alive in Milestone 1 — only the loop
// bodies fill in.

import { Application, Container, Graphics, Particle, ParticleContainer } from "pixi.js";
import type { Texture } from "pixi.js";
import type { World } from "../state/world";
import { WORLD_W, WORLD_H, MAX_AGENTS } from "../data/capacity";
import { GENE, GENE_COUNT } from "../data/genome";

// Where inactive pooled particles park — well outside the world so they never draw.
const OFFSCREEN = -10000;
// Node sprite texture radius (px). Per-agent scale multiplies this.
const NODE_TEX_RADIUS = 16;
// SIZE gene → sprite scale multiplier.
const NODE_SCALE = 0.5;
// Energy that reads as "fully fed" (full brightness). PLACEHOLDER — tune in M1.
const NODE_FULL_ENERGY = 100;

export class NetRenderer {
  readonly app = new Application();
  /** Everything in world space lives under here; we scale/position it to fit. */
  private world = new Container();
  /** Kin-cohesion edges (lit mesh). Empty in Phase 0; filled in Milestone 1. */
  private edgeLayer = new Graphics();

  private nodeTex!: Texture;
  private nodeContainer!: ParticleContainer;
  private nodeParticles: Particle[] = [];
  private nodeHigh = 0; // high-water count parked last frame

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05070a,
      antialias: true,
      resizeTo: parent,
      // Pin WebGL: fully supported, handles the swarm, our baseline target. A
      // parallel WebGPU *compute* context is added later for Tier A — rendering
      // stays Pixi/WebGL (docs/webgpu-migration.md).
      preference: "webgl",
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    parent.appendChild(this.app.canvas);

    // The play field: a subtly lighter rect + cyan border so the letterboxed world
    // area reads against the near-black canvas bars.
    const field = new Graphics().rect(0, 0, WORLD_W, WORLD_H).fill(0x0b0d12);
    const border = new Graphics()
      .rect(0, 0, WORLD_W, WORLD_H)
      .stroke({ width: 2, color: 0x00ffcc, alpha: 0.35 });

    // One programmatic node texture (white disc), tinted per-agent at draw time.
    this.nodeTex = this.app.renderer.generateTexture(
      new Graphics().circle(0, 0, NODE_TEX_RADIUS).fill(0xffffff),
    );

    // The one batched node pool. position/color/vertex are dynamic so each node
    // moves, tints (hue+brightness), and sizes to its SIZE gene every frame.
    const pool = this.buildNodePool(this.nodeTex, MAX_AGENTS);
    this.nodeContainer = pool.container;
    this.nodeParticles = pool.particles;

    // Layer order: field → kin-edges → nodes → border frame.
    this.world.addChild(field, this.edgeLayer, this.nodeContainer, border);
    this.app.stage.addChild(this.world);

    // Pixi's own ticker drives nothing — our fixed-timestep Loop owns timing.
    this.app.ticker.stop();

    this.layout();
    window.addEventListener("resize", this.layout);
  }

  /** Read state, position nodes, render one frame. No decisions here. */
  render(world: World, _alpha: number): void {
    const a = world.agents;
    const { posX, posY, energy, genes, count } = a;
    const parts = this.nodeParticles;

    for (let i = 0; i < count; i++) {
      const p = parts[i]!;
      p.x = posX[i]!;
      p.y = posY[i]!;
      const sc = genes[i * GENE_COUNT + GENE.SIZE]! * NODE_SCALE;
      p.scaleX = sc;
      p.scaleY = sc;
      p.tint = nodeTint(genes, i);
      p.alpha = 0.35 + 0.65 * clamp01(energy[i]! / NODE_FULL_ENERGY);
    }
    // Park slots that went inactive since last frame.
    for (let i = count; i < this.nodeHigh; i++) {
      const p = parts[i]!;
      p.x = OFFSCREEN;
      p.y = OFFSCREEN;
    }
    this.nodeHigh = count;

    this.app.renderer.render(this.app.stage);
  }

  private buildNodePool(
    tex: Texture,
    capacity: number,
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
    const container = new ParticleContainer({
      dynamicProperties: { position: true, color: true, vertex: true },
      texture: tex,
      particles,
    });
    container.blendMode = "add"; // glowing nodes over the dark field
    // Build static buffers once, else quads render zero-size.
    container.update();
    return { container, particles };
  }

  private layout = (): void => {
    // Use the renderer's *logical* screen size (CSS pixels); resolution (dpr) is
    // applied later at the GPU projection, so we must NOT divide by dpr here.
    const { width: sw, height: sh } = this.app.renderer.screen;
    const scale = Math.min(sw / WORLD_W, sh / WORLD_H);
    this.world.scale.set(scale);
    this.world.position.set((sw - WORLD_W * scale) / 2, (sh - WORLD_H * scale) / 2);
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Signature → hue → packed RGB tint. Phase 0 uses SIG_A as the hue; the full 3D
// (SIG_A/B/C) → colour projection is a Milestone 1 decision (docs/genome.md).
function nodeTint(genes: Float32Array, i: number): number {
  const h = (((genes[i * GENE_COUNT + GENE.SIG_A]! % 1) + 1) % 1);
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
