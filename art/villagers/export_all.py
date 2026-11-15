# Whole pipeline for the game: every species (model, coats), then the shared clothes,
# props and animations from the cat. Progress goes to export\progress.json.
import os, sys, json, time, bpy
sys.path.insert(0, ART + r"\villagers")
import species
EXP = ART + r'\villagers\export'
os.makedirs(EXP, exist_ok=True)
log = []


def step(name, files, extra=None):
    t = time.time()
    g2 = {'ART': ART, '__name__': 'vb'}
    g2.update(extra or {})
    try:
        for st in files:
            exec(open(ART + '\\villagers\\' + st, encoding='utf-8').read(), g2)
        log.append([name, 'ok', round(time.time() - t), g2.get('result')])
    except Exception:
        import traceback
        log.append([name, 'error', traceback.format_exc()[-1200:]])
    json.dump(log, open(EXP + r'\progress.json', 'w'), default=str)


if not globals().get('SHARED_ONLY'):
    for sp in globals().get('ONLY') or list(species.SPECIES):
        step(sp, ['villager_build.py', 'villager_fur.py', 'export_species.py'], {'SPECIES_NAME': sp})
step('shared', ['villager_build.py', 'clothes.py', 'cat_anim.py', 'anim_export.py', 'export_shared.py'], {'SPECIES_NAME': 'cat'})
result = log
