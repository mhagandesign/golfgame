# Drop-in photographic textures (optional)

The game generates all terrain art procedurally, but if image files exist in
this folder they are used instead — this is the hook for real photographic
CC0 textures from libraries like **ambientCG** (ambientcg.com) and
**Poly Haven** (polyhaven.com), whose assets are public domain (CC0) and can
be committed to this repo.

Place seamless, square color images (1K is plenty; JPG, PNG or WebP) named:

| File | Used for | Suggested CC0 assets |
| --- | --- | --- |
| `rough.jpg` | Rough grass | ambientCG **Grass004**, Poly Haven `grass_medium` |
| `fairway.jpg` | Fairway turf | ambientCG **Grass001** (fine lawn) |
| `green.jpg` | Putting green | ambientCG **Grass005** (short mown) |
| `tee.jpg` | Tee boxes | same family as fairway, slightly lighter |
| `sand.jpg` | Bunkers | ambientCG **Ground033** (raked sand) |
| `water.jpg` | Ponds | ambientCG **Water002** color map |
| `path.jpg` | Cart paths | ambientCG **Gravel022** |

Notes:
- Textures must tile seamlessly (all the suggestions above do).
- The game tints them for slope lighting, mowing stripes, wear and time of
  day, so pick fairly neutral, evenly lit images.
- This environment's network policy blocks direct downloads from those sites,
  which is why they are not bundled — fetch them from a machine with normal
  internet access and commit them here.
