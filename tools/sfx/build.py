#!/usr/bin/env python3
"""Build the game's sound files (client/public/sfx/) from CC0 stock recordings.

Every source here is CC0 / public domain; see client/public/sfx/CREDITS.md.

Fetch the sources into one folder (all are plain git clones):
    git clone --depth 1 https://github.com/EternityForest/Free-SFX          <src>/free-sfx
    git clone --depth 1 https://github.com/funcoder/omarchy-ambient         <src>/omarchy-ambient
    git clone --depth 1 https://github.com/Boyquotes/kenney-impact-sounds-for-godot <src>/kenney-impact
    git clone --depth 1 https://github.com/Boyquotes/kenney-rpg-audio-for-godot     <src>/kenney-rpg
    git clone --depth 1 https://github.com/Boyquotes/kenney-interface-sounds        <src>/kenney-interface
then run:  python3 tools/sfx/build.py <src>
(needs numpy, scipy and ffmpeg with libvorbis and aac).

One-shots are trimmed, faded, high-passed and levelled to a common loudness; the
ambience loops are cut from long field recordings and cross-faded into seamless loops.
Each sound is written twice: Ogg Vorbis (Firefox, Chrome) and AAC .m4a (Safari).
"""

import glob
import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'client', 'public', 'sfx')
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sfx'


def find(pattern):
    hits = sorted(glob.glob(os.path.join(SRC, '**', pattern), recursive=True))
    hits = [h for h in hits if not h.endswith('.import')]
    if not hits:
        sys.exit(f'missing source: {pattern}')
    return hits[0]


def load(pattern, start=0.0, dur=None, rate=1.0):
    """Decode (a slice of) a source to mono float at SR; rate < 1 pitches it down."""
    args = ['ffmpeg', '-v', 'error', '-ss', str(start)]
    if dur:
        args += ['-t', str(dur * rate)]
    args += ['-i', find(pattern), '-ac', '1']
    if rate != 1.0:
        args += ['-af', f'aresample={SR},asetrate={int(SR * rate)},aresample={SR}']
    args += ['-ar', str(SR), '-f', 'f32le', '-']
    x = np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float32).astype(np.float64)
    return x - x.mean()


def hp(x, f):
    return sosfiltfilt(butter(2, f, 'highpass', fs=SR, output='sos'), x)


def lp(x, f):
    return sosfiltfilt(butter(2, f, 'lowpass', fs=SR, output='sos'), x)


def trim(x, thresh=0.006, pre=0.004, maxlen=None, tail=0.03):
    """Cut silence before the onset and after the decay; short fade at both ends."""
    pk = np.abs(x).max() or 1
    env = np.sqrt(np.convolve(x ** 2, np.ones(220) / 220, 'same'))
    on = np.where(env > pk * thresh)[0]
    if len(on):
        a = max(0, on[0] - int(pre * SR))
        b = min(len(x), on[-1] + int(0.02 * SR))
        x = x[a:b]
    if maxlen:
        x = x[: int(maxlen * SR)]
    return fade(x, 0.002, tail)


def fade(x, fin, fout):
    x = x.copy()
    n, m = min(int(fin * SR), len(x) // 4), min(int(fout * SR), len(x) // 2)
    if n:
        x[:n] *= np.linspace(0, 1, n) ** 2
    if m:
        x[-m:] *= np.linspace(1, 0, m) ** 2
    return x


def level(x, loud):
    """Scale so the loudest 50 ms sits at `loud` dBFS (peak capped at -1 dBFS)."""
    w = int(0.05 * SR)
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, 'valid').max()) if len(x) > w else np.sqrt((x ** 2).mean())
    g = 10 ** (loud / 20) / max(rms, 1e-9)
    g = min(g, 10 ** (-1 / 20) / max(np.abs(x).max(), 1e-9))
    return x * g


def mix(*parts):
    """Mix (signal, offset seconds, gain) tuples."""
    n = max(len(p) + int(o * SR) for p, o, _ in parts)
    y = np.zeros(n)
    for p, o, g in parts:
        i = int(o * SR)
        y[i:i + len(p)] += p * g
    return y


