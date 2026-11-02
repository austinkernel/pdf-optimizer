/**
 * MuPDF-based analysis and in-place image optimization.
 *
 * Strategy (docs/milestone-1-feasibility.md §2): only image XObject streams are
 * rewritten, keeping their object numbers. Page content streams (including any
 * invisible OCR text), fonts, annotations, links, outlines, forms and metadata
 * are never modified, so they are preserved by construction. Verification after
 * saving confirms it.
 *
 * Runs unchanged in Node (tests) and in a Web Worker (app).
 */
import * as mupdf from "mupdf";
import { estimateJpegQuality } from "./jpegQuality";
import { encodeJpeg, jpegChroma, type Chroma } from "./jpegEncoder";
import { downsampleArea } from "./resample";
import type {
  AnalysisReport,
  FeatureInfo,
  ImageColorClass,
  ImageInfo,
  ImageOutcome,
  OptimizeOptions,
  OptimizeResult,
  PageInfo,
  ProgressEvent,
  VerificationCheck,
} from "./types";

type PDFDocument = mupdf.PDFDocument;
type PDFObject = mupdf.PDFObject;
type Progress = (e: ProgressEvent) => void;
type OutlineItem = NonNullable<ReturnType<mupdf.Document["loadOutline"]>>[number];

export class EngineError extends Error {
  code: "password" | "not-pdf" | "damaged" | "internal";
  constructor(code: EngineError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const TINY_IMAGE_BYTES = 8 * 1024;

// ---------------------------------------------------------------- helpers

function openPdf(bytes: Uint8Array): PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(bytes, "application/pdf");
  } catch (e) {
    throw new EngineError("not-pdf", `This file could not be opened as a PDF (${(e as Error).message}).`);
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new EngineError("not-pdf", "This file is not a PDF.");
  }
  if (pdf.needsPassword()) {
    pdf.destroy();
    throw new EngineError("password", "This PDF is password-protected. Password support is not available yet.");
  }
  return pdf;
}

/** Null-safe resolve: MuPDF.js throws when resolving the shared null object returned for missing keys. */
function R(o: PDFObject): PDFObject {
  return o.isNull() ? o : o.resolve();
}

/** Null-safe get, for the same reason. */
function G(o: PDFObject, key: string): PDFObject {
  return o.isNull() ? o : o.get(key);
}

function nameOf(o: PDFObject | null | undefined): string | null {
  if (!o || o.isNull()) return null;
  const r = R(o);
  return r.isName() ? r.asName() : null;
}

function filtersOf(dict: PDFObject): string[] {
  const f = R(dict.get("Filter"));
  if (f.isName()) return [f.asName()];
  if (f.isArray()) {
    const out: string[] = [];
    for (let i = 0; i < f.length; i++) {
      const n = nameOf(f.get(i));
      if (n) out.push(n);
    }
    return out;
  }
  return [];
}

/** Describes an image's colour space as stored in the PDF (no decoding). */
function colorSpaceOf(dict: PDFObject): { name: string; n: number | null } {
  if (dict.get("ImageMask").valueOf() === true) return { name: "ImageMask", n: 1 };
  const cs = R(dict.get("ColorSpace"));
  if (cs.isNull()) return { name: "(implicit)", n: null }; // e.g. JPX with internal colour space
  if (cs.isName()) {
    const name = cs.asName();
    const n = name === "DeviceGray" || name === "G" ? 1 : name === "DeviceRGB" || name === "RGB" ? 3 : name === "DeviceCMYK" || name === "CMYK" ? 4 : null;
    return { name, n };
  }
  if (cs.isArray() && cs.length > 0) {
    const family = nameOf(cs.get(0)) ?? "?";
    if (family === "ICCBased") {
      const n = G(R(cs.get(1)), "N").valueOf();
      return { name: `ICCBased(${n})`, n: typeof n === "number" ? n : null };
    }
    if (family === "CalGray") return { name: family, n: 1 };
    if (family === "CalRGB") return { name: family, n: 3 };
    return { name: family, n: null }; // Indexed, Separation, DeviceN, Lab, Pattern
  }
  return { name: "?", n: null };
}

