/**
 * Receives a PDF shared from another app (Android share sheet → PDF Optimizer).
 *
 * The service worker stores the shared file in this app's own Cache Storage
 * and opens `./?shared=1`. Here it is read once and deleted immediately, so
 * nothing stays on the device and nothing is ever sent anywhere.
 */
const scope = () => new URL("./", location.href).pathname;
const cacheName = () => `pdfopt-share:${scope()}`;
const key = () => new URL("./shared-file", location.href).href;

export type ShareOutcome = { kind: "file"; file: File } | { kind: "none" } | { kind: "error"; message: string };

export async function takeSharedFile(): Promise<ShareOutcome> {
  const flag = new URLSearchParams(location.search).get("shared");
  if (flag !== null) history.replaceState(null, "", location.pathname); // drop ?shared=… from the address
  if (!("caches" in window)) return { kind: "none" };
  try {
    if (flag === "none") return { kind: "error", message: "No PDF was included in what was shared." };
    if (flag === "error") return { kind: "error", message: "The shared file couldn't be received." };
    const cache = await caches.open(cacheName());
    const res = flag === "1" ? await cache.match(key()) : undefined;
    await caches.delete(cacheName()); // never keep shared documents around
    if (!res) return { kind: "none" };
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-file-name") ?? "shared.pdf");
    return { kind: "file", file: new File([blob], name, { type: blob.type || "application/pdf" }) };
  } catch {
    return { kind: "none" };
  }
}
