# Development notes

Technical details for building, testing, deploying and changing the app.
For what the app is and how to install it, see the [README](../README.md).

## How it works

It is a PWA (React + TypeScript + Vite). A Web Worker runs MuPDF
(WebAssembly), which recompresses the scan images inside a PDF **in place**,
without re-rendering pages. Searchable OCR text, links, bookmarks,
annotations, forms and metadata are left untouched, and every output is
reopened and verified before it can be saved. JPEG encoding uses mozjpeg
(WebAssembly).

Background and measurements:
- [milestone-1-feasibility.md](milestone-1-feasibility.md): engine
  research and design (§2 explains in-place recompression).
- [milestone-2-poc.md](milestone-2-poc.md): proof of concept, plus
  on-device findings.
- [../CHANGELOG.md](../CHANGELOG.md): changes per version.
- [../ROADMAP.md](../ROADMAP.md): planned work.

## Privacy model

- PDFs are processed in a Web Worker on the device. The site only serves
  the app's own static files.
- The Content Security Policy (`connect-src 'self'`) blocks connections to
  other servers. The app counts network requests during processing (page
  and worker), and the e2e test asserts zero.
- No analytics, tracking, accounts or cookies. Only the chosen profile is
  remembered (`localStorage`).
- Passwords for protected PDFs live only in memory for the current file. By
  default the output keeps the original encryption and password; the
  "Keep the password" switch off saves it with MuPDF's `decrypt`.
- A PDF shared from another app (Android share target) is stored briefly
  in the app's own Cache Storage by the service worker, read once by the
  page, and deleted immediately. The e2e test checks it never reaches the
  server.
- **Export diagnostics** (App info & updates → Troubleshooting) produces a
  structure-only text report, with no file name, text, metadata values,
  links or image content. It is shown in full before sharing.

## Code layout

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
  components/        screens: analysis, profile picker, processing, results, dialogs
  pwa.ts             service-worker registration, update checks, offline status
  install.ts         install help (Android install prompt, iPhone instructions)
  share.ts           picks up a PDF shared from another app (Android share target)
  diagnostics.ts     structure-only diagnostics report
build/precache-sw.ts build-time generated precache service worker (no runtime caching)
build/app-identity.ts live vs preview app name, icons, colours and manifest
test/                Vitest suite with synthetic scan fixtures (no real documents)
scripts/e2e.mjs      end-to-end test of the built app in headless Chromium
scripts/e2e-preview.mjs  live/preview isolation test
```

## Commands

Node 22. Everything runs in a cloud dev environment; no Mac is required.

```sh
npm ci
npm test               # unit + integration tests (engine, fixtures, pdf.js cross-check)
npm run bench          # size/time table across fixtures and profiles
npm run build          # production build into dist/
npm run e2e            # end-to-end test of dist/ (Playwright + Chromium; iPhone profile)
E2E_DEVICE="Pixel 7" npm run e2e   # same, Android profile
npm run build:preview  # live app + preview app into dist/ and dist/preview/
npm run e2e:preview    # checks the two apps don't interfere
npm run dev            # local dev server
```

## Deployment

`.github/workflows/deploy.yml` tests and builds, then publishes to GitHub
Pages:
- `main` at `https://<user>.github.io/pdf-optimizer/` (the live app);
- `next`, if that branch exists, at `/pdf-optimizer/preview/` (the preview
  app).

It runs on every push to `main`, and after CI passes on `next`.

**One-time setup for a fork:** Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

## Releases and the preview app

1. New work is built on the `next` branch.
2. CI runs, and the **PDF Optimizer Preview** app (blue-gray icon, striped
   "PREVIEW" banner) updates a few minutes later at `/preview/`. Install it
   as a second Home Screen app to try changes.
3. When the batch is ready, one pull request merges `next` into `main`. The
   live app updates, and `next` is moved up to `main`.

The preview has its own name, icons, colours, manifest and service-worker
scope. The live app's service worker ignores `/preview/` requests. Both
apps share one origin's Cache Storage, so every cache name includes the
worker's scope (`pdfopt:/pdf-optimizer/:<version>`), and each app only
deletes its own caches.

## App icon

To use a custom icon, start from one square PNG, ideally **1024 × 1024**,
with a solid (not transparent) background and square corners. iOS and
Android round the corners themselves. Keep the important part inside the
middle ~80% (Android may crop to a circle). All sizes are generated from it:

| File (in `public/`) | Size | Used by |
|---|---|---|
| `apple-touch-icon.png` | 180 × 180 | iPhone/iPad Home Screen |
| `icon-192.png` | 192 × 192 | Android, browser tab, in-app header |
| `icon-512.png` | 512 × 512 | Android install and splash screen |
| `icon-maskable-512.png` | 512 × 512, artwork inside the centre 80% | Android adaptive (circle/squircle) icons |
| `preview-*.png` (same four) | same | Preview app, with the "PREVIEW" band |

`scripts/make-icons.py` currently draws the default icon.

## Platform notes

- **iPhone/iPad:** Safari, iOS 16.4+. Web apps can't receive files from the
  Share Sheet, so import uses the Files picker. iOS pauses web apps in the
  background, so processing needs the app in the foreground. iOS usually
  *resumes* Home Screen apps instead of relaunching them, so update checks
  run on launch, on return to the foreground and every 30 minutes.
- **Android:** Chrome, Edge, Samsung Internet. Installed apps appear in the
  share sheet for PDFs (`share_target` in the manifest, handled by the
  service worker). Tested in Chromium with a Pixel 7 profile, not yet on a
  physical phone.

## Known limitations

- Black-and-white (1-bit) images are kept as-is. CCITT G4 needs a custom
  MuPDF build.
- CMYK, Indexed, Lab and Separation images, and images with transparency
  masks, are kept as-is.
- The sample preview covers one page at a time; there is no whole-document
  visual comparison yet.
- Very large documents are limited by the browser's memory for web apps.
