#!/usr/bin/env python3
"""数值验证"只转骨骼轴 90°、网格不动"的修正方案。

## 方案（三步，全部只改 GLB 内的矩阵，不碰动画轨道）
设 S = 绕世界 +Y 轴的 90° 旋转（水平旋转）。骨空间"前" = -X（ hips-tail = +X，
尾巴在身后），网格实体"前" = -Z（渲染实测）。要让骨架轴对齐网格朝向，需 S(-X) = -Z，
即 **S = R_y(-90°)**（俯视逆时针 90°）。

  1. 场景根节点 MarmotRig 局部变换左乘 S
     → 所有骨骼世界矩阵 J'_i(t) = S · J_i(t)（层级继承，动画轨道无需改动）
  2. 网格节点 Marmot_GameMesh 局部变换左乘 S^{-1}
     → 网格世界矩阵 = S · S^{-1} = I，网格朝向与位置完全不变
  3. 每个 joint 的 inverseBindMatrix 右乘 S^{-1}：IBM'_i = IBM_i · S^{-1}
     → 蒙皮矩阵 M'_i(t) = S·J_i(t)·IBM_i·S^{-1}

## 验证项
  A. bind 姿态逐顶点偏差必须为 0（网格纹丝不动）
  B. 动画姿态的蒙皮矩阵 = S · M_i(t) · S^{-1}（骨骼相对 bind 的旋转被 S 旋转）
  C. 骨架水平前向与网格前向的夹角从 90° 收敛到 0°
  D. 各 clip 身体 up 轴与 +Y 的夹角（不应因修正而恶化）

用法：python3 tools/derive-rig-fix.py [model.glb]
"""
import json
import struct
import sys

import numpy as np


def load(path):
    d = open(path, 'rb').read()
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


