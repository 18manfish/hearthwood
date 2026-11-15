# Preview renders of the player: every hair style with the default face, and every face option.
import bpy, os
O = bpy.data.objects
OUTD = ART + r'\villagers\lineup'
os.makedirs(OUTD, exist_ok=True)
exec(open(ART + r'\villagers\preview.py', encoding='utf-8').read())
G = SPECIES_NAME.split('_')[1]
STYLES = ['short', 'spiky', 'curly', 'buzz', 'long', 'ponytail', 'bob', 'pigtails']


def show(o, on):
    o.hide_render = not on
    o.hide_viewport = not on


def face(eye='round', brow='soft', nose='dot', mouth='smile', cheek='blush', hair='short'):
    for o in O:
        n = o.name
        if n.startswith('hair_'):
            show(o, n == 'hair_' + hair or n.startswith('hair_' + hair + '_'))
        elif n.startswith('eye_'):
            part = n.split('_')[1]
            want = 'happy' if (eye == 'wink' and n.endswith('_R')) else ('round' if eye == 'wink' else eye)
            show(o, part == want)
        elif n.startswith('shine'):
            show(o, eye in ('round', 'wide') or (eye == 'wink' and n.startswith('shineL')))
        elif n.startswith('lookbrow_'):
            show(o, n.split('_')[1] == brow)
        elif n.startswith('nose_'):
            show(o, n.split('_')[1] == nose)
        elif n.startswith('mouth_'):
            show(o, n.split('_')[1] == mouth)
        elif n.startswith('cheek_'):
            show(o, n.split('_')[1] == cheek)


co = setup_render(320)
shots = []
for i, st in enumerate(STYLES):
    face(hair=st, eye=['round', 'happy', 'sleepy', 'wide', 'wink', 'round', 'round', 'round'][i],
         mouth=['smile', 'grin', 'open', 'small', 'cat', 'smile', 'smile', 'smile'][i],
         brow=['soft', 'bold', 'raised', 'none', 'soft', 'soft', 'soft', 'soft'][i], nose=['dot', 'button', 'none', 'dot'][i % 4],
         cheek=['blush', 'freckles', 'none'][i % 3])
    p = OUTD + f'\\player_{G}_{st}.png'
    shoot(co, p, 25, 8, 2.3, (0, 0, 0.82))
    shots.append(p)
result = shots
