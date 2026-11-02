import { useEffect, useRef, useState, type ReactNode } from "react";

/** Centered modal sheet. Closes on backdrop tap or Escape. */
export function Modal({ title, onClose, children, labelledBy }: { title: string; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panel}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <h2 id={labelledBy} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function UpdateDialog({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  return (
    <Modal title="Update available" onClose={onLater} labelledBy="update-title">
      <div className="modal-icon" aria-hidden="true">
        ⬆︎
      </div>
      <p className="modal-text">
        A new version of PDF Optimizer has been downloaded and is ready to use. Updating reloads the app. Your files are
        not affected.
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-large" onClick={onUpdate}>
          Update now
        </button>
        <button type="button" className="btn btn-plain" onClick={onLater}>
          Later
        </button>
      </div>
    </Modal>
  );
}

export function DiagnosticsDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const fileName = `pdf-optimizer-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;

  const share = async () => {
    setStatus(null);
    const file = new File([text], fileName, { type: "text/plain" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] }); // file only (see ResultsView)
      } catch (e) {
        if ((e as Error).name !== "AbortError") setStatus(`Sharing failed: ${(e as Error).message}`);
      }
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Copy isn't available here. Use Share instead.");
    }
  };

  return (
    <Modal title="Diagnostics" onClose={onClose} labelledBy="diag-title">
      <p className="modal-text small">
        This report describes the document's structure: page sizes, image dimensions, encodings and settings. It
        contains <strong>no file name, text, metadata values, links or image content</strong>. Review it before sharing.
      </p>
      <pre className="diag-pre" tabIndex={0}>
        {text}
      </pre>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={share}>
          Share / Save as text file
        </button>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy
        </button>
      </div>
      {status && <p className="footnote center">{status}</p>}
    </Modal>
  );
}
