#!/usr/bin/env python3
"""推导绑定骨架的"水平 90°"修正方案（数值原型，不改文件）。

## 目标
用户诉求：把土拨鼠 GLB 的**骨骼轴**水平逆时针转 90°，**网格实体不动**，
让动画朝向与网格朝向一致（骨骼前向 +X vs 网格脸朝 -Z，差 90°）。

## 原理
glTF 蒙皮：顶点 = Σ w_i · (jointWorld_i · IBM_i) · v_mesh
  - jointWorld_i：骨骼世界矩阵（节点层级连乘）
  - IBM_i：逆绑定矩阵，bind 时 = jointWorld_bind_i^{-1}（mesh 节点为单位阵）

要在**不移动网格**的前提下把骨架整体旋转 S：
  1. 根骨骼局部旋转左乘 S：  rootLocal' = T_root · (S·R_root) · S_root
     → 所有骨骼世界矩阵变成 jointWorld_i' = S · jointWorld_i
  2. 动画里 root 的旋转轨道也要左乘 S（否则播放时被轨道覆盖回原值）
  3. 逆绑定矩阵补偿：IBM_i' = (S · jointWorld_bind_i)^{-1}
     = jointWorld_bind_i^{-1} · S^{-1}  ⇒ bind 姿态仍完全不动（v' = v）
  4. 动画姿态的蒙皮变换变成 S · Δ · S^{-1}（Δ = 关节相对 bind 的刚体增量）
     ⇒ 动画的旋转轴被 S 旋转，而网格保持原位 → 这正是"只转骨骼轴"

## 用法
python3 tools/derive-rig-fix.py            # 评估候选 S 并给指标
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


def mat2quat(R):
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        w = 0.25 * s
        x = (R[2, 1] - R[1, 2]) / s
        y = (R[0, 2] - R[2, 0]) / s
        z = (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        w = (R[2, 1] - R[1, 2]) / s
        x = 0.25 * s
        y = (R[0, 1] + R[1, 0]) / s
        z = (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        w = (R[0, 2] - R[2, 0]) / s
        x = (R[0, 1] + R[1, 0]) / s
        y = 0.25 * s
        z = (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        w = (R[1, 0] - R[0, 1]) / s
        x = (R[0, 2] + R[2, 0]) / s
        y = (R[1, 2] + R[2, 1]) / s
        z = 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def rot_axis(axis, deg):
    """绕任意轴旋转（右手定则）。"""
    n = np.array(axis, float)
    n = n / np.linalg.norm(n)
    a = np.radians(deg)
    K = np.array([[0, -n[2], n[1]], [n[2], 0, -n[0]], [-n[1], n[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * (K @ K)


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

    def world(states, S=None):
        """S: 施加在骨架根上的世界旋转（None = 不施加）。"""
        W = {}
        for i in order:
            M = local(states, i)
            p = parent.get(i)
            W[i] = W[p] @ M if p is not None else M
            if S is not None and p is None and i == root_idx:
                W[i] = W[i] @ S  # 根骨骼局部右乘 S（等价于整体左乘，见备注）
        return W

    root_idx = names.index('root')
    hips_idx = names.index('hips')
    head_idx = names.index('head')
    tail_idx = names.index('tail')

    # ---- bind 姿态下的几何参考 ----
    Wb = world(base)
    hips_p = Wb[hips_idx][:3, 3]
    head_p = Wb[head_idx][:3, 3]
    tail_p = Wb[tail_idx][:3, 3]
    up = head_p - hips_p
    up /= np.linalg.norm(up)
    back = hips_p - tail_p
    back[1] = 0
    back /= np.linalg.norm(back)
    print('=== bind 姿态（未改动）参考 ===')
    print(f'  站立轴 up = {np.round(up, 4)}')
    print(f'  躯干水平轴 (hips-tail) = {np.round(back, 4)}')
    print(f'  → 躯干指向 = {np.round(-back, 4)}  (骨架空间的"前")')
    print(f'  → 网格实体实测脸朝 -Z（渲染验证）')

    # ---- 候选 S ----
    cands = [
        ('恒等(不转)', np.eye(3)),
        ('绕 +Y 轴 +90° (俯视逆时针)', rot_axis([0, 1, 0], 90)),
        ('绕 +Y 轴 -90° (俯视顺时针)', rot_axis([0, 1, 0], -90)),
        ('绕 +X 轴 +90°', rot_axis([1, 0, 0], 90)),
        ('绕 +X 轴 -90°', rot_axis([1, 0, 0], -90)),
        ('绕 +Z 轴 +90°', rot_axis([0, 0, 1], 90)),
        ('绕 +Z 轴 -90°', rot_axis([0, 0, 1], -90)),
    ]

    # 几何：从顶点算 bind 姿态下的"网格实体的脸朝哪"（用头/尾两端顶点差不可靠，
    # 改用：bind 姿态下网格的前后不对称性 → 用骨骼 torso 轴与网格渲染实测的 -Z 对齐校验）
    print('\n=== 候选 S 评估 ===')
    print('（骨架整体旋转 S 后：bind 姿态网格不变；动画的旋转轴被 S 旋转）')

    for label, S in cands:
        # bind 姿态：世界矩阵整体左乘 S，IBM 补偿 = jointWorld_bind^{-1} · S^{-1}
        WbS = {}
        for i in order:
            WbS[i] = (S @ Wb[i]) if parent.get(i) is None else (WbS[parent[i]] @ local(base, i))
        # 蒙皮（bind）：jointWorld' · IBM' ， IBM' = Wb^{-1} · S^{-1}
        ibmS = [np.linalg.inv(WbS[j]) @ np.linalg.inv(S) for j in joints]
        # 验证 bind 姿态下网格顶点不动
        prim = J['meshes'][0]['primitives'][0]
        pos = comp(J, BIN, accs[prim['attributes']['POSITION']])
        jo = comp(J, BIN, accs[prim['attributes']['JOINTS_0']]).astype(int)
        we = comp(J, BIN, accs[prim['attributes']['WEIGHTS_0']])
        dev = 0.0
        for c in range(4):
            w = we[:, c]
            M = np.array([WbS[joints[i]] @ ibmS[i] for i in jo[:, c]])
            v = np.einsum('nij,nj->ni', M[:, :3, :3], pos) + M[:, :3, 3]
            dev = max(dev, float(np.abs(w[:, None] * v - w[:, None] * pos).max()))
        # 动画：root 的旋转轨道左乘 S（世界轴左乘 → 轨道四元数右乘 S 的共轭）
        Sq = mat2quat(S)
        rows = []
        for anim in J['animations']:
            tracks = []
            for ch in anim['channels']:
                smp = anim['samplers'][ch['sampler']]
                times = comp(J, BIN, accs[smp['input']]).reshape(-1)
                vals = comp(J, BIN, accs[smp['output']])
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
                            q = slerp(vals[k], vals[k + 1], f)
                        else:
                            q = vals[k]
                        if ni == root_idx:
                            # 世界左乘 S ⇒ 局部旋转右乘 S：q' = q ⊗ Sq
                            q = np.array([
                                q[3] * Sq[0] + q[0] * Sq[3] + q[1] * Sq[2] - q[2] * Sq[1],
                                q[3] * Sq[1] - q[0] * Sq[2] + q[1] * Sq[3] + q[2] * Sq[0],
                                q[3] * Sq[2] + q[0] * Sq[1] - q[1] * Sq[0] + q[2] * Sq[3],
                                q[3] * Sq[3] - q[0] * Sq[0] - q[1] * Sq[1] - q[2] * Sq[2],
                            ])
                            q = q / np.linalg.norm(q)
                        states[ni]['r'] = q
                    elif pth == 'translation':
                        states[ni]['t'] = vals[k]
                    elif pth == 'scale':
                        states[ni]['s'] = vals[k]
                return states

            tilts = []
            for frac in (0.0, 0.25, 0.5, 0.75):
                st = sample(dur * frac)
                W = {}
                for i in order:
                    W[i] = (S @ local(st, i)) if parent.get(i) is None else (W[parent[i]] @ local(st, i))
                hp = W[hips_idx][:3, 3]
                hd = W[head_idx][:3, 3]
                u = hd - hp
                u /= np.linalg.norm(u)
                tilts.append(float(np.degrees(np.arccos(np.clip(np.dot(u, up), -1, 1)))))
            rows.append((anim['name'], float(np.mean(tilts)), float(np.max(tilts))))

        worst = max(r[2] for r in rows)
        avg = float(np.mean([r[1] for r in rows]))
        flag = '✅ 全部直立' if worst < 25 else ('⚠️ 部分倾斜' if worst < 50 else '❌ 仍横躺')
        print(f'\n  【{label}】bind 网格偏移={dev:.2e}  平均倾角={avg:5.1f}° 最大={worst:5.1f}°  {flag}')
        for nm, a, m in rows:
            print(f'      {nm:8s} 平均{a:5.1f}° 最大{m:5.1f}°')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/models/marmot-rig.glb')
