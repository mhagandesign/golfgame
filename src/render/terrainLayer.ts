import { Container, Graphics } from 'pixi.js';
import { Surface, Terrain } from '../core/terrain/terrain';
import { SURFACE_COLORS, shade, tileNoise, mix, hash2 } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';

const CHUNK = 16;
const WEAR_COLOR = 0xb49a58;
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

  constructor(private terrain: Terrain) {
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
          bright += Math.floor((x + y) / 2) % 2 === 0 ? 0.045 : -0.045;
        }
        let color = shade(SURFACE_COLORS[surface], Math.max(0.6, Math.min(1.35, bright)));
        // Worn turf browns out.
        const wear = t.wearAt(x, y);
        if (wear > 0.03) color = mix(color, WEAR_COLOR, Math.min(0.7, wear * 0.75));

        // Split the quad along NW-SE so saddle tiles render correctly.
        g.poly([pNW.x, pNW.y, pNE.x, pNE.y, pSE.x, pSE.y]).fill(color);
        const color2 = nw + se === ne + sw ? color : shade(color, 0.96);
        g.poly([pNW.x, pNW.y, pSE.x, pSE.y, pSW.x, pSW.y]).fill(color2);

        // Green fringe: a lighter mowed ring reads as a tended green.
        if (surface === Surface.Green) {
          const cxm = (pNW.x + pNE.x + pSE.x + pSW.x) / 4;
          const cym = (pNW.y + pNE.y + pSE.y + pSW.y) / 4;
          const inset = (p: { x: number; y: number }) => ({ x: p.x + (cxm - p.x) * 0.3, y: p.y + (cym - p.y) * 0.3 });
          const i0 = inset(pNW);
          const i1 = inset(pNE);
          const i2 = inset(pSE);
          const i3 = inset(pSW);
          g.poly([i0.x, i0.y, i1.x, i1.y, i2.x, i2.y, i3.x, i3.y]).fill(shade(color, 1.06));
        }

        // Sand speckling.
        if (surface === Surface.Sand) {
          for (let s = 0; s < 3; s++) {
            const u = hash2(x * 3 + s, y);
            const v = hash2(x, y * 3 + s);
            const px = pNW.x + (pSE.x - pNW.x) * u * 0.8 + (pNE.x - pSW.x) * (v - 0.5) * 0.4;
            const py = pNW.y + (pSE.y - pNW.y) * (0.15 + v * 0.7);
            g.circle(px, py, 1.1).fill(shade(color, 0.82));
          }
        }

        // Wet-sand shoreline strips along edges bordering water.
        const edges: Array<[number, number, { x: number; y: number }, { x: number; y: number }]> = [
          [x, y - 1, pNW, pNE],
          [x + 1, y, pNE, pSE],
          [x, y + 1, pSE, pSW],
          [x - 1, y, pSW, pNW],
        ];
        for (const [nx, ny, a, b] of edges) {
          if (!t.inBounds(nx, ny) || t.surfaceAt(nx, ny) !== Surface.Water) continue;
          const cxm = (pNW.x + pSE.x) / 2;
          const cym = (pNW.y + pSE.y) / 2;
          const ia = { x: a.x + (cxm - a.x) * 0.18, y: a.y + (cym - a.y) * 0.18 };
          const ib = { x: b.x + (cxm - b.x) * 0.18, y: b.y + (cym - b.y) * 0.18 };
          g.poly([a.x, a.y, b.x, b.y, ib.x, ib.y, ia.x, ia.y]).fill(SHORE_COLOR);
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
    const deep = shade(SURFACE_COLORS[Surface.Water], 0.92 + tileNoise(x, y));
    wg.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]).fill(deep);
    // A couple of static wave glints; the layer tint animates them.
    if (hash2(x, y) > 0.4) {
      const u = 0.2 + hash2(x + 9, y) * 0.5;
      const v = 0.25 + hash2(x, y + 7) * 0.5;
      const wx = p0.x + (p2.x - p0.x) * u + (p1.x - p3.x) * (v - 0.5) * 0.5;
      const wy = p0.y + (p2.y - p0.y) * v;
      wg.moveTo(wx - 4, wy).quadraticCurveTo(wx, wy - 2.5, wx + 4, wy).stroke({ color: 0x9cd8f0, width: 1, alpha: 0.7 });
    }
  }
}
