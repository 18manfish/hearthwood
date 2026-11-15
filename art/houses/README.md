# Houses (Blender)

The Starter House tiers and the villager houses, in the style of Animal Crossing:
New Horizons – soft bevelled shapes, smooth shading and bright tileable textures
(clapboard, brick, stucco, logs, field stone, rounded roof tiles, shingles, thatch).

- `housetex.py` – the texture painters (numpy only; `python3 housetex.py sheet.png` previews them)
- `houses_build.py` – builds `house_1..3` and `vhouse_1..2` (run inside Blender with `ART` set to
  the folder that holds `houses/`)
- `render_houses.py` – preview renders
- `export_houses.py` – writes `export/house.glb`, `export/villager_houses.glb` and the swappable
  `tex_<kind>.jpg` textures; copy them to `client/public/models/house.glb` and
  `client/public/models/houses/`
- `houses.blend` – the built houses

Villager houses use the white materials `vwall`, `vroof`, `vtrim` and `vdoor`; the game gives
each villager their own colours and wall / roof texture (`VILLAGER_HOUSE_STYLES` in
`client/src/game/houseAssets.ts`). `glass` and `lamp` are lit at night by the game.
