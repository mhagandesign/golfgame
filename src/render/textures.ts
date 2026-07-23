import { Container, Graphics, Matrix, Renderer as PixiRenderer, Text, TextStyle, Texture } from 'pixi.js';
import { Surface } from '../core/terrain/terrain';
import { ObjectKind } from '../core/game';
import { Rng } from '../core/sim/rng';
import { shade } from './colors';

/**
 * All painterly art is generated once at startup: surface textures are drawn
 * on offscreen canvases (used as repeating fills in the terrain chunks), and
 * scenery props are pre-rendered to textures via the GPU renderer.
 * No external asset files.
 */

export interface PropTexture {
  texture: Texture;
  /** Anchor so the sprite's origin sits at the prop's ground contact point. */
  ax: number;
  ay: number;
}

const TEX_SIZE = 256;

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function css(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const tex = Texture.from(canvas);
  tex.source.addressMode = 'repeat';
  return tex;
}

/** Scatter soft blotches to break up a flat base. */
function blotch(ctx: CanvasRenderingContext2D, rng: Rng, count: number, rMin: number, rMax: number, color: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, TEX_SIZE);
    const y = rng.range(0, TEX_SIZE);
    const r = rng.range(rMin, rMax);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, css(color, alpha));
    grad.addColorStop(1, css(color, 0));
    ctx.fillStyle = grad;
    // Draw wrapped so the texture tiles seamlessly.
    for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
      for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Short grass-blade flecks. */
function blades(ctx: CanvasRenderingContext2D, rng: Rng, count: number, len: number, colors: number[], alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, TEX_SIZE);
    const y = rng.range(0, TEX_SIZE);
    const a = rng.range(-0.5, 0.5) - Math.PI / 2;
    const l = len * rng.range(0.6, 1.4);
    ctx.strokeStyle = css(rng.pick(colors), alpha);
    ctx.lineWidth = rng.range(0.7, 1.4);
    for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
      for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  }
}

function dots(ctx: CanvasRenderingContext2D, rng: Rng, count: number, rMin: number, rMax: number, colors: number[], alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, TEX_SIZE);
    const y = rng.range(0, TEX_SIZE);
    const r = rng.range(rMin, rMax);
    ctx.fillStyle = css(rng.pick(colors), alpha);
    for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
      for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function surfaceCanvas(surface: Surface): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas();
  const rng = new Rng(1000 + surface * 17);
  switch (surface) {
    case Surface.Rough: {
      ctx.fillStyle = css(0x679447);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 34, 20, 60, 0x4e7a30, 0.85);
      blotch(ctx, rng, 26, 14, 42, 0x7cae54, 0.75);
      blades(ctx, rng, 1600, 4.5, [0x54823a, 0x6da04a, 0x8cbc60, 0x466f2e], 0.8);
      dots(ctx, rng, 24, 0.8, 1.6, [0xd8e070, 0xe8f0f0], 0.6); // clover flecks
      break;
    }
    case Surface.Fairway: {
      ctx.fillStyle = css(0x87bd51);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 26, 16, 46, 0x6fa63e, 0.7);
      blotch(ctx, rng, 20, 12, 34, 0x9ad062, 0.7);
      blades(ctx, rng, 2000, 2.6, [0x74a844, 0x90c257, 0xa4d66e], 0.65);
      break;
    }
    case Surface.Green: {
      ctx.fillStyle = css(0xa2d474);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 20, 14, 38, 0x8fc25e, 0.6);
      dots(ctx, rng, 3200, 0.4, 0.9, [0x94c464, 0xb0de82, 0xbce892], 0.55);
      break;
    }
    case Surface.Tee: {
      ctx.fillStyle = css(0x93c75f);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 18, 12, 34, 0x7fb24c, 0.65);
      blades(ctx, rng, 1400, 2.4, [0x82b64e, 0xa0d26a], 0.6);
      break;
    }
    case Surface.Sand: {
      ctx.fillStyle = css(0xe6d6a0);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 28, 16, 50, 0xd2bc80, 0.8);
      blotch(ctx, rng, 18, 12, 32, 0xf4e8bc, 0.8);
      dots(ctx, rng, 3600, 0.35, 0.9, [0xccb476, 0xbfa96c, 0xf6ecc4], 0.6);
      dots(ctx, rng, 70, 1, 2.2, [0xab9459], 0.6); // pits
      break;
    }
    case Surface.Water: {
      ctx.fillStyle = css(0x3f83b8);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 24, 26, 74, 0x2c648f, 0.8);
      blotch(ctx, rng, 20, 18, 52, 0x549cd0, 0.75);
      // Soft horizontal current streaks.
      ctx.strokeStyle = css(0x74b4e0, 0.5);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 22; i++) {
        const y = rng.range(0, TEX_SIZE);
        const x = rng.range(0, TEX_SIZE);
        const l = rng.range(14, 40);
        for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
          ctx.beginPath();
          ctx.moveTo(x - l, y + oy);
          ctx.quadraticCurveTo(x, y + oy - 2, x + l, y + oy);
          ctx.stroke();
        }
      }
      break;
    }
    case Surface.Path: {
      ctx.fillStyle = css(0xc9b78a);
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      blotch(ctx, rng, 24, 14, 42, 0xb29e6c, 0.8);
      dots(ctx, rng, 340, 1, 2.8, [0xab9668, 0xdccca0, 0x9c8858], 0.75);
      dots(ctx, rng, 1200, 0.4, 1, [0xb7a476, 0xd8c898], 0.6);
      break;
    }
  }
  return canvas;
}

