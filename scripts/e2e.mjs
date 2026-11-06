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
const lockedPath = join(work, "locked.pdf");
const LOCK_PW = "open sesame";
{
  const mupdf = await import("mupdf");
  const d = mupdf.Document.openDocument(await makeScanPdf({ mode: "gray", encoding: "flate", pages: 1 }), "application/pdf").asPDF();
  writeFileSync(lockedPath, d.saveToBuffer(`encrypt=aes-256,user-password=${LOCK_PW},owner-password=owner`).asUint8Array().slice());
  d.destroy();
}

const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "warn" });
// Every request that actually reaches the web server (as opposed to being answered on-device).
const serverHits = [];
server.httpServer.on("request", (req) => serverHits.push(`${req.method} ${req.url}`));
const url = "http://localhost:4317/";
const browser = await chromium.launch();
// E2E_DEVICE picks the phone profile, e.g. "Pixel 7" for Android (Chromium = Chrome's engine).
const DEVICE = process.env.E2E_DEVICE ?? "iPhone 15";
const iphone = devices[DEVICE] ?? devices["iPhone 13"];
const isAndroid = /pixel|galaxy|android/i.test(DEVICE);
console.log(`device profile: ${DEVICE}`);
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

/** Opens the collapsed "App info & updates" section if it is closed. */
async function openAppInfo() {
  const details = page.locator("details.privacy");
  if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
}

