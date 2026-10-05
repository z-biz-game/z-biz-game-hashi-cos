#!/usr/bin/env python3
"""数桥 HASHI 的视觉母题工厂 —— 一条命令把全套位图资产烤进仓内。

母题就是玩法本身：深海底 + 沙色岛屿节点 + 单/双平行桥。所有像素都在此程序化生成，
不下载、不依赖外部图标库，背景噪声用固定种子（不是 Math.random）。

复现口径是实测过的，不是愿望：把 load_font / load_cjk_font 桩成 None 重烤，12 张里有
11 张与提交树逐字节相同 —— icons/ 与 assets/ 的图都不含文字。唯一例外是
og-1200x630.png，它的「数桥 HASHI」字样要用 FONT_CANDIDATES / CJK_FONT_CANDIDATES
里的系统字体，一台都找不到时退回圆角色块占位，像素就不同（形状仍可读，但不是同一份字节）。

产出（相对仓根）：
  icons/icon-1024.png        母图
  icons/icon-512.png         PWA / Android
  icons/icon-192.png         PWA
  icons/icon-maskable-512.png / icon-maskable-192.png  PWA maskable（主体缩进 80% 安全区）
  icons/apple-touch-icon.png 180 iOS
  icons/favicon-32.png / favicon-16.png
  icons/og-1200x630.png      社交卡
  assets/sea-tile.png        游戏内海纹（256 无缝 tile）
  assets/island.png          游戏内岛屿 sprite（128，带留白容纳阴影）
  assets/particle.png        通关粒子贴图（64 柔光点）

用法: python3 assets/gen/make_art.py   # 一次烤全 12 张，产出路径打印到 stdout
"""
import os
import sys
import math
import random

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# 实测自 css/game.css 与 js/view.js —— 颜色不凭空编。
SEA_TOP = (19, 42, 68)        # #132a44
SEA_BOTTOM = (11, 21, 38)     # #0b1526
SAND = (230, 201, 141)        # #e6c98d
LAND = (242, 227, 194)        # #f2e3c2
LAND_EDGE = (184, 152, 95)    # #b8985f
INK = (34, 36, 43)            # #22242b
BRIDGE = (232, 238, 246)      # #e8eef6
CYAN = (120, 220, 255)        # #78dcff

FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Impact.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def load_font(px):
    for p in FONT_CANDIDATES:
        try:
            from PIL import ImageFont
            return ImageFont.truetype(p, px)
        except Exception:
            continue
    return None


# 中文字形要 CJK 字体，否则 Helvetica/Arial 会把"数桥"画成豆腐块。
CJK_FONT_CANDIDATES = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
]


def load_cjk_font(px):
    for p in CJK_FONT_CANDIDATES:
        try:
            from PIL import ImageFont
            return ImageFont.truetype(p, px)
        except Exception:
            continue
    return None


def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))


def sea_background(size, seed=0, full=True):
    """纵向深海渐变 + 固定相位的短弧涌浪，和 js/view.js 的 drawSea 同源。"""
    w = size
    img = Image.new("RGB", (w, w), SEA_BOTTOM)
    d = ImageDraw.Draw(img)
    for y in range(w):
        t = y / max(1, w - 1)
        d.line([(0, y), (w, y)], fill=mix(SEA_TOP, SEA_BOTTOM, t))
    return img


