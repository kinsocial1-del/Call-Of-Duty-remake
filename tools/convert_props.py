# Blender batch script:  blender -b --factory-startup -P tools/convert_props.py -- tools/props.json
# Converts CC0 Poly Haven props into compact game GLBs: joins meshes, decimates heavy scans to a triangle
# budget, puts the origin at the bottom centre, shrinks textures and records each prop's size in meta.json.
import bpy, json, os, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
P = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
out_dir = P(cfg['out'])
os.makedirs(out_dir, exist_ok=True)
meta = {}

for key, job in cfg['props'].items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=P(job['src']))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # files that bundle several variants: keep only the named objects ('only') or drop names containing 'exclude'
    if job.get('only'):
        meshes = [o for o in meshes if o.name in job['only']]
    if job.get('exclude'):
        meshes = [o for o in meshes if job['exclude'] not in o.name]
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in meshes]:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    if ob.data.shape_keys:
        ob.shape_key_clear()   # some scans ship rig shape keys; modifiers can't be applied over them
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    budget = job.get('tris', 3000)
    if tris > budget:
        # alpha-card foliage falls apart under decimation: leave faces with alpha-mapped materials alone
        def alpha_mat(m):
            bsdf = m and m.node_tree and next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            return bool(bsdf and bsdf.inputs['Alpha'].is_linked)
        keep = {i for i, m in enumerate(ob.data.materials) if alpha_mat(m)} if job.get('preserveAlpha', True) else set()
        cards = sum(len(p.vertices) - 2 for p in ob.data.polygons if p.material_index in keep)
        m = ob.modifiers.new('dec', 'DECIMATE')
        m.ratio = max(0.02, min(1.0, (budget - cards) / max(1, tris - cards)))
        if keep:
            vg = ob.vertex_groups.new(name='solid')
            vg.add([v for p in ob.data.polygons if p.material_index not in keep for v in p.vertices], 1.0, 'REPLACE')
            m.vertex_group = 'solid'
        bpy.ops.object.modifier_apply(modifier=m.name)
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    ob.data.transform(__import__('mathutils').Matrix.Translation(-c))
    for o in list(bpy.context.scene.objects):
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    for im in bpy.data.images:
        s = job.get('tex', 512)
        if im.size[0] > s:
            im.scale(s, s)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, key + '.glb'), export_format='GLB', export_yup=True, export_image_format='JPEG')
    after = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    # Blender (x, y, z) -> three.js (x, z, -y): size as [width x, height y, depth z]
    meta[key] = {'file': key + '.glb', 'size': [round(hi.x - lo.x, 3), round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)], 'tris': after}
    print('prop', key, meta[key])

json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w'), indent=1)
