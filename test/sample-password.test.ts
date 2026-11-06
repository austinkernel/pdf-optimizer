import { describe, it, expect, beforeAll } from "vitest";
import * as mupdf from "mupdf";
import { createHash } from "node:crypto";
import { analyze, optimize, samplePage, EngineError } from "../src/engine/mupdfEngine";
import { optionsFor } from "../src/engine/profiles";
import { makeScanPdf } from "./fixtures";

let scan: Uint8Array;
let locked: Uint8Array;
const PW = "s3cret pass";

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
function needsPassword(bytes: Uint8Array) {
  const d = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  const r = d.needsPassword();
  d.destroy();
  return r;
}

beforeAll(async () => {
  scan = await makeScanPdf({ mode: "color", encoding: "flate", pages: 2, links: true });
  const d = mupdf.Document.openDocument(scan, "application/pdf").asPDF()!;
  locked = d.saveToBuffer(`encrypt=aes-256,user-password=${PW},owner-password=owner-only`).asUint8Array().slice();
  d.destroy();
}, 120_000);

describe("sample page", () => {
  it("compresses one page, renders both versions, and leaves the input untouched", async () => {
    const before = createHash("sha256").update(scan).digest("hex");
    const r = await samplePage(scan, optionsFor("balanced"), null, 800);
    expect(isPng(r.original.png) && isPng(r.compressed.png)).toBe(true);
    expect(r.compressed.width).toBe(r.original.width);
    expect(r.compressed.height).toBe(r.original.height);
    expect(Math.max(r.original.width, r.original.height)).toBe(800);
    expect(r.pageCount).toBe(2);
    expect(r.imageCount).toBe(1);
    expect(r.imageBytesAfter).toBeLessThan(r.imageBytesBefore * 0.5);
    expect(r.outcomes[0].decision).toBe("recompressed");
    expect(createHash("sha256").update(scan).digest("hex")).toBe(before); // input bytes unchanged
  }, 60_000);
  it("samples the requested page and reports kept images under Lossless", async () => {
    const r = await samplePage(scan, optionsFor("lossless"), 1, 400);
    expect(r.pageIndex).toBe(1);
    expect(r.imageBytesAfter).toBe(r.imageBytesBefore);
    expect(r.outcomes[0].decision).toBe("kept-profile");
  }, 60_000);
});

describe("password-protected PDFs", () => {
  it("asks for a password, rejects a wrong one, opens with the right one", () => {
    expect(() => analyze(locked)).toThrow(EngineError);
    try {
      analyze(locked);
    } catch (e) {
      expect((e as EngineError).code).toBe("password");
    }
    try {
      analyze(locked, undefined, "wrong");
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("wrong-password");
    }
    const r = analyze(locked, undefined, PW);
    expect(r.pageCount).toBe(2);
    expect(r.features.needsPassword).toBe(true);
    expect(r.features.encrypted).toBe(true);
  });
  it("keeps the same password on the compressed copy by default", async () => {
    const r = await optimize(locked, optionsFor("balanced"), undefined, { password: PW });
    expect(r.verified).toBe(true);
    expect(r.password).toBe("kept");
    expect(r.outputBytes).toBeLessThan(r.inputBytes * 0.5);
    expect(needsPassword(r.bytes)).toBe(true);
    expect(analyze(r.bytes, undefined, PW).pageCount).toBe(2);
  }, 60_000);
  it("can save the compressed copy without a password", async () => {
    const r = await optimize(locked, optionsFor("balanced"), undefined, { password: PW, removePassword: true });
    expect(r.verified).toBe(true);
    expect(r.password).toBe("removed");
    expect(needsPassword(r.bytes)).toBe(false);
  }, 60_000);
  it("samples a page of a password-protected PDF", async () => {
    const r = await samplePage(locked, optionsFor("compact"), 0, 400, PW);
    expect(isPng(r.compressed.png)).toBe(true);
  }, 60_000);
  it("reports 'none' for unprotected files", async () => {
    expect((await optimize(scan, optionsFor("lossless"))).password).toBe("none");
  }, 60_000);
});
