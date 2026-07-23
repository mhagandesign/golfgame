import { Surface } from '../core/terrain/terrain';

export const SURFACE_COLORS: Record<Surface, number> = {
  [Surface.Rough]: 0x6d9c4a,
  [Surface.Fairway]: 0x8cc152,
  [Surface.Green]: 0xa8d878,
  [Surface.Tee]: 0x9bcf63,
  [Surface.Sand]: 0xe8d9a0,
  [Surface.Water]: 0x4a90c4,
  [Surface.Path]: 0xcbb98a,
};

export const SHIRT_COLORS = [0xd9534f, 0x4a90d9, 0xf0ad4e, 0x9b59b6, 0x2ecc9a, 0xe86fa8];

export function shade(color: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/** Deterministic hash in [0,1) for scatter placement. */
export function hash2(x: number, y: number): number {
  const n = Math.sin(x * 269.5 + y * 183.3) * 43758.5453;
  return n - Math.floor(n);
}

/** Small deterministic per-tile variation so large lawns don't look flat. */
export function tileNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 0.06 - 0.03;
}
