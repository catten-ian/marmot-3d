#!/usr/bin/env python3
"""绑定角色姿态分析（修正矩阵顺序 + 以 three.js 真值校验）。

**矩阵顺序**：世界矩阵 = parent_world @ local（局部左乘父级）。此前写成
`local @ parent` 会整体算错。three.js 的 Object3D.updateMatrixWorld 用的是
`this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)`，
即 parent @ local。

校验门：静置姿态下 hips/chest/head 的世界坐标必须与 three.js 探针实测一致
（root=[0,0.05,0] hips=[0,0.58,0] chest=[0,1.48,0] head=[0.03,1.98,0]）。

用法: python3 tools/analyze-rig.py [model.glb]
"""
import json
import struct
import sys

import numpy as np


def load(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', path
    off, J, BIN = 12, None, None
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off)
        off += 8
        if ty == 0x4E4F534A:
            J = json.loads(d[off:off + ln].decode('utf-8'))
        elif ty == 0x004E4942:
            BIN = d[off:off + ln]
        off += ln
    return J, BIN


def comp(J, BIN, a):
    ct, n = a['componentType'], a['count']
    fmt = {5121: 'B', 5123: 'H', 5126: 'f'}[ct]
    dt = {'B': np.uint8, 'H': np.uint16, 'f': np.float32}[fmt]
    bv = J['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    return np.frombuffer(BIN, dtype=dt, count=n * nc,
                         offset=off).reshape(n, nc).astype(np.float64)


def qrot(q):
    x, y, z, w = q
    n = np.sqrt(x * x + y * y + z * z + w * w)
    if n < 1e-12:
        return np.eye(3)
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def slerp(q0, q1, t):
    q0 = q0 / np.linalg.norm(q0)
    q1 = q1 / np.linalg.norm(q1)
    dot = float(np.dot(q0, q1))
    if dot < 0:
        q1, dot = -q1, -dot
    if dot > 0.9995:
        r = q0 + t * (q1 - q0)
        return r / np.linalg.norm(r)
    th0 = np.arccos(np.clip(dot, -1, 1))
    th = th0 * t
    q2 = q1 - q0 * dot
    q2 /= np.linalg.norm(q2)
    return q0 * np.cos(th) + q2 * np.sin(th)


