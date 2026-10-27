#!/usr/bin/env python3
"""把绑定土拨鼠 GLB 的骨骼轴水平旋转 90°（网格实体保持不动）。

## 病灶（已用渲染 + 数值双重确认）
- 网格实体（蒙皮后的可见形体）脸朝 **-Z**（四方位离屏渲染实测）
- 骨架空间的"前"（hips 相对 tail）指向 **+X** → 与网格朝向差 **90°**
- 结果：Rest/Run/Sprint 三段动画的身体前倾方向是 **+X（横向）**，
  角色像侧着身子跑，而不是朝自己的正前方倾 —— 即用户所说的
  "骨骼绑定不对导致所有动画都有问题"。

## 修正
设 S = 绕世界 +Y 轴 +90°（俯视逆时针 90°）。需要 S(+X) = -Z。

  1. 场景根节点 `MarmotRig` 的局部变换左乘 S
     → 所有骨骼世界矩阵 J'_i = S · J_i（层级继承；**动画轨道无需改动**）
  2. 网格节点 `Marmot_GameMesh` 的局部变换左乘 S^{-1}
     → 网格世界矩阵 = S · S^{-1} = I，网格朝向/位置完全不变
  3. 每个 joint 的 inverseBindMatrix 右乘 S^{-1}：IBM'_i = IBM_i · S^{-1}
     → 蒙皮矩阵 M'_i(t) = S · J_i(t) · IBM_i · S^{-1}
       = S · M_i(t) · S^{-1}：bind 姿态下 M'_i = S·I·S^{-1} = I（网格纹丝不动），
       动画姿态下动画的相对旋转被 S 旋转 90°，前倾方向从 +X 转到 -Z。

## 保证
- 网格顶点、权重、骨骼层级、动画轨道、动画数量**全部不变**
- 仅改：2 个节点的 rotation、20 个 inverseBindMatrix
- bind 姿态蒙皮结果与修正前逐顶点一致（float32 精度内）

用法：
  python3 tools/apply-rig-axis-fix.py <in.glb> <out.glb> [--deg 90]
"""
import json
import struct
import sys

import numpy as np


def rot_y(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.eye(4)
    R[0, 0], R[0, 2] = c, s
    R[2, 0], R[2, 2] = -s, c
    return R


def mat_to_quat(R):
    """3x3 旋转矩阵 → glTF 四元数 [x, y, z, w]。"""
    m = R
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    q = np.array([x, y, z, w], float)
    return q / np.linalg.norm(q)


def quat_to_mat(q):
    x, y, z, w = q
    n = np.sqrt(x * x + y * y + z * z + w * w)
    if n < 1e-12:
        return np.eye(4)
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
        [0, 0, 0, 1],
    ])


def read_glb(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'glTF', path
    off, chunks = 12, []
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off)
        off += 8
        chunks.append((ty, d[off:off + ln]))
        off += ln
    J = None
    BIN = b''
    for ty, data in chunks:
        if ty == 0x4E4F534A:
            J = json.loads(data.decode('utf-8'))
        elif ty == 0x004E4942:
            BIN = data
    return J, BIN


def write_glb(path, J, BIN):
    jb = json.dumps(J, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = BIN + b'\x00' * ((4 - len(BIN) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack('<II', len(bb), 0x004E4942))
        f.write(bb)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    deg = 90
    for a in sys.argv[1:]:
        if a.startswith('--deg'):
            deg = float(a.split('=')[1]) if '=' in a else 90
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    src, dst = args[0], args[1]

    J, BIN = read_glb(src)
    nodes = J['nodes']
    names = [n.get('name') for n in nodes]

    def node_idx(name):
        for i, n in enumerate(nodes):
            if n.get('name') == name:
                return i
        raise SystemExit(f'找不到节点 {name}')

    rig_i = node_idx('MarmotRig')
    mesh_i = node_idx('Marmot_GameMesh')

    S = rot_y(deg)
    Sinv = rot_y(-deg)
    qs = mat_to_quat(S)
    qsinv = mat_to_quat(Sinv)

    # 步骤 1 / 2：给两个节点设置 rotation（原本都没有 rotation）
    def set_rot(idx, q):
        nd = nodes[idx]
        assert 'rotation' not in nd, f'{nd.get("name")} 已有 rotation，需改为合成而非覆盖'
        nd['rotation'] = [float(v) for v in q]

    set_rot(rig_i, qs)
    set_rot(mesh_i, qsinv)

    # 步骤 3：inverseBindMatrix 右乘 S^{-1}
    accs = J['accessors']
    skin = J['skins'][0]
    acc = accs[skin['inverseBindMatrices']]
    bv = J['bufferViews'][acc['bufferView']]
    assert acc.get('byteOffset', 0) == 0, 'IBM accessor 带 byteOffset，需扩展处理'
    n = acc['count']
    assert acc['type'] == 'MAT4' and acc['componentType'] == 5126
    off = bv.get('byteOffset', 0)
    mats = np.frombuffer(BIN, dtype='<f4', count=n * 16, offset=off).reshape(n, 4, 4).astype(np.float64)
    # glTF MAT4 是列主序存储：读出时需转置为行主序
    mats = mats.transpose(0, 2, 1)
    new = np.einsum('nij,jk->nik', mats, Sinv)   # IBM · S^{-1}
    # 写回列主序
    back = new.transpose(0, 2, 1).astype('<f4')
    buf = bytearray(BIN)
    buf[off:off + n * 64] = back.tobytes()
    BIN = bytes(buf)

    write_glb(dst, J, BIN)
    print(f'已写出 {dst}')
    print(f'  MarmotRig.rotation      = {np.round(qs, 6).tolist()}')
    print(f'  Marmot_GameMesh.rotation= {np.round(qsinv, 6).tolist()}')
    print(f'  {n} 个 inverseBindMatrix 已右乘 S^-1（绕 +Y {deg:+.0f}°）')
    print(f'  字节数 {len(BIN)} → {len(BIN)}')


if __name__ == '__main__':
    main()
