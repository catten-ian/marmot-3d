#!/usr/bin/env python3
"""Compare audited GLB ground-triangle hits with the shipped height JSON."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit', required=True)
    parser.add_argument('--height', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    audit = json.loads(Path(args.audit).read_text(encoding='utf8'))
    height_path = Path(args.height)
    height_bytes = height_path.read_bytes()
    height = json.loads(height_bytes)
    n = height['gridSize']
    bounds = height['bounds']

    def height_at(x, z):
        tx = max(0.0, min(1.0, (x - bounds['minX']) / (bounds['maxX'] - bounds['minX'])))
        tz = max(0.0, min(1.0, (z - bounds['minZ']) / (bounds['maxZ'] - bounds['minZ'])))
        gx, gz = tx * (n - 1), tz * (n - 1)
        i, j = int(gx), int(gz)
        i1, j1 = min(n - 1, i + 1), min(n - 1, j + 1)
        fx, fz = gx - i, gz - j
        at = lambda ii, jj: height['heights'][jj * n + ii]
        a = at(i, j) * (1 - fx) + at(i1, j) * fx
        b = at(i, j1) * (1 - fx) + at(i1, j1) * fx
        return a * (1 - fz) + b * fz

    samples = []
    for row in audit['meshes']:
        if row['category'] != 'grounded':
            continue
        visual = row['groundSample']['groundYAtBottomCenterGroundMesh']
        if visual is None:
            continue
        x, z = row['footprintCenter']['x'], row['footprintCenter']['z']
        sampled = height_at(x, z)
        samples.append({
            'name': row['name'], 'category': row['category'],
            'x': round(x, 4), 'z': round(z, 4),
            'visualGroundY': round(visual, 4), 'heightJsonY': round(sampled, 4),
            'visualMinusHeightJson': round(visual - sampled, 4),
        })
    result = {
        'format': 1,
        'description': 'GLB visual ground BVH vs regenerated height.json (257^2 raycast of the same ground mesh)',
        'heightSha256': hashlib.sha256(height_bytes).hexdigest(),
        'maxAbsVisualMinusHeightJsonMeters': round(max(abs(s['visualMinusHeightJson']) for s in samples), 4),
        'samples': samples,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'out': str(out), 'sampleCount': len(samples),
                      'maxAbsVisualMinusHeightJsonMeters': result['maxAbsVisualMinusHeightJsonMeters']}, indent=2))


if __name__ == '__main__':
    main()
