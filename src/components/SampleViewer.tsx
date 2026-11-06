import { useEffect, useRef, useState } from "react";
import type { EngineClient } from "../engine/client";
import { EngineFailure } from "../engine/client";
import { optionsFor, PROFILES, PROFILE_ORDER } from "../engine/profiles";
import type { ProfileId, SampleResult } from "../engine/types";
import { formatBytes, formatMs, percent } from "../format";

type Mode = "side" | "original" | "compressed";
const ZOOMS = [1, 2, 4] as const;

/**
 * Compresses one page with the selected profile and shows it next to the
 * original, so quality can be judged before running the whole file. Everything
 * happens on-device; the page images exist only as object URLs while open.
 */
export function SampleViewer({
  engine,
  file,
  password,
  profile,
  onProfileChange,
  onClose,
}: {
  engine: EngineClient;
  file: File;
  password?: string;
  profile: ProfileId;
  onProfileChange: (p: ProfileId) => void;
  onClose: () => void;
}) {
  // Which page to sample: null = the most image-heavy page. Only user navigation changes it,
  // so receiving a result never triggers another sample.
  const [request, setRequest] = useState<{ page: number | null }>({ page: null });
  const [result, setResult] = useState<SampleResult | null>(null);
  const [urls, setUrls] = useState<{ original: string; compressed: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("side");
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    engine
      .sample(file, optionsFor(profile), request.page ?? result?.pageIndex ?? null, password)
      .then((r) => {
        if (cancelled) return;
        const next = {
          original: URL.createObjectURL(new Blob([r.original.png as Uint8Array<ArrayBuffer>], { type: "image/png" })),
          compressed: URL.createObjectURL(new Blob([r.compressed.png as Uint8Array<ArrayBuffer>], { type: "image/png" })),
        };
        setUrls((old) => {
          if (old) {
            URL.revokeObjectURL(old.original);
            URL.revokeObjectURL(old.compressed);
          }
          return next;
        });
        r.original.png = new Uint8Array(0); // the Blobs hold the images now
        r.compressed.png = new Uint8Array(0);
        setResult(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof EngineFailure && e.code === "memory" ? "Not enough memory to render this page." : `Couldn't make a sample: ${(e as Error).message}`);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, request]);

  // Free the page images when the viewer closes.
  useEffect(
    () => () => {
      setUrls((old) => {
        if (old) {
          URL.revokeObjectURL(old.original);
          URL.revokeObjectURL(old.compressed);
        }
        return null;
      });
    },
    [],
  );

  // Keep both panes on the same spot when zoomed in side by side.
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => (syncing.current = false));
  };

  const pane = (which: "original" | "compressed", ref: React.RefObject<HTMLDivElement | null>, other: React.RefObject<HTMLDivElement | null>) => (
    <div className="sample-pane">
      <div className="sample-label">{which === "original" ? "Original" : "Compressed"}</div>
      <div className="sample-scroll" ref={ref} onScroll={() => sync(ref.current, other.current)}>
        {urls && <img src={urls[which]} alt={`${which} page`} style={{ width: `${zoom * 100}%` }} draggable={false} />}
      </div>
    </div>
  );

  const saved = result ? result.imageBytesBefore - result.imageBytesAfter : 0;
  const o = optionsFor(profile);

  return (
    <div className="sample-sheet" role="dialog" aria-modal="true" aria-labelledby="sample-title">
      <div className="sample-header">
        <h2 id="sample-title">{result ? `Sample: page ${result.pageIndex + 1} of ${result.pageCount}` : "Sample page"}</h2>
        <button type="button" className="btn-link" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="chips" role="radiogroup" aria-label="Profile">
        {PROFILE_ORDER.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={id === profile} className={`chip${id === profile ? " on" : ""}`} disabled={loading} onClick={() => onProfileChange(id)}>
            {PROFILES[id].label}
          </button>
        ))}
      </div>

      <div className="sample-controls">
        <div className="segmented" role="radiogroup" aria-label="View">
          {(["side", "original", "compressed"] as Mode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "side" ? "Side by side" : m === "original" ? "Original" : "Compressed"}
            </button>
          ))}
        </div>
        <div className="segmented small" role="radiogroup" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>
              {z === 1 ? "Fit" : `${z}×`}
            </button>
          ))}
        </div>
      </div>

      <div className={`sample-view ${mode}`} aria-busy={loading}>
        {loading && <div className="sample-loading">Compressing this page…</div>}
        {error && <div className="notice notice-error">{error}</div>}
        {!error && mode !== "compressed" && pane("original", left, right)}
        {!error && mode !== "original" && pane("compressed", right, left)}
      </div>

      {result && !error && (
        <div className="sample-stats">
          <div>
            Images on this page: {formatBytes(result.imageBytesBefore)} → <strong>{formatBytes(result.imageBytesAfter)}</strong>
            {saved > 0 ? ` (−${percent(saved / Math.max(1, result.imageBytesBefore))})` : " (unchanged)"}
          </div>
          <div className="choice-sub">
            {o.jpegQuality === null ? "Images untouched" : `JPEG q${o.jpegQuality}${o.downsampleAboveDpi ? `, above ${o.downsampleAboveDpi} DPI reduced to ${o.downsampleToDpi}` : ""}`} · made in{" "}
            {formatMs(result.elapsedMs)}. Measured on this page only; the full result appears after compressing.
          </div>
        </div>
      )}

      <div className="sample-nav">
        <button type="button" className="btn btn-secondary" disabled={loading || !result || result.pageIndex === 0} onClick={() => setRequest({ page: (result?.pageIndex ?? 1) - 1 })}>
          ‹ Previous page
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || !result || result.pageIndex >= result.pageCount - 1}
          onClick={() => setRequest({ page: (result?.pageIndex ?? -1) + 1 })}
        >
          Next page ›
        </button>
      </div>
    </div>
  );
}
