import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Game, WorldObject, OBJECT_FOOTPRINT } from '../core/game';
import { Golfer } from '../core/sim/golfer';
import { SHIRT_COLORS, shade } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';

function depth(fx: number, fy: number): number {
  return (fx + fy) * 100;
}

function drawObject(g: Graphics, obj: WorldObject): void {
  switch (obj.kind) {
    case 'tree': {
      g.roundRect(-3, -14, 6, 14, 2).fill(0x7a5a3a);
      g.circle(0, -26, 15).fill(0x4e8a3c);
      g.circle(-9, -19, 10).fill(0x5c9c46);
      g.circle(9, -19, 10).fill(0x467f36);
      g.circle(0, -30, 9).fill(0x63a84e);
      break;
    }
    case 'pine': {
      g.rect(-2.5, -10, 5, 10).fill(0x6e4f33);
      g.poly([-14, -8, 14, -8, 0, -30]).fill(0x3d6e3a);
      g.poly([-11, -18, 11, -18, 0, -38]).fill(0x477d43);
      g.poly([-8, -28, 8, -28, 0, -46]).fill(0x528c4d);
      break;
    }
    case 'bush': {
      g.ellipse(0, -6, 11, 8).fill(0x55924a);
      g.ellipse(-5, -9, 7, 5).fill(0x62a355);
      break;
    }
    case 'rock': {
      g.ellipse(0, -4, 10, 7).fill(0x9a9a92);
      g.ellipse(-3, -7, 5, 4).fill(0xb0b0a8);
      break;
    }
    case 'flowers': {
      g.ellipse(0, -3, 12, 7).fill(0x5f9a4d);
      for (const [fx, fy, c] of [
        [-6, -5, 0xe86fa8],
        [0, -7, 0xf0e04e],
        [6, -4, 0xe8654f],
        [2, -2, 0xffffff],
      ] as const) {
        g.circle(fx, fy, 2).fill(c);
      }
      break;
    }
    case 'clubhouse': {
      // A 3x3-footprint isometric building with a gabled roof.
      const w = 88;
      const hw = w / 2;
      const wallH = 34;
      // Walls (front-left and front-right faces).
      g.poly([-hw, -wallH, 0, -wallH + hw / 2, 0, hw / 2, -hw, 0]).fill(0xb08d62);
      g.poly([hw, -wallH, 0, -wallH + hw / 2, 0, hw / 2, hw, 0]).fill(0x94734e);
      // Roof.
      g.poly([-hw - 4, -wallH, 0, -wallH + hw / 2 - 2, 0, -wallH - 22, -hw - 4, -wallH - 10]).fill(0x7c4a35);
      g.poly([hw + 4, -wallH, 0, -wallH + hw / 2 - 2, 0, -wallH - 22, hw + 4, -wallH - 10]).fill(0x5f382a);
      // Door & windows.
      g.roundRect(-hw / 2 - 8, -20, 12, 18, 2).fill(0x4a3320);
      g.rect(hw / 2 - 6, -24, 10, 8).fill(0xd8e8f0);
      g.rect(hw / 2 + 8, -19, 10, 8).fill(0xc8dce8);
      break;
    }
  }
}

function drawGolfer(g: Graphics, golfer: Golfer): void {
  const shirt = SHIRT_COLORS[golfer.shirt % SHIRT_COLORS.length];
  g.ellipse(0, 0, 6, 3).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(-2.5, -8, 5, 7, 2).fill(0x3a4450); // trousers
  g.roundRect(-3.5, -15, 7, 8, 2).fill(shirt);
  g.circle(0, -18, 3.5).fill(0xe8c39a);
  g.rect(-3.5, -21.5, 7, 2).fill(shade(shirt, 0.7)); // cap
  if (golfer.state === 'preparing') {
    g.rect(3, -14, 1.5, 12).fill(0x888888); // club
  }
}

const labelStyle = new TextStyle({ fontFamily: 'sans-serif', fontSize: 11, fill: 0xffffff });

/**
 * Everything that sits on the terrain: props, buildings, hole furniture,
 * golfers and balls. Depth-sorted every frame (agents move).
 */
export class SceneLayer {
  readonly container = new Container();
  private objectSprites = new Map<number, Graphics>();
  private golferSprites = new Map<number, Graphics>();
  private ballSprites = new Map<number, Graphics>();
  private courseFurniture: Graphics[] = [];
  private courseDirty = true;

  constructor(private game: Game) {
    this.container.sortableChildren = true;
  }

  setGame(game: Game): void {
    this.game = game;
    this.courseDirty = true;
    for (const s of this.objectSprites.values()) s.destroy();
    for (const s of this.golferSprites.values()) s.destroy();
    for (const s of this.ballSprites.values()) s.destroy();
    for (const f of this.courseFurniture) f.destroy();
    this.courseFurniture = [];
    this.objectSprites.clear();
    this.golferSprites.clear();
    this.ballSprites.clear();
  }

  markCourseDirty(): void {
    this.courseDirty = true;
  }

