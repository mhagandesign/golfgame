import { describe, expect, it } from 'vitest';
import { Surface, Terrain } from '../terrain/terrain';
import { findPath } from './path';
import { Rng } from './rng';
import { computePutt, computeSwing, maxCarryTiles } from './shots';

describe('pathfinding', () => {
  it('finds a straight path on open ground', () => {
    const t = new Terrain(20, 20, 2);
    const path = findPath(t, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 10, y: 10 });
    expect(path!.length).toBe(11); // pure diagonal
  });

  it('routes around water', () => {
    const t = new Terrain(20, 20, 2);
    for (let y = 0; y < 19; y++) t.setSurface(10, y, Surface.Water);
    const path = findPath(t, { x: 5, y: 5 }, { x: 15, y: 5 });
    expect(path).not.toBeNull();
    // Must pass through the gap at y = 19.
    expect(path!.some((n) => n.y >= 18)).toBe(true);
  });

  it('returns null when the goal is unreachable', () => {
    const t = new Terrain(20, 20, 2);
    for (let y = 0; y < 20; y++) t.setSurface(10, y, Surface.Water);
    expect(findPath(t, { x: 5, y: 5 }, { x: 15, y: 5 })).toBeNull();
  });
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('gaussian centres on the mean', () => {
    const rng = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += rng.gaussian(10, 2);
    expect(sum / 4000).toBeGreaterThan(9.7);
    expect(sum / 4000).toBeLessThan(10.3);
  });
});

describe('shot model', () => {
  it('better golfers hit farther', () => {
    expect(maxCarryTiles(0.9)).toBeGreaterThan(maxCarryTiles(0.2));
  });

  it('swings land near the target on average for skilled golfers', () => {
    const t = new Terrain(60, 60, 2);
    const rng = new Rng(1);
    const ball = { x: 5.5, y: 30.5 };
    const target = { x: 25.5, y: 30.5 };
    let ex = 0;
    let n = 200;
    for (let i = 0; i < n; i++) {
      const shot = computeSwing(t, rng, ball, target, { x: 50.5, y: 30.5 }, 0.9);
      ex += shot.to.x;
      expect(shot.strokes).toBeGreaterThanOrEqual(1);
    }
    expect(Math.abs(ex / n - target.x)).toBeLessThan(3);
  });

  it('water landings apply a penalty stroke and a dry drop', () => {
    const t = new Terrain(60, 60, 2);
    // Wall of water directly in front of the ball.
    for (let y = 0; y < 60; y++) for (let x = 12; x < 40; x++) t.setSurface(x, y, Surface.Water);
    const rng = new Rng(3);
    let sawWater = false;
    for (let i = 0; i < 60; i++) {
      const shot = computeSwing(t, rng, { x: 5.5, y: 30.5 }, { x: 20.5, y: 30.5 }, { x: 20.5, y: 30.5 }, 0.6);
      if (shot.water) {
        sawWater = true;
        expect(shot.strokes).toBe(2);
        expect(t.surfaceAt(Math.floor(shot.to.x), Math.floor(shot.to.y))).not.toBe(Surface.Water);
      }
    }
    expect(sawWater).toBe(true);
  });

  it('short putts almost always drop', () => {
    const rng = new Rng(9);
    let holed = 0;
    for (let i = 0; i < 100; i++) {
      const p = computePutt(rng, { x: 10.4, y: 10 }, { x: 10.5, y: 10 }, 0.5);
      if (p.holed) holed++;
    }
    expect(holed).toBeGreaterThan(90);
  });

  it('long putts usually miss but get closer', () => {
    const rng = new Rng(11);
    let closer = 0;
    const ball = { x: 4, y: 10 };
    const cup = { x: 10, y: 10 };
    for (let i = 0; i < 100; i++) {
      const p = computePutt(rng, ball, cup, 0.5);
      if (!p.holed) {
        const before = Math.hypot(cup.x - ball.x, cup.y - ball.y);
        const after = Math.hypot(cup.x - p.to.x, cup.y - p.to.y);
        if (after < before) closer++;
      }
    }
    expect(closer).toBeGreaterThan(60);
  });
});
