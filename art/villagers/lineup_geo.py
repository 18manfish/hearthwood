# Quick untextured renders of every species' geometry (checks shapes before painting).
import os, sys
sys.path.insert(0, ART + r"\villagers")
OUTD = ART + r'\villagers\lineup'
os.makedirs(OUTD, exist_ok=True)
done = []
for SPECIES_NAME in globals().get('ONLY') or list(__import__('species').SPECIES):
    g2 = {'ART': ART, 'SPECIES_NAME': SPECIES_NAME, '__name__': 'vb'}
    exec(open(ART + r'\villagers\villager_build.py', encoding='utf-8').read(), g2)
    exec(open(ART + r'\villagers\preview.py', encoding='utf-8').read(), g2)
    co = g2['setup_render'](360)
    g2['shoot'](co, OUTD + f'\\geo_{SPECIES_NAME}.png', 30, 10, 3.4, (0, 0, 0.7))
    done.append(SPECIES_NAME)
result = done
