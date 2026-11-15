# Stills of each clip and an MP4 of the showreel (run after cat_anim.py).
import os
exec(open(ART + r'\villagers\preview.py', encoding='utf-8').read())
co = setup_render(520)
sc = bpy.context.scene
wear()
use_coat('orange_tabby')
OUT = ART + r'\villagers\anim'
os.makedirs(OUT, exist_ok=True)


def reel_start(name):
    t = 0
    for n_, d in REEL:
        if n_ == name:
            return t
        t += d


STILLS = [('idle', 0), ('walk', 5), ('run', 3), ('chase', 4), ('surprised', 10), ('laugh', 20), ('sad', 30), ('walk_sad', 7),
          ('gift', 20), ('gift', 46), ('sit_chair', 20), ('sit_ground', 20), ('umbrella_open', 12), ('umbrella_open', 33), ('umbrella_walk', 5), ('umbrella_close', 7)]
if MODE in ('stills', 'both') and not globals().get('SKIP_STILLS'):
    for i, (name, f) in enumerate(STILLS):
        sc.frame_set(reel_start(name) + f)
        shoot(co, OUT + f'\\s{i:02d}_{name}_{f}.png', 30, 10, 3.9, (0, 0, 0.78))
if MODE in ('video', 'both'):
    sc.render.resolution_x = sc.render.resolution_y = 480
    try:
        sc.eevee.taa_render_samples = 8
    except Exception:
        pass
    az, el, dist, tgt = 30, 10, 4.1, (0, 0, 0.8)
    shoot_pos = None
    t = Vector(tgt)
    a, e = math.radians(az), math.radians(el)
    co.location = t + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    co.rotation_euler = (t - co.location).to_track_quat('-Z', 'Y').to_euler()
    try:
        sc.render.image_settings.media_type = 'VIDEO'  # Blender 5: video output is its own media type
    except (AttributeError, TypeError):
        pass
    sc.render.image_settings.file_format = 'FFMPEG'
    sc.render.ffmpeg.format = 'MPEG4'
    sc.render.ffmpeg.codec = 'H264'
    sc.render.ffmpeg.constant_rate_factor = 'MEDIUM'
    sc.render.filepath = OUT + r'\showreel.mp4'
    bpy.ops.render.render(animation=True)
result = 'rendered ' + MODE
