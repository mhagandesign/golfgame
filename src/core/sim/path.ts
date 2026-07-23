import { Surface, Terrain } from '../terrain/terrain';

export interface Node {
  x: number;
  y: number;
}

/** Movement cost multiplier for a surface (walking golfers avoid sand & steep rough). */
function tileCost(terrain: Terrain, x: number, y: number): number {
  switch (terrain.surfaceAt(x, y)) {
    case Surface.Path:
      return 0.6;
    case Surface.Fairway:
    case Surface.Green:
    case Surface.Tee:
      return 1;
    case Surface.Sand:
      return 2.5;
    case Surface.Rough:
      return 1.4;
    default:
      return Infinity;
  }
}

/**
 * A* over the tile grid, 8-directional. Water is impassable. Returns the tile
 * path including start and goal, or null when unreachable.
 */
export function findPath(terrain: Terrain, start: Node, goal: Node, maxExpansions = 60000): Node[] | null {
  if (!terrain.isWalkable(start.x, start.y) || !terrain.isWalkable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [{ ...start }];

  const w = terrain.w;
  const idx = (x: number, y: number) => y * w + x;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();

  // Binary heap keyed by f-score.
  const heap: Array<{ f: number; g: number; x: number; y: number }> = [];
  const push = (item: { f: number; g: number; x: number; y: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const hFn = (x: number, y: number) => Math.hypot(goal.x - x, goal.y - y);
  gScore.set(idx(start.x, start.y), 0);
  push({ f: hFn(start.x, start.y), g: 0, x: start.x, y: start.y });

  let expansions = 0;
  while (heap.length > 0 && expansions < maxExpansions) {
    const cur = pop();
    const ci = idx(cur.x, cur.y);
    if (closed.has(ci)) continue;
    closed.add(ci);
    expansions++;

    if (cur.x === goal.x && cur.y === goal.y) {
      const path: Node[] = [];
      let node = ci;
      for (;;) {
        path.push({ x: node % w, y: Math.floor(node / w) });
        const prev = cameFrom.get(node);
        if (prev === undefined) break;
        node = prev;
      }
      path.reverse();
      return path;
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!terrain.inBounds(nx, ny)) continue;
        const cost = tileCost(terrain, nx, ny);
        if (!isFinite(cost)) continue;
        // No cutting corners diagonally past water.
        if (dx !== 0 && dy !== 0) {
          if (!isFinite(tileCost(terrain, cur.x + dx, cur.y)) || !isFinite(tileCost(terrain, cur.x, cur.y + dy))) {
            continue;
          }
        }
        const step = (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * cost;
        // Climbing is slower.
        const climb = Math.abs(terrain.heightAt(nx + 0.5, ny + 0.5) - terrain.heightAt(cur.x + 0.5, cur.y + 0.5));
        const g = cur.g + step + climb * 0.5;
        const ni = idx(nx, ny);
        if (closed.has(ni)) continue;
        const known = gScore.get(ni);
        if (known === undefined || g < known) {
          gScore.set(ni, g);
          cameFrom.set(ni, ci);
          push({ f: g + hFn(nx, ny), g, x: nx, y: ny });
        }
      }
    }
  }
  return null;
}
