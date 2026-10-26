#!/usr/bin/env python3
"""Regenerate verdant height JSON from the final GLB visual ground mesh.

The legacy exporter sampled the *source* ground through its own padded bounds
and scale chain; the result drifted from the exported GLB ground by up to
~10.9m at some runtime columns (datum mismatch, task-round2 class B). This
script imports the shipped GLB read-only, raycasts the actual `ground` mesh in
runtime Y-up coordinates on a grid over its own runtime AABB, and writes a
height JSON whose bounds/datum are exactly the visual mesh. No padding, no
re-scaling: collision JSON == visual ground by construction.
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--ground-object", default="ground")
    p.add_argument("--grid", type=int, default=257)
    return p.parse_args(argv)


def main():
    a = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.glb).resolve()))
    bpy.context.view_layer.update()
    ground = bpy.data.objects.get(a.ground_object)
    if not ground or ground.type != "MESH":
        raise SystemExit(f"ground object not found: {a.ground_object}")
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ground.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        verts = [ev.matrix_world @ v.co for v in me.vertices]
        faces = [[int(i) for i in f.vertices] for f in me.polygons]
    finally:
        ev.to_mesh_clear()
    bvh = BVHTree.FromPolygons(verts, faces, all_triangles=False)
    # Blender import is Z-up: runtime x=bx, runtime y=bz, runtime z=-by.
    xs = [v.x for v in verts]; ys = [v.y for v in verts]
    min_x, max_x = min(xs), max(xs)          # runtime X
    min_z, max_z = -max(ys), -min(ys)        # runtime Z
    n = a.grid
    heights = []
    hits = 0
    for j in range(n):
        rz = min_z + (max_z - min_z) * j / (n - 1)
        for i in range(n):
            rx = min_x + (max_x - min_x) * i / (n - 1)
            hit = bvh.ray_cast(Vector((rx, -rz, 10000.0)), Vector((0, 0, -1)), 20000.0)
            if hit[0] is None:
                heights.append(0.0)
            else:
                heights.append(float(hit[0].z)); hits += 1
    out_doc = {
        "format": 2,
        "gridSize": n,
        "bounds": {"minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z},
        "source": f"raycast of '{a.ground_object}' mesh inside {Path(a.glb).name}; runtime datum, no re-scaling",
        "raycastHits": hits,
        "raycastMisses": n * n - hits,
        "heights": heights,
    }
    out = Path(a.out).resolve()
    out.write_text(json.dumps(out_doc, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"out": str(out), "grid": n, "hits": hits, "misses": n*n-hits,
                      "min": min(heights), "max": max(heights)}, indent=2))


if __name__ == "__main__":
    main()
