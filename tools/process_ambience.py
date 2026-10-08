# Blender batch script:  blender -b --factory-startup -P tools/process_ambience.py -- PROJECT_ROOT
# Turns the CC0 Freesound field recordings into seamless stereo loops (end crossfaded into the start), level-matched.
import aud, os, sys
import numpy as np

root = sys.argv[sys.argv.index('--') + 1]
src = os.path.join(root, 'tools', 'source_assets', 'freesound', 'ambience')
out = os.path.join(root, 'public', 'assets', 'audio', 'ambience')
os.makedirs(out, exist_ok=True)
# output loop -> (source recording, target RMS). The Atacama wind recording is the woodland wind bed.
JOBS = {'wind': ('desert', 0.08), 'battle': ('battle', 0.06)}
for name, (source, rms) in JOBS.items():
    s = aud.Sound(os.path.join(src, source + '.mp3')).resample(44100, False)
    x = s.data().astype(np.float32)
    if x.ndim == 1: x = x[:, None]
    if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
    x = x[:, :2]
    F = int(44100 * 3.0)                      # 3 s crossfade
    body = x[:-F].copy()
    t = np.linspace(0, 1, F, dtype=np.float32)[:, None]
    body[:F] = x[:F] * np.sqrt(t) + x[-F:] * np.sqrt(1 - t)   # equal-power: the tail flows into the head
    body *= rms / max(1e-6, float(np.sqrt(np.mean(body ** 2))))
    body = np.clip(body, -0.98, 0.98)
    snd = aud.Sound.buffer(body, 44100)
    snd.write(os.path.join(out, name + '.ogg'), rate=44100, channels=aud.CHANNELS_STEREO, format=aud.FORMAT_S16,
              container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=96000)
    print('AMB', name, round(len(body) / 44100, 1), 's')