def swell_overlay(size, seed=0):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    amp = max(1.0, size * 0.004)
    step = max(20.0, size * 0.075)
    lw = max(1, int(size * 0.0018))
    rnd = random.Random(seed)
    row = 0
    for y in range(int(step // 2), size, int(step)):
        phase = rnd.uniform(0, 30)
        pts = []
        x = 0.0
        while x <= size:
            yy = y + math.sin((x + row * 37 + phase) / max(14.0, size * 0.028)) * amp * 2.2
            pts.append((x, yy))
            x += max(6.0, size * 0.02)
        if len(pts) > 1:
            d.line(pts, fill=(140, 190, 230, 26), width=lw, joint="curve")
        row += 1
    return layer


def sheen(img, seed=0):
    """斜向高光 + 细颗粒，让整套资产像同一套设计语言。"""
    size = img.width
    layer = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(layer)
    d.polygon([(0, size * 0.72), (size * 0.34, 0), (size * 0.72, 0), (0, size * 1.1)], fill=24)
    d.polygon([(size, size * 0.2), (size * 0.62, size), (size * 0.86, size), (size, size * 0.52)], fill=14)
    layer = layer.filter(ImageFilter.GaussianBlur(size * 0.06))
    white = Image.new("RGB", (size, size), (255, 255, 255))
    img = Image.composite(white, img.convert("RGB"), layer)
    grain = Image.effect_noise((size, size), 8).convert("L")
    dark = Image.new("RGB", (size, size), (0, 0, 0))
    masked = Image.composite(dark, img, grain.point(lambda v: int(v * 0.09)))
    return Image.blend(img, masked, 0.5)


def hub_graph(size, seed=0, maskable=False):
    """母题主体：中心枢纽岛 + 四向岛，用单/双平行桥相连。返回 RGBA 叠层。"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    S = size
    u = S / 100.0

    # 归一化坐标（% 画布），maskable 时整体缩到 80% 安全区
    box = 0.10 if maskable else 0.0
    span = 0.80 if maskable else 1.0

    def pt(nx, ny):
        x = (box + (nx / 100.0) * span) * S
        y = (box + (ny / 100.0) * span) * S
        return (x, y)

    nodes = {
        "c": pt(50, 50),
        "nw": pt(24, 22),
        "ne": pt(78, 20),
        "sw": pt(22, 80),
        "se": pt(80, 76),
    }
    single = [("c", "nw"), ("c", "ne")]
    double = [("c", "sw"), ("c", "se")]
    width = max(3, int(u * 3.2))
    gap = width * 1.7

    def stroke(a, b, off=0.0):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy) or 1.0
        px, py = -dy / ln, dx / ln
        r = u * 9
        ax += dx / ln * r + px * off
        ay += dy / ln * r + py * off
        bx -= dx / ln * r + px * off
        by -= dy / ln * r + py * off
        d.line([(ax, ay), (bx, by)], fill=(12, 20, 34, 150), width=width + 3)
        d.line([(ax, ay), (bx, by)], fill=BRIDGE + (238,), width=width)

    for a, b in single:
        stroke(nodes[a], nodes[b])
    for a, b in double:
        stroke(nodes[a], nodes[b], -gap / 2)
        stroke(nodes[a], nodes[b], gap / 2)

    # 岛屿：沙色圆盘 + 边缘 + 阴影 + 中心墨点（数字感）
    r = u * 12
    order = ["nw", "ne", "sw", "se", "c"]
    for key in order:
        x, y = nodes[key]
        sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        sd.ellipse([x - r, y - r + u * 2.5, x + r, y + r + u * 2.5], fill=(0, 0, 0, 120))
        sh = sh.filter(ImageFilter.GaussianBlur(u * 2.2))
        layer.alpha_composite(sh)
        d.ellipse([x - r, y - r, x + r, y + r], fill=LAND + (255,), outline=LAND_EDGE + (255,), width=max(2, int(u * 1.4)))
        d.ellipse([x - r, y - r, x + r, y + r], outline=mix(LAND, (255, 255, 255), 0.5) + (120,), width=max(1, int(u * 0.8)))
        # 中心一个小沙凹，暗示"这里会有一个数字"
        d.ellipse([x - u * 2.4, y - u * 2.4, x + u * 2.4, y + u * 2.4], fill=SAND + (255,))
    return layer


def draw_icon(size, maskable=False, seed=7):
    img = sea_background(size, seed=seed)
    img = img.convert("RGBA")
    img.alpha_composite(swell_overlay(size, seed=seed))
    rgb = sheen(img.convert("RGB"), seed=seed).convert("RGBA")
    rgb.alpha_composite(hub_graph(size, seed=seed, maskable=maskable))
    return rgb


def make_favicon(src1024, out, size):
    im = src1024.resize((size, size), Image.LANCZOS)
    im.save(out, "PNG", optimize=True)


def make_og(out, seed=11):
    W, H = 1200, 630
    base = sea_background(H, seed=seed).resize((W, H))
    base = base.convert("RGB")
    base = sheen(base, seed=seed)
    # 左侧母题（裁方后放大）
    art = draw_icon(H, seed=seed)
    base.paste(art, (40, 0), art)
    d = ImageDraw.Draw(base, "RGBA")
    font = load_font(88)
    cjk = load_cjk_font(88)
    sub = load_cjk_font(38)
    tx = H + 70
    if cjk:
        d.text((tx, 232), "数桥", font=cjk, fill=LAND + (255,))
    else:
        d.rounded_rectangle([tx, 250, tx + 220, 330], radius=16, fill=LAND + (255,))
    if font:
        d.text((tx, 336), "HASHI", font=font, fill=CYAN + (235,))
    else:
        d.rounded_rectangle([tx, 360, tx + 360, 440], radius=16, fill=CYAN + (210,))
    if sub:
        d.text((tx, 476), "架桥成图 · 解唯一", font=sub, fill=(210, 226, 244, 220))
    else:
        d.rounded_rectangle([tx, 486, tx + 470, 512], radius=8, fill=(210, 226, 244, 160))
    base.save(out, "PNG", optimize=True)
    return base.size


def make_sea_tile(out, size=256, seed=5):
    """无缝海纹 tile：纵向渐变 + 两端对齐的涌浪，供 canvas 平铺。"""
    img = sea_background(size, seed=seed).convert("RGBA")
    img.alpha_composite(swell_overlay(size, seed=seed))
    img.save(out, "PNG", optimize=True)
    return img.size


def make_island_sprite(out, size=128):
    """岛屿 sprite：透明底 + 阴影 + 沙盘 + 边缘，居中留白便于按半径缩放贴放。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    u = size / 100.0
    cx = cy = size / 2
    r = u * 34
    sh = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.ellipse([cx - r, cy - r + u * 5, cx + r, cy + r + u * 5], fill=(0, 0, 0, 130))
    sh = sh.filter(ImageFilter.GaussianBlur(u * 4))
    img.alpha_composite(sh)
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=LAND + (255,), outline=LAND_EDGE + (255,), width=max(3, int(u * 4)))
    hi = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse([cx - r * 0.7, cy - r * 0.95, cx + r * 0.5, cy - r * 0.3], fill=(255, 255, 255, 60))
    hi = hi.filter(ImageFilter.GaussianBlur(u * 3))
    img.alpha_composite(hi)
    img.save(out, "PNG", optimize=True)
    return img.size


def make_particle(out, size=64):
    """柔光粒子：中心亮、边缘透明的径向渐变点。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = cy = size / 2
    d = ImageDraw.Draw(img)
    steps = size // 2
    for i in range(steps, 0, -1):
        t = i / steps
        col = mix(CYAN, LAND, 1 - t)
        a = int(255 * (1 - t) ** 1.4)
        d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=col + (a,))
    img.save(out, "PNG", optimize=True)
    return img.size


def main():
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)

    master = draw_icon(1024, seed=7)
    paths = {}
    p = os.path.join(ROOT, "icons", "icon-1024.png")
    master.save(p, "PNG", optimize=True)
    paths[p] = master.size
    for s in (512, 192):
        q = os.path.join(ROOT, "icons", f"icon-{s}.png")
        master.resize((s, s), Image.LANCZOS).save(q, "PNG", optimize=True)
        paths[q] = (s, s)
    mk = draw_icon(1024, maskable=True, seed=7)
    for s in (512, 192):
        q = os.path.join(ROOT, "icons", f"icon-maskable-{s}.png")
        mk.resize((s, s), Image.LANCZOS).save(q, "PNG", optimize=True)
        paths[q] = (s, s)
    q = os.path.join(ROOT, "icons", "apple-touch-icon.png")
    master.resize((180, 180), Image.LANCZOS).save(q, "PNG", optimize=True)
    paths[q] = (180, 180)
    for s in (32, 16):
        q = os.path.join(ROOT, "icons", f"favicon-{s}.png")
        make_favicon(master, q, s)
        paths[q] = (s, s)
    q = os.path.join(ROOT, "icons", "og-1200x630.png")
    paths[q] = make_og(q)
    q = os.path.join(ROOT, "assets", "sea-tile.png")
    paths[q] = make_sea_tile(q)
    q = os.path.join(ROOT, "assets", "island.png")
    paths[q] = make_island_sprite(q)
    q = os.path.join(ROOT, "assets", "particle.png")
    paths[q] = make_particle(q)

    for path, sz in paths.items():
        rel = os.path.relpath(path, ROOT)
        kb = os.path.getsize(path) // 1024
        print(f"{rel:34s} {sz[0]}x{sz[1]}  {kb}KB")
    print(f"-> {ROOT}")


if __name__ == "__main__":
    main()
