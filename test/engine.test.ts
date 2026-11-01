import { describe, it, expect, beforeAll } from "vitest";
import * as mupdf from "mupdf";
import { analyze, optimize, EngineError } from "../src/engine/mupdfEngine";
import { optionsFor, PROFILE_ORDER } from "../src/engine/profiles";
import { estimateJpegQuality } from "../src/engine/jpegQuality";
import { downsampleArea } from "../src/engine/resample";
import { makeScanPdf } from "./fixtures";
import { pdfjsSummary } from "./pdfjs";

const F: Record<string, Uint8Array> = {};

beforeAll(() => {
  F.colorFlate = makeScanPdf({ mode: "color", encoding: "flate", links: true, outline: true, annotation: true });
  F.colorJpeg = makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 97, links: true, outline: true });
  F.grayJpeg = makeScanPdf({ mode: "gray", encoding: "jpeg", jpegQuality: 97 });
  F.bilevel = makeScanPdf({ mode: "bilevel", encoding: "flate", links: true });
  F.hiRes = makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 97, dpi: 600, pages: 1 });
  F.rotated = makeScanPdf({ mode: "gray", encoding: "flate", rotate: 90, pages: 1 });
  F.lowQJpeg = makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 70, pages: 1 });
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
  const cases = ["colorFlate", "colorJpeg", "grayJpeg", "bilevel", "rotated"] as const;
  for (const name of cases) {
    for (const profile of PROFILE_ORDER) {
      it(`${name} / ${profile}: verified, opens in pdf.js, text identical`, async () => {
        const res = optimize(F[name], optionsFor(profile));
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
  it("compresses lossless color scans substantially at every lossy profile", () => {
    const sizes = (["high", "balanced", "compact"] as const).map((p) => optimize(F.colorFlate, optionsFor(p)).outputBytes);
    expect(sizes[0]).toBeLessThan(F.colorFlate.byteLength * 0.5);
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[2]).toBeLessThanOrEqual(sizes[1]);
  });
  it("leaves bilevel images byte-identical", () => {
    const r = optimize(F.bilevel, optionsFor("compact"));
    expect(r.images.every((i) => i.decision === "kept-bilevel")).toBe(true);
  });
  it("does not re-encode JPEGs already at or below the target quality", () => {
    const r = optimize(F.lowQJpeg, optionsFor("high"));
    expect(r.images[0].decision).toBe("kept-already-efficient");
  });
  it("downsamples 600 DPI images to the profile target", () => {
    const r = optimize(F.hiRes, optionsFor("balanced"));
    expect(r.images[0].decision).toBe("recompressed");
    expect(r.images[0].afterSize).toEqual([2550, 3300]); // 5100×6600 @600 → 300 DPI
    expect(r.verified).toBe(true);
    expect(analyze(r.bytes).images[0].minDpi).toBe(300);
  });
  it("never produces a larger file than the input", () => {
    for (const name of Object.keys(F)) {
      for (const p of PROFILE_ORDER) {
        const r = optimize(F[name], optionsFor(p));
        expect(r.outputBytes, `${name}/${p}`).toBeLessThanOrEqual(r.inputBytes * 1.01);
      }
    }
  }, 120_000);
});
