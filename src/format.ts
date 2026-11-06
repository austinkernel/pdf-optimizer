/** Decimal units, matching how the iOS Files and Android Files apps report sizes. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function percent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const PAPER: [string, number, number][] = [
  ["US Letter", 612, 792],
  ["US Legal", 612, 1008],
  ["A4", 595.28, 841.89],
  ["A5", 419.53, 595.28],
  ["A3", 841.89, 1190.55],
  ["Tabloid", 792, 1224],
];

export function paperName(w: number, h: number): string {
  const [a, b] = w < h ? [w, h] : [h, w];
  for (const [name, pw, ph] of PAPER) if (Math.abs(a - pw) < 3 && Math.abs(b - ph) < 3) return name;
  return `${(w / 72).toFixed(2)} × ${(h / 72).toFixed(2)} in`;
}

/** "Report (compressed).pdf". Strips path separators and control characters. */
export function outputName(original: string, custom?: string): string {
  const raw = (custom ?? "").trim() || `${original.replace(/\.pdf$/i, "")} (compressed)`;
  const clean = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180);
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}
