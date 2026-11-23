#!/usr/bin/env python3
"""
从 art_draft/ 的原始素材导出游戏用贴图：

  角色（每个角色：一张站立图 + 一张行走帧表）
    art_draft/walk/*.png            -> assets/player_walk.png   (5×3 帧表，浅灰底需要抠图)
    art_draft/person.png            -> assets/person.png        (站立图)
    art_draft/new_charactor/*.png   -> assets/player_walk_2.png (7×2 帧表，本身透明)
    art_draft/person_2.png          -> assets/person_2.png      (站立图)


人物帧是浅灰底的 AI 出图（右下角带水印），从图像边缘做“浅色中性像素”连通填充去背，
再多吃 1px 描边残留；所有帧用同一个裁切框，保留自然的上下起伏。水印在右下角，
落在裁切框之外，自动被裁掉。已经带透明底的素材跳过抠图。

用法： python _tools/build_sprite_assets.py
输出改动后，按脚本打印的数值更新 js/sprites.js 的 CHARS 表。
"""
import glob
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "art_draft")
ASSETS = os.path.join(ROOT, "assets")

MARGIN = 6
PLAYER_SCALE = 0.45

# 角色：三渲二渲染（_blender/render_player_toon.py），描边同敌人用 alpha 膨胀
CHARS = [
    dict(name="char1", root3d="player3d/c1", cols=6, outline=6),
    dict(name="char2", root3d="player3d/c2", cols=6, outline=6),
]

# 敌人：zombie 近战 / zombie_y 远程
# 每个敌人所有动画共用一个裁切框（保证动画之间不跳位），只做裁切+缩放，不做抠图
# 三渲二：Blender 渲染的帧（_blender/render_zombie.py），描边在贴图后处理里用 alpha 膨胀画
ENEMIES = [
    dict(key="zombie", root="zombie3d/zombie", outline=8, anims=[
        dict(anim="walk", dir="walk", cols=7, order=None),
        dict(anim="run", dir="run", cols=5, order=None),
        dict(anim="attack", dir="attack", cols=6, order=None),
    ]),
    dict(key="zombie_y", root="zombie3d/zombie_y", outline=8, anims=[
        dict(anim="walk", dir="walk", cols=6, order=None),
        dict(anim="attack", dir="attack", cols=6, order=None),
    ]),
]
ENEMY_SCALE = 0.45
ENEMY_MARGIN = 6

# 武器：s 声学 / g 光学 / r 热学 / l 力学 / d 电学
# 原图里 s、r 的枪口朝左，统一镜像成朝右（游戏内按瞄准角旋转，约定枪口朝右）
WEAPONS = [
    dict(key="s", out="w0.png", mirror=True),
    dict(key="g", out="w1.png", mirror=False),
    dict(key="r", out="w2.png", mirror=True),
    dict(key="l", out="w3.png", mirror=False),
    dict(key="d", out="w4.png", mirror=False),
]


