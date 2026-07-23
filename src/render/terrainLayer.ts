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

        // ── Sculpted lighting: Lambert against the NW sun using a gradient
        // smoothed over a wide stencil, so broad hills shade while single-tile
        // bumps don't create a patchwork of diamonds. ──
        const cxw = x + 0.5;
        const cyw = y + 0.5;
        const R = 2.5;
        const gx = (t.heightAt(cxw + R, cyw) - t.heightAt(cxw - R, cyw)) / (2 * R);
        const gy = (t.heightAt(cxw, cyw + R) - t.heightAt(cxw, cyw - R)) / (2 * R);
        // Surface normal ∝ (-dH/dx, -dH/dy, 1); sun toward (-1,-1,1.3) (NW, high).
        const nlen = Math.hypot(gx, gy, 1);
        const ndotl = (0.52 * gx + 0.52 * gy + 0.677) / nlen;
        let bright = 0.98 + (ndotl - 0.677) * 1.5;
        // Gentle broad ambient occlusion: hollows sit in shade, ridges catch light.
        const relief =
          t.heightAt(cxw, cyw) -
          (t.heightAt(cxw - 4.5, cyw) +
            t.heightAt(cxw + 4.5, cyw) +
            t.heightAt(cxw, cyw - 4.5) +
            t.heightAt(cxw, cyw + 4.5)) /
            4;
        bright += Math.max(-0.09, Math.min(0.07, relief * 0.035));
        bright += tileNoise(x, y);
        // Mowing stripes across fairways and tees.
        if (surface === Surface.Fairway || surface === Surface.Tee) {
          bright += Math.floor((x + y) / 2) % 2 === 0 ? 0.05 : -0.05;
        }
        bright = Math.max(0.42, Math.min(1.4, bright));
        // Texture fill tinted by lighting; shaded faces pick up cool sky fill,
        // sunlit faces a touch of warmth — matching the rendered props.
        let tint = shade(0xffffff, bright);
        if (bright < 0.9) tint = mix(tint, 0x5878a0, (0.9 - bright) * 0.5);
        else if (bright > 1.08) tint = mix(tint, 0xfff2d8, (bright - 1.08) * 0.7);
        const wear = t.wearAt(x, y);
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

        // Wildflower-meadow detail on the rough: several grass tufts per tile
        // plus occasional clover/daisy clusters, for the reference's lush look.
        if (surface === Surface.Rough) {
          for (let s = 0; s < 4; s++) {
            const u = hash2(x * 4 + s, y * 7 + 13);
            if (u < 0.4) continue; // bare patches keep it natural
            const v = hash2(x * 9 + 3, y * 5 + s * 17);
            const px = pSW.x + (pNE.x - pSW.x) * (0.15 + u * 0.7);
            const py = pNW.y + (pSE.y - pNW.y) * (0.2 + v * 0.6);
            const tuftC = shade(0x5c8a3e, 0.82 + u * 0.38);
            for (let b = -1; b <= 1; b++) {
              g.moveTo(px + b * 1.4, py)
                .lineTo(px + b * 2 + 0.8, py - 2.6 - u * 1.7)
                .stroke({ color: tuftC, width: 1 });
            }
            // Sparse flower clusters: white daisies, yellow buttercups, pink clover.
            const fh = hash2(x * 13 + s * 31, y * 11 + 7);
            if (fh > 0.88) {
              const fc = fh > 0.966 ? 0xf6e85c : fh > 0.925 ? 0xf4f4ee : 0xe89ac0;
              for (let k = 0; k < 3; k++) {
                const a = k * 2.1 + u * 3;
                g.circle(px + Math.cos(a) * 1.3, py - 2.8 + Math.sin(a) * 0.9, 0.85).fill(fc);
              }
              if (fc === 0xf4f4ee) g.circle(px, py - 2.8, 0.6).fill(0xf0d040); // daisy centre
            }
          }
        }
        // A whisper of tiny clover on fairway/tee edges — lush but still mown.
        if (surface === Surface.Fairway) {
          const cf = hash2(x * 17 + 5, y * 19 + 2);
          if (cf > 0.9) {
            const px = pSW.x + (pNE.x - pSW.x) * (0.3 + hash2(x, y + 3) * 0.4);
            const py = pNW.y + (pSE.y - pNW.y) * (0.35 + hash2(x + 5, y) * 0.3);
            g.circle(px, py, 0.7).fill({ color: 0xf0f0e4, alpha: 0.8 });
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

        // Shoreline smoothing: when two adjacent edges of this land tile
        // both border water, chamfer the shared corner with water so pond
        // outlines read as octagonal curves instead of tile staircases.
        const isWater = (nx: number, ny: number) => t.inBounds(nx, ny) && t.surfaceAt(nx, ny) === Surface.Water;
        const midpoint = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
        const chamfers: Array<[boolean, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]> = [
          [isWater(x + 1, y) && isWater(x, y - 1), midpoint(pNW, pNE), pNE, midpoint(pNE, pSE)], // NE corner
          [isWater(x + 1, y) && isWater(x, y + 1), midpoint(pNE, pSE), pSE, midpoint(pSE, pSW)], // SE corner
          [isWater(x - 1, y) && isWater(x, y + 1), midpoint(pSE, pSW), pSW, midpoint(pSW, pNW)], // SW corner
          [isWater(x - 1, y) && isWater(x, y - 1), midpoint(pSW, pNW), pNW, midpoint(pNW, pNE)], // NW corner
        ];
        for (const [hit, m1, corner, m2] of chamfers) {
          if (!hit) continue;
          g.poly([m1.x, m1.y, corner.x, corner.y, m2.x, m2.y]).fill(SHORE_COLOR);
          const inset = (p: { x: number; y: number }) => ({ x: corner.x + (p.x - corner.x) * 0.72, y: corner.y + (p.y - corner.y) * 0.72 });
          const i1 = inset(m1);
          const i2 = inset(m2);
          g.poly([i1.x, i1.y, corner.x, corner.y, i2.x, i2.y]).fill(0x3d81b4);
          g.moveTo(i1.x, i1.y).lineTo(i2.x, i2.y).stroke({ color: 0xe8f4f8, width: 1.2, alpha: 0.5 });
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
      // Foam line hugging the shore.
      wg.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xe8f4f8, width: 1.4, alpha: 0.55 });
    }

    // Mirror chamfer: where this water tile pokes into land on two adjacent
    // sides, cut the corner back with shore so the outline stays smooth.
    const isLand = (nx: number, ny: number) => t.inBounds(nx, ny) && t.surfaceAt(nx, ny) !== Surface.Water;
    const midpoint = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const chamfers: Array<[boolean, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]> = [
      [isLand(x + 1, y) && isLand(x, y - 1), midpoint(p0, p1), p1, midpoint(p1, p2)],
      [isLand(x + 1, y) && isLand(x, y + 1), midpoint(p1, p2), p2, midpoint(p2, p3)],
      [isLand(x - 1, y) && isLand(x, y + 1), midpoint(p2, p3), p3, midpoint(p3, p0)],
      [isLand(x - 1, y) && isLand(x, y - 1), midpoint(p3, p0), p0, midpoint(p0, p1)],
    ];
    for (const [hit, m1, corner, m2] of chamfers) {
      if (!hit) continue;
      wg.poly([m1.x, m1.y, corner.x, corner.y, m2.x, m2.y]).fill(SHORE_COLOR);
      wg.moveTo(m1.x, m1.y).lineTo(m2.x, m2.y).stroke({ color: 0xe8f4f8, width: 1.4, alpha: 0.55 });
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
