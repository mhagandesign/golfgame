import { Game, ObjectKind, OBJECT_COSTS, WEATHER_LABELS } from '../core/game';
import { GROUNDSKEEPER_WAGE } from '../core/sim/staff';
import { Surface, SURFACE_NAMES } from '../core/terrain/terrain';
import { holeLengthYards, holePar } from '../core/course/course';
import { SURFACE_COLORS } from '../render/colors';
import { Tool } from '../input/tools';

export interface UIActions {
  setTool(tool: Tool): void;
  finishHole(): void;
  undo(): void;
  toggleOpen(): void;
  setFee(fee: number): void;
  setSpeed(speed: number): void;
  save(): void;
  exportFile(): void;
  deleteHole(index: number): void;
  backToTitle(): void;
  hireStaff(): void;
  fireStaff(): void;
}

const SPEEDS = [0, 1, 3, 8];

export class UI {
  private hud = document.getElementById('hud')!;
  private toolbar = document.getElementById('toolbar')!;
  private statusBar = document.getElementById('status-bar')!;
  private panel = document.getElementById('panel')!;
  private toolButtons = new Map<string, HTMLButtonElement>();
  private statEls: Record<string, HTMLElement> = {};
  private speedButtons: HTMLButtonElement[] = [];
  private openBtn!: HTMLButtonElement;
  private feeInput!: HTMLInputElement;
  private currentSpeed = 1;
  private lastHudHeight = 0;

