# Changelog

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
