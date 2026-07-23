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

/** Small deterministic per-tile variation so large lawns don't look flat. */
export function tileNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (n - Math.floor(n)) * 0.06 - 0.03;
}
