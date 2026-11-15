# Villager models (Blender)

Smooth, part-based villagers with painted plush coats, exchangeable clothes and shared
animations. Scripts run inside Blender (5.x, numpy) with `ART` set to the art folder
that contains this `villagers/` directory; `run.py` runs a list of steps and writes
`status.json`.

- `species.py` – what differs per species (head, ears, snout, nose/beak, eyes, tail, arms, feet, fur feel)
- `villager_build.py` – builds one species (`SPECIES_NAME`) with the shared body and face sets
- `villager_fur.py` + `coat_masks.py` + `villager_coats.py` – bakes and paints a coat per villager
- `clothes.py` + `clothes_more.py` – every clothing cut and the fabric atlas
- `cat_anim.py` – the 21 clips (idle, walk, run, chase, surprised, laugh, sad…, gift, sitting, umbrella)
- `anim_export.py`, `export_species.py`, `export_shared.py` – game export
- `export_all.py` – the whole pipeline → `villagers/export/`, copied to `client/public/models/villagers/`

`cat_model.py` / `cat_fur.py` / `cat_coats.py` are the original example cat.

The `.blend` files are the saved results: `species_<species>.blend` (model with every coat
of that species painted, as built by `lineup_coats.py`) and `cat_animated.blend` (the
example cat with clothes, props and all clips as actions, plus the showreel timeline).
Their textures are written next to the scripts when the pipeline runs.

## Players

The player characters use the same body (so every clothing cut and clip fits) with a
round human head: `species.py` has `human_m` and `human_f`.

- `player_build.py` – skin / undershirt / trousers materials and every option a player
  can pick (eye shapes, brows, nose, mouth, cheeks, the eight hair styles), plus eyelashes
  on `human_f` and a `toolSlot` in the right hand
- `player_paint.py` – the baked shading atlas (tinted in the game), cloth weave, hair strands
- `player_anim.py` – the player's clips: chop, dig, net, cast, fish, pickup
- `export_player.py` – `export/player_m.glb`, `export/player_f.glb`
- `clothes_more.py` also has the shoes (sneakers, boots, sandals) and gloves / mittens
