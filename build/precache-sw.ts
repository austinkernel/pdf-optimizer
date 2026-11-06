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
const ASSETS = ${JSON.stringify(assets)};
// The live app (/pdf-optimizer/) and the preview app (/pdf-optimizer/preview/) share one origin,
// and therefore one Cache Storage. Every cache name carries this worker's scope, so each app only
// ever creates or deletes its own caches.
const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = "pdfopt:" + SCOPE + ":";
const CACHE = PREFIX + VERSION;
// A PDF shared from another app (Android share sheet) waits here until the page picks it up.
const SHARE_CACHE = "pdfopt-share:" + SCOPE;
const SHARE_KEY = new URL("shared-file", self.registration.scope).href;
// The preview app has its own service worker and scope. This worker must not answer its requests.
const PREVIEW_PREFIX = SCOPE + "preview/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        // own outdated versions, plus caches from before names were scoped ("pdf-optimizer-<hash>")
        .filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || /^pdf-optimizer-[0-9a-f]+$/.test(k))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
  if (event.data === "status") {
    caches.has(CACHE)
      .then((has) => (has ? caches.open(CACHE).then((c) => c.keys()) : []))
      .then((keys) => {
        if (event.source) event.source.postMessage({ type: "sw-status", version: VERSION, cached: keys.length, total: ASSETS.length });
      });
  }
});

/** Android "Share -> PDF Optimizer": keep the shared PDF on this device and open the app with it. */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.getAll("pdf").find((f) => f && typeof f === "object" && "arrayBuffer" in f);
    if (!file) return Response.redirect("./?shared=none", 303);
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARE_KEY, new Response(file, {
      headers: { "content-type": file.type || "application/pdf", "x-file-name": encodeURIComponent(file.name || "shared.pdf") },
    }));
    return Response.redirect("./?shared=1", 303);
  } catch {
    return Response.redirect("./?shared=error", 303);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins
  if (url.pathname.startsWith(PREVIEW_PREFIX)) return;
  if (req.method === "POST" && url.pathname === SCOPE + "share-target") {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== "GET") return;
  event.respondWith((async () => {
    const cache = (await caches.has(CACHE)) ? await caches.open(CACHE) : null;
    if (cache) {
      if (req.mode === "navigate") {
        const page = await cache.match("./index.html", { ignoreVary: true });
        if (page) return page;
      } else {
        const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
        if (hit) return hit;
      }
    }
    return fetch(req);
  })());
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
