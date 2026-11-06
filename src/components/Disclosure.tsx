import type { ReactNode } from "react";

/** Collapsible section: a title row with a short summary on the right. */
export function Disclosure({ title, summary, open, children, tone }: { title: string; summary?: ReactNode; open?: boolean; children: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        <span className="disclosure-title">{title}</span>
        {summary !== undefined && <span className={`disclosure-summary${tone ? ` ${tone}` : ""}`}>{summary}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
