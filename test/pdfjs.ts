/** Independent second parser for verification in tests: Mozilla pdf.js. */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfjsSummary(bytes: Uint8Array): Promise<{ pages: number; text: string[]; sizes: number[][] }> {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const text: string[] = [];
    const sizes: number[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push([Math.round(vp.width), Math.round(vp.height)]);
      const tc = await page.getTextContent();
      text.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return { pages: doc.numPages, text, sizes };
  } finally {
    await task.destroy();
  }
}
