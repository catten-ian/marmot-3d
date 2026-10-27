#!/usr/bin/env python3
"""逐 clip 测量绑定角色的姿态（客观判定"动画歪不歪"）。

用法: python3 tools/measure-rig-pose.py [model.glb]
输出: 每个 clip 在若干采样点的：身体站立轴 up、倾角、与水平面关系、
      蒙皮后网格包围盒（最低点=接地）、以及各 clip 首帧 hips 旋转与静置的差角。
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
    ncomp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    return np.frombuffer(BIN, dtype=dt, count=n * ncomp,
                         offset=off).reshape(n, ncomp).astype(np.float64)


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
    # glTF 的 MAT4 accessor 是【列主序】：reshape 成 (n,4,4) 后每个矩阵需转置
    ibm = comp(J, BIN, accs[skin['inverseBindMatrices']]).reshape(-1, 4, 4).transpose(0, 2, 1)
    joints = skin['joints']

    # 基础(静置) TRS
    base = []
    for nd in nodes:
        base.append({
            't': np.array(nd.get('translation', [0, 0, 0]), float),
            'r': np.array(nd.get('rotation', [0, 0, 0, 1]), float),
            's': np.array(nd.get('scale', [1, 1, 1]), float),
        })

    def world_matrices(states):
        W = {}
        order = []
        for i in nodes:
            order.append(i)
        # 拓扑序
        def depth(i):
            d = 0
            while parent.get(i) is not None:
                i = parent[i]
                d += 1
            return d
        for i in sorted(range(len(nodes)), key=depth):
            st = states[i]
            M = np.eye(4)
            M[:3, :3] = qrot(st['r']) @ np.diag(st['s'])
            M[:3, 3] = st['t']
            p = parent.get(i)
            W[i] = M @ W[p] if p is not None and p in W else M
        return W

    def skin_bbox(W):
        # 用骨骼矩阵对 bind pose 顶点做蒙皮，得到动画姿态下的网格包围盒
        out = []
        for prim in J['meshes'][0]['primitives']:
            pos = comp(J, BIN, accs[prim['attributes']['POSITION']])
            jo = comp(J, BIN, accs[prim['attributes']['JOINTS_0']]).astype(int)
            we = comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']])
            jw = [W[j] @ ibm[k] for k, j in enumerate(joints)]
            pts = np.zeros_like(pos)
            for c in range(4):
                w = we[:, c]
                idx = jo[:, c]
                M = np.array([jw[i] for i in idx])
                pts += (w[:, None] * np.einsum('nij,nj->ni', M[:, :3, :3], pos)
                        + w[:, None] * M[:, :3, 3])
            out.append(pts)
        return np.vstack(out)

    rest = world_matrices(base)
    rh = rest[names.index('hips')][:3, 3]
    rhead = rest[names.index('head')][:3, 3]
    rest_up = (rhead - rh) / np.linalg.norm(rhead - rh)
    rtail = rest[names.index('tail')][:3, 3]
    rest_fwd = rh - rtail
    rest_fwd[1] = 0
    rest_fwd /= np.linalg.norm(rest_fwd)
    print(f'模型: {path}')
    print(f'  静置站立轴 up={np.round(rest_up, 4)}  水平前向={np.round(rest_fwd, 4)}')
    print(f'  静置 hips 旋转={np.round(base[names.index("hips")]["r"], 4)}')
    print()

    results = {}
    for anim in J['animations']:
        # 收集通道
        tracks = []
        for ch in anim['channels']:
            s = anim['samplers'][ch['sampler']]
            times = comp(J, BIN, accs[s['input']]).reshape(-1)
            vals = comp(J, BIN, accs[s['output']])
            tracks.append((ch['target']['node'], ch['target']['path'], times, vals))
        dur = max(t[-1] for _, _, t, _ in tracks)

        def sample(t):
            states = [dict(x) for x in base]
            for ni, path, times, vals in tracks:
                if t <= times[0]:
                    k = 0
                elif t >= times[-1]:
                    k = len(times) - 1
                else:
                    k = int(np.searchsorted(times, t) - 1)
                if path == 'rotation':
                    if k + 1 < len(times):
                        f = (t - times[k]) / (times[k + 1] - times[k])
                        states[ni]['r'] = slerp(vals[k], vals[k + 1], f)
                    else:
                        states[ni]['r'] = vals[k]
                elif path == 'translation':
                    states[ni]['t'] = vals[k]
                elif path == 'scale':
                    states[ni]['s'] = vals[k]
            return states

        rows = []
        for frac in (0.0, 0.25, 0.5, 0.75):
            t = dur * frac
            W = world_matrices(sample(t))
            hp = W[names.index('hips')][:3, 3]
            hd = W[names.index('head')][:3, 3]
            up = hd - hp
            up /= np.linalg.norm(up)
            tilt = np.degrees(np.arccos(np.clip(np.dot(up, rest_up), -1, 1)))
            tl = W[names.index('tail')][:3, 3]
            fwd = hp - tl
            fwd[1] = 0
            nf = np.linalg.norm(fwd)
            fwd = fwd / nf if nf > 1e-6 else np.array([0, 0, 1.])
            yaw = np.degrees(np.arccos(np.clip(np.dot(fwd, rest_fwd), -1, 1)))
            bb = skin_bbox(W)
            lo = bb.min(axis=0)
            hi = bb.max(axis=0)
            rows.append((t, up, tilt, yaw, lo, hi))

        # 首帧 hips 与静置的差角
        st0 = sample(0.0)
        dh = qang(st0[names.index('hips')]['r'], base[names.index('hips')]['r'])
        dr = qang(st0[names.index('root')]['r'], base[names.index('root')]['r'])
        avg_tilt = float(np.mean([r[2] for r in rows]))
        max_tilt = float(np.max([r[2] for r in rows]))
        avg_yaw = float(np.mean([r[3] for r in rows]))
        mins = [float(r[4][1]) for r in rows]
        print(f'--- {anim["name"]}  (时长 {dur:.3f}s) ---')
        print(f'    首帧 hips 与静置差角 = {dh:6.1f}°   root 差角 = {dr:5.1f}°')
        print(f'    倾角 平均 {avg_tilt:5.1f}°  最大 {max_tilt:5.1f}°   '
              f'朝向偏角 平均 {avg_yaw:5.1f}°')
        for t, up, tilt, yaw, lo, hi in rows:
            print(f'      t={t:5.2f}s up={np.round(up, 3)} 倾角={tilt:5.1f}° '
                  f'偏航={yaw:5.1f}°  最低y={lo[1]:7.3f} 尺寸={np.round(hi - lo, 3)}')
        results[anim['name']] = dict(dh=dh, dr=dr, avg_tilt=avg_tilt,
                                     max_tilt=max_tilt, avg_yaw=avg_yaw)

    print()
    print('=== 汇总 ===')
    print(f'{"clip":9s} {"hips首帧差角":>12s} {"平均倾角":>9s} {"最大倾角":>9s} {"平均偏航":>9s}')
    for k, v in results.items():
        flag = '  <== 明显歪' if v['avg_tilt'] > 45 else ''
        print(f'{k:9s} {v["dh"]:11.1f}° {v["avg_tilt"]:8.1f}° '
              f'{v["max_tilt"]:8.1f}° {v["avg_yaw"]:8.1f}°{flag}')

    out = path.rsplit('/', 1)[0] + '/../outputs/rig-probe/pose-metrics.json'
    try:
        json.dump(results, open(out, 'w'), indent=2)
        print(f'\nJSON: {out}')
    except Exception as e:
        print('JSON 写入失败', e)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/models/marmot-rig.glb')
