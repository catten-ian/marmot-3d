#!/usr/bin/env python3
"""Prepare a browser texture cache from the Verdant Trail source pack.

The exporter performs the Blender-side EXR conversion when it needs an image node. This
small utility handles ordinary PNG/JPEG sources ahead of time so repeated exports do not
re-read the original multi-GB pack. It is intentionally dependency-light (Pillow only).
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
from PIL import Image

def main():
    p=argparse.ArgumentParser(); p.add_argument('--src',required=True); p.add_argument('--out',required=True)
    p.add_argument('--near',type=int,default=2048); p.add_argument('--far',type=int,default=1024)
    a=p.parse_args(); src=Path(a.src); out=Path(a.out); out.mkdir(parents=True,exist_ok=True)
    records=[]
    for path in sorted(src.glob('*')):
        if path.suffix.lower() not in {'.png','.jpg','.jpeg'}: continue
        stem=path.stem.lower(); near=any(k in stem for k in ('ground','dirt','rock','boulder','root','trunk'))
        size=a.near if near else a.far
        normal=('nor_gl' in stem or 'alpha' in stem or 'mask' in stem or 'opacity' in stem)
        ext='.png' if normal else '.jpg'; dest=out/(path.stem+ext)
        try:
            im=Image.open(path); im.load(); im.thumbnail((size,size),Image.Resampling.LANCZOS)
            if ext=='.jpg':
                if im.mode not in ('RGB','L'): im=im.convert('RGB')
                im.save(dest,'JPEG',quality=82,optimize=True,progressive=True)
            else:
                if im.mode not in ('RGB','RGBA','L','LA'): im=im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
                im.save(dest,'PNG',optimize=True)
            records.append({'source':str(path),'output':str(dest),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'size':list(im.size),'bytes':dest.stat().st_size})
        except Exception as e:
            records.append({'source':str(path),'error':str(e)})
    (out/'texture-cache.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    print(json.dumps({'processed':sum('output' in x for x in records),'skipped':sum('error' in x for x in records),'out':str(out)},indent=2))
if __name__=='__main__': main()
