// Usage: node exp_mupdf.mjs <in.pdf> <out.pdf> <jpegQuality> [saveOpts]
import * as mupdf from "mupdf";
import fs from "node:fs";
const [inp, outp, qArg, saveOpts = "garbage=compact,compress,compress-fonts,objstms"] = process.argv.slice(2);
const q = Number(qArg);
const t0 = performance.now();
const doc = mupdf.Document.openDocument(fs.readFileSync(inp), "application/pdf").asPDF();
const stats = { images: 0, recompressed: 0, kept: 0, skippedBilevel: 0, before: 0, after: 0 };
if (q > 0) {
  const n = doc.countObjects();
  for (let i = 1; i < n; i++) {
    const ref = doc.newIndirect(i, 0);
    const obj = ref;
    if (!obj.isStream() || obj.get("Subtype").asName?.() !== "Image") continue;
    stats.images++;
    const raw = obj.readRawStream();
    stats.before += raw.getLength();
    const bpc = obj.get("BitsPerComponent").valueOf();
    if (bpc === 1 || obj.get("ImageMask").valueOf() === true) { stats.skippedBilevel++; stats.after += raw.getLength(); continue; }
    if (!obj.get("SMask").isNull() || !obj.get("Mask").isNull()) { stats.kept++; stats.after += raw.getLength(); continue; }
    const img = doc.loadImage(ref);
    let pix = img.toPixmap();
    const cs = pix.getColorSpace();
    const csName = cs.isGray() ? "/DeviceGray" : cs.isRGB() ? "/DeviceRGB" : null;
    if (!csName) { stats.kept++; stats.after += raw.getLength(); continue; } // CMYK/Indexed/ICC: handled later
    const jpg = pix.asJPEG(q, false);
    if (jpg.length >= raw.getLength() * 0.95) { stats.kept++; stats.after += raw.getLength(); continue; } // only replace if meaningfully smaller
    obj.writeRawStream(jpg);          // replaces stream bytes, leaves the object number + every reference intact
    obj.put("Filter", doc.newName("DCTDecode"));
    obj.delete("DecodeParms");
    obj.put("ColorSpace", doc.newName(csName.slice(1)));
    obj.put("BitsPerComponent", 8);
    obj.delete("Decode");
    stats.recompressed++; stats.after += jpg.length;
  }
}
const buf = doc.saveToBuffer(saveOpts).asUint8Array();
fs.writeFileSync(outp, buf);
const ms = performance.now() - t0;
console.log(JSON.stringify({ inp, q, saveOpts, inBytes: fs.statSync(inp).size, outBytes: buf.length,
  reduction: (1 - buf.length / fs.statSync(inp).size) * 100, ms: Math.round(ms), ...stats,
  heapMB: Math.round(process.memoryUsage().rss / 1048576) }));