function classify(bpc: number, cs: { name: string; n: number | null }): ImageColorClass {
  if (bpc === 1 || cs.name === "ImageMask") return "bilevel";
  if (cs.n === 1) return "gray";
  if (cs.n === 3) return "color";
  return "other";
}

/** FNV-1a 32-bit. Used to compare per-page text without keeping it in memory. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function countNonWhitespace(s: string): number {
  let c = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 32) c++;
  return c;
}

/** Image XObjects reachable from a resource dictionary, recursing into Form XObjects. */
function collectImageRefs(resources: PDFObject, out: Map<number, PDFObject>, seenForms: Set<number>, depth = 0): void {
  if (depth > 12 || resources.isNull()) return;
  const xobjs = R(G(R(resources), "XObject"));
  if (!xobjs.isDictionary()) return;
  xobjs.forEach((val: PDFObject) => {
    if (!val.isIndirect()) return;
    const num = val.asIndirect();
    const sub = nameOf(val.get("Subtype"));
    if (sub === "Image") out.set(num, val);
    else if (sub === "Form" && !seenForms.has(num)) {
      seenForms.add(num);
      collectImageRefs(val.get("Resources"), out, seenForms, depth + 1);
    }
  });
}

interface Placement {
  min: number;
  max: number;
  /** Effective DPI: as placed on normal pages, or as if printed at Letter size on oversized pages. */
  effMin: number;
  effMax: number;
  oversized: boolean;
}

/**
 * Pages larger than any real paper size (e.g. 59.5 × 79.3 in) come from
 * "photo → PDF" tools that size the page so the photo sits at 72 DPI. Physical
 * DPI is meaningless there, so resolution is judged as if the page were
 * printed with its long side at Letter's 11 in.
 */
export const OVERSIZED_PAGE_LONG_SIDE_IN = 17; // larger than Tabloid/A3
const LETTER_LONG_SIDE_IN = 11;

/**
 * Effective DPI of every image placement, keyed by object number. MuPDF's
 * resource cache returns the same fz_image for the same object, so pointer
 * identity maps a draw call back to its object. This is exact, not a guess.
 */
function measurePlacements(doc: PDFDocument, pageIndex: number, acc: Map<number, Placement>, coverage: { scanned: boolean }): void {
  const page = doc.loadPage(pageIndex) as mupdf.PDFPage;
  try {
    const refs = new Map<number, PDFObject>();
    collectImageRefs(page.getObject().getInheritable("Resources"), refs, new Set());
    const byPtr = new Map<number, number>();
    const loaded: mupdf.Image[] = [];
    for (const [num, ref] of refs) {
      try {
        const img = doc.loadImage(ref);
        loaded.push(img);
        byPtr.set(img.pointer as unknown as number, num);
      } catch {
        /* undecodable image: skip placement measurement */
      }
    }
    const b = page.getBounds();
    const pageArea = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
    const pageLongIn = Math.max(b[2] - b[0], b[3] - b[1]) / 72;
    const oversized = pageLongIn > OVERSIZED_PAGE_LONG_SIDE_IN;
    const printScale = oversized ? LETTER_LONG_SIDE_IN / pageLongIn : 1; // printed size / page size
    const record = (img: mupdf.Image, ctm: mupdf.Matrix) => {
      const wPt = Math.hypot(ctm[0], ctm[1]);
      const hPt = Math.hypot(ctm[2], ctm[3]);
      if (wPt < 0.5 || hPt < 0.5) return;
      if ((wPt * hPt) / pageArea >= 0.85) coverage.scanned = true;
      const num = byPtr.get(img.pointer as unknown as number);
      if (num === undefined) return;
      const dpi = Math.min((img.getWidth() * 72) / wPt, (img.getHeight() * 72) / hPt);
      const eff = dpi / printScale;
      const p = acc.get(num);
      if (p) {
        p.min = Math.min(p.min, dpi);
        p.max = Math.max(p.max, dpi);
        p.effMin = Math.min(p.effMin, eff);
        p.effMax = Math.max(p.effMax, eff);
        p.oversized ||= oversized;
      } else acc.set(num, { min: dpi, max: dpi, effMin: eff, effMax: eff, oversized });
    };
    const dev = new mupdf.Device({
      fillImage: (img, ctm) => record(img, ctm),
      fillImageMask: (img, ctm) => record(img, ctm),
    });
    try {
      page.run(dev, mupdf.Matrix.identity);
    } finally {
      dev.close();
      dev.destroy();
      for (const img of loaded) img.destroy();
    }
  } finally {
    page.destroy();
  }
}

