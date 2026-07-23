import { Application, Container, Graphics } from 'pixi.js';
import { Game } from '../core/game';
import { Camera } from './camera';
import { SceneLayer } from './sceneLayer';
import { TerrainLayer } from './terrainLayer';
import { screenToWorld, worldToScreen } from './iso';
import { Pt, holeLegs } from '../core/course/course';

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
    this.terrainLayer = new TerrainLayer(this.game.terrain);
    this.sceneLayer = new SceneLayer(this.game);

    this.world.addChild(this.terrainLayer.container);
    this.world.addChild(this.routes);
    this.world.addChild(this.sceneLayer.container);
    this.world.addChild(this.highlight);
    this.app.stage.addChild(this.world);

    this.centerOnMap();
  }

  setGame(game: Game): void {
    this.game = game;
    this.terrainLayer.setTerrain(game.terrain);
    this.sceneLayer.setGame(game);
    this.centerOnMap();
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

  frame(): void {
    this.terrainLayer.update();
    this.sceneLayer.update();
  }
}