def rot_y(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.eye(3)
    R[0, 0], R[0, 2] = c, s
    R[2, 0], R[2, 2] = -s, c
    return R


def rot_axis(axis, deg):
    n = np.array(axis, float)
    n = n / np.linalg.norm(n)
    a = np.radians(deg)
    K = np.array([[0, -n[2], n[1]], [n[2], 0, -n[0]], [-n[1], n[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * (K @ K)


def emb4(R3):
    M = np.eye(4)
    M[:3, :3] = R3
    return M


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
    ibm0 = comp(J, BIN, accs[skin['inverseBindMatrices']]).reshape(-1, 4, 4).transpose(0, 2, 1)
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

    def local(states, i):
        st = states[i]
        M = np.eye(4)
        M[:3, :3] = qrot(st['r']) @ np.diag(st['s'])
        M[:3, 3] = st['t']
        return M

    def world(states):
        W = {}
        for i in order:
            p = parent.get(i)
            W[i] = W[p] @ local(states, i) if p is not None else local(states, i)
        return W

    rig_i = names.index('MarmotRig')
    mesh_i = names.index('Marmot_GameMesh')
    hips_i = names.index('hips')
    head_i = names.index('head')
    tail_i = names.index('tail')

    prim = J['meshes'][0]['primitives'][0]
    POS = comp(J, BIN, accs[prim['attributes']['POSITION']])
    JO = comp(J, BIN, accs[prim['attributes']['JOINTS_0']]).astype(int)
    WE = comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']])

    def skin_points(W, ibms):
        pts = np.zeros_like(POS)
        for c in range(4):
            w = WE[:, c]
            M = np.array([W[joints[i]] @ ibms[i] for i in JO[:, c]])
            pts += (w[:, None] * np.einsum('nij,nj->ni', M[:, :3, :3], POS)
                    + w[:, None] * M[:, :3, 3])
        return pts

    Wb = world(base)
    base_pts = skin_points(Wb, ibm0)
    hips_p = Wb[hips_i][:3, 3]
    head_p = Wb[head_i][:3, 3]
    tail_p = Wb[tail_i][:3, 3]
    up = head_p - hips_p
    up /= np.linalg.norm(up)
    bone_fwd = hips_p - tail_p          # 骨空间"前"（头在 -tail 侧）
    bone_fwd[1] = 0
    bone_fwd /= np.linalg.norm(bone_fwd)
    MESH_FWD = np.array([0.0, 0.0, -1.0])   # 渲染实测：网格实体脸朝 -Z
    print('=== bind 姿态基线 ===')
    print(f'  站立轴 up       = {np.round(up, 4)}')
    print(f'  骨架水平前向    = {np.round(bone_fwd, 4)}')
    print(f'  网格实体朝向    = {np.round(MESH_FWD, 4)}  (渲染实测)')
    ang = np.degrees(np.arccos(np.clip(np.dot(bone_fwd, MESH_FWD), -1, 1)))
    print(f'  → 两者夹角 = {ang:.1f}°  ← 用户指出的病灶')

    cands = [
        ('R_y(-90°)  俯视逆时针 90°  ← 目标', rot_y(-90)),
        ('R_y(+90°)  俯视顺时针 90°', rot_y(90)),
        ('R_x(+90°)', rot_axis([1, 0, 0], 90)),
        ('R_x(-90°)', rot_axis([1, 0, 0], -90)),
    ]

    for label, S3 in cands:
        S4 = emb4(S3)
        Sinv4 = emb4(S3.T)
        # 步骤 1+2：MarmotRig 左乘 S，网格左乘 S^{-1}
        Wn = {}
        for i in order:
            M = local(base, i)
            if i == rig_i:
                M = S4 @ M
            elif i == mesh_i:
                M = Sinv4 @ M
            p = parent.get(i)
            Wn[i] = Wn[p] @ M if p is not None else M
        # 步骤 3：IBM 右乘 S^{-1}
        ibmN = [ibm0[k] @ Sinv4 for k in range(len(joints))]
        ptsN = skin_points(Wn, ibmN)
        dev = float(np.abs(ptsN - base_pts).max())

        # 修正后的骨架前向
        hp = Wn[hips_i][:3, 3]
        tp = Wn[tail_i][:3, 3]
        fwd = hp - tp
        fwd[1] = 0
        fwd /= np.linalg.norm(fwd)
        angN = np.degrees(np.arccos(np.clip(np.dot(fwd, MESH_FWD), -1, 1)))

        # 动画姿态：J'(t) = S·J(t)，M' = S·J(t)·IBM·S^{-1}
        rows = []
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
                    elif pth == 'scale':
                        states[ni]['s'] = vals[k]
                return states

            tilts = []
            for frac in (0.0, 0.25, 0.5, 0.75):
                st = sample(dur * frac)
                W = world(st)
                h2 = W[hips_i][:3, 3]
                h3 = W[head_i][:3, 3]
                u = h3 - h2
                u /= np.linalg.norm(u)
                tilts.append(float(np.degrees(np.arccos(np.clip(np.dot(u, up), -1, 1)))))
            rows.append((anim['name'], float(np.mean(tilts)), float(np.max(tilts))))

        worst = max(r[2] for r in rows)
        ok = dev < 1e-9 and angN < 5
        print(f'\n【{label}】')
        print(f'   bind 顶点最大偏差 = {dev:.3e}   {"✅ 网格纹丝不动" if dev < 1e-9 else "❌"}')
        print(f'   骨架前向 vs 网格朝向 = {angN:5.1f}°  {"✅ 已对齐" if angN < 5 else "❌ 未对齐"}')
        print(f'   动画 up 轴倾角 最大 = {worst:5.1f}°')
        for nm, a, m in rows:
            print(f'      {nm:8s} 平均{a:5.1f}° 最大{m:5.1f}°')
        print(f'   → {"✅ 方案成立" if ok else "❌ 不满足验收"}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/models/marmot-rig.glb')
