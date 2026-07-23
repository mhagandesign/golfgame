import { Container, Graphics, Matrix, Renderer as PixiRenderer, Text, TextStyle, Texture } from 'pixi.js';
import { Surface } from '../core/terrain/terrain';
import { ObjectKind } from '../core/game';
import { Rng } from '../core/sim/rng';
import { mix, shade } from './colors';
import { fbm } from './noise';

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
  /** Base render scale (pre-rendered sprites are larger than the baked art). */
  scale?: number;
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

/**
 * Per-pixel FBM base layer: blends dark→light across a macro patch field and
 * a fine grain field, with an optional dry/yellowed patch tint field.
 */
function fbmBase(
  ctx: CanvasRenderingContext2D,
  seed: number,
  dark: number,
  light: number,
  opts: { macroFreq?: number; grainFreq?: number; grainAmt?: number; dryColor?: number; dryAmt?: number } = {},
): void {
  const { macroFreq = 5, grainFreq = 40, grainAmt = 0.45, dryColor, dryAmt = 0 } = opts;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const data = img.data;
  for (let y = 0; y < TEX_SIZE; y++) {
    const v = y / TEX_SIZE;
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const macro = fbm(u, v, 4, macroFreq, seed);
      const grain = fbm(u, v, 2, grainFreq, seed + 991);
      let t = macro * (1 - grainAmt) + grain * grainAmt;
      t = Math.max(0, Math.min(1, (t - 0.5) * 1.5 + 0.5));
      let c = mix(dark, light, t);
      if (dryColor !== undefined && dryAmt > 0) {
        const dry = fbm(u, v, 3, 3, seed + 555);
        if (dry > 0.6) c = mix(c, dryColor, Math.min(1, (dry - 0.6) * 2.5) * dryAmt);
      }
      const i = (y * TEX_SIZE + x) * 4;
      data[i] = (c >> 16) & 0xff;
      data[i + 1] = (c >> 8) & 0xff;
      data[i + 2] = c & 0xff;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Raked-sand ripple bands, warped by noise like a groomed bunker. */
function sandRipples(ctx: CanvasRenderingContext2D, seed: number, amp: number): void {
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const data = img.data;
  for (let y = 0; y < TEX_SIZE; y++) {
    const v = y / TEX_SIZE;
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const warp = fbm(u, v, 3, 4, seed) * 2.2;
      const band = Math.sin((u + v * 0.4 + warp) * Math.PI * 2 * 9);
      const d = band * amp;
      const i = (y * TEX_SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, data[i] + d));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + d));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + d * 0.8));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Bright caustic webbing over water. */
