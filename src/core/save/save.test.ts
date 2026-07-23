import { describe, expect, it } from 'vitest';
import { buildDemoCourse } from './demoCourse';
import { deserialize, serialize } from './save';

describe('demo course', () => {
  it('is valid and ready to open', () => {
    const game = buildDemoCourse();
    expect(game.holes.length).toBe(9);
    const issues = game.courseIssues();
    expect(issues).toEqual([]);
  });

  it('has a sensible total par', () => {
    const game = buildDemoCourse();
    const par = game.totalPar();
    expect(par).toBeGreaterThanOrEqual(27);
    expect(par).toBeLessThanOrEqual(40);
  });

  it('simulates rounds: golfers finish holes and pay fees', () => {
    const game = buildDemoCourse();
    const issues = game.openCourse();
    expect(issues).toEqual([]);
    const startCash = game.cash;
    // Fast-forward from 06:00 well into the golfing day.
    game.minute = 7 * 60;
    for (let i = 0; i < 6 * 60; i++) game.update(1);
    expect(game.todayVisitors).toBeGreaterThan(0);
    expect(game.cash).toBeGreaterThan(startCash);
    // Someone should have completed at least one hole by early afternoon.
    const scored = game.golfers.some((g) => g.scorecard.length > 0);
    expect(scored).toBe(true);
  });
});

describe('save round-trip', () => {
  it('serialize → deserialize → serialize is stable', () => {
    const game = buildDemoCourse();
    const a = serialize(game);
    const restored = deserialize(a);
    const b = serialize(restored);
    expect(b).toEqual(a);
  });

  it('restores playable state', () => {
    const game = buildDemoCourse();
    const restored = deserialize(serialize(game));
    expect(restored.courseIssues()).toEqual([]);
    expect(restored.totalPar()).toBe(game.totalPar());
  });
});
