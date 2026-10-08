# Blender 5.2: convert only selected variants from the CC0 woodland downloads.
import os, json, sys, runpy, tempfile
root = os.path.dirname(os.path.abspath(__file__))
tempfile.tempdir = os.path.join(root, 'source_assets', 'woodland', '.blender-temp')
os.makedirs(tempfile.tempdir, exist_ok=True)
jobs = {
    'forest_fir': ('fir_tree_01', 'fir_tree_01_c_LOD0', 10000),
    'forest_sapling': ('fir_sapling', 'fir_sapling_a', 4500),
    'forest_fern': ('fern_02', 'fern_02_a', 1500),
    'forest_log': ('dead_tree_trunk', 'dead_tree_trunk', 2500),
}
cfg = {'out': '../public/assets/models/woodland', 'props': {}}
for key, (asset, name, tris) in jobs.items():
    source = os.path.join(root, 'source_assets', 'woodland', asset, asset + '.gltf')
    doc = json.load(open(source))
    selected = [i for i, n in enumerate(doc['nodes']) if n.get('name') == name]
    assert selected, name
    # Avoid importing the other multi-million-polygon variants.
    node = doc['nodes'][selected[0]]
    mesh = doc['meshes'][node['mesh']]
    node['mesh'] = 0
    doc['nodes'] = [node]; doc['meshes'] = [mesh]
    doc['scenes'] = [{'nodes': [0]}]; doc['scene'] = 0
    filtered = source.replace('.gltf', '_selected.gltf')
    with open(filtered, 'w') as f: json.dump(doc, f)
    # The fir is only filtered for render_forest_canopy.py: the game draws its canopy cards, never the mesh.
    if key == 'forest_fir': continue
    cfg['props'][key] = {'src': filtered, 'tris': tris, 'tex': 512, 'only': [name]}
cfg_path = os.path.join(root, 'woodland.json')
with open(cfg_path, 'w') as f: json.dump(cfg, f, indent=2)
sys.argv = ['convert_props.py', '--', cfg_path]
runpy.run_path(os.path.join(root, 'convert_props.py'), run_name='__main__')