function waterCaustics(ctx: CanvasRenderingContext2D, seed: number): void {
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const data = img.data;
  for (let y = 0; y < TEX_SIZE; y++) {
    const v = y / TEX_SIZE;
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = x / TEX_SIZE;
      const n = fbm(u, v, 4, 7, seed);
      // Ridged: bright thin filaments where the field crosses its midline.
      const ridge = Math.pow(1 - Math.abs(n - 0.5) * 2, 6);
      const glint = ridge * 95;
      const i = (y * TEX_SIZE + x) * 4;
      data[i] = Math.min(255, data[i] + glint * 0.55);
      data[i + 1] = Math.min(255, data[i + 1] + glint * 0.8);
      data[i + 2] = Math.min(255, data[i + 2] + glint);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Directional grass blades whose density follows a clumping field. */
function bladePass(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  seed: number,
  count: number,
  len: number,
  colors: number[],
  alpha: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, TEX_SIZE);
    const y = rng.range(0, TEX_SIZE);
    const clump = fbm(x / TEX_SIZE, y / TEX_SIZE, 3, 6, seed + 777);
    if (clump < 0.38) continue; // bare-ish patches
    const a = -Math.PI / 2 + rng.gaussian(0, 0.35);
    const l = len * (0.5 + clump) * rng.range(0.6, 1.3);
    ctx.strokeStyle = css(rng.pick(colors), alpha * (0.5 + clump * 0.5));
    ctx.lineWidth = rng.range(0.6, 1.3);
    for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
      for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + 1, y + oy - l * 0.6, x + ox + Math.cos(a) * l * 0.5 + 2, y + oy - l);
        ctx.stroke();
      }
    }
  }
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
      fbmBase(ctx, 11, 0x4a7029, 0x84b055, { macroFreq: 4, grainFreq: 48, grainAmt: 0.4, dryColor: 0x96a04c, dryAmt: 0.5 });
      bladePass(ctx, rng, 11, 2600, 5, [0x3f6322, 0x5c8a38, 0x79aa4e, 0x8fbc60], 0.7);
      dots(ctx, rng, 26, 0.7, 1.4, [0xd8e070, 0xe8f0f0, 0xd88ab0], 0.55); // clover & tiny wildflowers
      break;
    }
    case Surface.Fairway: {
      fbmBase(ctx, 23, 0x699e37, 0x9ccb60, { macroFreq: 6, grainFreq: 56, grainAmt: 0.5, dryColor: 0x8ca846, dryAmt: 0.25 });
      bladePass(ctx, rng, 23, 2200, 2.6, [0x649a34, 0x84b84c, 0xa0d068], 0.5);
      break;
    }
    case Surface.Green: {
      fbmBase(ctx, 37, 0x8cc05e, 0xb4e288, { macroFreq: 7, grainFreq: 70, grainAmt: 0.55 });
      dots(ctx, rng, 2600, 0.35, 0.75, [0x86b858, 0xbee892, 0xa8d878], 0.4);
      break;
    }
    case Surface.Tee: {
      fbmBase(ctx, 41, 0x76ab42, 0xa6d66e, { macroFreq: 6, grainFreq: 60, grainAmt: 0.5 });
      bladePass(ctx, rng, 41, 1500, 2.2, [0x6ea23e, 0x93c65b], 0.45);
      break;
    }
    case Surface.Sand: {
      fbmBase(ctx, 53, 0xcdb478, 0xf2e6ba, { macroFreq: 4, grainFreq: 64, grainAmt: 0.5 });
      sandRipples(ctx, 53, 9);
      dots(ctx, rng, 2400, 0.3, 0.8, [0xbfa96c, 0xf8eecb, 0xb69f61], 0.45);
      dots(ctx, rng, 46, 0.9, 1.8, [0xa08a50], 0.5); // pits
      break;
    }
    case Surface.Water: {
      fbmBase(ctx, 67, 0x1e4c74, 0x3d81b4, { macroFreq: 3, grainFreq: 12, grainAmt: 0.2 });
      waterCaustics(ctx, 67);
      break;
    }
    case Surface.Path: {
      fbmBase(ctx, 79, 0xa89460, 0xd8c89c, { macroFreq: 5, grainFreq: 48, grainAmt: 0.5 });
      // Pebbles with a lit top edge.
      for (let i = 0; i < 260; i++) {
        const x = rng.range(0, TEX_SIZE);
        const y = rng.range(0, TEX_SIZE);
        const r = rng.range(1, 2.6);
        const base = rng.pick([0xa08c5c, 0x998455, 0xb4a070]);
        for (const ox of [-TEX_SIZE, 0, TEX_SIZE]) {
          for (const oy of [-TEX_SIZE, 0, TEX_SIZE]) {
            ctx.fillStyle = css(base, 0.8);
            ctx.beginPath();
            ctx.ellipse(x + ox, y + oy, r, r * 0.75, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = css(0xe4d6ac, 0.55);
            ctx.beginPath();
            ctx.ellipse(x + ox - r * 0.2, y + oy - r * 0.3, r * 0.55, r * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
  }
  return canvas;
}

/** Surface names for the drop-in texture override files. */
const SURFACE_FILE_NAMES: Record<Surface, string> = {
  [Surface.Rough]: 'rough',
  [Surface.Fairway]: 'fairway',
  [Surface.Green]: 'green',
  [Surface.Tee]: 'tee',
  [Surface.Sand]: 'sand',
  [Surface.Water]: 'water',
  [Surface.Path]: 'path',
};

/**
 * Pre-rendered prop sprites in `public/sprites/<key>.png` (e.g. Reiner's
 * Tilesets' Blender renders) replace the baked procedural props. Each entry
 * sets the ground-contact anchor and base scale for that sprite family.
 */
const PROP_OVERRIDES: Record<string, { ax?: number; ay: number; scale: number }> = {
  'clubhouse-0': { ax: 0.413, ay: 0.775, scale: 0.52 },
  'drinks-0': { ax: 0.405, ay: 0.799, scale: 0.21 },
  'snacks-0': { ax: 0.405, ay: 0.786, scale: 0.21 },
  'toilet-0': { ax: 0.405, ay: 0.774, scale: 0.21 },
  'tree-0': { ay: 0.88, scale: 0.88 },
  'tree-1': { ay: 0.9, scale: 0.85 }, // columnar cypress
  'tree-2': { ay: 0.88, scale: 0.88 },
  'tree-3': { ay: 0.88, scale: 0.85 },
  'pine-0': { ay: 0.9, scale: 0.92 },
  'pine-1': { ay: 0.9, scale: 0.92 },
  'bush-0': { ay: 0.84, scale: 0.5 },
  'bush-1': { ay: 0.84, scale: 0.5 },
};

async function loadPropOverride(key: string): Promise<PropTexture | null> {
  const spec = PROP_OVERRIDES[key];
  if (!spec) return null;
  try {
    const url = `/sprites/${key}.png`;
    const resp = await fetch(url, { method: 'HEAD' });
    if (!resp.ok || !(resp.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return { texture: Texture.from(canvas), ax: spec.ax ?? 0.5, ay: spec.ay, scale: spec.scale };
  } catch {
    return null;
  }
}

/**
 * Optional real-photo override: if `public/textures/<name>.jpg` (or .png)
 * exists — e.g. a CC0 texture from ambientCG or Poly Haven — it replaces the
 * generated art for that surface. See public/textures/README.md.
 */
async function loadOverride(name: string): Promise<Texture | null> {
  for (const ext of ['jpg', 'png', 'webp']) {
    try {
      const resp = await fetch(`/textures/${name}.${ext}`, { method: 'HEAD' });
      if (!resp.ok) continue;
      const type = resp.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) continue; // dev servers 200 missing files with index.html
      const img = new Image();
      img.src = `/textures/${name}.${ext}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = TEX_SIZE * 2;
      canvas.height = TEX_SIZE * 2;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      return toTexture(canvas);
    } catch {
      // fall through to the next extension / generated art
    }
  }
  return null;
}

// ── Prop drawing ──────────────────────────────────────────────────────────

function canopy(g: Graphics, rng: Rng, cx: number, cy: number, r: number, dark: number, mid: number, light: number): void {
  // Lobed silhouette base…
  const lobes = [
    { x: cx - r * 0.55, y: cy + r * 0.15, s: 0.72 },
    { x: cx + r * 0.55, y: cy + r * 0.2, s: 0.68 },
    { x: cx, y: cy - r * 0.45, s: 0.8 },
    { x: cx + r * 0.05, y: cy + r * 0.35, s: 0.62 },
  ];
  for (const l of lobes) g.circle(l.x, l.y, r * l.s).fill(shade(dark, 0.85));
  // …then hundreds of leaf stipples shaded by a NW keylight for a rendered look.
  const lightDir = { x: -0.62, y: -0.78 };
  for (let i = 0; i < 300; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * r * 1.05;
    const px = cx + Math.cos(a) * d;
    const py = cy + Math.sin(a) * d * 0.92;
    // Lighting: distance along the light direction plus sphere falloff.
    const lx = (px - cx) / r;
    const ly = (py - cy) / r;
    let lit = 0.5 + (lx * lightDir.x + ly * lightDir.y) * 0.45 - d / r * 0.12 + rng.gaussian(0, 0.1);
    lit = Math.max(0, Math.min(1, lit));
    const c = lit > 0.72 ? mix(light, 0xd0e878, (lit - 0.72) * 2) : lit > 0.4 ? mix(mid, light, (lit - 0.4) / 0.32) : mix(shade(dark, 0.8), mid, lit / 0.4);
    g.circle(px, py, rng.range(0.9, 2)).fill(c);
  }
  // Crown glint + under-canopy core shadow.
  g.circle(cx - r * 0.4, cy - r * 0.55, r * 0.13).fill(shade(light, 1.2));
  g.ellipse(cx + r * 0.15, cy + r * 0.42, r * 0.42, r * 0.24).fill({ color: shade(dark, 0.7), alpha: 0.55 });
}

/** Tall columnar poplar/cypress, like the reference image's windbreaks. */
function drawPoplarProp(g: Graphics, seed: number): void {
  const rng = new Rng(seed);
  propShadow(g, 9, 4);
  g.rect(-1.5, -8, 3, 8).fill(0x6e4f33);
  const h = 46 + rng.range(-4, 6);
  const w = 8.5 + rng.range(-1, 1.5);
  // Silhouette.
  g.ellipse(0, -8 - h / 2, w, h / 2).fill(0x2f5c2b);
  // Leaf stipples with side light.
  for (let i = 0; i < 200; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next());
    const px = Math.cos(a) * d * w * 0.92;
    const py = -8 - h / 2 + Math.sin(a) * d * h * 0.46;
    let lit = 0.5 - px / w * 0.5 - (py + 8 + h / 2) / h * 0.15 + rng.gaussian(0, 0.12);
    lit = Math.max(0, Math.min(1, lit));
    const c = lit > 0.62 ? 0x66a44c : lit > 0.35 ? 0x477c3a : 0x35602c;
    g.circle(px, py, rng.range(0.8, 1.6)).fill(c);
  }
  g.circle(-w * 0.35, -8 - h * 0.78, 1.6).fill(0x84c060);
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
  // Soft two-layer shadow cast toward the south-east (sun from the NW).
  g.ellipse(ox + rx * 0.3, 2, rx * 1.35, ry * 0.9).fill({ color: 0x1c2b14, alpha: 0.14 });
  g.ellipse(ox + rx * 0.15, 1, rx, ry * 0.75).fill({ color: 0x18260f, alpha: 0.26 });
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

  static async build(renderer: PixiRenderer): Promise<GameTextures> {
    const t = new GameTextures();
    t.surfaces = {} as GameTextures['surfaces'];
    for (const s of [Surface.Rough, Surface.Fairway, Surface.Green, Surface.Tee, Surface.Sand, Surface.Water, Surface.Path]) {
      const override = await loadOverride(SURFACE_FILE_NAMES[s]);
      t.surfaces[s] = {
        texture: override ?? toTexture(surfaceCanvas(s)),
        matrix: override ? new Matrix(0.25, 0, 0, 0.25, 0, 0) : new Matrix(0.5, 0, 0, 0.5, 0, 0),
      };
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
    bake('tree-3', (g) => drawPoplarProp(g, 260));
    for (let v = 0; v < 2; v++) bake(`pine-${v}`, (g) => drawPineProp(g, 90 + v * 7));
    for (let v = 0; v < 2; v++) bake(`bush-${v}`, (g) => drawBushProp(g, 130 + v * 11));
    bake('rock-0', (g) => drawRockProp(g, 170));
    bake('flowers-0', (g) => drawFlowersProp(g, 210));
    bake('clubhouse-0', (g) => drawClubhouseProp(g));
    bake('drinks-0', (g) => drawKioskProp(g, 0x3c78b4, 0x4a90d9, 0xe8f0f8, '🥤'));
    bake('snacks-0', (g) => drawKioskProp(g, 0xb46a3c, 0xd9534f, 0xf8f0e0, '🌭'));
    bake('toilet-0', (g) => drawKioskProp(g, 0x5a7a62, 0x6a9a72, 0xe0e8e2, '🚻'));

    // Pre-rendered sprite overrides (see public/sprites/) trump the baked art.
    for (const key of Object.keys(PROP_OVERRIDES)) {
      const override = await loadPropOverride(key);
      if (override) t.props.set(key, override);
    }
    return t;
  }

  variantCount(kind: ObjectKind): number {
    if (kind === 'tree') return 4;
    if (kind === 'pine' || kind === 'bush') return 2;
    return 1;
  }

  prop(kind: ObjectKind, id: number): PropTexture {
    const v = id % this.variantCount(kind);
    return this.props.get(`${kind}-${v}`) ?? this.props.get(`${kind}-0`)!;
  }
}
