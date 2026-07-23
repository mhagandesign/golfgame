import { Terrain, Surface } from '../terrain/terrain';
import { Hole, Pt, holeLegs, holePar } from '../course/course';
import { findPath, Node } from './path';
import { Rng } from './rng';
import { ShotResult, computePutt, computeSwing, pickTarget } from './shots';

export type GolferState =
  | 'walking-to-tee'
  | 'preparing'
  | 'ball-in-flight'
  | 'walking-to-ball'
  | 'hole-done'
  | 'leaving'
  | 'gone';

export interface ActiveShot extends ShotResult {
  progress: number; // 0..1
  duration: number; // game minutes
}

const FIRST_NAMES = ['Alex', 'Sam', 'Jo', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie', 'Quinn', 'Avery', 'Lee', 'Robin', 'Drew', 'Blair', 'Frankie', 'Marion'];
const LAST_NAMES = ['Palmer', 'Hogan', 'Snead', 'Vardon', 'Wright', 'Lopez', 'Kim', 'Sato', 'Nilsson', 'Okafor', 'Reyes', 'Novak', 'Bauer', 'Fontaine', 'Whit', 'Sorens'];

let nextGolferId = 1;

/** Reset the id counter (used by tests and when loading saves). */
export function resetGolferIds(): void {
  nextGolferId = 1;
}

export class Golfer {
  readonly id = nextGolferId++;
  readonly name: string;
  readonly skill: number; // 0..1
  readonly shirt: number; // color index for the renderer

  state: GolferState = 'walking-to-tee';
  pos: Pt;
  ball: Pt;
  holeIndex = 0;
  strokesThisHole = 0;
  scorecard: number[] = [];
  waterBalls = 0;
  shot: ActiveShot | null = null;
  legIndex = 0;

  private path: Node[] | null = null;
  private pathT = 0;
  private prepTime = 0;
  /** tiles per game minute */
  private walkSpeed: number;

  constructor(private rng: Rng, spawn: Pt) {
    this.name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    this.skill = Math.min(0.98, Math.max(0.05, rng.gaussian(0.5, 0.2)));
    this.shirt = rng.int(0, 5);
    this.walkSpeed = rng.range(1.1, 1.5);
    this.pos = { ...spawn };
    this.ball = { ...spawn };
  }

  totalStrokes(): number {
    return this.scorecard.reduce((a, b) => a + b, 0) + this.strokesThisHole;
  }

  /** Advance the golfer by dt game minutes. Returns true when finished & gone. */
  update(dt: number, terrain: Terrain, holes: Hole[], exit: Pt): boolean {
    switch (this.state) {
      case 'walking-to-tee': {
        const hole = holes[this.holeIndex];
        if (!hole) {
          this.state = 'leaving';
          break;
        }
        if (this.walkAlong(dt, terrain, hole.tee)) {
          this.ball = { x: hole.tee.x + 0.5, y: hole.tee.y + 0.5 };
          this.pos = { ...this.ball };
          this.legIndex = 1;
          this.strokesThisHole = 0;
          this.startPreparing();
        }
        break;
      }
      case 'preparing': {
        this.prepTime -= dt;
        if (this.prepTime <= 0) this.takeShot(terrain, holes[this.holeIndex]);
        break;
      }
      case 'ball-in-flight': {
        const shot = this.shot!;
        shot.progress = Math.min(1, shot.progress + dt / shot.duration);
        if (shot.progress >= 1) {
          this.ball = { ...shot.to };
          this.strokesThisHole += shot.strokes;
          if (shot.water) this.waterBalls++;
          const holed = shot.holed;
          this.shot = null;
          if (holed || this.strokesThisHole >= 10) {
            if (!holed) this.strokesThisHole += 1; // pick-up penalty
            this.state = 'hole-done';
          } else {
            this.state = 'walking-to-ball';
            this.path = null;
          }
        }
        break;
      }
      case 'walking-to-ball': {
        const target = { x: Math.floor(this.ball.x), y: Math.floor(this.ball.y) };
        if (this.walkAlong(dt, terrain, target)) {
          this.pos = { ...this.ball };
          this.startPreparing();
        }
        break;
      }
      case 'hole-done': {
        this.scorecard.push(this.strokesThisHole);
        this.strokesThisHole = 0;
        this.holeIndex++;
        if (this.holeIndex >= holes.length) {
          this.state = 'leaving';
        } else {
          this.state = 'walking-to-tee';
        }
        this.path = null;
        break;
      }
      case 'leaving': {
        if (this.walkAlong(dt, terrain, exit)) {
          this.state = 'gone';
          return true;
        }
        break;
      }
      case 'gone':
        return true;
    }
    return false;
  }

  private startPreparing(): void {
    this.state = 'preparing';
    this.prepTime = this.rng.range(0.2, 0.6);
  }

  private takeShot(terrain: Terrain, hole: Hole | undefined): void {
    if (!hole) {
      this.state = 'leaving';
      return;
    }
    const legs = holeLegs(hole).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    const cup = legs[legs.length - 1];
    const onGreen =
      terrain.inBounds(Math.floor(this.ball.x), Math.floor(this.ball.y)) &&
      terrain.surfaceAt(Math.floor(this.ball.x), Math.floor(this.ball.y)) === Surface.Green;

    let result: ShotResult;
    if (onGreen && Math.hypot(cup.x - this.ball.x, cup.y - this.ball.y) < 8) {
      result = computePutt(this.rng, this.ball, cup, this.skill);
    } else {
      const picked = pickTarget(this.ball, legs, this.legIndex, this.skill);
      this.legIndex = picked.legIndex;
      result = computeSwing(terrain, this.rng, this.ball, picked.target, cup, this.skill);
    }
    const dist = Math.hypot(result.to.x - result.from.x, result.to.y - result.from.y);
    this.shot = { ...result, progress: 0, duration: Math.max(0.15, Math.min(1.2, dist * 0.035)) };
    this.state = 'ball-in-flight';
  }

  /** Walk toward a tile target along an A* path. Returns true on arrival. */
  private walkAlong(dt: number, terrain: Terrain, target: Node): boolean {
    const myTile = { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y) };
    if (!this.path) {
      const from = {
        x: Math.max(0, Math.min(terrain.w - 1, myTile.x)),
        y: Math.max(0, Math.min(terrain.h - 1, myTile.y)),
      };
      const tgt = {
        x: Math.max(0, Math.min(terrain.w - 1, target.x)),
        y: Math.max(0, Math.min(terrain.h - 1, target.y)),
      };
      this.path = findPath(terrain, from, tgt) ?? [from, tgt];
      this.pathT = 0;
    }
    this.pathT += dt * this.walkSpeed;
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

  /** Post-round satisfaction, 0..100. */
  enjoyment(holes: Hole[], fee: number, fairFee: number): number {
    const totalPar = holes.reduce((s, hl) => s + holePar(hl), 0);
    const diff = totalPar - this.scorecard.reduce((a, b) => a + b, 0);
    let e = 58 + diff * 2.5 - this.waterBalls * 3;
    if (fee > fairFee * 1.5) e -= 12;
    else if (fee < fairFee * 0.6) e += 5;
    return Math.max(0, Math.min(100, e));
  }
}
