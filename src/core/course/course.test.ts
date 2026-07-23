import { describe, expect, it } from 'vitest';
import { Surface, Terrain } from '../terrain/terrain';
import { Hole, holeLengthYards, holePar, parForLength, validateCourse } from './course';

function makePlayableHole(t: Terrain): Hole {
  const hole: Hole = { number: 1, tee: { x: 2, y: 2 }, waypoints: [], cup: { x: 2, y: 30 } };
  t.setSurface(2, 2, Surface.Tee);
  t.setSurface(2, 30, Surface.Green);
  return hole;
}

describe('course model', () => {
  it('computes hole length from legs', () => {
    const hole: Hole = { number: 1, tee: { x: 0, y: 0 }, waypoints: [{ x: 0, y: 10 }], cup: { x: 10, y: 10 } };
    expect(holeLengthYards(hole)).toBe(180); // 20 tiles * 9 yd
  });

  it('assigns par from length', () => {
    expect(parForLength(180)).toBe(3);
    expect(parForLength(246)).toBe(4);
    expect(parForLength(450)).toBe(4);
    expect(parForLength(500)).toBe(5);
  });

  it('par uses computed length', () => {
    const hole: Hole = { number: 1, tee: { x: 0, y: 0 }, waypoints: [], cup: { x: 0, y: 40 } };
    expect(holePar(hole)).toBe(4);
  });

  it('validates a playable hole', () => {
    const t = new Terrain(40, 40, 2);
    const hole = makePlayableHole(t);
    expect(validateCourse(t, [hole])).toEqual([]);
  });

  it('flags a tee that is not on a tee box', () => {
    const t = new Terrain(40, 40, 2);
    const hole = makePlayableHole(t);
    t.setSurface(2, 2, Surface.Rough);
    const issues = validateCourse(t, [hole]);
    expect(issues.some((i) => i.message.includes('tee'))).toBe(true);
  });

  it('flags an unwalkable hole (moat around the green)', () => {
    const t = new Terrain(40, 40, 2);
    const hole = makePlayableHole(t);
    for (let x = 0; x < 40; x++) t.setSurface(x, 20, Surface.Water);
    const issues = validateCourse(t, [hole]);
    expect(issues.some((i) => i.message.includes('cannot walk'))).toBe(true);
  });

  it('flags an empty course', () => {
    const t = new Terrain(10, 10, 2);
    expect(validateCourse(t, []).length).toBe(1);
  });
});
