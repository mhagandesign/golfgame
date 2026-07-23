# Blender sprite pipeline

The clubhouse and amenity kiosk sprites in `public/sprites/` are rendered
from these scripts with headless Blender (tested with 4.2 LTS, Cycles CPU).
The camera is a **dimetric 2:1 orthographic** setup matching the game's
projection, with the sun placed so baked shadows fall to the screen
south-east — consistent with the game's north-west keylight, the terrain
slope shading, and the Reiner's Tilesets sprites.

```bash
blender -b -P clubhouse.py            # → clubhouse-render.png
blender -b -P kiosk.py -- drinks      # → kiosk-drinks.png (also: snacks, toilet)
```

Post-processing (see git history for the exact commands): alpha-threshold
trim, then compute the ground anchor from the camera aim height
(`ay = (cy + aimZ · px_per_m · sin 63.435°) / h`) and record it with the
render scale in `PROP_OVERRIDES` in `src/render/textures.ts`.

Conventions for new props:
- 1 Blender metre ≈ 1 game tile.
- Front of a building (doors, hatches) faces −Y, which is the game's
  screen south-west — that's where golfers approach from.
- `view_transform = 'Standard'`, transparent film, shadow-catcher ground.
