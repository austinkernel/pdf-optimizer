/** Service worker registration, update prompt and offline-readiness status. */

export interface OfflineStatus {
  supported: boolean;
  ready: boolean;
  version?: string;
  cached?: number;
  total?: number;
}

type Listener = (s: { offline: OfflineStatus; updateReady: boolean }) => void;

let offline: OfflineStatus = { supported: "serviceWorker" in navigator, ready: false };
let updateReady = false;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l({ offline, updateReady });
}

export function subscribePwa(l: Listener): () => void {
  listeners.add(l);
  l({ offline, updateReady });
  return () => listeners.delete(l);
}

let updateRequested = false;

export function applyUpdate() {
  updateRequested = true;
  waiting?.postMessage("skip-waiting");
}

function requestStatus() {
  navigator.serviceWorker.controller?.postMessage("status");
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const d = ev.data as { type?: string; version: string; cached: number; total: number };
    if (d?.type === "sw-status") {
      offline = { supported: true, ready: d.cached >= d.total, version: d.version, cached: d.cached, total: d.total };
      emit();
    }
  });
  // Reload only when the user accepted an update. On first install the new worker
  // claims the page (controllerchange) and that must not reload the app mid-use.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      const track = (sw: ServiceWorker | null) => {
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            waiting = sw;
            updateReady = true;
            emit();
          }
          if (sw.state === "activated") setTimeout(requestStatus, 300);
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        updateReady = true;
        emit();
      }
      track(reg.installing);
      reg.addEventListener("updatefound", () => track(reg.installing));
      await navigator.serviceWorker.ready;
      requestStatus();
    } catch (e) {
      console.warn("Service worker registration failed", e);
    }
  });
}
