import { Game, Weather, WorldObject } from '../game';
import { Hole } from '../course/course';
import { Terrain } from '../terrain/terrain';

export interface SaveData {
  version: 1 | 2;
  courseName: string;
  terrain: {
    w: number;
    h: number;
    heights: number[];
    surfaces: number[];
    /** v2+ */
    wear?: number[];
  };
  holes: Hole[];
  objects: WorldObject[];
  cash: number;
  greenFee: number;
  reputation: number;
  courseOpen: boolean;
  day: number;
  minute: number;
  /** v2+ */
  staffCount?: number;
  weather?: Weather;
  forecast?: Weather;
}

export function serialize(game: Game): SaveData {
  return {
    version: 2,
    courseName: game.courseName,
    terrain: {
      w: game.terrain.w,
      h: game.terrain.h,
      heights: Array.from(game.terrain.heights),
      surfaces: Array.from(game.terrain.surfaces),
      wear: Array.from(game.terrain.wear),
    },
    holes: game.holes.map((h) => ({
      number: h.number,
      tee: { ...h.tee },
      waypoints: h.waypoints.map((p) => ({ ...p })),
      cup: { ...h.cup },
    })),
    objects: game.objects.map((o) => ({ ...o })),
    cash: game.cash,
    greenFee: game.greenFee,
    reputation: game.reputation,
    courseOpen: game.courseOpen,
    day: game.day,
    minute: game.minute,
    staffCount: game.staff.length,
    weather: game.weather,
    forecast: game.forecast,
  };
}

export function deserialize(data: SaveData): Game {
  const game = new Game(data.terrain.w, data.terrain.h, Date.now() & 0xffff);
  game.terrain = new Terrain(data.terrain.w, data.terrain.h);
  game.terrain.heights.set(data.terrain.heights);
  game.terrain.surfaces.set(data.terrain.surfaces);
  if (data.terrain.wear) game.terrain.wear.set(data.terrain.wear);
  game.courseName = data.courseName;
  game.holes = data.holes.map((h) => ({
    number: h.number,
    tee: { ...h.tee },
    waypoints: h.waypoints.map((p) => ({ ...p })),
    cup: { ...h.cup },
  }));
  game.objects = data.objects.map((o) => ({ ...o }));
  let maxId = 0;
  for (const o of game.objects) maxId = Math.max(maxId, o.id);
  (game as unknown as { nextObjectId: number }).nextObjectId = maxId + 1;
  game.cash = data.cash;
  game.greenFee = data.greenFee;
  game.reputation = data.reputation;
  game.courseOpen = data.courseOpen;
  game.day = data.day;
  game.minute = data.minute;
  game.weather = data.weather ?? 'sun';
  game.forecast = data.forecast ?? 'sun';
  for (let i = 0; i < (data.staffCount ?? 0); i++) game.hireGroundskeeper();
  return game;
}

const SLOT_PREFIX = 'fairway-mogul-save-';

export function saveToLocalStorage(game: Game, slot: string): void {
  localStorage.setItem(SLOT_PREFIX + slot, JSON.stringify(serialize(game)));
}

export function loadFromLocalStorage(slot: string): Game | null {
  const raw = localStorage.getItem(SLOT_PREFIX + slot);
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw) as SaveData);
  } catch {
    return null;
  }
}

export function listSaveSlots(): string[] {
  const slots: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(SLOT_PREFIX)) slots.push(key.slice(SLOT_PREFIX.length));
  }
  return slots.sort();
}

export function exportToFile(game: Game): void {
  const blob = new Blob([JSON.stringify(serialize(game), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${game.courseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.golf.json`;
  a.click();
  URL.revokeObjectURL(url);
}
