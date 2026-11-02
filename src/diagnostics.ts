/**
 * Diagnostics report: describes a document's *structure* so problems can be
 * investigated without sharing the document.
 *
 * Deliberately excluded: the file name, metadata values (title, author,
 * subject, keywords, which can be personal), any text content, link targets,
 * and image pixels. Only the names of metadata fields that are present are
 * listed. The user sees the full report before sharing it.
 */
import type { AnalysisReport, OptimizeResult } from "./engine/types";
import { formatBytes, formatMs } from "./format";

export interface DiagnosticsContext {
  appVersion: string;
  buildVersion?: string;
  report: AnalysisReport;
  result?: OptimizeResult;
}

function line(label: string, value: unknown): string {
  return `${label.padEnd(18)} ${value}`;
}

export function buildDiagnostics(ctx: DiagnosticsContext): string {
  const r = ctx.report;
  const f = r.features;
  const out: string[] = [];
  out.push("PDF Optimizer diagnostics");
  out.push("Contains document structure only: no file name, text, metadata values, links or images.");
  out.push("");
  out.push("[app]");
  out.push(line("version", `${ctx.appVersion}${ctx.buildVersion ? ` (${ctx.buildVersion})` : ""}`));
  out.push(line("engine", "MuPDF 1.28 (WASM) + mozjpeg (WASM)"));
  out.push(line("user agent", navigator.userAgent));
  out.push(line("generated", new Date().toISOString()));
  out.push("");
  out.push("[document]");
  out.push(line("size", `${formatBytes(r.fileBytes)} (${r.fileBytes} bytes)`));
  out.push(line("pdf version", r.pdfVersion));
  out.push(line("pages", r.pageCount));
  out.push(line("pages with text", `${r.pagesWithText} (${r.totalTextChars} chars)`));
  out.push(line("scanned pages", r.pages.filter((p) => p.scanned).length));
  out.push(line("image bytes", `${formatBytes(r.imageBytes)} (${((r.imageBytes / Math.max(1, r.fileBytes)) * 100).toFixed(1)}% of file)`));
  out.push("");
  out.push("[features]");
  out.push(line("encrypted", f.encrypted));
  out.push(line("outline items", f.outlineItems));
  out.push(line("links", f.links));
  out.push(line("annotations", Object.entries(f.annotations).map(([k, v]) => `${k}:${v}`).join(", ") || "none"));
  out.push(line("form fields", f.formFields));
  out.push(line("signature fields", f.signatureFields));
  out.push(line("embedded files", f.embeddedFiles));
  out.push(line("javascript", f.javascript));
  out.push(line("optional content", f.optionalContent));
  out.push(line("tagged", f.tagged));
  out.push(line("pdf/a", f.pdfaPart ?? "no"));
  out.push(line("metadata fields", Object.keys(f.metadata).join(", ") || "none"));
  out.push("");
  out.push("[pages]  index  width×height pt  rotation  orientation  scanned  textChars");
  for (const p of r.pages) {
    out.push(`  ${String(p.index + 1).padStart(4)}  ${`${p.widthPt}×${p.heightPt}`.padEnd(17)} ${String(p.rotation).padEnd(9)} ${p.orientation.padEnd(12)} ${String(p.scanned).padEnd(8)} ${p.textChars}`);
  }
  out.push("");
  out.push("[images]  obj  pixels  bpc  colorspace  class  filters  bytes  dpi(page)  dpi(effective)  oversized  jpegQ  chroma  mask");
  for (const i of r.images) {
    out.push(
      [
        "  " + String(i.objNum).padStart(5),
        `${i.width}×${i.height}`,
        i.bitsPerComponent,
        i.colorSpace,
        i.colorClass,
        i.filters.join("+") || "none",
        i.storedBytes,
        i.minDpi === null ? "-" : i.minDpi === i.maxDpi ? i.minDpi : `${i.minDpi}-${i.maxDpi}`,
        i.minEffectiveDpi === null ? "-" : i.minEffectiveDpi === i.maxEffectiveDpi ? i.minEffectiveDpi : `${i.minEffectiveDpi}-${i.maxEffectiveDpi}`,
        i.onOversizedPage,
        i.jpegQualityEstimate ?? "-",
        i.jpegChroma ?? "-",
        i.isMask || i.hasSoftMask,
      ].join("  "),
    );
  }
  if (r.warnings.length) {
    out.push("");
    out.push("[warnings]");
    for (const w of r.warnings) out.push(`  - ${w}`);
  }
  const res = ctx.result;
  if (res) {
    out.push("");
    out.push("[last compression]");
    out.push(line("profile", res.options.profile));
    out.push(line("options", JSON.stringify(res.options)));
    out.push(line("input", `${res.inputBytes} bytes`));
    out.push(line("output", `${res.outputBytes} bytes (${((1 - res.outputBytes / res.inputBytes) * 100).toFixed(1)}% smaller)`));
    out.push(line("time", formatMs(res.elapsedMs)));
    out.push(line("save options", res.saveOptions));
    out.push(line("verified", res.verified));
    out.push(line("network (worker)", res.workerNetworkRequests ?? "n/a"));
    out.push("  checks:");
    for (const c of res.verification) out.push(`    ${c.ok ? "PASS" : "FAIL"}  ${c.id}: ${c.detail}`);
    out.push("  images:  obj  decision  before→after bytes  before→after pixels  detail");
    for (const i of res.images) {
      out.push(`    ${String(i.objNum).padStart(5)}  ${i.decision}  ${i.beforeBytes}→${i.afterBytes}  ${i.beforeSize.join("×")}→${i.afterSize.join("×")}  ${i.detail ?? ""}`);
    }
  }
  return out.join("\n") + "\n";
}
