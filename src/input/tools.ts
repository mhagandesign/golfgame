import { Game, ObjectKind, OBJECT_COSTS, SURFACE_COSTS, TERRAFORM_COST_PER_VERTEX } from '../core/game';
import { Surface, SURFACE_NAMES, VertexChange } from '../core/terrain/terrain';
import { Pt, holePar, holeLengthYards, Hole } from '../core/course/course';
import { Renderer } from '../render/renderer';
import { worldToScreen } from '../render/iso';

export type Tool =
  | { kind: 'pointer' }
  | { kind: 'raise' }
  | { kind: 'lower' }
  | { kind: 'smooth' }
  | { kind: 'paint'; surface: Surface }
  | { kind: 'object'; object: ObjectKind }
  | { kind: 'hole' }
  | { kind: 'bulldoze' };

type UndoEntry =
  | { kind: 'terraform'; changes: VertexChange[]; cost: number }
  | { kind: 'paint'; tiles: Array<{ x: number; y: number; from: Surface; to: Surface }>; cost: number }
  | { kind: 'object'; id: number; cost: number };

export interface ToolCallbacks {
  setStatus(text: string): void;
  toast(text: string): void;
  onCourseChanged(): void;
  onInspect(text: string): void;
}

const GREEN_RADIUS = 2.4;

export class ToolController {
  tool: Tool = { kind: 'pointer' };
  /** Hole under construction. */
  draft: { tee: Pt; waypoints: Pt[]; placingGreen: boolean } | null = null;

  private undoStack: UndoEntry[] = [];
  private panning = false;
  private spaceHeld = false;
  private painting = false;
  private paintStroke: Array<{ x: number; y: number; from: Surface; to: Surface }> = [];
  private paintStrokeCost = 0;
  private lastVertex: Pt | null = null;
  private lastPointer = { x: 0, y: 0 };
  private hover: Pt = { x: 0, y: 0 };

  constructor(
    private game: Game,
    private renderer: Renderer,
    private cb: ToolCallbacks,
  ) {}

