# Blender-Python batch script:  blender -b --factory-startup -P tools/process_foley.py -- tools/foley.json
# Cuts game sound effects out of CC0 recordings (Freesound previews, Kenney Impact Sounds):
# each entry takes a time window from a source file, trims silence, fades the tail and writes mono 48 kHz .ogg.
import json, os, sys
import numpy as np
import aud

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
out_dir = os.path.join(root, cfg['out'])
os.makedirs(out_dir, exist_ok=True)
sources = {k: os.path.join(root, v) if not os.path.isabs(v) else v for k, v in cfg['sources'].items()}
cache = {}


def load(path):
    if path not in cache:
        s = aud.Sound(path)
        x = s.data()
        x = x.mean(axis=1) if x.ndim > 1 else x
        cache[path] = (x.astype(np.float32), int(s.specs[0]))
    return cache[path]


def resample(x, src, dst):
    if src == dst:
        return x
    n = int(len(x) * dst / src)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


manifest = {}
for key, cuts in cfg['sounds'].items():
    manifest[key] = []
    for i, cut in enumerate(cuts):
        src = cut['src']
        path = sources[src.split(':')[0]] + (src.split(':', 1)[1] if ':' in src else '')
        x, rate = load(path)
        a = int(cut.get('from', 0) * rate)
        b = int(cut['to'] * rate) if 'to' in cut else len(x)
        seg = x[a:b].copy()
        # trim leading/trailing silence (-45 dB of the slice's peak)
        p = np.abs(seg).max() or 1.0
        loud = np.nonzero(np.abs(seg) > p * 10 ** (-45 / 20))[0]
        if len(loud):
            seg = seg[max(0, loud[0] - int(rate * 0.003)): loud[-1] + 1]
        fin = min(len(seg) // 4, int(rate * 0.004))
        if fin:
            seg[:fin] *= np.linspace(0, 1, fin)
        fade = min(len(seg) // 3, int(rate * cut.get('fade', 0.08)))
        if fade:
            seg[-fade:] *= np.linspace(1, 0, fade) ** 2
        y = resample(seg, rate, 48000)
        y = y / max(1e-6, np.abs(y).max()) * 0.95
        name = f'{key}_{i}.ogg'
        snd = aud.Sound.buffer(y.reshape(-1, 1), 48000)
        snd.write(os.path.join(out_dir, name), rate=48000, channels=aud.CHANNELS_MONO, format=aud.FORMAT_S16,
                  container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=112000)
        manifest[key].append({'file': name, 'len': round(len(y) / 48000, 2)})
    print('foley', key, [(f['file'], f['len']) for f in manifest[key]])

json.dump(manifest, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1)
print('wrote', sum(len(v) for v in manifest.values()), 'sounds')
