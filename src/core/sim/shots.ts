import { Surface, Terrain } from '../terrain/terrain';
import { Pt, YARDS_PER_TILE } from '../course/course';
import { Rng } from './rng';

/**
 * Hybrid shot model: outcomes are computed statistically from golfer skill,
 * lie, distance and hazards; the renderer animates the resulting flight.
 * Distances here are in tiles (1 tile = YARDS_PER_TILE yards).
 */

export interface ShotResult {
  from: Pt;
  to: Pt;
  /** Peak height of the animated arc, in height units. */
  arc: number;
  /** True when the ball found water and a penalty drop was applied. */
  water: boolean;
  /** Strokes consumed by this action (1, or 2 with a water penalty). */
  strokes: number;
  /** True when the ball is in the cup. */
  holed: boolean;
}

export function maxCarryTiles(skill: number): number {
  return (170 + skill * 110) / YARDS_PER_TILE;
}

function liePenalty(surface: Surface): { spread: number; power: number } {
  switch (surface) {
    case Surface.Sand:
      return { spread: 2.2, power: 0.65 };
    case Surface.Rough:
      return { spread: 1.5, power: 0.85 };
    default:
      return { spread: 1, power: 1 };
  }
}

function clampToBounds(terrain: Terrain, p: Pt): Pt {
  return {
    x: Math.max(0.5, Math.min(terrain.w - 0.5, p.x)),
    y: Math.max(0.5, Math.min(terrain.h - 0.5, p.y)),
  };
}

function surfaceAtPoint(terrain: Terrain, p: Pt): Surface {
  const tx = Math.max(0, Math.min(terrain.w - 1, Math.floor(p.x)));
  const ty = Math.max(0, Math.min(terrain.h - 1, Math.floor(p.y)));
  return terrain.surfaceAt(tx, ty);
}

/** Walk back along the flight line to the last dry point (water penalty drop). */
function dropPoint(terrain: Terrain, from: Pt, to: Pt): Pt {
  const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 2));
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (surfaceAtPoint(terrain, p) !== Surface.Water) return p;
  }
  return from;
}

/** A full swing toward `target` (which may be a layup point, not the cup). */
export function computeSwing(terrain: Terrain, rng: Rng, ball: Pt, target: Pt, cup: Pt, skill: number): ShotResult {
  const lie = liePenalty(surfaceAtPoint(terrain, ball));
  const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
  const carry = Math.min(dist, maxCarryTiles(skill) * lie.power);

  const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
  const spreadDeg = (2 + (1 - skill) * 7) * lie.spread;
  const actualAngle = angle + rng.gaussian(0, (spreadDeg * Math.PI) / 180);
  const distFrac = 1 + rng.gaussian(0, (0.04 + (1 - skill) * 0.07) * lie.spread);
  const actualCarry = Math.max(1, carry * distFrac);

  let land: Pt = clampToBounds(terrain, {
    x: ball.x + Math.cos(actualAngle) * actualCarry,
    y: ball.y + Math.sin(actualAngle) * actualCarry,
  });

  // Bounce & roll: shorter shots roll more; slope pushes the ball downhill.
  const landSurface = surfaceAtPoint(terrain, land);
  if (landSurface !== Surface.Water && landSurface !== Surface.Sand) {
    const tx = Math.floor(land.x);
    const ty = Math.floor(land.y);
    const grad = terrain.gradient(tx, ty);
    const rollDist = actualCarry * 0.06 + rng.range(0, 0.8);
    const rolled = clampToBounds(terrain, {
      x: land.x + Math.cos(actualAngle) * rollDist - grad.dx * 0.7,
      y: land.y + Math.sin(actualAngle) * rollDist - grad.dy * 0.7,
    });
    if (surfaceAtPoint(terrain, rolled) !== Surface.Water) land = rolled;
  }

  let water = false;
  let strokes = 1;
  if (surfaceAtPoint(terrain, land) === Surface.Water) {
    water = true;
    strokes = 2;
    land = dropPoint(terrain, ball, land);
  }

  // A pitched ball may drop straight in from close range.
  const toCup = Math.hypot(cup.x - land.x, cup.y - land.y);
  const holed = !water && toCup < 0.35 && rng.next() < 0.35;
  const finalTo = holed ? { ...cup } : land;

  return { from: { ...ball }, to: finalTo, arc: Math.min(6, 1.5 + actualCarry * 0.18), water, strokes, holed };
}

/** A putt on the green. Returns holed or a new lie closer to the cup. */
export function computePutt(rng: Rng, ball: Pt, cup: Pt, skill: number): ShotResult {
  const dist = Math.hypot(cup.x - ball.x, cup.y - ball.y);
  // Make probability: tap-ins are near-certain, long putts rare.
  const distYd = dist * YARDS_PER_TILE;
  const makeP = distYd < 1.5 ? 0.99 : Math.min(0.95, Math.max(0.03, 1.05 - distYd * (0.16 - skill * 0.06)));
  if (rng.next() < makeP) {
    return { from: { ...ball }, to: { ...cup }, arc: 0, water: false, strokes: 1, holed: true };
  }
  // Missed: ball ends up much closer, past or short of the cup.
  const angle = Math.atan2(cup.y - ball.y, cup.x - ball.x) + rng.gaussian(0, 0.12);
  const remainder = Math.max(0.08, dist * rng.range(0.05, 0.22));
  const overshoot = rng.next() < 0.5 ? dist + remainder : dist - remainder;
  return {
    from: { ...ball },
    to: { x: ball.x + Math.cos(angle) * overshoot, y: ball.y + Math.sin(angle) * overshoot },
    arc: 0,
    water: false,
    strokes: 1,
    holed: false,
  };
}

/**
 * Pick the target for the next full swing: the next dogleg waypoint the
 * golfer hasn't passed, or the cup once within range; lay up when needed.
 */
export function pickTarget(ball: Pt, legs: Pt[], legIndex: number, skill: number): { target: Pt; legIndex: number } {
  const cup = legs[legs.length - 1];
  let li = legIndex;
  // Advance past waypoints we're already close to.
  while (li < legs.length - 1 && Math.hypot(legs[li].x - ball.x, legs[li].y - ball.y) < 3) li++;
  const target = legs[li];
  const dist = Math.hypot(target.x - ball.x, target.y - ball.y);
  const reach = maxCarryTiles(skill);
  if (li < legs.length - 1 && dist < reach * 0.95) {
    // Can comfortably reach this waypoint — aim at it and advance.
    return { target, legIndex: li + 1 };
  }
  if (li === legs.length - 1) return { target: cup, legIndex: li };
  return { target, legIndex: li };
}
