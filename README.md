# Offline PDF Optimizer (iPhone PWA)

Personal, fully on-device PDF compressor for scanned documents. It recompresses
embedded scan images **in place**, without rasterizing pages, so the OCR text
layer, links, bookmarks, annotations, forms and metadata are preserved.

**Status:** Milestone 1 (feasibility) complete. The application is not built yet.

- Feasibility report, architecture and plan: [`docs/milestone-1-feasibility.md`](docs/milestone-1-feasibility.md)
- Reproducible engine experiments: [`research/milestone-1/`](research/milestone-1/)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Planned architecture (summary)
React + TypeScript + Vite PWA → Web Worker → MuPDF (WebAssembly). Static
hosting serves only app assets; documents never leave the device.

## Incomplete features
Everything after Milestone 1. See the milestone plan in the report.
