"""Convert CC0 OpenGameArt gun .blend files (in tools/source_assets/oga/) into game guns.
Usage: blender -b --factory-startup -P tools/upgrade_oga_guns.py -- PROJECT_ROOT
Run after the Guns step (it merges into meta.json).

Game frame (Blender axes): muzzle towards +Y, up +Z, trigger at y = 0, bore at z = 0.05.
Untextured sources get gunmetal / wood materials by part (named so the game's material tuning recognises them).
"""
import bpy, json, sys
from pathlib import Path
from mathutils import Vector, Matrix

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
src_dir = root / 'tools/source_assets/oga'
out = root / 'public/assets/models/guns'
AK_WOOD = ['Plane.010', 'Plane.003', 'Circle.010', 'Circle.007', 'Circle.004']
AK_MAG = ['clip', 'clip.001', 'clip.002', 'Cube.006']
JOBS = [
    {'id': 'strelka', 'src': 'highpoly_ak47.blend', 'length': 0.88, 'trigger': 'Plane.002', 'mag': AK_MAG, 'wood': AK_WOOD, 'fore': 0.42,
     'url': 'https://opengameart.org/content/high-poly-ak-47'},
    {'id': 'rpk', 'src': 'highpoly_ak47.blend', 'length': 1.04, 'trigger': 'Plane.002', 'mag': AK_MAG, 'wood': AK_WOOD, 'fore': 0.42,
     'url': 'https://opengameart.org/content/high-poly-ak-47'},
    {'id': 'vigil', 'src': 'Benelli_M1.blend', 'length': 0.99, 'trigger': 'Plane.003', 'wood': ['Plane.002', 'Plane'], 'fore': 0.45,
     'url': 'https://opengameart.org/content/benelli-m1'},
    {'id': 'marshal', 'src': 'STENNORMALFINISHED.blend', 'length': 0.76, 'trigger': 'Cube.009', 'mag': ['Cube.002'], 'fore': 0.3, 'sight': 'body',
     'url': 'https://opengameart.org/content/sten-smg'},
    {'id': 'warhawk', 'src': 'deagle/Export/Desert Eagle Export.blend', 'length': 0.27, 'trigger': 'Trigger', 'pistol': True, 'keep_mats': True,
     'mag': ['Magazine', 'Bullets'], 'slide': ['Slide', 'Ironsights Back', 'Safety', 'Safety Screw'], 'front': 'Ironsights Front',
     'url': 'https://opengameart.org/content/desert-eagle-0'},
]

def mat(name, rgb, rough, metal):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; m.use_backface_culling = False
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m

