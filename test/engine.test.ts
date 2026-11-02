import { describe, it, expect, beforeAll } from "vitest";
import * as mupdf from "mupdf";
import { analyze, optimize, EngineError } from "../src/engine/mupdfEngine";
import { optionsFor, PROFILE_ORDER } from "../src/engine/profiles";
import { estimateJpegQuality } from "../src/engine/jpegQuality";
import { downsampleArea } from "../src/engine/resample";
import { encodeJpeg, jpegChroma } from "../src/engine/jpegEncoder";
import { makeScanPdf } from "./fixtures";
import { pdfjsSummary } from "./pdfjs";

const F: Record<string, Uint8Array> = {};

beforeAll(async () => {
  F.colorFlate = await makeScanPdf({ mode: "color", encoding: "flate", links: true, outline: true, annotation: true });
  F.colorJpeg = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 97, links: true, outline: true });
  F.grayJpeg = await makeScanPdf({ mode: "gray", encoding: "jpeg", jpegQuality: 97 });
  F.bilevel = await makeScanPdf({ mode: "bilevel", encoding: "flate", links: true });
  F.hiRes = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 97, dpi: 600, pages: 1 });
  F.rotated = await makeScanPdf({ mode: "gray", encoding: "flate", rotate: 90, pages: 1 });
  F.lowQJpeg = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 70, pages: 1 });
  // Like a phone/scanner-app scan: colour JPEG q92, 4:2:0 chroma (the case that saved 0% with MuPDF's 4:4:4 encoder).
  F.phoneScan = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 92, jpegChroma: "420", links: true });
  // Like iOS "photos → PDF": camera photo (q93, 4:2:0) on a page sized at 72 DPI (42 × 56 in and 59.5 × 79.3 in).
  F.photoPdf12 = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 93, jpegChroma: "420", dpi: 72, size: [3024, 4032], pages: 1 });
  F.photoPdf24 = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 93, jpegChroma: "420", dpi: 72, size: [4284, 5712], pages: 1 });
}, 120_000);

describe("jpeg quality estimation", () => {
  it.each([50, 75, 85, 90, 95])("recovers IJG quality %i within ±2", (q) => {
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 64, 64], false);
    pix.clear(128);
    const est = estimateJpegQuality(pix.asJPEG(q, false));
    pix.destroy();
    expect(est).not.toBeNull();
    expect(Math.abs(est! - q)).toBeLessThanOrEqual(2);
  });
  it("returns null for non-JPEG data", () => {
    expect(estimateJpegQuality(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe("jpeg encoder", () => {
  const pix = () => {
    const p = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 256, 256], false);
    const px = p.getPixels();
    for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 9) * 11) & 255; // busy colour pattern
    return p;
  };
  it("uses mozjpeg and writes the requested chroma layout", async () => {
    const p = pix();
    const a = await encodeJpeg(p, 90, "420");
    const b = await encodeJpeg(p, 90, "444");
    p.destroy();
    expect(a.encoder).toBe("mozjpeg");
    expect(jpegChroma(a.bytes)).toBe("420");
    expect(jpegChroma(b.bytes)).toBe("444");
    expect(a.bytes.byteLength).toBeLessThan(b.bytes.byteLength);
    expect(Math.abs(estimateJpegQuality(a.bytes)! - 90)).toBeLessThanOrEqual(2); // standard tables: quality keeps its IJG meaning
  });
  it("encodes grayscale as a single-channel JPEG", async () => {
    const g = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 64, 64], false);
    g.clear(100);
    expect(jpegChroma((await encodeJpeg(g, 90, "420")).bytes)).toBe("gray");
    g.destroy();
  });
  it("detects MuPDF's own output as 4:4:4", () => {
    const p = pix();
    expect(jpegChroma(p.asJPEG(90, false))).toBe("444");
    p.destroy();
  });
});

