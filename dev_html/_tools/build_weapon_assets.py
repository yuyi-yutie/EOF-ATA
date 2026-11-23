#!/usr/bin/env python3
"""
导出武器贴图：Blender 三渲二渲染的 5 把枪（枪口朝 +X，握把在世界原点）。

  art_draft/weapons3d/w0..w4/001.png -> assets/w0..w4.png
  pivot.json 里记着握把在渲染图里的像素位置，用来算旋转锚点 gx/gy

用法： python _tools/build_weapon_assets.py
"""
import json
import os

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art_draft", "weapons3d")
KEYS = ["w0", "w1", "w2", "w3", "w4"]
OUT_W = 240          # 输出图宽（游戏里按 38–40 世界像素绘制）
OUTLINE = 4


def add_outline(im, r):
    a = im.getchannel("A")
    grown = a.filter(ImageFilter.MaxFilter(r * 2 + 1))
    ink = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ink.paste((10, 10, 10, 255), (0, 0, im.width, im.height))
    ink.putalpha(grown)
    return Image.alpha_composite(ink, im)


def main():
    for k in KEYS:
        d = os.path.join(SRC, k)
        im = Image.open(os.path.join(d, "001.png")).convert("RGBA")
        with open(os.path.join(d, "pivot.json")) as f:
            piv = json.load(f)
        px, py = piv["pivot"]
        py = im.height - py          # Blender 原点在左下，PIL 在左上

        box = im.getbbox()
        crop = im.crop(box)
        gx = (px - box[0]) / (box[2] - box[0])
        gy = (py - box[1]) / (box[3] - box[1])

        crop = add_outline(crop, OUTLINE)
        w = OUT_W
        h = int(round(crop.height * w / crop.width))
        crop = crop.resize((w, h), Image.LANCZOS)
        out = os.path.join(ROOT, "assets", k + ".png")
        crop.save(out)
        print("%s -> %s %dx%d   gx=%.3f gy=%.3f" % (k, os.path.relpath(out, ROOT), w, h, gx, gy))


if __name__ == "__main__":
    main()
