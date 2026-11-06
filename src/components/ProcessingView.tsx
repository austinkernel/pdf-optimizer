import { useEffect, useState } from "react";
import type { ProgressEvent } from "../engine/types";
import { formatMs } from "../format";

/** Maps engine phases onto one overall progress fraction plus a label. */
export function describe(p: ProgressEvent | null, mode: "analyze" | "optimize"): { label: string; fraction: number } {
  if (!p || p.phase === "opening") return { label: "Opening PDF…", fraction: 0.02 };
  const f = (done: number, total: number) => (total > 0 ? done / total : 1);
  if (mode === "analyze") {
    if (p.phase === "summarizing") return { label: `Reading page ${Math.min(p.done + 1, p.total)} of ${p.total}…`, fraction: f(p.done, p.total) };
    return { label: "Analyzing…", fraction: 0.5 };
  }
  switch (p.phase) {
    case "summarizing":
      return { label: `Reading page ${Math.min(p.done + 1, p.total)} of ${p.total}…`, fraction: 0.02 + 0.18 * f(p.done, p.total) };
    case "images":
      return { label: p.total ? `Optimizing image ${Math.min(p.done + 1, p.total)} of ${p.total}…` : "No images to optimize", fraction: 0.2 + 0.55 * f(p.done, p.total) };
    case "saving":
      return { label: "Writing the new PDF…", fraction: 0.77 };
    case "verifying":
      return { label: `Verifying page ${Math.min(p.done + 1, p.total)} of ${p.total}…`, fraction: 0.8 + 0.2 * f(p.done, p.total) };
  }
}

export function ProcessingView({
  title,
  progress,
  mode,
  startedAt,
  onCancel,
}: {
  title: string;
  progress: ProgressEvent | null;
  mode: "analyze" | "optimize";
  startedAt: number;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const { label, fraction } = describe(progress, mode);
  return (
    <div className="processing" aria-live="polite">
      <h2 className="processing-title">{title}</h2>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <div className="progress-fill" style={{ width: `${Math.max(2, fraction * 100)}%` }} />
      </div>
      <p className="processing-label">{label}</p>
      <p className="processing-time">{formatMs(Math.max(0, now - startedAt))}</p>
      <p className="footnote center">
        Keep this app open and on screen. Phones pause web apps in the background. Everything runs on this device.
      </p>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