def seamless(x, length, xf=2.0):
    """A loop of `length` s: its end cross-faded (equal power) into its start."""
    L, X = int(length * SR), int(xf * SR)
    assert len(x) >= L + X, 'source too short for the loop'
    y = x[:L].copy()
    t = np.linspace(0, np.pi / 2, X)
    y[:X] = x[:X] * np.sin(t) + x[L:L + X] * np.cos(t)
    return y


written = []


def save(name, x):
    os.makedirs(OUT, exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    base = os.path.join(OUT, name)
    for ext, codec in (('ogg', ['-c:a', 'libvorbis', '-q:a', '3']), ('m4a', ['-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart'])):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', *codec, f'{base}.{ext}'],
                       input=pcm, check=True)
    written.append(name)
    print(f'{name:16s} {len(x) / SR:6.2f}s')


def shots(name, xs, loud=-14, hpf=60):
    for i, x in enumerate(xs):
        save(f'{name}-{i}', level(hp(x, hpf), loud))


# ── One-shots ────────────────────────────────────────────────────────────────

FS = 'Free-SFX'
LEAVES = '260130__splicesound__hand-digging-dirt-leaves-crunch.opus'

# The tool swinging through the air.
shots('swish', [trim(load(f'swosh-{n}.opus')) for n in ('02', '05', '07')], -16, 150)

# Axe into wood: a woody thunk on a solid chop.
shots('chop', [
    trim(mix((load('chop.ogg'), 0, 1), (load('wood_hit_07.opus'), 0.004, 0.6))),
    trim(mix((load('wood_hit_03.opus'), 0, 1), (load('impact_wood_light_001.ogg'), 0, 0.7))),
    trim(mix((load('wood_hit_09.opus'), 0, 1), (load('impact_plank_medium_001.ogg'), 0, 0.5)), maxlen=0.5),
], -12, 80)

# Shaking a tree: leaves.
shots('rustle', [fade(load(LEAVES, s, 0.65), 0.03, 0.2) for s in (0.7, 15.3)], -17, 300)

# Something falling out of the tree onto the grass.
shots('thud', [trim(mix((load(f'impact_soft_heavy_00{n}.ogg'), 0, 1), (load(f'footstep_grass_00{n}.ogg'), 0, 0.5))) for n in (0, 2)], -13, 40)

# Shovel into soil: the bite of the blade, then the dirt crunching.
shots('dig', [
    trim(mix((load(f'impact_soft_medium_00{n}.ogg'), 0, 0.8), (fade(load(LEAVES, s, 0.4), 0.005, 0.15), 0.01, 1)))
    for n, s in ((1, 7.45), (3, 13.45), (4, 16.75))
], -14, 70)

# Pick or tool on rock.
shots('clink', [trim(load(f'impact_mining_00{n}.ogg'), maxlen=0.7, tail=0.15) for n in (0, 1, 4)], -13, 120)

# Picking something up.
shots('pop', [trim(load(f'pluck_00{n}.wav')) for n in (1, 2)], -15, 150)

# Patting soil down over a seed.
shots('pat', [trim(mix((load(f'impact_soft_medium_00{n}.ogg'), 0, 1), (load(f'footstep_snow_00{n}.ogg'), 0, 0.35))) for n in (0, 2)], -15, 60)

# The bobber landing.
shots('plop', [trim(load('plop_01.opus')), trim(load('plop_02.opus')), trim(load('bubble_02.opus'))], -15, 120)

# A fish tugging at the bobber.
shots('bite', [trim(load('splash_09.opus'), maxlen=0.35, tail=0.1), trim(load('splash_10.opus'), maxlen=0.35, tail=0.1)], -14, 150)

# Reeled in: the fish (or nothing) leaves the water.
shots('splash', [trim(load('WaterSplashSlime/splash_04.opus'), tail=0.2), trim(load('WaterSplashSlime/splash_02.opus'), tail=0.2)], -13, 100)

# The reel's ratchet.
shots('reel', [fade(load('507077__paulprit__angel-fly-fish-reel-slow-wind_2.opus', 1.0, 0.7), 0.01, 0.12)], -22, 400)

# Caught something: a bright little chime.
shots('jingle', [trim(load('confirmation_002.wav'), tail=0.15)], -15, 150)

# Refused: a soft dull bonk.
shots('bonk', [trim(load('bong_001.wav'))], -14, 60)

