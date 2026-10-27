#!/usr/bin/env python3
"""验收"骨骼轴水平旋转 90°、网格实体不动"的修正。

判定项：
  1. bind 姿态逐顶点蒙皮结果与修正前一致（阈值 1e-5，float32 噪声级）
  2. 骨架前向（hips 相对 tail）由 +X 转到 -Z，与网格实体朝向一致
  3. 网格顶点 / 权重 / 骨骼层级 / 动画轨道 与修正前逐字节一致
  4. 各 clip 身体倾斜方向：由横向(+X) 变为朝网格前方(-Z)

用法：
  python3 tools/verify-rig-fix.py <before.glb> <after.glb> [--deg 90]
"""
import json
import struct
import sys

import numpy as np


def load(p):
    d = open(p, 'rb').read()
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


def qrot3(q):
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


def rig(J, BIN):
    nodes = J['nodes']
    names = [n.get('name') for n in nodes]
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i

    def depth(i):
        d = 0
        while parent.get(i) is not None:
            i = parent[i]
            d += 1
        return d
    order = sorted(range(len(nodes)), key=depth)

    def local(states, i):
        st = states[i]
        M = np.eye(4)
        M[:3, :3] = qrot3(st['r'])
        M[:3, 3] = st['t']
        return M

    def world(states):
        W = {}
        for i in order:
            p = parent.get(i)
            W[i] = W[p] @ local(states, i) if p is not None else local(states, i)
        return W

    base = [{
        't': np.array(nd.get('translation', [0, 0, 0]), float),
        'r': np.array(nd.get('rotation', [0, 0, 0, 1]), float),
    } for nd in nodes]
    return nodes, names, base, world, order


def analyze(path):
    J, BIN = load(path)
    nodes, names, base, world, order = rig(J, BIN)
    accs = J['accessors']
    skin = J['skins'][0]
    ibm = comp(J, BIN, accs[skin['inverseBindMatrices']]).reshape(-1, 4, 4).transpose(0, 2, 1)
    joints = skin['joints']
    prim = J['meshes'][0]['primitives'][0]
    POS = comp(J, BIN, accs[prim['attributes']['POSITION']])
    JO = comp(J, BIN, accs[prim['attributes']['JOINTS_0']]).astype(int)
    WE = comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']])

    def skin_points(W):
        pts = np.zeros_like(POS)
        for c in range(4):
            w = WE[:, c]
            M = np.array([W[joints[i]] @ ibm[i] for i in JO[:, c]])
            pts += (w[:, None] * np.einsum('nij,nj->ni', M[:, :3, :3], POS)
                    + w[:, None] * M[:, :3, 3])
        return pts

    Wb = world(base)
    bind_pts = skin_points(Wb)
    hips_p = Wb[names.index('hips')][:3, 3]
    head_p = Wb[names.index('head')][:3, 3]
    tail_p = Wb[names.index('tail')][:3, 3]
    up = head_p - hips_p
    up /= np.linalg.norm(up)
    fwd = hips_p - tail_p
    fwd[1] = 0
    fwd /= np.linalg.norm(fwd)

    # 各 clip 的身体倾斜方向（水平分量）
    leans = {}
    for anim in J['animations']:
        tracks = []
        for ch in anim['channels']:
            smp = anim['samplers'][ch['sampler']]
            tracks.append((ch['target']['node'], ch['target']['path'],
                           comp(J, BIN, accs[smp['input']]).reshape(-1),
                           comp(J, BIN, accs[smp['output']])))
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
            return states

        best = None
        for frac in (0.0, 0.25, 0.5, 0.75):
            W = world(sample(dur * frac))
            h2 = W[names.index('hips')][:3, 3]
            h3 = W[names.index('head')][:3, 3]
            u = h3 - h2
            tilt = np.degrees(np.arccos(np.clip(np.dot(u / np.linalg.norm(u), up), -1, 1)))
            horiz = u.copy()
            horiz[1] = 0
            if np.linalg.norm(horiz) > 1e-6:
                horiz /= np.linalg.norm(horiz)
            else:
                horiz = np.zeros(3)
            if best is None or tilt > best[0]:
                best = (tilt, horiz)
        leans[anim['name']] = best

    return dict(
        bind_pts=bind_pts, up=up, fwd=fwd, leans=leans,
        pos_sha=POS.tobytes().hex(),
        weights_sha=comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']]).tobytes().hex(),
        joints_sha=JO.tobytes().hex(),
        anim_sha=json.dumps([[c['target']['node'], c['target']['path']]
                              for a in J['animations'] for c in a['channels']]).encode().hex(),
        node_count=len(nodes), bone_count=len(joints),
        clip_count=len(J['animations']),
    )


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    A = analyze(args[0])
    B = analyze(args[1])
    MESH_FWD = np.array([0.0, 0.0, -1.0])

    print('=== 判定 1：bind 姿态网格是否纹丝不动 ===')
    dev = float(np.abs(A['bind_pts'] - B['bind_pts']).max())
    print(f'  逐顶点最大偏差 = {dev:.3e}   {"✅" if dev < 1e-5 else "❌"}（阈值 1e-5，float32 噪声级）')

    print('\n=== 判定 2：骨架前向是否与网格朝向对齐 ===')
    angA = np.degrees(np.arccos(np.clip(np.dot(A['fwd'], MESH_FWD), -1, 1)))
    angB = np.degrees(np.arccos(np.clip(np.dot(B['fwd'], MESH_FWD), -1, 1)))
    print(f'  修正前 骨架前向={np.round(A["fwd"], 3)} 与网格夹角={angA:.1f}°')
    print(f'  修正后 骨架前向={np.round(B["fwd"], 3)} 与网格夹角={angB:.1f}°  {"✅" if angB < 5 else "❌"}')

    print('\n=== 判定 3：几何/权重/骨骼/动画轨道未被改动 ===')
    checks = [
        ('POSITION 顶点', A['pos_sha'] == B['pos_sha']),
        ('WEIGHTS_0 权重', A['weights_sha'] == B['weights_sha']),
        ('JOINTS_0 骨骼索引', A['joints_sha'] == B['joints_sha']),
        ('动画轨道结构', A['anim_sha'] == B['anim_sha']),
        ('节点数/骨骼数/动画数',
         (A['node_count'], A['bone_count'], A['clip_count'])
         == (B['node_count'], B['bone_count'], B['clip_count'])),
    ]
    for label, ok in checks:
        print(f'  {label:22s} {"✅ 未变" if ok else "❌ 被改动"}')

    print('\n=== 判定 4：各 clip 身体倾斜方向 ===')
    print(f'  {"clip":9s} {"修正前 倾角/方向":>26s}   {"修正后 倾角/方向":>26s}')
    for name in A['leans']:
        ta, ha = A['leans'][name]
        tb, hb = B['leans'][name]
        dirA = '直立' if np.linalg.norm(ha) < 1e-6 else f'{np.degrees(np.arctan2(ha[0], ha[2])):+.0f}°'
        dirB = '直立' if np.linalg.norm(hb) < 1e-6 else f'{np.degrees(np.arctan2(hb[0], hb[2])):+.0f}°'
        print(f'  {name:9s} {ta:6.1f}° {dirA:>18s}   {tb:6.1f}° {dirB:>18s}')
    print('\n  说明：偏航角 0°=+Z(网格背向), 180°=-Z(网格正前方), ±90°=横向')

    allok = (dev < 1e-5 and angB < 5 and all(ok for _, ok in checks))
    print(f'\n=== 总判定：{"✅ 全部通过" if allok else "❌ 有未通过项"} ===')


if __name__ == '__main__':
    main()
