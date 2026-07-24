import { Container, Graphics } from 'pixi.js';
import { Surface, Terrain } from '../core/terrain/terrain';
import { shade, tileNoise, mix, hash2 } from './colors';
import { HEIGHT_STEP, worldToScreen } from './iso';
import { GameTextures } from './textures';

const CHUNK = 16;
const WEAR_COLOR = 0xc8a464;
const SHORE_COLOR = 0xdcc894;

interface Pt {
  x: number;
  y: number;
}

/** Land surfaces drawn as rounded blobs over the rough base, low → high. */
const OVERLAY_LEVELS: Surface[] = [Surface.Path, Surface.Fairway, Surface.Tee, Surface.Green, Surface.Sand];

/**
 * Chunked terrain renderer. Each tile's surface is drawn as a rounded blob
 * over a continuous rough base, so boundaries between surface types read as
 * organic curves instead of a blocky diamond staircase. Water sits in its own
 * layer with a rounded sandy shore, and shimmers via tint without redraws.
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

  // ── Lighting ──────────────────────────────────────────────────────────

  /** Sculpted brightness for a tile: Lambert against the NW sun (smoothed
   * gradient) + broad ambient occlusion in hollows + per-tile noise. */
  private tileBright(x: number, y: number): number {
    const t = this.terrain;
    const cxw = x + 0.5;
    const cyw = y + 0.5;
    const R = 2.5;
    const gx = (t.heightAt(cxw + R, cyw) - t.heightAt(cxw - R, cyw)) / (2 * R);
    const gy = (t.heightAt(cxw, cyw + R) - t.heightAt(cxw, cyw - R)) / (2 * R);
    const nlen = Math.hypot(gx, gy, 1);
    const ndotl = (0.52 * gx + 0.52 * gy + 0.677) / nlen;
    let bright = 0.98 + (ndotl - 0.677) * 1.5;
    const relief =
      t.heightAt(cxw, cyw) -
      (t.heightAt(cxw - 4.5, cyw) +
        t.heightAt(cxw + 4.5, cyw) +
        t.heightAt(cxw, cyw - 4.5) +
        t.heightAt(cxw, cyw + 4.5)) /
        4;
    bright += Math.max(-0.09, Math.min(0.07, relief * 0.035));
    bright += tileNoise(x, y);
    return bright;
  }

  /** Lighting-tinted fill style for a surface on a tile (stripes, wear, sky fill). */
  private surfaceTint(x: number, y: number, s: Surface): number {
    let bright = this.tileBright(x, y);
    if (s === Surface.Fairway || s === Surface.Tee) {
      bright += Math.floor((x + y) / 2) % 2 === 0 ? 0.05 : -0.05;
    }
    bright = Math.max(0.42, Math.min(1.4, bright));
    let tint = shade(0xffffff, bright);
    if (bright < 0.9) tint = mix(tint, 0x5878a0, (0.9 - bright) * 0.5);
    else if (bright > 1.08) tint = mix(tint, 0xfff2d8, (bright - 1.08) * 0.7);
    if (s === Surface.Fairway || s === Surface.Green || s === Surface.Tee) {
      const wear = this.terrain.wearAt(x, y);
      if (wear > 0.03) tint = mix(tint, WEAR_COLOR, Math.min(0.75, wear * 0.8));
    }
    return tint;
  }

  private fillStyle(x: number, y: number, s: Surface) {
    const fill = this.textures.surfaces[s];
    return { texture: fill.texture, matrix: fill.matrix, color: this.surfaceTint(x, y, s) };
  }

  // ── Geometry ──────────────────────────────────────────────────────────

  private cornerPoints(x: number, y: number, flat?: number): [Pt, Pt, Pt, Pt] {
    const t = this.terrain;
    if (flat !== undefined) {
      return [
        worldToScreen(x, y, flat),
        worldToScreen(x + 1, y, flat),
        worldToScreen(x + 1, y + 1, flat),
        worldToScreen(x, y + 1, flat),
      ];
    }
    const [nw, ne, se, sw] = t.corners(x, y);
    return [
      worldToScreen(x, y, nw),
      worldToScreen(x + 1, y, ne),
      worldToScreen(x + 1, y + 1, se),
      worldToScreen(x, y + 1, sw),
    ];
  }

  /**
   * Trace a tile outline whose convex corners (both edge-neighbors a different
   * surface) are rounded inward through the edge midpoints — turning the tile
   * grid's 45° staircase into smooth curves. `scale` expands about the tile
   * centre (used for the water shore). Leaves a closed path ready to fill.
   */
  private roundedPath(g: Graphics, x: number, y: number, s: Surface, C: [Pt, Pt, Pt, Pt], scale: number): void {
    const t = this.terrain;
    const cx = (C[0].x + C[1].x + C[2].x + C[3].x) / 4;
    const cy = (C[0].y + C[1].y + C[2].y + C[3].y) / 4;
    const sc = (p: Pt): Pt => (scale === 1 ? p : { x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale });
    const NW = sc(C[0]);
    const NE = sc(C[1]);
    const SE = sc(C[2]);
    const SW = sc(C[3]);
    const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const mN = mid(NW, NE);
    const mE = mid(NE, SE);
    const mS = mid(SE, SW);
    const mW = mid(SW, NW);
    const same = (nx: number, ny: number): boolean => t.inBounds(nx, ny) && t.surfaceAt(nx, ny) === s;
    const sameN = same(x, y - 1);
    const sameE = same(x + 1, y);
    const sameS = same(x, y + 1);
    const sameW = same(x - 1, y);

    g.moveTo(mW.x, mW.y);
    // NW corner
    if (!sameW && !sameN) g.quadraticCurveTo(NW.x, NW.y, mN.x, mN.y);
    else {
      g.lineTo(NW.x, NW.y);
      g.lineTo(mN.x, mN.y);
    }
    // NE corner
    if (!sameN && !sameE) g.quadraticCurveTo(NE.x, NE.y, mE.x, mE.y);
    else {
      g.lineTo(NE.x, NE.y);
      g.lineTo(mE.x, mE.y);
    }
    // SE corner
    if (!sameE && !sameS) g.quadraticCurveTo(SE.x, SE.y, mS.x, mS.y);
    else {
      g.lineTo(SE.x, SE.y);
      g.lineTo(mS.x, mS.y);
    }
    // SW corner
    if (!sameS && !sameW) g.quadraticCurveTo(SW.x, SW.y, mW.x, mW.y);
    else {
      g.lineTo(SW.x, SW.y);
      g.lineTo(mW.x, mW.y);
    }
    g.closePath();
  }

  // ── Chunk redraw ──────────────────────────────────────────────────────

  private redrawChunk(idx: number): void {
    const g = this.chunks[idx];
    const wg = this.waterChunks[idx];
    g.clear();
    wg.clear();
    const cx = (idx % this.cw) * CHUNK;
    const cy = Math.floor(idx / this.cw) * CHUNK;
    const t = this.terrain;
    const x0 = cx;
    const y0 = cy;
    const x1 = Math.min(cx + CHUNK, t.w);
    const y1 = Math.min(cy + CHUNK, t.h);

    // Base: continuous rough under every land tile, plus map-edge skirts.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (t.surfaceAt(x, y) === Surface.Water) continue;
        const C = this.cornerPoints(x, y);
        g.poly([C[0].x, C[0].y, C[1].x, C[1].y, C[2].x, C[2].y, C[3].x, C[3].y]).fill(this.fillStyle(x, y, Surface.Rough));
        this.drawSkirt(g, x, y, C);
      }
    }

    // Higher surfaces as rounded blobs, low → high priority.
    for (const level of OVERLAY_LEVELS) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (t.surfaceAt(x, y) !== level) continue;
          const C = this.cornerPoints(x, y);
          this.roundedPath(g, x, y, level, C, 1);
          g.fill(this.fillStyle(x, y, level));
        }
      }
    }

    // Water: sandy shore ring only for shore tiles (those touching land), so
    // no ring is drawn under the pond interior where it would seam across
    // chunks. Drawn first as an under-layer, then the water fills on top.
    const isLand = (nx: number, ny: number) => t.inBounds(nx, ny) && t.surfaceAt(nx, ny) !== Surface.Water;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (t.surfaceAt(x, y) !== Surface.Water) continue;
        if (!isLand(x - 1, y) && !isLand(x + 1, y) && !isLand(x, y - 1) && !isLand(x, y + 1)) continue;
        const C = this.cornerPoints(x, y, t.minCorner(x, y));
        this.roundedPath(wg, x, y, Surface.Water, C, 1.18);
        wg.fill(SHORE_COLOR);
      }
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (t.surfaceAt(x, y) !== Surface.Water) continue;
        this.drawWaterFill(wg, x, y);
      }
    }

    // Ground detail: wildflower rough, clover flecks on fairway.
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const s = t.surfaceAt(x, y);
        if (s === Surface.Rough) this.drawRoughDetail(g, x, y);
        else if (s === Surface.Fairway) this.drawFairwayDetail(g, x, y);
      }
    }
  }

  private drawSkirt(g: Graphics, x: number, y: number, C: [Pt, Pt, Pt, Pt]): void {
    const t = this.terrain;
    if (y === t.h - 1) {
      const bSW = worldToScreen(x, y + 1, -1);
      const bSE = worldToScreen(x + 1, y + 1, -1);
      g.poly([C[3].x, C[3].y, C[2].x, C[2].y, bSE.x, bSE.y + HEIGHT_STEP, bSW.x, bSW.y + HEIGHT_STEP]).fill(0x6b543c);
    }
    if (x === t.w - 1) {
      const bNE = worldToScreen(x + 1, y, -1);
      const bSE = worldToScreen(x + 1, y + 1, -1);
      g.poly([C[1].x, C[1].y, C[2].x, C[2].y, bSE.x, bSE.y + HEIGHT_STEP, bNE.x, bNE.y + HEIGHT_STEP]).fill(0x57432f);
    }
  }

  private drawWaterFill(wg: Graphics, x: number, y: number): void {
    const t = this.terrain;
    const C = this.cornerPoints(x, y, t.minCorner(x, y));
    const fill = this.textures.surfaces[Surface.Water];
    const tint = shade(0xffffff, 0.96 + tileNoise(x, y));
    this.roundedPath(wg, x, y, Surface.Water, C, 1);
    wg.fill({ texture: fill.texture, matrix: fill.matrix, color: tint });
    // A couple of static wave glints; the layer tint animates them.
    if (hash2(x, y) > 0.5) {
      const u = 0.3 + hash2(x + 9, y) * 0.4;
      const v = 0.3 + hash2(x, y + 7) * 0.4;
      const wx = C[0].x + (C[2].x - C[0].x) * u + (C[1].x - C[3].x) * (v - 0.5) * 0.5;
      const wy = C[0].y + (C[2].y - C[0].y) * v;
      wg.moveTo(wx - 4, wy).quadraticCurveTo(wx, wy - 2.5, wx + 4, wy).stroke({ color: 0xaee0f4, width: 1.2, alpha: 0.7 });
    }
  }

  private drawRoughDetail(g: Graphics, x: number, y: number): void {
    const C = this.cornerPoints(x, y);
    const [pNW, pNE, pSE, pSW] = C;
    for (let s = 0; s < 4; s++) {
      const u = hash2(x * 4 + s, y * 7 + 13);
      if (u < 0.4) continue;
      const v = hash2(x * 9 + 3, y * 5 + s * 17);
      const px = pSW.x + (pNE.x - pSW.x) * (0.15 + u * 0.7);
      const py = pNW.y + (pSE.y - pNW.y) * (0.2 + v * 0.6);
      const tuftC = shade(0x5c8a3e, 0.82 + u * 0.38);
      for (let b = -1; b <= 1; b++) {
        g.moveTo(px + b * 1.4, py)
          .lineTo(px + b * 2 + 0.8, py - 2.6 - u * 1.7)
          .stroke({ color: tuftC, width: 1 });
      }
      const fh = hash2(x * 13 + s * 31, y * 11 + 7);
      if (fh > 0.88) {
        const fc = fh > 0.966 ? 0xf6e85c : fh > 0.925 ? 0xf4f4ee : 0xe89ac0;
        for (let k = 0; k < 3; k++) {
          const a = k * 2.1 + u * 3;
          g.circle(px + Math.cos(a) * 1.3, py - 2.8 + Math.sin(a) * 0.9, 0.85).fill(fc);
        }
        if (fc === 0xf4f4ee) g.circle(px, py - 2.8, 0.6).fill(0xf0d040);
      }
    }
  }

  private drawFairwayDetail(g: Graphics, x: number, y: number): void {
    const cf = hash2(x * 17 + 5, y * 19 + 2);
    if (cf <= 0.9) return;
    const C = this.cornerPoints(x, y);
    const [pNW, pNE, pSE, pSW] = C;
    const px = pSW.x + (pNE.x - pSW.x) * (0.3 + hash2(x, y + 3) * 0.4);
    const py = pNW.y + (pSE.y - pNW.y) * (0.35 + hash2(x + 5, y) * 0.3);
    g.circle(px, py, 0.7).fill({ color: 0xf0f0e4, alpha: 0.8 });
  }
}
