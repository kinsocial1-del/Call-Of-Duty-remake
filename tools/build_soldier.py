# Blender batch script:  blender -b --factory-startup -P tools/build_soldier.py -- tools/soldier.json
# Turns Quaternius' CC0 "Universal Base Characters" body into a skinned soldier:
#   * body regions get their own materials by bone weights (skin head, uniform, gloves, boots),
#   * gear is grown off the body as skinned shells (plate carrier, helmet, boots, belt, knee pads) so it
#     deforms with every animation,
#   * tileable camouflage cloth textures are generated from a CC0 ambientCG fabric scan,
import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
P = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
out_dir = P(cfg['out'])
os.makedirs(out_dir, exist_ok=True)

# ------------------------------------------------------------------ CAMO CLOTH TEXTURES
def load_px(path, size):
    im = bpy.data.images.load(path)
    im.scale(size, size)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(im)
    return a


def save_img(arr, path, fmt='JPEG'):
    h, w = arr.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr[..., :3], 0, 1)
    im.pixels[:] = rgba.ravel()
    im.filepath_raw = path
    im.file_format = fmt
    if fmt == 'JPEG':
        bpy.context.scene.render.image_settings.quality = 88
    im.save()
    bpy.data.images.remove(im)


def blob_noise(n, scale, seed):
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    k = np.fft.fftfreq(n)[:, None] ** 2 + np.fft.fftfreq(n)[None, :] ** 2
    g = np.real(np.fft.ifft2(f * np.exp(-k * (n / scale) ** 2)))  # periodic -> tileable
    return (g - g.mean()) / (g.std() + 1e-6)


N = 1024
cloth = load_px(P(cfg['cloth']), N)[..., :3].mean(axis=2)
detail = np.clip(cloth / (cloth.mean() + 1e-6), 0.6, 1.4)
for name, pal in cfg['camo'].items():
    pal = [np.array([int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)]) ** 2.2 for c in pal]  # sRGB -> linear
    img = np.zeros((N, N, 3), dtype=np.float32) + pal[0]
    for i, col in enumerate(pal[1:]):
        m = blob_noise(N, 9 + i * 3, 11 + i * 7) + 0.35 * blob_noise(N, 40, 99 + i)
        img[m > 0.55 - i * 0.1] = col
    img *= detail[..., None]
    save_img(img ** (1 / 2.2), os.path.join(out_dir, f'camo_{name}.jpg'))
    print('camo', name)

