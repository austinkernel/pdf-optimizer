// Checks that the live app and the preview app coexist on one site without interfering.
// Usage: npm run build:preview && npm run e2e:preview
// (Chromium; on-device behaviour of the two Home Screen apps is checked by hand.)
import { createRequire } from "node:module";
import { preview } from "vite";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const server = await preview({ preview: { port: 4319, strictPort: true }, logLevel: "warn" });
const base = "http://localhost:4319";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...(devices["iPhone 15"] ?? devices["iPhone 13"]) });
const page = await ctx.newPage();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const manifest = async () => page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());

try {
  // 1. Live app installs its service worker first (the worst case for the preview).
  await page.goto(base + "/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  check("live app: title and no preview banner", (await page.title()) === "PDF Optimizer" && (await page.locator(".preview-banner").count()) === 0);
  const live = await manifest();
  check("live app: manifest identity", live.name === "PDF Optimizer" && live.icons[0].src === "icon-192.png", live.name);
  check("live app: controlled by its service worker", await page.evaluate(() => !!navigator.serviceWorker.controller));

  // 2. Preview is served under /preview/ and must NOT be answered by the live app's worker.
  await page.goto(base + "/preview/");
  await page.waitForLoadState("load");
  check("preview: page is the preview build (title)", (await page.title()) === "PDF Optimizer Preview", await page.title());
  check("preview: orange PREVIEW banner shown", await page.locator(".preview-banner").isVisible());
  const prev = await manifest();
  check("preview: separate manifest name and icons", prev.name === "PDF Optimizer Preview" && prev.icons[0].src === "preview-icon-192.png", prev.name);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  check("two separate service worker scopes", scopes.includes("/") && scopes.includes("/preview/"), scopes.join(", "));

  // 3. After the preview's own worker is installed, it still serves the preview, offline too.
  await page.reload();
  check("preview: controlled by the preview's own worker", await page.evaluate(() => new URL(navigator.serviceWorker.controller?.scriptURL ?? "http://x/").pathname === "/preview/sw.js"));
  await ctx.setOffline(true);
  await page.reload();
  check("preview works offline and is still the preview", (await page.title()) === "PDF Optimizer Preview");
  await ctx.setOffline(false);

  // 4. The live app is unaffected.
  await page.goto(base + "/");
  check("live app still the live app", (await page.title()) === "PDF Optimizer" && (await page.locator(".preview-banner").count()) === 0);
} catch (e) {
  check("run completed", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
