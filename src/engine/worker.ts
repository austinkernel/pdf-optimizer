/// <reference lib="webworker" />
/**
 * Engine worker. All PDF bytes are processed here, off the UI thread.
 * This file contains no network code. The only fetch it performs is MuPDF
 * loading its own .wasm from the app origin, which the service worker serves
 * from the offline cache.
 */
import { analyze, optimize, EngineError } from "./mupdfEngine";
import { configureJpegEncoder } from "./jpegEncoder";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const progress = (p: Parameters<NonNullable<Parameters<typeof analyze>[1]>>[0]) => post({ id: req.id, type: "progress", progress: p });
  try {
    if (req.type === "analyze") {
      const report = analyze(new Uint8Array(req.buffer), progress);
      post({ id: req.id, type: "analysis", report });
    } else if (req.type === "optimize") {
      const before = performance.getEntriesByType("resource").length;
      const result = await optimize(new Uint8Array(req.buffer), req.options, progress);
      result.workerNetworkRequests = performance.getEntriesByType("resource").length - before;
      const buf = result.bytes.buffer as ArrayBuffer;
      post({ id: req.id, type: "optimized", result }, [buf]);
    }
  } catch (e) {
    const err = e as Error;
    const code = e instanceof EngineError ? e.code : err instanceof RangeError || /memory|Aborted/i.test(err.message) ? "memory" : "internal";
    post({ id: req.id, type: "error", code, message: err.message || String(e) });
  }
};

// Load the JPEG codec's .wasm now, at startup, so no fetch of any kind happens
// while a document is being processed. Failure is tolerated: encodeJpeg falls
// back to MuPDF's encoder.
configureJpegEncoder()
  .catch(() => {})
  .finally(() => post({ id: 0, type: "ready" }));