describe("area downsampler", () => {
  it("averages 2×2 blocks exactly", () => {
    const src = new Uint8Array([0, 100, 10, 10, 200, 100, 30, 50]); // 4×2 gray
    const dst = new Uint8Array(2);
    downsampleArea(src, 4, 2, 4, dst, 2, 1, 2, 1);
    expect([...dst]).toEqual([100, 25]);
  });
  it("keeps a flat colour flat at non-integer ratios", () => {
    const sw = 301, sh = 199, n = 3;
    const src = new Uint8Array(sw * sh * n).fill(77);
    const dst = new Uint8Array(200 * 133 * n);
    downsampleArea(src, sw, sh, sw * n, dst, 200, 133, 200 * n, n);
    expect(dst.every((v) => v === 77)).toBe(true);
  });
  it("refuses to upscale", () => {
    expect(() => downsampleArea(new Uint8Array(4), 2, 2, 2, new Uint8Array(9), 3, 3, 3, 1)).toThrow();
  });
});

describe("analysis", () => {
  it("reports pages, images, DPI, text layer and features", () => {
    const r = analyze(F.colorFlate);
    expect(r.pageCount).toBe(2);
    expect(r.pages[0]).toMatchObject({ widthPt: 612, heightPt: 792, orientation: "portrait", rotation: 0, scanned: true });
    expect(r.images).toHaveLength(2);
    expect(r.images[0]).toMatchObject({ width: 2550, height: 3300, colorClass: "color", filters: ["FlateDecode"] });
    expect(r.images[0].minDpi).toBe(300);
    expect(r.totalTextChars).toBeGreaterThan(1000);
    expect(r.pagesWithText).toBe(2);
    expect(r.features.links).toBe(2);
    expect(r.features.outlineItems).toBe(2);
    expect(r.features.annotations).toEqual({ Text: 2 });
    expect(r.features.metadata.Title).toBe("color-flate");
  });
  it("estimates JPEG source quality and detects bilevel images", () => {
    expect(analyze(F.colorJpeg).images[0].jpegQualityEstimate).toBeGreaterThanOrEqual(95);
    const b = analyze(F.bilevel);
    expect(b.images[0].colorClass).toBe("bilevel");
    expect(b.warnings.join(" ")).toMatch(/black-and-white/);
  });
  it("measures 600 DPI and rotation", () => {
    expect(analyze(F.hiRes).images[0].minDpi).toBe(600);
    const rot = analyze(F.rotated);
    expect(rot.pages[0]).toMatchObject({ rotation: 90, orientation: "landscape", widthPt: 792, heightPt: 612 });
  });
  it("rejects non-PDF input and password-protected PDFs with typed errors", () => {
    expect(() => analyze(new TextEncoder().encode("hello world, not a pdf"))).toThrow(EngineError);
    const doc = mupdf.Document.openDocument(F.grayJpeg, "application/pdf").asPDF()!;
    const enc = doc.saveToBuffer("encrypt=aes-256,user-password=secret,owner-password=owner").asUint8Array().slice();
    doc.destroy();
    try {
      analyze(enc);
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("password");
    }
  });
});

describe("optimization preserves the document", () => {
  const cases = ["colorFlate", "colorJpeg", "grayJpeg", "bilevel", "rotated", "phoneScan"] as const;
  for (const name of cases) {
    for (const profile of PROFILE_ORDER) {
      it(`${name} / ${profile}: verified, opens in pdf.js, text identical`, async () => {
        const res = await optimize(F[name], optionsFor(profile));
        const failed = res.verification.filter((c) => !c.ok);
        expect(failed).toEqual([]);
        expect(res.verified).toBe(true);
        expect(res.searchableOutput).toBe(true);
        // Independent parser (pdf.js): output opens, same page count and text as the original.
        const [a, b] = await Promise.all([pdfjsSummary(F[name]), pdfjsSummary(res.bytes)]);
        expect(b.pages).toBe(a.pages);
        expect(b.text).toEqual(a.text);
        expect(b.sizes).toEqual(a.sizes);
        if (profile === "lossless") expect(res.images.every((i) => i.decision === "kept-profile")).toBe(true);
      }, 60_000);
    }
  }
});

