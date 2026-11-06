# Roadmap

What's being worked on, what's planned, and what's done. New work is built
on the `next` branch and tried in the preview app before release (see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#releases-and-the-preview-app)).

## Working on (in `next`)

Nothing yet. New ideas start here.

## Planned

- [ ] **Sample preview**: compress one page first, then compare before and after side by side, with zoom, before running the whole file.
- [ ] **Custom settings**: JPEG quality, maximum DPI, grayscale and black-and-white options, with sensible defaults.
- [ ] **Smaller black-and-white scans** (CCITT Group 4). Needs a custom MuPDF build.
- [ ] **Password-protected PDFs**: ask for the password and process the file.
- [ ] **Colour spaces and masks** now left unchanged (CMYK, Indexed, images with transparency): handle where it is safe.
- [ ] **Per-page SSIM report** and page-by-page comparison in the results.
- [ ] **Multiple PDFs at once** (batch).
- [ ] **Android: open PDFs from the share sheet** ("Share → PDF Optimizer"). Android supports this for installed web apps; iPhone does not.
- [ ] **Custom app icon** (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#app-icon)).

## Ideas, not committed

- Merge, split, rotate, reorder and remove pages.
- Convert photos to PDF.
- Extract images from a PDF.
- Metadata inspection and removal.
- On-device OCR for scans that have no text layer (adds roughly 10–20 MB).
- A saved-presets list and a statistics-only compression history.

## Done

- **0.4.0**: Android-ready wording and install help; orange theme; updates in a collapsed "App info & updates" section with an "Update ready" badge (no popup); preview app (blue-gray) and roadmap.
- **0.3.0**: reliable update checks, update popup (since replaced), Export diagnostics.
- **0.2.1**: Save to Files fix, mozjpeg 4:2:0 encoder, photo-sized page handling, fresh engine per job.
- **0.2.0**: working offline PWA: analysis, four profiles, in-place compression, verification, Save/Share.
- **0.1.0**: feasibility research.

## Known limitations

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#known-limitations).
