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
