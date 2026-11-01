import type { AnalysisReport, OptimizeOptions, OptimizeResult, ProgressEvent } from "./types";

export type WorkerRequest =
  | { id: number; type: "analyze"; buffer: ArrayBuffer }
  | { id: number; type: "optimize"; buffer: ArrayBuffer; options: OptimizeOptions };

export type ErrorCode = "password" | "not-pdf" | "damaged" | "internal" | "memory";

export type WorkerResponse =
  | { id: 0; type: "ready" }
  | { id: number; type: "progress"; progress: ProgressEvent }
  | { id: number; type: "analysis"; report: AnalysisReport }
  | { id: number; type: "optimized"; result: OptimizeResult }
  | { id: number; type: "error"; code: ErrorCode; message: string };
