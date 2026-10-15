"""
从 AI 生成的图标导出网页所需的全部尺寸。

输入：assets/icon-simple-1024.png（扁平版土拨鼠头像）
输出：
  assets/favicon-32.png / -192.png / -512.png   —— 浏览器标签、iOS 主屏图标
  assets/favicon.ico                             —— 多分辨率 ICO（16/32/48）

为什么需要这一步：
  生成图是 1024px 的方图，直接当 favicon 有两个问题：
   1. 体积大（1.3MB），标签页要下载整张
   2. 四角是白色而非透明，贴在深色标签栏上会出现白方块
  所以这里把接近白色的角部像素做成透明，再按尺寸重采样。
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'icon-simple-1024.png')

# 角落判定：接近白色且不透明 → 视为圆角外区域
CUTOFF = 236


def rounded_icon(im):
    """
    生成干净的圆角图标：
      1. 四角接近白色的像素先用图标自身的深绿底色填掉
      2. 再套一个抗锯齿的圆角方形遮罩，遮罩外 alpha 归零

    为什么不能直接把白角设成半透明：
      PNG 存的是非预乘颜色。白色像素配 alpha=0.5 合成到深色标签栏上
      会呈现为**灰色方块**（32px 实测可见四角有灰点），而不是干净的透明。
      所以必须先把 RGB 换成底色，再让 alpha 渐变。
    """
    im = im.convert('RGB')
    w, h = im.size
    px = im.load()

    # 取图标自身的底色（左侧中点，位于深绿圆角方块内）
    base_r, base_g, base_b = px[int(w * 0.03), h // 2]

    span = min(w, h) // 5
    corners = [(0, 0, span, span), (w - span, 0, w, span),
               (0, h - span, span, h), (w - span, h - span, w, h)]
    for x0, y0, x1, y1 in corners:
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b = px[x, y]
                if r >= CUTOFF and g >= CUTOFF and b >= CUTOFF:
                    px[x, y] = (base_r, base_g, base_b)

    # 圆角方形遮罩（半径取边长的 22%，与生成图的圆角风格一致）
    radius = int(min(w, h) * 0.22)
    out = Image.new('RGBA', (w, h), (base_r, base_g, base_b, 0))
    mask = Image.new('L', (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            # 到最近圆角圆心的距离，用于抗锯齿过渡
            cx = radius if x < radius else (w - 1 - radius if x > w - 1 - radius else x)
            cy = radius if y < radius else (h - 1 - radius if y > h - 1 - radius else y)
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            mp[x, y] = 255 if d <= radius - 1 else (0 if d >= radius + 1 else int(255 * (radius + 1 - d) / 2))
    out.paste(im, (0, 0), mask)
    return out


def main():
    base = rounded_icon(Image.open(SRC))
    for size in (512, 192, 32):
        out = os.path.join(ROOT, 'assets', f'favicon-{size}.png')
        base.resize((size, size), Image.LANCZOS).save(out, 'PNG', optimize=True)
        print('  写出', os.path.relpath(out, ROOT), f'{os.path.getsize(out) / 1024:.1f}KB')

    ico = os.path.join(ROOT, 'assets', 'favicon.ico')
    # 多分辨率 ICO：浏览器自行挑选最合适的一档。
    # 必须把**大图**交给 Pillow —— 传已缩小的帧它无法再向下采样，
    # 结果只会写入 16x16 一档（实测踩过）。
    sizes = [(16, 16), (32, 32), (48, 48)]
    base.resize((512, 512), Image.LANCZOS).save(ico, format='ICO', sizes=sizes)
    print('  写出', os.path.relpath(ico, ROOT), f'{os.path.getsize(ico) / 1024:.1f}KB')


if __name__ == '__main__':
    main()