  setGame(game: Game): void {
    this.game = game;
    this.undoStack = [];
    this.draft = null;
  }

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceHeld = false;
    });
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool.kind !== 'hole') this.cancelDraft();
    this.cb.setStatus(this.toolHint());
  }

  toolHint(): string {
    switch (this.tool.kind) {
      case 'pointer':
        return 'Inspect: click a golfer. Drag with right mouse (or hold Space) to pan, scroll to zoom.';
      case 'raise':
        return `Raise land — click or drag over corners ($${TERRAFORM_COST_PER_VERTEX}/corner). Ctrl+Z to undo.`;
      case 'lower':
        return `Lower land — click or drag over corners ($${TERRAFORM_COST_PER_VERTEX}/corner). Ctrl+Z to undo.`;
      case 'smooth':
        return 'Smooth hills — click to soften the terrain around the cursor.';
      case 'paint':
        return `Paint ${SURFACE_NAMES[this.tool.surface]} ($${SURFACE_COSTS[this.tool.surface]}/tile) — click and drag. Water needs flat ground.`;
      case 'object':
        return `Place ${this.tool.object} ($${OBJECT_COSTS[this.tool.object]}). Click to build.`;
      case 'hole': {
        if (!this.draft) return 'Hole designer: click to place the TEE for a new hole.';
        if (this.draft.placingGreen) return 'Click to place the GREEN & cup and finish the hole. Esc cancels.';
        return 'Click to add dogleg waypoints • press G (or Finish button) then click to place the green • Esc cancels.';
      }
      case 'bulldoze':
        return 'Bulldoze: click objects to remove them, or painted surfaces to return them to rough.';
    }
  }

  /** Called from the toolbar "finish hole" button. */
  finishHoleMode(): void {
    if (this.draft) {
      this.draft.placingGreen = true;
      this.cb.setStatus(this.toolHint());
    }
  }

  cancelDraft(): void {
    this.draft = null;
    this.renderer.drawRoutes(false);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.cb.toast('Nothing to undo');
      return;
    }
    switch (entry.kind) {
      case 'terraform': {
        this.game.terrain.undo(entry.changes);
        this.game.cash += entry.cost;
        for (const c of entry.changes) this.markVertexDirty(c.vx, c.vy);
        break;
      }
      case 'paint': {
        for (let i = entry.tiles.length - 1; i >= 0; i--) {
          const t = entry.tiles[i];
          this.game.terrain.setSurface(t.x, t.y, t.from);
          this.renderer.terrainLayer.markTileDirty(t.x, t.y);
        }
        this.game.cash += entry.cost;
        break;
      }
      case 'object': {
        const obj = this.game.objects.find((o) => o.id === entry.id);
        if (obj) {
          this.game.objects = this.game.objects.filter((o) => o.id !== entry.id);
          this.game.cash += entry.cost;
        }
        break;
      }
    }
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      this.spaceHeld = true;
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (this.draft) {
        this.cancelDraft();
        this.cb.setStatus('Hole cancelled.');
      } else {
        this.setTool({ kind: 'pointer' });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
    } else if (e.key.toLowerCase() === 'g' && this.tool.kind === 'hole') {
      this.finishHoleMode();
    } else if (e.key === 'ArrowLeft') this.renderer.camera.panBy(80, 0);
    else if (e.key === 'ArrowRight') this.renderer.camera.panBy(-80, 0);
    else if (e.key === 'ArrowUp') this.renderer.camera.panBy(0, 80);
    else if (e.key === 'ArrowDown') this.renderer.camera.panBy(0, -80);
  }

  private onPointerDown(e: PointerEvent): void {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || e.button === 2 || this.spaceHeld) {
      this.panning = true;
      return;
    }
    if (e.button !== 0) return;
    switch (this.tool.kind) {
      case 'pointer':
        this.inspectAt(e);
        break;
      case 'raise':
      case 'lower':
      case 'smooth':
        this.terraformAt(e, true);
        break;
      case 'paint':
        this.painting = true;
        this.paintStroke = [];
        this.paintStrokeCost = 0;
        this.paintAt(e);
        break;
      case 'object':
        this.placeObjectAt(e);
        break;
      case 'hole':
        this.holeClickAt(e);
        break;
      case 'bulldoze':
        this.bulldozeAt(e);
        break;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.panning) {
      this.renderer.camera.panBy(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.hover = this.renderer.pickTile(e.clientX, e.clientY);
    if (this.painting && this.tool.kind === 'paint') this.paintAt(e);
    if ((this.tool.kind === 'raise' || this.tool.kind === 'lower') && e.buttons === 1) {
      this.terraformAt(e, false);
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    this.panning = false;
    if (this.painting) {
      this.painting = false;
      if (this.paintStroke.length > 0) {
        this.undoStack.push({ kind: 'paint', tiles: this.paintStroke, cost: this.paintStrokeCost });
      }
      this.paintStroke = [];
    }
    this.lastVertex = null;
  }

  // ── Tool actions ────────────────────────────────────────────────────────

  private terraformAt(e: PointerEvent, isClick: boolean): void {
    const v = this.renderer.pickVertex(e.clientX, e.clientY);
    if (!isClick && this.lastVertex && this.lastVertex.x === v.x && this.lastVertex.y === v.y) return;
    this.lastVertex = v;
    const t = this.game.terrain;
    let changes: VertexChange[];
    if (this.tool.kind === 'raise') changes = t.raiseVertex(v.x, v.y);
    else if (this.tool.kind === 'lower') changes = t.lowerVertex(v.x, v.y);
    else changes = t.smooth(v.x, v.y, 2);
    if (changes.length === 0) return;
    const cost = changes.length * TERRAFORM_COST_PER_VERTEX;
    if (!this.game.canAfford(cost)) {
      t.undo(changes);
      this.cb.toast('Not enough cash for earthworks');
      return;
    }
    this.game.spend(cost);
    this.undoStack.push({ kind: 'terraform', changes, cost });
    for (const c of changes) this.markVertexDirty(c.vx, c.vy);
  }

  private paintAt(e: PointerEvent): void {
    if (this.tool.kind !== 'paint') return;
    const p = this.renderer.pickTile(e.clientX, e.clientY);
    if (this.paintStroke.some((s) => s.x === p.x && s.y === p.y)) return;
    const from = this.game.terrain.surfaceAt(p.x, p.y);
    const surface = this.tool.surface;
    if (this.game.paintSurface(p.x, p.y, surface)) {
      this.paintStroke.push({ x: p.x, y: p.y, from, to: surface });
      this.paintStrokeCost += SURFACE_COSTS[surface];
      this.renderer.terrainLayer.markTileDirty(p.x, p.y);
    } else if (surface === Surface.Water && !this.game.terrain.isFlat(p.x, p.y)) {
      this.cb.setStatus('Water needs flat ground — lower or smooth the land first.');
    }
  }

  private placeObjectAt(e: PointerEvent): void {
    if (this.tool.kind !== 'object') return;
    const p = this.renderer.pickTile(e.clientX, e.clientY);
    const obj = this.game.placeObject(this.tool.object, p.x, p.y);
    if (obj) {
      this.undoStack.push({ kind: 'object', id: obj.id, cost: OBJECT_COSTS[obj.kind] });
      if (obj.kind === 'clubhouse') this.cb.toast('Clubhouse built! Golfers will start here.');
    } else if (this.tool.object === 'clubhouse' && this.game.objects.some((o) => o.kind === 'clubhouse')) {
      this.cb.toast('You already have a clubhouse.');
    } else {
      this.cb.toast('Cannot build here (occupied, water, or not enough cash).');
    }
  }

  private bulldozeAt(e: PointerEvent): void {
    const p = this.renderer.pickTile(e.clientX, e.clientY);
    if (this.game.removeObjectAt(p.x, p.y)) return;
    const from = this.game.terrain.surfaceAt(p.x, p.y);
    if (from !== Surface.Rough) {
      this.game.terrain.setSurface(p.x, p.y, Surface.Rough);
      this.renderer.terrainLayer.markTileDirty(p.x, p.y);
      // Removing a surface may invalidate a hole (tee/green gone) — reflect it.
      this.cb.onCourseChanged();
    }
  }

  private inspectAt(e: PointerEvent): void {
    const wp = this.renderer.camera.screenToWorldPoint(e.clientX, e.clientY);
    let best: { d: number; text: string } | null = null;
    for (const g of this.game.golfers) {
      const t = this.game.terrain;
      const sp = worldToScreen(g.pos.x, g.pos.y, t.heightAt(g.pos.x, g.pos.y));
      const d = Math.hypot(sp.x - wp.x, sp.y - wp.y);
      if (d < 24 && (!best || d < best.d)) {
        const hole = this.game.holes[g.holeIndex];
        const holeText = hole ? `hole ${hole.number}` : 'heading home';
        best = {
          d,
          text: `${g.name} — skill ${(g.skill * 100).toFixed(0)} — ${holeText}, ${g.strokesThisHole} strokes this hole, ${g.totalStrokes()} total.`,
        };
      }
    }
    if (best) this.cb.onInspect(best.text);
  }

  // ── Hole designer ───────────────────────────────────────────────────────

  private holeClickAt(e: PointerEvent): void {
    const p = this.renderer.pickTile(e.clientX, e.clientY);
    if (!this.draft) {
      // Place the tee: paint a 3x3 tee box centred on the click.
      const cost = SURFACE_COSTS[Surface.Tee] * 9;
      if (!this.game.canAfford(cost)) {
        this.cb.toast('Not enough cash for a tee box.');
        return;
      }
      this.paintBox(p.x - 1, p.y - 1, 3, 3, Surface.Tee);
      this.draft = { tee: { ...p }, waypoints: [], placingGreen: false };
      this.cb.setStatus(this.toolHint());
      return;
    }
    if (this.draft.placingGreen) {
      const cost = SURFACE_COSTS[Surface.Green] * 20;
      if (!this.game.canAfford(cost)) {
        this.cb.toast('Not enough cash for a green.');
        return;
      }
      this.paintGreen(p.x, p.y);
      const hole: Hole = {
        number: this.game.holes.length + 1,
        tee: this.draft.tee,
        waypoints: this.draft.waypoints,
        cup: { ...p },
      };
      this.game.holes.push(hole);
      this.draft = null;
      this.renderer.drawRoutes(false);
      this.renderer.sceneLayer.markCourseDirty();
      this.cb.onCourseChanged();
      this.cb.toast(`Hole ${hole.number} built — ${holeLengthYards(hole)} yd, par ${holePar(hole)}.`);
      this.cb.setStatus(this.toolHint());
      return;
    }
    this.draft.waypoints.push({ ...p });
    this.cb.setStatus(`Waypoint added (${this.draft.waypoints.length}). Press G then click to place the green.`);
  }

  private paintBox(x0: number, y0: number, w: number, h: number, s: Surface): void {
    const tiles: Array<{ x: number; y: number; from: Surface; to: Surface }> = [];
    let cost = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!this.game.terrain.inBounds(x, y)) continue;
        const from = this.game.terrain.surfaceAt(x, y);
        if (this.game.paintSurface(x, y, s)) {
          tiles.push({ x, y, from, to: s });
          cost += SURFACE_COSTS[s];
          this.renderer.terrainLayer.markTileDirty(x, y);
        }
      }
    }
    if (tiles.length > 0) this.undoStack.push({ kind: 'paint', tiles, cost });
  }

  private paintGreen(cx: number, cy: number): void {
    const tiles: Array<{ x: number; y: number; from: Surface; to: Surface }> = [];
    let cost = 0;
    for (let y = Math.floor(cy - GREEN_RADIUS); y <= Math.ceil(cy + GREEN_RADIUS); y++) {
      for (let x = Math.floor(cx - GREEN_RADIUS); x <= Math.ceil(cx + GREEN_RADIUS); x++) {
        if (!this.game.terrain.inBounds(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) > GREEN_RADIUS + 0.2) continue;
        const from = this.game.terrain.surfaceAt(x, y);
        if (this.game.paintSurface(x, y, Surface.Green)) {
          tiles.push({ x, y, from, to: Surface.Green });
          cost += SURFACE_COSTS[Surface.Green];
          this.renderer.terrainLayer.markTileDirty(x, y);
        }
      }
    }
    if (tiles.length > 0) this.undoStack.push({ kind: 'paint', tiles, cost });
  }

  // ── Per-frame overlay ───────────────────────────────────────────────────

  updateHighlight(): void {
    const r = this.renderer;
    r.highlight.clear();
    const showRoutes = this.tool.kind === 'hole' || this.tool.kind === 'pointer';
    const draftPts = this.draft
      ? [this.draft.tee, ...this.draft.waypoints, this.hover]
      : undefined;
    r.drawRoutes(showRoutes, draftPts);

    switch (this.tool.kind) {
      case 'raise':
      case 'lower':
      case 'smooth': {
        const v = r.pickVertex(this.lastPointer.x, this.lastPointer.y);
        r.markerAtVertex(v.x, v.y, this.tool.kind === 'lower' ? 0xff8866 : 0xffe066);
        break;
      }
      case 'paint':
      case 'bulldoze':
      case 'hole': {
        r.outlineTile(this.hover.x, this.hover.y);
        break;
      }
      case 'object': {
        const fp = this.tool.object === 'clubhouse' ? 3 : 1;
        for (let dy = 0; dy < fp; dy++) {
          for (let dx = 0; dx < fp; dx++) r.outlineTile(this.hover.x + dx, this.hover.y + dy, 0xa0e8ff, 0.7);
        }
        break;
      }
      default:
        break;
    }
  }

  private markVertexDirty(vx: number, vy: number): void {
    this.renderer.terrainLayer.markTileDirty(vx, vy);
    this.renderer.terrainLayer.markTileDirty(vx - 1, vy - 1);
  }
}
