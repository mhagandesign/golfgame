import { describe, expect, it } from 'vitest';
import { buildDemoCourse } from '../save/demoCourse';
import { deserialize, serialize, SaveData } from '../save/save';
import { Surface, Terrain } from '../terrain/terrain';
import { Groundskeeper } from './staff';
import { Rng } from './rng';

describe('turf wear', () => {
  it('only maintained turf wears', () => {
    const t = new Terrain(10, 10, 2);
    t.setSurface(2, 2, Surface.Fairway);
    t.addWear(2, 2, 0.5);
    t.addWear(3, 3, 0.5); // rough — ignored
    expect(t.wearAt(2, 2)).toBeCloseTo(0.5, 1);
    expect(t.wearAt(3, 3)).toBe(0);
    expect(t.turfCondition()).toBeLessThan(1);
  });

  it('groundskeepers repair worn turf', () => {
    const t = new Terrain(10, 10, 2);
    t.setSurface(5, 5, Surface.Green);
    t.addWear(5, 5, 0.8);
    const gk = new Groundskeeper(new Rng(1), { x: 5.5, y: 5.5 });
    for (let i = 0; i < 400 && t.wearAt(5, 5) > 0.02; i++) gk.update(0.5, t);
    expect(t.wearAt(5, 5)).toBeLessThanOrEqual(0.02);
  });

  it('golfers wear the course down as they play', () => {
    const game = buildDemoCourse();
    game.staff = []; // no repairs for this test
    game.openCourse();
    game.minute = 7 * 60;
    for (let i = 0; i < 5 * 60; i++) game.update(1);
    expect(game.terrain.turfCondition()).toBeLessThan(1);
  });
});

describe('amenities', () => {
  it('golfers buy from amenities during a busy day', () => {
    const game = buildDemoCourse();
    game.openCourse();
    game.minute = 7 * 60;
    for (let i = 0; i < 8 * 60; i++) game.update(1);
    const feeIncome = game.todayVisitors * game.greenFee;
    // Total income should exceed pure green fees — amenity sales happened.
    expect(game.todayIncome).toBeGreaterThan(feeIncome);
  });
});

describe('weather', () => {
  it('rain suppresses demand', () => {
    const game = buildDemoCourse();
    game.openCourse();
    game.weather = 'sun';
    const sunny = game.demandPerDay();
    game.weather = 'rain';
    expect(game.demandPerDay()).toBeLessThan(sunny * 0.5);
  });

  it('forecast becomes tomorrow’s weather', () => {
    const game = buildDemoCourse();
    game.forecast = 'rain';
    game.minute = 24 * 60 - 1;
    game.update(2);
    expect(game.weather).toBe('rain');
  });
});

describe('save v2', () => {
  it('round-trips wear, staff and weather', () => {
    const game = buildDemoCourse();
    game.terrain.setSurface(1, 1, Surface.Fairway);
    game.terrain.addWear(1, 1, 0.4);
    game.weather = 'cloud';
    const restored = deserialize(serialize(game));
    expect(restored.terrain.wearAt(1, 1)).toBeCloseTo(0.4, 1);
    expect(restored.staff.length).toBe(2);
    expect(restored.weather).toBe('cloud');
    expect(serialize(restored)).toEqual(serialize(game));
  });

  it('loads v1 saves without the new fields', () => {
    const game = buildDemoCourse();
    const data = serialize(game) as SaveData;
    delete data.terrain.wear;
    delete data.staffCount;
    delete data.weather;
    delete data.forecast;
    (data as { version: number }).version = 1;
    const restored = deserialize(data);
    expect(restored.staff.length).toBe(0);
    expect(restored.weather).toBe('sun');
    expect(restored.courseIssues()).toEqual([]);
  });
});
