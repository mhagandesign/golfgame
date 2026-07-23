import { Container, Graphics } from 'pixi.js';
import { Surface, Terrain } from '../core/terrain/terrain';
import { SURFACE_COLORS, shade, tileNoise } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';

const CHUNK = 16;

/**
 * Chunked terrain renderer: one Graphics per 16x16 tile chunk, redrawn only
 * when marked dirty. Each tile is a quad spanning its four corner vertices.
 */
export class TerrainLayer {
  readonly container = new Container();
  private chunks: Graphics[] = [];
  private dirty = new Set<number>();
  private cw: number;
  private ch: number;

  constructor(private terrain: Terrain) {
    this.cw = Math.ceil(terrain.w / CHUNK);
    this.ch = Math.ceil(terrain.h / CHUNK);
    for (let cy = 0; cy < this.ch; cy++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const g = new Graphics();
        // Chunks are painters-ordered back to front by diagonal.
        g.zIndex = cx + cy;
        this.chunks.push(g);
        this.container.addChild(g);
        this.dirty.add(cy * this.cw + cx);
      }
    }
    this.container.sortableChildren = true;
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

  update(): void {
    for (const idx of this.dirty) this.redrawChunk(idx);
    this.dirty.clear();
  }

  private redrawChunk(idx: number): void {
    const g = this.chunks[idx];
    g.clear();
    const cx = (idx % this.cw) * CHUNK;
    const cy = Math.floor(idx / this.cw) * CHUNK;
    const t = this.terrain;

    for (let y = cy; y < Math.min(cy + CHUNK, t.h); y++) {
      for (let x = cx; x < Math.min(cx + CHUNK, t.w); x++) {
        const [nw, ne, se, sw] = t.corners(x, y);
        const surface = t.surfaceAt(x, y);
        // Water renders at the tile's lowest corner as a flat pool.
        const flatWater = surface === Surface.Water;
        const hNW = flatWater ? Math.min(nw, ne, se, sw) : nw;
        const hNE = flatWater ? hNW : ne;
        const hSE = flatWater ? hNW : se;
        const hSW = flatWater ? hNW : sw;

        const pNW = worldToScreen(x, y, hNW);
        const pNE = worldToScreen(x + 1, y, hNE);
        const pSE = worldToScreen(x + 1, y + 1, hSE);
        const pSW = worldToScreen(x, y + 1, hSW);

        // NW-sun lighting from the corner gradient, plus per-tile noise.
        const grad = t.gradient(x, y);
        let bright = 1 + (grad.dx * 0.75 + grad.dy * 0.35) * 0.16;
        bright += tileNoise(x, y);
        const color = shade(SURFACE_COLORS[surface], Math.max(0.6, Math.min(1.35, bright)));

        // Split the quad along NW-SE so saddle tiles render correctly.
        g.poly([pNW.x, pNW.y, pNE.x, pNE.y, pSE.x, pSE.y]).fill(color);
        const color2 = nw + se === ne + sw ? color : shade(color, 0.96);
        g.poly([pNW.x, pNW.y, pSE.x, pSE.y, pSW.x, pSW.y]).fill(color2);

        // Map border skirt.
        if (y === t.h - 1) {
          const base = -1;
          const bSW = worldToScreen(x, y + 1, base);
          const bSE = worldToScreen(x + 1, y + 1, base);
          g.poly([pSW.x, pSW.y, pSE.x, pSE.y, bSE.x, bSE.y + HEIGHT_STEP, bSW.x, bSW.y + HEIGHT_STEP]).fill(0x6b543c);
        }
        if (x === t.w - 1) {
          const base = -1;
          const bNE = worldToScreen(x + 1, y, base);
          const bSE = worldToScreen(x + 1, y + 1, base);
          g.poly([pNE.x, pNE.y, pSE.x, pSE.y, bSE.x, bSE.y + HEIGHT_STEP, bNE.x, bNE.y + HEIGHT_STEP]).fill(0x57432f);
        }
      }
    }
  }
}