// ── Prop drawing ──────────────────────────────────────────────────────────

function canopy(g: Graphics, rng: Rng, cx: number, cy: number, r: number, dark: number, mid: number, light: number): void {
  // Three big lobes with a shaded base — reads as a full leafy crown.
  const lobes = [
    { x: cx - r * 0.55, y: cy + r * 0.15, s: 0.72 },
    { x: cx + r * 0.55, y: cy + r * 0.2, s: 0.68 },
    { x: cx, y: cy - r * 0.45, s: 0.8 },
    { x: cx + r * 0.05, y: cy + r * 0.35, s: 0.62 },
  ];
  for (const l of lobes) g.circle(l.x, l.y, r * l.s).fill(dark);
  for (const l of lobes) {
    g.circle(l.x - r * 0.12, l.y - r * 0.14, r * l.s * 0.82).fill(mid);
  }
  // Sun-side highlight clusters (NW).
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-2.6, -0.7);
    const d = rng.range(0.25, 0.8) * r;
    g.circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, r * rng.range(0.18, 0.3)).fill(light);
  }
  g.circle(cx - r * 0.35, cy - r * 0.5, r * 0.16).fill(shade(light, 1.15));
  // Under-canopy shadow pockets (SE).
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0.3, 1.9);
    const d = rng.range(0.35, 0.8) * r;
    g.circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r * rng.range(0.16, 0.26)).fill(shade(dark, 0.8));
  }
}

// ── Isometric box helpers (2:1 diamond footprint, vertical extrusion) ─────

interface IsoBox {
  /** N/E/S/W ground corners in local px, origin at footprint centre. */
  N: [number, number];
  E: [number, number];
  S: [number, number];
  W: [number, number];
}

function isoBox(halfW: number): IsoBox {
  return { N: [0, -halfW / 2], E: [halfW, 0], S: [0, halfW / 2], W: [-halfW, 0] };
}

/** Quad on a wall face from p0→p1, spanning [t0,t1] horizontally and [b,t] vertically (b/t = px above ground). */
function faceQuad(p0: [number, number], p1: [number, number], t0: number, t1: number, b: number, tt: number): number[] {
  const ax = p0[0] + (p1[0] - p0[0]) * t0;
  const ay = p0[1] + (p1[1] - p0[1]) * t0;
  const bx = p0[0] + (p1[0] - p0[0]) * t1;
  const by = p0[1] + (p1[1] - p0[1]) * t1;
  return [ax, ay - b, bx, by - b, bx, by - tt, ax, ay - tt];
}

