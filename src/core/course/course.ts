import { Surface, Terrain } from '../terrain/terrain';
import { findPath } from '../sim/path';

export interface Pt {
  x: number;
  y: number;
}

export interface Hole {
  number: number;
  tee: Pt;
  /** Optional dogleg targets between tee and green, in play order. */
  waypoints: Pt[];
  /** Cup position — must sit on a Green tile. */
  cup: Pt;
}

export const YARDS_PER_TILE = 9;

export function holeLegs(hole: Hole): Pt[] {
  return [hole.tee, ...hole.waypoints, hole.cup];
}

export function holeLengthYards(hole: Hole): number {
  const pts = holeLegs(hole);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.round(d * YARDS_PER_TILE);
}

export function parForLength(yards: number): number {
  if (yards <= 245) return 3;
  if (yards <= 450) return 4;
  return 5;
}

export function holePar(hole: Hole): number {
  return parForLength(holeLengthYards(hole));
}

export function coursePar(holes: Hole[]): number {
  return holes.reduce((sum, hl) => sum + holePar(hl), 0);
}

export interface HoleIssue {
  hole: number;
  message: string;
}

/**
 * Validate that every hole is playable: tee on a tee box, cup on a green,
 * a minimum length, and a walkable route from tee to green.
 */
export function validateCourse(terrain: Terrain, holes: Hole[]): HoleIssue[] {
  const issues: HoleIssue[] = [];
  if (holes.length === 0) {
    issues.push({ hole: 0, message: 'The course has no holes yet.' });
    return issues;
  }
  for (const hole of holes) {
    const n = hole.number;
    if (!terrain.inBounds(hole.tee.x, hole.tee.y) || terrain.surfaceAt(hole.tee.x, hole.tee.y) !== Surface.Tee) {
      issues.push({ hole: n, message: `Hole ${n}: the tee marker is not on a tee box.` });
    }
    if (!terrain.inBounds(hole.cup.x, hole.cup.y) || terrain.surfaceAt(hole.cup.x, hole.cup.y) !== Surface.Green) {
      issues.push({ hole: n, message: `Hole ${n}: the cup is not on a green.` });
    }
    if (holeLengthYards(hole) < 60) {
      issues.push({ hole: n, message: `Hole ${n}: too short (under 60 yards).` });
    }
    const path = findPath(terrain, hole.tee, hole.cup);
    if (!path) {
      issues.push({ hole: n, message: `Hole ${n}: golfers cannot walk from tee to green.` });
    }
  }
  return issues;
}