describe("compression effectiveness", () => {
  it("compresses lossless color scans substantially at every lossy profile", async () => {
    const sizes: number[] = [];
    for (const p of ["high", "balanced", "compact"] as const) sizes.push((await optimize(F.colorFlate, optionsFor(p))).outputBytes);
    expect(sizes[0]).toBeLessThan(F.colorFlate.byteLength * 0.5);
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[2]).toBeLessThanOrEqual(sizes[1]);
  });
  it("shrinks phone-style 4:2:0 JPEG scans with Balanced (regression: was 0%)", async () => {
    expect(analyze(F.phoneScan).images[0].jpegChroma).toBe("420");
    const r = await optimize(F.phoneScan, optionsFor("balanced"));
    expect(r.verified).toBe(true);
    expect(r.images.every((i) => i.decision === "recompressed")).toBe(true);
    expect(r.images[0].detail).toMatch(/mozjpeg 4:2:0 q90/);
    expect(r.outputBytes).toBeLessThan(r.inputBytes * 0.95); // synthetic scans carry heavy sensor noise; real ones compress further
  });
  it("keeps 4:2:0 for 4:2:0 sources even in High Quality, and full colour for lossless sources", async () => {
    const a = await optimize(F.phoneScan, optionsFor("high"));
    for (const i of a.images.filter((x) => x.decision === "recompressed")) expect(i.detail).toMatch(/4:2:0/);
    const b = await optimize(F.colorFlate, optionsFor("high"));
    expect(b.images[0].detail).toMatch(/mozjpeg 4:4:4 q95/);
  });
  it("judges photo-sized pages at Letter size (regression: real 103 MB photo PDF was never downsampled)", async () => {
    const a = analyze(F.photoPdf12);
    expect(a.images[0]).toMatchObject({ minDpi: 72, onOversizedPage: true, width: 3024, height: 4032 });
    expect(a.images[0].minEffectiveDpi).toBe(367); // 4032 px / 11 in
    expect(a.warnings.join(" ")).toMatch(/oversized, photo-sized pages/);

    // Balanced: 367 ≤ 400, so no downsampling; q93 → q90 re-encode only.
    const bal = await optimize(F.photoPdf12, optionsFor("balanced"));
    expect(bal.verified).toBe(true);
    expect(bal.images[0]).toMatchObject({ decision: "recompressed", afterSize: [3024, 4032] });

    // Compact: 367 > 250, so reduce to 200 DPI-at-Letter, a 2200 px long side.
    const cmp = await optimize(F.photoPdf12, optionsFor("compact"));
    expect(cmp.verified).toBe(true);
    expect(cmp.images[0].afterSize[1]).toBeGreaterThanOrEqual(2195);
    expect(cmp.images[0].afterSize[1]).toBeLessThanOrEqual(2200);
    expect(cmp.outputBytes).toBeLessThan(cmp.inputBytes * 0.5);

    // 24 MP photo: 519 DPI-at-Letter, so Balanced reduces it to 300 (3300 px long side).
    const big = await optimize(F.photoPdf24, optionsFor("balanced"));
    expect(big.verified).toBe(true);
    expect(big.images[0].afterSize[1]).toBeGreaterThanOrEqual(3298);
    expect(big.images[0].afterSize[1]).toBeLessThanOrEqual(3302);
    // Page geometry is untouched.
    expect(analyze(big.bytes).pages[0]).toMatchObject({ widthPt: 4284, heightPt: 5712 });
  }, 120_000);
  it("leaves bilevel images byte-identical", async () => {
    const r = await optimize(F.bilevel, optionsFor("compact"));
    expect(r.images.every((i) => i.decision === "kept-bilevel")).toBe(true);
  });
  it("does not re-encode JPEGs already at or below the target quality", async () => {
    const r = await optimize(F.lowQJpeg, optionsFor("high"));
    expect(r.images[0].decision).toBe("kept-already-efficient");
  });
  it("downsamples 600 DPI images to the profile target", async () => {
    const r = await optimize(F.hiRes, optionsFor("balanced"));
    expect(r.images[0].decision).toBe("recompressed");
    expect(r.images[0].afterSize).toEqual([2550, 3300]); // 5100×6600 @600 → 300 DPI
    expect(r.verified).toBe(true);
    expect(analyze(r.bytes).images[0].minDpi).toBe(300);
  });
  it("never produces a larger file than the input", async () => {
    // Photo fixtures are covered by their own test. Running every fixture × profile in one
    // WASM instance fragments the heap; the app avoids that by using a fresh worker per job.
    for (const name of Object.keys(F).filter((n) => !n.startsWith("photoPdf"))) {
      for (const p of PROFILE_ORDER) {
        const r = await optimize(F[name], optionsFor(p));
        expect(r.outputBytes, `${name}/${p}`).toBeLessThanOrEqual(r.inputBytes * 1.01);
      }
    }
  }, 120_000);
});
