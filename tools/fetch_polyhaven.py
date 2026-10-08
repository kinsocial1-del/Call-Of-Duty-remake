# Downloads CC0 Poly Haven assets into tools/source_assets/ (models as 1k glTF, HDRIs at the listed resolutions).
#   python tools/fetch_polyhaven.py
import json, os, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS = [
    'covered_car', 'old_tyre', 'rusted_wheel_rim_01', 'street_lamp_01', 'exterior_aircon_unit', 'utility_box_01',
    'utility_box_02', 'security_light', 'metal_trash_can', 'portable_generator', 'propane_tank', 'cardboard_box_01',
    'trashbag', 'cement_bag', 'plastic_crate_01', 'steel_frame_shelves_01', 'mounted_fluorescent_lights',
    'water_manhole_cover', 'hand_truck', 'rollershutter_door', 'barrel_stove', 'plastic_jerrycan',
    'quiver_tree_01', 'quiver_tree_02', 'dead_quiver_trunk', 'wild_rooibos_bush', 'shrub_03', 'shrub_04',
    'namaqualand_boulder_02', 'namaqualand_boulder_04', 'namaqualand_boulder_05', 'namaqualand_cliff_01',
    'namaqualand_cliff_02', 'rock_07', 'rock_09', 'bolt_action_rifle_7_62', 'service_pistol',
]
HDRIS = {'kloofendal_48d_partly_cloudy_puresky': ['1k', '4k'], 'qwantani_noon_puresky': ['1k', '4k']}

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'ironfront-asset-fetch'})
    with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
        f.write(r.read())
    print('  got', os.path.relpath(path, ROOT))

def files(asset):
    req = urllib.request.Request('https://api.polyhaven.com/files/' + asset, headers={'User-Agent': 'ironfront-asset-fetch'})
    return json.load(urllib.request.urlopen(req))

for m in MODELS:
    print(m)
    g = files(m)['gltf']['1k']['gltf']
    base = os.path.join(ROOT, 'source_assets', 'polyhaven', m)
    get(g['url'], os.path.join(base, os.path.basename(g['url'])))
    for rel, info in g['include'].items():
        get(info['url'], os.path.join(base, rel))

for h, sizes in HDRIS.items():
    print(h)
    d = files(h)['hdri']
    for s in sizes:
        get(d[s]['hdr']['url'], os.path.join(ROOT, 'source_assets', 'hdri', f'{h}_{s}.hdr'))
