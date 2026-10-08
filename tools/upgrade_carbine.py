"""Convert the CC0 M4A1 into the VX-4's game frame with PBR maps and moving parts.
Usage: blender -b -P tools/upgrade_carbine.py -- PROJECT_ROOT [PREVIEW_PATH]
"""
import bpy, bmesh, json, sys, math
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--')+1:]
root = Path(args[0]).resolve()
source = root/'tools/source_assets/m4a1/M4A1'
out = root/'public/assets/models/guns'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source/'M4A1.fbx'))
meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
vertices = [o.matrix_world@v.co for o in meshes for v in o.data.vertices]
front = max(v.y for v in vertices)
rear = min(v.y for v in vertices)
tip = [v for v in vertices if v.y > front-0.002]
bore = sum(v.z for v in tip)/len(tip)
centre_x = sum(v.x for v in tip)/len(tip)
trigger = bpy.data.objects['Trigger']
trigger_y = sum((trigger.matrix_world@v.co).y for v in trigger.data.vertices)/len(trigger.data.vertices)
scale = 0.94/(front-rear)
transform = Matrix.Translation(Vector((0,0,0.05))) @ Matrix.Scale(scale,4) @ Matrix.Translation(Vector((-centre_x,-trigger_y,-bore)))

mat = bpy.data.materials.new('VX4_PBR'); mat.use_nodes=True
nodes=mat.node_tree.nodes; links=mat.node_tree.links; bsdf=nodes.get('Principled BSDF')
for suffix, socket in [('Base_Color','Base Color'),('Metallic','Metallic'),('Roughness','Roughness')]:
    image=bpy.data.images.load(str(source/f'M4A1_{suffix}.png'))
    if image.size[0]>1024: image.scale(1024,1024)
    if suffix!='Base_Color': image.colorspace_settings.name='Non-Color'
    tex=nodes.new('ShaderNodeTexImage'); tex.image=image
    links.new(tex.outputs['Color'],bsdf.inputs[socket])
image=bpy.data.images.load(str(source/'M4A1_Normal.png')); image.colorspace_settings.name='Non-Color'
if image.size[0]>1024: image.scale(1024,1024)
tex=nodes.new('ShaderNodeTexImage'); tex.image=image
normal=nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=0.7
links.new(tex.outputs['Color'],normal.inputs['Color']); links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])

static=[]; made={}
for ob in meshes:
    world=ob.matrix_world.copy()
    ob.parent=None; ob.matrix_parent_inverse=Matrix.Identity(4)
    ob.data.transform(transform@world); ob.matrix_world=Matrix.Identity(4)
    ob.data.materials.clear(); ob.data.materials.append(mat)
    # Preserve supplied UVs and split normals. The PBR normal map supplies fine detail.
    bm=bmesh.new(); bm.from_mesh(ob.data)
    loose=[v for v in bm.verts if not v.link_faces]
    if loose: bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    if ob.name=='Magazine': made['Magazine']=ob
    elif ob.name=='Charging_Handle': made['Charging Handle']=ob
    elif ob.name in ['Sight','Sight_2']: bpy.data.objects.remove(ob,do_unlink=True)
    else: static.append(ob)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for ob in static: ob.select_set(True)
bpy.context.view_layer.objects.active=static[0]; bpy.ops.object.join()
body=bpy.context.view_layer.objects.active; body.name='Body'; made['Body']=body
bpy.context.view_layer.update()
for name,ob in made.items():
    ob.name=name
    if name!='Body':
        pts=[v.co for v in ob.data.vertices]
        pivot=Vector(tuple((min(v[i] for v in pts)+max(v[i] for v in pts))/2 for i in range(3)))
        ob.data.transform(Matrix.Translation(-pivot)); ob.location=pivot
bpy.context.view_layer.update()

def game(v): return [round(v.x,5),round(v.z,5),round(-v.y,5)]
body_points=[body.matrix_world@v.co for v in body.data.vertices]
lo=Vector(tuple(min(v[i] for v in body_points) for i in range(3)))
hi=Vector(tuple(max(v[i] for v in body_points) for i in range(3)))
scope=transform@Vector((centre_x,-0.025,0.051))
fore=transform@Vector((centre_x,0.23,-0.002))
meta=json.loads((out/'meta.json').read_text())
meta['vx4']={
    'file':'vx4_pbr.glb','parts':list(made),'opticRiser':0.014,'points':{
        'Attach_Muzzle':game(transform@Vector((centre_x,front,bore))),
        'Attach_Scope':game(scope),'Attach_Rail.Bottom':game(fore),'Trigger':[0,0,0]},
    'min':game(Vector((lo.x,hi.y,lo.z))),'max':game(Vector((hi.x,lo.y,hi.z))),
    'tops':{'Body':round(hi.z,5)},
    'source':'https://opengameart.org/content/m4a1-assault-rifle','license':'CC0',
}
bpy.ops.export_scene.gltf(filepath=str(out/'vx4_pbr.glb'),export_format='GLB',export_yup=True,export_animations=False,export_skins=False)
(out/'meta.json').write_text(json.dumps(meta,indent=1))
tris=sum(len(p.vertices)-2 for ob in made.values() for p in ob.data.polygons)
print('CARBINE_EXPORT',json.dumps({'triangles':tris,'parts':list(made),'bytes':(out/'vx4_pbr.glb').stat().st_size,'metadata':meta['vx4']}))

if len(args)>1:
    preview=Path(args[1]); preview.parent.mkdir(parents=True,exist_ok=True)
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1000; scene.render.resolution_y=600; scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('Studio'); scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0.17,0.2,0.26,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=0.5
    for pos,power,size in [((1,-0.5,1.2),160,1.2),((-0.8,0.5,0.6),100,0.9),((0,1,1.4),130,0.8)]:
        bpy.ops.object.light_add(type='AREA',location=pos); light=bpy.context.object
        light.data.energy=power; light.data.shape='DISK'; light.data.size=size
        light.rotation_euler=(Vector((0,0.1,0))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(1.35,-0.35,0.47)); camera=bpy.context.object
    camera.rotation_euler=(Vector((0,0.13,-0.025))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO'; camera.data.ortho_scale=1.24; scene.camera=camera
    scene.render.filepath=str(preview); bpy.ops.render.render(write_still=True)
