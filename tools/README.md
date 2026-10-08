# Asset pipeline

The raw CC0 downloads live in `tools/source_assets/`. These scripts turn them into the game-ready files in
`public/assets/`. Everything runs headless in Blender 5.x, which ships its own Python with numpy and an Ogg encoder.

Set `B` to your Blender executable first:

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
```

| Step | Command | Output |
|---|---|---|
| Textured VX-4 upgrade (after Guns) | `"$B" -b -P tools/upgrade_carbine.py -- PROJECT_ROOT` | `guns/vx4_pbr.glb` and updated `meta.json` |
| Guns | `"$B" -b --factory-startup -P tools/convert_guns.py -- tools/guns.json` | `public/assets/models/guns/*.glb` and `meta.json` |
| Launcher (run after Guns, because it adds to `meta.json`) | `"$B" -b --factory-startup -P tools/convert_launcher.py` | `guns/striker.glb` |
| Soldier body, gear, camo, first-person arms | `"$B" -b --factory-startup -P tools/build_soldier.py -- tools/soldier.json` | `public/assets/models/soldier/` |
| Soldier animations | `"$B" -b --factory-startup -P tools/retarget_anims.py -- tools/soldier.json` | `soldier/soldier_anims.glb` |
| Map props | `"$B" -b --factory-startup -P tools/convert_props.py -- tools/props.json` | `public/assets/models/props/` |
| Download Poly Haven models + HDRIs | `python tools/fetch_polyhaven.py` | `tools/source_assets/polyhaven/`, `source_assets/hdri/` |
| Photoscanned LONGBOW + P-17 (after Guns) | `"$B" -b --factory-startup -P tools/upgrade_ph_guns.py -- PROJECT_ROOT` | `guns/longbow_pbr.glb`, `guns/p17_pbr.glb`, updated `meta.json` |
| PBR AKM for the VIPER BR (after Guns; source `akm.blend` from https://opengameart.org/content/akm in `source_assets/oga/`) | `"$B" -b tools/source_assets/oga/akm.blend -P tools/upgrade_akm.py -- PROJECT_ROOT` | `guns/viper_pbr.glb`, updated `meta.json` |
| Expansion flat guns (merges into `meta.json`) | `"$B" -b --factory-startup -P tools/convert_guns.py -- tools/guns_extra.json` | 15 more `guns/*.glb` |
| OpenGameArt guns: AK, RPK, Benelli, Sten, Desert Eagle (sources in `source_assets/oga/`) | `"$B" -b --factory-startup -P tools/upgrade_oga_guns.py -- PROJECT_ROOT` | `guns/*_oga.glb` |
| Skies | `"$B" -b --factory-startup -P tools/process_hdri.py -- PROJECT_ROOT` | `public/assets/hdri/` (1k HDR lighting + 4k JPEG backdrop) |
| Ambience loops | `"$B" -b --factory-startup -P tools/process_ambience.py -- PROJECT_ROOT` | `public/assets/audio/ambience/` |
| Gunshots | `"$B" -b --factory-startup -P tools/process_sfx.py -- tools/sfx.json` | `public/assets/audio/guns/` |
| Foley (reloads, steps, impacts, explosions) | `"$B" -b --factory-startup -P tools/process_foley.py -- tools/foley.json` | `public/assets/audio/sfx/` |

The gunshot step needs the 194 MB "Free Firearm Sound Library". Download it from
https://opengameart.org/content/the-free-firearm-sound-library, extract it, and set `library` in `tools/sfx.json` to the extracted folder.
It isn't kept in the project because of its size.

Sources and licenses are listed in [CREDITS.md](../CREDITS.md).

## Woodland replacement maps

Run `node tools/fetch-woodland.mjs` to fetch checksum-verified CC0 Poly Haven sources and forest-floor textures. Run Blender with `-b --factory-startup -P tools/convert_woodland.py` for the compact GLB props, then `-b --factory-startup -P tools/render_forest_canopy.py` for full-detail tree cutout cards. The source scans stay outside the shipped assets; instanced crossed cards retain the original canopy without rendering millions of tiny needles. The new Pine Ridge and Timber Camp layouts retain the old internal map IDs so saved selections and operation rotations keep working. `convert_woodland.py` filters the fir scan for the canopy render but does not export a fir GLB, because the maps draw only the cards.

Assets used only by the original Dockyard and Outpost maps are kept in [retired_assets/](retired_assets/README.md) and are not packaged.
