import { Game } from './core/game';
import { buildDemoCourse } from './core/save/demoCourse';
import { deserialize, exportToFile, loadFromLocalStorage, SaveData, saveToLocalStorage } from './core/save/save';
import { ToolController } from './input/tools';
import { Renderer } from './render/renderer';
import { TitleScreen } from './ui/title';
import { UI } from './ui/ui';

let game = new Game(96, 96, Date.now() & 0xffffff);
let speed = 1;
let inGame = false;

const renderer = new Renderer(game);
let tools!: ToolController;
let ui!: UI;
let title!: TitleScreen;

function switchGame(next: Game): void {
  game = next;
  renderer.setGame(game);
  tools.setGame(game);
  ui.setGame(game);
  ui.refreshPanel();
}

function startGame(next: Game): void {
  switchGame(next);
  title.hide();
  inGame = true;
  speed = 1;
  ui.setStatus(tools.toolHint());
}

async function boot(): Promise<void> {
  await renderer.init(document.getElementById('game-canvas')!);

  tools = new ToolController(game, renderer, {
    setStatus: (t) => ui.setStatus(t),
    toast: (t) => ui.toast(t),
    onCourseChanged: () => ui.refreshPanel(),
    onInspect: (t) => ui.setStatus(t),
  });

  ui = new UI(game, {
    setTool: (tool) => tools.setTool(tool),
    finishHole: () => tools.finishHoleMode(),
    undo: () => tools.undo(),
    toggleOpen: () => {
      if (game.courseOpen) {
        game.closeCourse();
        ui.toast('Course closed. Golfers already out will finish their rounds.');
      } else {
        const issues = game.openCourse();
        if (issues.length === 0) {
          ui.toast('🎉 The course is open for business!');
        } else {
          ui.toast(issues[0].message);
        }
      }
      ui.refreshPanel();
    },
    setFee: (fee) => {
      game.greenFee = Math.max(0, Math.min(500, fee));
      ui.refreshPanel();
    },
    setSpeed: (s) => {
      speed = s;
    },
    save: () => {
      saveToLocalStorage(game, game.courseName);
      ui.toast(`Saved “${game.courseName}”.`);
    },
    exportFile: () => exportToFile(game),
    deleteHole: (index) => {
      game.holes.splice(index, 1);
      game.holes.forEach((h, i) => (h.number = i + 1));
      renderer.sceneLayer.markCourseDirty();
      ui.refreshPanel();
      ui.toast('Hole removed (turf remains — bulldoze it if unwanted).');
    },
    backToTitle: () => {
      inGame = false;
      title.show();
    },
  });

  title = new TitleScreen({
    playDemo: () => startGame(buildDemoCourse()),
    newCourse: () => {
      const g = new Game(96, 96, Date.now() & 0xffffff);
      g.courseName = 'My Golf Course';
      startGame(g);
      ui.toast('A blank meadow awaits. Build a clubhouse and design your first hole!');
    },
    loadSlot: (slot) => {
      const g = loadFromLocalStorage(slot);
      if (g) startGame(g);
    },
    importFile: (file) => {
      void file.text().then((text) => {
        try {
          startGame(deserialize(JSON.parse(text) as SaveData));
        } catch {
          ui.toast('Could not read that course file.');
        }
      });
    },
  });

  tools.attach(renderer.app.canvas);
  title.show();

  // ── Main loop: fixed-step simulation, per-frame rendering. ──
  let accumulator = 0;
  let panelTimer = 0;
  const STEP = 0.25; // game minutes per sim step
  renderer.app.ticker.add((ticker) => {
    if (inGame) {
      // 1 real second = 1 game minute at 1× speed.
      const dtMin = (ticker.deltaMS / 1000) * speed;
      accumulator += Math.min(dtMin, 30);
      while (accumulator >= STEP) {
        game.update(STEP);
        accumulator -= STEP;
      }
      tools.updateHighlight();
      ui.updateStats();
      panelTimer += ticker.deltaMS;
      if (panelTimer > 2500) {
        panelTimer = 0;
        ui.refreshPanel();
      }
    }
    renderer.frame();
  });
}

void boot().then(() => {
  // Debug/testing hook (also handy in the browser console).
  (window as unknown as Record<string, unknown>).__fm = {
    get game() {
      return game;
    },
    renderer,
  };
});
