"""Swap Poly Haven's photoscanned CC0 firearms in for flat-shaded models, in the game's gun frame.
Usage: blender -b --factory-startup -P tools/upgrade_ph_guns.py -- PROJECT_ROOT
Run after the Guns step (it edits meta.json). Source glTFs come from tools/fetch_polyhaven.py.

Game frame (Blender axes): muzzle towards +Y, up +Z, trigger at y = 0, bore at z = 0.05.
"""
import bpy, bmesh, json, sys
from pathlib import Path
from mathutils import Vector, Matrix

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
out = root / 'public/assets/models/guns'
JOBS = [
    {   # LONGBOW .338: bolt-action rifle with its own scope (the game's procedural optic is skipped)
        'id': 'longbow', 'src': 'bolt_action_rifle_7_62', 'length': 1.25,
        'drop': ['bullet'], 'parts': {'Bolt': ['bolt_a', 'bolt_b']}, 'scope': 'scope', 'trigger': 'trigger',
    },
    {   # P-17 SIDEARM: service pistol (variant A, loaded magazine)
        'id': 'p17', 'src': 'service_pistol', 'length': 0.215,
        'keep': ['pistol_a', 'slide_a', 'magazine_loaded', 'hammer_a', 'trigger_a'],
        'parts': {'Slide': ['slide_a'], 'Magazine': ['magazine_loaded']}, 'trigger': 'trigger_a', 'pistol': True,
        'move': {'magazine_loaded': (0.100, 0.0, 0.002)},   # the scan lays the spare magazine beside the gun; seat it in the grip
    },
]

meta = json.loads((out / 'meta.json').read_text())
for job in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    src = root / 'tools/source_assets/polyhaven' / job['src']
    bpy.ops.import_scene.gltf(filepath=str(src / f"{job['src']}_1k.gltf"))
    short = lambda o: o.name.replace(job['src'] + '_', '')
    meshes = []
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        n = short(o)
        if ('keep' in job and n not in job['keep']) or any(d in n for d in job.get('drop', [])):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        meshes.append(o)
    # bake every transform into the mesh data
    for o in meshes:
        w = o.matrix_world.copy()
        o.parent = None
        o.data.transform(w); o.matrix_world = Matrix.Identity(4)
        if o.data.shape_keys: o.shape_key_clear()
    named = {short(o): o for o in meshes}
    for n, d in job.get('move', {}).items():
        if n in named: named[n].data.transform(Matrix.Translation(Vector(d)))
    verts = lambda objs: [v.co.copy() for o in objs for v in o.data.vertices]
    allv = verts(meshes)
    ext = [max(v[i] for v in allv) - min(v[i] for v in allv) for i in range(3)]
    ax = 0 if ext[0] >= ext[1] else 1
    trig = named[job['trigger']]
    tv = verts([trig]); tc = sum(tv, Vector()) / len(tv)
    lo, hi = min(v[ax] for v in allv), max(v[ax] for v in allv)
    muzzle_pos = hi if hi - tc[ax] > tc[ax] - lo else lo        # the muzzle is the end farther from the trigger
    # rotate about Z so the barrel points +Y
    if ax == 0: R = Matrix.Rotation(1.5707963 if muzzle_pos == hi else -1.5707963, 4, 'Z')
    else: R = Matrix.Identity(4) if muzzle_pos == hi else Matrix.Rotation(3.1415927, 4, 'Z')
    rv = [R @ v for v in allv]
    front = max(v.y for v in rv); rear = min(v.y for v in rv)
    tip = [v for v in rv if v.y > front - 0.012]
    bore = sum(v.z for v in tip) / len(tip); cx = sum(v.x for v in tip) / len(tip)
    ty = (R @ tc).y
    scale = job['length'] / (front - rear)
    T = Matrix.Translation(Vector((0, 0, 0.05))) @ Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-cx, -ty, -bore))) @ R
    for o in meshes: o.data.transform(T)
    # moving parts become their own objects (pivot at their centre); everything else joins into Body
    made = {}
    scope_v = verts([named[job['scope']]]) if job.get('scope') else None
    part_names = {n for names in job['parts'].values() for n in names}
    static = [o for n, o in named.items() if n not in part_names]
    for part, names in job['parts'].items():
        objs = [named[n] for n in names if n in named]
        if not objs: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1: bpy.ops.object.join()
        made[part] = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT')
    for o in static: o.select_set(True)
    bpy.context.view_layer.objects.active = static[0]
    if len(static) > 1: bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    made['Body'] = body
    for name, o in made.items():
        o.name = name
        if name != 'Body':
            pts = [v.co for v in o.data.vertices]
            pivot = Vector(tuple((min(v[i] for v in pts) + max(v[i] for v in pts)) / 2 for i in range(3)))
            o.data.transform(Matrix.Translation(-pivot)); o.location = pivot
    bpy.context.view_layer.update()

    game = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
    world = [o.matrix_world @ v.co for o in made.values() for v in o.data.vertices]
    lo3 = Vector(tuple(min(v[i] for v in world) for i in range(3))); hi3 = Vector(tuple(max(v[i] for v in world) for i in range(3)))
    front = hi3.y
    tops = {'Body': round(max(v.z for v in (body.matrix_world @ p.co for p in body.data.vertices)), 5)}
    if scope_v:
        # sight line = the scope's optical axis (centre of the tube's cross-section)
        sv = [T @ v for v in scope_v]
        axis = (min(v.z for v in sv) + max(v.z for v in sv)) / 2
        tops['Rear Sights'] = round(axis + 0.004, 5)
    elif job.get('pistol'):
        slide = made.get('Slide')
        sv = [slide.matrix_world @ v.co for v in slide.data.vertices]
        y0 = min(v.y for v in sv)
        rear_top = max(v.z for v in sv if v.y < y0 + 0.03)
        tops['Slide'] = round(max(v.z for v in sv), 5)
        tops['Rear Sights'] = round(rear_top + 0.004, 5)
    pts = {'Attach_Muzzle': game(Vector((0, front, 0.05))), 'Trigger': [0, 0, 0]}
    if not job.get('pistol'):
        fy = 0.36 * front
        near = [v for v in world if abs(v.y - fy) < 0.03]
        pts['Attach_Rail.Bottom'] = game(Vector((0, fy, min(v.z for v in near) + 0.01)))
    meta[job['id']] = {
        'file': job['id'] + '_pbr.glb', 'parts': list(made), 'points': pts,
        'min': game(Vector((lo3.x, hi3.y, lo3.z))), 'max': game(Vector((hi3.x, lo3.y, hi3.z))), 'tops': tops,
        'source': f"https://polyhaven.com/a/{job['src']}", 'license': 'CC0',
    }
    for im in bpy.data.images:
        if im.size[0] > 1024: im.scale(1024, 1024)
    bpy.ops.export_scene.gltf(filepath=str(out / (job['id'] + '_pbr.glb')), export_format='GLB', export_yup=True,
                              export_animations=False, export_skins=False, export_image_format='JPEG')
    tris = sum(len(p.vertices) - 2 for o in made.values() for p in o.data.polygons)
    print('GUN_EXPORT', job['id'], json.dumps({'tris': tris, **meta[job['id']]}))

(out / 'meta.json').write_text(json.dumps(meta, indent=1))
