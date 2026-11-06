import { useState } from "react";

/** Asks for the open password of a protected PDF. The password stays in memory for this file only. */
export function PasswordView({
  fileName,
  error,
  onUnlock,
  onCancel,
}: {
  fileName: string;
  error: string | null;
  onUnlock: (password: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <form
      className="home"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw) onUnlock(pw);
      }}
    >
      <div className="lock-icon" aria-hidden="true">
        🔒
      </div>
      <h2 className="processing-title">Password required</h2>
      <p className="footnote center">
        <span className="ellipsis">{fileName}</span> is protected. Enter its password to open it. The password stays on
        this device and is forgotten when you choose another file.
      </p>
      <div className="group">
        <label className="row field">
          <span className="row-label">Password</span>
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-label="PDF password"
          />
        </label>
      </div>
      {error && (
        <p className="footnote center error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-large" disabled={!pw}>
        Unlock
      </button>
      <button type="button" className="btn btn-plain" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
