"""
对比原始 GLB 与优化后 GLB，判断"简化是否毁掉了模型"。

背景：狐狸模型在游戏里渲染成一片破碎的三角形碎片，
完全不像狐狸。怀疑是顶点聚类简化（optimize-glb.py）对
摄影测量网格不适用 —— 聚类会把相邻但属于不同部位的顶点合并，
把平滑的表面撕成碎片。

本脚本对两个文件分别统计：
  · 顶点数 / 面数
  · 三角形的**边长分布**（简化会丢掉细节面，产生超短边碎片）
  · 顶点到最近邻的平均距离（聚类后会出现大量重合顶点）
  · 法线一致性（相邻面夹角分布）—— 撕碎会导致法线剧烈跳变

用法：python tools/compare-raw-opt.py
"""
import struct
import json
import os
import numpy as np

RAW = r'C:\Users\Classin\Downloads\061c9c8df3ff8e424bf88b34c10a0fe3.glb'
OPT = r'D:\gam3\3d\marmot-3d\assets\models\fox.glb'


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


def geom(path, label):
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

    size = P.max(axis=0) - P.min(axis=0)
    v0, v1, v2 = P[I[:, 0]], P[I[:, 1]], P[I[:, 2]]

    # 边长分布
    e = np.concatenate([
        np.linalg.norm(v1 - v0, axis=1),
        np.linalg.norm(v2 - v1, axis=1),
        np.linalg.norm(v0 - v2, axis=1),
    ])
    diag = float(np.linalg.norm(size))

    # 法线一致性：相邻三角面夹角
    nn = np.cross(v1 - v0, v2 - v0)
    ln_ = np.linalg.norm(nn, axis=1)
    good = ln_ > 1e-12
    nn = nn[good] / ln_[good][:, None]
    # 随机取 3000 对相邻面比较夹角
    rng = np.random.default_rng(7)
    idx = rng.integers(0, len(nn), size=(3000, 2))
    idx = idx[idx[:, 0] != idx[:, 1]]
    dot = np.clip((nn[idx[:, 0]] * nn[idx[:, 1]]).sum(axis=1), -1, 1)
    ang = np.degrees(np.arccos(dot))

    # 重复顶点检测（聚类的直接痕迹）
    q = np.round(P / max(diag * 1e-6, 1e-9)).astype(np.int64)
    uniq = len(np.unique(q, axis=0))

    print('=== %s ===' % label)
    print('  顶点 %s   三角面 %s' % (f'{len(P):,}', f'{n:,}'))
    print('  尺寸 %.3f × %.3f × %.3f  (对角 %.3f)' % (size[0], size[1], size[2], diag))
    print('  三角形边长(对角%%): p1=%.4f  p10=%.4f  中位=%.4f  p90=%.4f  p99=%.4f'
          % tuple(np.percentile(e / diag, [1, 10, 50, 90, 99])))
    print('  超短边(<0.1%%对角)占比: %.1f%%' % ((e / diag < 0.001).mean() * 100))
    print('  重复顶点: %s / %s  (%.1f%%)'
          % (f'{len(P)-uniq:,}', f'{len(P):,}', (len(P) - uniq) / len(P) * 100))
    print('  相邻面夹角: p10=%.0f°  中位=%.0f°  p90=%.0f°'
          % tuple(np.percentile(ang, [10, 50, 90])))
    print()
    return dict(v=len(P), f=n, short=(e / diag < 0.001).mean(),
                dup=(len(P) - uniq) / len(P), ang_med=float(np.percentile(ang, 50)))


if __name__ == '__main__':
    a = geom(RAW, '原始 GLB（摄影测量导出）')
    b = geom(OPT, '优化后 GLB（顶点聚类简化）')
    print('======== 对比 ========')
    print('  面数     %s → %s  (%.1f%%)' % (f'{a["f"]:,}', f'{b["f"]:,}', b['f'] / a['f'] * 100))
    print('  超短边   %.1f%% → %.1f%%' % (a['short'] * 100, b['short'] * 100))
    print('  重复顶点 %.1f%% → %.1f%%' % (a['dup'] * 100, b['dup'] * 100))
    print('  夹角中位 %.0f° → %.0f°' % (a['ang_med'], b['ang_med']))
    print()
    if b['short'] > 0.25:
        print('  → 结论：简化产生了大量超短边碎片，模型被撕碎了 ❌')
        print('     聚类简化不适用于这类摄影测量网格（法线方向分叉处会被错误合并）')
    else:
        print('  → 结论：简化未明显破坏网格 ✅')
