"""
GLB 优化：把摄影测量级的高模（150 万面 / 35MB 贴图）压到游戏可用级别。

目标：
  · 网格 1,500,000 面 → 约 15,000 面（对一只小动物足够，视觉几乎无损）
  · 贴图 35MB PNG → 约 0.5MB（降到 1024px + JPEG/WebP 质量 80）
  · 输出仍是单文件 .glb，直接拖进 three.js

实现思路（纯 Python，不依赖外部二进制）：
  1. 顶点聚类简化（vertex clustering）—— 把空间量化到目标分辨率后合并顶点，
     对任意模型都有效，且不需要复杂拓扑处理。
  2. 贴图用 Pillow 缩放并转 JPEG。
  3. 重写 GLB 的 JSON 与 BIN chunk。

顶点聚类简化会丢失法线精度，所以重新按面法线计算顶点法线；
这在游戏光照下反而更干净（消除摄影测量常见的噪点法线）。
"""

import struct
import json
import os
import sys
import io
import numpy as np
from PIL import Image


# ---------------------------------------------------------------- GLB 读写
def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'glTF':
        raise ValueError('not a GLB')
    total = struct.unpack('<I', data[8:12])[0]
    off = 12
    js = None
    bin_chunk = None
    while off < total:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        payload = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(payload.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_chunk = payload
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    return js, bin_chunk


def write_glb(path, js, bin_data):
    """
    写 GLB。

    注意：chunkLength 按 glTF spec **包含 padding** 且为 4 的倍数，
    JSON chunk 用空格 0x20 填充（JSON.parse 容忍尾随空白）。

    踩过的坑：早期版本让 JSON chunk 的 chunkLength 只覆盖真实内容，
    想靠 padding 单独保持偏移对齐。这样写 **three.js 加载不了** ——
    GLTFBinaryExtension 定位下一个 chunk 是 `chunkIndex += chunkLength`，
    不会再自己补对齐，于是 BIN chunk 的头部被读到错位 2 字节处，
    chunkType 匹配不上 → body 为 null → 整个模型加载失败
    （这个 bug 曾被误判成「headless Chrome 无法解码贴图」）。
    """
    js_bytes = json.dumps(js, separators=(',', ':')).encode('utf-8')
    js_pad = (4 - len(js_bytes) % 4) % 4
    bin_pad = (4 - len(bin_data) % 4) % 4
    total = 12 + 8 + len(js_bytes) + js_pad + 8 + len(bin_data) + bin_pad
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js_bytes) + js_pad, 0x4E4F534A))
        f.write(js_bytes)
        f.write(b' ' * js_pad)
        f.write(struct.pack('<II', len(bin_data) + bin_pad, 0x004E4942))
        f.write(bin_data)
        f.write(b'\x00' * bin_pad)


def align4(n):
    return (n + 3) & ~3


# ------------------------------------------------------- accessor / bufferView
COMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
TYPE_BYTE = {'SCALAR': 'f', 'VEC2': 'f', 'VEC3': 'f', 'VEC4': 'f'}