meta = json.loads((out / 'meta.json').read_text())
for job in JOBS:
    bpy.ops.wm.open_mainfile(filepath=str(src_dir / job['src']))
    scene = bpy.context.scene
    # subdivision is for offline renders: leave it off (it multiplies the triangle count by 4-16x)
    for o in scene.objects:
        for m in getattr(o, 'modifiers', []):
            if m.type == 'SUBSURF': m.show_viewport = False
    deps = bpy.context.evaluated_depsgraph_get()
    meshes = {}
    for o in list(scene.objects):
        if o.type != 'MESH' or o.hide_render or o.hide_get() or not o.visible_get():
            continue
        # bake modifiers and transforms into a fresh mesh per object
        me = bpy.data.meshes.new_from_object(o.evaluated_get(deps))
        me.transform(o.matrix_world)
        meshes[o.name] = me
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    objs = {}
    for n, me in meshes.items():
        ob = bpy.data.objects.new(n, me); scene.collection.objects.link(ob); objs[n] = ob
    if not job.get('keep_mats'):
        metal, wood = mat('Black_Metal', (0.035, 0.037, 0.04), 0.42, 0.75), mat('Brown_Wood', (0.2, 0.1, 0.05), 0.6, 0.0)
        for n, ob in objs.items():
            ob.data.materials.clear(); ob.data.materials.append(wood if n in job.get('wood', []) else metal)
            for poly in ob.data.polygons: poly.material_index = 0
    allv = [v.co.copy() for ob in objs.values() for v in ob.data.vertices]
    ext = [max(v[i] for v in allv) - min(v[i] for v in allv) for i in range(3)]
    ax = 0 if ext[0] >= ext[1] else 1
    tv = [v.co for v in objs[job['trigger']].data.vertices]; tc = sum(tv, Vector()) / len(tv)
    lo, hi = min(v[ax] for v in allv), max(v[ax] for v in allv)
    muzzle_hi = hi - tc[ax] > tc[ax] - lo     # the muzzle is the end farther from the trigger
    if ax == 0: R = Matrix.Rotation(1.5707963 if muzzle_hi else -1.5707963, 4, 'Z')
    else: R = Matrix.Identity(4) if muzzle_hi else Matrix.Rotation(3.1415927, 4, 'Z')
    rv = [R @ v for v in allv]
    front, rear = max(v.y for v in rv), min(v.y for v in rv)
    tip = [v for v in rv if v.y > front - (front - rear) * 0.012]
    bore = sum(v.z for v in tip) / len(tip); cx = sum(v.x for v in tip) / len(tip)
    scale = job['length'] / (front - rear)
    T = Matrix.Translation(Vector((0, 0, 0.05))) @ Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-cx, -(R @ tc).y, -bore))) @ R
    for ob in objs.values(): ob.data.transform(T)
    front_top = None
    if job.get('front') in objs: front_top = max(v.co.z for v in objs[job['front']].data.vertices)
    def join(names, name):
        sel = [objs[n] for n in names if n in objs]
        if not sel: return None
        bpy.ops.object.select_all(action='DESELECT')
        for o in sel: o.select_set(True)
        bpy.context.view_layer.objects.active = sel[0]
        if len(sel) > 1: bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active; o.name = name
        for n in names: objs.pop(n, None)
        return o
    made = {}
    if job.get('mag'): made['Magazine'] = join(job['mag'], 'Magazine')
    if job.get('slide'): made['Slide'] = join(job['slide'], 'Slide')
    made['Body'] = join(list(objs), 'Body')
    made = {k: v for k, v in made.items() if v}
    tris = sum(len(p.vertices) - 2 for o in made.values() for p in o.data.polygons)
    if tris > job.get('tris', 16000):
        for o in made.values():
            bpy.context.view_layer.objects.active = o
            d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = job.get('tris', 16000) / tris
            bpy.ops.object.modifier_apply(modifier=d.name)
    for name, o in made.items():
        if name == 'Body': continue
        pts = [v.co for v in o.data.vertices]
        pivot = Vector(tuple((min(v[i] for v in pts) + max(v[i] for v in pts)) / 2 for i in range(3)))
        o.data.transform(Matrix.Translation(-pivot)); o.location = pivot
    bpy.context.view_layer.update()
    game = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
    world = [o.matrix_world @ v.co for o in made.values() for v in o.data.vertices]
    lo3 = Vector(tuple(min(v[i] for v in world) for i in range(3))); hi3 = Vector(tuple(max(v[i] for v in world) for i in range(3)))
    gfront = hi3.y
    if front_top is None:   # sight line = top of the front sight (the frontmost few % of the gun)
        front_top = max(v.z for v in world if v.y > gfront - (gfront - lo3.y) * 0.07)
    body = [made['Body'].matrix_world @ v.co for v in made['Body'].data.vertices]
    if job.get('sight') == 'body': front_top = max(v.z for v in body)   # rear peep sight is the highest point
    tops = {'Body': round(max(v.z for v in body), 5), 'Rear Sights': round(front_top + 0.004, 5)}
    if 'Slide' in made: tops['Slide'] = round(max((made['Slide'].matrix_world @ v.co).z for v in made['Slide'].data.vertices), 5)
    pts = {'Attach_Muzzle': game(Vector((0, gfront, 0.05))), 'Trigger': [0, 0, 0]}
    if not job.get('pistol'):
        fy = job.get('fore', 0.4) * gfront
        near = [v for v in body if abs(v.y - fy) < 0.03] or body
        pts['Attach_Rail.Bottom'] = game(Vector((0, fy, min(v.z for v in near) + 0.01)))
    for im in bpy.data.images:
        if im.size[0] > 1024: im.scale(1024, 1024)
    meta[job['id']] = {'file': job['id'] + '_oga.glb', 'parts': list(made), 'points': pts,
                       'min': game(Vector((lo3.x, hi3.y, lo3.z))), 'max': game(Vector((hi3.x, lo3.y, hi3.z))), 'tops': tops,
                       'source': job['url'], 'license': 'CC0'}
    for o in list(scene.objects):
        if o not in made.values(): bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=str(out / (job['id'] + '_oga.glb')), export_format='GLB', export_yup=True,
                              export_animations=False, export_skins=False, export_image_format='JPEG', use_selection=False)
    print('OGA_EXPORT', job['id'], json.dumps({'tris': sum(len(p.vertices) - 2 for o in made.values() for p in o.data.polygons), 'parts': list(made), 'tops': tops}))
    (out / 'meta.json').write_text(json.dumps(meta, indent=1))
