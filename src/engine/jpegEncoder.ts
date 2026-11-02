/**
 * JPEG encoding for recompressed images.
 *
 * MuPDF's built-in encoder always writes 4:4:4 (full-resolution chroma). Phone
 * and scanner JPEGs are almost always 4:2:0, so re-encoding them with MuPDF
 * spends roughly a third of the bytes on colour detail the source no longer
 * has. mozjpeg (WASM, Apache-2.0) supports 4:2:0 plus trellis quantisation and
 * optimised Huffman tables.
 *
 * Measured on a q95 4:2:0 scan re-encoded at q90: mozjpeg 4:2:0 saves 48.5%,
 * MuPDF 4:4:4 saves 27%, at the same SSIM (docs/milestone-2-poc.md, addendum).
 *
 * The standard Annex K quantisation tables are used (quant_table 0), so the
 * quality numbers keep their usual IJG meaning. That matches jpegQuality.ts,
 * which the "don't re-encode" rule relies on.
 */
import encode, { init } from "@jsquash/jpeg/encode.js";
import type * as mupdf from "mupdf";

let ready: Promise<void> | null = null;

/** Tests (Node) pass a compiled module. The browser build lets the codec fetch its own .wasm. */
export function configureJpegEncoder(module?: WebAssembly.Module): Promise<void> {
  ready = module ? init(module) : init();
  return ready;
}

/** Above this many pixels, the RGBA copies mozjpeg needs (~8 bytes/pixel) risk iOS memory limits. */
export const MOZJPEG_MAX_PIXELS = 40_000_000;

export type Chroma = "420" | "444";

export interface EncodedJpeg {
  bytes: Uint8Array;
  encoder: "mozjpeg" | "mupdf";
  chroma: Chroma | "gray";
}

/**
 * Encodes a Gray or RGB pixmap (no alpha). Falls back to MuPDF's encoder for
 * very large images, or if mozjpeg fails (for example out of memory).
 */
export async function encodeJpeg(pix: mupdf.Pixmap, quality: number, chroma: Chroma): Promise<EncodedJpeg> {
  const w = pix.getWidth();
  const h = pix.getHeight();
  const n = pix.getNumberOfComponents();
  const gray = n === 1;
  if (w * h <= MOZJPEG_MAX_PIXELS) {
    try {
      if (!ready) configureJpegEncoder();
      await ready;
      // Expand to RGBA, the only input layout the codec accepts. Read the WASM view
      // in one pass, with no MuPDF allocation in between (views detach on heap growth).
      const stride = pix.getStride();
      const src = pix.getPixels();
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        let s = y * stride;
        let d = y * w * 4;
        if (gray) {
          for (let x = 0; x < w; x++, s++, d += 4) {
            const v = src[s];
            rgba[d] = v;
            rgba[d + 1] = v;
            rgba[d + 2] = v;
            rgba[d + 3] = 255;
          }
        } else {
          for (let x = 0; x < w; x++, s += 3, d += 4) {
            rgba[d] = src[s];
            rgba[d + 1] = src[s + 1];
            rgba[d + 2] = src[s + 2];
            rgba[d + 3] = 255;
          }
        }
      }
      const out = await encode({ data: rgba, width: w, height: h, colorSpace: "srgb" } as ImageData, {
        quality,
        quant_table: 0,
        color_space: gray ? 1 : 3, // GRAYSCALE : YCbCr
        chroma_subsample: chroma === "420" ? 2 : 1,
        auto_subsample: false,
        progressive: false, // sequential: the most widely supported DCT variant in PDF readers
        baseline: false,
        optimize_coding: true,
      });
      return { bytes: new Uint8Array(out), encoder: "mozjpeg", chroma: gray ? "gray" : chroma };
    } catch {
      /* fall through to MuPDF */
    }
  }
  return { bytes: pix.asJPEG(quality, false), encoder: "mupdf", chroma: gray ? "gray" : "444" };
}

/** Chroma layout of an existing JPEG stream (from its SOF marker), or null. */
export function jpegChroma(jpeg: Uint8Array): Chroma | "gray" | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const m = jpeg[i + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2;
      continue;
    }
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const nc = jpeg[i + 9];
      if (nc === 1) return "gray";
      const s0 = jpeg[i + 11];
      for (let k = 1; k < nc; k++) if (jpeg[i + 11 + k * 3] !== s0) return "420";
      return "444";
    }
    if (m === 0xda) return null;
    i += 2 + len;
  }
  return null;
}
