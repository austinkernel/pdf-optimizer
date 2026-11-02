// Node has no fetch-for-file:// path for the codec, so compile mozjpeg's wasm from disk once per test worker.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { configureJpegEncoder } from "../src/engine/jpegEncoder";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("@jsquash/jpeg/package.json"));
await configureJpegEncoder(await WebAssembly.compile(readFileSync(join(pkgDir, "codec/enc/mozjpeg_enc.wasm"))));