def qang(a, b):
    d = abs(float(np.dot(a / np.linalg.norm(a), b / np.linalg.norm(b))))
    return np.degrees(2 * np.arccos(np.clip(d, -1, 1)))


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def main(path):
    J, BIN = load(path)
    nodes = J['nodes']
    names = [n.get('name') for n in nodes]
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i
    accs = J['accessors']
    skin = J['skins'][0]
    ibm = comp(J, BIN, accs[skin['inverseBindMatrices']]).reshape(-1, 4, 4).transpose(0, 2, 1)
    joints = skin['joints']

    base = [{
        't': np.array(nd.get('translation', [0, 0, 0]), float),
        'r': np.array(nd.get('rotation', [0, 0, 0, 1]), float),
        's': np.array(nd.get('scale', [1, 1, 1]), float),
    } for nd in nodes]

    def depth(i):
        d = 0
        while parent.get(i) is not None:
            i = parent[i]
            d += 1
        return d

    order = sorted(range(len(nodes)), key=depth)

    def world(states):
        W = {}
        for i in order:
            st = states[i]
            M = np.eye(4)
            M[:3, :3] = qrot(st['r']) @ np.diag(st['s'])
            M[:3, 3] = st['t']
            p = parent.get(i)
            W[i] = W[p] @ M if p is not None else M
        return W

    rest = world(base)
    print(f'模型: {path}')
    truth = {'root': [0, 0.05, 0], 'hips': [0, 0.58, 0], 'chest': [0, 1.48, 0], 'head': [0.03, 1.98, 0]}
    ok = True
    for k, v in truth.items():
        got = rest[names.index(k)][:3, 3]
        good = np.allclose(got, v, atol=0.01)
        ok &= good
        print(f'  校验 {k:6s} 期望={np.round(v, 3)} 实得={np.round(got, 3)} {"✅" if good else "❌"}')
    print(f'  => 与 three.js 真值{"一致 ✅" if ok else "不一致 ❌（数学仍有错）"}\n')

    # 朝向：头骨局部 +Z = 吻部朝向（jaw 相对 head 的偏移在 head 局部 +Z/+Y）
    headM = rest[names.index('head')]
    jawM = rest[names.index('jaw')]
    muzzle = jawM[:3, 3] - headM[:3, 3]
    muzzle = muzzle / np.linalg.norm(muzzle)
    hipsM = rest[names.index('hips')]
    up = headM[:3, 3] - hipsM[:3, 3]
    up /= np.linalg.norm(up)
    print(f'  静置: 站立轴(hips→head) = {np.round(up, 4)}   (应 ≈ [0,1,0])')
    print(f'  静置: 吻部朝向(head→jaw) = {np.round(muzzle, 4)}')
    yaw = np.degrees(np.arctan2(muzzle[0], muzzle[2]))
    print(f'  静置: 吻部水平偏航 = {yaw:+.1f}°  (0°=+Z, +90°=+X, -90°=-X, 180°=-Z)')

    def skin_bbox(W):
        pts_all = []
        for prim in J['meshes'][0]['primitives']:
            pos = comp(J, BIN, accs[prim['attributes']['POSITION']])
            jo = comp(J, BIN, accs[prim['attributes']['JOINTS_0']]).astype(int)
            we = comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']])
            jw = [W[j] @ ibm[k] for k, j in enumerate(joints)]
            pts = np.zeros_like(pos)
            for c in range(4):
                w = we[:, c]
                M = np.array([jw[i] for i in jo[:, c]])
                pts += (w[:, None] * np.einsum('nij,nj->ni', M[:, :3, :3], pos)
                        + w[:, None] * M[:, :3, 3])
            pts_all.append(pts)
        return np.vstack(pts_all)

    rb = skin_bbox(rest)
    print(f'  静置蒙皮包围盒 min={np.round(rb.min(axis=0), 3)} max={np.round(rb.max(axis=0), 3)} '
          f'size={np.round(rb.max(axis=0) - rb.min(axis=0), 4)}')
    print(f'  three.js 实测 posed size = [2.2581, 2.4, 2.3632]')
    print()

    summary = {}
    for anim in J['animations']:
        tracks = []
        for ch in anim['channels']:
            s = anim['samplers'][ch['sampler']]
            times = comp(J, BIN, accs[s['input']]).reshape(-1)
            vals = comp(J, BIN, accs[s['output']])
            tracks.append((ch['target']['node'], ch['target']['path'], times, vals))
        dur = max(t[-1] for _, _, t, _ in tracks)

        def sample(t):
            states = [dict(x) for x in base]
            for ni, pth, times, vals in tracks:
                if t <= times[0]:
                    k = 0
                elif t >= times[-1]:
                    k = len(times) - 1
                else:
                    k = int(np.searchsorted(times, t) - 1)
                if pth == 'rotation':
                    if k + 1 < len(times):
                        f = (t - times[k]) / (times[k + 1] - times[k])
                        states[ni]['r'] = slerp(vals[k], vals[k + 1], f)
                    else:
                        states[ni]['r'] = vals[k]
                elif pth == 'translation':
                    states[ni]['t'] = vals[k]
                elif pth == 'scale':
                    states[ni]['s'] = vals[k]
            return states

        st0 = sample(0.0)
        dh = qang(st0[names.index('hips')]['r'], base[names.index('hips')]['r'])
        rows = []
        for frac in (0.0, 0.25, 0.5, 0.75):
            t = dur * frac
            W = world(sample(t))
            hp = W[names.index('hips')][:3, 3]
            hd = W[names.index('head')][:3, 3]
            u = hd - hp
            u /= np.linalg.norm(u)
            tilt = np.degrees(np.arccos(np.clip(np.dot(u, up), -1, 1)))
            jm = W[names.index('jaw')][:3, 3]
            mu = jm - hd
            mu /= np.linalg.norm(mu)
            bb = skin_bbox(W)
            lo, hi = bb.min(axis=0), bb.max(axis=0)
            rows.append(dict(t=t, up=u, tilt=tilt, muzzle=mu, lo=lo, hi=hi))
        avg_t = float(np.mean([r['tilt'] for r in rows]))
        max_t = float(np.max([r['tilt'] for r in rows]))
        min_y = float(np.mean([r['lo'][1] for r in rows]))
        print(f'--- {anim["name"]}  ({dur:.3f}s)  hips首帧差={dh:5.1f}° ---')
        for r in rows:
            print(f'    t={r["t"]:5.2f}s 倾角={r["tilt"]:5.1f}° up={np.round(r["up"], 3)} '
                  f'吻向={np.round(r["muzzle"], 2)} 最低y={r["lo"][1]:7.3f} '
                  f'size={np.round(r["hi"] - r["lo"], 3)}')
        summary[anim['name']] = dict(dh=dh, avg_tilt=avg_t, max_tilt=max_t, min_y=min_y)

    print('\n=== 汇总 ===')
    for k, v in summary.items():
        flag = '  <== 身体明显倾斜' if v['avg_tilt'] > 20 else ''
        print(f'{k:9s} hips首帧差={v["dh"]:6.1f}°  平均倾角={v["avg_tilt"]:5.1f}° '
              f'最大={v["max_tilt"]:5.1f}° 最低y={v["min_y"]:7.3f}{flag}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/models/marmot-rig.glb')
