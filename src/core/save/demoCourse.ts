import { Game } from '../game';
import { Hole, Pt, holeLegs } from '../course/course';
import { Surface } from '../terrain/terrain';
import { Rng } from '../sim/rng';

/**
 * Builds the bundled 9-hole demo course, "Willow Creek Links", so new players
 * can experience the whole loop without building anything first.
 * Construction here writes terrain state directly (no cost) — it represents a
 * pre-existing course, not player construction.
 */

interface HoleSpec {
  tee: Pt;
  waypoints: Pt[];
  cup: Pt;
}

const HOLE_SPECS: HoleSpec[] = [
  { tee: { x: 20, y: 12 }, waypoints: [], cup: { x: 20, y: 50 } },
  { tee: { x: 14, y: 54 }, waypoints: [{ x: 20, y: 68 }], cup: { x: 34, y: 72 } },
  { tee: { x: 40, y: 72 }, waypoints: [], cup: { x: 60, y: 72 } },
  { tee: { x: 66, y: 72 }, waypoints: [{ x: 78, y: 68 }], cup: { x: 80, y: 54 } },
  { tee: { x: 80, y: 48 }, waypoints: [], cup: { x: 80, y: 14 } },
  { tee: { x: 74, y: 10 }, waypoints: [{ x: 62, y: 14 }], cup: { x: 50, y: 12 } },
  { tee: { x: 46, y: 16 }, waypoints: [{ x: 44, y: 30 }, { x: 48, y: 44 }], cup: { x: 44, y: 56 } },
  { tee: { x: 38, y: 54 }, waypoints: [], cup: { x: 34, y: 34 } },
  { tee: { x: 30, y: 28 }, waypoints: [{ x: 34, y: 14 }], cup: { x: 40, y: 8 } },
];

function paintDisc(game: Game, cx: number, cy: number, radius: number, s: Surface, onlyRough = false): void {
  const t = game.terrain;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (!t.inBounds(x, y)) continue;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      if (onlyRough && t.surfaceAt(x, y) !== Surface.Rough) continue;
      t.setSurface(x, y, s);
    }
  }
}

function flattenDisc(game: Game, cx: number, cy: number, radius: number, height?: number): void {
  const t = game.terrain;
  const targetH = height ?? Math.round(t.heightAt(cx, cy));
  for (let vy = Math.floor(cy - radius); vy <= Math.ceil(cy + radius) + 1; vy++) {
    for (let vx = Math.floor(cx - radius); vx <= Math.ceil(cx + radius) + 1; vx++) {
      if (!t.vertexInBounds(vx, vy)) continue;
      if (Math.hypot(vx - cx, vy - cy) > radius + 1) continue;
      t.setVertexHeight(vx, vy, targetH);
    }
  }
  // Re-run the slope constraint around the rim so no cliffs remain.
  for (let vy = Math.floor(cy - radius) - 1; vy <= Math.ceil(cy + radius) + 2; vy++) {
    for (let vx = Math.floor(cx - radius) - 1; vx <= Math.ceil(cx + radius) + 2; vx++) {
      if (!t.vertexInBounds(vx, vy)) continue;
      t.setVertexConstrained(vx, vy, t.vertexHeight(vx, vy));
    }
  }
}

function paintCorridor(game: Game, legs: Pt[], width: number): void {
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // Corridors start a little after the tee and stop just short of the green.
      const dist = t * len;
      if (dist < 3 && i === 1) continue;
      if (i === legs.length - 1 && len - dist < 3) continue;
      paintDisc(game, a.x + (b.x - a.x) * t, b.y === a.y ? a.y : a.y + (b.y - a.y) * t, width / 2, Surface.Fairway, true);
    }
  }
}

function scatterTrees(game: Game, rng: Rng, count: number): void {
  const kinds = ['tree', 'pine', 'bush', 'rock'] as const;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 30) {
    attempts++;
    const x = rng.int(2, game.terrain.w - 3);
    const y = rng.int(2, game.terrain.h - 3);
    if (game.terrain.surfaceAt(x, y) !== Surface.Rough) continue;
    if (game.occupied(x, y)) continue;
    // Keep landing zones playable: no trees hugging fairway edges too tightly.
    const kind = rng.next() < 0.75 ? (rng.next() < 0.5 ? 'tree' : 'pine') : rng.pick(kinds);
    const cashBefore = game.cash;
    game.placeObject(kind, x, y);
    game.cash = cashBefore; // demo construction is free
    placed++;
  }
}

export function buildDemoCourse(): Game {
  const game = new Game(96, 96, 20260723);
  game.courseName = 'Willow Creek Links';
  const t = game.terrain;
  const rng = new Rng(777);

  // Rolling hills: smooth low-frequency noise keeps slopes within the
  // 1-per-vertex constraint automatically.
  for (let vy = 0; vy <= t.h; vy++) {
    for (let vx = 0; vx <= t.w; vx++) {
      const n =
        1.6 * Math.sin(vx / 9 + 1.3) * Math.cos(vy / 11) +
        1.1 * Math.sin((vx + vy) / 13) +
        0.8 * Math.cos(vx / 5 - vy / 8);
      t.setVertexHeight(vx, vy, Math.round(3.2 + n));
    }
  }

  // Willow Creek: a pond feature mid-course and one guarding hole 5.
  flattenDisc(game, 58, 32, 5, 2);
  paintDisc(game, 58, 32, 4.2, Surface.Water);
  flattenDisc(game, 74, 30, 4, 2);
  paintDisc(game, 74, 30, 3.2, Surface.Water);
  flattenDisc(game, 24, 62, 3.5, 2);
  paintDisc(game, 24, 62, 2.6, Surface.Water);

  // Holes: flatten & paint tees, corridors, greens, bunkers.
  game.holes = HOLE_SPECS.map((spec, i) => {
    const hole: Hole = { number: i + 1, tee: { ...spec.tee }, waypoints: spec.waypoints.map((p) => ({ ...p })), cup: { ...spec.cup } };
    const legs = holeLegs(hole);
    paintCorridor(game, legs, 5);
    flattenDisc(game, hole.tee.x, hole.tee.y, 1.6);
    paintDisc(game, hole.tee.x, hole.tee.y, 1.4, Surface.Tee);
    flattenDisc(game, hole.cup.x, hole.cup.y, 3);
    paintDisc(game, hole.cup.x, hole.cup.y, 2.6, Surface.Green);
    // Greenside bunker, offset perpendicular to the approach.
    const approach = legs[legs.length - 2];
    const ax = hole.cup.x - approach.x;
    const ay = hole.cup.y - approach.y;
    const alen = Math.hypot(ax, ay) || 1;
    const bx = hole.cup.x + (-ay / alen) * 4;
    const by = hole.cup.y + (ax / alen) * 4;
    paintDisc(game, bx, by, 1.6, Surface.Sand, true);
    return hole;
  });

  // Clubhouse near hole 1's tee and hole 9's green.
  const clubX = 26;
  const clubY = 6;
  flattenDisc(game, clubX + 1.5, clubY + 1.5, 3);
  {
    const cashBefore = game.cash;
    game.placeObject('clubhouse', clubX, clubY);
    game.cash = cashBefore;
  }
  // A welcoming path from the clubhouse toward the first tee.
  for (let x = clubX - 4; x <= clubX + 8; x++) {
    if (t.inBounds(x, clubY + 4) && t.surfaceAt(x, clubY + 4) === Surface.Rough) t.setSurface(x, clubY + 4, Surface.Path);
  }

  scatterTrees(game, rng, 220);

  game.cash = 50000;
  game.greenFee = 35;
  game.reputation = 55;
  return game;
}
