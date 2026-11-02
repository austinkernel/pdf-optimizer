/**
 * UI-side handle to the engine worker.
 *
 * - One job at a time, so duplicate processing is impossible.
 * - Input bytes are transferred to the worker, not copied. The File itself stays
 *   disk-backed and the original is never modified.
 * - cancel() terminates the worker. That is the only reliable way to stop a
 *   synchronous WASM computation, and it frees all WASM memory at once.
 * - After an internal or memory error the worker is discarded, since the WASM
 *   heap may be in an undefined state.
 * - After every compression job the worker is recycled. A WASM heap never shrinks
 *   and fragments with large image buffers (measured: about +35 MB per job on
 *   12 MP photos), so each job starts with a fresh heap. A replacement warms up
 *   in the background while the user reads the result.
 */
import type { ErrorCode, WorkerRequest, WorkerResponse } from "./protocol";
import type { AnalysisReport, OptimizeOptions, OptimizeResult, ProgressEvent } from "./types";

export class EngineFailure extends Error {
  code: ErrorCode | "cancelled" | "crashed";
  constructor(code: EngineFailure["code"], message: string) {
    super(message);
    this.code = code;
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: EngineFailure) => void;
  onProgress?: (p: ProgressEvent) => void;
};

export class EngineClient {
  private worker: Worker | null = null;
  private ready: Promise<Worker> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Starts the worker (and loads the ~10 MB WASM) ahead of the first job. */
  warmUp(): Promise<void> {
    return this.ensure().then(() => undefined);
  }

  private ensure(): Promise<Worker> {
    if (this.ready) return this.ready;
    this.ready = new Promise<Worker>((resolve, reject) => {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "pdf-engine" });
      const timer = setTimeout(() => {
        w.terminate();
        this.reset();
        reject(new EngineFailure("crashed", "The PDF engine took too long to start."));
      }, 60_000);
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === "ready") {
          clearTimeout(timer);
          this.worker = w;
          resolve(w);
          return;
        }
        this.handle(msg);
      };
      w.onerror = (ev) => {
        clearTimeout(timer);
        ev.preventDefault();
        const failure = new EngineFailure("crashed", `The PDF engine stopped unexpectedly${ev.message ? `: ${ev.message}` : ""}.`);
        this.failAll(failure);
        w.terminate();
        this.reset();
        reject(failure);
      };
    });
    return this.ready;
  }

  /** Discards the current worker (freeing its whole WASM heap) and starts a fresh one. */
  private recycle() {
    this.worker?.terminate();
    this.reset();
    // Start the replacement after the result has been delivered, so the engine's own
    // files (served from the offline cache) never load during a job.
    setTimeout(() => {
      if (!this.ready) this.warmUp().catch(() => {});
    }, 1500);
  }

  private reset() {
    this.worker = null;
    this.ready = null;
  }

  private failAll(e: EngineFailure) {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private handle(msg: WorkerResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case "progress":
        p.onProgress?.(msg.progress);
        break;
      case "analysis":
        this.pending.delete(msg.id);
        p.resolve(msg.report); // analysis decodes no images, so the heap stays small: keep the warm worker
        break;
      case "optimized":
        this.pending.delete(msg.id);
        this.recycle();
        p.resolve(msg.result);
        break;
      case "error":
        this.pending.delete(msg.id);
        if (msg.code === "internal" || msg.code === "memory") {
          this.worker?.terminate();
          this.reset();
        }
        p.reject(new EngineFailure(msg.code, msg.message));
        break;
    }
  }

  private async run<T>(
    make: (id: number) => { req: WorkerRequest; transfer: Transferable[] },
    onProgress?: (p: ProgressEvent) => void,
    onStart?: () => void,
  ): Promise<T> {
    if (this.busy) throw new EngineFailure("internal", "Another document is already being processed.");
    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    });
    try {
      const w = await this.ensure();
      if (!this.pending.has(id)) return result; // cancelled while starting
      const { req, transfer } = make(id);
      onStart?.(); // the document is handed to a ready engine: processing starts now
      w.postMessage(req, transfer);
    } catch (e) {
      this.pending.delete(id);
      throw e;
    }
    return result;
  }

  async analyze(file: Blob, onProgress?: (p: ProgressEvent) => void): Promise<AnalysisReport> {
    const buffer = await file.arrayBuffer();
    return this.run<AnalysisReport>((id) => ({ req: { id, type: "analyze", buffer }, transfer: [buffer] }), onProgress);
  }

  async optimize(
    file: Blob,
    options: OptimizeOptions,
    onProgress?: (p: ProgressEvent) => void,
    onStart?: () => void,
  ): Promise<OptimizeResult> {
    const buffer = await file.arrayBuffer();
    return this.run<OptimizeResult>((id) => ({ req: { id, type: "optimize", buffer, options }, transfer: [buffer] }), onProgress, onStart);
  }

  cancel(): void {
    if (!this.busy) return;
    this.worker?.terminate();
    this.reset();
    this.failAll(new EngineFailure("cancelled", "Cancelled."));
  }
}