function countOutline(items: OutlineItem[] | null | undefined): number {
  if (!items) return 0;
  let n = 0;
  for (const it of items) n += 1 + countOutline(it.down);
  return n;
}

function readXmp(doc: PDFDocument): string | null {
  const md = doc.getTrailer().get("Root").get("Metadata");
  if (!md.isStream()) return null;
  try {
    return md.readStream().asString();
  } catch {
    return null;
  }
}

function features(doc: PDFDocument): FeatureInfo {
  const trailer = doc.getTrailer();
  const root = trailer.get("Root");
  const annotations: Record<string, number> = {};
  let links = 0;
  let formFields = 0;
  let signatureFields = 0;
  const pages = doc.countPages();
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i) as mupdf.PDFPage;
    try {
      links += page.getLinks().length;
      for (const a of page.getAnnotations()) {
        const t = a.getType();
        if (t === "Link" || t === "Widget") continue;
        annotations[t] = (annotations[t] ?? 0) + 1;
      }
      for (const w of page.getWidgets()) {
        formFields++;
        if (w.getFieldType() === "signature") signatureFields++;
      }
    } finally {
      page.destroy();
    }
  }
  const names = root.get("Names");
  const xmp = readXmp(doc);
  const pdfa = xmp?.match(/pdfaid:part(?:>|=")\s*(\d)/)?.[1] ?? null;
  const metadata: Record<string, string> = {};
  for (const k of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]) {
    const v = doc.getMetaData(`info:${k}`);
    if (v) metadata[k] = v;
  }
  const openAction = R(root.get("OpenAction"));
  return {
    encrypted: !trailer.get("Encrypt").isNull(),
    needsPassword: false,
    outlineItems: countOutline(doc.loadOutline()),
    links,
    annotations,
    formFields,
    signatureFields,
    embeddedFiles: Object.keys(doc.getEmbeddedFiles?.() ?? {}).length,
    javascript: !G(names, "JavaScript").isNull() || nameOf(openAction.isDictionary() ? openAction.get("S") : null) === "JavaScript",
    optionalContent: !root.get("OCProperties").isNull(),
    tagged: !root.get("StructTreeRoot").isNull(),
    pdfaPart: pdfa,
    metadata,
  };
}

// ---------------------------------------------------------------- analysis

interface ImageScan {
  info: ImageInfo;
  ref: PDFObject;
  isSoftMaskTarget: boolean;
  hasDecode: boolean;
}

