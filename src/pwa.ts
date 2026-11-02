/**
 * Service worker registration, update checks and offline-readiness status.
 *
 * iOS usually *resumes* a Home Screen app instead of relaunching it, so a
 * check that runs only at page load can miss new versions for days. Updates
 * are therefore checked at launch, whenever the app returns to the
 * foreground (at most once a minute), every 30 minutes while it is open, and
 * on demand from Settings.
 */

export interface OfflineStatus {
  supported: boolean;
  ready: boolean;
  version?: string;
  cached?: number;
  total?: number;
}

export type UpdateState =
  | "unsupported" // dev build or no service worker support
  | "idle" // not checked yet
  | "checking"
  | "downloading" // new version found, caching its files
  | "ready" // new version installed and waiting; reload to use it
  | "current" // no newer version on the server
  | "offline"
  | "error";

export interface PwaState {
  offline: OfflineStatus;
  update: UpdateState;
  lastChecked: number | null;
  /** True when "ready" was reached and the user has not dismissed the prompt. */
  promptVisible: boolean;
}

const supported = import.meta.env.PROD && "serviceWorker" in navigator;
let state: PwaState = {
  offline: { supported: "serviceWorker" in navigator, ready: false },
  update: supported ? "idle" : "unsupported",
  lastChecked: null,
  promptVisible: false,
};
let reg: ServiceWorkerRegistration | null = null;
let waiting: ServiceWorker | null = null;
let updateRequested = false;
const listeners = new Set<(s: PwaState) => void>();

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribePwa(l: (s: PwaState) => void): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

/** Activates the waiting version; the page reloads when it takes control. */
export function applyUpdate() {
  if (!waiting) return;
  updateRequested = true;
  waiting.postMessage("skip-waiting");
}

/** Hides the popup. The update stays ready, is shown in Settings, and the popup returns next launch. */
export function dismissUpdatePrompt() {
  set({ promptVisible: false });
}

function markReady(sw: ServiceWorker) {
  waiting = sw;
  set({ update: "ready", promptVisible: true });
}

function track(sw: ServiceWorker | null) {
  if (!sw) return;
  if (navigator.serviceWorker.controller) set({ update: "downloading" });
  sw.addEventListener("statechange", () => {
    if (sw.state === "installed" && navigator.serviceWorker.controller) markReady(sw);
    if (sw.state === "redundant" && state.update === "downloading") set({ update: "error" });
    if (sw.state === "activated") setTimeout(requestStatus, 300);
  });
}

function requestStatus() {
  navigator.serviceWorker.controller?.postMessage("status");
}

/** Asks the server whether a newer version exists. Safe to call at any time. */
export async function checkForUpdates(): Promise<void> {
  if (!reg || state.update === "checking" || state.update === "downloading") return;
  if (state.update === "ready") {
    set({ promptVisible: true });
    return;
  }
  if (!navigator.onLine) {
    set({ update: "offline", lastChecked: Date.now() });
    return;
  }
  set({ update: "checking" });
  try {
    await reg.update(); // fetches sw.js, bypassing the HTTP cache; a changed file starts an install
    const now = Date.now();
    if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);
    else if (reg.installing) set({ update: "downloading", lastChecked: now });
    else set({ update: "current", lastChecked: now });
    if (state.lastChecked !== now) set({ lastChecked: now });
  } catch {
    set({ update: navigator.onLine ? "error" : "offline", lastChecked: Date.now() });
  }
}

const FOREGROUND_MIN_INTERVAL = 60_000;
const PERIODIC_INTERVAL = 30 * 60_000;

export function registerServiceWorker() {
  if (!supported) return;
  navigator.serviceWorker.addEventListener("message", (ev) => {
    const d = ev.data as { type?: string; version: string; cached: number; total: number };
    if (d?.type === "sw-status") {
      set({ offline: { supported: true, ready: d.cached >= d.total, version: d.version, cached: d.cached, total: d.total } });
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
      reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      if (reg.waiting && navigator.serviceWorker.controller) markReady(reg.waiting);
      track(reg.installing);
      reg.addEventListener("updatefound", () => track(reg!.installing));
      await navigator.serviceWorker.ready;
      requestStatus();
      void checkForUpdates();
    } catch (e) {
      console.warn("Service worker registration failed", e);
      set({ update: "error" });
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.lastChecked === null || Date.now() - state.lastChecked > FOREGROUND_MIN_INTERVAL) void checkForUpdates();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void checkForUpdates();
  }, PERIODIC_INTERVAL);
}
