import { useState } from "react";
import { PROFILES } from "../engine/profiles";
import type { ImageDecision, OptimizeResult } from "../engine/types";
import { formatBytes, formatMs, outputName, percent } from "../format";

const DECISION_LABEL: Record<ImageDecision, string> = {
  recompressed: "Recompressed",
  "kept-no-gain": "Kept: re-encoding would not save ≥5%",
  "kept-already-efficient": "Kept: already JPEG at or below target quality",
  "kept-bilevel": "Kept: black & white (G4 support coming)",
  "kept-mask": "Kept: transparency/mask image",
  "kept-unsupported-colorspace": "Kept: colour space not yet supported",
  "kept-tiny": "Kept: too small to matter",
  "kept-profile": "Kept: lossless profile",
};

export function ResultsView({
  result,
  blob,
  originalName,
  pageRequests,
  onAnotherProfile,
  onNewFile,
}: {
  result: OptimizeResult;
  blob: Blob;
  originalName: string;
  pageRequests: number;
  onAnotherProfile: () => void;
  onNewFile: () => void;
}) {
  const [name, setName] = useState(() => outputName(originalName));
  const [shareError, setShareError] = useState<string | null>(null);
  const [confirmUnverified, setConfirmUnverified] = useState(false);
  const saved = result.inputBytes - result.outputBytes;
  const fraction = saved / result.inputBytes;
  const meaningful = fraction >= 0.01;
  const decisions = new Map<ImageDecision, number>();
  for (const i of result.images) decisions.set(i.decision, (decisions.get(i.decision) ?? 0) + 1);
  const resized = result.images.filter((i) => i.decision === "recompressed" && i.afterSize[0] !== i.beforeSize[0]).length;
  const profile = PROFILES[result.options.profile];
  const canSave = result.verified || confirmUnverified;

  const download = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputName(originalName, name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const share = async () => {
    setShareError(null);
    const file = new File([blob], outputName(originalName, name), { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        // Files only. Adding title/text makes iOS share a second, text item,
        // and "Save to Files" then saves a .txt with the file name instead of (or beside) the PDF.
        await navigator.share({ files: [file] });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setShareError(`Sharing failed (${(e as Error).message}). Try Download instead.`);
      }
    } else {
      download();
    }
  };

  return (
    <>
      <div className="hero">
        <div className={`hero-number${meaningful ? "" : " muted"}`}>{meaningful ? `−${percent(fraction)}` : "No reduction"}</div>
        <div className="hero-sub">
          {formatBytes(result.inputBytes)} → <strong>{formatBytes(result.outputBytes)}</strong>
        </div>
      </div>

      {!result.verified && (
        <div className="notice notice-error" role="alert">
          <strong>Verification failed.</strong> The output differs from the original in a way it should not (see the
          checks below). Keep using your original.
        </div>
      )}
      {result.verified && !meaningful && (
        <div className="notice">
          Already efficiently compressed for this profile. Re-encoding would not save at least 5% without lowering
          quality. Keep your original{result.options.profile !== "compact" ? ", or try Compact for a smaller file (reduces resolution to 200 DPI)" : ""}.
        </div>
      )}

      <h2 className="section-title">Result</h2>
      <div className="group">
        <div className="row"><span className="row-label">Original</span><span className="row-value">{formatBytes(result.inputBytes)}</span></div>
        <div className="row"><span className="row-label">Compressed</span><span className="row-value">{formatBytes(result.outputBytes)}</span></div>
        <div className="row"><span className="row-label">Saved</span><span className="row-value">{saved > 0 ? `${formatBytes(saved)} (${percent(fraction)})` : "0"}</span></div>
        <div className="row"><span className="row-label">Time</span><span className="row-value">{formatMs(result.elapsedMs)}</span></div>
        <div className="row"><span className="row-label">Profile</span><span className="row-value">{profile.label}</span></div>
        <div className="row">
          <span className="row-label">Image settings</span>
          <span className="row-value">
            {result.options.jpegQuality === null
              ? "Images untouched"
              : `JPEG q${result.options.jpegQuality}${result.options.downsampleAboveDpi ? `, >${result.options.downsampleAboveDpi} DPI → ${result.options.downsampleToDpi} DPI` : ", no downsampling"}`}
          </span>
        </div>
        <div className="row"><span className="row-label">Searchable text</span><span className="row-value">{result.searchableOutput ? "Yes" : "No (image only)"}</span></div>
      </div>

      <h2 className="section-title">Verification</h2>
      <div className="group">
        {result.verification.map((c) => (
          <div className="row check-row" key={c.id}>
            <span className={`status ${c.ok ? "ok" : "bad"}`} aria-label={c.ok ? "passed" : "failed"}>{c.ok ? "✓" : "✕"}</span>
            <span className="check-text">
              <span>{c.label}</span>
              <span className="choice-sub">{c.detail}</span>
            </span>
          </div>
        ))}
      </div>

      {result.images.length > 0 && (
        <>
          <h2 className="section-title">Images</h2>
          <div className="group">
            {[...decisions].map(([d, n]) => (
              <div className="row" key={d}>
                <span className="row-label">{DECISION_LABEL[d]}</span>
                <span className="row-value">{n}</span>
              </div>
            ))}
            {resized > 0 && (
              <div className="row"><span className="row-label">Downsampled</span><span className="row-value">{resized}</span></div>
            )}
          </div>
        </>
      )}

      <h2 className="section-title">Save</h2>
      <div className="group">
        <label className="row field">
          <span className="row-label">File name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
        </label>
      </div>
      {!result.verified && !confirmUnverified && (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirmUnverified(true)}>
          I understand. Let me save it anyway
        </button>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={share}>
          Save to Files / Share
        </button>
        <button type="button" className="btn btn-secondary" disabled={!canSave} onClick={download}>
          Download
        </button>
      </div>
      {shareError && <p className="footnote error-text">{shareError}</p>}
      <p className="footnote">
        Your original file is never changed. Network requests during processing: {pageRequests} from the app page,{" "}
        {result.workerNetworkRequests ?? "n/a"} from the engine.
      </p>

      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onAnotherProfile}>
          Try another profile
        </button>
        <button type="button" className="btn btn-plain" onClick={onNewFile}>
          Choose another PDF
        </button>
      </div>
    </>
  );
}
