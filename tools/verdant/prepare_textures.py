#!/usr/bin/env python3
"""Prepare tiered browser texture caches for the Verdant source pack.

Ultra is deliberately *native*: source width/height are never changed. Ordinary tiers use
thumbnailing for the existing web budgets. EXR/HDR files are converted to PNG only when
Pillow cannot decode them; Blender conversion keeps their original dimensions and the
conversion is recorded in ``texture-cache.json``.
"""
from __future__ import annotations
import argparse, hashlib, json, shutil, subprocess, tempfile
from pathlib import Path
from PIL import Image

PROFILES = {
    'low': {'near': 1024, 'far': 512, 'normal': 512, 'native': False},
    'medium': {'near': 1280, 'far': 768, 'normal': 768, 'native': False},
    'high': {'near': 1536, 'far': 768, 'normal': 768, 'native': False},
    'ultra': {'native': True},
}
NEAR = ('ground', 'dirt', 'rock', 'boulder', 'root', 'trunk')
NORMAL = ('nor_gl', 'normal')
ALPHA = ('alpha', 'mask', 'opacity')
DISP = ('disp', 'displacement', 'height')
SUPPORTED = {'.png', '.jpg', '.jpeg', '.exr', '.hdr'}


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def kind_for(path: Path) -> str:
    n = path.stem.lower()
    if any(k in n for k in NORMAL): return 'normal'
    if any(k in n for k in ALPHA): return 'alpha'
    if any(k in n for k in DISP): return 'displacement'
    if any(k in n for k in ('rough', 'roughness')): return 'rough'
    if any(k in n for k in ('diff', 'basecolor', 'albedo')): return 'diff'
    if path.suffix.lower() == '.hdr': return 'environment'
    return 'other'


def dims(path: Path):
    try:
        with Image.open(path) as im:
            return list(im.size), im.mode, im.format
    except Exception:
        return None, None, None


