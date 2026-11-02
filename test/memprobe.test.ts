/**
 * Diagnostic (skipped by default): MEMPROBE=1 npx vitest run test/memprobe.test.ts --silent=false
 * Shows MuPDF's WASM heap growing across jobs in a single instance (it never shrinks
 * and fragments with large image buffers). This is why EngineClient recycles the
 * worker after every job.
 */
import { it } from "vitest";
import * as mupdf from "mupdf";
import { optimize, analyze } from "../src/engine/mupdfEngine";
import { optionsFor } from "../src/engine/profiles";
import { makeScanPdf } from "./fixtures";

/** Size of the WASM memory, read through any view MuPDF.js returns. */
function heapMB(): number {
  const p = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 1, 1], false);
  const n = p.getPixels().buffer.byteLength;
  p.destroy();
  return Math.round(n / 1048576);
}

it.skipIf(!process.env.MEMPROBE)("heap growth across jobs", async () => {
  const f = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 93, jpegChroma: "420", dpi: 72, size: [3024, 4032], pages: 2 });
  console.log("start heap MB", heapMB());
  for (let k = 0; k < 6; k++) {
    analyze(f);
    await optimize(f, optionsFor(k % 2 ? "compact" : "balanced"));
    console.log("after job", k + 1, "heap MB", heapMB());
  }
}, 600_000);
