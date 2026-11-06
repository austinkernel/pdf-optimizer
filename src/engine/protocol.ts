import type { AnalysisReport, OptimizeOptions, OptimizeResult, ProgressEvent, SampleResult } from "./types";

export type WorkerRequest =
  | { id: number; type: "analyze"; buffer: ArrayBuffer; password?: string }
  | { id: number; type: "optimize"; buffer: ArrayBuffer; options: OptimizeOptions; password?: string; removePassword?: boolean }
  | { id: number; type: "sample"; buffer: ArrayBuffer; options: OptimizeOptions; pageIndex: number | null; maxPx: number; password?: string };

export type ErrorCode = "password" | "wrong-password" | "not-pdf" | "damaged" | "internal" | "memory";

export type WorkerResponse =
  | { id: 0; type: "ready" }
  | { id: number; type: "progress"; progress: ProgressEvent }
  | { id: number; type: "analysis"; report: AnalysisReport }
  | { id: number; type: "optimized"; result: OptimizeResult }
  | { id: number; type: "sampled"; result: SampleResult }
  | { id: number; type: "error"; code: ErrorCode; message: string };