def blender_convert_batch(pairs: list[tuple[Path, Path]], blender: str | None) -> dict[str, dict]:
    """Convert all EXR/HDR files in one Blender process (startup is expensive)."""
    if not pairs:
        return {}
    if not blender:
        return {str(src): {'ok': False, 'method': 'conversion unavailable', 'diagnostic': 'Pillow cannot decode source; pass --blender for native EXR/HDR conversion'} for src, _ in pairs}
    helper = Path(__file__).with_name('convert_native_batch.py')
    with tempfile.TemporaryDirectory(prefix='verdant-native-') as td:
        manifest = Path(td) / 'pairs.json'
        manifest.write_text(json.dumps([[str(src), str(dst)] for src, dst in pairs]), encoding='utf-8')
        result = subprocess.run([blender, '-b', '--python', str(helper), '--', '--manifest', str(manifest)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        results_path = manifest.with_suffix('.results.json')
        metadata = json.loads(results_path.read_text(encoding='utf-8')) if results_path.exists() else []
        by_name = {r.get('sourceName'): r for r in metadata}
        out = {}
        for src, dst in pairs:
            rec = by_name.get(src.name, {})
            ok = bool(rec.get('ok') and dst.exists() and result.returncode == 0)
            out[str(src)] = {'ok': ok, 'method': rec.get('method') or 'Blender conversion failed', **rec,
                             'diagnostic': (None if ok else (result.stdout or 'Blender conversion failed')[-1200:])}
        return out


def png_bit_depth(path: Path):
    try:
        with path.open('rb') as f:
            header = f.read(26)
        if header[:8] == b'\x89PNG\r\n\x1a\n' and header[12:16] == b'IHDR':
            return header[24]
    except OSError:
        pass
    return None


def prepare_native(src: Path, out: Path, blender: str | None):
    out.mkdir(parents=True, exist_ok=True)
    records = []; pending = []
    for path in sorted(src.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED: continue
        kind = kind_for(path); source_size, source_mode, source_format = dims(path)
        if path.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
            dest = out / path.name; shutil.copy2(path, dest); method = 'copy-native'; error = None
        else:
            dest = out / f'{path.stem}.png'; dest.unlink(missing_ok=True); pending.append((path, dest)); method = None; error = None
        records.append({'source': path.name, '_sourcePath': str(path), 'output': dest.relative_to(out).as_posix(), 'sourceName': path.name, 'kind': kind, 'method': method, 'converted': path.name != dest.name, 'sourceDimensions': source_size, 'sourceMode': source_mode, 'sourceFormat': source_format, 'sourceBytes': path.stat().st_size, '_dest': dest, **({'error': error} if error else {})})
    converted = blender_convert_batch(pending, blender)
    final = []
    for rec in records:
        dest = rec.pop('_dest'); src_path = Path(rec.pop('_sourcePath'))
        if rec['method'] is None:
            conversion = converted.get(str(src_path), {'ok': False, 'method': 'conversion unavailable'})
            if not conversion.get('ok'):
                rec['error'] = conversion.get('diagnostic') or conversion.get('error') or conversion.get('method') or 'conversion failed'
            else:
                rec['method'] = conversion['method']
                rec['sourceDimensions'] = conversion.get('sourceDimensions')
                rec['sourceDepth'] = conversion.get('sourceDepth')
                rec['sourceChannels'] = conversion.get('sourceChannels')
                rec['sourceFloat'] = conversion.get('sourceFloat')
        rec['output'] = dest.relative_to(out).as_posix()
        out_dims, out_mode, out_format = dims(dest)
        rec.update({'outputDimensions': out_dims, 'outputMode': out_mode, 'outputFormat': out_format, 'outputDepth': png_bit_depth(dest) if dest.exists() and dest.suffix.lower() == '.png' else 8, 'bytes': dest.stat().st_size if dest.exists() else 0, 'sha256': sha(dest) if dest.exists() else None, 'sourceSha256': sha(src_path)})
        if rec.get('method', '').startswith('blender-native-dimensions') and rec.get('sourceDimensions') != rec.get('outputDimensions'):
            rec['error'] = f"dimension mismatch: source={rec.get('sourceDimensions')} output={rec.get('outputDimensions')}"
        final.append(rec)
    (out / 'texture-cache.json').write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding='utf-8')
    failed = [r for r in final if r.get('error') or not r.get('sha256')]
    if failed:
        raise RuntimeError(f"native texture prep incomplete: {len(failed)} files failed; see {out / 'texture-cache.json'}")
    return final

def prepare_web(src: Path, out: Path, tier: str):
    profile = PROFILES[tier]; out.mkdir(parents=True, exist_ok=True); records = []
    for path in sorted(src.iterdir()):
        if not path.is_file() or path.suffix.lower() not in {'.png', '.jpg', '.jpeg'}: continue
        stem = path.stem.lower(); kind = kind_for(path)
        is_normal = kind == 'normal'; is_alpha = kind == 'alpha'
        size = profile['normal'] if is_normal else profile['near'] if any(k in stem for k in NEAR) else profile['far']
        ext = '.png' if is_normal or is_alpha else '.jpg'; dest = out / (path.stem + ext)
        try:
            with Image.open(path) as original:
                im = original.copy(); im.thumbnail((size, size), Image.Resampling.LANCZOS)
                if ext == '.jpg':
                    if im.mode not in ('RGB', 'L'): im = im.convert('RGB')
                    im.save(dest, 'JPEG', quality=88, optimize=True, progressive=True)
                else:
                    if im.mode not in ('RGB', 'RGBA', 'L', 'LA'): im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
                    im.save(dest, 'PNG', optimize=True)
                out_dims = list(im.size); out_mode = im.mode; out_format = ext[1:].upper()
            records.append({'source': path.name, 'output': dest.name, 'sourceName': path.name, 'kind': kind, 'method': 'thumbnail', 'sourceDimensions': list(original.size), 'outputDimensions': out_dims, 'sha256': sha(dest), 'bytes': dest.stat().st_size, 'sourceBytes': path.stat().st_size, 'sourceSha256': sha(path), 'outputMode': out_mode, 'outputFormat': out_format})
        except Exception as e:
            records.append({'source': str(path), 'error': str(e)})
    (out / 'texture-cache.json').write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding='utf-8')
    return records


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True); p.add_argument('--out', required=True)
    p.add_argument('--tier', choices=['low', 'medium', 'high', 'ultra', 'all'], default='all')
    p.add_argument('--blender', help='Blender executable used for EXR/HDR native conversion')
    a = p.parse_args(); src = Path(a.src).resolve(); root = Path(a.out).resolve()
    tiers = list(PROFILES) if a.tier == 'all' else [a.tier]
    for tier in tiers:
        out_dir = root / tier / ('textures' if PROFILES[tier].get('native') else '')
        records = prepare_native(src, out_dir, a.blender) if PROFILES[tier].get('native') else prepare_web(src, out_dir, tier)
        print(json.dumps({'tier': tier, 'processed': sum('output' in x for x in records), 'converted': sum(bool(x.get('converted')) for x in records), 'skipped': sum('error' in x for x in records), 'out': str(out_dir)}, ensure_ascii=False))


if __name__ == '__main__': main()
