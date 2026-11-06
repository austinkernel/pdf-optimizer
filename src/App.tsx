import { useCallback, useEffect, useRef, useState } from "react";
import { EngineClient, EngineFailure } from "./engine/client";
import { optionsFor } from "./engine/profiles";
import type { AnalysisReport, OptimizeResult, ProfileId, ProgressEvent } from "./engine/types";
import { AnalysisView } from "./components/AnalysisView";
import { ProfilePicker } from "./components/ProfilePicker";
import { ProcessingView } from "./components/ProcessingView";
import { ResultsView } from "./components/ResultsView";
import { formatBytes } from "./format";
import { pageRequestCount } from "./netMonitor";
import { applyUpdate, checkForUpdates, subscribePwa, type PwaState, type UpdateState } from "./pwa";
import { DiagnosticsDialog } from "./components/Dialogs";
import { promptInstall, subscribeInstall, type InstallState } from "./install";
import { buildDiagnostics } from "./diagnostics";

type Stage =
  | { kind: "home" }
  | { kind: "analyzing"; file: File; progress: ProgressEvent | null; startedAt: number }
  | { kind: "ready"; file: File; report: AnalysisReport }
  | { kind: "processing"; file: File; report: AnalysisReport; progress: ProgressEvent | null; startedAt: number }
  | { kind: "done"; file: File; report: AnalysisReport; result: OptimizeResult; blob: Blob; pageRequests: number }
  | { kind: "error"; message: string; file?: File; report?: AnalysisReport };

const VERSION = "0.4.1";
const IS_PREVIEW = import.meta.env.VITE_PREVIEW === "1";
const SOURCE_URL = "https://github.com/austinkernel/pdf-optimizer";
const PROFILE_KEY = "pdfopt.profile";

