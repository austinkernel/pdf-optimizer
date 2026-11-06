/**
 * "Install this app" help for people opening the link in a browser.
 *
 * - Android Chrome / Edge / Samsung Internet (and desktop Chrome) fire
 *   `beforeinstallprompt`; we keep the event and offer a real Install button.
 * - iPhone/iPad Safari has no install API; we show the Share → Add to Home
 *   Screen steps instead.
 * - Once running as an installed app (standalone), nothing is shown.
 */

export type Platform = "ios" | "android" | "other";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  standalone: boolean;
  platform: Platform;
  /** True when the browser offers a one-tap install (Android/desktop Chromium). */
  canPrompt: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(s: InstallState) => void>();

export function detectPlatform(ua = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): Platform {
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  return "other";
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function state(): InstallState {
  return { standalone: isStandalone(), platform: detectPlatform(), canPrompt: deferred !== null };
}

function emit() {
  const s = state();
  for (const l of listeners) l(s);
}

export function subscribeInstall(l: (s: InstallState) => void): () => void {
  listeners.add(l);
  l(state());
  return () => listeners.delete(l);
}

/** Shows the browser's install dialog (only when canPrompt). */
export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  await e.prompt();
  await e.userChoice.catch(() => undefined);
  emit();
}

/** Must run at startup, before the browser fires the event. */
export function startInstallListener() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button instead of the browser's mini-bar
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}
