"""Convert the CC0 PBR AKM (OpenGameArt) into the VIPER BR's game frame, with a separate magazine for reloads.
Usage: blender -b tools/source_assets/oga/akm.blend -P tools/upgrade_akm.py -- PROJECT_ROOT
Run after the Guns step (it edits meta.json).

Game frame (Blender axes): muzzle towards +Y, up +Z, trigger at y = 0, bore at z = 0.05.
"""
import bpy, json, sys
from pathlib import Path
from mathutils import Vector, Matrix

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out = root / 'public/assets/models/guns'
LENGTH, TRIGGER_Y = 0.97, -0.13          # real AKM length; trigger position in the source (measured from a side render)

ob = bpy.data.objects['AKM']
for o in list(bpy.context.scene.objects):
    if o is not ob: bpy.data.objects.remove(o, do_unlink=True)
ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
for im in bpy.data.images:
    if im.size[0] > 1024: im.scale(1024, 1024)

# split the magazine off (loose parts below the receiver, in front of the trigger guard)
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def centre(o):
    vs = [v.co for v in o.data.vertices]
    return Vector(tuple((min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)))
mag = [o for o in parts if (lambda c: c.z < -0.06 and -0.075 < c.y < 0.10)(centre(o))]
body = [o for o in parts if o not in mag]
def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name
    return o
made = {'Body': join(body, 'Body')}
if mag: made['Magazine'] = join(mag, 'Magazine')

allv = [v.co for o in made.values() for v in o.data.vertices]
front = max(v.y for v in allv); rear = min(v.y for v in allv)
tip = [v for v in allv if v.y > front - 0.01]
bore = sum(v.z for v in tip) / len(tip); cx = sum(v.x for v in tip) / len(tip)
scale = LENGTH / (front - rear)
T = Matrix.Translation(Vector((0, 0, 0.05))) @ Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-cx, -TRIGGER_Y, -bore)))
for o in made.values(): o.data.transform(T)
if 'Magazine' in made:
    m = made['Magazine']; c = centre(m)
    m.data.transform(Matrix.Translation(-c)); m.location = c
bpy.context.view_layer.update()

game = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
world = [o.matrix_world @ v.co for o in made.values() for v in o.data.vertices]
lo = Vector(tuple(min(v[i] for v in world) for i in range(3))); hi = Vector(tuple(max(v[i] for v in world) for i in range(3)))
bodyv = [made['Body'].matrix_world @ v.co for v in made['Body'].data.vertices]
# optic mount on the dust cover just ahead of the grip; support hand under the handguard
mount_y = 0.06
mount_z = max(v.z for v in bodyv if abs(v.y - mount_y) < 0.03)
fore_y = 0.30
fore_z = min(v.z for v in bodyv if abs(v.y - fore_y) < 0.03)
meta = json.loads((out / 'meta.json').read_text())
meta['viper'] = {
    'file': 'viper_pbr.glb', 'parts': list(made), 'opticRiser': 0.008,
    'points': {'Attach_Muzzle': game(Vector((0, hi.y, 0.05))), 'Attach_Scope': game(Vector((0, mount_y, mount_z))),
               'Attach_Rail.Bottom': game(Vector((0, fore_y, fore_z + 0.01))), 'Trigger': [0, 0, 0]},
    'min': game(Vector((lo.x, hi.y, lo.z))), 'max': game(Vector((hi.x, lo.y, hi.z))),
    'tops': {'Body': round(max(v.z for v in bodyv), 5)},
    'source': 'https://opengameart.org/content/akm', 'license': 'CC0',
}
bpy.ops.export_scene.gltf(filepath=str(out / 'viper_pbr.glb'), export_format='GLB', export_yup=True,
                          export_animations=False, export_skins=False, export_image_format='JPEG')
(out / 'meta.json').write_text(json.dumps(meta, indent=1))
print('AKM_EXPORT', json.dumps({'mag_parts': len(mag), 'tris': sum(len(p.vertices) - 2 for o in made.values() for p in o.data.polygons), **meta['viper']}))