function scanImages(doc: PDFDocument, placements: Map<number, Placement>): ImageScan[] {
  const smaskTargets = new Set<number>();
  const out: ImageScan[] = [];
  const n = doc.countObjects();
  for (let i = 1; i < n; i++) {
    const ref = doc.newIndirect(i);
    if (!ref.isStream()) continue;
    if (nameOf(ref.get("Subtype")) !== "Image") continue;
    for (const key of ["SMask", "Mask"]) {
      const m = ref.get(key);
      if (m.isIndirect()) smaskTargets.add(m.asIndirect());
    }
    const filters = filtersOf(ref);
    const bpcV = ref.get("BitsPerComponent").valueOf();
    const isMask = ref.get("ImageMask").valueOf() === true;
    const bpc = typeof bpcV === "number" ? bpcV : isMask ? 1 : 8;
    const cs = colorSpaceOf(ref);
    let storedBytes = 0;
    let q: number | null = null;
    let chroma: ImageInfo["jpegChroma"] = null;
    const raw = ref.readRawStream();
    try {
      storedBytes = raw.getLength();
      if (filters.length === 1 && filters[0] === "DCTDecode") {
        // Headers (EXIF/ICC APP segments, DQT, SOF) precede the scan data; 128 KB covers them.
        const head = raw.asUint8Array().subarray(0, 131072);
        q = estimateJpegQuality(head);
        chroma = jpegChroma(head);
      }
    } finally {
      raw.destroy();
    }
    const p = placements.get(i);
    out.push({
      ref,
      isSoftMaskTarget: false,
      hasDecode: !ref.get("Decode").isNull(),
      info: {
        objNum: i,
        width: Number(ref.get("Width").valueOf()) || 0,
        height: Number(ref.get("Height").valueOf()) || 0,
        bitsPerComponent: bpc,
        colorSpace: cs.name,
        colorClass: classify(bpc, cs),
        filters,
        storedBytes,
        minDpi: p ? Math.round(p.min) : null,
        maxDpi: p ? Math.round(p.max) : null,
        minEffectiveDpi: p ? Math.round(p.effMin) : null,
        maxEffectiveDpi: p ? Math.round(p.effMax) : null,
        onOversizedPage: p?.oversized ?? false,
        jpegQualityEstimate: q,
        jpegChroma: chroma,
        hasSoftMask: !ref.get("SMask").isNull() || !ref.get("Mask").isNull(),
        isMask,
      },
    });
  }
  for (const s of out) s.isSoftMaskTarget = smaskTargets.has(s.info.objNum);
  return out;
}

function analyzeOpen(doc: PDFDocument, fileBytes: number, onProgress?: Progress): { report: AnalysisReport; scans: ImageScan[] } {
  const pageCount = doc.countPages();
  const placements = new Map<number, Placement>();
  const pages: PageInfo[] = [];
  for (let i = 0; i < pageCount; i++) {
    onProgress?.({ phase: "summarizing", done: i, total: pageCount });
    const cov = { scanned: false };
    measurePlacements(doc, i, placements, cov);
    const page = doc.loadPage(i) as mupdf.PDFPage;
    try {
      const b = page.getBounds();
      const w = b[2] - b[0];
      const h = b[3] - b[1];
      const st = page.toStructuredText("");
      const text = st.asText();
      st.destroy();
      const rot = Number(page.getObject().getInheritable("Rotate").valueOf()) || 0;
      pages.push({
        index: i,
        widthPt: Math.round(w * 100) / 100,
        heightPt: Math.round(h * 100) / 100,
        rotation: ((rot % 360) + 360) % 360,
        orientation: Math.abs(w - h) < 1 ? "square" : w > h ? "landscape" : "portrait",
        textChars: countNonWhitespace(text),
        scanned: cov.scanned,
      });
    } finally {
      page.destroy();
    }
  }
  const scans = scanImages(doc, placements);
  const f = features(doc);
  const totalTextChars = pages.reduce((s, p) => s + p.textChars, 0);
  const warnings: string[] = [];
  if (f.signatureFields > 0)
    warnings.push(`Contains ${f.signatureFields} signature field(s). Any modification invalidates digital signatures.`);
  if (f.encrypted) warnings.push("The PDF is encrypted (no open password). Its encryption settings will be kept.");
  if (f.pdfaPart) warnings.push(`Declares PDF/A-${f.pdfaPart}. Structure is kept, but conformance is not re-validated.`);
  if (f.javascript) warnings.push("Contains JavaScript. It is kept as-is.");
  const other = scans.filter((s) => s.info.colorClass === "other").length;
  if (other) warnings.push(`${other} image(s) use CMYK/Indexed/Lab/special colour spaces and will be left unchanged in this version.`);
  const bilevel = scans.filter((s) => s.info.colorClass === "bilevel").length;
  if (bilevel) warnings.push(`${bilevel} black-and-white image(s) will be left unchanged (CCITT G4 recompression comes in a later version).`);
  const big = scans.filter((s) => s.info.onOversizedPage).length;
  if (big)
    warnings.push(
      `${big} image(s) sit on oversized, photo-sized pages (typical of photos converted to PDF). Resolution is judged as if each page were printed at Letter size; page dimensions are not changed.`,
    );
  if (scans.length === 0) warnings.push("No embedded images found. Only structural (lossless) savings are possible.");
  return {
    scans,
    report: {
      fileBytes,
      pdfVersion: (() => { const v = Number(doc.getVersion()); return v >= 10 ? `${Math.floor(v / 10)}.${v % 10}` : "?"; })(),
      pageCount,
      pages,
      images: scans.map((s) => s.info),
      imageBytes: scans.reduce((s, x) => s + x.info.storedBytes, 0),
      totalTextChars,
      pagesWithText: pages.filter((p) => p.textChars > 0).length,
      features: f,
      warnings,
    },
  };
}

