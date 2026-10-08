# Bake full-detail CC0 fir geometry to crossed cutout cards for a dense, inexpensive treeline.
import bpy, os, math, tempfile
from mathutils import Vector
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tempfile.tempdir = os.path.join(root, 'tools/source_assets/woodland/.blender-temp')
source = os.path.join(root, 'tools/source_assets/woodland/fir_tree_01/fir_tree_01_selected.gltf')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
lo = Vector(tuple(min(v[i] for v in points) for i in range(3)))
hi = Vector(tuple(max(v[i] for v in points) for i in range(3)))
center = (lo + hi) / 2
for o in meshes: o.location -= Vector((center.x, center.y, lo.z))
height = hi.z - lo.z
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 16
scene.render.resolution_x = 768; scene.render.resolution_y = 1536; scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
scene.world = bpy.data.worlds.new('Forest sky'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.8,0.88,1,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.65
sun_data = bpy.data.lights.new('Daylight', 'SUN'); sun_data.energy = 2.0
sun = bpy.data.objects.new('Daylight', sun_data); scene.collection.objects.link(sun); sun.rotation_euler = (0.4,-0.5,-0.7)
cam_data = bpy.data.cameras.new('Canopy'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = height * 1.06
cam = bpy.data.objects.new('Canopy', cam_data); scene.collection.objects.link(cam); scene.camera = cam
scene.view_settings.view_transform = 'Standard'
out = os.path.join(root, 'public/assets/textures/woodland'); os.makedirs(out, exist_ok=True)
for i, angle in enumerate([0, math.pi / 2]):
    cam.location = (math.sin(angle)*30,-math.cos(angle)*30,height/2)
    cam.rotation_euler = (Vector((0,0,height/2))-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = os.path.join(out, f'fir_card_{i}.png')
    bpy.ops.render.render(write_still=True)
print('CANOPY_BAKE_COMPLETE', height)
