import { Container, Graphics } from 'pixi.js';
import { Surface, Terrain } from '../core/terrain/terrain';
import { SURFACE_COLORS, shade, tileNoise, mix, hash2 } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';
import { GameTextures } from './textures';

const CHUNK = 16;
const WEAR_COLOR = 0xc8a464;
const SHORE_COLOR = 0xdcc894;

/**
 * Chunked terrain renderer: one land Graphics and one water Graphics per
 * 16x16 tile chunk, redrawn only when marked dirty. Water sits in its own
 * layer so the whole sheet can shimmer via tint without any redraws.
 */
export class TerrainLayer {
  readonly container = new Container();
  private chunks: Graphics[] = [];
  private waterChunks: Graphics[] = [];
  private dirty = new Set<number>();
  private cw: number;
  private ch: number;

  constructor(
    private terrain: Terrain,
    private textures: GameTextures,
  ) {
    this.container.sortableChildren = true;
    this.cw = Math.ceil(terrain.w / CHUNK);
    this.ch = Math.ceil(terrain.h / CHUNK);
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const g = new Graphics();
        g.zIndex = (cx + cy) * 2;
        const w = new Graphics();
        w.zIndex = (cx + cy) * 2 + 1;
        this.chunks.push(g);
        this.waterChunks.push(w);
        this.container.addChild(g);
        this.container.addChild(w);
        this.dirty.add(cy * this.cw + cx);
      }
    }
  }

  setTerrain(terrain: Terrain): void {
    this.terrain = terrain;
    this.markAllDirty();
  }

  markAllDirty(): void {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
  }

  /** Mark the chunk containing tile (x, y) — and neighbors when on a chunk edge. */
  markTileDirty(x: number, y: number): void {
    for (const [ox, oy] of [
      [0, 0],
      [-1, 0],
      [0, -1],
      [-1, -1],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const tx = x + ox;
      const ty = y + oy;
      if (tx < 0 || ty < 0 || tx >= this.terrain.w || ty >= this.terrain.h) continue;
      this.dirty.add(Math.floor(ty / CHUNK) * this.cw + Math.floor(tx / CHUNK));
    }
  }

  /** Redraw dirty chunks and animate the water shimmer. */
  update(timeSec: number): void {
    // Turf wear changes flow in from the simulation.
    if (this.terrain.wearDirty.size > 0) {
      for (const idx of this.terrain.wearDirty) {
        this.markTileDirty(idx % this.terrain.w, Math.floor(idx / this.terrain.w));
      }
      this.terrain.wearDirty.clear();
    }
    for (const idx of this.dirty) this.redrawChunk(idx);
    this.dirty.clear();

    const glow = 0.92 + 0.08 * Math.sin(timeSec * 1.6);
    const waterTint = shade(0xffffff, glow);
    for (const w of this.waterChunks) w.tint = waterTint;
  }

  private redrawChunk(idx: number): void {
    const g = this.chunks[idx];
    const wg = this.waterChunks[idx];
    g.clear();
    wg.clear();
    const cx = (idx % this.cw) * CHUNK;
    const cy = Math.floor(idx / this.cw) * CHUNK;
    const t = this.terrain;

    for (let y = cy; y < Math.min(cy + CHUNK, t.h); y++) {
      for (let x = cx; x < Math.min(cx + CHUNK, t.w); x++) {
        const [nw, ne, se, sw] = t.corners(x, y);
        const surface = t.surfaceAt(x, y);

        if (surface === Surface.Water) {
          this.drawWaterTile(wg, x, y);
          continue;
        }

        const pNW = worldToScreen(x, y, nw);
        const pNE = worldToScreen(x + 1, y, ne);
        const pSE = worldToScreen(x + 1, y + 1, se);
        const pSW = worldToScreen(x, y + 1, sw);

        // NW-sun lighting from the corner gradient, plus per-tile noise.
        const grad = t.gradient(x, y);
        let bright = 1 + (grad.dx * 0.75 + grad.dy * 0.35) * 0.16;
        bright += tileNoise(x, y);
        // Mowing stripes across fairways and tees.
        if (surface === Surface.Fairway || surface === Surface.Tee) {
          bright += Math.floor((x + y) / 2) % 2 === 0 ? 0.05 : -0.05;
        }
        // Texture fill tinted by lighting; worn turf browns the tint.
        const wear = t.wearAt(x, y);
        let tint = shade(0xffffff, Math.max(0.6, Math.min(1.35, bright)));
        if (wear > 0.03) tint = mix(tint, WEAR_COLOR, Math.min(0.75, wear * 0.8));
        const fill = this.textures.surfaces[surface];
        const style = { texture: fill.texture, matrix: fill.matrix, color: tint };

        // Split the quad along NW-SE so saddle tiles render correctly.
        g.poly([pNW.x, pNW.y, pNE.x, pNE.y, pSE.x, pSE.y]).fill(style);
        if (nw + se === ne + sw) {
          g.poly([pNW.x, pNW.y, pSE.x, pSE.y, pSW.x, pSW.y]).fill(style);
        } else {
          g.poly([pNW.x, pNW.y, pSE.x, pSE.y, pSW.x, pSW.y]).fill({ ...style, color: shade(tint, 0.96) });
        }

        // Grass tufts & wildflowers scattered over the rough.
        if (surface === Surface.Rough) {
          const h1 = hash2(x, y);
          if (h1 > 0.55) {
            const u = hash2(x + 31, y);
            const v = hash2(x, y + 57);
            const px = pSW.x + (pNE.x - pSW.x) * (0.2 + u * 0.6);
            const py = pNW.y + (pSE.y - pNW.y) * (0.25 + v * 0.5);
            const tuftC = shade(0x5c8a3e, 0.9 + u * 0.3);
            for (let b = -1; b <= 1; b++) {
              g.moveTo(px + b * 1.6, py).lineTo(px + b * 2.4, py - 3.2 - u * 1.5).stroke({ color: tuftC, width: 1 });
            }
            if (h1 > 0.965) g.circle(px + 1, py - 4, 1.1).fill(v > 0.5 ? 0xf0e04e : 0xf0f0f0);
          }
        }

        // Transition bands where turf types meet, and wet-sand shorelines.
        const edges: Array<[number, number, { x: number; y: number }, { x: number; y: number }]> = [
          [x, y - 1, pNW, pNE],
          [x + 1, y, pNE, pSE],
          [x, y + 1, pSE, pSW],
          [x - 1, y, pSW, pNW],
        ];
        const cxm = (pNW.x + pSE.x) / 2;
        const cym = (pNW.y + pSE.y) / 2;
        const band = (a: { x: number; y: number }, b: { x: number; y: number }, depth: number, color: number, alpha: number) => {
          const ia = { x: a.x + (cxm - a.x) * depth, y: a.y + (cym - a.y) * depth };
          const ib = { x: b.x + (cxm - b.x) * depth, y: b.y + (cym - b.y) * depth };
          g.poly([a.x, a.y, b.x, b.y, ib.x, ib.y, ia.x, ia.y]).fill({ color, alpha });
        };
        for (const [nx, ny, a, b] of edges) {
          if (!t.inBounds(nx, ny)) continue;
          const n = t.surfaceAt(nx, ny);
          if (n === Surface.Water) {
            band(a, b, 0.18, SHORE_COLOR, 1);
          } else if (surface === Surface.Fairway && n === Surface.Rough) {
            // Semi-rough: a darker mown collar on the fairway edge.
            band(a, b, 0.14, 0x4e7834, 0.4);
          } else if (surface === Surface.Green && n !== Surface.Green) {
            // Fringe collar around the green.
            band(a, b, 0.16, 0x86ba52, 0.75);
          }
        }

        // Map border skirt.
        if (y === t.h - 1) {
          const bSW = worldToScreen(x, y + 1, -1);
          const bSE = worldToScreen(x + 1, y + 1, -1);
          g.poly([pSW.x, pSW.y, pSE.x, pSE.y, bSE.x, bSE.y + HEIGHT_STEP, bSW.x, bSW.y + HEIGHT_STEP]).fill(0x6b543c);
        }
        if (x === t.w - 1) {
          const bNE = worldToScreen(x + 1, y, -1);
          const bSE = worldToScreen(x + 1, y + 1, -1);
          g.poly([pNE.x, pNE.y, pSE.x, pSE.y, bSE.x, bSE.y + HEIGHT_STEP, bNE.x, bNE.y + HEIGHT_STEP]).fill(0x57432f);
        }
      }
    }
  }

  private drawWaterTile(wg: Graphics, x: number, y: number): void {
    const t = this.terrain;
    const level = t.minCorner(x, y);
    const p0 = worldToScreen(x, y, level);
    const p1 = worldToScreen(x + 1, y, level);
    const p2 = worldToScreen(x + 1, y + 1, level);
    const p3 = worldToScreen(x, y + 1, level);
    const fill = this.textures.surfaces[Surface.Water];
    const tint = shade(0xffffff, 0.94 + tileNoise(x, y));
    wg.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]).fill({ texture: fill.texture, matrix: fill.matrix, color: tint });

    // Lighter shallows along shores.
    const cxm = (p0.x + p2.x) / 2;
    const cym = (p0.y + p2.y) / 2;
    const edges: Array<[number, number, { x: number; y: number }, { x: number; y: number }]> = [
      [x, y - 1, p0, p1],
      [x + 1, y, p1, p2],
      [x, y + 1, p2, p3],
      [x - 1, y, p3, p0],
    ];
    for (const [nx, ny, a, b] of edges) {
      if (!t.inBounds(nx, ny) || t.surfaceAt(nx, ny) === Surface.Water) continue;
      const ia = { x: a.x + (cxm - a.x) * 0.3, y: a.y + (cym - a.y) * 0.3 };
      const ib = { x: b.x + (cxm - b.x) * 0.3, y: b.y + (cym - b.y) * 0.3 };
      wg.poly([a.x, a.y, b.x, b.y, ib.x, ib.y, ia.x, ia.y]).fill({ color: 0x6cb2dc, alpha: 0.45 });
    }

    // A couple of static wave glints; the layer tint animates them.
    if (hash2(x, y) > 0.45) {
      const u = 0.2 + hash2(x + 9, y) * 0.5;
      const v = 0.25 + hash2(x, y + 7) * 0.5;
      const wx = p0.x + (p2.x - p0.x) * u + (p1.x - p3.x) * (v - 0.5) * 0.5;
      const wy = p0.y + (p2.y - p0.y) * v;
      wg.moveTo(wx - 4, wy).quadraticCurveTo(wx, wy - 2.5, wx + 4, wy).stroke({ color: 0xaee0f4, width: 1.2, alpha: 0.8 });
    }
  }
}