function propShadow(g: Graphics, rx: number, ry: number, ox = 4): void {
  g.ellipse(ox, 1, rx, ry).fill({ color: 0x1c2b14, alpha: 0.28 });
}

function drawTreeProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 15, 5.5);
  const lean = rng.range(-2, 2);
  g.moveTo(-2.5, 0).bezierCurveTo(-2, -8, lean - 2, -12, lean - 1.5, -16)
    .lineTo(lean + 1.5, -16).bezierCurveTo(lean + 2, -12, 2, -8, 2.5, 0).closePath().fill(0x6e4f33);
  g.moveTo(-1.5, 0).bezierCurveTo(-1, -7, lean - 1, -11, lean - 0.5, -15).lineTo(lean + 0.5, -15)
    .bezierCurveTo(lean + 1, -11, 1, -7, 1.5, 0).closePath().fill(0x84613f);
  canopy(g, rng, lean, -27, 15 + rng.range(-2, 3), 0x3e7030, 0x4f8a3c, 0x6fae52);
}

function drawPineProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 12, 4.5);
  g.rect(-2, -10, 4, 10).fill(0x6e4f33);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const w = 16 - t * 10 + rng.range(-1, 1);
    const yBase = -8 - i * 9;
    const yTip = yBase - 13;
    g.poly([-w, yBase, w, yBase, 0, yTip]).fill(i % 2 === 0 ? 0x3a6b38 : 0x447c41);
    // Sunlit left edge.
    g.poly([-w, yBase, -w * 0.25, yBase - (yBase - yTip) * 0.55, 0, yTip]).fill({ color: 0x5c9455, alpha: 0.7 });
  }
}

function drawBushProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 11, 4, 3);
  g.ellipse(0, -5, 11, 7).fill(0x4a7f40);
  for (let i = 0; i < 5; i++) {
    g.circle(rng.range(-7, 7), rng.range(-9, -3), rng.range(3.5, 5.5)).fill(rng.next() < 0.5 ? 0x55924a : 0x639f56);
  }
  g.circle(-4, -9, 3.4).fill(0x74af62);
}

function drawRockProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 10, 3.6, 3);
  g.poly([-10, -2, -6, -9, 2, -11, 9, -6, 10, -1, 4, 2, -5, 2]).fill(0x8d8d85);
  g.poly([-6, -9, 2, -11, 5, -5, -3, -3]).fill(0xa8a89e);
  g.poly([5, -5, 9, -6, 10, -1, 4, 2]).fill(0x77776f);
}

function drawFlowersProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 11, 4, 2);
  g.ellipse(0, -3, 12, 6).fill(0x5b9449);
  const palette = [0xe86fa8, 0xf0e04e, 0xe8654f, 0xffffff, 0xc06ae0];
  for (let i = 0; i < 9; i++) {
    const x = rng.range(-9, 9);
    const y = rng.range(-7, 0);
    const c = rng.pick(palette);
    for (let p = 0; p < 4; p++) {
      const a = (p / 4) * Math.PI * 2 + rng.range(0, 1);
      g.circle(x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.3, 1).fill(c);
    }
    g.circle(x, y, 0.8).fill(0xf8e880);
  }
}

