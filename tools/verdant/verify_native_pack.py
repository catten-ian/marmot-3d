#!/usr/bin/env python3
"""Verify native Verdant texture dimensions, hashes and glTF external references."""
from __future__ import annotations
import argparse, hashlib, json, struct
from pathlib import Path
from PIL import Image


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def png_depth(path: Path):
    with path.open('rb') as f:
        header = f.read(26)
    return header[24] if header[:8] == b'\x89PNG\r\n\x1a\n' and header[12:16] == b'IHDR' else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', required=True)
    p.add_argument('--pack', required=True)
    a = p.parse_args()
    source, pack = Path(a.source).resolve(), Path(a.pack).resolve()
    texture_dir = pack / 'textures'
    cache_path = texture_dir / 'texture-cache.json'
    cache = json.loads(cache_path.read_text(encoding='utf-8'))
    errors = []; converted = []; dims_hist = {}; total_source = total_output = 0
    for rec in cache:
        name = rec['sourceName']; src = source / name; out = texture_dir / rec['output']
        if not src.is_file() or not out.is_file():
            errors.append(f'missing {name}: source={src.is_file()} output={out.is_file()}'); continue
        total_source += src.stat().st_size; total_output += out.stat().st_size
        source_sha, output_sha = sha(src), sha(out)
        if source_sha != rec.get('sourceSha256'): errors.append(f'source hash mismatch: {name}')
        if output_sha != rec.get('sha256') or out.stat().st_size != rec.get('bytes'): errors.append(f'output integrity mismatch: {name}')
        if out.suffix.lower() in {'.png','.jpg','.jpeg'}:
            try:
                with Image.open(out) as im: out_dims = list(im.size)
            except Exception as exc: errors.append(f'cannot decode output {name}: {exc}'); continue
        else: out_dims = rec.get('outputDimensions')
        source_dims = rec.get('sourceDimensions')
        if source_dims != out_dims: errors.append(f'dimension mismatch {name}: source={source_dims} output={out_dims}')
        dims_hist[str(source_dims)] = dims_hist.get(str(source_dims), 0) + 1
        if rec.get('converted'):
            converted.append({'source': name, 'kind': rec.get('kind'), 'sourceDimensions': source_dims,
                              'sourceFormat': rec.get('sourceFormat'), 'sourceDepth': rec.get('sourceDepth'),
                              'sourceChannels': rec.get('sourceChannels'), 'output': rec.get('output'),
                              'outputDepth': png_depth(out), 'bytes': out.stat().st_size,
                              'sha256': output_sha})
        elif source_sha != output_sha:
            errors.append(f'copy-native is not byte-identical: {name}')
    gltf_path = pack / 'verdant-trail-ultra.gltf'
    gltf = json.loads(gltf_path.read_text(encoding='utf-8'))
    refs = [b['uri'] for b in gltf.get('buffers', []) if b.get('uri')]
    refs += [im['uri'] for im in gltf.get('images', []) if im.get('uri') and not im['uri'].startswith('data:')]
    missing_refs = [r for r in refs if not (pack / r).is_file()]
    if missing_refs: errors.append('missing glTF external URI(s): ' + ', '.join(missing_refs[:20]))
    spot = {}
    for name in ['rock_07_nor_gl.png','dirt_floor_diff_4k.png','dirt_floor_nor_gl_4k.png','dirt_floor_rough_4k.png']:
        f = texture_dir / name
        if f.exists():
            with Image.open(f) as im: spot[name] = {'dimensions': list(im.size), 'bytes': f.stat().st_size, 'sha256': sha(f)}
        else: errors.append(f'missing required texture {name}')
    result = {'ok': not errors, 'sourceFiles': len(cache), 'convertedCount': len(converted),
              'dimensionHistogram': dims_hist, 'sourceBytes': total_source, 'outputBytes': total_output,
              'gltfImageReferences': len(gltf.get('images', [])), 'externalUris': len(refs),
              'spotChecks': spot, 'conversions': converted, 'errors': errors}
    report = pack.parent / 'native-texture-verification.json'
    report.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k != 'conversions'}, indent=2, ensure_ascii=False))
    if errors: raise SystemExit(1)

if __name__ == '__main__': main()
