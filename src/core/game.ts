import { Surface, Terrain } from './terrain/terrain';
import { Hole, Pt, coursePar, validateCourse, HoleIssue } from './course/course';
import { Golfer } from './sim/golfer';
import { Groundskeeper, GROUNDSKEEPER_WAGE } from './sim/staff';
import { Rng } from './sim/rng';

export type AmenityKind = 'drinks' | 'snacks' | 'toilet';
export type ObjectKind = 'tree' | 'pine' | 'bush' | 'rock' | 'flowers' | 'clubhouse' | AmenityKind;

export type Weather = 'sun' | 'cloud' | 'rain';

export const WEATHER_LABELS: Record<Weather, string> = {
  sun: '☀️ Sunny',
  cloud: '⛅ Cloudy',
  rain: '🌧 Rain',
};

const WEATHER_DEMAND: Record<Weather, number> = { sun: 1, cloud: 0.85, rain: 0.35 };

export const AMENITY_PRICES: Record<AmenityKind, number> = {
  drinks: 5,
  snacks: 9,
  toilet: 2,
};

export interface WorldObject {
  id: number;
  kind: ObjectKind;
  x: number;
  y: number;
}

export const OBJECT_COSTS: Record<ObjectKind, number> = {
  tree: 40,
  pine: 45,
  bush: 15,
  rock: 10,
  flowers: 20,
  clubhouse: 4000,
  drinks: 600,
  snacks: 900,
  toilet: 500,
};

export const OBJECT_FOOTPRINT: Record<ObjectKind, number> = {
  tree: 1,
  pine: 1,
  bush: 1,
  rock: 1,
  flowers: 1,
  clubhouse: 3,
  drinks: 1,
  snacks: 1,
  toilet: 1,
};

/** Daily operating cost for amenities. */
const AMENITY_UPKEEP: Record<AmenityKind, number> = { drinks: 10, snacks: 18, toilet: 8 };

export function isAmenity(kind: ObjectKind): kind is AmenityKind {
  return kind === 'drinks' || kind === 'snacks' || kind === 'toilet';
}

export const SURFACE_COSTS: Record<Surface, number> = {
  [Surface.Rough]: 1,
  [Surface.Fairway]: 8,
  [Surface.Green]: 30,
  [Surface.Tee]: 20,
  [Surface.Sand]: 12,
  [Surface.Water]: 15,
  [Surface.Path]: 5,
};

/** Daily upkeep per tile of each surface. */
const SURFACE_UPKEEP: Record<Surface, number> = {
  [Surface.Rough]: 0,
  [Surface.Fairway]: 0.35,
  [Surface.Green]: 1.6,
  [Surface.Tee]: 0.8,
  [Surface.Sand]: 0.5,
  [Surface.Water]: 0.1,
  [Surface.Path]: 0.1,
};

export const TERRAFORM_COST_PER_VERTEX = 6;

export interface DayReport {
  day: number;
  income: number;
  expenses: number;
  visitors: number;
}

const OPEN_HOUR = 7;
const LAST_TEE_HOUR = 16;
const MINUTES_PER_DAY = 24 * 60;

export class Game {
  terrain: Terrain;
  holes: Hole[] = [];
  objects: WorldObject[] = [];
  golfers: Golfer[] = [];
  staff: Groundskeeper[] = [];

  cash = 50000;
  greenFee = 30;
  reputation = 50;
  courseOpen = false;
  weather: Weather = 'sun';
  forecast: Weather = 'sun';

  day = 1;
  /** Minute of day; the sim starts at 06:00 on day 1. */
  minute = 6 * 60;

  todayIncome = 0;
  todayExpenses = 0;
  todayVisitors = 0;
  history: DayReport[] = [];
  courseName = 'My Golf Course';

  rng: Rng;
  private nextObjectId = 1;
  private spawnAccumulator = 0;

  constructor(w = 96, hgt = 96, seed = 1234) {
    this.terrain = new Terrain(w, hgt);
    this.rng = new Rng(seed);
  }