  update(): void {
    const game = this.game;
    const t = game.terrain;

    // ── Objects (static; add/remove diffs) ──
    const liveIds = new Set<number>();
    for (const obj of game.objects) {
      liveIds.add(obj.id);
      let sprite = this.objectSprites.get(obj.id);
      if (!sprite) {
        sprite = new Graphics();
        drawObject(sprite, obj);
        this.objectSprites.set(obj.id, sprite);
        this.container.addChild(sprite);
      }
      const fp = OBJECT_FOOTPRINT[obj.kind];
      const cx = obj.x + fp / 2;
      const cy = obj.y + fp / 2;
      const p = worldToScreen(cx, cy, t.heightAt(cx, cy));
      sprite.position.set(p.x, p.y);
      sprite.zIndex = depth(cx, cy);
    }
    for (const [id, sprite] of this.objectSprites) {
      if (!liveIds.has(id)) {
        sprite.destroy();
        this.objectSprites.delete(id);
      }
    }

    // ── Hole furniture: flags & tee markers ──
    if (this.courseDirty) {
      this.courseDirty = false;
      for (const f of this.courseFurniture) f.destroy();
      this.courseFurniture = [];
      for (const hole of game.holes) {
        const flag = new Graphics();
        flag.rect(-1, -34, 2, 34).fill(0xeeeeee);
        flag.poly([1, -34, 15, -29, 1, -24]).fill(0xd9534f);
        flag.circle(0, 0, 2.2).fill(0x222222);
        const cupC = { x: hole.cup.x + 0.5, y: hole.cup.y + 0.5 };
        const fp = worldToScreen(cupC.x, cupC.y, t.heightAt(cupC.x, cupC.y));
        flag.position.set(fp.x, fp.y);
        flag.zIndex = depth(cupC.x, cupC.y);
        this.courseFurniture.push(flag);
        this.container.addChild(flag);

        const marker = new Graphics();
        marker.roundRect(-9, -14, 18, 14, 3).fill(0x2f4632).stroke({ color: 0xffffff, width: 1 });
        const teeC = { x: hole.tee.x + 0.5, y: hole.tee.y + 0.5 };
        const tp = worldToScreen(teeC.x, teeC.y, t.heightAt(teeC.x, teeC.y));
        marker.position.set(tp.x, tp.y - 6);
        marker.zIndex = depth(teeC.x, teeC.y);
        const label = new Text({ text: String(hole.number), style: labelStyle });
        label.anchor.set(0.5);
        label.position.set(0, -7);
        marker.addChild(label);
        this.courseFurniture.push(marker);
        this.container.addChild(marker);
      }
    }

    // ── Golfers & balls ──
    const liveGolfers = new Set<number>();
    for (const golfer of game.golfers) {
      liveGolfers.add(golfer.id);
      let sprite = this.golferSprites.get(golfer.id);
      if (!sprite) {
        sprite = new Graphics();
        this.golferSprites.set(golfer.id, sprite);
        this.container.addChild(sprite);
      }
      sprite.clear();
      drawGolfer(sprite, golfer);
      const gp = worldToScreen(golfer.pos.x, golfer.pos.y, t.heightAt(golfer.pos.x, golfer.pos.y));
      sprite.position.set(gp.x, gp.y);
      sprite.zIndex = depth(golfer.pos.x, golfer.pos.y);

      // Ball: animated along the arc during flight; resting otherwise.
      let ball = this.ballSprites.get(golfer.id);
      if (!ball) {
        ball = new Graphics();
        ball.circle(0, -2, 2).fill(0xffffff).stroke({ color: 0x999999, width: 0.5 });
        this.ballSprites.set(golfer.id, ball);
        this.container.addChild(ball);
      }
      if (golfer.shot) {
        const s = golfer.shot;
        const p = s.progress;
        const bx = s.from.x + (s.to.x - s.from.x) * p;
        const by = s.from.y + (s.to.y - s.from.y) * p;
        const groundH = t.heightAt(bx, by);
        const arcH = s.arc * 4 * p * (1 - p);
        const bp = worldToScreen(bx, by, groundH + arcH);
        ball.position.set(bp.x, bp.y);
        ball.zIndex = depth(bx, by) + arcH * HEIGHT_STEP;
        ball.visible = true;
      } else if (golfer.state === 'walking-to-ball' || golfer.state === 'preparing') {
        const bp = worldToScreen(golfer.ball.x, golfer.ball.y, t.heightAt(golfer.ball.x, golfer.ball.y));
        ball.position.set(bp.x, bp.y);
        ball.zIndex = depth(golfer.ball.x, golfer.ball.y);
        ball.visible = true;
      } else {
        ball.visible = false;
      }
    }
    for (const [id, sprite] of this.golferSprites) {
      if (!liveGolfers.has(id)) {
        sprite.destroy();
        this.golferSprites.delete(id);
        const ball = this.ballSprites.get(id);
        if (ball) {
          ball.destroy();
          this.ballSprites.delete(id);
        }
      }
    }
  }
}
