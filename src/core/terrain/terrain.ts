/**
 * Corner-heightmapped terrain grid (RollerCoaster Tycoon model).
 * Heights live on a (w+1) x (h+1) vertex lattice; each tile's shape is
 * defined by its 4 corner vertices. Surfaces are per-tile.
 * Pure simulation code — no rendering imports.
 */

export enum Surface {
  Rough = 0,
  Fairway = 1,
  Green = 2,
  Tee = 3,
  Sand = 4,
  Water = 5,
  Path = 6,
}

export const SURFACE_NAMES: Record<Surface, string> = {
  [Surface.Rough]: 'Rough',
  [Surface.Fairway]: 'Fairway',
  [Surface.Green]: 'Green',
  [Surface.Tee]: 'Tee box',
  [Surface.Sand]: 'Sand',
  [Surface.Water]: 'Water',
  [Surface.Path]: 'Path',
};

export const MAX_HEIGHT = 15;

export interface VertexChange {
  vx: number;
  vy: number;
  from: number;
  to: number;
}

export class Terrain {
  readonly w: number;
  readonly h: number;
  /** vertex heights, (w+1) * (h+1) */
  readonly heights: Uint8Array;
  /** tile surfaces, w * h */
  readonly surfaces: Uint8Array;

  constructor(w: number, h: number, baseHeight = 2) {
    this.w = w;
    this.h = h;
    this.heights = new Uint8Array((w + 1) * (h + 1)).fill(baseHeight);
    this.surfaces = new Uint8Array(w * h).fill(Surface.Rough);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  vertexInBounds(vx: number, vy: number): boolean {
    return vx >= 0 && vy >= 0 && vx <= this.w && vy <= this.h;
  }

  vertexHeight(vx: number, vy: number): number {
    return this.heights[vy * (this.w + 1) + vx];
  }

  setVertexHeight(vx: number, vy: number, hv: number): void {
    this.heights[vy * (this.w + 1) + vx] = Math.max(0, Math.min(MAX_HEIGHT, hv));
  }

  /** Corner heights of tile (x, y) in order [NW, NE, SE, SW]. */
  corners(x: number, y: number): [number, number, number, number] {
    return [
      this.vertexHeight(x, y),
      this.vertexHeight(x + 1, y),
      this.vertexHeight(x + 1, y + 1),
      this.vertexHeight(x, y + 1),
    ];
  }

  minCorner(x: number, y: number): number {
    const c = this.corners(x, y);
    return Math.min(c[0], c[1], c[2], c[3]);
  }

  maxCorner(x: number, y: number): number {
    const c = this.corners(x, y);
    return Math.max(c[0], c[1], c[2], c[3]);
  }

  isFlat(x: number, y: number): boolean {
    const c = this.corners(x, y);
    return c[0] === c[1] && c[1] === c[2] && c[2] === c[3];
  }

  /** Interpolated height at a fractional tile coordinate (bilinear over corners). */
  heightAt(fx: number, fy: number): number {
    const x = Math.max(0, Math.min(this.w - 1e-6, fx));
    const y = Math.max(0, Math.min(this.h - 1e-6, fy));
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const [nw, ne, se, sw] = this.corners(tx, ty);
    const u = x - tx;
    const v = y - ty;
    const top = nw + (ne - nw) * u;
    const bot = sw + (se - sw) * u;
    return top + (bot - top) * v;
  }

  /** Downhill gradient (dH/dx, dH/dy) of a tile — used for ball rolls. */
  gradient(x: number, y: number): { dx: number; dy: number } {
    const [nw, ne, se, sw] = this.corners(x, y);
    return {
      dx: (ne + se - nw - sw) / 2,
      dy: (sw + se - nw - ne) / 2,
    };
  }

  surfaceAt(x: number, y: number): Surface {
    return this.surfaces[y * this.w + x] as Surface;
  }

  setSurface(x: number, y: number, s: Surface): void {
    this.surfaces[y * this.w + x] = s;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.surfaceAt(x, y) !== Surface.Water;
  }

  /**
   * Move a single vertex to `target` height, then propagate outward so that
   * no two edge-adjacent vertices differ by more than 1 (the classic tycoon
   * slope constraint). Returns every vertex change made (for undo & costing).
   */
  setVertexConstrained(vx: number, vy: number, target: number): VertexChange[] {
    if (!this.vertexInBounds(vx, vy)) return [];
    target = Math.max(0, Math.min(MAX_HEIGHT, target));
    const changes: VertexChange[] = [];
    const from = this.vertexHeight(vx, vy);
    if (from === target) return changes;
    this.setVertexHeight(vx, vy, target);
    changes.push({ vx, vy, from, to: target });

    const queue: Array<[number, number]> = [[vx, vy]];
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const ch = this.vertexHeight(cx, cy);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.vertexInBounds(nx, ny)) continue;
        const nh = this.vertexHeight(nx, ny);
        let clamped = nh;
        if (nh > ch + 1) clamped = ch + 1;
        else if (nh < ch - 1) clamped = ch - 1;
        if (clamped !== nh) {
          this.setVertexHeight(nx, ny, clamped);
          changes.push({ vx: nx, vy: ny, from: nh, to: clamped });
          queue.push([nx, ny]);
        }
      }
    }
    return changes;
  }

  raiseVertex(vx: number, vy: number): VertexChange[] {
    return this.setVertexConstrained(vx, vy, this.vertexHeight(vx, vy) + 1);
  }

  lowerVertex(vx: number, vy: number): VertexChange[] {
    return this.setVertexConstrained(vx, vy, this.vertexHeight(vx, vy) - 1);
  }

  /** Smooth vertices in a radius toward their neighborhood average. */
  smooth(vx: number, vy: number, radius = 2): VertexChange[] {
    const all: VertexChange[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = vx + dx;
        const py = vy + dy;
        if (!this.vertexInBounds(px, py)) continue;
        let sum = 0;
        let n = 0;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (this.vertexInBounds(px + ox, py + oy)) {
            sum += this.vertexHeight(px + ox, py + oy);
            n++;
          }
        }
        const avg = Math.round(sum / n);
        if (avg !== this.vertexHeight(px, py)) {
          all.push(...this.setVertexConstrained(px, py, avg));
        }
      }
    }
    return all;
  }

  undo(changes: VertexChange[]): void {
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      this.setVertexHeight(c.vx, c.vy, c.from);
    }
  }
}
