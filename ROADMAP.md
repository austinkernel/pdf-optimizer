# Roadmap

What's being worked on, what's planned, and what's done. New work is built
on the `next` branch and tried in the preview app before release (see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#releases-and-the-preview-app)).

## Working on (in `next`)

Nothing yet. New ideas start here.

## Planned

- [ ] **Custom settings**: JPEG quality, maximum DPI, grayscale and black-and-white options, with sensible defaults.
- [ ] **Smaller black-and-white scans** (CCITT Group 4). Needs a custom MuPDF build.
- [ ] **Colour spaces and masks** now left unchanged (CMYK, Indexed, images with transparency): handle where it is safe.
- [ ] **Per-page SSIM report** and page-by-page comparison in the results.
- [ ] **Multiple PDFs at once** (batch).
- [ ] **Custom app icon** (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#app-icon)).

## Ideas, not committed

- Merge, split, rotate, reorder and remove pages.
- Convert photos to PDF.
- Extract images from a PDF.
- Metadata inspection and removal.
- On-device OCR for scans that have no text layer (adds roughly 10–20 MB).
- A saved-presets list and a statistics-only compression history.

## Done

- **0.5.0**: sample page preview (side by side, zoom, live profile switching); password-protected PDFs (password kept by default); Android share-to-app; diagnostics moved to Troubleshooting; live/preview offline caches no longer clash.
- **0.4.1**: cleaner results screen (save first, verification and details tap-to-open); collapsible analysis sections.
- **0.4.0**: Android-ready wording and install help; orange theme; updates in a collapsed "App info & updates" section with an "Update ready" badge (no popup); preview app (blue-gray) and roadmap.
- **0.3.0**: reliable update checks, update popup (since replaced), Export diagnostics.
- **0.2.1**: Save to Files fix, mozjpeg 4:2:0 encoder, photo-sized page handling, fresh engine per job.
- **0.2.0**: working offline PWA: analysis, four profiles, in-place compression, verification, Save/Share.
- **0.1.0**: feasibility research.

## Known limitations

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#known-limitations).
