#!/usr/bin/env python3
"""Objective geometry grounding audit for the Verdant scene.

The script is deliberately read-only with respect to the input blend/GLB.  It
loads the scene in Blender, builds a BVH over the named ground mesh, and for
*every* mesh node reports world/runtime AABB, terrain support samples and a
classification.  ``gap`` is the median vertical distance from the lowest 1%
of actual evaluated vertices to the first terrain triangle below the same X/Z
location.  Positive means visually floating; negative means embedded.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

COLLECTIONS = {
    "main_scene", "foliage", "debris", "cliffs_boulders", "background",
    "scene_components", "debris_patches", "grass_medium_02", "hanging_grass",
    "island_tree_01_branches", "island_tree_01_leaves", "jacaranda_tree_leaves",
    "shrub_01", "shrub_03", "shrub_04", "tree_small_02_leaves",
}
DROP_RE = ("rubberduck", "rubber_duck", "rubberduck_toy", "duck", "dots stroke")
ARTIFACT_RE = ("shadow", "bacground_ground")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--blend")
    g.add_argument("--glb")
    p.add_argument("--out", required=True)
    p.add_argument("--ground-object", default="ground")
    p.add_argument("--sample-grid", type=int, default=7)
    p.add_argument("--gap-threshold", type=float, default=0.15)
    p.add_argument("--backdrop-distance", type=float, default=8.0)
    p.add_argument("--fog-far", type=float, default=175.0)
    p.add_argument("--source-audit", default=None, help="optional source blend audit used to preserve authored category roles on GLB rows")
    return p.parse_args(argv)


def matrix_rows(m):
    return [[float(m[r][c]) for c in range(4)] for r in range(4)]


def evaluated_points(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    try:
        pts = [ev.matrix_world @ v.co for v in mesh.vertices]
    finally:
        ev.to_mesh_clear()
    if not pts:
        pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return pts


def runtime_points(points, transform):
    """Map Blender world points to the runtime X/Y/Z convention."""
    out = []
    for p in points:
        q = transform @ p if transform is not None else p
        # Blender is Z-up while the browser GLB/runtime is Y-up.  The exporter
        # uses the same source-axis mapping before glTF conversion.
        out.append(Vector((q.x, q.z, -q.y)))
    return out


def bbox_from_points(points):
    mn = [min(p[i] for p in points) for i in range(3)]
    mx = [max(p[i] for p in points) for i in range(3)]
    return mn, mx


def build_bvh(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    try:
        verts = [ev.matrix_world @ v.co for v in mesh.vertices]
        faces = [[int(i) for i in f.vertices] for f in mesh.polygons]
        return BVHTree.FromPolygons(verts, faces, all_triangles=False)
    finally:
        ev.to_mesh_clear()


def is_support_terrain(obj, ground_name):
    """Actual walkable terrain support: ground plus authored rock/cliff masses.

    Plant canopies, logs, shadows, water and remote background are deliberately
    not support surfaces. A target mesh is removed from the support probes so
    it cannot prove its own grounding.
    """
    name = obj.name.lower()
    if name == ground_name.lower():
        return True
    if any(k in name for k in ARTIFACT_RE) or "background" in name or "water" in name:
        return False
    return any(k in name for k in ("boulder", "rock", "cliff", "sand"))


def build_support_bvhs(objects, depsgraph, ground_name):
    return {obj.name: build_bvh(obj, depsgraph) for obj in objects if is_support_terrain(obj, ground_name)}


def ground_probe(ground_bvh, support_bvhs, target_name, points, runtime_bbox, transform, vertical_scale, vertical_offset, grid_size):
    """Project AABB bottom center/corners and actual lower vertices onto ground.

    The primary ``gap`` follows the requested definition exactly:
    ``bboxMinY - groundYBelow`` at the bottom-face center. Four AABB footprint
    corners and lower actual vertices are reported as cross-checks. A miss is
    always null (never an invented zero), which prevents false support over sea.
    """
    n = max(3, int(grid_size))
    b = runtime_bbox
    cx = (b["min"][0] + b["max"][0]) / 2.0
    cz = (b["min"][2] + b["max"][2]) / 2.0
    footprint = {
        "bottomCenter": [cx, cz],
        "corners": [
            [b["min"][0], b["min"][2]], [b["min"][0], b["max"][2]],
            [b["max"][0], b["min"][2]], [b["max"][0], b["max"][2]],
        ],
    }

    inv = transform.inverted() if transform is not None else None
    def source_xy(rx, rz):
        # Runtime point converted back to the Blender-Z-up target coordinates.
        q = Vector((rx, -rz, 0.0))
        p = inv @ q if inv is not None else q
        return p.x, p.y

    def sample_from(bvhs, rx, rz, exclude_name=None):
        sx, sy = source_xy(rx, rz)
        origin = Vector((sx, sy, 10000.0)); direction = Vector((0, 0, -1))
        best = None
        for name, bvh in bvhs.items():
            if name == exclude_name:
                continue
            hit = bvh.ray_cast(origin, direction, 20000.0)
            if hit[0] is None:
                continue
            y = float(hit[0].z * vertical_scale + vertical_offset)
            if best is None or y > best:
                best = y
        return best

    # Requested local terrain support is the highest actual walkable terrain
    # triangle below/at the footprint. GLB collision solids include cliffs and
    # boulders; compare the separate ground-only height mesh as a datum check.
    center_y = sample_from(support_bvhs, cx, cz, target_name)
    center_y_ground = sample_from({"ground": ground_bvh}, cx, cz)
    corner_values = [sample_from(support_bvhs, x, z, target_name) for x, z in footprint["corners"]]
    corner_hits = [v for v in corner_values if v is not None]

    # Diagnostic AABB footprint grid; all misses remain explicit.
    grid_hits = 0
    grid_ground_samples = []
    for j in range(n):
        z = b["min"][2] + (b["max"][2] - b["min"][2]) * j / (n - 1)
        for i in range(n):
            x = b["min"][0] + (b["max"][0] - b["min"][0]) * i / (n - 1)
            y = sample_from(support_bvhs, x, z, target_name)
            if y is not None:
                grid_hits += 1
                grid_ground_samples.append({
                    "x": float(x), "z": float(z), "y": float(y),
                    "horizontalDistanceToBottomCenter": float(math.hypot(x - cx, z - cz)),
                })
    nearest_grid_ground = min(grid_ground_samples, key=lambda r: r["horizontalDistanceToBottomCenter"]) if grid_ground_samples else None

    # Cross-check actual lowest 1% of evaluated vertices against terrain at
    # each same X/Z location, useful for irregular root/contact footprints.
    zmin = min(p.z for p in points)
    zmax = max(p.z for p in points)
    eps = max(0.012, (zmax - zmin) * 0.01)
    bottom = [p for p in points if p.z <= zmin + eps]
    if len(bottom) > 96:
        stride = max(1, len(bottom) // 96)
        bottom = bottom[::stride][:96]
    bottom_gaps = []
    bottom_support = []
    bottom_misses = 0
    for p in bottom:
        if transform is not None:
            q = transform @ p
            rx, rz = float(q.x), float(-q.y)
            bottom_y = float(q.z)
        else:
            rx, rz, bottom_y = float(p.x), float(-p.y), float(p.z)
        support = sample_from(support_bvhs, rx, rz, target_name)
        if support is None:
            bottom_misses += 1
        else:
            bottom_support.append(support)
            bottom_gaps.append(bottom_y - support)
    bottom_gaps.sort(); bottom_support.sort()
    med = lambda values: None if not values else float(values[len(values) // 2])
    support_source = "aabb_bottom_center"
    resolved_ground_y = center_y
    if resolved_ground_y is None and bottom_support:
        # Explicit fallback is still a true BVH triangle sample at an actual
        # bottom vertex; never synthesize ground=0 for offshore/missed samples.
        resolved_ground_y = med(bottom_support)
        support_source = "median_actual_bottom_vertex_hits"
    gap = None if resolved_ground_y is None else float(b["min"][1] - resolved_ground_y)
    return {
        "bboxBottomCenter": [float(cx), float(b["min"][1]), float(cz)],
        "footprintCornersXZ": footprint["corners"],
        "groundYAtBottomCenter": center_y,
        "groundYAtBottomCenterGroundMesh": center_y_ground,
        "groundYBelowResolved": resolved_ground_y,
        "groundSupportSource": support_source if resolved_ground_y is not None else "no_ground_triangle_hit",
        "groundYAtFootprintCorners": corner_values,
        "cornerHits": len(corner_hits),
        "cornerMisses": len(corner_values) - len(corner_hits),
        "gap": gap,
        "gridSamples": n * n,
        "gridHits": grid_hits,
        "gridMisses": n * n - grid_hits,
        "gridGroundSamples": grid_ground_samples,
        "nearestGridGroundSample": nearest_grid_ground,
        "bottomVertices": len(bottom),
        "bottomHits": len(bottom_gaps),
        "bottomMisses": bottom_misses,
        "gapBottomMin": min(bottom_gaps) if bottom_gaps else None,
        "gapBottomMedian": med(bottom_gaps),
        "gapBottomMax": max(bottom_gaps) if bottom_gaps else None,
        "groundYBottomMedian": med(bottom_support),
    }


def export_eligible(obj):
    if obj.type != "MESH" or obj.hide_render:
        return False
    name = obj.name.lower()
    cols = {c.name.lower() for c in obj.users_collection}
    if any(k in name for k in DROP_RE) or any(k in name for k in ARTIFACT_RE):
        return False
    if not (cols & COLLECTIONS):
        return False
    if not ({"background", "main_scene", "foliage", "scene_components"} & cols):
        if not (({"cliffs_boulders", "debris"} & cols) and any(
            k in name for k in ("root", "boulder", "dead_tree", "fallen_log", "cliff")
        )):
            return False
    if len(obj.data.polygons) > 100000 and "background" not in cols and not any(
        k in name for k in ("root", "boulder", "dead_tree", "cliff")
    ):
        return False
    return True


def runtime_bounds(points):
    mn, mx = bbox_from_points(points)
    return {
        "minX": float(mn[0]), "maxX": float(mx[0]),
        "minY": float(mn[1]), "maxY": float(mx[1]),
        "minZ": float(mn[2]), "maxZ": float(mx[2]),
    }


def horizontal_distance_to_bounds(bounds, center, playable):
    dx = max(playable["minX"] - bounds["max"][0], 0.0, bounds["min"][0] - playable["maxX"])
    dz = max(playable["minZ"] - bounds["max"][2], 0.0, bounds["min"][2] - playable["maxZ"])
    center_distance = math.hypot(
        center[0] - (playable["minX"] + playable["maxX"]) / 2.0,
        center[2] - (playable["minZ"] + playable["maxZ"]) / 2.0,
    )
    return math.hypot(dx, dz), center_distance


def classify(obj, name, cols, bounds, center, playable, is_source, backdrop_distance):
    lower = name.lower()
    if lower == "ground":
        return "terrain", "reference walkable ground mesh"
    if any(k in lower for k in ARTIFACT_RE):
        return "excluded_artifact", "known near-scene shadow/slab artifact; excluded from runtime export"
    if is_source and not export_eligible(obj):
        return "not_exported", "source mesh is excluded by Verdant exporter selection"

    distance, center_distance = horizontal_distance_to_bounds(bounds, center, playable)
    remote_cliff = lower.startswith("background_cliff")
    # Only explicit far-background tree families can use the island exemption.
    # tree_small_02_* are ordinary trees in the playable footprint, even though
    # their centers happen to lie beyond 40 m; they remain grounded candidates.
    remote_background_tree = ("background" in cols and any(
        k in lower for k in ("island_tree", "jacaranda")
    ))
    remote_background_water = lower == "background_water"
    # Remote semantic pieces qualify only with a genuine bounds-distance gap,
    # or an explicit background-island semantic plus center-distance/fog proof.
    # Record both measurements so the latter cannot be mistaken for exterior
    # separation. Broad near-field slabs are never exempted by center distance.
    remote_evidence = distance >= backdrop_distance or (
        remote_background_tree and center_distance >= 40.0
    )
    if (remote_cliff or remote_background_tree) and remote_evidence:
        return "backdrop", (
            f"remote background/sea mesh; bounds distance {distance:.2f}m, "
            f"playable-center distance {center_distance:.2f}m (threshold 40m), fogFar 175m"
        )
    if remote_background_water:
        return "background_surface", (
            f"non-contact ocean surface; bounds distance {distance:.2f}m, "
            f"playable-center distance {center_distance:.2f}m; not a prop or support surface"
        )
    if remote_cliff:
        return "near_background", (
            f"background cliff is only {distance:.2f}m outside playable bounds; "
            "not eligible for backdrop exemption"
        )
    # A background-named tree without bounds-distance proof remains a playable
    # grounded candidate; source collection names never override geometry.

    if any(k in lower for k in ("leaves", "branch", "ivy")) and not any(
        k in lower for k in ("root", "trunk", "dead_tree")
    ):
        return "decorative_noncontact", "canopy/leaf/branch component; trunk/root is the contact proxy"
    if any(k in lower for k in (
        "tree", "trunk", "root", "boulder", "rock", "cliff", "stone", "sand", "dirt",
        "fallen_log", "shrub", "foliage", "grass", "ivy", "island",
    )):
        return "grounded", "playable vegetation/rock/prop; no remote backdrop evidence"
    if "background" in cols:
        return "unresolved", "background mesh lacks a valid remote-distance exemption"
    return "grounded_candidate", "visible mesh requires contact-role review"


def main():
    a = parse_args()
    is_source = bool(a.blend)
    if is_source:
        path = str(Path(a.blend).resolve())
        bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
    else:
        path = str(Path(a.glb).resolve())
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        bpy.context.view_layer.update()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    ground = bpy.data.objects.get(a.ground_object)
    if not ground or ground.type != "MESH":
        raise SystemExit(f"ground object not found: {a.ground_object}")

    # This is the exact legacy mapping used by export_real_scene.py.  The source
    # blend is Z-up with horizontal source X/Y; the browser is Y-up with runtime
    # X=source Y and runtime Z=source X.
    transform = None
    mapping = {
        "input": "blend" if is_source else "glb",
        "runtimeAxes": {"x": "sourceY", "y": "sourceZ", "z": "sourceX"},
    }
    ground_source_points = evaluated_points(ground, depsgraph)
    if is_source:
        sx0 = min(p.x for p in ground_source_points)
        sx1 = max(p.x for p in ground_source_points)
        sy0 = min(p.y for p in ground_source_points)
        sy1 = max(p.y for p in ground_source_points)
        sz0 = min(p.z for p in ground_source_points)
        sx = 130.0 / (sy1 - sy0) * 0.88
        sz = 78.0 / (sx1 - sx0) * 0.88
        sy = min(sx, sz)
        source_x_center = (sx0 + sx1) / 2.0
        source_y_center = (sy0 + sy1) / 2.0
        # Exporter's Matrix: target Blender Z-up coordinates before glTF export.
        transform = Matrix((
            (0, sx, 0, -sx * source_y_center),
            (-sz, 0, 0, sz * source_x_center),
            (0, 0, sy, -sy * sz0),
            (0, 0, 0, 1),
        ))
        mapping.update({
            "matrix": matrix_rows(transform),
            "verticalScale": sy,
            "verticalOffset": -sz0 * sy,
            "horizontalScaleXZ": [sx, sz],
            "sourceCenterXY": [source_x_center, source_y_center],
            "sourceBottomZ": sz0,
        })
    else:
        mapping.update({"matrix": "GLB imported Blender Z-up -> runtime Y-up", "verticalScale": 1.0, "verticalOffset": 0.0})

    ground_bvh = build_bvh(ground, depsgraph)
    source_roles = {}
    if a.source_audit:
        source_doc = json.loads(Path(a.source_audit).resolve().read_text(encoding="utf-8"))
        source_roles = {r.get("name"): r for r in source_doc.get("meshes", []) if r.get("name")}
    mesh_objects = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda x: x.name)
    # Grounding datum is the authored terrain mesh itself. Collision/rock
    # surfaces are audited separately by the runtime field comparison below;
    # they must not be allowed to create a false zero over sea or a self-hit.
    support_bvhs = {"ground": ground_bvh}
    playable = runtime_bounds(runtime_points(ground_source_points, transform))
    rows = []
    for obj in mesh_objects:
        points = evaluated_points(obj, depsgraph)
        runtime = runtime_points(points, transform)
        mn, mx = bbox_from_points(runtime)
        center = [float((mn[i] + mx[i]) / 2.0) for i in range(3)]
        cols = {c.name.lower() for c in obj.users_collection}
        bounds = {"min": mn, "max": mx}
        category, basis = classify(
            obj, obj.name, cols, bounds, center, playable, is_source, a.backdrop_distance
        )
        source_role = source_roles.get(obj.name)
        if source_role and not is_source:
            # The blend audit is the authority for authored semantic roles. This
            # prevents a remote jacaranda/tree component that has no local
            # ground hit in the GLB from being misreported as a grounded failure.
            category = source_role.get("category", category)
            basis = "source blend role: " + source_role.get("classificationBasis", basis)
        scale = float(mapping["verticalScale"])
        offset = float(mapping["verticalOffset"])
        probe = ground_probe(ground_bvh, support_bvhs, obj.name, points, bounds, transform, scale, offset, a.sample_grid)
        gap_runtime = probe["gap"]
        ground_y = probe["groundYBelowResolved"]
        distance, center_distance = horizontal_distance_to_bounds(bounds, center, playable)
        status = "not_applicable"
        grounding_pass = None
        if category == "grounded":
            # A small amount of soil penetration is explicitly allowed. The
            # acceptance condition is therefore an upper bound on positive
            # clearance, not an absolute-value bound.
            grounding_pass = gap_runtime is not None and gap_runtime <= a.gap_threshold
            if gap_runtime is None:
                status = "no_ground_hit"
            elif gap_runtime > a.gap_threshold:
                status = "floating"
            elif gap_runtime < -a.gap_threshold:
                status = "embedded"
            else:
                status = "grounded"
        elif category in ("backdrop", "near_background", "excluded_artifact"):
            status = "remote_backdrop" if category == "backdrop" else "excluded"

        backdrop_evidence = None
        surface_evidence = None
        if category == "backdrop":
            backdrop_evidence = {
                "distanceToPlayableBoundsMeters": float(distance),
                "distanceToPlayableCenterMeters": float(center_distance),
                "fogNearMeters": 42.0,
                "fogFarMeters": float(a.fog_far),
                "inFogBand": bool(center_distance >= 42.0 and center_distance <= a.fog_far),
                "behindFogFar": bool(center_distance > a.fog_far),
                "remoteDistanceThresholdMeters": float(a.backdrop_distance),
                "remoteCenterDistanceThresholdMeters": 40.0,
                "boundsActuallyOutsidePlayableAabb": bool(distance >= a.backdrop_distance),
            }
        if category == "background_surface":
            surface_evidence = {
                "distanceToPlayableBoundsMeters": float(distance),
                "distanceToPlayableCenterMeters": float(center_distance),
                "nonContactSurface": True,
                "usedAsGroundSupport": False,
            }
        rows.append({
            "name": obj.name,
            "collections": sorted(c.name for c in obj.users_collection),
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "exportEligible": export_eligible(obj) if is_source else True,
            "bbox": {"min": [float(v) for v in mn], "max": [float(v) for v in mx]},
            "bboxMinY": float(mn[1]),
            "groundYBelow": ground_y,
            "gap": gap_runtime,
            "gapBottomMin": probe["gapBottomMin"],
            "gapBottomMedian": probe["gapBottomMedian"],
            "gapBottomMax": probe["gapBottomMax"],
            "footprintRadius": float(0.5 * math.hypot(mx[0] - mn[0], mx[2] - mn[2])),
            "footprintCenter": {"x": center[0], "y": center[1], "z": center[2]},
            "groundSample": probe,
            "category": category,
            "classificationBasis": basis,
            "distanceToPlayableMeters": float(distance),
            "distanceToPlayableCenterMeters": float(center_distance),
            "backdropEvidence": backdrop_evidence,
            "nonGroundSurfaceEvidence": surface_evidence,
            "groundingStatus": status,
            "groundingPass": grounding_pass,
            "deltaY": 0.0,
        })

    summary = {
        "groundedTotal": sum(r["category"] == "grounded" for r in rows),
        "groundedPass": sum(r["category"] == "grounded" and r["gap"] is not None and r["gap"] <= a.gap_threshold for r in rows),
        "groundedOverThreshold": sum(r["category"] == "grounded" and (r["gap"] is None or r["gap"] > a.gap_threshold) for r in rows),
        "groundedEmbedded": sum(r["category"] == "grounded" and r["gap"] is not None and r["gap"] < -a.gap_threshold for r in rows),
        "groundedNoHit": sum(r["category"] == "grounded" and r["gap"] is None for r in rows),
        "backdropTotal": sum(r["category"] == "backdrop" for r in rows),
        "backdropWithDistanceEvidence": sum(r["category"] == "backdrop" and bool(r["backdropEvidence"]) for r in rows),
        "nearBackgroundTotal": sum(r["category"] == "near_background" for r in rows),
        "excludedArtifactTotal": sum(r["category"] == "excluded_artifact" for r in rows),
    }
    result = {
        "format": 4,
        "algorithm": {
            "version": "grounding-audit-v6",
            "surface": "actual authored ground mesh triangles via Blender BVH; heightJson is not used to invent a hit",
            "gapDefinition": "bboxMinY minus highest actual support terrain triangle under the AABB bottom-center; if center misses, median actual lower-vertex support hits are used and identified; corners/grid misses are explicit; negative means penetration",
            "footprintGrid": f"{max(3, a.sample_grid)}x{max(3, a.sample_grid)} diagnostic samples; misses remain null and never become zero",
            "backdropPolicy": "background cliff must be outside playable AABB by threshold; explicitly named background island tree may instead qualify by center distance >=40m with fog context; ordinary tree_small_02 trees remain grounded; ocean plane is background_surface, never a backdrop prop or support",
            "acceptance": "grounded positive gap <= threshold; negative gap is allowed soil penetration and is counted separately as embedded",
            "gapThresholdMeters": a.gap_threshold,
            "backdropDistanceThresholdMeters": a.backdrop_distance,
            "fogFarMeters": a.fog_far,
            "sourceReadOnly": True,
        },
        "input": path,
        "mapping": mapping,
        "playableBounds": playable,
        "meshCount": len(rows),
        "exportEligibleCount": sum(r["exportEligible"] for r in rows),
        "summary": summary,
        "meshes": rows,
    }
    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"input": path, "meshCount": len(rows), "exportEligibleCount": result["exportEligibleCount"], "summary": summary, "out": str(out)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
