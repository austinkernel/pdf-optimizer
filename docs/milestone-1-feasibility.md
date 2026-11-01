# Milestone 1 — Technical Feasibility Report

Date: 2026-11-01 · Status: **complete, pending owner decisions (§10)**

## 0. Summary

**Recommendation:** an installable PWA (React + TypeScript + Vite) whose
processing engine is **MuPDF compiled to WebAssembly**, running in a Web
Worker. It performs **in-place image-stream replacement**: each embedded
image XObject is decoded, optionally downsampled, re-encoded (JPEG for
continuous-tone images, CCITT G4 for bilevel ones) and written back into
the *same PDF object*. Content streams, the invisible OCR text layer, fonts,
annotations, links, bookmarks, forms and metadata are **never touched**.
Pages are never rasterized.

The approach was tested in this session (§6), not inferred from docs. On
synthetic 300 DPI scans with an OCR layer, links and bookmarks it gave
**71–92% reductions**. The text layer, links, outline, page boxes and
metadata came through bit-identical, the output passed qpdf's structural
check, and SSIM was ≥ 0.99 at q85–95.

Two engine stages are planned:

| Stage | Engine | Status |
|---|---|---|
| A (Milestone 2) | Stock `mupdf` npm package (1.28.1). A JS image rewriter over its object API: `loadImage` → `Pixmap.asJPEG` → `writeRawStream`. | **Proven in this session** |
| B (Milestones 3/5) | Custom MuPDF WASM build that also exposes the native `pdf_rewrite_images()` | Native function proven via PyMuPDF (same C code, MuPDF 1.28.5). WASM build not yet done. |

Stage B adds what the stock binding lacks:
- bicubic or average downsampling
- **CCITT G4** for bilevel scans (measured −37% vs Flate, lossless)
- JPEG 2000
- lower peak memory (decode-time subsampling)

## 1. Session capabilities (inspected, not assumed)

| Capability | Available | Notes |
|---|---|---|
| Claude Code in cloud container | ✅ | Linux, Node 22, Go, Python 3.13, git |
| Shell / file editing / tests | ✅ | |
| Network (npm, PyPI, GitHub, web) | ✅ | Via the session's egress proxy |
| GitHub (repo `austinkernel/Testing`, **private**) | ✅ | Branches, commits, PRs via MCP |
| Headless browser | ⚠️ Chromium only | **No WebKit.** iOS behaviour must be verified on your iPhone. |
| Web research | ✅ | |
| Artifacts (claude.ai pages) | ✅ | Usable for UI exploration. Not a substitute for the PWA. |
| Deployment connector (Cloudflare/Netlify) | ❌ | Deployment will be a git-connected static host you link once (§8) |
| Mac / Xcode | ❌ (by constraint) | Rules out native Swift apps |

Persistence: the container is ephemeral. Everything that matters is committed
and pushed to the GitHub repo.

## 2. The core technical question

> Can a real PDF optimizer selectively recompress embedded scanned images
> while preserving structure and searchable text, entirely offline on an
> iPhone?

**Yes, with MuPDF/WASM.** The key insight is that a scanned page is almost
always:

```
page content stream:  q 612 0 0 792 0 0 cm /Im0 Do Q      ← paints the scan
                      BT 3 Tr /F1 10 Tf ... (text) Tj ET   ← invisible OCR text
/Im0  → image XObject stream (DCT/Flate/JBIG2/CCITT/JPX)    ← 95–99% of file size
```

Only the image XObject stream needs to change. Replacing its bytes (and the
`/Filter`, `/ColorSpace`, `/BitsPerComponent`, `/Width`, `/Height` and
`/DecodeParms` keys) keeps the same object number. Every reference to it stays
valid, and the drawing matrix (`cm`) maps it to the same page area regardless
of pixel dimensions, so **downsampling does not change geometry**.

This differs from the two weaker approaches:

