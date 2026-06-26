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

const WG = 64; // workgroup size for the per-agent/per-cell kernels (must match WGSL)

export interface GpuGridResult {
  /** Exclusive prefix sums, length numCells+1 (a fresh copy off the GPU). */
  cellStart: Uint32Array;
  /** Agent indices grouped by cell, length capacity (order within a cell is GPU-defined). */
  items: Uint32Array;
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

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup);

    pass.setPipeline(this.pipeClear);
    pass.dispatchWorkgroups(cellWG);
    if (agentWG > 0) {
      pass.setPipeline(this.pipeCount);
      pass.dispatchWorkgroups(agentWG);
    }
    pass.setPipeline(this.pipeScan);
    pass.dispatchWorkgroups(1);
    if (agentWG > 0) {
      pass.setPipeline(this.pipeScatter);
      pass.dispatchWorkgroups(agentWG);
    }
    pass.end();
    this.queue.submit([enc.finish()]);
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
}