# ------------------------------------------------------------------ BODY -> SOLDIER
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P(cfg['body']))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = max((o for o in scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
me = body.data
groups = {g.index: g.name for g in body.vertex_groups}
dom = []
for v in me.vertices:
    best, bw = 'pelvis', -1
    for g in v.groups:
        if g.weight > bw:
            best, bw = groups.get(g.group, 'pelvis'), g.weight
    dom.append(best)

HAND = ('hand_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')
mat_names = ['Uniform', 'Gloves', 'Boots', 'Vest', 'Helmet', 'Belt', 'Pads']
base_cols = {'Uniform': (0.3, 0.3, 0.25), 'Gloves': (0.03, 0.03, 0.03), 'Boots': (0.05, 0.04, 0.03), 'Vest': (0.4, 0.33, 0.22),
             'Helmet': (0.25, 0.26, 0.2), 'Belt': (0.04, 0.04, 0.04), 'Pads': (0.06, 0.06, 0.06)}
idx = {}
for n in mat_names:
    m = bpy.data.materials.new('M_' + n)
    m.diffuse_color = (*base_cols[n], 1)
    me.materials.append(m)
    idx[n] = len(me.materials) - 1
SKIN = 0

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()


def fbone(f):
    names = [dom[v.index] for v in f.verts if v.index < len(dom)]
    return max(set(names), key=names.count) if names else 'pelvis'


def centre(f):
    return f.calc_center_median()


orig = list(bm.faces)
info = [(f, fbone(f), centre(f)) for f in orig]
for f, b, c in info:
    if b in ('Head', 'neck_01'):
        f.material_index = SKIN
    elif b.startswith(HAND):
        f.material_index = idx['Gloves']
    elif b.startswith(('foot_', 'ball_')) or (b.startswith('calf_') and c.z < 0.2):
        f.material_index = idx['Boots']
    else:
        f.material_index = idx['Uniform']


def clean(faces, grow=2, erode=2):
    """Smooth a triangle selection's ragged outline: fill notches, then drop spikes."""
    sel = set(faces)
    nb = lambda f: sum(1 for e in f.edges for g in e.link_faces if g is not f and g in sel)
    for _ in range(grow):
        sel |= {g for f in list(sel) for e in f.edges for g in e.link_faces if g not in sel and nb(g) >= 2}
    for _ in range(erode):
        sel = {f for f in sel if nb(f) >= 2}
    return list(sel)


def shell(faces, offset, thick, mat, smooth=8):
    """Duplicate faces into a skinned gear shell: smoothed into a rigid-looking form, then kept outside the body."""
    faces = clean(faces)
    if not faces:
        return 0
    ret = bmesh.ops.duplicate(bm, geom=faces)
    nf = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
    for f in nf:
        f.normal_update()
    for v in nv:
        v.normal_update()
    orig = {v: v.co.copy() for v in nv}
    nrm = {v: v.normal.copy() for v in nv}
    inner = [v for v in nv if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in nv:
        n = nrm[v]
        sunk = max(0.0, (orig[v] - v.co).dot(n))
        v.co += n * (sunk + offset)
    for f in nf:
        f.material_index = mat
    r = bmesh.ops.solidify(bm, geom=nf, thickness=thick)
    for g in r['geom']:
        if isinstance(g, bmesh.types.BMFace):
            g.material_index = mat
    return len(nf)


def hull(faces, offset, mat, smooth_shade=True, axis=None):
    """Rigid gear piece: convex hull of a body region (keeps the source vertices' skin weights), pushed outward."""
    if not faces:
        return 0
    ret = bmesh.ops.duplicate(bm, geom=faces)
    dup_f = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    dup_v = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
    h = bmesh.ops.convex_hull(bm, input=dup_v, use_existing_faces=False)
    hull_f = [g for g in h['geom'] if isinstance(g, bmesh.types.BMFace)]
    hull_set = set(hull_f)
    bmesh.ops.delete(bm, geom=[f for f in dup_f if f not in hull_set], context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in dup_v if v.is_valid and not v.link_faces], context='VERTS')
    hull_f = [f for f in hull_f if f.is_valid]
    verts = {v for f in hull_f for v in f.verts}
    c = sum((v.co for v in verts), Vector()) / max(1, len(verts))
    for v in verts:
        d = v.co - c
        if axis == 'h':
            d.z = 0
        if d.length > 1e-6:
            v.co += d.normalized() * offset
    for f in hull_f:
        f.material_index = mat
        f.smooth = smooth_shade
        f.normal_update()
    return len(hull_f)


torso = ('spine_01', 'spine_02', 'spine_03')
n_vest = hull([f for f, b, c in info if b in torso and 1.02 < c.z < 1.44 and abs(c.x) < 0.2], 0.03, idx['Vest'], False, 'h')
n_helm = hull([f for f, b, c in info if b == 'Head' and (c.z > 1.735 or (c.z > 1.64 and c.y > 0.04))], 0.02, idx['Helmet'])
n_boot = sum(hull([f for f, b, c in info if b.endswith(side) and (b.startswith(('foot_', 'ball_')) or (b.startswith('calf_') and c.z < 0.2))], 0.008, idx['Boots']) for side in ('_l', '_r'))
n_belt = hull([f for f, b, c in info if b in ('pelvis', 'spine_01') and 0.97 < c.z < 1.035], 0.014, idx['Belt'], True, 'h')
n_pads = sum(hull([f for f, b, c in info if b.endswith(side) and b.startswith(('calf_', 'thigh_')) and 0.45 < c.z < 0.56 and f.normal.y < -0.55], 0.012, idx['Pads']) for side in ('_l', '_r'))
print('shells vest', n_vest, 'helmet', n_helm, 'boots', n_boot, 'belt', n_belt, 'pads', n_pads)
bm.to_mesh(me)
bm.free()
me.update()

# lighter textures: the face is all that shows of the skin atlas
for im in bpy.data.images:
    if im.size[0] > 1024:
        im.scale(1024, 1024)

# drop anything that isn't the soldier
for o in list(scene.objects):
    if o.type not in ('ARMATURE', 'MESH'):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, 'soldier.glb'), export_format='GLB', export_yup=True,
                          export_skins=True, export_animations=False, export_image_format='JPEG')
print('exported soldier')


# ------------------------------------------------------------------ FIRST-PERSON ARMS
# same skeleton, only the arm faces: the viewmodel IKs them onto the weapon
ARM = ('clavicle_', 'upperarm_', 'lowerarm_') + HAND
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
dl = bm.verts.layers.deform.active
def vbone(v):
    best, bw = 'pelvis', -1
    for gi, w in (v[dl].items() if dl else []):
        if w > bw:
            best, bw = groups.get(gi, 'pelvis'), w
    return best
keep = set()
for f in bm.faces:
    names = [vbone(v) for v in f.verts]
    if f.material_index in (idx['Uniform'], idx['Gloves']) and max(set(names), key=names.count).startswith(ARM):
        keep.add(f)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me)
bm.free()
me.update()
for o in list(scene.objects):
    if o.type == 'MESH' and o is not body:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, 'fp_arms.glb'), export_format='GLB', export_yup=True,
                          export_skins=True, export_animations=False, export_image_format='JPEG')
print('exported arms')

# animations are retargeted separately by tools/retarget_anims.py