export function analyze(bytes: Uint8Array, onProgress?: Progress): AnalysisReport {
  onProgress?.({ phase: "opening" });
  const doc = openPdf(bytes);
  try {
    return analyzeOpen(doc, bytes.byteLength, onProgress).report;
  } finally {
    doc.destroy();
  }
}

// ---------------------------------------------------------------- fingerprint (for verification)

interface PageFingerprint {
  w: number;
  h: number;
  rot: number;
  textHash: number;
  textChars: number;
  links: string[];
  annots: number;
  widgets: number;
  thumb: Uint8Array;
  thumbW: number;
  thumbH: number;
}

interface DocFingerprint {
  pages: PageFingerprint[];
  outline: string;
  metadataTitle: string;
}

const THUMB_MAX = 160; // px on the long side; enough to detect blank/garbled pages cheaply

function fingerprintPage(doc: PDFDocument, i: number): PageFingerprint {
  const page = doc.loadPage(i) as mupdf.PDFPage;
  try {
    const b = page.getBounds();
    const w = b[2] - b[0];
    const h = b[3] - b[1];
    const st = page.toStructuredText("");
    const text = st.asText();
    st.destroy();
    const s = THUMB_MAX / Math.max(w, h);
    // Rendering decodes every image on the page. A corrupt replacement stream fails here.
    const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceGray, false, true);
    const tw = pix.getWidth();
    const th = pix.getHeight();
    const stride = pix.getStride();
    const px = pix.getPixels();
    const thumb = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) thumb.set(px.subarray(y * stride, y * stride + tw), y * tw);
    pix.destroy();
    return {
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      rot: Number(page.getObject().getInheritable("Rotate").valueOf()) || 0,
      textHash: hashString(text),
      textChars: countNonWhitespace(text),
      links: page.getLinks().map((l) => l.getURI() ?? ""),
      annots: page.getAnnotations().length,
      widgets: page.getWidgets().length,
      thumb,
      thumbW: tw,
      thumbH: th,
    };
  } finally {
    page.destroy();
  }
}

function outlineSignature(items: OutlineItem[] | null | undefined): string {
  if (!items) return "";
  return items.map((i) => `${i.title}@${i.page ?? i.uri ?? ""}[${outlineSignature(i.down)}]`).join("|");
}

