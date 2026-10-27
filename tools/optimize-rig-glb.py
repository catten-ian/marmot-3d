"""
绑定角色（rigged）GLB 的**只压贴图**优化器 —— 保留 skin 与 animation。

为什么不能直接用 optimize-glb.py：
    那个工具做**顶点聚类简化**（cluster_simplify），会把多个顶点合并成一个。
    对带蒙皮的角色，合并顶点意味着 JOINTS_0 / WEIGHTS_0 失去意义 ——
    一个顶点只能有一组骨骼权重，合并后骨骼形变直接崩掉，
    动画（skin 的 inverseBindMatrices + 动画轨道）也就全废了。
    所以绑定角色必须走"只换贴图、不动顶点"的路子。

做法：
    1. 逐个 image 的 bufferView：解码 → 缩放 → 重新编码；
    2. **其余所有 bufferView 原样字节复制**（几何、JOINTS、WEIGHTS、
       inverseBindMatrices、动画采样器一个字节都不改）；
    3. 重排 BIN chunk 并回写每个 bufferView 的 byteOffset / byteLength。

安全前提：
    · accessor 的 byteOffset 是**相对 bufferView** 的，所以整体搬移 bufferView
      不会破坏 accessor —— 这也是能安全重排的原因。
    · 几何数据不动 ⇒ 三角形数量、朝向、面数完全保持。

用法：
    python3 tools/optimize-rig-glb.py assets/models/marmot-rig.glb \
        --out assets/models/marmot-rig.glb --size 1024
"""

import argparse
import io
import json
import os
import struct
import sys

from PIL import Image

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'glTF':
        raise ValueError('not a GLB: %s' % path)
    total = struct.unpack('<I', data[8:12])[0]
    off = 12
    js = None
    bin_data = None
    while off < total:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        payload = data[off + 8:off + 8 + clen]
        if ctype == JSON_CHUNK:
            js = json.loads(payload.decode('utf-8'))
        elif ctype == BIN_CHUNK:
            bin_data = payload
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    if js is None:
        raise ValueError('GLB has no JSON chunk')
    return js, (bin_data or b'')


def write_glb(path, js, bin_data):
    """写 GLB。chunkLength 含 padding 且为 4 的倍数 —— three.js 按 chunkLength
    定位下一个 chunk，不会自己补对齐，少算 padding 会让整个模型加载失败。"""
    js_bytes = json.dumps(js, separators=(',', ':')).encode('utf-8')
    js_pad = (4 - len(js_bytes) % 4) % 4
    bin_pad = (4 - len(bin_data) % 4) % 4
    total = 12 + 8 + len(js_bytes) + js_pad + (8 + len(bin_data) + bin_pad if bin_data else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', GLB_MAGIC, 2, total))
        f.write(struct.pack('<II', len(js_bytes) + js_pad, JSON_CHUNK))
        f.write(js_bytes)
        f.write(b' ' * js_pad)
        if bin_data:
            f.write(struct.pack('<II', len(bin_data) + bin_pad, BIN_CHUNK))
            f.write(bin_data)
            f.write(b'\x00' * bin_pad)


def align4(n):
    return (n + 3) & ~3


def encode_image(raw, mime, max_size, quality):
    """缩放并重新编码一张贴图。返回 (bytes, mime, size)。

    法线贴图保留 PNG（JPEG 的块效应会在法线上变成明显的明暗噪点）；
    其余用 JPEG（体积差距巨大）。
    """
    im = Image.open(io.BytesIO(raw))
    if im.mode not in ('RGB', 'RGBA', 'L'):
        im = im.convert('RGB')
    w, h = im.size
    if max(w, h) > max_size:
        s = max_size / float(max(w, h))
        nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
        im = im.resize((nw, nh), Image.LANCZOS)
    buf = io.BytesIO()
    if mime == 'image/png':
        im.save(buf, 'PNG', optimize=True, compress_level=9)
        out_mime = 'image/png'
    else:
        if im.mode == 'RGBA':
            im = im.convert('RGB')
        im.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
        out_mime = 'image/jpeg'
    return buf.getvalue(), out_mime, im.size


def optimize(src, dst, max_size=1024, quality=85, only=None):
    js, bin_data = read_glb(src)
    before = os.path.getsize(src)

    views = js['bufferViews']
    images = js.get('images', [])

    # image -> 它的 bufferView 索引
    image_views = {}
    for idx, img in enumerate(images):
        if 'bufferView' not in img:
            continue  # uri 形式的外部贴图（本文件没有），不动
        image_views.setdefault(img['bufferView'], []).append(idx)

    replacements = {}   # bufferView index -> (bytes, mime)
    report = []
    for bvi, img_idxs in image_views.items():
        bv = views[bvi]
        off = bv.get('byteOffset', 0)
        raw = bin_data[off:off + bv['byteLength']]
        name = images[img_idxs[0]].get('name', 'image%d' % img_idxs[0])
        if only and only not in name:
            continue
        mime = images[img_idxs[0]].get('mimeType', 'image/jpeg')
        # 法线贴图按名字识别（Normal/normal/GL_ 前缀）
        is_normal = ('normal' in name.lower()) or ('normal' in mime.lower())
        new_bytes, new_mime, size = encode_image(raw, mime, max_size, quality)
        if is_normal and new_mime != 'image/png':
            new_bytes, new_mime, size = encode_image(raw, 'image/png', max_size, quality)
        replacements[bvi] = (new_bytes, new_mime)
        for i in img_idxs:
            images[i]['mimeType'] = new_mime
        report.append((name, mime, new_mime, len(raw), len(new_bytes), size))

    # 重排 BIN：逐 bufferView 原样复制，image 的换成压缩后的
    out = bytearray()
    new_offsets = {}
    for i, bv in enumerate(views):
        if i in replacements:
            data = replacements[i][0]
        else:
            off = bv.get('byteOffset', 0)
            data = bin_data[off:off + bv['byteLength']]
        pad = align4(len(out)) - len(out)
        out += b'\x00' * pad
        new_offsets[i] = len(out)
        out += data
        bv['byteOffset'] = len(out)
        bv['byteLength'] = len(data)
    for i, off in new_offsets.items():
        views[i]['byteOffset'] = off

    if js.get('buffers'):
        js['buffers'][0]['byteLength'] = len(out)

    write_glb(dst, js, bytes(out))

    after = os.path.getsize(dst)
    print('源:        %s  %.2f MB' % (src, before / 1048576.0))
    for name, m0, m1, b0, b1, size in report:
        print('  %-28s %-11s -> %-11s %7.1fKB -> %6.1fKB  %dx%d'
              % (name[:28], m0, m1, b0 / 1024.0, b1 / 1024.0, size[0], size[1]))
    print('输出:      %s  %.2f MB  (节省 %.0f%%)'
          % (dst, after / 1048576.0, (1 - after / float(before)) * 100))
    print('几何/骨骼/动画字节未改动（只替换贴图 bufferView）')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--quality', type=int, default=85)
    ap.add_argument('--only', default=None, help='只处理名字包含该串的贴图')
    args = ap.parse_args()
    optimize(args.src, args.out, args.size, args.quality, args.only)


if __name__ == '__main__':
    main()
