/**
 * App identity per build: the live app and the preview app (a test build of
 * the work in progress, served under /preview/) are two separate Home Screen
 * apps. They differ in name, icon colour and a visible banner, so they cannot
 * be confused. Set VITE_PREVIEW=1 to build the preview variant.
 */
import type { Plugin } from "vite";

export const IS_PREVIEW = process.env.VITE_PREVIEW === "1";
const NAME = IS_PREVIEW ? "PDF Optimizer Preview" : "PDF Optimizer";
const ICON = IS_PREVIEW ? "preview-" : "";

export function appIdentity(): Plugin {
  return {
    name: "app-identity",
    transformIndexHtml(html) {
      return html
        .replaceAll("__APP_NAME__", NAME)
        .replaceAll("__ICON_PREFIX__", ICON)
        .replaceAll("__VARIANT__", IS_PREVIEW ? "preview" : "live");
    },
    generateBundle() {
      const manifest = {
        name: NAME,
        short_name: IS_PREVIEW ? "PDF Preview" : "PDF Optimizer",
        description: IS_PREVIEW
          ? "Test build of upcoming changes. Not the live app."
          : "Private, offline PDF compression for scanned documents. Files never leave the device.",
        id: "./",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#f2f2f7",
        theme_color: "#f2f2f7",
        icons: [
          { src: `${ICON}icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${ICON}icon-512.png`, sizes: "512x512", type: "image/png" },
          { src: `${ICON}icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) });
    },
  };
}