function fingerprint(doc: PDFDocument, onProgress: Progress | undefined, phase: "summarizing" | "verifying"): DocFingerprint {
  const n = doc.countPages();
  const pages: PageFingerprint[] = [];
  for (let i = 0; i < n; i++) {
    onProgress?.({ phase, done: i, total: n });
    pages.push(fingerprintPage(doc, i));
  }
  return { pages, outline: outlineSignature(doc.loadOutline()), metadataTitle: doc.getMetaData("info:Title") ?? "" };
}

function stdDev(a: Uint8Array): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    s2 += a[i] * a[i];
  }
  const m = s / a.length;
  return Math.sqrt(Math.max(0, s2 / a.length - m * m));
}

/** Mean absolute difference of two thumbnails (0–255). */
function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export const VISUAL_MAD_LIMIT = 6; // thumbnail mean |Δ|. JPEG q85 on scans measures well below 1.

function compareFingerprints(a: DocFingerprint, b: DocFingerprint, textMustMatch: boolean): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  add("opens", "Output opens and every page renders", true, `${b.pages.length} pages rendered`);
  add("pagecount", "Page count unchanged", a.pages.length === b.pages.length, `${a.pages.length} → ${b.pages.length}`);
  const n = Math.min(a.pages.length, b.pages.length);
  const geoBad: number[] = [];
  const rotBad: number[] = [];
  const textBad: number[] = [];
  const linkBad: number[] = [];
  const annBad: number[] = [];
  const blank: number[] = [];
  const visual: number[] = [];
  let worstMad = 0;
  for (let i = 0; i < n; i++) {
    const p = a.pages[i];
    const q = b.pages[i];
    if (Math.abs(p.w - q.w) > 0.01 || Math.abs(p.h - q.h) > 0.01) geoBad.push(i + 1);
    if (p.rot !== q.rot) rotBad.push(i + 1);
    if (p.textHash !== q.textHash || p.textChars !== q.textChars) textBad.push(i + 1);
    if (p.links.join("\n") !== q.links.join("\n")) linkBad.push(i + 1);
    if (p.annots !== q.annots || p.widgets !== q.widgets) annBad.push(i + 1);
    if (p.thumbW === q.thumbW && p.thumbH === q.thumbH) {
      const mad = meanAbsDiff(p.thumb, q.thumb);
      worstMad = Math.max(worstMad, mad);
      if (mad > VISUAL_MAD_LIMIT) visual.push(i + 1);
      if (stdDev(q.thumb) < 1.5 && stdDev(p.thumb) > 6) blank.push(i + 1);
    } else visual.push(i + 1);
  }
  const pg = (xs: number[]) => (xs.length > 8 ? `${xs.slice(0, 8).join(", ")}…` : xs.join(", "));
  add("geometry", "Page sizes unchanged", geoBad.length === 0, geoBad.length ? `pages ${pg(geoBad)}` : "all pages match");
  add("rotation", "Page orientation unchanged", rotBad.length === 0, rotBad.length ? `pages ${pg(rotBad)}` : "all pages match");
  const totalChars = a.pages.reduce((s, p) => s + p.textChars, 0);
  if (textMustMatch || totalChars > 0)
    add(
      "text",
      "Searchable text identical",
      textBad.length === 0,
      textBad.length ? `differs on pages ${pg(textBad)}` : totalChars ? `${totalChars.toLocaleString()} characters match` : "no text layer in original",
    );
  add("links", "Links preserved", linkBad.length === 0, linkBad.length ? `differs on pages ${pg(linkBad)}` : `${a.pages.reduce((s, p) => s + p.links.length, 0)} links match`);
  add("annotations", "Annotations and form fields preserved", annBad.length === 0, annBad.length ? `differs on pages ${pg(annBad)}` : "counts match");
  add("outline", "Bookmarks preserved", a.outline === b.outline, a.outline === b.outline ? "outline tree identical" : "outline differs");
  add("blank", "No pages became blank", blank.length === 0, blank.length ? `pages ${pg(blank)}` : "none");
  add(
    "visual",
    "Pages visually consistent (coarse check)",
    visual.length === 0,
    `worst page mean difference ${worstMad.toFixed(2)} of 255 (limit ${VISUAL_MAD_LIMIT})${visual.length ? `; exceeded on pages ${pg(visual)}` : ""}`,
  );
  return checks;
}

