import { describe, expect, it } from 'vitest';
import { Surface, Terrain } from './terrain';

describe('Terrain', () => {
  it('starts flat at the base height', () => {
    const t = new Terrain(8, 8, 2);
    expect(t.isFlat(3, 3)).toBe(true);
    expect(t.heightAt(4, 4)).toBe(2);
    expect(t.surfaceAt(0, 0)).toBe(Surface.Rough);
  });

  it('raises a vertex and propagates the slope constraint', () => {
    const t = new Terrain(8, 8, 2);
    t.setVertexConstrained(4, 4, 5);
    expect(t.vertexHeight(4, 4)).toBe(5);
    // Neighbors must be within 1 of each other everywhere.
    for (let vy = 0; vy <= 8; vy++) {
      for (let vx = 0; vx < 8; vx++) {
        expect(Math.abs(t.vertexHeight(vx, vy) - t.vertexHeight(vx + 1, vy))).toBeLessThanOrEqual(1);
      }
    }
    for (let vx = 0; vx <= 8; vx++) {
      for (let vy = 0; vy < 8; vy++) {
        expect(Math.abs(t.vertexHeight(vx, vy) - t.vertexHeight(vx, vy + 1))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('undo restores exact prior heights', () => {
    const t = new Terrain(8, 8, 2);
    const before = Array.from(t.heights);
    const changes = t.setVertexConstrained(4, 4, 6);
    expect(changes.length).toBeGreaterThan(1);
    t.undo(changes);
    expect(Array.from(t.heights)).toEqual(before);
  });

  it('clamps heights to the legal range', () => {
    const t = new Terrain(4, 4, 0);
    t.setVertexConstrained(2, 2, -5);
    expect(t.vertexHeight(2, 2)).toBe(0);
    t.setVertexConstrained(2, 2, 99);
    expect(t.vertexHeight(2, 2)).toBeLessThanOrEqual(15);
  });

  it('computes gradients on slopes', () => {
    const t = new Terrain(4, 4, 2);
    // Tilt one tile: raise its two east corners.
    t.setVertexHeight(2, 1, 3);
    t.setVertexHeight(2, 2, 3);
    const g = t.gradient(1, 1);
    expect(g.dx).toBe(1);
    expect(g.dy).toBe(0);
  });

  it('water is not walkable', () => {
    const t = new Terrain(4, 4, 2);
    t.setSurface(1, 1, Surface.Water);
    expect(t.isWalkable(1, 1)).toBe(false);
    expect(t.isWalkable(0, 0)).toBe(true);
    expect(t.isWalkable(-1, 0)).toBe(false);
  });
});
