/**
 * Estimate the IJG (libjpeg) quality setting that produced a JPEG stream by
 * comparing its luminance quantization table with the standard Annex K table.
 *
 * libjpeg scales the base table by S = q < 50 ? 5000/q : 200 - 2q (percent),
 * so S ≈ mean(Q_file / Q_std) * 100 and q is solved from S. Encoders that use
 * custom tables (some scanners, mozjpeg) give an approximate "equivalent IJG
 * quality". That is fine here: it only decides whether re-encoding at the
 * target quality is worthwhile.
 */
const STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
];

// DQT tables are stored in zig-zag order; this maps zig-zag index → natural index.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
];

/** Returns the luminance (table id 0) quantization table in natural order, or null. */
export function readLumaQuantTable(jpeg: Uint8Array): number[] | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end: no DQT found before data
    const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xdb) {
      let p = i + 4;
      const end = i + 2 + len;
      while (p < end) {
        const pq = jpeg[p] >> 4; // 0 = 8-bit, 1 = 16-bit entries
        const tq = jpeg[p] & 0x0f;
        p++;
        const table = new Array<number>(64);
        for (let k = 0; k < 64; k++) {
          const v = pq ? (jpeg[p + 2 * k] << 8) | jpeg[p + 2 * k + 1] : jpeg[p + k];
          table[ZIGZAG[k]] = v;
        }
        p += pq ? 128 : 64;
        if (tq === 0) return table;
      }
    }
    i += 2 + len;
  }
  return null;
}

export function estimateJpegQuality(jpeg: Uint8Array): number | null {
  const t = readLumaQuantTable(jpeg);
  if (!t) return null;
  let sum = 0;
  for (let k = 0; k < 64; k++) sum += (t[k] * 100) / STD_LUMA[k];
  const s = sum / 64;
  if (s <= 1) return 100; // all-ones table
  const q = s <= 100 ? (200 - s) / 2 : 5000 / s;
  return Math.max(1, Math.min(100, Math.round(q)));
}
