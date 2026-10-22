#!/usr/bin/env python3
"""Convert EXR/HDR images to browser-compatible RGB PNG without resizing; report source/output metadata."""
import bpy
import json
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
manifest_path = Path(args[args.index('--manifest') + 1])
pairs = json.loads(manifest_path.read_text(encoding='utf-8'))
scene = bpy.context.scene
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '8'
scene.render.image_settings.compression = 100
# Avoid a cinematic/view-look transform during data-map conversion.
try:
    scene.view_settings.view_transform = 'Standard'
except Exception:
    pass
results = []
for src_name, dst_name in pairs:
    src, dst = Path(src_name), Path(dst_name)
    rec = {'sourceName': src.name, 'output': str(dst), 'sourceDimensions': None,
           'sourceDepth': None, 'sourceChannels': None, 'sourceFloat': None}
    try:
        image = bpy.data.images.load(str(src), check_existing=False)
        rec.update({'sourceDimensions': list(image.size), 'sourceDepth': getattr(image, 'depth', None),
                    'sourceChannels': getattr(image, 'channels', None), 'sourceFloat': getattr(image, 'is_float', None)})
        # save_render uses the scene's explicitly configured browser-compatible 8-bit PNG settings.
        image.save_render(str(dst), scene=scene)
        rec.update({'ok': dst.exists(), 'method': 'blender-native-dimensions-exr-hdr-to-png8',
                    'outputDimensions': list(image.size), 'error': None})
        bpy.data.images.remove(image)
        print('converted', src.name, '->', dst.name, 'source', rec['sourceDimensions'], rec['sourceDepth'], 'output', rec['outputDimensions'], flush=True)
    except Exception as exc:
        rec.update({'ok': False, 'method': None, 'error': repr(exc)})
        print('conversion failed', src, repr(exc), flush=True)
    results.append(rec)
manifest_path.with_suffix('.results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
