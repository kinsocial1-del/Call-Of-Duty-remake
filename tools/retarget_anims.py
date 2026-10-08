# Blender batch script:  blender -b --factory-startup -P tools/retarget_anims.py -- tools/soldier.json
# Retargets CC0 "Universal Animation Library" clips (Rigify DEF- skeleton) onto the CC0 "Universal Base
# Characters" skeleton (Unreal-style names) and exports them as soldier_anims.glb.
# Per bone and frame: target_world = source_world * source_ref_world^-1 * target_rest_world, where the
# reference pose is the library's own T-pose clip (both skeletons rest in a T-pose there).
import bpy, json, os, sys
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--') + 1:]
cfg = json.load(open(args[0]))
root = os.path.dirname(os.path.abspath(args[0]))
P = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
out_dir = P(cfg['out'])

MAP = {'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
       'DEF-neck': 'neck_01', 'DEF-head': 'Head'}
for S, s in (('L', 'l'), ('R', 'r')):
    MAP.update({f'DEF-shoulder.{S}': f'clavicle_{s}', f'DEF-upper_arm.{S}': f'upperarm_{s}', f'DEF-forearm.{S}': f'lowerarm_{s}',
                f'DEF-hand.{S}': f'hand_{s}', f'DEF-thigh.{S}': f'thigh_{s}', f'DEF-shin.{S}': f'calf_{s}',
                f'DEF-foot.{S}': f'foot_{s}', f'DEF-toe.{S}': f'ball_{s}'})
    for f in ('index', 'middle', 'ring', 'pinky'):
        for n in (1, 2, 3):
            MAP[f'DEF-f_{f}.0{n}.{S}'] = f'{f}_0{n}_{s}'
    for n in (1, 2, 3):
        MAP[f'DEF-thumb.0{n}.{S}'] = f'thumb_0{n}_{s}'
INV = {t: s for s, t in MAP.items()}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=P(cfg['body']))
T = next(o for o in scene.objects if o.type == 'ARMATURE')
T.name = 'SoldierRig'
for o in list(scene.objects):
    if o.type != 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=P(cfg['anims']))
S = next(o for o in scene.objects if o.type == 'ARMATURE' and o is not T)
src_actions = {a.name: a for a in bpy.data.actions if a not in before}
for o in list(scene.objects):
    if o.type != 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
print('source actions', sorted(src_actions))

if not S.animation_data:
    S.animation_data_create()


def assign(obj, action):
    obj.animation_data.action = action
    if hasattr(obj.animation_data, 'action_slot') and action.slots and obj.animation_data.action_slot is None:
        obj.animation_data.action_slot = action.slots[0]


def src_pose(action, frame):
    assign(S, action)
    scene.frame_set(frame)
    return {n: S.matrix_world @ S.pose.bones[n].matrix for n in MAP if n in S.pose.bones}


ref_name = next(n for n in src_actions if 'TPose' in n)
a0 = int(src_actions[ref_name].frame_range[0])
ref = src_pose(src_actions[ref_name], a0)

Tw = T.matrix_world.copy()
Tw_inv = Tw.inverted()
Tw_rot_inv = Tw_inv.to_quaternion()
order = []
def walk(b):
    order.append(b)
    for c in b.children:
        walk(c)
for b in T.data.bones:
    if not b.parent:
        walk(b)
rest_world_q = {b.name: (Tw @ b.matrix_local).to_quaternion() for b in order}
k = (Tw @ T.data.bones['pelvis'].matrix_local).to_translation().z / max(0.1, ref['DEF-hips'].to_translation().z)
print('pelvis scale', round(k, 3))

if not T.animation_data:
    T.animation_data_create()
for pb in T.pose.bones:
    pb.rotation_mode = 'QUATERNION'

made = []
for clip in cfg['clips']:
    src = next((a for n, a in src_actions.items() if n == clip or n.startswith(clip)), None)
    if not src:
        print('missing clip', clip)
        continue
    f0, f1 = (int(round(x)) for x in src.frame_range)
    act = bpy.data.actions.new(clip + '__rt')
    assign(T, act)
    for f in range(f0, f1 + 1):
        sw = src_pose(src, f)
        assign(T, act)
        pose = {}
        for b in order:
            rest = b.matrix_local
            base = pose[b.parent.name] @ (b.parent.matrix_local.inverted() @ rest) if b.parent else rest.copy()
            s = INV.get(b.name)
            if s and s in sw:
                q = Tw_rot_inv @ (sw[s].to_quaternion() @ ref[s].to_quaternion().inverted() @ rest_world_q[b.name])
                loc = base.to_translation()
                if b.name == 'pelvis':
                    loc = rest.to_translation() + Tw_inv.to_3x3() @ ((sw[s].to_translation() - ref[s].to_translation()) * k)
                desired = Matrix.LocRotScale(loc, q, Vector((1, 1, 1)))
            else:
                desired = base
            pose[b.name] = desired
            basis = base.inverted() @ desired
            pb = T.pose.bones[b.name]
            pb.rotation_quaternion = basis.to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=f - f0)
            if b.name == 'pelvis':
                pb.location = basis.to_translation()
                pb.keyframe_insert('location', frame=f - f0)
    made.append((clip, act))
    print('retargeted', clip, f1 - f0 + 1, 'frames')

# keep only the retargeted actions, named like the source clips
for a in list(src_actions.values()):
    bpy.data.actions.remove(a)
bpy.data.objects.remove(S, do_unlink=True)
for clip, act in made:
    act.name = clip
T.animation_data.action = None
for pb in T.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, 'soldier_anims.glb'), export_format='GLB', export_yup=True,
                          export_skins=False, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True)
print('exported', len(made), 'clips')
