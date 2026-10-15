"""
GLB 三角形绕序检查 —— 判断模型会不会被背面剔除剔成"空壳"。

原理：对每个三角形算 (v1-v0)×(v2-v0) 得到面法线，
再看它与"顶点→模型中心"方向的点积：
  · 点积 > 0 → 法线朝外（正面朝外，符合预期）
  · 点积 < 0 → 法线朝内（这一面被背面剔除剔掉）

若"朝内"的比例接近 50%（而不是接近 0），说明**绕序不一致** ——
这正是摄影测量网格经顶点聚类简化后的典型特征。
此时必须开 doubleSided，否则模型只渲染出一半面，视觉上几乎消失。

用法：python tools/check-winding.py
"""
import struct
import json
import sys
import os

import numpy as np

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'models')


def load_glb(path):
    d = open(path, 'rb').read()
    o = 12
    js = None
    binary = None
    while o < len(d):
        ln, ty = struct.unpack('<II', d[o:o + 8])
        if ty == 0x4E4F534A:
            js = json.loads(d[o + 8:o + 8 + ln].decode('utf-8').rstrip())
        elif ty == 0x004E4942:
            binary = d[o + 8:o + 8 + ln]
        o += 8 + ln
    return js, binary


COMP_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_CNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def check(path, label):
    js, binary = load_glb(path)
    acc = js['accessors']
    bv = js['bufferViews']
    prim = js['meshes'][0]['primitives'][0]

    pa = acc[prim['attributes']['POSITION']]
    P = np.frombuffer(binary, dtype='<f4',
                      count=pa['count'] * 3,
                      offset=bv[pa['bufferView']].get('byteOffset', 0)).reshape(-1, 3)

    ia = acc[prim['indices']]
    I = np.frombuffer(binary, dtype='<u4', count=ia['count'],
                      offset=bv[ia['bufferView']].get('byteOffset', 0))
    n = I.size // 3
    I = I[:n * 3].reshape(-1, 3)

    v0, v1, v2 = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]
    nn = np.cross(v1 - v0, v2 - v0)
    cen = P.mean(axis=0)
    out = (nn * (v0 - cen)).sum(axis=1)
    outward = int((out > 0).sum())
    inward = int((out <= 0).sum())
    total = max(1, outward + inward)

    ds = js['materials'][0].get('doubleSided', False)

    print('=== %s ===' % label)
    print('  顶点 %d   三角面 %d' % (len(P), n))
    print('  索引最大 %d (应 < %d)' % (I.max(), len(P)))
    print('  法线朝外 %d (%.1f%%)   朝内 %d (%.1f%%)'
          % (outward, outward / total * 100, inward, inward / total * 100))
    print('  doubleSided = %s' % ds)
    ratio = inward / total
    if ratio > 0.2:
        verdict = '绕序不一致 ❌  (必须 doubleSided，否则渲染成空壳)'
    else:
        verdict = '绕序正常 ✅'
    print('  → %s' % verdict)
    print()
    return ratio, ds


def main():
    files = [
        ('fox.glb', '藏狐'),
        ('marmot.glb', '土拨鼠'),
        ('terrain-lod.glb', '场景地形 LOD'),
    ]
    bad = []
    for fn, lb in files:
        p = os.path.join(BASE, fn)
        if not os.path.exists(p):
            print('=== %s ===\n  文件不存在，跳过\n' % lb)
            continue
        ratio, ds = check(p, lb)
        if ratio > 0.2 and not ds:
            bad.append(lb)
    if bad:
        print('以下模型需要 doubleSided: %s' % ', '.join(bad))
        return 1
    print('全部模型的双面设置与绕序一致 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
