# Verdant Trail exporter

Run Blender 4.4.3 against the staged source (the source stays outside this repository):

```sh
/home/fame/tools/blender/blender --background --python tools/verdant/export_scene.py -- \
  --blend /home/fame/marmot3d-assets/verdant_trail/verdant_trail.blend \
  --out-dir assets/verdant
```

The exporter selects the visible Verdant Trail render collections, keeps the ground mesh for
height sampling, decimates decorative geometry deterministically, and removes all image nodes
(including EXR/HDR and the multi-gigabyte source texture set). The browser receives a single GLB
with material base colors, plus `verdant-trail-height.json` for walkable ground and `manifest.json`
for mapping and reproducibility.

Source: [Poly Haven A Verdant Trail collection](https://polyhaven.com/zh/collections/verdant_trail)
License: [Poly Haven CC0 license](https://polyhaven.com/license)
