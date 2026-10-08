# Blender-Python batch script (Blender bundles numpy + an Ogg encoder):
#   blender -b --factory-startup -P tools/process_sfx.py -- tools/sfx.json
# Slices individual gunshots out of the CC0 "Free Firearm Sound Library" recordings
# (96 kHz / 24-bit stereo takes with long silences), trims each shot's tail, fades it out,
# downmixes to mono 48 kHz and writes game-ready .ogg files.
import json, os, re, sys, wave
import numpy as np
import aud

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
lib = os.path.join(root, cfg['library'])
out_dir = os.path.join(root, cfg['out'])
os.makedirs(out_dir, exist_ok=True)

# the master sheet maps every file to a gun + description ("near distance" / "mid distance", single vs burst)
sheet = open(os.path.join(lib, 'Prepared Master Sheet.csv'), encoding='utf-8', errors='ignore').read()
rows = re.findall(r'([A-Z]_\d+P\.wav),([^,]*),\d+,\d+,,"([^"]*)"', sheet)


def find(gun, dist):
    for fn, cd, desc in rows:
        d = desc.lower()
        if cd.strip().lower().startswith(gun.lower()) and f'{dist} distance' in d and 'gunshots' not in d:
            for dirpath, _, files in os.walk(lib):
                if fn in files:
                    return os.path.join(dirpath, fn)
    raise SystemExit(f'no {dist} take for {gun}')


def read(path):
    w = wave.open(path)
    ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = np.frombuffer(w.readframes(n), dtype=np.uint8)
    if sw == 3:
        b = raw.reshape(-1, 3).astype(np.int32)
        s = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16))
        s = np.where(s & 0x800000, s - 0x1000000, s).astype(np.float32) / 8388608.0
    else:
        s = np.frombuffer(raw.tobytes(), dtype=np.int16).astype(np.float32) / 32768.0
    return s.reshape(-1, ch).mean(axis=1), rate


def shots(x, rate, max_len, count):
    env = np.abs(x)
    peak = env.max()
    hop = int(rate * 0.005)
    frames = env[: len(env) // hop * hop].reshape(-1, hop).max(axis=1)
    thr = peak * 0.3
    onsets, quiet = [], 999
    for i, v in enumerate(frames):
        if v > thr and quiet * 0.005 > 0.3:
            onsets.append(i * hop)
        quiet = 0 if v > thr * 0.5 else quiet + 1
    out = []
    for k, on in enumerate(onsets[:count]):
        start = max(0, on - int(rate * 0.004))
        nxt = onsets[k + 1] - int(rate * 0.02) if k + 1 < len(onsets) else len(x)
        end = min(nxt, start + int(rate * max_len))
        seg = x[start:end].copy()
        # cut once the tail has decayed ~50 dB below this shot's peak
        win = int(rate * 0.02)
        rms = np.sqrt(np.convolve(seg ** 2, np.ones(win) / win, mode='same'))
        p = rms.max()
        loud = np.nonzero(rms > p * 10 ** (-50 / 20))[0]
        if len(loud):
            seg = seg[: loud[-1] + 1]
        fade = min(len(seg) // 3, int(rate * 0.12))
        seg[-fade:] *= np.linspace(1, 0, fade) ** 2
        out.append(seg)
    return out


def resample(x, src, dst):
    if src == dst:
        return x
    n = int(len(x) * dst / src)
    # windowed average before linear interpolation keeps it from aliasing
    k = max(1, int(round(src / dst)))
    if k > 1:
        x = np.convolve(x, np.ones(k) / k, mode='same')
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


manifest = {}
for key, spec in cfg['sounds'].items():
    files = []
    for dist, tag, max_len in (('near', '', spec.get('near_len', 1.5)), ('mid', '_far', spec.get('far_len', 2.4))):
        x, rate = read(find(spec['gun'], dist))
        segs = shots(x, rate, max_len, spec.get('variants', 3))
        for i, seg in enumerate(segs):
            y = resample(seg, rate, 48000)
            y = y / max(1e-6, np.abs(y).max()) * 0.95
            name = f'{key}{tag}_{i}.ogg'
            snd = aud.Sound.buffer(y.reshape(-1, 1).astype(np.float32), 48000)
            snd.write(os.path.join(out_dir, name), rate=48000, channels=aud.CHANNELS_MONO, format=aud.FORMAT_S16,
                      container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=128000)
            files.append({'file': name, 'far': dist == 'mid', 'len': round(len(y) / 48000, 2)})
    manifest[key] = files
    print('sfx', key, [(f['file'], f['len']) for f in files])

json.dump(manifest, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1)
print('wrote', sum(len(v) for v in manifest.values()), 'sounds')
