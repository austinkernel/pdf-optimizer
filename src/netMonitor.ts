/**
 * Counts network requests made by the page (Resource Timing), so the user can
 * see that processing a document triggers none. The engine worker reports its
 * own count separately, since workers have their own performance timeline.
 */
let count = 0;

export function startNetMonitor() {
  try {
    count = performance.getEntriesByType("resource").length;
    new PerformanceObserver((list) => {
      count += list.getEntries().length;
    }).observe({ type: "resource", buffered: false });
  } catch {
    /* Resource Timing unavailable */
  }
}

export function pageRequestCount(): number {
  return count;
}
