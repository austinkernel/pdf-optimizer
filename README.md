# PDF Optimizer

A private, offline PDF compressor for scanned documents, built as an
installable iPhone web app (PWA).

It recompresses the scan images inside a PDF **in place**, without
re-rendering pages. Searchable OCR text, links, bookmarks, annotations, forms
and metadata are left untouched, and every output is verified before you
save it.

**Status:** Milestone 2, working proof of concept. See
[`docs/milestone-2-poc.md`](docs/milestone-2-poc.md).

## Privacy model

- PDFs are processed in a Web Worker on your device by MuPDF (WebAssembly).
- The hosting site only serves the app's own static files. No document
  bytes are ever sent anywhere. The page's Content Security Policy
  (`connect-src 'self'`) blocks connections to other servers, and the app
  shows a count of network requests made during processing (expected: 0).
- There are no analytics, tracking, accounts or cookies. Only your chosen
  profile is remembered (`localStorage`).
- The original file is never modified. Output is a new file.

## Architecture

```
src/
  engine/            replaceable processing engine (UI depends only on types.ts + client.ts)
    types.ts         engine boundary types
    mupdfEngine.ts   analysis, in-place image rewrite, save, verification (Node + worker)
    resample.ts      area-average downsampler (no ringing around text)
    jpegQuality.ts   IJG quality estimation from JPEG quantization tables
    jpegEncoder.ts   mozjpeg (WASM) encoder: 4:2:0/4:4:4, trellis; MuPDF fallback
    profiles.ts      Lossless / High Quality / Balanced / Compact
    worker.ts        Web Worker entry
    client.ts        UI-side job runner: progress, cancel (terminates worker), dedupe
  components/        iOS-style screens: analysis, profile picker, processing, results
  pwa.ts             service-worker registration, update checks, offline status
  diagnostics.ts     structure-only diagnostics report
build/precache-sw.ts build-time generated precache service worker (no runtime caching)
build/app-identity.ts live vs preview app name, icons and manifest
test/                Vitest suite with synthetic scan fixtures (no real documents)
scripts/e2e.mjs      end-to-end test of the built app in headless Chromium
docs/                feasibility report and milestone reports
```

How compression works is explained in
[`docs/milestone-1-feasibility.md`](docs/milestone-1-feasibility.md) §2.

## Development

You need Node 22. Everything also runs in a cloud dev environment; no Mac is
required.

```sh
npm ci
npm test            # unit + integration tests (engine, fixtures, pdf.js cross-check)
npm run bench       # size/time table across fixtures and profiles
npm run build       # production build into dist/
npm run e2e         # end-to-end test of dist/ (requires Playwright + Chromium)
npm run dev         # local dev server
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every
push to `main`.

One-time setup:
1. Go to the repository's Settings → Pages.
2. Under "Build and deployment" → Source, choose **GitHub Actions**.

The app is then served at `https://<user>.github.io/pdf-optimizer/` over
HTTPS. To install it on an iPhone:
1. Open the URL in Safari.
2. Tap Share → Add to Home Screen.
3. Launch it once from the Home Screen while online, so the service worker
   caches the app (about 15 MB) for offline use.

Updates: the app checks for a new version at launch, whenever it returns to
the foreground, and every 30 minutes. When one has downloaded, an "Update
available" popup appears. Tap **Update now**, or later use **App & updates →
Install update now**. **Check for updates** in the same section checks
immediately.

Diagnostics: **Export diagnostics** (on the analysis and results screens)
produces a structure-only text report for troubleshooting, with no file name,
text, metadata values, links or image content. It is shown before sharing.

## Releases and the preview app

Work is collected on the `next` branch and tried on the phone through a
second, orange **PDF Optimizer Preview** app at
`https://<user>.github.io/pdf-optimizer/preview/`, before one merge releases
it all. The plan and status are in [`ROADMAP.md`](ROADMAP.md).

- `npm run build:preview` builds the live app and the preview into `dist/`.
- `npm run e2e:preview` checks that the two apps do not interfere (separate
  service worker scopes, names and icons).
- `.github/workflows/deploy.yml` publishes `main` at the site root and `next`
  under `/preview/`.

## Known limitations (current version)

- Black-and-white (1-bit) images are kept as-is. CCITT G4 needs a custom
  MuPDF build (planned).
- CMYK, Indexed, Lab and Separation images, and images with transparency
  masks, are kept as-is.
- Password-protected PDFs (open password) are not supported yet.
- No Share Sheet import. iOS does not let web apps receive shared files, so
  use the Files picker. Exporting via the Share Sheet works.
- The app must stay in the foreground while processing.
- No page-by-page visual comparison or sample preview yet (Milestone 4).
- Very large documents are limited by iOS memory for web apps. The real limit
  will be measured on-device (Milestone 5).

## License

AGPL-3.0-or-later (required by MuPDF). See [LICENSE](LICENSE).
