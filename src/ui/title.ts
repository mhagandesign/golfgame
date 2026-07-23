import { listSaveSlots } from '../core/save/save';

export interface TitleActions {
  playDemo(): void;
  newCourse(): void;
  loadSlot(slot: string): void;
  importFile(file: File): void;
}

export class TitleScreen {
  private el = document.getElementById('title-screen')!;

  constructor(private actions: TitleActions) {}

  show(): void {
    this.el.classList.remove('hidden');
    this.el.innerHTML = `
      <h1>⛳ Fairway Mogul</h1>
      <div class="tagline">Design it. Build it. Open the gates. Watch them play.</div>
      <button class="primary" id="btn-demo">▶ Play the demo course</button>
      <button id="btn-new">🏗 Start a new course</button>
      <div id="save-buttons"></div>
      <button id="btn-import">📂 Import a course file</button>
      <input type="file" id="import-input" accept=".json" style="display:none" />
      <div class="fine">
        Willow Creek Links, our 9-hole demo, comes ready to open — press play to see the full
        loop: golfers arriving, playing shots, paying green fees. Or start from a blank meadow
        and shape every hill, hazard and hole yourself.
      </div>
    `;
    this.el.querySelector('#btn-demo')!.addEventListener('click', () => this.actions.playDemo());
    this.el.querySelector('#btn-new')!.addEventListener('click', () => this.actions.newCourse());
    const importInput = this.el.querySelector<HTMLInputElement>('#import-input')!;
    this.el.querySelector('#btn-import')!.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      if (importInput.files?.[0]) this.actions.importFile(importInput.files[0]);
    });

    const savesWrap = this.el.querySelector('#save-buttons')!;
    for (const slot of listSaveSlots()) {
      const b = document.createElement('button');
      b.textContent = `📁 Load “${slot}”`;
      b.style.marginTop = '6px';
      b.addEventListener('click', () => this.actions.loadSlot(slot));
      savesWrap.appendChild(b);
    }
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
  }
}
