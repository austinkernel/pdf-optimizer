# Roadmap

What's being worked on, what's planned, and what's done. Ideas get added here
as they come up. They are built and tested in batches on the `next` branch,
tried on the phone through the **preview app**, and released together in a
single merge into `main`.

## How releases work

| Where | What it is | Who sees it |
|---|---|---|
| `main` branch → **PDF Optimizer** (blue icon) | The live app | Your daily app |
| `next` branch → **PDF Optimizer Preview** (orange icon, "PREVIEW" banner) | Work in progress, tested | Install it as a second Home Screen app to try changes before release |

1. A new idea is added below under **Planned**.
2. It is built on `next`. Automatic tests run, and the preview app updates itself a few minutes later.
3. Try it in the preview app. Say what to change.
4. When the batch is good, `next` is merged into `main` in one pull request. The live app updates, and `next` restarts from `main`.

The preview app opens at `https://austinkernel.github.io/pdf-optimizer/preview/`.
It never sends documents anywhere and keeps no documents, same as the live app.

## Working on (in `next`)

- [ ] **Updates moved into a collapsed "App info & updates" section**, like Privacy. No popup. A small dot and "Update ready" label next to the section title when a new version has downloaded.

## Planned

- [ ] **Sample preview**: compress one page first, then compare before and after side by side, with zoom, before running the whole file.
- [ ] **Custom settings**: JPEG quality, maximum DPI, grayscale and black-and-white options, with sensible defaults.
- [ ] **Smaller black-and-white scans** (CCITT Group 4). Needs a custom MuPDF build.
- [ ] **Password-protected PDFs**: ask for the password and process the file.
- [ ] **Colour spaces and masks** now left unchanged (CMYK, Indexed, images with transparency): handle where it is safe.
- [ ] **Per-page SSIM report** and page-by-page comparison in the results.
- [ ] **Multiple PDFs at once** (batch).

## Ideas, not committed

- Merge, split, rotate, reorder and remove pages.
- Convert photos to PDF.
- Extract images from a PDF.
- Metadata inspection and removal.
- On-device OCR for scans that have no text layer (adds roughly 10–20 MB).
- A saved-presets list and a statistics-only compression history.

## Done

- **0.3.0**: reliable update checks, update popup (being replaced), Export diagnostics.
- **0.2.1**: Save to Files fix, mozjpeg 4:2:0 encoder, photo-sized page handling, fresh engine per job.
- **0.2.0**: working offline PWA: analysis, four profiles, in-place compression, verification, Save/Share.
- **0.1.0**: feasibility research.

## Known limitations

See the README.