| Approach | Compression | Text layer | Links/annots/forms/outline | Verdict |
|---|---|---|---|---|
| Render every page → JPEG → new PDF (pdf.js + pdf-lib) | Good | **Lost** (unless re-OCR'd) | **Lost** | Rejected: destructive |
| Re-save with a generic JS library (pdf-lib, qpdf) | ~0% on scans | Kept | Kept | Rejected: doesn't touch images |
| Ghostscript `pdfwrite` (re-interprets and *re-generates* the whole PDF) | Good | Usually kept | Often altered or dropped (forms, some annotations, structure, metadata) | Rejected as primary. Heavy and not structure-preserving. |
| **In-place image XObject rewrite (MuPDF)** | Good | **Kept by construction** | **Kept by construction** | **Chosen** |

## 3. Engine comparison

Sources are listed in §11. "Verified" means tested in this session.

| Engine | Runs in iOS Safari/PWA | Selective image recompression | Encoders available | Preserves structure | License | Size | Notes |
|---|---|---|---|---|---|---|---|
| **MuPDF (`mupdf` npm, Artifex)** | Yes. Official WASM, documents Safari support. *iOS to verify.* | **Verified** via object API. Native `pdf_rewrite_images` in a custom build. | JPEG (libjpeg, verified). Native also has CCITT G4 (verified), J2K, Flate. Decodes JPEG, JPX, JBIG2, CCITT, Flate, LZW, RunLength. | **Verified**: text, links, outline, metadata, geometry | **AGPL-3.0** or commercial | 10 MB wasm (3.5 MB brotli) | Actively maintained (1.28.x, 2026). Best fit. |
| Ghostscript (`@okathira/ghostpdl-wasm` etc.) | Possible. ~18 MB wasm, heavy memory. | No: re-distills the entire document | JPEG, Flate, CCITT | Partial; regenerates the file | AGPL-3.0 | ~18 MB | Fallback "repair/aggressive" mode at most |
| PDFium (e.g. `@embedpdf/pdfium` WASM) | Yes | Possible via `FPDFImageObj_SetJpegFileInline` / `SetBitmap` | JPEG passthrough; no G4 encoder | Editing an image requires `FPDFPage_GenerateContent`, which **rewrites the whole page content stream**. Risky for OCR text/marked content. | BSD-3 / Apache-2.0 | ~4–5 MB | Permissive license, but structural risk and fewer encoders. Plan-B engine if AGPL is unacceptable. |
| qpdf (`@neslinesli93/qpdf-wasm`) | Yes | No (structural only: object streams, linearization, stream recompression) | Flate only | Yes | Apache-2.0 | ~1.5 MB | Optional lossless structural pass. MuPDF `garbage/objstms` already covers it. |
| pdfcpu (Go → WASM possible) | Possible | No; `optimize` deduplicates resources, no re-encoding | — | Yes | Apache-2.0 | Large Go runtime | Not useful for scans |
| pdf-lib | Yes | No image decoding/re-encoding | — | Partial (drops some features on copy) | MIT | Small | Low maintenance since 2021. Not needed. |
| PDF.js (`pdfjs-dist` 6.x) | Yes | No (renderer/parser) | — | n/a | Apache-2.0 | ~1.5 MB | Not needed. MuPDF renders previews too, so one engine fewer. |
| ImageMagick WASM (`@imagemagick/magick-wasm`) | Yes | Images only; PDF via Ghostscript (rasterizes) | Many | n/a | Apache-2.0 | ~10 MB+ | Redundant with MuPDF / browser codecs |
| Browser-native (`OffscreenCanvas.convertToBlob('image/jpeg')`, `createImageBitmap`) | Yes | Encoder only | JPEG/PNG (WebP not in Safari) | n/a | — | 0 | Encoder quality and chroma subsampling are not controllable. Strips nothing harmful, but MuPDF's libjpeg is more predictable. Possible fast path. |
| jbig2enc (C++, Apache-2.0 + Leptonica) | No WASM build found; would need porting | Bilevel only | JBIG2 generic/symbol | — | Apache-2.0 / BSD | ? | Deferred. **Lossy symbol mode is banned for this app** (Xerox digit-substitution class of bugs). Lossless generic region only, if ever. |
| OCR: tesseract.js v5+ | Yes (iOS 17+ supported per v5 notes), fully offline when self-hosted | — | — | Adds an invisible text layer | Apache-2.0 | ~4 MB core + ~3–15 MB per language | Optional later feature, not a dependency (§9) |

### Encoding strategy per image class (Stage B targets)

| Image class (detected) | Default action |
|---|---|
| Color continuous-tone (photo or color scan) | JPEG, quality per profile. Downsample above the profile DPI ceiling. |
| Grayscale | JPEG gray (1 channel, about 3× smaller than RGB). Detect RGB images that are effectively gray and convert them (only with the "allow grayscale conversion" setting). |
| Bilevel (1-bit) | **CCITT G4** (lossless). Keep the original if it is already JBIG2/G4 and smaller. Never JBIG2 symbol mode. |
| Already-JPEG source at ≤ target quality | **Skip** (avoids generational loss for little gain). Source quality is estimated from the quantization tables. |
| Images with SMask/Mask, Indexed, ICC, CMYK, Lab, 16-bit | Stage A: leave untouched and report it. Stage B: handled by the native rewriter where safe. |
| Tiny images (< ~8 KB) | Skip |

**Rule:** replace an image only if the result is meaningfully smaller
(default ≥ 5%). Otherwise keep the original bytes.

## 4. Licensing analysis (AGPL)

MuPDF is **AGPL-3.0-or-later** (commercial licence from Artifex otherwise). For
a personal-use PWA:

- The AGPL's network clause (§13) obliges you to offer the **complete
  corresponding source** to *users who interact with the software over a
  network*. Serving the app from a URL counts.
- If **you are the only user**, there is no practical obligation and no
  conflict.
- If the URL is publicly reachable, anyone visiting it is a "user". The clean
  solutions are:
  1. License the app itself as AGPL-3.0 and show a "Source code" link in the app.
     With a private repo this means providing source on request. A public repo
     makes it automatic.
  2. Or keep the repo private **and** put the site behind Cloudflare Access
     (free tier), so only you can load it.
- Other components (React, Vite, Workbox) are MIT/Apache and compatible with
  AGPL.
- If AGPL is ever unacceptable, the fallback is PDFium (BSD/Apache), with the
  structural risks noted above.

**My recommendation:** license the project AGPL-3.0, host on Cloudflare Pages
from the private repo, and gate it with Cloudflare Access so only you can use
it. This is not legal advice, but it is the standard compliance posture.

## 5. iOS / PWA compatibility assessment

| Concern | Finding | Design response |
|---|---|---|
| WebAssembly | Supported in iOS Safari and Home Screen PWAs. MuPDF lists Safari as supported. | Run MuPDF in a dedicated module Worker |
| **Memory ceiling** (the main risk) | No published limit. Field reports range from ~100 MB (iPhone SE 3) to 1–2 GB on recent devices. `memory.grow` failure can kill the tab instead of throwing. | Process one image at a time and `destroy()` every pixmap/image immediately. Avoid extra copies (transfer `ArrayBuffer`s). Stage B decode-time subsampling. Pre-flight estimate (§7). Calibrate on your actual iPhone. |
| Node measurement (proxy, not iOS) | 54 MB / 3-page color Flate file: peak RSS ≈ 420 MB including the Node runtime (~70 MB baseline). The input buffer, output buffer and one 25 MB decoded page dominate. | Stage A fits medium files. Large files need Stage B plus a size guard. |
| Background execution | iOS suspends a PWA's JS when it leaves the foreground | The UI says "keep the app open". Request a Screen Wake Lock (support in standalone mode to be verified). Detect `visibilitychange` and resume or abort cleanly. |
| Import | File picker (`<input type=file accept=application/pdf multiple>`) opens the Files app, including iCloud Drive and On My iPhone. **No Web Share Target on iOS**, so the app **cannot** appear as a destination in the Share Sheet. | File picker is the import path. Share Sheet import is not achievable without a native app. Stated as a limitation, not hidden. |
| Export | `navigator.share({files})` (Web Share Level 2, Safari 15+) for the Share Sheet and "Save to Files"; `<a download>` as fallback | Both. Sharing PDF files to be verified on device. |
| Offline | Service Worker plus Cache API precache (wasm ~10 MB raw). Home Screen web apps are exempt from Safari's 7-day storage eviction. | Workbox precache, versioned. "Ready offline" indicator once caching is verified. |
| Temporary storage | OPFS available (Safari 15.2+) | Use for oversized input/output only if needed (Milestone 5). By default no document bytes are persisted. |

## 6. Experimental evidence (this session)

Reproducible with the scripts in `research/milestone-1/`. Fixtures are
generated by `make_fixtures.py`: 3-page US Letter, 300 DPI page-size raster
with paper tone, blur and sensor noise, a photo region and a red stamp. Each
also has an **invisible OCR text layer (Tr 3)**, a URI link annotation per
page, a 3-entry outline and a Title. Fixtures are synthetic, so real scans
must still be tested (Milestone 3).

### 6.1 Stage A: stock `mupdf` 1.28.1, JS rewriter (`exp_mupdf.mjs`)

Save options: `garbage=compact,compress,compress-fonts,objstms`

| Fixture | Original | q95 | q90 | q85 |
|---|---|---|---|---|
| Color, Flate (lossless) | 54.47 MB | 12.78 MB (−76.5%) | 6.14 MB (−88.7%) | 4.36 MB (−92.0%) |
| Color, JPEG q97 4:4:4 | 22.71 MB | 17.46 MB (−23.1%) | 6.46 MB (−71.5%) | 4.48 MB (−80.3%) |
| Gray, JPEG q97 | 10.18 MB | 7.92 MB (−22.2%) | 4.24 MB (−58.3%) | 2.95 MB (−71.0%) |
| Bilevel 1-bit Flate | 0.20 MB | untouched (correct) | untouched | untouched |

Time: 1.5–6.4 s per 3 pages in Node (desktop CPU). Expect 2–4× slower on an
iPhone; to be measured.

### 6.2 Integrity checks (`inspect.mjs` + `compare.py`): all outputs

Every output passed these checks: page count, page boxes, rotation,
**extracted text (all 5,477 chars identical)**, link URIs, outline tree and
Title.

| Variant | SSIM (min page, luminance, 150 DPI render) | PSNR | max abs diff |
|---|---|---|---|
| q95 | 0.995–0.996 | 52–54 dB | 2–3 |
| q90 | 0.994 | 51–52 dB | 3 |
| q85 | 0.992 | 50 dB | 4–5 |
| q85 + bicubic 300→200 DPI (native) | 0.983 | 41.6 dB | 25 |

An independent parser (qpdf via pikepdf) reported **0 syntax problems** on all
outputs, with images now `/DCTDecode`.

### 6.3 Stage B preview: native `pdf_rewrite_images` (PyMuPDF 2.0 / MuPDF 1.28.5)

- JPEG q90 output is **byte-size identical** to the Stage A JS rewriter, so the
  Stage A approach matches MuPDF's own optimizer.
- Bicubic downsample 300→200 DPI + q85: color 22.71 MB → **1.66 MB (−92.7%)**,
  all integrity checks pass.
- **CCITT G4** on the bilevel fixture: 197 KB → **123 KB (−37%)**, lossless.
  MuPDF's `recompress_when=smaller` heuristic did *not* pick G4 even though it
  was smaller. Our code must force G4 per image and compare sizes itself.
- The stock npm `saveToBuffer()` **rejects** image-rewrite options ("unknown
  pdf option"). They live in `pdf_rewrite_images`, not in the writer. That is
  why Stage B needs a custom WASM build.

### 6.4 What the metrics mean for scans

- **SSIM** (luminance, at a fixed render DPI) is the primary gate. It tracks
  structure such as text edges and is robust to the noise removal that JPEG
  performs on scans. Proposed gates: warn below 0.98; fail and keep the
  original below 0.95.
- **PSNR** is misleading on scans. JPEG removes sensor noise, which lowers
  PSNR without visible harm, and it is insensitive to local text damage.
  Reported for information only.
- **Max abs pixel diff** is useless alone because one noisy pixel dominates.
  Use it only for "lossless" profile assertions (must be 0).
- **Blank-page detection** (per-page luminance std-dev collapse) and **text
  extraction equality** catch catastrophic failures that metrics average away.
- Possible later addition: SSIMULACRA2 or Butteraugli for perceptual quality.
  They are too heavy for on-device use by default.

## 7. Recommended architecture

```
┌──────────── PWA (static assets only, served over HTTPS) ────────────┐
│ UI thread: React + TS                                                │
│  Home · Analysis · Settings · Preview · Processing · Results · Privacy│
│        │ postMessage (ArrayBuffers transferred, not copied)          │
│        ▼                                                             │
│ engine.worker.ts  ── implements the PdfEngine interface              │
│   ├─ analyze(buf)  → pages, boxes, rotation, images (w×h, bpc,       │
│   │                  cs, filter, effective DPI from CTM), text layer, │
│   │                  annots, links, outline, AcroForm, encryption,   │
│   │                  signatures, JS, embedded files, layers           │
│   ├─ preview(buf, page, profile) → before/after bitmaps + real bytes │
│   ├─ optimize(buf, profile, onProgress, abortSignal) → Uint8Array    │
│   └─ validate(orig, out) → structural diff + SSIM per page           │
│        │                                                             │
│        ▼                                                             │
│ MuPDF WASM (Stage A: npm build; Stage B: custom build)               │
│ Service Worker: precache app + wasm; no runtime fetches for docs     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Engine isolation:** UI code depends only on `PdfEngine`, so the engine can
  be replaced (e.g. PDFium) without UI changes.
- **Effective DPI** is computed from the image pixel size and the placement
  CTM found by walking page content. MuPDF's device API reports image draws
  with their transform.
- **Pre-flight guard:** before starting, estimate peak memory as
  `input + output_estimate + largest_decoded_image × 2`. Warn or refuse above a
  calibrated device budget.
- **Signed PDFs:** any rewrite invalidates digital signatures. Detect `/Sig`
  fields and warn before processing.
- **Encrypted PDFs:** open with a user-supplied password (MuPDF supports
  it). Output is saved unencrypted unless re-encryption is added later. Warn.
- **Never overwrite:** the output is a new file named `name (compressed).pdf`.
  The original is never modified; it is read-only input.

### Compression profiles (initial calibration, refined in Milestone 2/3)

MuPDF uses the IJG libjpeg quality scale. "95" there is roughly equivalent to
Photoshop/Acrobat "maximum". Already-JPEG sources are re-encoded only when the
estimated source quality exceeds the target by a margin.

| Profile | Color/gray JPEG q | Downsample when > | to | Bilevel | Other |
|---|---|---|---|---|---|
| Lossless | none | no | — | G4 if smaller (lossless) | Flate recompress, object streams, dedupe, garbage collect |
| High Quality | 95 | no | — | G4 | Keep dimensions |
| Balanced | 90 | 400 DPI | 300 DPI | G4 | |
| Compact | 85 | 250 DPI | 200 DPI | G4 (downsample bilevel > 400 → 300) | |
| Custom | user | user | user | user | Gray conversion, monochrome conversion (explicit opt-in) |

## 8. Development and deployment plan

**Build:** everything is built and tested in this cloud container and
committed to GitHub. CI in GitHub Actions builds the app, runs unit tests
(Vitest) and runs engine integration tests on the fixture corpus in Node.
Stage B adds an emsdk job that builds the custom MuPDF WASM reproducibly,
with pinned MuPDF tag and emsdk version.

**Hosting comparison**

| Host | Private repo | Cost | Access gating | Verdict |
|---|---|---|---|---|
| GitHub Pages | Needs a paid plan for private repos | $4/mo (Pro) | None built in | No |
| **Cloudflare Pages** | ✅ free | $0 | Cloudflare Access free (≤ 50 users) | **Recommended** |
| Netlify | ✅ free | $0 | Password protection is paid | OK alternative |

**Privacy enforcement**

- A strict CSP is enforced, with `connect-src 'self'` and no third-party
  origins.
- No analytics or tracking.
- The service worker never sends document data.
- A "Network monitor" panel in Settings counts `fetch`/XHR calls during
  processing using a PerformanceObserver on resource timing (expected: 0).
- The engine Worker has no network code path.

## 9. Known limitations and risks (ranked)

1. **iOS memory ceiling.** Very large scans (e.g. 200+ MB, or single 600 DPI
   color pages, about 100 MB decoded) may exceed the WASM heap and kill the
   tab. Mitigation: per-image processing, Stage B decode-time subsampling,
   pre-flight guard, calibration on your phone. **Must be tested on a real
   device.**
2. **No WebKit in the dev container.** Safari-specific bugs can only be
   found on your iPhone. A one-tap "Self-test" page in the app will run the
   fixture suite on-device and show the results.
3. **Share Sheet import impossible** for PWAs on iOS (no Web Share Target).
   Import goes through the Files picker.
4. **Background processing:** the app must stay in the foreground.
5. **AGPL obligations** if the URL is public; addressed by Access gating
   and an AGPL licence.
6. **Stage B custom WASM build** is engineering risk (emsdk build, binding
   code). Stage A is a working fallback, so Stage B is not on the critical
   path.
7. **JPEG re-encoding of already-JPEG scans** has generational loss. It is
   mitigated by quality estimation and skipping, and SSIM is reported.
8. **Digital signatures** are always invalidated by any byte change. Detected
   and warned.
9. **On-device OCR** (tesseract.js) is feasible but slow on phones (several
   seconds per page) and adds 7–20 MB. It is deferred. It is only needed when
   the source has no text layer, because our method keeps existing layers.

## 10. Decisions needed from you

1. **Hosting/licensing:** private repo + Cloudflare Pages + Cloudflare Access
   + AGPL licence (recommended), *or* a public repo (simpler, anyone can see
   the code)?
2. **Repository:** build in `austinkernel/Testing` (current, private), or
   create a dedicated repo such as `pdf-optimizer`? (Creating repos is outside
   this session's GitHub scope, so you would create it and add it to the
   session.)

The minimum action needed to start Milestone 2 is answering (1) and (2).
Nothing else is required from you until on-device testing. The Cloudflare
account and linking come at Milestone 6.

## 11. Sources

- MuPDF.js repo and README (AGPL/commercial, Safari support, manual `destroy()` memory model): https://github.com/ArtifexSoftware/mupdf.js · npm: https://www.npmjs.com/package/mupdf
- `mutool clean` image options (per-class subsample/recompress: jpeg, j2k, fax, jbig2): https://mupdf.readthedocs.io/en/latest/tools/mutool-clean.html
- MuPDF `image-rewriter.h` (`pdf_rewrite_images`, `FZ_RECOMPRESS_FAX`): https://mupdf.readthedocs.io/en/latest/_static/generated/c/html/image-rewriter_8h_source.html
- MuPDF licensing explainer: https://ghostscript.com/~robin/mupdf_explored/mupdf_exploredse159.html
- Ghostscript WASM compression demo (pdfwrite, ~18 MB wasm): https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm · AGPL build: https://cdn.jsdelivr.net/npm/@okathira/ghostpdl-wasm@1.1.0/README.md
- PDFium image-object editing API: https://pdfium.googlesource.com/pdfium/+/31d706bd8/fpdfsdk/fpdfeditimg.cpp
- pdfcpu optimize (dedupe, not re-encode): https://pdfcpu.io/core/optimize.html
- jbig2enc: https://github.com/agl/jbig2enc
- tesseract.js v5 (iOS 17 compatibility, offline hosting): https://github.com/naptha/tesseract.js/releases/tag/v5.0.0
- iOS Safari memory reports: https://lapcatsoftware.com/articles/2026/1/7.html · https://bugs.webkit.org/show_bug.cgi?id=221530 · https://github.com/microsoft/onnxruntime/issues/26827
- Web Share Target not supported in WebKit: https://bugs.webkit.org/show_bug.cgi?id=194593 · https://firt.dev/notes/pwa-ios/
