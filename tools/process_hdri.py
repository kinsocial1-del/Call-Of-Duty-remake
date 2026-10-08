# Blender batch script:  blender -b --factory-startup -P tools/process_hdri.py -- PROJECT_ROOT
# For each sky: copies the 1k HDR (image-based lighting) and bakes the 4k HDR into a sharp LDR JPEG background.
# meta.json records `bgScale`, the factor that restores the JPEG to the HDR's physical brightness in three.js.
import bpy, json, os, shutil, sys
import numpy as np

root = sys.argv[sys.argv.index('--') + 1]
src = os.path.join(root, 'tools', 'source_assets', 'hdri')
out = os.path.join(root, 'public', 'assets', 'hdri')
os.makedirs(out, exist_ok=True)
SKIES = {'forest': 'kloofendal_48d_partly_cloudy_puresky'}
meta = {}
PCT = {}  # per-sky exposure percentile override (a hazy, bright sky exposes for the haze, not the sun glow)
for key, name in SKIES.items():
    shutil.copy(os.path.join(src, name + '_1k.hdr'), os.path.join(out, key + '_env.hdr'))
    im = bpy.data.images.load(os.path.join(src, name + '_4k.hdr'))
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    lum = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    k = 0.92 / float(np.percentile(lum[h // 2:], PCT.get(key, 99.0)))   # upper hemisphere (Blender rows run bottom-up); the sun clips
    lin = np.clip(px * k, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    outim = bpy.data.images.new(key + '_bg', w, h, alpha=False)
    rgba = np.concatenate([srgb, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    outim.pixels.foreach_set(rgba.astype(np.float32).ravel())
    outim.filepath_raw = os.path.join(out, key + '_bg.jpg')
    outim.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    outim.save()
    meta[key] = {'env': key + '_env.hdr', 'bg': key + '_bg.jpg', 'bgScale': round(1 / k, 5), 'source': name}
    print('sky', key, meta[key])
json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
