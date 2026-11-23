#!/usr/bin/env python3
"""
导出地图贴图：Blender 三渲二渲染的 4 个地砖变体 + 1 张墙面板。

  地板瓦片/墙瓦片（旧 AI 图）-> 仅作对照保留
  art_draft/tiles3d/floor/0..3.png -> assets/floor_tiles.png（4 格图集）
  art_draft/tiles3d/wall/001.png   -> assets/wall_tile.png

用法： python _tools/build_tile_assets.py
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "art_draft", "tiles3d")

FLOOR_OUT = os.path.join(ROOT, "assets", "floor_tiles.png")
WALL_OUT = os.path.join(ROOT, "assets", "wall_tile.png")
TILE_PX = 96
COLS = 4


def main():
    tiles = []
    for i in range(COLS):
        p = os.path.join(SRC, "floor", "%d.png" % i)
        im = Image.open(p).convert("RGB").resize((TILE_PX, TILE_PX), Image.LANCZOS)
        tiles.append(im)
    sheet = Image.new("RGB", (TILE_PX * COLS, TILE_PX))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * TILE_PX, 0))
    sheet.save(FLOOR_OUT)
    print("floor: -> %s  %dx%d  (%d variants)" % (os.path.relpath(FLOOR_OUT, ROOT),
                                                  sheet.width, sheet.height, len(tiles)))

    wall = Image.open(os.path.join(SRC, "wall", "001.png")).convert("RGB")
    wall = wall.resize((128, 128), Image.LANCZOS)
    wall.save(WALL_OUT)
    print("wall : -> %s  %dx%d" % (os.path.relpath(WALL_OUT, ROOT), wall.width, wall.height))


if __name__ == "__main__":
    main()