async function compressFile(file, { shotPrefix } = {}) {
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
  if (shots && shotPrefix) await page.screenshot({ path: join(shots, `${shotPrefix}-analysis.png`), fullPage: true });
  await page.getByRole("radio", { name: /Balanced/ }).click();
  await networkQuiet();
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
  check("device-neutral wording", (await page.locator("body").innerText()).includes("Processed entirely on this device"));
  {
    const bg = await page.getByRole("button", { name: "Choose PDF" }).evaluate((el) => getComputedStyle(el).backgroundColor);
    check("live app accent is orange", bg === "rgb(194, 65, 12)", bg);
    const hint = await page.locator(".install-hint").innerText().catch(() => "");
    const ok = isAndroid ? /Install app|Add to Home screen/.test(hint) : /Add to Home Screen/.test(hint);
    check(`install help for ${isAndroid ? "Android" : "iPhone"} shown in browser`, ok, hint.replace(/\s+/g, " ").trim());
  }

  // Wait for the service worker to install and precache everything.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await page.reload(); // page is now controlled by the SW
  const swControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check("service worker controls the page", swControlled);

  // Updates: manual check against an unchanged server reports up to date.
  check("updates are hidden by default (no update section visible)", !(await page.getByRole("button", { name: "Check for updates" }).isVisible()));
  await openAppInfo();
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByText(/Up to date/).waitFor({ timeout: 15_000 });
  check("manual update check reports up to date", true);

  await compressFile(small, { shotPrefix: "2" });
  const hero = await page.locator(".hero-number").innerText();
  const statuses = (await page.locator(".check-row .status").allTextContents()).map((t) => t.trim());
  check("verification collapsed by default, summary pill shown", (await page.locator(".check-pill.ok").isVisible()) && !(await page.locator(".check-row").first().isVisible()));
  {
    // Save is reachable without scrolling on a phone screen.
    const box = await page.getByRole("button", { name: /Save to Files|Download/ }).first().boundingBox();
    const vh = page.viewportSize().height;
    check("save button visible on first screen", !!box && box.y + box.height <= vh, `button bottom ${box ? Math.round(box.y + box.height) : "?"} / viewport ${vh}`);
  }
  check("compression reports a real reduction", /^−\d/.test(hero), hero);
  check("all verification checks pass in the browser", statuses.length > 5 && statuses.every((s) => s === "✓"), `${statuses.length} checks`);
  check("no network requests during processing", requestsDuringJob.length === 0, requestsDuringJob.join(", "));
  const foot = await page.locator("p.footnote", { hasText: "Network requests during processing" }).textContent();
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
    await openAppInfo();
    await page.getByRole("button", { name: "Export diagnostics" }).click();
    const pre = page.locator(".diag-pre");
    await pre.waitFor();
    const text = await pre.innerText();
    await page.waitForTimeout(400); // let the fade-in finish
    if (shots) await page.screenshot({ path: join(shots, "6-diagnostics.png") });
    check("diagnostics dialog shows structure-only report", text.includes("[images]") && text.includes("[last compression]") && !text.includes("scan-color"), `${text.split("\n").length} lines`);
    await page.getByRole("button", { name: "Close" }).click();
  }

  // Sample preview: one page compressed and shown next to the original, fully offline-capable.
  {
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator('input[type="file"]').setInputFiles(small);
    await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
    await networkQuiet();
    recording = true;
    requestsDuringJob.length = 0;
    await page.getByRole("button", { name: "Preview a sample page" }).click();
    const stats = page.locator(".sample-stats");
    await stats.waitFor({ timeout: 60_000 });
    recording = false; // sample computed: anything after this is not part of the job
    const sampleNet = requestsDuringJob.filter((u) => !u.startsWith("blob:")); // blob: = in-memory images, not network
    check("sample: no network requests while computing", sampleNet.length === 0, sampleNet.join(", "));
    const imgsOk = await page.locator(".sample-scroll img").evaluateAll((els) => els.length === 2 && els.every((e) => e.complete && e.naturalWidth > 0));
    check("sample: original and compressed page rendered side by side", imgsOk);
    check("sample: measured size for this page", /Images on this page: .* → .*\(−\d/.test(await stats.innerText()), (await stats.innerText()).split("\n")[0]);
    const before = (await stats.innerText()).split("\n")[0];
    await page.locator(".chips").getByRole("radio", { name: "Compact", exact: true }).click();
    await page.waitForFunction((b) => {
      const el = document.querySelector(".sample-stats");
      return el && !document.querySelector(".sample-loading") && el.textContent && !el.textContent.startsWith(b);
    }, before.slice(0, 60), { timeout: 60_000 }).catch(() => {});
    check("sample: switching profile re-renders", (await stats.innerText()).split("\n")[0] !== before, (await stats.innerText()).split("\n")[0]);
    await page.getByRole("radio", { name: "2×" }).click();
    const zoomed = await page.locator(".sample-scroll").first().evaluate((el) => el.scrollWidth > el.clientWidth * 1.5);
    check("sample: zoom enlarges the page", zoomed);
    if (shots) await page.screenshot({ path: join(shots, "8-sample.png") });
    await page.locator(".sample-header").getByRole("button", { name: "Done" }).click();
    check("sample: closing returns to settings, profile follows the sample", await page.getByRole("radio", { name: /Compact/ }).first().getAttribute("aria-checked") === "true");
  }

  // Password-protected PDF: ask, reject a wrong password, unlock, keep the password on the output.
  {
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator('input[type="file"]').setInputFiles(lockedPath);
    await page.getByText("Password required").waitFor({ timeout: 30_000 });
    check("password: prompt shown for a protected PDF", true);
    await page.getByLabel("PDF password").fill("wrong one");
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByText("That password isn't right").waitFor({ timeout: 30_000 });
    check("password: wrong password rejected", true);
    await page.getByLabel("PDF password").fill(LOCK_PW);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
    check("password: unlocked, keep-password switch on by default", await page.locator("input.switch").isChecked());
    await page.getByRole("radio", { name: /Balanced/ }).click();
    await page.getByRole("button", { name: "Compress" }).click();
    await page.locator(".hero-number").waitFor({ timeout: 120_000 });
    check("password: result says password kept", (await page.locator(".hero-meta").innerText()).includes("password kept"));
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).first().click()]);
    const outLocked = join(work, "locked-out.pdf");
    await dl2.saveAs(outLocked);
    const mupdf = await import("mupdf");
    const od = mupdf.Document.openDocument(readFileSync(outLocked), "application/pdf").asPDF();
    const needs = od.needsPassword();
    const opens = needs && od.authenticatePassword(LOCK_PW) > 0;
    od.destroy();
    check("password: downloaded copy needs the same password", needs && opens);
  }

  // Android share sheet → PDF Optimizer: the OS POSTs the PDF to ./share-target, the service
  // worker keeps it on-device and opens ./?shared=1. Simulated here with the same request.
  {
    const mupdf = await import("mupdf");
    const tiny = await makeScanPdf({ mode: "gray", encoding: "jpeg", pages: 1, dpi: 100 });
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const sharedUrl = await page.evaluate(async (bytes) => {
      const fd = new FormData();
      fd.append("pdf", new File([new Uint8Array(bytes)], "from-share-sheet.pdf", { type: "application/pdf" }));
      const r = await fetch("./share-target", { method: "POST", body: fd, redirect: "manual" });
      const stored = await (await caches.open("pdfopt-share:/")).match(new URL("./shared-file", location.href).href);
      return `${r.type} stored=${!!stored}`;
    }, Array.from(tiny));
    check("share: service worker keeps the shared PDF on-device and redirects", sharedUrl === "opaqueredirect stored=true", sharedUrl);
    await page.goto(url + "?shared=1");
    await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
    const docName = await page.locator(".row", { hasText: "File" }).first().innerText();
    check("share: app opens straight into analysis of the shared file", docName.includes("from-share-sheet.pdf"), docName.replace(/\s+/g, " "));
    check("share: address cleaned up", !page.url().includes("shared="), page.url());
    const leftover = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("pdfopt-share")));
    check("share: shared file deleted from device storage after pickup", leftover.length === 0, leftover.join(", "));
    check("share: the PDF never reached the server", !serverHits.some((h) => h.startsWith("POST")), serverHits.filter((h) => h.startsWith("POST")).join(", "));
    void mupdf;
  }

  // Simulated new deploy: change sw.js on the server. The app must detect it on the next check
  // and show a small "Update ready" badge on the collapsed section (no popup), then install it.
  {
    const swPath = join(process.cwd(), "dist", "sw.js");
    const original = readFileSync(swPath, "utf8");
    writeFileSync(swPath, original + "\n// e2e: simulated new release\n");
    try {
      await page.getByRole("button", { name: "Done" }).click();
      await openAppInfo();
      await page.getByRole("button", { name: "Check for updates" }).click();
      const badge = page.locator("details.privacy summary .update-badge", { hasText: "Update ready" });
      await badge.waitFor({ timeout: 30_000 });
      check("new release detected: 'Update ready' badge on the section", true);
      check("no popup or modal appeared", (await page.getByRole("dialog").count()) === 0);
      await page.locator("details.privacy summary").click(); // collapse: badge must still be visible
      check("badge visible while the section is collapsed", await badge.isVisible());
      await page.waitForTimeout(300);
      if (shots) await page.screenshot({ path: join(shots, "7-update-badge.png") });
      await page.locator("details.privacy summary").click();
      const installBtn = page.getByRole("button", { name: "Install update now" });
      const nav = page.waitForEvent("load", { timeout: 30_000 });
      await installBtn.click(); // installs and reloads
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
  await page.locator('input[type="file"]').setInputFiles(big);
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Compress" }).click();
  await page.locator(".processing").waitFor();
  await page.waitForTimeout(400);
  if (shots) await page.screenshot({ path: join(shots, "4-processing.png") });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Compress" }).waitFor({ timeout: 10_000 });
  check("cancel returns to settings", true);
  await page.getByRole("button", { name: "Compress" }).click();
  await page.locator(".hero-number").waitFor({ timeout: 120_000 });
  check("engine works again after cancel", true);

  // Non-PDF input gives a clear error.
  const bogus = join(work, "notes.pdf");
  writeFileSync(bogus, "this is not a pdf");
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
  // blob: URLs are in-memory objects (rendered sample pages, downloads), not network traffic.
  // The simulated share-sheet POST is answered by the service worker on-device (checked above
  // against the server's own request log), so it is excluded here.
  const bad = allRequests.filter(
    (r) => !r.url.startsWith("blob:") && !r.url.endsWith("/share-target") && (r.method !== "GET" || r.hasBody || !r.url.startsWith(url)),
  );
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
