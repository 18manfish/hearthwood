# Build every species, paint all its villagers' coats, render each villager and save a
# .blend per species (later steps export from these).
import os, sys, json, time, bpy
sys.path.insert(0, ART + r"\villagers")
import species
OUTD = ART + r'\villagers\lineup'
os.makedirs(OUTD, exist_ok=True)
done = []
for SPECIES_NAME in globals().get('ONLY') or list(species.SPECIES):
    t = time.time()
    g2 = {'ART': ART, 'SPECIES_NAME': SPECIES_NAME, '__name__': 'vb'}
    for st in ('villager_build.py', 'villager_fur.py', 'preview.py'):
        exec(open(ART + '\\villagers\\' + st, encoding='utf-8').read(), g2)
    co = g2['setup_render'](360)
    for vid in g2['COATS']:
        g2['use_coat'](vid)
        g2['shoot'](co, OUTD + f'\\coat_{vid}.png', 30, 10, 3.4, (0, 0, 0.7))
    bpy.ops.wm.save_as_mainfile(filepath=ART + rf'\villagers\species_{SPECIES_NAME}.blend')
    done.append([SPECIES_NAME, list(g2['COATS']), round(time.time() - t)])
    json.dump(done, open(OUTD + r'\progress.json', 'w'))
result = done
