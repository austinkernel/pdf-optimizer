/**
 * Minimal precache service worker, generated at build time.
 *
 * Caches exactly the app's own build output: HTML, JS, CSS, the MuPDF .wasm,
 * the manifest and icons. Nothing else. There is no runtime caching, no
 * third-party origin, and no request carries document data. Once installed,
 * the app runs fully offline.
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";

function listPublic(dir: string, root = dir): string[] {
  let out: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(listPublic(p, root));
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

const SW_SOURCE = (version: string, assets: string[]) => `/* generated: do not edit */
const VERSION = ${JSON.stringify(version)};
const CACHE = "pdf-optimizer-" + VERSION;
const ASSETS = ${JSON.stringify(assets)};
// The preview app (served under ./preview/) has its own service worker and scope.
// This worker must not answer its requests, or the preview would show this app.
const PREVIEW_PREFIX = new URL("./preview/", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pdf-optimizer-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
  if (event.data === "status") {
    caches.open(CACHE).then((c) => c.keys()).then((keys) => {
      if (event.source) event.source.postMessage({ type: "sw-status", version: VERSION, cached: keys.length, total: ASSETS.length });
    });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins
  if (url.pathname.startsWith(PREVIEW_PREFIX)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (req.mode === "navigate") return (await cache.match("./index.html", { ignoreVary: true })) || fetch(req);
      return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) || fetch(req);
    }),
  );
});
`;

export function precacheServiceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "precache-sw",
    apply: "build",
    configResolved(cfg) {
      publicDir = cfg.publicDir;
    },
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const pub = publicDir ? listPublic(publicDir) : [];
      const all = [...new Set([...files, ...pub])].filter((f) => f !== "index.html" && f !== "sw.js");
      const assets = ["./", "./index.html", ...all.map((f) => "./" + f)];
      const h = createHash("sha256");
      for (const f of files.sort()) {
        const item = bundle[f];
        h.update(f);
        h.update(item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : Buffer.from(item.source));
      }
      const version = h.digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: SW_SOURCE(version, assets) });
    },
  };
}
