import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { GameTextures } from './textures';
import { Game } from '../core/game';
import { Camera } from './camera';
import { SceneLayer } from './sceneLayer';
import { TerrainLayer } from './terrainLayer';
import { screenToWorld, worldToScreen } from './iso';
import { mix } from './colors';
import { fbm } from './noise';
import { Pt, holeLegs } from '../core/course/course';

/** Ambient light color for a given minute of day. */
export function ambientForMinute(minute: number): number {
  const h = minute / 60;
  const NIGHT = 0x7888b8;
  const DAWN = 0xffd8b0;
  const DAY = 0xffffff;
  const DUSK = 0xffc090;
  if (h < 5) return NIGHT;
  if (h < 6.5) return mix(NIGHT, DAWN, (h - 5) / 1.5);
  if (h < 8) return mix(DAWN, DAY, (h - 6.5) / 1.5);
  if (h < 17.5) return DAY;
  if (h < 19.5) return mix(DAY, DUSK, (h - 17.5) / 2);
  if (h < 21) return mix(DUSK, NIGHT, (h - 19.5) / 1.5);
  return NIGHT;
}

export class Renderer {
  readonly app = new Application();
  readonly world = new Container();
  camera!: Camera;
  terrainLayer!: TerrainLayer;
  sceneLayer!: SceneLayer;
  /** Cursor/tool highlight overlay, redrawn per frame by the input layer. */
  readonly highlight = new Graphics();
  /** Hole routing overlay (dashed target lines) shown in the hole designer. */
  readonly routes = new Graphics();
  /** Screen-space rain overlay. */
  private rain = new Graphics();
  private rainDrops: Array<{ x: number; y: number; speed: number }> = [];
  private elapsed = 0;
  textures!: GameTextures;
  private vignette!: Sprite;

  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x2c3e2d,
      resizeTo: window,
      antialias: true,
      preference: 'webgl',
    });
    host.appendChild(this.app.canvas);

    this.camera = new Camera(this.world);
    this.textures = await GameTextures.build(this.app.renderer);
    this.terrainLayer = new TerrainLayer(this.game.terrain, this.textures);
    this.sceneLayer = new SceneLayer(this.game, this.textures);

    this.world.addChild(this.terrainLayer.container);
    this.world.addChild(this.buildMacroOverlay());
    this.world.addChild(this.routes);
    this.world.addChild(this.sceneLayer.shadowContainer);
    this.world.addChild(this.sceneLayer.container);
    this.world.addChild(this.highlight);
    this.app.stage.addChild(this.world);

    // Soft painterly vignette over the whole scene.
    const vc = document.createElement('canvas');
    vc.width = 512;
    vc.height = 512;
    const vctx = vc.getContext('2d')!;
    const grad = vctx.createRadialGradient(256, 256, 150, 256, 256, 360);
    grad.addColorStop(0, 'rgba(10,20,8,0)');
    grad.addColorStop(1, 'rgba(10,20,8,0.2)');
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, 512, 512);
    this.vignette = new Sprite(Texture.from(vc));
    this.app.stage.addChild(this.vignette);

    this.app.stage.addChild(this.rain);

    for (let i = 0; i < 140; i++) {
      this.rainDrops.push({ x: Math.random(), y: Math.random(), speed: 0.6 + Math.random() * 0.5 });
    }

    this.centerOnMap();
  }

  setGame(game: Game): void {
    this.game = game;
    this.terrainLayer.setTerrain(game.terrain);
    this.sceneLayer.setGame(game);
    this.centerOnMap();
  }

  /**
   * Large-scale tonal variation multiplied over the terrain — the broad
   * light/dark patchiness that makes real aerial turf read as organic.
   */
  private buildMacroOverlay(): Sprite {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = fbm(x / size, y / size, 4, 5, 4242);
        // Subtle multiply range — broad variation without murking the scene.
        const v = Math.round(255 * (0.94 + Math.min(1, Math.max(0, n)) * 0.06));
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const sprite = new Sprite(Texture.from(c));
    const t = this.game.terrain;
    const xMin = -t.h * 32;
    const width = (t.w + t.h) * 32;
    const yMin = -170;
    const height = (t.w + t.h) * 16 + 200;
    sprite.position.set(xMin, yMin);
    sprite.width = width;
    sprite.height = height;
    sprite.blendMode = 'multiply';
    return sprite;
  }

  centerOnMap(): void {
    const c = worldToScreen(this.game.terrain.w / 2, this.game.terrain.h / 2, 3);
    this.camera.scale = 1;
    this.camera.x = window.innerWidth / 2 - c.x;
    this.camera.y = window.innerHeight / 2 - c.y;
    this.camera.apply();
  }

  /** Terrain tile under a client (screen) position. */
  pickTile(clientX: number, clientY: number): Pt {
    const wp = this.camera.screenToWorldPoint(clientX, clientY);
    const world = screenToWorld(this.game.terrain, wp.x, wp.y);
    return {
      x: Math.max(0, Math.min(this.game.terrain.w - 1, Math.floor(world.x))),
      y: Math.max(0, Math.min(this.game.terrain.h - 1, Math.floor(world.y))),
    };
  }

  /** Nearest vertex under a client position (for terraforming). */
  pickVertex(clientX: number, clientY: number): Pt {
    const wp = this.camera.screenToWorldPoint(clientX, clientY);
    const world = screenToWorld(this.game.terrain, wp.x, wp.y);
    return {
      x: Math.max(0, Math.min(this.game.terrain.w, Math.round(world.x))),
      y: Math.max(0, Math.min(this.game.terrain.h, Math.round(world.y))),
    };
  }

  /** Outline a tile on the highlight overlay. */
  outlineTile(x: number, y: number, color = 0xffffff, alpha = 0.9): void {
    const t = this.game.terrain;
    if (!t.inBounds(x, y)) return;
    const [nw, ne, se, sw] = t.corners(x, y);
    const p0 = worldToScreen(x, y, nw);
    const p1 = worldToScreen(x + 1, y, ne);
    const p2 = worldToScreen(x + 1, y + 1, se);
    const p3 = worldToScreen(x, y + 1, sw);
    this.highlight
      .poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y])
      .stroke({ color, width: 2, alpha })
      .fill({ color, alpha: alpha * 0.15 });
  }

  markerAtVertex(vx: number, vy: number, color = 0xffe066): void {
    const t = this.game.terrain;
    const p = worldToScreen(vx, vy, t.vertexHeight(Math.min(vx, t.w), Math.min(vy, t.h)));
    this.highlight.circle(p.x, p.y, 5).fill({ color, alpha: 0.9 });
  }

  /** Draw hole routing lines (tee → waypoints → cup). */
  drawRoutes(showAll: boolean, draft?: Pt[]): void {
    this.routes.clear();
    const t = this.game.terrain;
    const drawLine = (pts: Pt[], color: number) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 0.55) / steps;
          const ax = a.x + 0.5 + (b.x - a.x) * t0;
          const ay = a.y + 0.5 + (b.y - a.y) * t0;
          const bx = a.x + 0.5 + (b.x - a.x) * Math.min(t1, 1);
          const by = a.y + 0.5 + (b.y - a.y) * Math.min(t1, 1);
          const pa = worldToScreen(ax, ay, t.heightAt(ax, ay) + 0.15);
          const pb = worldToScreen(bx, by, t.heightAt(bx, by) + 0.15);
          this.routes.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ color, width: 2, alpha: 0.8 });
        }
      }
    };
    if (showAll) {
      for (const hole of this.game.holes) drawLine(holeLegs(hole), 0xffffff);
    }
    if (draft && draft.length > 0) drawLine(draft, 0xffe066);
  }

  frame(dtSec = 0): void {
    this.elapsed += dtSec;
    this.terrainLayer.update(this.elapsed);
    this.sceneLayer.update(this.elapsed);

    // Time-of-day ambient light (weather dims it further).
    let ambient = ambientForMinute(this.game.minute);
    if (this.game.weather === 'rain') ambient = mix(ambient, 0x8898a8, 0.45);
    else if (this.game.weather === 'cloud') ambient = mix(ambient, 0xc8ccd4, 0.25);
    this.world.tint = ambient;

    this.vignette.width = this.app.screen.width;
    this.vignette.height = this.app.screen.height;

    this.updateRain(dtSec);
  }

  private updateRain(dtSec: number): void {
    this.rain.clear();
    if (this.game.weather !== 'rain') return;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    for (const d of this.rainDrops) {
      d.y += d.speed * dtSec * 1.4;
      d.x -= d.speed * dtSec * 0.25;
      if (d.y > 1) {
        d.y -= 1 + Math.random() * 0.1;
        d.x = Math.random();
      }
      if (d.x < 0) d.x += 1;
      const px = d.x * w;
      const py = d.y * h;
      this.rain
        .moveTo(px, py)
        .lineTo(px + 3, py + 11)
        .stroke({ color: 0xbcd4e8, width: 1, alpha: 0.5 });
    }
  }
}