def background_mask(rgb):
    """从四边向内填充“浅色 + 中性灰”的连通过背景像素。"""
    h, w, _ = rgb.shape
    neutral = (rgb.max(2) - rgb.min(2) <= 14) & (rgb.min(2) >= 205)
    seen = np.zeros((h, w), bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if neutral[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if neutral[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and neutral[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    # 再吃掉紧贴背景的 1px 浅灰描边残留
    near = (rgb.max(2) - rgb.min(2) <= 20) & (rgb.min(2) >= 190)
    fringe = np.zeros_like(seen)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        fringe |= np.roll(seen, (dy, dx), (0, 1)) & near
    return seen | fringe


def cutout(path, key_bg):
    im = Image.open(path).convert("RGBA")
    if key_bg:
        rgb = np.asarray(im.convert("RGB")).astype(int)
        alpha = np.where(background_mask(rgb), 0, 255).astype(np.uint8)
        im.putalpha(Image.fromarray(alpha))
    return im


def alpha_box(im):
    return im.getchannel("A").getbbox()


def add_outline(im, r):
    """alpha 膨胀 → 黑边，线宽在贴图分辨率上恒定"""
    from PIL import ImageFilter
    a = im.getchannel("A")
    grown = a.filter(ImageFilter.MaxFilter(r * 2 + 1))
    ink = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ink.paste((10, 10, 10, 255), (0, 0, im.width, im.height))
    ink.putalpha(grown)
    return Image.alpha_composite(ink, im)


def build_char(c):
    root = os.path.join(ART, c["root3d"])
    files = sorted(glob.glob(os.path.join(root, "walk", "*.png")))
    if not files:
        sys.exit("no walk frames in " + root)
    frames = [Image.open(f).convert("RGBA") for f in files]
    ink = c["outline"]
    m = MARGIN + ink
    boxes = [alpha_box(im) for im in frames]

    x0 = min(b[0] for b in boxes) - m
    y0 = min(b[1] for b in boxes) - m
    x1 = max(b[2] for b in boxes) + m
    y1 = max(b[3] for b in boxes) + m
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(512, x1), min(560, y1)
    cw, ch = x1 - x0, y1 - y0
    ow = int(round(cw * PLAYER_SCALE))
    oh = int(round(ch * PLAYER_SCALE))

    cols = c["cols"]
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGBA", (ow * cols, oh * rows), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        cell = im.crop((x0, y0, x1, y1))
        cell = add_outline(cell, ink).resize((ow, oh), Image.LANCZOS)
        sheet.paste(cell, ((i % cols) * ow, (i // cols) * oh))
    out = os.path.join(ASSETS, "player_walk.png" if c["name"] == "char1" else "player_walk_2.png")
    sheet.save(out)

    ax = (min(b[0] for b in boxes) + max(b[2] for b in boxes)) / 2 - x0
    ay = max(b[3] for b in boxes) - y0
    print("%s walk: %d frames -> %s  cell=%dx%d rows=%d ax=%.1f ay=%.1f"
          % (c["name"], len(frames), os.path.relpath(out, ROOT), ow, oh, rows,
             ax * PLAYER_SCALE, ay * PLAYER_SCALE))

    # 站立图
    ip = os.path.join(root, "idle", "001.png")
    idle = Image.open(ip).convert("RGBA")
    idle = idle.crop(alpha_box(idle))
    idle = idle.crop((max(0, -ink), max(0, -ink), idle.width + ink, idle.height + ink))
    idle = add_outline(idle, ink)
    iout = os.path.join(ASSETS, "person.png" if c["name"] == "char1" else "person_2.png")
    idle.save(iout)
    print("%s idle: -> %s  %dx%d" % (c["name"], os.path.relpath(iout, ROOT), idle.width, idle.height))


def build_enemy(e):
    root = os.path.join(ART, "enemies", e.get("root") or e["key"])
    ink = e.get("outline") or 0
    margin = ENEMY_MARGIN + ink
    frames = {}
    boxes = []
    for a in e["anims"]:
        files = sorted(glob.glob(os.path.join(root, a["dir"], "*.png")))
        if not files:
            sys.exit("no frames in " + os.path.join(root, a["dir"]))
        ims = [Image.open(f).convert("RGBA") for f in files]
        if a["order"]:
            ims = [ims[i - 1] for i in a["order"]]
        frames[a["anim"]] = ims
        boxes += [alpha_box(im) for im in ims]

    x0 = min(b[0] for b in boxes) - margin
    y0 = min(b[1] for b in boxes) - margin
    x1 = max(b[2] for b in boxes) + margin
    y1 = max(b[3] for b in boxes) + margin
    # 不能越出原画布
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(512, x1), min(560, y1)
    cw, ch = x1 - x0, y1 - y0
    ow = int(round(cw * ENEMY_SCALE))
    oh = int(round(ch * ENEMY_SCALE))

    # 锚点：用 walk 的身体中心做 x，脚底做 y
    wb = [alpha_box(im) for im in frames["walk"]]
    body_cx = (min(b[0] for b in wb) + max(b[2] for b in wb)) / 2
    feet_y = max(b[3] for b in boxes)
    ax = (body_cx - x0) * ENEMY_SCALE
    ay = (feet_y - y0) * ENEMY_SCALE

    for a in e["anims"]:
        anim, cols = a["anim"], a["cols"]
        ims = frames[anim]
        rows = (len(ims) + cols - 1) // cols
        sheet = Image.new("RGBA", (ow * cols, oh * rows), (0, 0, 0, 0))
        for i, im in enumerate(ims):
            cell = im.crop((x0, y0, x1, y1))
            if ink:
                cell = add_outline(cell, ink)
            cell = cell.resize((ow, oh), Image.LANCZOS)
            sheet.paste(cell, ((i % cols) * ow, (i // cols) * oh))
        out = os.path.join(ASSETS, "%s_%s.png" % (e["key"], anim))
        sheet.save(out)
        print("enemy %s %-6s: %2d frames -> %s  %dx%d cells=%dx%d rows=%d"
              % (e["key"], anim, len(ims), os.path.relpath(out, ROOT), sheet.width, sheet.height, ow, oh, rows))
    print("   %s anchors: ax=%.1f ay=%.1f cell=%dx%d" % (e["key"], ax, ay, ow, oh))


def build_weapons():
    for w in WEAPONS:
        im = Image.open(os.path.join(ART, "weapons", w["key"] + ".png")).convert("RGBA")
        a = np.asarray(im)[:, :, 3]
        ys, xs = np.where(a > 8)
        im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        if w["mirror"]:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        out = os.path.join(ASSETS, w["out"])
        im.save(out)
        print("weapon %s: -> %s  %dx%d  aspect %.3f" %
              (w["key"], os.path.relpath(out, ROOT), im.width, im.height, im.height / im.width))


if __name__ == "__main__":
    for c in CHARS:
        build_char(c)
    # 武器不在这里出：见 _tools/build_weapon_assets.py（Blender 三渲二渲染）
    for e in ENEMIES:
        build_enemy(e)
