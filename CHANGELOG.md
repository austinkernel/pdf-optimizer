# Changelog

## 0.3.0: updates and diagnostics
### Added
- **Reliable update checks.** iOS resumes Home Screen apps instead of
  relaunching them, so 0.2.0 kept running after 0.2.1 was deployed. The app
  now checks at launch, every time it returns to the foreground (at most once
  a minute), and every 30 minutes while open.
- **Update popup** in the middle of the screen when a new version is
  downloaded, with "Update now" and "Later" (or ✕). It never appears during
  a compression; it waits until the job ends.
- **App & updates section**, visible without opening anything: version,
  update status ("Up to date (checked 7:10 PM)", "Downloading update…",
  "Update ready to install", offline or error), and a **Check for updates** /
  **Install update now** button.
- **Export diagnostics** on the analysis and results screens. A
  structure-only report (pages, images: pixels, encoding, DPI, JPEG quality,
  chroma; features as counts; last compression decisions and checks)
  excludes the file name, metadata values, text, link targets and image
  content. It is shown in full before sharing, via Share / Save as text
  file or Copy.
### Changed
- The small update bar at the top is replaced by the popup.
### Tests
- Unit: the diagnostics report contains structure and never metadata
  values, text or link targets.
- e2e (19/19):
  - a manual check reports up to date;
  - a simulated new release shows the popup, which can be dismissed,
    reinstalled from Settings, and reloads into the new version;
  - the diagnostics dialog is structure-only.

## 0.2.1: fixes from first on-device test
### Fixed
- **Save to Files saved a text file** containing the PDF's name. The share
  sheet was given a `title` along with the file, and iOS shared it as a
  separate text item. The app now shares the file only.
- **Balanced gave 0% on a real 103 MB phone-style scan.** MuPDF's JPEG
  encoder always writes 4:4:4 (full-resolution colour), so re-encoding 4:2:0
  phone/scanner JPEGs could not beat the originals.
### Changed
- JPEG encoding now uses **mozjpeg** (WASM, Apache-2.0): 4:2:0 colour,
  trellis quantisation, optimised Huffman tables, standard quantisation
  tables (so quality numbers keep their IJG meaning). It falls back to
  MuPDF's encoder for images over 40 MP or on encoder failure.
- Sources that are already 4:2:0 stay 4:2:0. Balanced and Compact use
  4:2:0. High Quality keeps 4:4:4 for full-colour sources.
- The codec loads at worker startup, so processing still makes zero network
  requests.
- The analysis screen shows each image's colour sampling (4:2:0 / 4:4:4).
- The no-reduction message explains why, and suggests Compact.
- **Photo-sized pages** (e.g. 59.5 × 79.3 in from iOS photo-to-PDF, where
  each photo sits at 72 DPI) are now judged at Letter size for downsampling.
  Before, the real 103 MB file reported 72 DPI and was never downsampled;
  its 12–48 MP photos are 366–519 DPI at Letter size. Page dimensions are
  unchanged. The analysis shows both values.
- **Fresh engine per compression job:** the worker is recycled after each
  job, because MuPDF's WASM heap never shrinks and fragments (measured: about
  +35 MB per job with 12 MP photos). Within a job, images are processed
  largest first.
- Network counters now measure from the moment the document reaches a ready
  engine. The e2e test also asserts the whole session makes only same-origin
  GET requests with no bodies.
### Measured (synthetic fixtures, same verification as before)
- Colour lossless scan: Balanced −88% → −92%, Compact −97.1% → −97.9%.
- q97 JPEG scan: High −12% → −43%, Balanced −68% → −79%,
  Compact −92% → −94.5%.
- q75 JPEG scan: Compact −39% → −55%.
- Phone-style q92 4:2:0 scan: Balanced 0% → −7%, Compact −77%.
- iPhone photo→PDF, 12 MP q93 on a 72 DPI page: Balanced −17%, Compact −90.5%.
- iPhone photo→PDF, 24 MP q93: Balanced −85%, Compact −97%.

## 0.2.0 — Milestone 2 (proof of concept)
### Added
- PWA (React + TypeScript + Vite), installable, works offline via a
  generated precache service worker.
- MuPDF/WASM engine in a Web Worker:
  - analysis: pages, geometry, rotation, images, effective DPI, JPEG quality
    estimate, text layer, links, outline, annotations, forms, signatures,
    encryption, PDF/A, JavaScript, layers;
  - in-place JPEG recompression of colour and grayscale images, with
    area-average downsampling;
  - structural optimization: deduplication, object streams, compression;
  - post-save verification: reopen and render, page count, geometry,
    rotation, text hash, links, annotations, outline, blank-page and coarse
    visual checks.
- Four profiles: Lossless, High Quality, Balanced, Compact.
- Cancellation (worker termination), duplicate-job guard, wake lock, typed
  errors.
- Results screen with verification checklist, rename, Save/Share, Download,
  and in-app network request counters.
- Vitest suite (38 tests) with generated scan fixtures, a pdf.js
  cross-check, a benchmark, and a headless-Chromium end-to-end test.
- CI and GitHub Pages deployment workflows. AGPL-3.0 license.

## 0.1.0 — Milestone 1
- Feasibility report and engine experiments.
