import { Terrain } from '../core/terrain/terrain';

/** Isometric diamond projection (2:1) with vertical height steps. */
export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;
export const HEIGHT_STEP = 10;

export function worldToScreen(fx: number, fy: number, h: number): { x: number; y: number } {
  return {
    x: (fx - fy) * TILE_HALF_W,
    y: (fx + fy) * TILE_HALF_H - h * HEIGHT_STEP,
  };
}

/** Inverse projection at a given height plane. */
export function screenToWorldFlat(sx: number, sy: number, h: number): { x: number; y: number } {
  const ay = sy + h * HEIGHT_STEP;
  const a = sx / TILE_HALF_W;
  const b = ay / TILE_HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/**
 * Pick the terrain position under a screen point, accounting for elevation:
 * iterate the flat inverse using the height at the previous guess.
 */
export function screenToWorld(terrain: Terrain, sx: number, sy: number): { x: number; y: number } {
  let guess = screenToWorldFlat(sx, sy, 0);
  for (let i = 0; i < 5; i++) {
    const h = terrain.heightAt(guess.x, guess.y);
    guess = screenToWorldFlat(sx, sy, h);
  }
  return guess;
}
