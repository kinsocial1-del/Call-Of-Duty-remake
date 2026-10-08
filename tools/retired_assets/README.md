# Retired assets

These files shipped with the original Dockyard and Outpost maps. Pine Ridge and Timber Camp replaced those maps, and the game no longer loads these files. They are kept here so they can be restored, and they are not packaged into builds.

Paths mirror `public/assets/`. To restore a file, move it back to the same path under `public/assets/`, then add its entry back to that folder's `meta.json`.

| Folder | Contents |
|---|---|
| `models/props/` | 33 Poly Haven props: vehicles, street clutter, AC units, shutters, lamps, desert trees, scrub, boulders and cliffs. `meta.json` holds their sizes. `../props.json` holds their `tools/convert_props.py` jobs. Its `src` paths are relative to `tools/`. |
| `models/woodland/forest_fir.glb` | The decimated fir mesh. The maps draw the fir as cutout canopy cards rendered by `tools/render_forest_canopy.py`. |
| `textures/` | Ground, container, brick, metal, skyline facade and harbour water textures. |
| `hdri/` | The Qwantani Noon desert sky (`meta.json` keeps its exposure). The partly cloudy sky still ships as `forest_*`. |
| `audio/ambience/harbor.ogg` | The Baltimore harbour ambience bed. The Atacama wind recording still ships as `wind.ogg`. |
