"""
场景网格优化：PLY → 压缩 GLB（可行走地形用）。

用途：作为游戏的**可行走地形**。因此必须做到：
  · 体积可控（原始 19MB → 目标 3~4MB）
  · 顶点色保留（顶点色是草原的真实配色，比贴图更省体积）
  · 精度足够做高度采样与碰撞（不能简化过度导致地形失真）

实现：
  1. 读 PLY（binary_little_endian，x/y/z 为 double，rgb 为 uchar）
  2. 按 XZ 平面做顶点聚类简化 —— 保留 Y 精度（高度是玩法数据）
  3. 顶点色直接存 RGB（无贴图，省掉整张纹理）
  4. 输出 glb（three.js 直接可加载）
"""

import struct
import json
import os
import sys
import numpy as np

SRC = r'C:\Users\Classin\Downloads\74ecf95a32f489285e07421418ef4430.ply'
OUT_DIR = r'D:\gam3\3d\marmot-3d\assets\models'


def read_ply(path):
    """读 Open3D 导出的 PLY（vertex: 3 double + 3 uchar；face: list）"""
    with open(path, 'rb') as f:
        data = f.read()
    end = data.index(b'end_header') + len(b'end_header') + 1
    header = data[:end].decode('ascii', errors='replace')

    nv = nf = 0
    props = []
    cur = None
    for line in header.split('\n'):
        t = line.split()
        if not t:
            continue
        if t[0] == 'element':
            cur = t[1]
            if cur == 'vertex':
                nv = int(t[2])
            elif cur == 'face':
                nf = int(t[2])
        elif t[0] == 'property' and cur == 'vertex':
            props.append((t[1], t[2]))

    # 组装 dtype（保持与文件内布局一致）
    np_type = {'double': '<f8', 'float': '<f4', 'uchar': 'u1',
               'uint': '<u4', 'int': '<i4', 'short': '<i2'}
    fields = []
    for typ, name in props:
        if name == 'vertex_indices':
            continue
        fields.append((name, np_type[typ]))
    dt = np.dtype(fields)
    vp = np.frombuffer(data, dtype=dt, count=nv, offset=end)

    pos = np.stack([vp['x'], vp['y'], vp['z']], axis=1).astype(np.float32)
    if 'red' in vp.dtype.names:
        col = np.stack([vp['red'], vp['green'], vp['blue']], axis=1).astype(np.uint8)
    else:
        col = np.full((nv, 3), 200, dtype=np.uint8)

    # 面索引：PLY 的 face 是**变长列表**（property list uchar uint）。
    # Open3D 导出时每个三角形是 [3(uchar)] + 3*uint32，且按 4 字节对齐后
    # 实际占 13 字节（3 + 9 → 向上取整到 4 的倍数 = 16？实测为 13，
    # 因为 uint 对齐后总长 3+12=15，PLY writer 补到 13 的整数倍情况与实测一致，
    # 这里按实测的 13 字节定长读取）。
    #
    # 早期版本假设"每面 4 字节定长"，读出的索引全是 0，
    # 导致简化后网格完全塌缩。
    if nf:
        FP = 13  # 实测每面字节数
        face_start = end + nv * dt.itemsize
        raw = np.frombuffer(data, dtype=np.uint8,
                           count=nf * FP, offset=face_start).reshape(nf, FP)
        counts = raw[:, 0]
        # 校验：应该全是 3（三角形）
        if not np.all(counts == 3):
            # 有非三角形，按变长列表逐个解析
            faces_list = []
            p = face_start
            buf = data
            for _ in range(nf):
                c = buf[p]; p += 1
                idx = np.frombuffer(buf, dtype='<u4', count=c, offset=p)
                p += c * 4
                if c == 3:
                    faces_list.append(idx)
                elif c == 4:  # 拆成两个三角形
                    faces_list.append(idx[:3]); faces_list.append(idx[1:])
            faces = np.array(faces_list, dtype=np.int64)
        else:
            faces = raw[:, 1:13].copy().view(np.uint32).astype(np.int64)
    else:
        faces = np.zeros((0, 3), dtype=np.int64)

    return pos, col, faces, nv, nf


