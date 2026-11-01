// Dump structure + render pages for comparison: node inspect.mjs <pdf> <pngPrefix>
import * as mupdf from "mupdf";
import fs from "node:fs";
const [p, prefix] = process.argv.slice(2);
const doc = mupdf.Document.openDocument(fs.readFileSync(p), "application/pdf");
const out = { pages: doc.countPages(), boxes: [], rot: [], text: [], links: [], outline: [], title: doc.getMetaData("info:Title") };
for (let i = 0; i < out.pages; i++) {
  const pg = doc.loadPage(i);
  out.boxes.push(pg.getBounds().map(v => Math.round(v * 100) / 100));
  out.rot.push(pg.getObject().getInheritable?.("Rotate")?.valueOf?.() ?? 0);
  out.text.push(pg.toStructuredText().asText().trim());
  out.links.push(pg.getLinks().map(l => l.getURI()));
  const pix = pg.toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(`${prefix}_p${i}.png`, pix.asPNG());
}
const walk = (items) => items?.map(o => ({ t: o.title, p: o.page, c: walk(o.down) }));
out.outline = walk(doc.loadOutline());
fs.writeFileSync(`${prefix}.json`, JSON.stringify(out));
