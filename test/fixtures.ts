/**
 * Synthetic "scanned" PDF fixtures, generated with MuPDF so tests need no
 * external tools or committed binaries (and no personal documents).
 *
 * Each page is a full-page raster rendered from vector text and shapes at the
 * requested DPI, with sensor-like noise. On top sits an invisible OCR text
 * layer (text render mode 3) with the same words, which is how OCR'd scans are
 * built. Optional extras: URI links, outline, annotations, /Rotate.
 */
import * as mupdf from "mupdf";
import { encodeJpeg } from "../src/engine/jpegEncoder.ts";

export interface FixtureSpec {
  mode: "color" | "gray" | "bilevel";
  encoding: "jpeg" | "flate";
  pages?: number;
  dpi?: number;
  jpegQuality?: number;
  /** "420" encodes like a phone/scanner app (mozjpeg, 4:2:0). Default "444" (MuPDF encoder). */
  jpegChroma?: "420" | "444";
  rotate?: 0 | 90 | 180 | 270;
  links?: boolean;
  outline?: boolean;
  annotation?: boolean;
  /** Width/height in points (default US Letter). */
  size?: [number, number];
  title?: string;
}

const WORDS =
  "the quick brown fox jumps over lazy dog invoice total amount due payment reference account statement balance".split(" ");

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function pdfString(s: string) {
  return `(${s.replace(/[\\()]/g, (c) => "\\" + c)})`;
}

function textLines(seed: number, height: number): { x: number; y: number; text: string }[] {
  const r = rng(seed + 1);
  const lines = [];
  for (let y = height - 72; y > 220; y -= 16) {
    const words = Array.from({ length: 9 }, () => WORDS[Math.floor(r() * WORDS.length)]);
    lines.push({ x: 54, y, text: words.join(" ") });
  }
  return lines;
}

/** Renders the visible page (what the scanner "saw") to a pixmap. */
function renderSource(w: number, h: number, seed: number, mode: FixtureSpec["mode"], dpi: number): mupdf.Pixmap {
  const src = new mupdf.PDFDocument();
  try {
    const font = src.addSimpleFont(new mupdf.Font("Times-Roman"));
    const ops: string[] = [];
    if (mode !== "bilevel") {
      // "photo" block: stepped gradient, plus a red stamp outline
      for (let k = 0; k < 24; k++) {
        ops.push(`${(k / 24).toFixed(3)} ${(0.3 + k / 48).toFixed(3)} ${(1 - k / 24).toFixed(3)} rg ${150 + k * 15} 60 15 130 re f`);
      }
      ops.push("0.75 0.1 0.15 RG 4 w 70 120 m 130 120 l 130 180 l 70 180 l h S");
    }
    ops.push("0.1 0.1 0.12 rg BT /F1 11 Tf");
    for (const l of textLines(seed, h)) ops.push(`1 0 0 1 ${l.x} ${l.y} Tm ${pdfString(l.text)} Tj`);
    ops.push("ET");
    const res = src.addObject({ Font: { F1: font } });
    src.insertPage(-1, src.addPage([0, 0, w, h], 0, res, ops.join("\n")));
    const page = src.loadPage(0);
    const s = dpi / 72;
    const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
    page.destroy();
    return pix;
  } finally {
    src.destroy();
  }
}

/** Adds paper tone + gaussian-ish sensor noise in place. */
function addNoise(pix: mupdf.Pixmap, seed: number) {
  const r = rng(seed + 99);
  const px = pix.getPixels();
  for (let i = 0; i < px.length; i++) {
    const noise = (r() + r() + r() - 1.5) * 8;
    const v = px[i] === 255 ? 244 : px[i]; // off-white paper
    px[i] = v + noise;
  }
}

function toGray(pix: mupdf.Pixmap): mupdf.Pixmap {
  return pix.convertToColorSpace(mupdf.ColorSpace.DeviceGray);
}

