# Blender batch script: converts the rigged CC0 "Flat Guns" GLBs into game-ready rigid models.
#   blender -b -P tools/convert_guns.py -- tools/guns.json
# For every gun it
#   * splits the single skinned mesh into one rigid object per bone (Magazine, Bolt, Pump, Slide, ...),
#     each with its origin on its bone so it can be animated by translating/rotating it,
#   * normalises orientation/scale into the game's weapon frame (muzzle toward -Z, up +Y, trigger at z = 0,
#     bore at y = boreY), and
#   * writes key points (muzzle, optic mount, sights, grip, foregrip) to meta.json for the viewmodel.
import bpy, bmesh, json, sys, os
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
out_dir = os.path.join(root, cfg['out'])
os.makedirs(out_dir, exist_ok=True)
# merge into the existing meta.json so a partial job list (e.g. guns_extra.json) keeps the other guns' entries
meta_path = os.path.join(out_dir, 'meta.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) and cfg.get('merge') else {}


def to_game(v):  # Blender (Z up, +Y forward) -> three.js weapon frame (Y up, muzzle -Z)
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


for job in cfg['guns']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, job['src']))
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    src = next(o for o in scene.objects if o.type == 'MESH')
    heads = {b.name: (arm.matrix_world @ b.head_local) for b in arm.data.bones}
    world = src.matrix_world.copy()
    me_src = src.data

    # dominant bone per face
    groups = {g.index: g.name for g in src.vertex_groups}
    vgroup = []
    for v in me_src.vertices:
        best, bw = None, -1
        for g in v.groups:
            if g.weight > bw:
                best, bw = groups.get(g.group), g.weight
        vgroup.append(best or 'Body')
    parts = {}
    for p in me_src.polygons:
        parts.setdefault(vgroup[p.vertices[0]], set()).add(p.index)

    # every vertex in world space, for the normalising transform
    allv = [world @ v.co for v in me_src.vertices]
    ys = [v.y for v in allv]
    fwd = 1.0
    if 'Attach_Muzzle' in heads and 'Trigger' in heads and heads['Attach_Muzzle'].y < heads['Trigger'].y:
        fwd = -1.0
    flip = Matrix.Rotation(3.14159265 if fwd < 0 else 0.0, 4, 'Z')
    length = max(ys) - min(ys)
    s = job['length'] / length
    trig = flip @ heads.get('Trigger', Vector((0, 0, 0)))
    if 'Attach_Muzzle' in heads:
        bore_z = (flip @ heads['Attach_Muzzle']).z
    else:  # no muzzle marker: centre of the front-most geometry
        fv = [flip @ v for v in allv]
        front = max(v.y for v in fv)
        tip = [v.z for v in fv if v.y > front - 0.012]
        bore_z = sum(tip) / len(tip)
    T = Matrix.Translation(Vector((0, 0, job.get('boreY', 0.05)))) @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((0, -trig.y, -bore_z))) @ flip

    # build rigid part objects
    made = {}
    for name, faces in parts.items():
        bm = bmesh.new()
        bm.from_mesh(me_src)
        bm.faces.ensure_lookup_table()
        kill = [f for f in bm.faces if f.index not in faces]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in me_src.materials:
            me.materials.append(m)
        me.validate(clean_customdata=False)
        me.update()
        me.transform(T @ world)
        pivot = (T @ heads[name]) if name in heads and name != 'Body' else Vector((0, 0, 0))
        me.transform(Matrix.Translation(-pivot))
        ob = bpy.data.objects.new(name, me)
        ob.location = pivot
        scene.collection.objects.link(ob)
        made[name] = ob

    def part_box(name):
        ob = made.get(name)
        if not ob:
            return None
        vs = [ob.location + v.co for v in ob.data.vertices]
        return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
                Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))

    pts = {k: to_game(T @ v) for k, v in heads.items() if k.startswith('Attach_') or k == 'Trigger'}
    body = part_box('Body')
    info = {
        'file': job['id'] + '.glb', 'parts': sorted(made.keys()), 'points': pts,
        'min': to_game(Vector((body[0].x, body[1].y, body[0].z))), 'max': to_game(Vector((body[1].x, body[0].y, body[1].z))),
    }
    if 'Attach_Muzzle' not in pts:
        front = max(max((ob.location + v.co).y for v in ob.data.vertices) for ob in made.values())
        info['points']['Attach_Muzzle'] = [0.0, job.get('boreY', 0.05), round(-front, 5)]
    for pn in ('Rear Sights', 'Front Sights', 'Slide', 'Body'):
        b = part_box(pn)
        if b:
            info.setdefault('tops', {})[pn] = round(b[1].z, 5)
    for pn in ('Rear Sights', 'Front Sights'):
        b = part_box(pn)
        if b:
            info.setdefault('sightZ', {})[pn] = round(-(b[0].y + b[1].y) / 2, 5)
    meta[job['id']] = info

    # keep only the rigid parts and export
    for o in list(scene.objects):
        if o.name not in made or made[o.name] is not o:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, job['id'] + '.glb'), export_format='GLB', export_yup=True, export_animations=False, export_skins=False)
    print('converted', job['id'], 'scale %.3f' % s, sorted(made.keys()))

json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w'), indent=1)
print('wrote', len(meta), 'guns')
