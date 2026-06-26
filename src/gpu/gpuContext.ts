// The simulation's WebGPU compute context — owns the device, the storage buffers
// that mirror the SoA pools, and the Tier A compute pipelines. Built once at
// capacity (zero per-frame allocation, same discipline as the CPU pools). For now
// it hosts only the spatial-hash counting sort (the first pass to port); sense /
// steer / integrate / metabolism kernels attach here next, reusing these buffers.
//
// Grid config mirrors core/spatialHash.ts exactly (gridW = ceil(worldW/cellSize))
// so a GPU build is directly comparable to the CPU reference.

import { acquireGpuDevice, type GpuDevice } from "./device";
import { HASH_WGSL } from "./shaders/hash.wgsl";
import { SENSE_WGSL } from "./shaders/sense.wgsl";
import { GENE_COUNT } from "../data/genome";

const WG = 64; // workgroup size for the per-agent/per-cell kernels (must match WGSL)
/** Interleaved sense output stride: [kinX,kinY,kinCount,sepX,sepY,avoidX,avoidY]. */
export const SENSE_STRIDE = 7;

export interface GpuGridResult {
  /** Exclusive prefix sums, length numCells+1 (a fresh copy off the GPU). */
  cellStart: Uint32Array;
  /** Agent indices grouped by cell, length capacity (order within a cell is GPU-defined). */
  items: Uint32Array;
}

/** Per-agent sense parameters mirroring the CPU pass's SIM constants + budget. */
export interface SenseParams {
  budget: number;
  senseR2: number;
  sepR2: number;
  sigT: number;
}

export class GpuContext {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;

  readonly cellSize: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly numCells: number;
  readonly capacity: number;

  // --- storage / uniform buffers (allocated once at capacity) ---
  private readonly paramsBuf: GPUBuffer;
  private readonly posXBuf: GPUBuffer;
  private readonly posYBuf: GPUBuffer;
  private readonly countsBuf: GPUBuffer;
  private readonly cellStartBuf: GPUBuffer;
  private readonly itemsBuf: GPUBuffer;
  private readonly cursorBuf: GPUBuffer;
  // staging buffers for reading the grid back to the CPU (verify / Tier B).
  private readonly cellStartRead: GPUBuffer;
  private readonly itemsRead: GPUBuffer;

  private readonly bindGroup: GPUBindGroup;
  private readonly pipeClear: GPUComputePipeline;
  private readonly pipeCount: GPUComputePipeline;
  private readonly pipeScan: GPUComputePipeline;
  private readonly pipeScatter: GPUComputePipeline;

  // --- sense pass (reads the resident grid + genes; writes interleaved aggregates) ---
  private readonly genesBuf: GPUBuffer;
  private readonly senseParamsBuf: GPUBuffer;
  private readonly senseOutBuf: GPUBuffer;
  private readonly senseOutRead: GPUBuffer;
  private readonly senseBindGroup: GPUBindGroup;
  private readonly pipeSense: GPUComputePipeline;
  private readonly senseParamsHost = new ArrayBuffer(32);
  private readonly senseParamsU32 = new Uint32Array(this.senseParamsHost);
  private readonly senseParamsF32 = new Float32Array(this.senseParamsHost);

  // Reused host-side scratch for the 32-byte Params upload (zero per-call alloc).
  private readonly paramsHost = new ArrayBuffer(32);
  private readonly paramsU32 = new Uint32Array(this.paramsHost);
  private readonly paramsF32 = new Float32Array(this.paramsHost);

