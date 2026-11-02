// End-to-end test of the built PWA in headless Chromium with an iPhone-sized viewport.
// Usage: npm run build && node --experimental-strip-types scripts/e2e.mjs [screenshotDir]
// (Chromium, not WebKit: iOS-specific behaviour still needs an on-device check.)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preview } from "vite";
import { createRequire } from "node:module";
// Playwright is provided by the environment (globally installed), not a project dependency.
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { makeScanPdf } from "../test/fixtures.ts";

const shots = process.argv[2] ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const work = join(tmpdir(), `pdfopt-e2e-${process.pid}`);
mkdirSync(work, { recursive: true });
const small = join(work, "scan-color.pdf");
const big = join(work, "scan-big.pdf");
writeFileSync(small, await makeScanPdf({ mode: "color", encoding: "flate", links: true, outline: true, pages: 2 }));
writeFileSync(big, await makeScanPdf({ mode: "color", encoding: "flate", pages: 6 }));

const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "warn" });
const url = "http://localhost:4317/";
const browser = await chromium.launch();
const iphone = devices["iPhone 15"] ?? devices["iPhone 13"];
const ctx = await browser.newContext({ ...iphone, colorScheme: "light" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// (MuPDF logs parser diagnostics via console.error for damaged input; those are expected, so only uncaught errors count.)
let recording = false;
const requestsDuringJob = [];
const allRequests = [];
ctx.on("request", (r) => {
  allRequests.push({ url: r.url(), method: r.method(), hasBody: !!r.postDataBuffer() });
  if (recording) requestsDuringJob.push(r.url());
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

/** Waits until no request has been seen for `ms` (the engine worker has finished loading its own files). */
let lastRequestAt = Date.now();
ctx.on("request", () => (lastRequestAt = Date.now()));
async function networkQuiet(ms = 1500) {
  while (Date.now() - lastRequestAt < ms) await page.waitForTimeout(200);
}

/** The update popup can legitimately appear over any screen; close it if present. */
async function dismissUpdateIfShown() {
  const later = page.getByRole("button", { name: "Later" });
  if (await later.isVisible().catch(() => false)) await later.click();
}

async function compressFile(file, { shotPrefix } = {}) {
  await dismissUpdateIfShown();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
  if (shots && shotPrefix) await page.screenshot({ path: join(shots, `${shotPrefix}-analysis.png`), fullPage: true });
  await page.getByRole("radio", { name: /Balanced/ }).click();
  await networkQuiet();
  await dismissUpdateIfShown();
  recording = true;
  await page.getByRole("button", { name: "Compress" }).click();
  await page.locator(".hero-number").waitFor({ timeout: 120_000 });
  recording = false;
  if (shots && shotPrefix) await page.screenshot({ path: join(shots, `${shotPrefix}-results.png`), fullPage: true });
}

try {
  await page.goto(url);
  if (shots) await page.screenshot({ path: join(shots, "1-home.png") });
  check("home screen shows primary action", await page.getByRole("button", { name: "Choose PDF" }).isVisible());

  // Wait for the service worker to install and precache everything.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await page.reload(); // page is now controlled by the SW
  const swControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check("service worker controls the page", swControlled);

  // Updates: manual check against an unchanged server reports up to date.
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByText(/Up to date/).waitFor({ timeout: 15_000 });
  check("manual update check reports up to date", true);

  await compressFile(small, { shotPrefix: "2" });
  const hero = await page.locator(".hero-number").innerText();
  const statuses = await page.locator(".check-row .status").allInnerTexts();
  check("compression reports a real reduction", /^−\d/.test(hero), hero);
  check("all verification checks pass in the browser", statuses.length > 5 && statuses.every((s) => s === "✓"), `${statuses.length} checks`);
  check("no network requests during processing", requestsDuringJob.length === 0, requestsDuringJob.join(", "));
  const foot = await page.locator("p.footnote", { hasText: "Network requests during processing" }).innerText();
  check("in-app network counters read 0/0", /0 from the app page,\s*0 from the engine/.test(foot), foot.replace(/\s+/g, " "));

  // Download produces a valid PDF of the reported size.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const out = join(work, "downloaded.pdf");
  await dl.saveAs(out);
  const { statSync } = await import("node:fs");
  const head = readFileSync(out).subarray(0, 5).toString();
  check("downloaded file is a PDF", head === "%PDF-", `${statSync(out).size} bytes, name "${dl.suggestedFilename()}"`);
  // The browser build must encode with mozjpeg (4:2:0), not fall back to MuPDF's 4:4:4 encoder.
  {
    const mupdf = await import("mupdf");
    const { jpegChroma } = await import("../src/engine/jpegEncoder.ts");
    const doc = mupdf.Document.openDocument(readFileSync(out), "application/pdf").asPDF();
    const layouts = [];
    for (let i = 1; i < doc.countObjects(); i++) {
      const r = doc.newIndirect(i);
      if (r.isStream() && r.get("Subtype").asName?.() === "Image") layouts.push(jpegChroma(r.readRawStream().asUint8Array()));
    }
    doc.destroy();
    check("browser build encodes with mozjpeg (4:2:0)", layouts.length > 0 && layouts.every((l) => l === "420"), layouts.join(","));
  }

  // Diagnostics: preview dialog with a structure-only report (no file name).
  {
    await page.getByRole("button", { name: "Export diagnostics" }).click();
    const pre = page.locator(".diag-pre");
    await pre.waitFor();
    const text = await pre.innerText();
    await page.waitForTimeout(400); // let the fade-in finish
    if (shots) await page.screenshot({ path: join(shots, "6-diagnostics.png") });
    check("diagnostics dialog shows structure-only report", text.includes("[images]") && text.includes("[last compression]") && !text.includes("scan-color"), `${text.split("\n").length} lines`);
    await page.getByRole("button", { name: "Close" }).click();
  }

  // Simulated new deploy: change sw.js on the server. The app must detect it on the next
  // check and show the centered update popup, which can be dismissed and then applied.
  {
    const swPath = join(process.cwd(), "dist", "sw.js");
    const original = readFileSync(swPath, "utf8");
    writeFileSync(swPath, original + "\n// e2e: simulated new release\n");
    try {
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Check for updates" }).click();
      const dialog = page.getByRole("dialog", { name: "Update available" });
      await dialog.waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      if (shots) await page.screenshot({ path: join(shots, "7-update-dialog.png") });
      check("new release detected: centered update popup shown", true);
      await page.getByRole("button", { name: "Later" }).click();
      await dialog.waitFor({ state: "detached" });
      const installBtn = page.getByRole("button", { name: "Install update now" });
      check("popup can be dismissed; Settings offers Install update now", await installBtn.isVisible());
      const nav = page.waitForEvent("load", { timeout: 30_000 });
      await installBtn.click(); // installs directly and reloads
      await nav;
      await page.getByRole("button", { name: "Choose PDF" }).waitFor();
      check("Install update now reloads into the new version", true);
    } finally {
      writeFileSync(swPath, original);
    }
  }

  // Offline: reload with the network cut off. App + 10 MB wasm must come from the cache.
  await ctx.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Choose PDF" }).waitFor({ timeout: 15_000 });
  await compressFile(small);
  check("works fully offline after first load", /^−\d/.test(await page.locator(".hero-number").innerText()));
  await ctx.setOffline(false);

  // Cancellation mid-job returns to settings and the engine recovers.
  await dismissUpdateIfShown();
  await page.locator('input[type="file"]').setInputFiles(big);
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
  await dismissUpdateIfShown();
  await page.getByRole("button", { name: "Compress" }).click();
  await page.locator(".processing").waitFor();
  await page.waitForTimeout(400);
  if (shots) await page.screenshot({ path: join(shots, "4-processing.png") });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 10_000 });
  check("cancel returns to settings", true);
  await dismissUpdateIfShown();
  await page.getByRole("button", { name: "Compress" }).click();
  await page.locator(".hero-number").waitFor({ timeout: 120_000 });
  check("engine works again after cancel", true);

  // Non-PDF input gives a clear error.
  const bogus = join(work, "notes.pdf");
  writeFileSync(bogus, "this is not a pdf");
  await dismissUpdateIfShown();
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator('input[type="file"]').setInputFiles(bogus);
  await page.locator(".notice-error").waitFor({ timeout: 30_000 });
  check("damaged/non-PDF file shows an error", /couldn't be read as a PDF/.test(await page.locator(".notice-error").innerText()));

  // Dark mode rendering for a visual check.
  if (shots) {
    await page.emulateMedia({ colorScheme: "dark" });
    await compressFile(small);
    await page.screenshot({ path: join(shots, "5-results-dark.png"), fullPage: true });
  }
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  // Whole session: only GETs of the app's own files. No uploads, no other origins.
  const bad = allRequests.filter((r) => r.method !== "GET" || r.hasBody || !r.url.startsWith(url));
  check("entire session: only same-origin GETs, no request bodies", bad.length === 0, `${allRequests.length} requests; ${bad.map((b) => `${b.method} ${b.url}`).join(", ")}`);
} catch (e) {
  check("e2e run completed", false, String(e));
  if (shots) await page.screenshot({ path: join(shots, "error.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
