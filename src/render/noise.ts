/**
 * Tileable value-noise / FBM used by the texture generators. Pure math —
 * lattice gradients wrap at `period` so generated textures tile seamlessly.
 */

function latticeHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 144665) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return (((h ^ (h >> 16)) >>> 0) % 10000) / 10000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise in [0,1]; coordinates in lattice cells (period cells per tile). */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const w = (i: number) => ((i % period) + period) % period;
  const v00 = latticeHash(w(xi), w(yi), seed);
  const v10 = latticeHash(w(xi + 1), w(yi), seed);
  const v01 = latticeHash(w(xi), w(yi + 1), seed);
  const v11 = latticeHash(w(xi + 1), w(yi + 1), seed);
  const sx = smooth(xf);
  const sy = smooth(yf);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

/** Tileable fractal brownian motion in [0,1]. u,v in [0,1) texture space. */
export function fbm(u: number, v: number, octaves: number, baseFreq: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * freq, v * freq, freq, seed + o * 101) * amp;
    total += amp;
    amp *= 0.55;
    freq *= 2;
  }
  return sum / total;
}