function drawClubhouseProp(g: Graphics): void {
  const box = isoBox(46);
  const H = 30; // wall height
  const R = 26; // roof rise
  const { N, E, S, W } = box;
  propShadow(g, 58, 20, 10);

  // Walls: SW face (shaded) and SE face (lit).
  g.poly([...W, ...S, S[0], S[1] - H, W[0], W[1] - H]).fill(0x94714a);
  g.poly([...S, ...E, E[0], E[1] - H, S[0], S[1] - H]).fill(0xb68e60);
  // Clapboard courses.
  for (let i = 1; i < 5; i++) {
    const y = i * (H / 5);
    g.moveTo(W[0], W[1] - y).lineTo(S[0], S[1] - y).stroke({ color: 0x7e5e3c, width: 1, alpha: 0.55 });
    g.moveTo(S[0], S[1] - y).lineTo(E[0], E[1] - y).stroke({ color: 0x9c7648, width: 1, alpha: 0.5 });
  }
  // Stone footing.
  g.poly([...W, ...S, S[0], S[1] - 4, W[0], W[1] - 4]).fill({ color: 0x8a8478, alpha: 0.9 });
  g.poly([...S, ...E, E[0], E[1] - 4, S[0], S[1] - 4]).fill({ color: 0x9a9488, alpha: 0.9 });

  // Door with frame + awning on the SW face.
  g.poly(faceQuad(W, S, 0.38, 0.62, 0, 20)).fill(0x3c2a18);
  g.poly(faceQuad(W, S, 0.41, 0.59, 0, 18)).fill(0x5a4028);
  g.poly(faceQuad(W, S, 0.32, 0.68, 19, 25)).fill(0x4c7a3c);
  // Windows with frames on the SE face.
  for (const [t0, t1] of [
    [0.16, 0.36],
    [0.56, 0.76],
  ] as const) {
    g.poly(faceQuad(S, E, t0 - 0.02, t1 + 0.02, 9, 22)).fill(0xf0ead8);
    g.poly(faceQuad(S, E, t0, t1, 10.5, 20.5)).fill(0xbcd8e8);
    g.poly(faceQuad(S, E, t0, t1, 10.5, 15)).fill({ color: 0xffffff, alpha: 0.35 });
  }

  // Pyramid roof with eaves overhang.
  const ov = 1.14;
  const Wo: [number, number] = [W[0] * ov, W[1] * ov - H];
  const Eo: [number, number] = [E[0] * ov, E[1] * ov - H];
  const So: [number, number] = [S[0] * ov, S[1] * ov - H];
  const No: [number, number] = [N[0] * ov, N[1] * ov - H];
  const apex: [number, number] = [0, -H - R];
  g.poly([...Wo, ...So, ...apex]).fill(0x6a3d2c); // SW slope (shaded)
  g.poly([...So, ...Eo, ...apex]).fill(0x8a5238); // SE slope (lit)
  g.poly([...No, ...Eo, ...apex]).fill(0x54301f); // NE slope edge (dark)
  // Shingle courses on the visible slopes.
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const lerp2 = (a: [number, number], b: [number, number]): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const w1 = lerp2(Wo, apex);
    const s1 = lerp2(So, apex);
    const e1 = lerp2(Eo, apex);
    g.moveTo(w1[0], w1[1]).lineTo(s1[0], s1[1]).stroke({ color: 0x5a3021, width: 1, alpha: 0.7 });
    g.moveTo(s1[0], s1[1]).lineTo(e1[0], e1[1]).stroke({ color: 0x714232, width: 1, alpha: 0.7 });
  }
  // Eave highlights.
  g.moveTo(Wo[0], Wo[1]).lineTo(So[0], So[1]).lineTo(Eo[0], Eo[1]).stroke({ color: 0xa06a48, width: 1.6 });

  // Chimney + pennant.
  g.rect(16, -H - R + 10, 7, 14).fill(0x7a5a48);
  g.rect(15.4, -H - R + 8.4, 8.2, 3).fill(0x5c4034);
  g.rect(-0.8, -H - R - 16, 1.6, 16).fill(0xf0f0f0);
  g.poly([0.8, -H - R - 16, 12, -H - R - 12.5, 0.8, -H - R - 9]).fill(0xd9534f);
}