function updateLabel(u: UpdateState, lastChecked: number | null): string {
  const when = lastChecked ? new Date(lastChecked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  switch (u) {
    case "unsupported":
      return "Not available in this build";
    case "idle":
      return "Not checked yet";
    case "checking":
      return "Checking…";
    case "downloading":
      return "Downloading update…";
    case "ready":
      return "Update ready to install";
    case "current":
      return `Up to date${when ? ` (checked ${when})` : ""}`;
    case "offline":
      return "Offline. Will check when connected";
    case "error":
      return "Couldn't check. Try again";
  }
}

function loadProfile(): ProfileId {
  try {
    const v = localStorage.getItem(PROFILE_KEY);
    if (v === "lossless" || v === "high" || v === "balanced" || v === "compact") return v;
  } catch {
    /* storage unavailable */
  }
  return "balanced";
}

function friendlyError(e: unknown): string {
  if (e instanceof EngineFailure) {
    switch (e.code) {
      case "password":
        return "This PDF is protected with an open password. Password support isn't available yet.";
      case "not-pdf":
        return "This file couldn't be read as a PDF. It may be damaged or a different file type.";
      case "memory":
        return "This document needs more memory than this device allows a web app. Try a smaller file, or the Lossless profile.";
      case "crashed":
        return e.message;
      default:
        return `Something went wrong while processing: ${e.message}`;
    }
  }
  return `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
}

/** Keeps the screen on during processing where supported, because phones suspend backgrounded web apps. */
async function holdWakeLock(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

export default function App() {
  const engine = useRef<EngineClient | null>(null);
  if (!engine.current) engine.current = new EngineClient();
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [profile, setProfile] = useState<ProfileId>(loadProfile);
  const [pwa, setPwa] = useState<PwaState | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => subscribePwa(setPwa), []);
  useEffect(() => subscribeInstall(setInstall), []);
  useEffect(() => {
    // Load the engine in the background so the first analysis starts immediately.
    engine.current!.warmUp().catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, profile);
    } catch {
      /* ignore */
    }
  }, [profile]);

  const pickFile = () => fileInput.current?.click();

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setStage({ kind: "error", message: `"${file.name}" is not a PDF.` });
      return;
    }
    setStage({ kind: "analyzing", file, progress: null, startedAt: Date.now() });
    try {
      const report = await engine.current!.analyze(file, (progress) =>
        setStage((s) => (s.kind === "analyzing" ? { ...s, progress } : s)),
      );
      setStage({ kind: "ready", file, report });
    } catch (e) {
      if (e instanceof EngineFailure && e.code === "cancelled") return setStage({ kind: "home" });
      setStage({ kind: "error", message: friendlyError(e), file });
    }
  }, []);

  const compress = async (file: File, report: AnalysisReport) => {
    if (engine.current!.busy) return; // duplicate-tap guard
    setStage({ kind: "processing", file, report, progress: null, startedAt: Date.now() });
    const release = await holdWakeLock();
    let req0 = pageRequestCount();
    try {
      const result = await engine.current!.optimize(
        file,
        optionsFor(profile),
        (progress) => setStage((s) => (s.kind === "processing" ? { ...s, progress } : s)),
        () => (req0 = pageRequestCount()), // count from the moment the document reaches the engine
      );
      const blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
      result.bytes = new Uint8Array(0); // drop the second copy; the Blob holds the output now
      setStage({ kind: "done", file, report, result, blob, pageRequests: pageRequestCount() - req0 });
    } catch (e) {
      if (e instanceof EngineFailure && e.code === "cancelled") return setStage({ kind: "ready", file, report });
      setStage({ kind: "error", message: friendlyError(e), file, report });
    } finally {
      release();
    }
  };

  const cancel = () => engine.current!.cancel();
  const showDiagnostics = (report: AnalysisReport, result?: OptimizeResult) =>
    setDiagnostics(buildDiagnostics({ appVersion: VERSION, buildVersion: pwa?.offline.version, report, result }));

  return (
    <div className="app">
      {IS_PREVIEW && (
        <div className="preview-banner" role="note">
          PREVIEW: a test build of upcoming changes. Not your live app.
        </div>
      )}
      {diagnostics !== null && <DiagnosticsDialog text={diagnostics} onClose={() => setDiagnostics(null)} />}
      <header className="header">
        <h1>{IS_PREVIEW ? "PDF Optimizer Preview" : "PDF Optimizer"}</h1>
        {stage.kind !== "home" && stage.kind !== "processing" && stage.kind !== "analyzing" && (
          <button type="button" className="btn-link" onClick={() => setStage({ kind: "home" })}>
            Done
          </button>
        )}
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file
          void onFile(f);
        }}
      />

      <main className="content">
        {stage.kind === "home" && (
          <div className="home">
            <div className="home-icon" aria-hidden="true">
              <img src={IS_PREVIEW ? "./preview-icon-192.png" : "./icon-192.png"} alt="" width={96} height={96} />
            </div>
            <p className="home-lead">Shrink scanned PDFs without losing quality, searchable text or bookmarks.</p>
            <button type="button" className="btn btn-primary btn-large" onClick={pickFile}>
              Choose PDF
            </button>
            <p className="footnote center">Processed entirely on this device. Nothing is uploaded.</p>
            {install && !install.standalone && (
              <div className="install-hint">
                {install.canPrompt ? (
                  <button type="button" className="btn btn-secondary" onClick={() => void promptInstall()}>
                    Install app
                  </button>
                ) : install.platform === "ios" ? (
                  <p className="footnote center">
                    To install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. It then works offline.
                  </p>
                ) : install.platform === "android" ? (
                  <p className="footnote center">
                    To install: open the browser menu <strong>⋮</strong>, then <strong>Install app</strong> or{" "}
                    <strong>Add to Home screen</strong>. It then works offline.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {stage.kind === "analyzing" && (
          <ProcessingView title={stage.file.name} progress={stage.progress} mode="analyze" startedAt={stage.startedAt} onCancel={cancel} />
        )}

        {stage.kind === "ready" && (
          <>
            <AnalysisView report={stage.report} fileName={stage.file.name} />
            <ProfilePicker value={profile} onChange={setProfile} />
            <button type="button" className="btn btn-plain diag-btn" onClick={() => showDiagnostics(stage.report)}>
              Export diagnostics
            </button>
            <div className="actions sticky-actions">
              <button type="button" className="btn btn-primary btn-large" onClick={() => compress(stage.file, stage.report)}>
                Compress
              </button>
            </div>
          </>
        )}

        {stage.kind === "processing" && (
          <ProcessingView title={`Compressing ${stage.file.name}`} progress={stage.progress} mode="optimize" startedAt={stage.startedAt} onCancel={cancel} />
        )}

        {stage.kind === "done" && (
          <ResultsView
            result={stage.result}
            blob={stage.blob}
            originalName={stage.file.name}
            pageRequests={stage.pageRequests}
            onAnotherProfile={() => setStage({ kind: "ready", file: stage.file, report: stage.report })}
            onNewFile={pickFile}
            onDiagnostics={() => showDiagnostics(stage.report, stage.result)}
          />
        )}

        {stage.kind === "error" && (
          <div className="home">
            <div className="notice notice-error" role="alert">{stage.message}</div>
            {stage.file && stage.report && (
              <button type="button" className="btn btn-secondary" onClick={() => setStage({ kind: "ready", file: stage.file!, report: stage.report! })}>
                Back to settings
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={pickFile}>
              Choose another PDF
            </button>
          </div>
        )}

        {(stage.kind === "home" || stage.kind === "ready" || stage.kind === "done") && pwa && (
          <details className="privacy">
            <summary>
              <span>App info &amp; updates</span>
              {pwa.update === "ready" && <span className="update-badge" role="status"><span className="update-dot" aria-hidden="true" />Update ready</span>}
              {pwa.update === "downloading" && <span className="update-badge quiet" role="status">Updating…</span>}
            </summary>
            <div className="group">
              <div className="row"><span className="row-label">Version</span><span className="row-value">{VERSION}{IS_PREVIEW ? " (preview)" : ""}</span></div>
              <div className="row">
                <span className="row-label">Updates</span>
                <span className={`row-value${pwa.update === "ready" ? " accent" : ""}`}>{updateLabel(pwa.update, pwa.lastChecked)}</span>
              </div>
            </div>
            <div className="actions compact-actions">
              {pwa.update === "ready" ? (
                <button type="button" className="btn btn-primary" onClick={applyUpdate}>
                  Install update now
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void checkForUpdates()}
                  disabled={pwa.update === "unsupported" || pwa.update === "checking" || pwa.update === "downloading"}
                >
                  {pwa.update === "checking" ? "Checking…" : pwa.update === "downloading" ? "Downloading…" : "Check for updates"}
                </button>
              )}
            </div>
            <h2 className="section-title">Privacy</h2>
            <div className="group">
              <div className="row"><span className="row-label">Processing</span><span className="row-value">On this device only</span></div>
              <div className="row"><span className="row-label">Uploads, analytics, tracking</span><span className="row-value">None</span></div>
              <div className="row">
                <span className="row-label">Offline</span>
                <span className="row-value">
                  {!pwa.offline.supported ? "Not supported" : pwa.offline.ready ? "Ready" : pwa.offline.total ? `Caching ${pwa.offline.cached}/${pwa.offline.total}` : "Not installed yet"}
                </span>
              </div>
              <div className="row"><span className="row-label">Page requests since launch</span><span className="row-value">{pageRequestCount()}</span></div>
              <div className="row"><span className="row-label">Build</span><span className="row-value">{pwa.offline.version ?? "n/a"}</span></div>
              <div className="row"><span className="row-label">Engine</span><span className="row-value">MuPDF 1.28 + mozjpeg (WebAssembly)</span></div>
            </div>
            <p className="footnote">
              The page's security policy blocks connections to any other server. Your PDF is read into memory, processed
              in a background worker, and released when you leave the result. Nothing is stored. The original file is
              never modified. "Page requests" counts loads of the app's own files and should not grow while processing.
              Licensed AGPL-3.0. <a href={SOURCE_URL} target="_blank" rel="noreferrer">Source code</a>.
            </p>
            {stage.kind === "ready" && <p className="footnote">Selected file: {formatBytes(stage.file.size)}</p>}
          </details>
        )}
      </main>
    </div>
  );
}