// ---------------------------------------------------------------- optimize

function decideSkip(s: ImageScan, o: OptimizeOptions, targetDims: [number, number] | null): ImageOutcome["decision"] | null {
  const i = s.info;
  if (o.jpegQuality === null) return "kept-profile";
  if (i.colorClass === "bilevel") return "kept-bilevel";
  if (s.isSoftMaskTarget || i.hasSoftMask || i.isMask || s.hasDecode) return "kept-mask";
  if (i.colorClass === "other" || i.bitsPerComponent > 16) return "kept-unsupported-colorspace";
  if (i.storedBytes < TINY_IMAGE_BYTES) return "kept-tiny";
  // Already a JPEG at or below the target quality and no downsampling: re-encoding only adds generation loss.
  if (!targetDims && i.jpegQualityEstimate !== null && i.jpegQualityEstimate <= o.jpegQuality) return "kept-already-efficient";
  return null;
}

function targetSize(i: ImageInfo, o: OptimizeOptions): [number, number] | null {
  // Effective DPI: physical for normal pages, Letter-equivalent for oversized photo pages.
  const dpi = i.minEffectiveDpi;
  if (o.downsampleAboveDpi === null || dpi === null) return null;
  if (dpi <= o.downsampleAboveDpi) return null;
  const scale = o.downsampleToDpi / dpi;
  const w = Math.max(1, Math.round(i.width * scale));
  const h = Math.max(1, Math.round(i.height * scale));
  return w < i.width && h < i.height ? [w, h] : null;
}

/** Re-encodes one image in place. Returns its outcome. All WASM objects are released before returning. */
async function rewriteImage(doc: PDFDocument, s: ImageScan, o: OptimizeOptions): Promise<ImageOutcome> {
  const i = s.info;
  const base: ImageOutcome = {
    objNum: i.objNum,
    decision: "kept-no-gain",
    beforeBytes: i.storedBytes,
    afterBytes: i.storedBytes,
    beforeSize: [i.width, i.height],
    afterSize: [i.width, i.height],
  };
  const dims = targetSize(i, o);
  const skip = decideSkip(s, o, dims);
  if (skip) return { ...base, decision: skip };

  let img: mupdf.Image | null = null;
  let pix: mupdf.Pixmap | null = null;
  let small: mupdf.Pixmap | null = null;
  try {
    img = doc.loadImage(s.ref);
    pix = img.toPixmap();
    const cs = pix.getColorSpace();
    const n = pix.getNumberOfComponents();
    if (pix.getAlpha() || !cs || !((cs.isGray() && n === 1) || (cs.isRGB() && n === 3))) {
      return { ...base, decision: "kept-unsupported-colorspace", detail: cs?.getName() };
    }
    let enc = pix;
    if (dims) {
      // Allocate the destination before taking views. Heap growth detaches views.
      small = new mupdf.Pixmap(cs, [0, 0, dims[0], dims[1]], false);
      const sw = pix.getWidth();
      const sh = pix.getHeight();
      const ss = pix.getStride();
      const ds = small.getStride();
      downsampleArea(pix.getPixels(), sw, sh, ss, small.getPixels(), dims[0], dims[1], ds, n);
      pix.destroy();
      pix = null;
      enc = small;
    }
    // Keep 4:2:0 if the source already was 4:2:0: that chroma detail is already gone.
    // Otherwise the profile decides (High Quality keeps full colour resolution).
    const chroma: Chroma = i.jpegChroma === "420" || o.chromaSubsampling ? "420" : "444";
    const w = enc.getWidth();
    const h = enc.getHeight();
    const encoded = await encodeJpeg(enc, o.jpegQuality!, chroma);
    const jpg = encoded.bytes;
    const newLen = jpg.byteLength;
    const detail = `${encoded.encoder} ${encoded.chroma === "gray" ? "gray" : encoded.chroma === "420" ? "4:2:0" : "4:4:4"} q${o.jpegQuality}`;
    if (newLen > i.storedBytes * (1 - o.minGain)) return { ...base, decision: "kept-no-gain", detail: `${detail} would be ${newLen} bytes` };

    // Replace stream bytes. Object number, and every reference to it, stay intact.
    s.ref.writeRawStream(jpg);
    s.ref.put("Filter", doc.newName("DCTDecode"));
    s.ref.delete("DecodeParms");
    s.ref.put("BitsPerComponent", 8);
    s.ref.put("Width", w);
    s.ref.put("Height", h);
    // The /ColorSpace entry is left untouched. Pixels were not colour-converted (Gray/RGB/ICC/Cal with 1 or 3 components).
    return {
      ...base,
      decision: "recompressed",
      afterBytes: newLen,
      afterSize: [w, h],
      detail,
    };
  } finally {
    small?.destroy();
    pix?.destroy();
    img?.destroy();
  }
}

