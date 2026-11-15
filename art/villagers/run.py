# Runs build steps inside Blender and records how each went (the MCP call can time out
# while Blender keeps working, so callers poll status.json).
import json, time, traceback, os
ART = r'C:\Users\Tobias\hearthwood-art'
STATUS = ART + r'\villagers\status.json'


def run_steps(steps, g=None):
    g = g if g is not None else {'ART': ART, '__name__': 'villager'}
    log = []
    json.dump({'running': steps, 'done': False}, open(STATUS, 'w'))
    for st in steps:
        t = time.time()
        try:
            exec(open(ART + '\\villagers\\' + st, encoding='utf-8').read(), g)
            log.append([st, 'ok', round(time.time() - t, 1), g.get('result')])
        except Exception:
            log.append([st, 'error', traceback.format_exc()[-1500:]])
            break
    json.dump({'log': log, 'done': True}, open(STATUS, 'w'), default=str)
    return g