  constructor(
    private game: Game,
    private actions: UIActions,
  ) {
    this.buildHud();
    this.buildToolbar();
    this.refreshPanel();
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  /** Keep the side panels clear of the HUD, which can wrap to multiple rows. */
  private layout(): void {
    const top = `${this.hud.offsetHeight + 8}px`;
    this.toolbar.style.top = top;
    this.panel.style.top = top;
  }

  setGame(game: Game): void {
    this.game = game;
    this.feeInput.value = String(game.greenFee);
    this.refreshPanel();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private buildHud(): void {
    this.hud.innerHTML = '';
    const mkStat = (key: string, label: string) => {
      const el = document.createElement('div');
      el.className = 'stat';
      el.innerHTML = `${label} <b></b>`;
      this.hud.appendChild(el);
      this.statEls[key] = el.querySelector('b')!;
    };
    const name = document.createElement('div');
    name.className = 'stat';
    name.id = 'course-name';
    this.hud.appendChild(name);
    this.statEls['name'] = name;

    mkStat('clock', '🕒');
    mkStat('weather', '');
    mkStat('cash', '💰');
    mkStat('rep', '⭐');
    mkStat('turf', '🌱');
    mkStat('visitors', '👥 today');
    mkStat('onCourse', '⛳ playing');

    // Green fee.
    const feeWrap = document.createElement('div');
    feeWrap.className = 'stat';
    feeWrap.innerHTML = 'Fee $';
    this.feeInput = document.createElement('input');
    this.feeInput.type = 'number';
    this.feeInput.min = '0';
    this.feeInput.max = '500';
    this.feeInput.value = String(this.game.greenFee);
    this.feeInput.addEventListener('change', () => this.actions.setFee(Number(this.feeInput.value) || 0));
    feeWrap.appendChild(this.feeInput);
    this.hud.appendChild(feeWrap);

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.hud.appendChild(spacer);

    // Speed controls.
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.textContent = s === 0 ? '⏸' : `${s}×`;
      b.addEventListener('click', () => {
        this.currentSpeed = s;
        this.actions.setSpeed(s);
        this.updateSpeedButtons();
      });
      this.speedButtons.push(b);
      this.hud.appendChild(b);
    }
    this.updateSpeedButtons();

    this.openBtn = document.createElement('button');
    this.openBtn.className = 'open-btn';
    this.openBtn.addEventListener('click', () => this.actions.toggleOpen());
    this.hud.appendChild(this.openBtn);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.addEventListener('click', () => this.actions.save());
    this.hud.appendChild(saveBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '⬇ Export';
    exportBtn.addEventListener('click', () => this.actions.exportFile());
    this.hud.appendChild(exportBtn);

    const titleBtn = document.createElement('button');
    titleBtn.textContent = '🏠 Menu';
    titleBtn.addEventListener('click', () => this.actions.backToTitle());
    this.hud.appendChild(titleBtn);
  }

  private updateSpeedButtons(): void {
    this.speedButtons.forEach((b, i) => {
      b.classList.toggle('active', SPEEDS[i] === this.currentSpeed);
    });
  }

  // ── Toolbar ─────────────────────────────────────────────────────────────

  private addToolButton(id: string, label: string, tool: Tool | null, onClick?: () => void): void {
    const b = document.createElement('button');
    b.innerHTML = label;
    b.addEventListener('click', () => {
      if (tool) {
        this.actions.setTool(tool);
        this.setActiveTool(id);
      }
      onClick?.();
    });
    this.toolButtons.set(id, b);
    this.toolbar.appendChild(b);
  }

  private addGroupLabel(text: string): void {
    const el = document.createElement('div');
    el.className = 'group-label';
    el.textContent = text;
    this.toolbar.appendChild(el);
  }

  private buildToolbar(): void {
    this.toolbar.innerHTML = '';
    this.addGroupLabel('General');
    this.addToolButton('pointer', '🖱️ Inspect', { kind: 'pointer' });
    this.addToolButton('bulldoze', '🚜 Bulldoze', { kind: 'bulldoze' });
    this.addToolButton('undo', '↩️ Undo', null, () => this.actions.undo());

    this.addGroupLabel('Earthworks');
    this.addToolButton('raise', '⬆️ Raise land', { kind: 'raise' });
    this.addToolButton('lower', '⬇️ Lower land', { kind: 'lower' });
    this.addToolButton('smooth', '〰️ Smooth', { kind: 'smooth' });

    this.addGroupLabel('Turf & hazards');
    const surfaces: Surface[] = [Surface.Fairway, Surface.Green, Surface.Tee, Surface.Sand, Surface.Water, Surface.Path, Surface.Rough];
    for (const s of surfaces) {
      const color = SURFACE_COLORS[s].toString(16).padStart(6, '0');
      this.addToolButton(`paint-${s}`, `<span class="swatch" style="background:#${color}"></span>${SURFACE_NAMES[s]}`, {
        kind: 'paint',
        surface: s,
      });
    }

    this.addGroupLabel('Scenery');
    const objects: Array<[ObjectKind, string]> = [
      ['tree', '🌳 Tree'],
      ['pine', '🌲 Pine'],
      ['bush', '🌿 Bush'],
      ['rock', '🪨 Rock'],
      ['flowers', '🌸 Flowers'],
      ['clubhouse', '🏠 Clubhouse'],
    ];
    for (const [kind, label] of objects) {
      this.addToolButton(`obj-${kind}`, `${label} $${OBJECT_COSTS[kind]}`, { kind: 'object', object: kind });
    }

    this.addGroupLabel('Amenities');
    const amenities: Array<[ObjectKind, string]> = [
      ['drinks', '🥤 Drinks stand'],
      ['snacks', '🌭 Snack bar'],
      ['toilet', '🚻 Toilets'],
    ];
    for (const [kind, label] of amenities) {
      this.addToolButton(`obj-${kind}`, `${label} $${OBJECT_COSTS[kind]}`, { kind: 'object', object: kind });
    }

    this.addGroupLabel('Course design');
    this.addToolButton('hole', '⛳ New hole', { kind: 'hole' });
    this.addToolButton('finish-hole', '🟢 Place green', null, () => this.actions.finishHole());

    this.setActiveTool('pointer');
  }

  setActiveTool(id: string): void {
    for (const [bid, b] of this.toolButtons) b.classList.toggle('active', bid === id);
  }

  // ── Status / toast ──────────────────────────────────────────────────────

  setStatus(text: string): void {
    this.statusBar.textContent = text;
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  }

  // ── Course panel ────────────────────────────────────────────────────────

  refreshPanel(): void {
    const g = this.game;
    const rows = g.holes
      .map((h, i) => {
        return `<tr><td>${h.number}</td><td>${holeLengthYards(h)} yd</td><td>${holePar(h)}</td><td><button class="del" data-hole="${i}">✕</button></td></tr>`;
      })
      .join('');
    const issues = g.courseIssues();
    const issuesHtml =
      issues.length === 0
        ? `<div class="ok">✔ Course is ready for golfers.</div>`
        : issues.map((i) => `<div class="issue">⚠ ${i.message}</div>`).join('');

    // Finance history: last 14 days as paired income/expense bars.
    const days = g.history.slice(-14);
    const maxVal = Math.max(100, ...days.map((d) => Math.max(d.income, d.expenses)));
    const bars = days
      .map(
        (d) => `<div class="fin-day" title="Day ${d.day}: +$${d.income} / −$${d.expenses}, ${d.visitors} visitors">
          <div class="bar in" style="height:${Math.round((d.income / maxVal) * 44)}px"></div>
          <div class="bar out" style="height:${Math.round((d.expenses / maxVal) * 44)}px"></div>
        </div>`,
      )
      .join('');
    const financeHtml = days.length
      ? `<div class="fin-chart">${bars}</div>
         <div class="fin-legend"><span class="in">■</span> income <span class="out">■</span> expenses</div>`
      : `<div style="color:#9cb086">No trading history yet.</div>`;

    this.panel.innerHTML = `
      <h3>${g.courseName}</h3>
      <table>
        <tr><th>#</th><th>Length</th><th>Par</th><th></th></tr>
        ${rows || '<tr><td colspan="4">No holes yet</td></tr>'}
      </table>
      <div>Total par: <b>${g.totalPar()}</b> · Holes: <b>${g.holes.length}</b></div>
      <div>Demand: <b>${g.demandPerDay()}</b> golfers/day · Fair fee: $${g.fairFee()}</div>
      <div>Daily upkeep: $${g.dailyUpkeep()}</div>
      <div>Forecast tomorrow: ${WEATHER_LABELS[g.forecast]}</div>
      <div style="margin-top:8px">${issuesHtml}</div>
      <h3 style="margin-top:12px">Staff</h3>
      <div>Groundskeepers: <b>${g.staff.length}</b> ($${GROUNDSKEEPER_WAGE}/day each)</div>
      <div style="margin-top:4px">
        <button id="hire-gk">+ Hire</button>
        <button id="fire-gk">− Let go</button>
      </div>
      <h3 style="margin-top:12px">Finances</h3>
      ${financeHtml}
    `;
    this.panel.querySelectorAll<HTMLButtonElement>('button.del').forEach((b) => {
      b.addEventListener('click', () => this.actions.deleteHole(Number(b.dataset.hole)));
    });
    this.panel.querySelector('#hire-gk')?.addEventListener('click', () => this.actions.hireStaff());
    this.panel.querySelector('#fire-gk')?.addEventListener('click', () => this.actions.fireStaff());
  }

  /** Called every frame — cheap DOM updates only. */
  updateStats(): void {
    const g = this.game;
    this.statEls['name'].textContent = `⛳ ${g.courseName}`;
    this.statEls['clock'].textContent = g.clockText;
    this.statEls['weather'].textContent = WEATHER_LABELS[g.weather];
    this.statEls['cash'].textContent = `$${Math.round(g.cash).toLocaleString()}`;
    this.statEls['rep'].textContent = `${g.reputation.toFixed(0)}/100`;
    this.statEls['turf'].textContent = `${Math.round(g.terrain.turfCondition() * 100)}%`;
    this.statEls['visitors'].textContent = String(g.todayVisitors);
    this.statEls['onCourse'].textContent = String(g.golfers.length);
    this.openBtn.textContent = g.courseOpen ? '🟢 Open — click to close' : '🔴 Closed — click to open';
    this.openBtn.classList.toggle('is-open', g.courseOpen);
    if (this.hud.offsetHeight !== this.lastHudHeight) {
      this.lastHudHeight = this.hud.offsetHeight;
      this.layout();
    }
  }
}