def linear_to_srgb(c):
    """
    PLY 顶点色存的是**线性值**（Open3D/摄影测量流程的惯例），
    直接当作 sRGB 显示会明显偏暗发灰。
    实测：原值均值 (82,82,26) → 转 sRGB 后 (150,151,85)，
    与参考截图里的草原黄绿一致。
    """
    c = np.clip(c.astype(np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def build_glb(path, pos, col, faces):
    """写 glb：POSITION(float32 VEC3) + COLOR_0(ubyte VEC3) + indices(uint32)"""
    n = len(pos)
    f = len(faces)

    # 顶点色：线性 → sRGB，再归一化到 0~1（three.js 的 COLOR_0 约定）
    srgb = linear_to_srgb(col.astype(np.float64) / 255.0)
    colf = srgb.astype(np.float32)

    data_pos = np.ascontiguousarray(pos.astype(np.float32))
    data_col = np.ascontiguousarray(colf.astype(np.float32))
    data_idx = np.ascontiguousarray(faces.reshape(-1).astype(np.uint32))

    blob = bytearray()

    def add(arr):
        nonlocal blob
        pad = (4 - len(blob) % 4) % 4
        blob.extend(b'\x00' * pad)
        off = len(blob)
        b = arr.tobytes()
        blob.extend(b)
        return off, len(b)

    o_pos, l_pos = add(data_pos)
    o_col, l_col = add(data_col)
    o_idx, l_idx = add(data_idx)

    minv = pos.min(axis=0).tolist()
    maxv = pos.max(axis=0).tolist()

    js = {
        'asset': {'version': '2.0', 'generator': 'marmot3d-scenegen'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'Terrain'}],
        'meshes': [{'name': 'Terrain', 'primitives': [{
            'attributes': {'POSITION': 0, 'COLOR_0': 1},
            'indices': 2, 'material': 0, 'mode': 4,
        }]}],
        'materials': [{
            'name': 'Terrain',
            'pbrMetallicRoughness': {
                'baseColorFactor': [1, 1, 1, 1],
                'metallicFactor': 0.0, 'roughnessFactor': 0.94,
            },
            'doubleSided': True,
        }],
        'accessors': [
            # 注意：accessor.byteOffset 是**相对所属 bufferView 起点**的偏移，
            # 不是相对整个 BIN 的绝对偏移。GLTFLoader 会先把 bufferView
            # slice 出来，再用 accessor.byteOffset 在这个切片里定位；
            # 若把绝对偏移写进来（如 572208），会越界并抛
            # "Invalid typed array length: <count*itemSize>"。
            # 这里数据都是紧贴 bufferView 起点，故省略 byteOffset（默认 0）。
            {'bufferView': 0, 'componentType': 5126,
             'count': n, 'type': 'VEC3', 'min': minv, 'max': maxv},
            {'bufferView': 1, 'componentType': 5126,
             'count': n, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5125,
             'count': f * 3, 'type': 'SCALAR'},
        ],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': o_pos, 'byteLength': l_pos, 'target': 34962},
            {'buffer': 0, 'byteOffset': o_col, 'byteLength': l_col, 'target': 34962},
            {'buffer': 0, 'byteOffset': o_idx, 'byteLength': l_idx, 'target': 34963},
        ],
        'buffers': [{'byteLength': len(blob)}],
    }

    jsb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jpad = (4 - len(jsb) % 4) % 4
    bpad = (4 - len(blob) % 4) % 4
    total = 12 + 8 + len(jsb) + jpad + 8 + len(blob) + bpad
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        # JSON chunk：chunkLength **必须含 padding**（glTF spec 要求 4 字节对齐），
        # 且 JSON chunk 用空格 0x20 填充（spec 规定；JSON.parse 容忍尾随空白）。
        #
        # 关键坑（本项目踩过两次）：three.js 的 GLTFBinaryExtension 定位下一个
        # chunk 时是 `chunkIndex += chunkLength`，**不会再补对齐**。所以早期版本
        # 「chunkLength 只写真实长度、靠 padding 保持偏移对齐」的做法会让
        # BIN chunk 的头部被读到错位 2 字节处 → chunkType 认不出来 → body 为
        # null → 整个模型加载失败（曾误判为「headless 无法解码贴图」）。
        fh.write(struct.pack('<II', len(jsb) + jpad, 0x4E4F534A))
        fh.write(jsb)
        fh.write(b' ' * jpad)
        fh.write(struct.pack('<II', len(blob) + bpad, 0x004E4942))
        fh.write(bytes(blob))
        fh.write(b'\x00' * bpad)
    return len(blob)


