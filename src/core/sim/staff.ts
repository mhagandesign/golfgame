import { Surface, Terrain } from '../terrain/terrain';
import { Pt } from '../course/course';
import { findPath, Node } from './path';
import { Rng } from './rng';

export const GROUNDSKEEPER_WAGE = 60;

export type StaffState = 'idle' | 'walking' | 'mowing';

const STAFF_NAMES = ['Pat', 'Marta', 'Ed', 'Silas', 'June', 'Otto', 'Faye', 'Gus', 'Ida', 'Ray'];

let nextStaffId = 1;

/**
 * Groundskeepers roam the course repairing turf wear. Each picks the worst
 * worn tile it can find (sampling, biased toward nearby), walks over and mows
 * until the patch is healthy again.
 */
export class Groundskeeper {
  readonly id = nextStaffId++;
  readonly name: string;
  state: StaffState = 'idle';
  pos: Pt;
  target: Node | null = null;

  private path: Node[] | null = null;
  private pathT = 0;
  private idleTime = 0;

  constructor(private rng: Rng, spawn: Pt) {
    this.name = rng.pick(STAFF_NAMES);
    this.pos = { ...spawn };
  }

  update(dt: number, terrain: Terrain): void {
    switch (this.state) {
      case 'idle': {
        this.idleTime -= dt;
        if (this.idleTime <= 0) {
          this.target = this.findWornTile(terrain);
          if (this.target) {
            this.state = 'walking';
            this.path = null;
          } else {
            this.idleTime = 2; // check again shortly
          }
        }
        break;
      }
      case 'walking': {
        if (!this.target) {
          this.state = 'idle';
          break;
        }
        if (this.walkAlong(dt, terrain, this.target)) {
          this.state = 'mowing';
        }
        break;
      }
      case 'mowing': {
        if (!this.target) {
          this.state = 'idle';
          break;
        }
        const { x, y } = this.target;
        // Mow the patch and its neighbours.
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            terrain.addWear(x + ox, y + oy, -0.08 * dt * (ox === 0 && oy === 0 ? 1 : 0.5));
          }
        }
        if (terrain.wearAt(x, y) <= 0.02) {
          this.state = 'idle';
          this.idleTime = 0.5;
          this.target = null;
        }
        break;
      }
    }
  }

  /** Sample maintained tiles and pick the worst wear, biased toward nearby tiles. */
  private findWornTile(terrain: Terrain): Node | null {
    let best: { score: number; x: number; y: number } | null = null;
    for (let i = 0; i < 160; i++) {
      const x = this.rng.int(0, terrain.w - 1);
      const y = this.rng.int(0, terrain.h - 1);
      const s = terrain.surfaceAt(x, y);
      if (s !== Surface.Fairway && s !== Surface.Green && s !== Surface.Tee) continue;
      const wear = terrain.wearAt(x, y);
      if (wear < 0.12) continue;
      const dist = Math.hypot(x - this.pos.x, y - this.pos.y);
      const score = wear - dist / 300;
      if (!best || score > best.score) best = { score, x, y };
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private walkAlong(dt: number, terrain: Terrain, target: Node): boolean {
    if (!this.path) {
      const from = {
        x: Math.max(0, Math.min(terrain.w - 1, Math.floor(this.pos.x))),
        y: Math.max(0, Math.min(terrain.h - 1, Math.floor(this.pos.y))),
      };
      this.path = findPath(terrain, from, target) ?? [from, target];
      this.pathT = 0;
    }
    this.pathT += dt * 1.0;
    const seg = Math.floor(this.pathT);
    if (seg >= this.path.length - 1) {
      const last = this.path[this.path.length - 1];
      this.pos = { x: last.x + 0.5, y: last.y + 0.5 };
      this.path = null;
      return true;
    }
    const a = this.path[seg];
    const b = this.path[seg + 1];
    const t = this.pathT - seg;
    this.pos = { x: a.x + (b.x - a.x) * t + 0.5, y: a.y + (b.y - a.y) * t + 0.5 };
    return false;
  }
}
