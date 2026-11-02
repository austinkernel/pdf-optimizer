import type { AnalysisReport, ImageInfo } from "../engine/types";
import { formatBytes, paperName, percent } from "../format";

function Row({ label, value, est }: { label: string; value: React.ReactNode; est?: boolean }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-value">
        {value}
        {est && <span className="tag" title="Estimated, not read directly from the file">est.</span>}
      </span>
    </div>
  );
}

function pageSummary(r: AnalysisReport): string {
  const groups = new Map<string, number>();
  for (const p of r.pages) {
    const key = `${paperName(p.widthPt, p.heightPt)} ${p.orientation}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([k, n]) => (groups.size > 1 ? `${n} × ${k}` : k)).join(", ");
}

function range(xs: number[]): string {
  if (!xs.length) return "n/a";
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

function imageSummary(images: ImageInfo[]) {
  const byClass = { color: 0, gray: 0, bilevel: 0, other: 0 };
  const byFilter = new Map<string, number>();
  const byChroma = new Map<string, number>();
  for (const i of images) {
    byClass[i.colorClass]++;
    const f = i.filters.length ? i.filters.join("+").replace(/Decode/g, "") : "uncompressed";
    byFilter.set(f, (byFilter.get(f) ?? 0) + 1);
    if (i.jpegChroma && i.jpegChroma !== "gray") {
      const c = i.jpegChroma === "420" ? "4:2:0" : "4:4:4";
      byChroma.set(c, (byChroma.get(c) ?? 0) + 1);
    }
  }
  const classes = [
    byClass.color && `${byClass.color} color`,
    byClass.gray && `${byClass.gray} grayscale`,
    byClass.bilevel && `${byClass.bilevel} black & white`,
    byClass.other && `${byClass.other} other`,
  ].filter(Boolean);
  return {
    classes: classes.join(", "),
    formats: [...byFilter].map(([f, n]) => `${n} ${f}`).join(", "),
    chroma: [...byChroma].map(([c, n]) => `${n} × ${c}`).join(", "),
    dpi: range(images.map((i) => i.minDpi).filter((d): d is number => d !== null)),
    effDpi: range(images.map((i) => i.minEffectiveDpi).filter((d): d is number => d !== null)),
    oversized: images.some((i) => i.onOversizedPage),
    jpegQ: range(images.map((i) => i.jpegQualityEstimate).filter((q): q is number => q !== null)),
    dims: range(images.map((i) => i.width)) + " × " + range(images.map((i) => i.height)),
  };
}

export function AnalysisView({ report: r, fileName }: { report: AnalysisReport; fileName: string }) {
  const f = r.features;
  const im = imageSummary(r.images);
  const annots = Object.entries(f.annotations);
  const scanned = r.pages.filter((p) => p.scanned).length;
  const rotated = r.pages.filter((p) => p.rotation !== 0).length;
  return (
    <>
      <h2 className="section-title">Document</h2>
      <div className="group">
        <Row label="File" value={<span className="ellipsis">{fileName}</span>} />
        <Row label="Size" value={formatBytes(r.fileBytes)} />
        <Row label="Pages" value={r.pageCount} />
        <Row label="Page size" value={pageSummary(r)} />
        {rotated > 0 && <Row label="Rotated pages" value={rotated} />}
        <Row label="Scanned pages" value={`${scanned} of ${r.pageCount}`} />
        <Row label="PDF version" value={r.pdfVersion} />
      </div>

      <h2 className="section-title">Images</h2>
      <div className="group">
        <Row label="Embedded images" value={r.images.length} />
        {r.images.length > 0 && (
          <>
            <Row label="Share of file" value={`${formatBytes(r.imageBytes)} (${percent(r.imageBytes / r.fileBytes, 0)})`} />
            <Row label="Type" value={im.classes} />
            <Row label="Encoding" value={im.formats} />
            <Row label="Pixel size" value={im.dims} />
            {im.oversized ? (
              <>
                <Row label="Resolution on page" value={`${im.dpi} DPI`} est />
                <Row label="At Letter size" value={`${im.effDpi} DPI`} est />
              </>
            ) : (
              <Row label="Resolution" value={`${im.dpi} DPI`} est />
            )}
            {im.jpegQ !== "n/a" && <Row label="JPEG quality" value={im.jpegQ} est />}
            {im.chroma && <Row label="Colour sampling" value={im.chroma} />}
          </>
        )}
      </div>

      <h2 className="section-title">Text &amp; features</h2>
      <div className="group">
        <Row
          label="Searchable text"
          value={r.totalTextChars > 0 ? `Yes, on ${r.pagesWithText} of ${r.pageCount} pages` : "No (image only)"}
        />
        <Row label="Bookmarks" value={f.outlineItems || "None"} />
        <Row label="Links" value={f.links || "None"} />
        <Row label="Annotations" value={annots.length ? annots.map(([t, n]) => `${n} ${t}`).join(", ") : "None"} />
        <Row label="Form fields" value={f.formFields || "None"} />
        {f.signatureFields > 0 && <Row label="Signature fields" value={f.signatureFields} />}
        <Row label="Encryption" value={f.encrypted ? "Yes (no open password)" : "None"} />
        {f.embeddedFiles > 0 && <Row label="Attachments" value={f.embeddedFiles} />}
        {f.javascript && <Row label="JavaScript" value="Present" />}
        {f.optionalContent && <Row label="Layers" value="Present" />}
        {f.tagged && <Row label="Tagged (accessibility)" value="Yes" />}
        {f.pdfaPart && <Row label="PDF/A" value={`Part ${f.pdfaPart}`} />}
      </div>
      <p className="footnote">
        "est." values are estimated from how images are drawn and encoded. Everything else is read directly from the
        file. All of the features above are kept unchanged by compression and checked afterwards.
      </p>

      {r.warnings.length > 0 && (
        <div className="notice notice-warn" role="note">
          <strong>Before you compress</strong>
          <ul>
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
