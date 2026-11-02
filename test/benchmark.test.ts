/**
 * Benchmark table (not part of the default run): BENCH=1 npx vitest run test/benchmark.test.ts
 * Node on a desktop CPU. iPhone timings will differ and are measured on-device.
 */
import { describe, it } from "vitest";
import { optimize } from "../src/engine/mupdfEngine";
import { optionsFor, PROFILE_ORDER } from "../src/engine/profiles";
import { makeScanPdf, type FixtureSpec } from "./fixtures";

const SPECS: [string, FixtureSpec][] = [
  ["color 300dpi Flate", { mode: "color", encoding: "flate", pages: 3 }],
  ["color 300dpi JPEG q97", { mode: "color", encoding: "jpeg", jpegQuality: 97, pages: 3 }],
  ["gray 300dpi JPEG q97", { mode: "gray", encoding: "jpeg", jpegQuality: 97, pages: 3 }],
  ["bilevel 300dpi Flate", { mode: "bilevel", encoding: "flate", pages: 3 }],
  ["color 600dpi JPEG q97", { mode: "color", encoding: "jpeg", jpegQuality: 97, dpi: 600, pages: 1 }],
  ["color 300dpi JPEG q75", { mode: "color", encoding: "jpeg", jpegQuality: 75, pages: 3 }],
  ["phone-style JPEG q92 4:2:0", { mode: "color", encoding: "jpeg", jpegQuality: 92, jpegChroma: "420", pages: 3 }],
  ["phone-style JPEG q85 4:2:0", { mode: "color", encoding: "jpeg", jpegQuality: 85, jpegChroma: "420", pages: 3 }],
];

describe.skipIf(!process.env.BENCH)("benchmark", () => {
  it("prints size/time table", async () => {
    const rows: string[] = ["| Fixture | Input | " + PROFILE_ORDER.join(" | ") + " |", "|---|---|" + PROFILE_ORDER.map(() => "---").join("|") + "|"];
    for (const [name, spec] of SPECS) {
      const input = await makeScanPdf(spec);
      const cells: string[] = [];
      for (const p of PROFILE_ORDER) {
        const r = await optimize(input, optionsFor(p));
        const red = (1 - r.outputBytes / r.inputBytes) * 100;
        cells.push(`${(r.outputBytes / 1e6).toFixed(2)} MB (−${red.toFixed(1)}%) ${(r.elapsedMs / 1000).toFixed(1)}s${r.verified ? "" : " ✕"}`);
      }
      rows.push(`| ${name} | ${(input.byteLength / 1e6).toFixed(2)} MB | ${cells.join(" | ")} |`);
    }
    console.log("\n" + rows.join("\n"));
  }, 600_000);
});