  private constructor(gpu: GpuDevice, cellSize: number, worldW: number, worldH: number, capacity: number) {
    this.device = gpu.device;
    this.queue = gpu.queue;
    this.cellSize = cellSize;
    this.gridW = Math.ceil(worldW / cellSize);
    this.gridH = Math.ceil(worldH / cellSize);
    this.numCells = this.gridW * this.gridH;
    this.capacity = capacity;

    const dev = this.device;
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const u32 = Uint32Array.BYTES_PER_ELEMENT;
    const STORAGE = GPUBufferUsage.STORAGE;
    const buf = (size: number, usage: number): GPUBuffer => dev.createBuffer({ size, usage });

    this.paramsBuf = buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.posXBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST);
    this.posYBuf = buf(capacity * f32, STORAGE | GPUBufferUsage.COPY_DST);
    this.countsBuf = buf(this.numCells * u32, STORAGE);
    this.cellStartBuf = buf((this.numCells + 1) * u32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.itemsBuf = buf(capacity * u32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.cursorBuf = buf(this.numCells * u32, STORAGE);
    this.cellStartRead = buf((this.numCells + 1) * u32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.itemsRead = buf(capacity * u32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const module = dev.createShaderModule({ code: HASH_WGSL });
    const layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipe = (entryPoint: string): GPUComputePipeline =>
      dev.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    this.pipeClear = pipe("clearCells");
    this.pipeCount = pipe("count");
    this.pipeScan = pipe("scan");
    this.pipeScatter = pipe("scatter");

    this.bindGroup = dev.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.countsBuf } },
        { binding: 4, resource: { buffer: this.cellStartBuf } },
        { binding: 5, resource: { buffer: this.itemsBuf } },
        { binding: 6, resource: { buffer: this.cursorBuf } },
      ],
    });

    // --- sense pass: reuses posX/posY + the resident grid, adds genes + outputs ---
    this.genesBuf = buf(capacity * GENE_COUNT * f32, STORAGE | GPUBufferUsage.COPY_DST);
    this.senseParamsBuf = buf(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.senseOutBuf = buf(capacity * SENSE_STRIDE * f32, STORAGE | GPUBufferUsage.COPY_SRC);
    this.senseOutRead = buf(capacity * SENSE_STRIDE * f32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const senseModule = dev.createShaderModule({ code: SENSE_WGSL });
    const senseLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeSense = dev.createComputePipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [senseLayout] }),
      compute: { module: senseModule, entryPoint: "senseMain" },
    });
    this.senseBindGroup = dev.createBindGroup({
      layout: senseLayout,
      entries: [
        { binding: 0, resource: { buffer: this.senseParamsBuf } },
        { binding: 1, resource: { buffer: this.posXBuf } },
        { binding: 2, resource: { buffer: this.posYBuf } },
        { binding: 3, resource: { buffer: this.genesBuf } },
        { binding: 4, resource: { buffer: this.cellStartBuf } },
        { binding: 5, resource: { buffer: this.itemsBuf } },
        { binding: 6, resource: { buffer: this.senseOutBuf } },
      ],
    });
  }

  /** Acquire a device and build the context, or null if WebGPU is unavailable. */
  static async create(cellSize: number, worldW: number, worldH: number, capacity: number): Promise<GpuContext | null> {
    const gpu = await acquireGpuDevice();
    if (!gpu) return null;
    return new GpuContext(gpu, cellSize, worldW, worldH, capacity);
  }

  /** Upload positions and run clear → count → scan → scatter for the active set. */
  buildHash(posX: Float32Array, posY: Float32Array, count: number): void {
    // Params upload (matches the WGSL struct layout, 32 bytes).
    this.paramsU32[0] = count;
    this.paramsU32[1] = this.gridW;
    this.paramsU32[2] = this.gridH;
    this.paramsU32[3] = this.numCells;
    this.paramsF32[4] = this.cellSize;
    this.paramsF32[5] = this.gridW * this.cellSize; // worldW (informational in-shader)
    this.paramsF32[6] = this.gridH * this.cellSize; // worldH
    this.paramsU32[7] = 0;
    this.queue.writeBuffer(this.paramsBuf, 0, this.paramsHost);

    if (count > 0) {
      // Cast narrows Float32Array<ArrayBufferLike> → <ArrayBuffer> for the WebGPU
      // upload type; the pool arrays are never SharedArrayBuffer-backed.
      this.queue.writeBuffer(this.posXBuf, 0, posX as Float32Array<ArrayBuffer>, 0, count);
      this.queue.writeBuffer(this.posYBuf, 0, posY as Float32Array<ArrayBuffer>, 0, count);
    }

    const cellWG = Math.ceil(this.numCells / WG);
    const agentWG = Math.ceil(count / WG);

    // Each kernel has a read/write hazard on the next (counts, cellStart, cursor).
    // WebGPU only guarantees memory synchronization BETWEEN compute passes, not
    // between dispatches inside one pass — so each dependent step gets its own pass.
    const enc = this.device.createCommandEncoder();
    this.dispatch(enc, this.pipeClear, cellWG); // zero counts + cursor
    if (agentWG > 0) this.dispatch(enc, this.pipeCount, agentWG); // tally per cell
    this.dispatch(enc, this.pipeScan, 1); // prefix sum → cellStart
    if (agentWG > 0) this.dispatch(enc, this.pipeScatter, agentWG); // place indices
    this.queue.submit([enc.finish()]);
  }

  private dispatch(enc: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  /** Copy the grid buffers back to the CPU (await). Returns fresh typed arrays. */
  async readGrid(): Promise<GpuGridResult> {
    const u32 = Uint32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.cellStartBuf, 0, this.cellStartRead, 0, (this.numCells + 1) * u32);
    enc.copyBufferToBuffer(this.itemsBuf, 0, this.itemsRead, 0, this.capacity * u32);
    this.queue.submit([enc.finish()]);

    await this.cellStartRead.mapAsync(GPUMapMode.READ);
    await this.itemsRead.mapAsync(GPUMapMode.READ);
    const cellStart = new Uint32Array(this.cellStartRead.getMappedRange()).slice();
    const items = new Uint32Array(this.itemsRead.getMappedRange()).slice();
    this.cellStartRead.unmap();
    this.itemsRead.unmap();
    return { cellStart, items };
  }

  /**
   * Run the sense pass. Positions and the grid must already be resident (call
   * buildHash first on the same snapshot); this uploads genes + sense params and
   * dispatches over the active set. Output is read with readSense().
   */
  senseBuild(genes: Float32Array, count: number, p: SenseParams): void {
    this.senseParamsU32[0] = count;
    this.senseParamsU32[1] = this.gridW;
    this.senseParamsU32[2] = this.gridH;
    this.senseParamsU32[3] = p.budget;
    this.senseParamsF32[4] = this.cellSize;
    this.senseParamsF32[5] = p.senseR2;
    this.senseParamsF32[6] = p.sepR2;
    this.senseParamsF32[7] = p.sigT;
    this.queue.writeBuffer(this.senseParamsBuf, 0, this.senseParamsHost);

    if (count > 0) {
      this.queue.writeBuffer(this.genesBuf, 0, genes as Float32Array<ArrayBuffer>, 0, count * GENE_COUNT);
    }

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.senseBindGroup);
    pass.setPipeline(this.pipeSense);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / WG)));
    pass.end();
    this.queue.submit([enc.finish()]);
  }

  /** Read the interleaved sense output back (length capacity*SENSE_STRIDE copy). */
  async readSense(): Promise<Float32Array> {
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.senseOutBuf, 0, this.senseOutRead, 0, this.capacity * SENSE_STRIDE * f32);
    this.queue.submit([enc.finish()]);
    await this.senseOutRead.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(this.senseOutRead.getMappedRange()).slice();
    this.senseOutRead.unmap();
    return out;
  }
}
