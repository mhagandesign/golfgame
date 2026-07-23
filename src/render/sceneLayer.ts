import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { Game, OBJECT_FOOTPRINT } from '../core/game';
import { Golfer } from '../core/sim/golfer';
import { Groundskeeper } from '../core/sim/staff';
import { SHIRT_COLORS, shade } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';
import { GameTextures } from './textures';

function depth(fx: number, fy: number): number {
  return (fx + fy) * 100;
}

const SKIN_TONES = [0xe8c39a, 0xd4a276, 0xa8764a, 0x8a5a34, 0xf0d0b0];

function drawPerson(
  g: Graphics,
  opts: { shirt: number; trousers: number; cap: number; skin: number; bob: number; swing?: number; mowing?: boolean },
): void {
  const { shirt, trousers, cap, skin, bob } = opts;
  g.ellipse(0, 0, 6, 3).fill({ color: 0x000000, alpha: 0.25 });
  // Legs.
  g.roundRect(-2.6, -8 - bob, 2.2, 7 + bob, 1).fill(trousers);
  g.roundRect(0.4, -8 - bob, 2.2, 7 + bob, 1).fill(shade(trousers, 0.85));
  // Torso.
  g.roundRect(-3.5, -15 - bob, 7, 8.5, 2.5).fill(shirt);
  g.roundRect(-3.5, -15 - bob, 3.2, 8.5, 2.5).fill(shade(shirt, 1.12)); // lit side
  // Arms.
  g.roundRect(-4.6, -14 - bob, 1.8, 6, 1).fill(shade(shirt, 0.9));
  g.roundRect(2.8, -14 - bob, 1.8, 6, 1).fill(shade(shirt, 0.8));
  // Head + cap with brim.
  g.circle(0, -18.5 - bob, 3.4).fill(skin);
  g.rect(-3.6, -21.8 - bob, 7.2, 2.2).fill(cap);
  g.rect(-5.2, -20.2 - bob, 3, 1.2).fill(shade(cap, 0.85));
  // Club, swinging while preparing.
  if (opts.swing !== undefined) {
    const a = -0.5 + Math.sin(opts.swing) * 0.9;
    const len = 12;
    const bx = 3.4;
    const by = -12 - bob;
    g.moveTo(bx, by).lineTo(bx + Math.sin(a) * len, by + Math.cos(a) * len).stroke({ color: 0x9a9a9a, width: 1.6 });
  }
  if (opts.mowing) {
    g.roundRect(4, -7, 9, 5, 1).fill(0x8a2f2a);
    g.roundRect(5, -8.5, 7, 2, 1).fill(0x666666);
    g.circle(5.5, -1.5, 2).fill(0x2c2c2c);
    g.circle(11.5, -1.5, 2).fill(0x2c2c2c);
  }
}

const labelStyle = new TextStyle({ fontFamily: 'sans-serif', fontSize: 11, fill: 0xffffff });

/**
 * Everything that sits on the terrain: props, buildings, hole furniture,
 * golfers and balls. Props are pre-baked texture sprites; people are cheap
 * dynamic Graphics so they can bob, swing and flip. Depth-sorted every frame.
 */
export class SceneLayer {
  readonly container = new Container();
  private objectSprites = new Map<number, Sprite>();
  private golferSprites = new Map<number, Graphics>();
  private golferFacing = new Map<number, { x: number; flip: number }>();
  private ballSprites = new Map<number, Graphics>();
  private staffSprites = new Map<number, Graphics>();
  private courseFurniture: Graphics[] = [];
  private flagCloths: Array<{ g: Graphics; phase: number }> = [];
  private courseDirty = true;

  constructor(
    private game: Game,
    private textures: GameTextures,
  ) {
    this.container.sortableChildren = true;
  }

  setGame(game: Game): void {
    this.game = game;
    this.courseDirty = true;
    for (const s of this.objectSprites.values()) s.destroy();
    for (const s of this.golferSprites.values()) s.destroy();
    for (const s of this.ballSprites.values()) s.destroy();
    for (const s of this.staffSprites.values()) s.destroy();
    for (const f of this.courseFurniture) f.destroy();
    this.courseFurniture = [];
    this.flagCloths = [];
    this.objectSprites.clear();
    this.golferSprites.clear();
    this.golferFacing.clear();
    this.ballSprites.clear();
    this.staffSprites.clear();
  }

  markCourseDirty(): void {
    this.courseDirty = true;
  }