function packBilevel(gray: mupdf.Pixmap): Uint8Array {
  const w = gray.getWidth();
  const h = gray.getHeight();
  const stride = gray.getStride();
  const px = gray.getPixels();
  const rowBytes = (w + 7) >> 3;
  const out = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (px[y * stride + x] > 150) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

function rawPixels(pix: mupdf.Pixmap): Uint8Array {
  const w = pix.getWidth() * pix.getNumberOfComponents();
  const h = pix.getHeight();
  const stride = pix.getStride();
  const px = pix.getPixels();
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(px.subarray(y * stride, y * stride + w), y * w);
  return out;
}

export async function makeScanPdf(spec: FixtureSpec): Promise<Uint8Array> {
  const pages = spec.pages ?? 2;
  const dpi = spec.dpi ?? 300;
  const [w, h] = spec.size ?? [612, 792];
  const doc = new mupdf.PDFDocument();
  try {
    const ocrFont = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    for (let p = 0; p < pages; p++) {
      let pix = renderSource(w, h, p, spec.mode, dpi);
      addNoise(pix, p);
      let imgRef: mupdf.PDFObject;
      const pw = pix.getWidth();
      const ph = pix.getHeight();
      if (spec.mode === "bilevel") {
        const g = toGray(pix);
        const bits = packBilevel(g);
        g.destroy();
        imgRef = doc.addStream(bits, {
          Type: "XObject", Subtype: "Image", Width: pw, Height: ph, ColorSpace: "DeviceGray", BitsPerComponent: 1,
        });
      } else {
        if (spec.mode === "gray") {
          const g = toGray(pix);
          pix.destroy();
          pix = g;
        }
        const cs = spec.mode === "gray" ? "DeviceGray" : "DeviceRGB";
        const dict = { Type: "XObject", Subtype: "Image", Width: pw, Height: ph, ColorSpace: cs, BitsPerComponent: 8 };
        if (spec.encoding === "jpeg") {
          const q = spec.jpegQuality ?? 97;
          const jpg = spec.jpegChroma === "420" ? (await encodeJpeg(pix, q, "420")).bytes : pix.asJPEG(q, false);
          imgRef = doc.addRawStream(jpg, { ...dict, Filter: "DCTDecode" });
        } else {
          imgRef = doc.addStream(rawPixels(pix), dict); // compressed with Flate on save
        }
      }
      pix.destroy();
      // (MuPDF.js converts plain JS strings in dictionaries to PDF names.)
      const ops = [`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`, "BT 3 Tr /F1 11 Tf"];
      for (const l of textLines(p, h)) ops.push(`1 0 0 1 ${l.x} ${l.y} Tm ${pdfString(l.text)} Tj`);
      ops.push("ET");
      const res = doc.addObject({ XObject: { Im0: imgRef }, Font: { F1: ocrFont } });
      doc.insertPage(-1, doc.addPage([0, 0, w, h], spec.rotate ?? 0, res, ops.join("\n")));
    }
    for (let p = 0; p < pages; p++) {
      const page = doc.loadPage(p) as mupdf.PDFPage;
      if (spec.links) page.createLink([40, 40, 200, 60], `https://example.com/page${p + 1}`);
      if (spec.annotation) {
        const a = page.createAnnotation("Text");
        a.setRect([300, 300, 320, 320]);
        a.setContents(`Note on page ${p + 1}`);
        a.update();
      }
      page.destroy();
    }
    if (spec.outline) {
      const it = doc.outlineIterator();
      for (let p = pages - 1; p >= 0; p--) it.insert({ title: `Section ${p + 1}`, uri: `#page=${p + 1}`, open: true });
      it.destroy();
    }
    doc.setMetaData("info:Title", spec.title ?? `${spec.mode}-${spec.encoding}`);
    const buf = doc.saveToBuffer("compress");
    const out = buf.asUint8Array().slice();
    buf.destroy();
    return out;
  } finally {
    doc.destroy();
  }
}