function drawKioskProp(g: Graphics, body: number, awningA: number, awningB: number, sign: string): void {
  const { N, E, S, W } = isoBox(15);
  const H = 18;
  propShadow(g, 19, 7, 3);
  // Walls.
  g.poly([...W, ...S, S[0], S[1] - H, W[0], W[1] - H]).fill(shade(body, 0.78));
  g.poly([...S, ...E, E[0], E[1] - H, S[0], S[1] - H]).fill(body);
  // Serving hatch on the lit SE face.
  g.poly(faceQuad(S, E, 0.2, 0.8, 8, 15)).fill(0x241f18);
  g.poly(faceQuad(S, E, 0.2, 0.8, 7, 8.5)).fill(shade(body, 1.25)); // counter
  // Striped awning: a sloped canopy over both visible faces.
  const stripes = 5;
  const awn = (p0: [number, number], p1: [number, number], out: number) => {
    for (let i = 0; i < stripes; i++) {
      const t0 = i / stripes;
      const t1 = (i + 1) / stripes;
      const q = faceQuad(p0, p1, t0, t1, H, H + 6);
      // Push the lower edge outward for slope.
      q[1] += 4;
      q[3] += 4;
      q[0] *= 1 + out;
      q[2] *= 1 + out;
      g.poly(q).fill(i % 2 === 0 ? awningA : awningB);
    }
  };
  awn(W, S, 0.18);
  awn(S, E, 0.18);
  // Flat cap.
  const capH = H + 6;
  g.poly([N[0], N[1] - capH, E[0], E[1] - capH, S[0], S[1] - capH, W[0], W[1] - capH]).fill(shade(body, 0.9));
  const label = new Text({ text: sign, style: new TextStyle({ fontSize: 11 }) });
  label.anchor.set(0.5);
  label.position.set(0, -capH - 9);
  g.addChild(label);
}

// ── Public atlas ──────────────────────────────────────────────────────────

export class GameTextures {
  surfaces!: Record<Surface, { texture: Texture; matrix: Matrix }>;
  private props = new Map<string, PropTexture>();

  static build(renderer: PixiRenderer): GameTextures {
    const t = new GameTextures();
    t.surfaces = {} as GameTextures['surfaces'];
    for (const s of [Surface.Rough, Surface.Fairway, Surface.Green, Surface.Tee, Surface.Sand, Surface.Water, Surface.Path]) {
      t.surfaces[s] = { texture: toTexture(surfaceCanvas(s)), matrix: new Matrix(0.5, 0, 0, 0.5, 0, 0) };
    }

    const bake = (key: string, draw: (g: Graphics) => void) => {
      const g = new Graphics();
      draw(g);
      const container = new Container();
      container.addChild(g);
      const bounds = container.getLocalBounds();
      const texture = renderer.generateTexture({ target: container, resolution: 2, antialias: true });
      t.props.set(key, {
        texture,
        ax: bounds.width === 0 ? 0.5 : -bounds.minX / bounds.width,
        ay: bounds.height === 0 ? 1 : -bounds.minY / bounds.height,
      });
      container.destroy({ children: true });
    };

    for (let v = 0; v < 3; v++) bake(`tree-${v}`, (g) => drawTreeProp(g, 50 + v * 13));
    for (let v = 0; v < 2; v++) bake(`pine-${v}`, (g) => drawPineProp(g, 90 + v * 7));
    for (let v = 0; v < 2; v++) bake(`bush-${v}`, (g) => drawBushProp(g, 130 + v * 11));
    bake('rock-0', (g) => drawRockProp(g, 170));
    bake('flowers-0', (g) => drawFlowersProp(g, 210));
    bake('clubhouse-0', (g) => drawClubhouseProp(g));
    bake('drinks-0', (g) => drawKioskProp(g, 0x3c78b4, 0x4a90d9, 0xe8f0f8, '🥤'));
    bake('snacks-0', (g) => drawKioskProp(g, 0xb46a3c, 0xd9534f, 0xf8f0e0, '🌭'));
    bake('toilet-0', (g) => drawKioskProp(g, 0x5a7a62, 0x6a9a72, 0xe0e8e2, '🚻'));
    return t;
  }

  variantCount(kind: ObjectKind): number {
    if (kind === 'tree') return 3;
    if (kind === 'pine' || kind === 'bush') return 2;
    return 1;
  }

  prop(kind: ObjectKind, id: number): PropTexture {
    const v = id % this.variantCount(kind);
    return this.props.get(`${kind}-${v}`) ?? this.props.get(`${kind}-0`)!;
  }
}
