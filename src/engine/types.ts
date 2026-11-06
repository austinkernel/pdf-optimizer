/**
 * Engine boundary. The UI depends only on these types and on EngineClient,
 * so the processing engine (currently MuPDF/WASM) can be replaced without
 * touching interface code.
 */

export type ProfileId = "lossless" | "high" | "balanced" | "compact";

export interface OptimizeOptions {
  profile: ProfileId;
  /** IJG libjpeg quality (1–100) for continuous-tone images. null = never re-encode images. */
  jpegQuality: number | null;
  /** Store colour at half resolution (4:2:0), the norm for scans and photos. Sources that are already 4:2:0 always stay 4:2:0. */
  chromaSubsampling: boolean;
  /** Downsample images whose effective resolution exceeds this many DPI. null = never downsample. */
  downsampleAboveDpi: number | null;
  /** Target resolution when downsampling. */
  downsampleToDpi: number;
  /** Replace an image only if the new stream is at least this fraction smaller (0.05 = 5%). */
  minGain: number;
}

export interface PageInfo {
  index: number;
  /** Displayed size in points, after /Rotate is applied. */
  widthPt: number;
  heightPt: number;
  rotation: number;
  orientation: "portrait" | "landscape" | "square";
  /** Non-whitespace characters extracted from the page (searchable text). */
  textChars: number;
  /** True if one image covers ≥ 85% of the page: a scanned page. */
  scanned: boolean;
}

export type ImageColorClass = "color" | "gray" | "bilevel" | "other";

export interface ImageInfo {
  objNum: number;
  width: number;
  height: number;
  bitsPerComponent: number;
  colorSpace: string;
  colorClass: ImageColorClass;
  /** Filter chain, e.g. ["DCTDecode"]. Empty = uncompressed. */
  filters: string[];
  /** Size of the stored (compressed) stream in bytes. */
  storedBytes: number;
  /** Lowest effective DPI over all placements (null if never drawn on a page). Estimated from the drawing matrix. */
  minDpi: number | null;
  maxDpi: number | null;
  /** DPI used for downsampling decisions: same as minDpi/maxDpi, except on oversized pages, where it is measured as if printed at Letter size. */
  minEffectiveDpi: number | null;
  maxEffectiveDpi: number | null;
  /** Drawn on a page larger than any paper size (photo-to-PDF style). */
  onOversizedPage: boolean;
  /** Estimated IJG quality for JPEG streams (null if not JPEG or not estimable). */
  jpegQualityEstimate: number | null;
  /** Chroma layout of JPEG streams: "420" (any subsampling), "444", "gray"; null if not JPEG. */
  jpegChroma: "420" | "444" | "gray" | null;
  hasSoftMask: boolean;
  isMask: boolean;
}

export interface FeatureInfo {
  encrypted: boolean;
  needsPassword: boolean;
  outlineItems: number;
  links: number;
  /** Annotation counts by subtype, excluding links and form widgets. */
  annotations: Record<string, number>;
  formFields: number;
  signatureFields: number;
  embeddedFiles: number;
  javascript: boolean;
  optionalContent: boolean;
  tagged: boolean;
  /** PDF/A part declared in XMP (e.g. "1", "2"), or null. */
  pdfaPart: string | null;
  metadata: Record<string, string>;
}

export interface AnalysisReport {
  fileBytes: number;
  pdfVersion: string;
  pageCount: number;
  pages: PageInfo[];
  images: ImageInfo[];
  /** Bytes held in image streams (sum of storedBytes). */
  imageBytes: number;
  totalTextChars: number;
  pagesWithText: number;
  features: FeatureInfo;
  /** Things the user should know before compressing. */
  warnings: string[];
}

export type ImageDecision =
  | "recompressed"
  | "kept-no-gain"
  | "kept-already-efficient"
  | "kept-bilevel"
  | "kept-mask"
  | "kept-unsupported-colorspace"
  | "kept-tiny"
  | "kept-profile";

export interface ImageOutcome {
  objNum: number;
  decision: ImageDecision;
  beforeBytes: number;
  afterBytes: number;
  beforeSize: [number, number];
  afterSize: [number, number];
  detail?: string;
}

export interface VerificationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface OptimizeResult {
  bytes: Uint8Array;
  inputBytes: number;
  outputBytes: number;
  elapsedMs: number;
  options: OptimizeOptions;
  images: ImageOutcome[];
  verification: VerificationCheck[];
  /** True if every verification check passed. */
  verified: boolean;
  searchableOutput: boolean;
  saveOptions: string;
  /** Open-password protection of the output: "kept" (same password as the original), "removed", or "none". */
  password: "kept" | "removed" | "none";
  /** Network requests made by the engine worker while processing (expected: 0). Set by the worker. */
  workerNetworkRequests?: number;
}

export type ProgressEvent =
  | { phase: "opening" }
  | { phase: "summarizing"; done: number; total: number }
  | { phase: "images"; done: number; total: number }
  | { phase: "saving" }
  | { phase: "verifying"; done: number; total: number };

export interface SampleImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** One page compressed with a profile, rendered next to the original. */
export interface SampleResult {
  pageIndex: number;
  pageCount: number;
  original: SampleImage;
  compressed: SampleImage;
  imageCount: number;
  /** Measured stored size of this page's images before and after re-encoding. */
  imageBytesBefore: number;
  imageBytesAfter: number;
  outcomes: ImageOutcome[];
  options: OptimizeOptions;
  elapsedMs: number;
}
