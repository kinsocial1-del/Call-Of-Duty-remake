# Blender batch script:  blender -b --factory-startup -P tools/convert_launcher.py
# Converts the CC0 "Low Poly RPG7" (OpenGameArt) into the game's launcher model + meta entry:
# straightens the tilted model with PCA, finds both grips from the geometry, and normalises it into the
# weapon frame (muzzle toward -Z, up +Y, trigger grip at z = 0, bore at y = 0.05).
import bpy, json, os
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source_assets', 'rpg7', 'RPG7.fbx')
OUT = os.path.join(HERE, '..', 'public', 'assets', 'models', 'guns')
LENGTH = 1.3

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
for n in ('Cube', 'Light', 'Camera'):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
tube = bpy.data.objects['RPG7']
rocket = bpy.data.objects['RPG7 Rocket']
for o in (tube, rocket):
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

# principal axis of the whole weapon -> +Y (forward), grips hanging toward -Z
pts = np.array([v.co[:] for o in (tube, rocket) for v in o.data.vertices])
c = pts.mean(axis=0)
w, vecs = np.linalg.eigh(np.cov((pts - c).T))
axis = Vector(vecs[:, np.argmax(w)]).normalized()
rc = np.array([v.co[:] for v in rocket.data.vertices]).mean(axis=0)
if Vector(rc - c).dot(axis) < 0:
    axis = -axis                      # point at the rocket end
R = axis.rotation_difference(Vector((0, 1, 0))).to_matrix().to_4x4()
for o in (tube, rocket):
    o.data.transform(R @ Matrix.Translation(-Vector(c)))
# roll so the grips hang down: the grips are the vertices furthest from the tube axis
tv = np.array([v.co[:] for v in tube.data.vertices])
r = np.hypot(tv[:, 0], tv[:, 2])
far = tv[r > np.percentile(r, 97)]
down = Vector((far[:, 0].mean(), 0, far[:, 2].mean())).normalized()
roll = down.rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4()
for o in (tube, rocket):
    o.data.transform(roll)

tv = np.array([v.co[:] for v in tube.data.vertices])
allv = np.concatenate([tv, np.array([v.co[:] for v in rocket.data.vertices])])
s = LENGTH / (allv[:, 1].max() - allv[:, 1].min())
# grips: geometry well below the tube, split into a front and a rear cluster along the axis
tube_r = np.median(np.hypot(tv[:, 0], tv[:, 2]))
y0, y1 = allv[:, 1].min(), allv[:, 1].max()
mid = (tv[:, 1] > y0 + 0.3 * (y1 - y0)) & (tv[:, 1] < y0 + 0.75 * (y1 - y0))   # skip the rear blast bell
low = tv[mid & (tv[:, 2] < -tube_r * 1.8)]
split = (low[:, 1].min() + low[:, 1].max()) / 2
front, rear = low[low[:, 1] > split], low[low[:, 1] <= split]
trig_y = front[:, 1].mean()
T = Matrix.Translation(Vector((0, 0, 0.05))) @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((0, -trig_y, 0)))
for o in (tube, rocket):
    o.data.transform(T)


def g(v):  # Blender -> three.js weapon frame
    return [round(float(v[0]), 5), round(float(v[2]), 5), round(float(-v[1]), 5)]


tv = np.array([v.co[:] for v in tube.data.vertices])
rv = np.array([v.co[:] for v in rocket.data.vertices])
tube_r = np.median(np.hypot(tv[:, 0], tv[:, 2] - 0.05))
front_y = tv[:, 1].max()
rear_grip = ((rear[:, 1].mean() - trig_y) * s)
meta_entry = {
    'file': 'striker.glb', 'parts': ['Body', 'Magazine'],
    'points': {
        'Trigger': [0.0, round(0.05 - tube_r, 5), 0.0],
        'Attach_Muzzle': g(Vector((0, front_y, 0.05))),
        'Attach_Rail.Bottom': g(Vector((0, rear_grip, 0.05 - tube_r - 0.01))),
    },
    'min': g(Vector((tv[:, 0].min(), tv[:, 1].max(), tv[:, 2].min()))),
    'max': g(Vector((tv[:, 0].max(), tv[:, 1].min(), tv[:, 2].max()))),
    'tops': {'Body': round(float(tv[:, 2].max()), 5)},
}
tube.name = 'Body'
rocket.name = 'Magazine'
pivot = Vector(rv.mean(axis=0))
rocket.data.transform(Matrix.Translation(-pivot))
rocket.location = pivot
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'striker.glb'), export_format='GLB', export_yup=True, export_image_format='JPEG')
meta_path = os.path.join(OUT, 'meta.json')
meta = json.load(open(meta_path))
meta['striker'] = meta_entry
json.dump(meta, open(meta_path, 'w'), indent=1)
print('launcher', meta_entry)
