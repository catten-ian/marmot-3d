#!/usr/bin/env python3
"""Read-only Blender transform/AABB dump for Verdant source-to-export audits.

Run with Blender 4.4.3. It opens the external blend read-only and never saves it.
The `runtimeExpected` transform applies the same source->playable mapping used by
export_real_scene.py, without changing the source objects.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

COLLECTIONS = {
    'main_scene', 'foliage', 'debris', 'cliffs_boulders', 'background',
    'scene_components', 'debris_patches', 'grass_medium_02', 'hanging_grass',
    'island_tree_01_branches', 'island_tree_01_leaves', 'jacaranda_tree_leaves',
    'shrub_01', 'shrub_03', 'shrub_04', 'tree_small_02_leaves',
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--blend', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--ground-object', default='ground')
    return parser.parse_args(argv)


def bbox_world(obj, matrix=None):
    m = matrix or obj.matrix_world
    pts = [m @ Vector(corner) for corner in obj.bound_box]
    return {
        'min': [min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)],
        'max': [max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)],
    }


def matrix_rows(matrix):
    return [[float(matrix[r][c]) for c in range(4)] for r in range(4)]


def eligible(obj):
    cols = {c.name for c in obj.users_collection}
    if obj.type != 'MESH' or obj.hide_render or not cols.intersection(COLLECTIONS):
        return False
    n = obj.name.lower()
    if any(k in n for k in ('rubberduck', 'rubber_duck', 'rubberduck_toy', 'duck', 'dots stroke')):
        return False
    lowcols = {c.lower() for c in cols}
    if not ({'background', 'main_scene', 'foliage', 'scene_components'} & lowcols):
        if not (('cliffs_boulders' in lowcols or 'debris' in lowcols)
                and any(k in n for k in ('root', 'boulder', 'dead_tree', 'fallen_log', 'cliff'))):
            return False
    if len(obj.data.polygons) > 100000 and 'background' not in lowcols \
            and not any(k in n for k in ('root', 'boulder', 'dead_tree', 'cliff')):
        return False
    return True


def main():
    args = parse_args()
    source = str(Path(args.blend).resolve())
    bpy.ops.wm.open_mainfile(filepath=source, load_ui=False)
    ground = bpy.data.objects.get(args.ground_object)
    if not ground or ground.type != 'MESH':
        raise SystemExit('ground mesh missing: ' + args.ground_object)
    # Match export_real_scene.xform(): it uses the world-space ground object AABB.
    gb = bbox_world(ground)
    sx0, sx1 = gb['min'][0], gb['max'][0]
    sy0, sy1 = gb['min'][1], gb['max'][1]
    sz0, sz1 = gb['min'][2], gb['max'][2]
    sw, sh = sx1 - sx0, sy1 - sy0
    scale_x = 130.0 / sh * 0.88
    scale_z = 78.0 / sw * 0.88
    vertical_scale = min(scale_x, scale_z)
    cx, cy = (sx0 + sx1) / 2, (sy0 + sy1) / 2
    # Source axes match the production exporter: runtime X=source Y, Z=-source X, Y=source Z.
    # Blender exporter converts Z-up to glTF Y-up as (x,z,-y). Compose that
    # conversion with the same legacy transform before computing expected GLB space.
    # Exact source->runtime matrix from export_real_scene.py::xform().
    transform = Matrix((
        (0, scale_x, 0, -scale_x * cy),
        (-scale_z, 0, 0, scale_z * cx),
        (0, 0, vertical_scale, -vertical_scale * sz0),
        (0, 0, 0, 1),
    ))
    rows = []
    for obj in sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.name):
        source_world = obj.matrix_world.copy()
        runtime_world = transform @ source_world
        rows.append({
            'name': obj.name,
            'collections': sorted(c.name for c in obj.users_collection),
            'vertices': len(obj.data.vertices),
            'polygons': len(obj.data.polygons),
            'exportEligible': eligible(obj),
            'worldMatrix': matrix_rows(source_world),
            'worldAabb': bbox_world(obj, source_world),
            'runtimeExpectedMatrix': matrix_rows(runtime_world),
            'runtimeExpectedAabb': bbox_world(obj, runtime_world),
        })
    result = {
        'sourceBlend': source,
        'sourceFileSize': Path(source).stat().st_size,
        'readOnly': True,
        'mapping': {
            'runtimeAxes': {'x': 'source Y', 'y': 'source Z', 'z': 'source X'},
            'matrix': matrix_rows(transform),
            'verticalScale': vertical_scale,
            'horizontalScaleXZ': [scale_x, scale_z],
            'sourceCenterXY': [cx, cy],
            'sourceBottomZ': sz0,
        },
        'meshCount': len(rows),
        'exportEligibleCount': sum(1 for row in rows if row['exportEligible']),
        'meshes': rows,
    }
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('sourceBlend', 'sourceFileSize', 'readOnly', 'mapping', 'meshCount', 'exportEligibleCount')}, ensure_ascii=False, indent=2))
    print('wrote', out)


if __name__ == '__main__':
    main()
