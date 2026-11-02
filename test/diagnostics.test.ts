import { describe, it, expect, beforeAll } from "vitest";
import { analyze, optimize } from "../src/engine/mupdfEngine";
import { optionsFor } from "../src/engine/profiles";
import { buildDiagnostics } from "../src/diagnostics";
import { makeScanPdf } from "./fixtures";

let pdf: Uint8Array;
beforeAll(async () => {
  pdf = await makeScanPdf({ mode: "color", encoding: "jpeg", jpegQuality: 93, jpegChroma: "420", links: true, outline: true, annotation: true, title: "Private Title 12345" });
});

describe("diagnostics report", () => {
  it("describes structure and the last compression", async () => {
    const report = analyze(pdf);
    const result = await optimize(pdf, optionsFor("balanced"));
    const text = buildDiagnostics({ appVersion: "test", report, result });
    for (const s of ["[document]", "[features]", "[pages]", "[images]", "[last compression]", "DCTDecode", "420", "recompressed", "PASS"]) expect(text).toContain(s);
    expect(text).toMatch(/metadata fields\s+Title/); // field name only
  });
  it("never contains metadata values, text content or link targets", async () => {
    const text = buildDiagnostics({ appVersion: "test", report: analyze(pdf) });
    expect(text).not.toContain("Private Title 12345");
    expect(text).not.toContain("example.com"); // link URIs in the fixture
    expect(text).not.toMatch(/invoice|payment|statement/i); // words of the OCR text layer
  });
});