  // ── Time ────────────────────────────────────────────────────────────────

  get clockText(): string {
    const hh = Math.floor(this.minute / 60);
    const mm = Math.floor(this.minute % 60);
    return `Day ${this.day}  ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** Advance the world by dt game minutes. */
  update(dt: number): void {
    this.minute += dt;
    if (this.minute >= MINUTES_PER_DAY) {
      this.minute -= MINUTES_PER_DAY;
      this.endOfDay();
    }
    this.maybeSpawn(dt);
    const exit = this.spawnPoint();
    const ctx = {
      terrain: this.terrain,
      holes: this.holes,
      exit: { x: Math.floor(exit.x), y: Math.floor(exit.y) },
      amenities: this.objects.filter((o) => isAmenity(o.kind)),
      purchase: (kind: AmenityKind) => {
        const price = AMENITY_PRICES[kind];
        this.cash += price;
        this.todayIncome += price;
      },
    };
    for (const g of this.golfers) {
      const done = g.update(dt, ctx);
      if (done) this.onGolferFinished(g);
    }
    this.golfers = this.golfers.filter((g) => g.state !== 'gone');
    for (const s of this.staff) s.update(dt, this.terrain);
  }

  private endOfDay(): void {
    const upkeep = this.dailyUpkeep();
    this.cash -= upkeep;
    this.todayExpenses += upkeep;
    // Turf recovers a little overnight.
    for (let i = 0; i < this.terrain.wear.length; i++) {
      if (this.terrain.wear[i] > 0) {
        this.terrain.wear[i] = Math.max(0, this.terrain.wear[i] - 8);
        this.terrain.wearDirty.add(i);
      }
    }
    // Tomorrow's weather arrives; roll a fresh forecast.
    this.weather = this.forecast;
    this.forecast = this.rollWeather();
    this.history.push({
      day: this.day,
      income: this.todayIncome,
      expenses: this.todayExpenses,
      visitors: this.todayVisitors,
    });
    if (this.history.length > 60) this.history.shift();
    this.day++;
    this.todayIncome = 0;
    this.todayExpenses = 0;
    this.todayVisitors = 0;
  }

  dailyUpkeep(): number {
    let total = 20; // fixed overhead
    const counts = new Map<Surface, number>();
    for (let i = 0; i < this.terrain.surfaces.length; i++) {
      const s = this.terrain.surfaces[i] as Surface;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const [s, n] of counts) total += SURFACE_UPKEEP[s] * n;
    total += this.objects.length * 0.2;
    for (const o of this.objects) {
      if (isAmenity(o.kind)) total += AMENITY_UPKEEP[o.kind];
    }
    total += this.staff.length * GROUNDSKEEPER_WAGE;
    return Math.round(total);
  }

  private rollWeather(): Weather {
    const r = this.rng.next();
    if (r < 0.55) return 'sun';
    if (r < 0.85) return 'cloud';
    return 'rain';
  }

  hireGroundskeeper(): Groundskeeper | null {
    if (this.staff.length >= 8) return null;
    const s = new Groundskeeper(this.rng, this.spawnPoint());
    this.staff.push(s);
    return s;
  }

  fireGroundskeeper(): boolean {
    return this.staff.pop() !== undefined;
  }

  // ── Golfer demand & spawning ────────────────────────────────────────────

  /** Fee golfers consider fair for the current course size. */
  fairFee(): number {
    return Math.max(5, this.holes.length * 5);
  }

  /** Expected visitors per day given reputation, fee and course size. */
  demandPerDay(): number {
    if (!this.courseOpen || this.holes.length === 0) return 0;
    const repFactor = Math.pow(this.reputation / 50, 1.4);
    const feeRatio = this.greenFee / this.fairFee();
    const feeFactor = Math.max(0.05, Math.min(1.5, 1.55 - feeRatio));
    const conditionFactor = 0.4 + 0.6 * this.terrain.turfCondition();
    return Math.round(this.holes.length * 7 * repFactor * feeFactor * WEATHER_DEMAND[this.weather] * conditionFactor);
  }

  private maybeSpawn(dt: number): void {
    const hour = this.minute / 60;
    if (!this.courseOpen || hour < OPEN_HOUR || hour >= LAST_TEE_HOUR) return;
    const perDay = this.demandPerDay();
    if (perDay <= 0) return;
    const spawnWindow = (LAST_TEE_HOUR - OPEN_HOUR) * 60;
    this.spawnAccumulator += (perDay / spawnWindow) * dt;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.spawnGolfer();
    }
  }

  spawnGolfer(): Golfer {
    const g = new Golfer(this.rng, this.spawnPoint());
    this.golfers.push(g);
    this.cash += this.greenFee;
    this.todayIncome += this.greenFee;
    this.todayVisitors++;
    return g;
  }

  spawnPoint(): Pt {
    const club = this.objects.find((o) => o.kind === 'clubhouse');
    if (club) {
      const fp = OBJECT_FOOTPRINT.clubhouse;
      return { x: club.x + fp / 2, y: club.y + fp + 0.5 };
    }
    return { x: 1.5, y: 1.5 };
  }

  private onGolferFinished(g: Golfer): void {
    if (g.scorecard.length === 0) return;
    const enjoy = g.enjoyment(this.holes, this.greenFee, this.fairFee(), this.terrain.turfCondition());
    this.reputation += (enjoy - this.reputation) * 0.06;
    this.reputation = Math.max(1, Math.min(100, this.reputation));
  }

  // ── Building ────────────────────────────────────────────────────────────

  canAfford(cost: number): boolean {
    return this.cash >= cost;
  }

  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.cash -= cost;
    this.todayExpenses += cost;
    return true;
  }

  occupied(x: number, y: number): WorldObject | undefined {
    return this.objects.find((o) => {
      const fp = OBJECT_FOOTPRINT[o.kind];
      return x >= o.x && x < o.x + fp && y >= o.y && y < o.y + fp;
    });
  }

  placeObject(kind: ObjectKind, x: number, y: number): WorldObject | null {
    const fp = OBJECT_FOOTPRINT[kind];
    for (let dy = 0; dy < fp; dy++) {
      for (let dx = 0; dx < fp; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.terrain.inBounds(tx, ty)) return null;
        if (this.terrain.surfaceAt(tx, ty) === Surface.Water) return null;
        if (this.occupied(tx, ty)) return null;
      }
    }
    if (kind === 'clubhouse' && this.objects.some((o) => o.kind === 'clubhouse')) return null;
    if (!this.spend(OBJECT_COSTS[kind])) return null;
    const obj: WorldObject = { id: this.nextObjectId++, kind, x, y };
    this.objects.push(obj);
    return obj;
  }

  removeObjectAt(x: number, y: number): boolean {
    const obj = this.occupied(x, y);
    if (!obj) return false;
    this.objects = this.objects.filter((o) => o.id !== obj.id);
    return true;
  }

  paintSurface(x: number, y: number, s: Surface): boolean {
    if (!this.terrain.inBounds(x, y)) return false;
    if (this.terrain.surfaceAt(x, y) === s) return false;
    if (s === Surface.Water && !this.terrain.isFlat(x, y)) return false;
    if (this.occupied(x, y)) return false;
    if (!this.spend(SURFACE_COSTS[s])) return false;
    this.terrain.setSurface(x, y, s);
    return true;
  }

  // ── Course management ───────────────────────────────────────────────────

  courseIssues(): HoleIssue[] {
    const issues = validateCourse(this.terrain, this.holes);
    if (!this.objects.some((o) => o.kind === 'clubhouse')) {
      issues.push({ hole: 0, message: 'The course needs a clubhouse before it can open.' });
    }
    return issues;
  }

  openCourse(): HoleIssue[] {
    const issues = this.courseIssues();
    if (issues.length === 0) this.courseOpen = true;
    return issues;
  }

  closeCourse(): void {
    this.courseOpen = false;
  }

  totalPar(): number {
    return coursePar(this.holes);
  }
}
