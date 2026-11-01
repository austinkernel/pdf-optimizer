/**
 * Area-averaging (box-filter) downsampler for interleaved 8-bit pixel data.
 *
 * Each destination pixel is the exact area-weighted mean of the source pixels
 * it covers, including fractional edge coverage. For pure downsampling this
 * gives no aliasing and no ringing. Ringing halos around text are the main
 * artefact to avoid on scanned documents, which is why this is used instead
 * of bicubic.
 *
 * Works directly on views of WASM memory. Callers must allocate both buffers
 * before taking the views, because WASM heap growth detaches existing views.
 */
export function downsampleArea(
  src: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  sstride: number,
  dst: Uint8ClampedArray | Uint8Array,
  dw: number,
  dh: number,
  dstride: number,
  n: number,
): void {
  if (dw > sw || dh > sh) throw new Error("downsampleArea only reduces size");
  const sx = sw / dw;
  const sy = sh / dh;
  // Precompute horizontal spans: for each dst column, the src columns + weights.
  const xStart = new Int32Array(dw);
  const xEnd = new Int32Array(dw);
  const xW: Float32Array[] = new Array(dw);
  for (let x = 0; x < dw; x++) {
    const a = x * sx;
    const b = a + sx;
    const i0 = Math.floor(a);
    const i1 = Math.min(sw, Math.ceil(b));
    xStart[x] = i0;
    xEnd[x] = i1;
    const w = new Float32Array(i1 - i0);
    for (let i = i0; i < i1; i++) w[i - i0] = Math.min(b, i + 1) - Math.max(a, i);
    xW[x] = w;
  }
  const row = new Float64Array(dw * n); // horizontal sums for one source row
  const acc = new Float64Array(dw * n); // vertical accumulation for one dst row
  const norm = 1 / (sx * sy);
  for (let y = 0; y < dh; y++) {
    const a = y * sy;
    const b = a + sy;
    const j0 = Math.floor(a);
    const j1 = Math.min(sh, Math.ceil(b));
    acc.fill(0);
    for (let j = j0; j < j1; j++) {
      const wy = Math.min(b, j + 1) - Math.max(a, j);
      const so = j * sstride;
      for (let x = 0; x < dw; x++) {
        const w = xW[x];
        const i0 = xStart[x];
        const i1 = xEnd[x];
        for (let c = 0; c < n; c++) {
          let s = 0;
          for (let i = i0; i < i1; i++) s += src[so + i * n + c] * w[i - i0];
          row[x * n + c] = s;
        }
      }
      for (let k = 0; k < dw * n; k++) acc[k] += row[k] * wy;
    }
    const doff = y * dstride;
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < n; c++) dst[doff + x * n + c] = Math.round(acc[x * n + c] * norm);
    }
  }
}