  update(timeSec = 0): void {
    const game = this.game;
    const t = game.terrain;

    // ── Props: pre-baked sprites, add/remove diffs ──
    const liveIds = new Set<number>();
    for (const obj of game.objects) {
      liveIds.add(obj.id);
      let sprite = this.objectSprites.get(obj.id);
      if (!sprite) {
        const prop = this.textures.prop(obj.kind, obj.id);
        sprite = new Sprite(prop.texture);
        sprite.anchor.set(prop.ax, prop.ay);
        const base = prop.scale ?? 1;
        if (obj.kind !== 'clubhouse' && obj.kind !== 'drinks' && obj.kind !== 'snacks' && obj.kind !== 'toilet') {
          sprite.scale.set(base * (0.95 + ((obj.id * 37) % 9) * 0.055));
        } else {
          sprite.scale.set(base);
        }
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

    // ── Hole furniture: flags, cloth & tee markers ──
    if (this.courseDirty) {
      this.courseDirty = false;
      for (const f of this.courseFurniture) f.destroy();
      this.courseFurniture = [];
      this.flagCloths = [];
      for (const hole of game.holes) {
        const cupC = { x: hole.cup.x + 0.5, y: hole.cup.y + 0.5 };
        const fp = worldToScreen(cupC.x, cupC.y, t.heightAt(cupC.x, cupC.y));

        const pole = new Graphics();
        pole.ellipse(0, 0, 4, 1.8).fill({ color: 0x1c2b14, alpha: 0.3 });
        pole.circle(0, 0, 2.2).fill(0x222222);
        pole.circle(0, 0, 1.2).fill(0x111111);
        pole.rect(-0.8, -36, 1.6, 36).fill(0xf0f0f0);
        pole.rect(-0.8, -36, 0.7, 36).fill(0xc8c8c8);
        pole.position.set(fp.x, fp.y);
        pole.zIndex = depth(cupC.x, cupC.y);
        this.courseFurniture.push(pole);
        this.container.addChild(pole);

        const cloth = new Graphics();
        cloth.position.set(fp.x, fp.y);
        cloth.zIndex = depth(cupC.x, cupC.y) + 1;
        this.courseFurniture.push(cloth);
        this.flagCloths.push({ g: cloth, phase: hole.number * 1.7 });
        this.container.addChild(cloth);

        const marker = new Graphics();
        marker.roundRect(-9, -14, 18, 14, 3).fill(0x2f4632).stroke({ color: 0xd8e8c8, width: 1 });
        marker.roundRect(-9, -14, 18, 4, 3).fill(0x3d5a40);
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

    // Waving flag cloth.
    for (const { g, phase } of this.flagCloths) {
      g.clear();
      const w1 = Math.sin(timeSec * 3.2 + phase) * 2.2;
      const w2 = Math.sin(timeSec * 3.2 + phase + 1.1) * 3;
      g.moveTo(0.8, -35)
        .bezierCurveTo(6, -34 + w1 * 0.4, 10, -33 + w1, 15, -31.5 + w2)
        .lineTo(14, -27.5 + w2)
        .bezierCurveTo(9, -28.5 + w1, 6, -29.5 + w1 * 0.4, 0.8, -29.5)
        .closePath()
        .fill(0xd9534f);
      g.moveTo(0.8, -35)
        .bezierCurveTo(6, -34 + w1 * 0.4, 10, -33 + w1, 15, -31.5 + w2)
        .stroke({ color: 0xb03c38, width: 1 });
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
      // Face the walking direction (screen-x flip).
      const face = this.golferFacing.get(golfer.id) ?? { x: golfer.pos.x - golfer.pos.y, flip: 1 };
      const screenX = golfer.pos.x - golfer.pos.y;
      if (Math.abs(screenX - face.x) > 0.01) face.flip = screenX > face.x ? 1 : -1;
      face.x = screenX;
      this.golferFacing.set(golfer.id, face);

      sprite.clear();
      const walking =
        golfer.state === 'walking-to-tee' || golfer.state === 'walking-to-ball' ||
        golfer.state === 'walking-to-amenity' || golfer.state === 'leaving';
      const bob = walking ? Math.abs(Math.sin(timeSec * 9 + golfer.id)) * 1.6 : 0;
      drawPerson(sprite, {
        shirt: SHIRT_COLORS[golfer.shirt % SHIRT_COLORS.length],
        trousers: 0x3a4450,
        cap: shade(SHIRT_COLORS[golfer.shirt % SHIRT_COLORS.length], 0.7),
        skin: SKIN_TONES[golfer.id % SKIN_TONES.length],
        bob,
        swing: golfer.state === 'preparing' ? timeSec * 7 + golfer.id : undefined,
      });
      sprite.scale.x = face.flip;
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
        this.golferFacing.delete(id);
        const ball = this.ballSprites.get(id);
        if (ball) {
          ball.destroy();
          this.ballSprites.delete(id);
        }
      }
    }

    // ── Groundskeepers ──
    const liveStaff = new Set<number>();
    for (const gk of game.staff) {
      liveStaff.add(gk.id);
      let sprite = this.staffSprites.get(gk.id);
      if (!sprite) {
        sprite = new Graphics();
        this.staffSprites.set(gk.id, sprite);
        this.container.addChild(sprite);
      }
      sprite.clear();
      const bob = gk.state === 'walking' ? Math.abs(Math.sin(timeSec * 9 + gk.id)) * 1.6 : 0;
      drawPerson(sprite, {
        shirt: 0xc8a03c,
        trousers: 0x4a5a38,
        cap: 0xa04030,
        skin: SKIN_TONES[gk.id % SKIN_TONES.length],
        bob,
        mowing: gk.state === 'mowing',
      });
      const sp = worldToScreen(gk.pos.x, gk.pos.y, t.heightAt(gk.pos.x, gk.pos.y));
      sprite.position.set(sp.x, sp.y);
      sprite.zIndex = depth(gk.pos.x, gk.pos.y);
    }
    for (const [id, sprite] of this.staffSprites) {
      if (!liveStaff.has(id)) {
        sprite.destroy();
        this.staffSprites.delete(id);
      }
    }
  }
}