# Laying (or lifting) a stone path.
shots('scrape', [trim(load('scrape1.opus'), tail=0.1), trim(load('scrape2.opus'), maxlen=0.6, tail=0.15)], -16, 150)

# Earth and rock shifting when terraforming cliffs.
shots('rumble', [
    trim(mix((load('bfh1_rock_falling_02.opus'), 0, 1), (load('impact_soft_heavy_001.ogg'), 0, 0.7)), tail=0.2),
    trim(mix((load('bfh1_rock_falling_04.opus'), 0, 1), (load('impact_soft_heavy_003.ogg'), 0, 0.7)), tail=0.2),
], -13, 40)

# Digging out water.
shots('gurgle', [fade(load('bubbling_1.opus', 3.1, 0.75), 0.02, 0.2), fade(load('bubbling_1.opus', 3.6, 0.75), 0.02, 0.2)], -15, 120)

# Placing furniture / stairs: wood on wood.
shots('knock', [trim(load(f'impact_wood_light_00{n}.ogg')) for n in (0, 2, 4)], -14, 80)

# Building: a hammer on wood.
shots('hammer', [trim(load('wood_hammer_01.opus')), trim(load('wood_hammer_02.opus'))], -12, 80)

# Steps while wading in the shallows.
shots('wade', [trim(load(f'sfx100v2_footstep_wet_0{n}.opus'), tail=0.08) for n in (1, 2, 3)]
      + [trim(load('WaterSplashSlime/splash_06.opus'), maxlen=0.35, tail=0.12)], -17, 150)

# Thunder, cut from a real storm recording: far-off rolls, and close cracks and booms.
STORM = 'storm.ogg'
# (Low-passed to leave the rain of the recording behind: the game has its own.)
shots('thunder', [fade(lp(lp(load(STORM, s, d), 1100), 1100), 0.6, 2.5) for s, d in ((88.5, 13), (187.5, 12.5), (321.5, 10))], -10, 25)
shots('thunderClose', [
    fade(lp(load(STORM, 233.0, 18), 2400), 0.25, 3),
    fade(lp(load(STORM, 273.5, 22), 2400), 0.25, 3.5),
    trim(load('sfx100v2_thunder_01.opus'), tail=1.0),
], -9, 25)

# ── Ambience loops ───────────────────────────────────────────────────────────


def loop(name, x, length, loud, hpf=40):
    y = seamless(hp(x, hpf), length)
    rms = np.sqrt((y ** 2).mean())
    y = y * min(10 ** (loud / 20) / rms, 10 ** (-1 / 20) / np.abs(y).max())
    save(name, y)


loop('rain', load('omarchy-ambient/sounds/rain.ogg', 20, 35), 32, -17)
loop('river', load('omarchy-ambient/sounds/stream.ogg', 30, 35), 32, -17)
loop('sea', load('omarchy-ambient/sounds/waves.ogg', 40, 43), 40, -17)
loop('wind', load('omarchy-ambient/sounds/wind.ogg', 60, 43), 40, -17)

# A waterfall: the stream, layered at lower pitches into a dense roar.
fall = sum(g * lp(load('omarchy-ambient/sounds/stream.ogg', s, 35, rate=r), 7000)
           for s, r, g in ((90, 1.0, 0.6), (130, 0.8, 0.9), (170, 0.66, 1.0), (210, 0.55, 0.8)))
loop('fall', fall, 32, -16)

# Cicadas: two recordings strung together with gaps, as they swell and pause.
c1, c2 = load('cicada_1.opus'), load('cicada_2.opus')
cic = mix((c1, 0, 1), (c2, 4.6, 0.9), (c1, 10.6, 0.8), (c2, 14.4, 1.0))
loop('cicada', np.concatenate([cic, np.zeros(int(4 * SR))]), 20, -24, 2000)

# A manifest the game reads: how many variants each sound has.
counts = {}
for n in written:
    base, _, i = n.rpartition('-')
    if base and i.isdigit():
        counts[base] = counts.get(base, 0) + 1
    else:
        counts[n] = 0  # a loop
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(counts, f, indent=1, sort_keys=True)
print('wrote', len(written), 'sounds to', OUT)
