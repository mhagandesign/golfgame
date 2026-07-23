# ⛳ Fairway Mogul

An isometric golf course **construction & management sim** in the spirit of
RollerCoaster Tycoon: shape the land, design holes, open the gates, and watch
simulated golfers play your course — and pay for the privilege.

Built with TypeScript, PixiJS (WebGL) and Vite. Pure client-side; no backend.

## Running

```bash
npm install
npm run dev      # dev server with hot reload
npm run test     # unit tests (vitest)
npm run build    # typecheck + production build
```

## Playing

From the title screen either **play the bundled demo course** (Willow Creek
Links, 9 holes, ready to open) or **start a new course** on a blank meadow.

The core loop:

1. **Terraform** — raise/lower/smooth the corner-heightmapped terrain.
2. **Paint turf** — fairway, green, tee box, sand, water (needs flat ground), paths.
3. **Design holes** — the ⛳ tool: click a tee, click dogleg waypoints, press
   `G` (or the "Place green" button) and click to place the green. Yardage and
   par are computed automatically.
4. **Build a clubhouse** and scenery, set your green fee, and **open the course**.
5. Golfers arrive based on reputation, pricing, **weather** and turf condition;
   they walk the course and play shots simulated from their skill, lie,
   distance and hazards — rendered as animated ball flights. Their enjoyment
   feeds your reputation, which drives demand.
6. Foot traffic and divots **wear the turf** down — hire groundskeepers to mow
   and repair it. Golfers get thirsty, hungry and desperate: place **drink
   stands, snack bars and toilets** to keep them happy (and take their money).

### Controls

| Input | Action |
| --- | --- |
| Left click / drag | Use the selected tool |
| Right or middle drag, or Space + drag | Pan the camera |
| Scroll wheel | Zoom (to cursor) |
| Arrow keys | Pan |
| `Ctrl+Z` | Undo terraforming / painting / placement |
| `G` | Hole designer: switch to placing the green |
| `Esc` | Cancel hole draft / back to inspect tool |

Saves go to localStorage (💾 Save) and can be exported/imported as `.golf.json`
files.

## Architecture

- `src/core/` — pure, deterministic simulation (no rendering imports):
  terrain heightmap & slope constraints, course model & validation, A*
  pathfinding, seeded-RNG hybrid shot model, golfer agents, economy, saves,
  and the generated demo course. Fully unit-tested.
- `src/render/` — PixiJS isometric renderer: chunked terrain quads with
  slope-based lighting, depth-sorted scenery/agents, camera, overlays.
- `src/ui/` — DOM-based HUD, toolbar, course panel, title screen.
- `src/input/` — tool controller (terraform, paint, objects, hole designer,
  bulldoze, inspect) with undo and costing.
