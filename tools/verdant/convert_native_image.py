#!/usr/bin/env python3
"""Legacy single-file Blender converter retained for manual diagnostics; current native path uses convert_native_batch.py."""
import bpy, sys
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
def val(flag): return args[args.index(flag) + 1]
src, dst = val('--src'), val('--dst')
img = bpy.data.images.load(str(Path(src)), check_existing=False)
# This helper is not the production path. The production batch converter explicitly uses RGB PNG8.
img.file_format = 'PNG'
try: img.depth = 16
except Exception: pass
img.save_render(str(Path(dst)))
print('converted', src, '->', dst, 'size', img.size[:])
