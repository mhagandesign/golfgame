# Pre-rendered prop sprites

The tree, pine and bush sprites in this folder are pre-rendered 3D artwork by
**Reiner "Tiles" Prokein** — [Reiner's Tilesets](https://www.reinerstilesets.de)
— used under his license: free for commercial and non-commercial games with a
credit. Thanks, Reiner!

Adaptations made for this game: sprites extracted from the original sheets
(`Ttrees`, `T_trees2`, `T_bushes`), background color-keyed to transparency,
mirrored horizontally so the baked light direction matches the game's
north-west sun, and hue/brightness adjusted on a few plants
(cypress `tree-1.png`, bush `bush-1.png`) to fit the course palette.

## How overrides work

The renderer looks for `<key>.png` files here at startup and uses them in
place of its procedurally baked props. Recognized keys: `tree-0..3`,
`pine-0..1`, `bush-0..1`. Anchors/scales per key are defined in
`src/render/textures.ts` (`PROP_OVERRIDES`). Delete a file to fall back to
the generated art for that prop.

## Credits

- Trees, pines and bushes: Reiner "Tiles" Prokein — reinerstilesets.de
- Terrain photo textures (`../textures/`): ambientCG (CC0)