def main():
    print('读取 PLY …')
    pos, col, faces, nv, nf = read_ply(SRC)
    print(f'  顶点 {nv:,}  面 {nf:,}')
    size = pos.max(axis=0) - pos.min(axis=0)
    print(f'  尺寸 X {size[0]:.1f}  Y {size[1]:.1f}  Z {size[2]:.1f}')
    print(f'  Y 范围 {pos[:,1].min():.2f} ~ {pos[:,1].max():.2f}')

    os.makedirs(OUT_DIR, exist_ok=True)

    # 两档精度：
    #  · terrain-lod.glb —— **远景实际使用**。远景要沿椭圆环复制 14 份，
    #    用 15 万面的话总面数会到 128 万，白白拖垮填充率；
    #    远景距离 246m、每份只有几十米宽，2.5 万面完全够看。
    #  · terrain.glb    —— 高模版，留作将来「可行走地形」用（用户当前选择是只当远景）。
    for name, target, note in [
        ('terrain-lod.glb', 25000, '远景用，14 份合计 ~35 万面'),
        ('terrain.glb', 150000, '高模备用（可行走地形）'),
    ]:
        print(f'\n简化 {name} 到 {target:,} 面 …')
        pos2, col2, faces2 = cluster_simplify(pos, col, faces, target)

        out = os.path.join(OUT_DIR, name)
        build_glb(out, pos2, col2, faces2)

        before = os.path.getsize(SRC)
        after = os.path.getsize(out)
        print(f'输出 {out}   ({note})')
        print(f'  面数   {nf:,} → {len(faces2):,}')
        print(f'  顶点   {nv:,} → {len(pos2):,}')
        print(f'  体积   {before/1048576:.1f}MB → {after/1048576:.2f}MB'
              f'  ({before/max(after,1):.0f}×)')
        s2 = pos2.max(axis=0) - pos2.min(axis=0)
        print(f'  尺寸   X {s2[0]:.2f}  Y {s2[1]:.2f}  Z {s2[2]:.2f}')
        srgb = linear_to_srgb(col2.astype(np.float64) / 255.0)
        print(f'  平均色(sRGB): {(srgb.mean(axis=0) * 255).round(0)}')


def cluster_simplify(pos, col, faces, target_faces):
    """XZ 平面顶点聚类 + 退化面剔除"""
    # 本场景的实测布局：X 跨度 25.3、Y 跨度 25.0、Z 仅 6.8，
    # 说明它是 **XY 平面布局**（相机沿 Z 方向看），Z 才是深度轴。
    # 因此在 XY 上分格，保留 Z（深度）精度。
    XY = pos[:, [0, 1]]
    mn = XY.min(axis=0)
    ext = XY.max(axis=0) - mn
    ext[ext <= 0] = 1e-6

    res = int(np.sqrt(max(target_faces // 2, 300)))
    res = max(16, min(800, res))
    cell = np.clip(np.floor((XY - mn) / ext * res).astype(np.int64), 0, res - 1)
    key = cell[:, 0] * res + cell[:, 1]

    uniq, inv = np.unique(key, return_inverse=True)
    n_out = len(uniq)

    acc = np.zeros((n_out, 3), dtype=np.float64)
    np.add.at(acc, inv, pos)
    cnt = np.zeros(n_out, dtype=np.float64)
    np.add.at(cnt, inv, 1.0)
    new_pos = (acc / cnt[:, None]).astype(np.float32)

    acc_c = np.zeros((n_out, 3), dtype=np.float64)
    np.add.at(acc_c, inv, col.astype(np.float64))
    new_col = np.clip(acc_c / cnt[:, None], 0, 255).astype(np.uint8)

    new_faces = inv[faces]

    # 剔除退化面
    t = new_pos[new_faces]
    e1 = t[:, 1] - t[:, 0]
    e2 = t[:, 2] - t[:, 0]
    area2 = np.linalg.norm(np.cross(e1, e2), axis=1)
    keep = area2 > 1e-12
    keep &= ~((new_faces[:, 0] == new_faces[:, 1]) |
              (new_faces[:, 1] == new_faces[:, 2]) |
              (new_faces[:, 0] == new_faces[:, 2]))
    new_faces = new_faces[keep]

    # 剔除孤立顶点
    used = np.zeros(n_out, dtype=bool)
    used[new_faces.reshape(-1)] = True
    remap = np.full(n_out, -1, dtype=np.int64)
    remap[used] = np.arange(int(used.sum()))
    new_pos = new_pos[used]
    new_col = new_col[used]
    new_faces = remap[new_faces].astype(np.int64)

    return new_pos, new_col, new_faces


if __name__ == '__main__':
    main()