def read_accessor(js, bin_data, idx):
    """把 accessor 读成 numpy 数组（只处理 float / uint32）"""
    acc = js['accessors'][idx]
    n = acc['count']
    ncomp = COMP[acc['type']]
    atype = acc['componentType']
    if atype == 5126:      # float
        dt = np.float32
    elif atype == 5125:    # uint32
        dt = np.uint32
    elif atype == 5123:    # uint16
        dt = np.uint16
    elif atype == 5121:    # uint8
        dt = np.uint8
    else:
        raise ValueError('unsupported componentType %d' % atype)

    bv = js['bufferViews'][acc['bufferView']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or (dt().itemsize * ncomp)
    if stride == dt().itemsize * ncomp:
        arr = np.frombuffer(bin_data, dtype=dt, count=n * ncomp, offset=base)
        return arr.reshape(n, ncomp).copy()
    # 交错读取
    out = np.zeros((n, ncomp), dtype=dt)
    for i in range(n):
        out[i] = np.frombuffer(bin_data, dtype=dt, count=ncomp, offset=base + i * stride)
    return out


def build_buffer(js_entries):
    """
    entries: [(array, gltf_type, is_index)]
    返回 (bufferViews, accessors, bin_bytes)

    **索引必须是整数**：glTF 规范要求 indices 的 componentType 为
    5121/5123/5125（ubyte/ushort/uint），不能写成 float。
    之前统一转 float32 导致 GLTFLoader 解析索引时取到 undefined 而报错。
    """
    views, accs = [], []
    blob = bytearray()
    cursor = 0
    for entry in js_entries:
        arr, gtype = entry[0], entry[1]
        is_index = len(entry) > 2 and entry[2]

        ncomp = COMP[gtype]
        n = arr.shape[0]

        if is_index:
            # 顶点索引统一用 uint32（GLTF 全部支持，无兼容问题）
            arr = np.ascontiguousarray(arr.reshape(-1)).astype(np.uint32)
            comp_type = 5125
        else:
            arr = np.ascontiguousarray(arr).astype(np.float32)
            comp_type = 5126

        # 先把 cursor 补齐到 4 字节边界，再取偏移。
        # 注意：padding 只加一次 —— 早期版本写成
        #     pad = align4(cursor); blob.extend(pad); cursor += pad
        # 而 align4 本身是"向上取整到 4 的倍数"，于是 cursor 被多加了一次
        # padding，导致 bufferView.byteOffset 正好是真实位置的一半，
        # 图像数据读出来全是 0（表现为"贴图加载失败"）。这里改为用差值计算。
        pad = align4(cursor) - cursor
        blob.extend(b'\x00' * pad)
        cursor += pad
        offset = cursor
        data = arr.tobytes()
        blob.extend(data)
        cursor += len(data)

        views.append({
            'buffer': 0, 'byteOffset': offset,
            'byteLength': len(data),
            'target': 34963 if is_index else 34962,
        })

        acc = {'bufferView': len(views) - 1, 'componentType': comp_type,
               'count': n if not is_index else arr.size, 'type': gtype}
        # 顶点属性带包围盒；索引不需要（规范禁止）
        if not is_index and n:
            acc['min'] = [float(v) for v in arr.min(axis=0)]
            acc['max'] = [float(v) for v in arr.max(axis=0)]
        accs.append(acc)
    return views, accs, bytes(blob)


# ------------------------------------------------------------ 顶点聚类简化
def cluster_simplify(pos, idx, uv, ratio):
    """
    顶点聚类简化。
    按 target_ratio 决定网格分辨率，把相近顶点合并到格子里。
    返回 (new_pos, new_nrm, new_uv, new_idx)
    """
    target_ratio = max(ratio, 0.0005)
    # 规整成 (N,3) 的三角面索引
    idx = np.asarray(idx).reshape(-1)
    assert idx.size % 3 == 0, '索引数不是 3 的倍数'
    idx = idx.reshape(-1, 3)
    orig_faces = idx.shape[0]
    mn = pos.min(axis=0)
    ext = (pos.max(axis=0) - mn)
    ext[ext <= 0] = 1e-6
    # 三维空间分格并把 UV 分格写入合并键：不把模型压成二维，也不跨纹理接缝合点。
    target_faces = max(orig_faces * target_ratio, 300)
    target_verts = max(target_faces // 2, 120)
    # 网格是二维表面，面数随空间格线性尺度的平方变化。
    res = max(24, min(400, int(np.sqrt(target_verts))))
    uv_res = max(32, min(2048, int(np.sqrt(1.0 / target_ratio) * 8)))

    cell = np.floor((pos - mn) / ext * res).astype(np.int64)
    cell = np.clip(cell, 0, res - 1)
    uv_cell = np.floor(np.clip(uv, 0, 1) * uv_res).astype(np.int64)
    uv_cell = np.clip(uv_cell, 0, uv_res)
    key = (((cell[:, 0] * res + cell[:, 1]) * res + cell[:, 2]) * (uv_res + 1) + uv_cell[:, 0]) * (uv_res + 1) + uv_cell[:, 1]

    uniq_keys, inv = np.unique(key, return_inverse=True)
    n_out = len(uniq_keys)
    if n_out >= pos.shape[0]:
        return pos, None, None, idx

    # 聚合每个格子的位置/uv
    new_pos = np.zeros((n_out, 3), dtype=np.float64)
    np.add.at(new_pos, inv, pos.astype(np.float64))
    new_uv = np.zeros((n_out, 2), dtype=np.float64)
    np.add.at(new_uv, inv, uv.astype(np.float64))

    cnt = np.zeros(n_out, dtype=np.float64)
    np.add.at(cnt, inv, 1.0)
    cnt = np.maximum(cnt, 1e-6)
    new_pos = (new_pos / cnt[:, None]).astype(np.float32)
    new_uv = (new_uv / cnt[:, None]).astype(np.float32)

    new_idx = inv[idx].astype(np.uint32)

    # 重算法线：按三角形面积加权累积
    face_nrm = np.cross(
        pos[idx[:, 1]] - pos[idx[:, 0]],
        pos[idx[:, 2]] - pos[idx[:, 0]],
    )
    acc_n = np.zeros((n_out, 3), dtype=np.float64)
    for k in range(3):
        np.add.at(acc_n, new_idx[:, k], face_nrm)
    lengths = np.linalg.norm(acc_n, axis=1, keepdims=True)
    lengths[lengths < 1e-9] = 1.0
    new_nrm = (acc_n / lengths).astype(np.float32)

    # ---- 剔除退化三角形 ----
    # 顶点合并后大量三角面塌缩成线段或点。它们既占体积又无法渲染，
    # 必须在写出前去掉，否则面数不会明显下降。
    tri = new_pos[new_idx]
    e1 = tri[:, 1] - tri[:, 0]
    e2 = tri[:, 2] - tri[:, 0]
    area2 = np.linalg.norm(np.cross(e1, e2), axis=1)
    keep = area2 > 1e-12
    # 另外剔除重复索引（同一顶点出现两次的面）
    dup = (new_idx[:, 0] == new_idx[:, 1]) | (new_idx[:, 1] == new_idx[:, 2]) | (
        new_idx[:, 0] == new_idx[:, 2])
    keep &= ~dup
    new_idx = new_idx[keep]

    # 移除未被任何面引用的孤立顶点
    used = np.zeros(n_out, dtype=bool)
    used[new_idx.reshape(-1)] = True
    remap = np.full(n_out, -1, dtype=np.int64)
    remap[used] = np.arange(int(used.sum()))
    n_final = int(used.sum())
    new_pos = new_pos[used]
    new_nrm = new_nrm[used]
    new_uv = new_uv[used]
    new_idx = remap[new_idx].astype(np.uint32)
    return new_pos, new_nrm, new_uv, new_idx


# ---------------------------------------------------------------- 贴图处理
def optimize_image(raw, max_size=1024, quality=80):
    im = Image.open(io.BytesIO(raw))
    im = im.convert('RGB')
    w, h = im.size
    if max(w, h) > max_size:
        s = max_size / max(w, h)
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=88, optimize=True, progressive=True)
    return buf.getvalue(), im.size


# ---------------------------------------------------------------- 主流程
def process(src, dst, ratio=0.012, tex_size=1024, quality=80, scale=1.0):
    js, bin_data = read_glb(src)
    before_bytes = os.path.getsize(src)

    mesh = js['meshes'][0]
    prim = mesh['primitives'][0]
    pos = read_accessor(js, bin_data, prim['attributes']['POSITION'])
    idx = read_accessor(js, bin_data, prim['indices']).reshape(-1).astype(np.int64)
    uv_acc = read_accessor(js, bin_data, prim['attributes']['TEXCOORD_0'])

    orig_faces = len(idx) // 3
    size = pos.max(axis=0) - pos.min(axis=0)

    new_pos, new_nrm, new_uv, new_idx = cluster_simplify(pos, idx, uv_acc, ratio)
    if new_nrm is None:
        new_nrm = np.zeros_like(new_pos)
        new_nrm[:, 1] = 1.0
    new_faces = len(new_idx) // 3

    # 贴图：只保留 baseColor（游戏光照下不需要 normal/ORM，节省大量体积）
    entries = [
        (new_pos, 'VEC3'),
        (new_nrm, 'VEC3'),
        (new_uv, 'VEC2'),
        (new_idx.reshape(-1, 1), 'SCALAR', True),  # 索引：整数
    ]
    views, accs, new_bin = build_buffer(entries)

    # ---- 组装新的 glTF ----
    base_tex = None
    tex_size_out = None
    try:
        mat = js['materials'][0]
        pbr = mat.get('pbrMetallicRoughness', {})
        tex_ref = pbr.get('baseColorTexture')
        if tex_ref is not None:
            ti = js['textures'][tex_ref['index']]
            img = js['images'][ti.get('source', 0)]
            bv = js['bufferViews'][img['bufferView']]
            off = bv.get('byteOffset', 0)
            raw = bin_data[off:off + bv['byteLength']]
            jpeg, sz = optimize_image(raw, tex_size, quality)
            # 关键：图像必须接在**几何数据之后**。
            # 早期版本把 byteOffset 写成 pad（即"对齐填充长度"，此处为 0），
            # 于是 GLTFLoader 从 offset 0 处读图，读到的是顶点数据 → 贴图失败。
            # 正确做法：先取当前 bin 长度作为图像偏移，再拼接。
            tex_offset = len(new_bin)
            pad = align4(tex_offset) - tex_offset
            new_bin = new_bin + b'\x00' * pad + jpeg
            # bufferView 必须带 buffer 字段，否则 GLTFLoader 读 bufferViews[N].buffer
            # 得到 undefined 会抛 TypeError（这是本项目踩过的最隐蔽的一个坑）
            base_tex = {
                'buffer': 0, 'byteOffset': align4(tex_offset),
                'byteLength': len(jpeg),
            }
            tex_size_out = sz
    except Exception as e:
        print('  [warn] 贴图处理失败：', e)

    views.append(base_tex) if base_tex else None

    # ---- 组装新的 glTF ----
    # 注意 GLTFLoader 的两个硬性要求（漏掉会直接抛 TypeError）：
    #   1. images[].bufferView 对应的 bufferView 必须带 byteOffset
    #   2. textures[].sampler 必须存在，否则查 sampler.type 时 undefined 报错
    tex_index = None
    new_js = {
        'asset': {'version': '2.0', 'generator': 'marmot3d-optimizer'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{
            'mesh': 0,
            'name': js['nodes'][0].get('name', 'Model') if js.get('nodes') else 'Model',
            **({k: js['nodes'][0][k] for k in ('translation', 'rotation', 'scale', 'matrix') if k in js['nodes'][0]} if js.get('nodes') else {}),
        }],
        'meshes': [{
            'name': js['meshes'][0].get('name', 'Mesh'),
            'primitives': [{
                'attributes': {
                    'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2,
                },
                'indices': 3,
                'material': 0,
                'mode': 4,
            }],
        }],
        'materials': [{
            'name': 'BaseColor',
            'pbrMetallicRoughness': {
                'baseColorFactor': [1, 1, 1, 1],
                'metallicFactor': 0.0,
                'roughnessFactor': 0.82,
            },
            # 必须双面渲染。
            #
            # 实测（tools/check-winding.py）：顶点聚类简化后，
            # 三角形绕序**一半朝内、一半朝外**（藏狐 49.8% / 50.2%）。
            # 摄影测量网格原本就不是闭合流形，简化又打乱了相邻面的绕序一致性，
            # 于是默认的背面剔除会剔掉约一半的面 —— 模型渲染成破碎的空壳，
            # 在贴地第一人称视角下几乎完全看不见。
            # 实测表现：属性检查全部"正常"（visible=true、包围盒合理、
            # 贴图有像素），但画布中心 100% 全黑。
            #
            # 双面渲染的代价是不过滤背面（填充率略高），对这个面数完全可接受，
            # 比在 Python 里重算法线+翻转绕序更稳妥（法线也是简化算出来的，不可靠）。
            'doubleSided': True,
        }],
        'accessors': accs,
        'bufferViews': views,
        'buffers': [{'byteLength': len(new_bin)}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987,
                      'wrapS': 10497, 'wrapT': 10497}],
    }
    if base_tex:
        tex_index = len(new_js['textures']) if 'textures' in new_js else 0
        new_js['textures'] = [{'source': 0, 'sampler': 0}]
        # 注意：glTF 规范里 Image 只有 bufferView/mimeType/uri，
        # **没有 byteOffset 字段** —— 偏移由 bufferView.byteOffset 决定。
        # 多写一个 byteOffset 会让 GLTFLoader 内部按错误偏移取图而抛 TypeError。
        new_js['images'] = [{
            'bufferView': len(views) - 1,
            'mimeType': 'image/jpeg',
        }]
        new_js['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {
            'index': tex_index,
        }

    write_glb(dst, new_js, new_bin)
    after_bytes = os.path.getsize(dst)

    print(f'  面数   {orig_faces:>9,} → {new_faces:>9,}')
    print(f'  顶点   {len(pos):>9,} → {len(new_pos):>9,}')
    if tex_size_out:
        print(f'  贴图   {tex_size_out[0]}×{tex_size_out[1]} JPEG q{quality}')
    print(f'  体积   {before_bytes/1048576:>8.1f}MB → {after_bytes/1048576:>8.2f}MB'
          f'  ({before_bytes/max(after_bytes,1):.0f}× 缩小)')
    print(f'  包围盒尺寸 {[round(float(v),3) for v in size]}')
    return new_pos, size


if __name__ == '__main__':
    SRC = r'C:\Users\Classin\Downloads'
    OUT = r'D:\gam3\3d\marmot-3d\assets\models'
    os.makedirs(OUT, exist_ok=True)

    jobs = [
        ('285a97103d10656b2bcb7c0e1dd630c3.glb', 'marmot.glb'),
        ('061c9c8df3ff8e424bf88b34c10a0fe3.glb', 'fox.glb'),
    ]
    for src_name, out_name in jobs:
        print('=' * 60)
        print(src_name[:14], '→', out_name)
        process(os.path.join(SRC, src_name), os.path.join(OUT, out_name),
                ratio=0.012, tex_size=1024, quality=85)