export function saveOptionsFor(pdfaPart: string | null): string {
  // PDF/A-1 forbids object streams. Every other target gets them for extra structural savings.
  const objstms = pdfaPart === "1" ? "" : ",objstms";
  return `garbage=deduplicate,compress,compress-fonts,compress-images${objstms}`;
}

export async function optimize(input: Uint8Array, options: OptimizeOptions, onProgress?: Progress): Promise<OptimizeResult> {
  const t0 = performance.now();
  const inputBytes = input.byteLength;
  onProgress?.({ phase: "opening" });

  let doc: PDFDocument | null = openPdf(input);
  let before: DocFingerprint;
  let out: Uint8Array;
  let saveOptions: string;
  const outcomes: ImageOutcome[] = [];
  try {
    const { report, scans } = analyzeOpen(doc, inputBytes);
    before = fingerprint(doc, onProgress, "summarizing");
    // Largest images first: later (smaller) decodes then fit into blocks already freed,
    // which limits WASM heap fragmentation (the heap never shrinks).
    const order = [...scans].sort((x, y) => y.info.width * y.info.height - x.info.width * x.info.height);
    for (let k = 0; k < order.length; k++) {
      onProgress?.({ phase: "images", done: k, total: order.length });
      outcomes.push(await rewriteImage(doc, order[k], options));
    }
    outcomes.sort((x, y) => x.objNum - y.objNum);
    onProgress?.({ phase: "images", done: scans.length, total: scans.length });
    onProgress?.({ phase: "saving" });
    saveOptions = saveOptionsFor(report.features.pdfaPart);
    const buf = doc.saveToBuffer(saveOptions);
    out = buf.asUint8Array().slice(); // copy out of the WASM heap before freeing
    buf.destroy();
  } finally {
    doc.destroy();
    doc = null;
  }

  // Verify by reopening the saved bytes as an independent document.
  let checks: VerificationCheck[];
  let after: DocFingerprint | null = null;
  try {
    const outDoc = openPdf(out);
    try {
      after = fingerprint(outDoc, onProgress, "verifying");
    } finally {
      outDoc.destroy();
    }
    checks = compareFingerprints(before, after, true);
  } catch (e) {
    checks = [{ id: "opens", label: "Output opens and every page renders", ok: false, detail: (e as Error).message }];
  }
  const totalChars = after?.pages.reduce((s, p) => s + p.textChars, 0) ?? 0;
  return {
    bytes: out,
    inputBytes,
    outputBytes: out.byteLength,
    elapsedMs: Math.round(performance.now() - t0),
    options,
    images: outcomes,
    verification: checks,
    verified: checks.every((c) => c.ok),
    searchableOutput: totalChars > 0,
    saveOptions,
  };
}
