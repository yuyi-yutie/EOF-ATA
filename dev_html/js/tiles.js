'use strict';

/* ============================================================
   地图贴图：地板 / 墙体瓦片
   素材：art_draft/tiles/（由 _tools/build_tile_assets.py 导出到 assets/）
   - floor_tiles.png：地砖变体图集（4 格 96px，4×1），运行时缩到 64px 分块铺
   - wall_tile.png  ：墙面质感小块（40px），平铺当墙顶表面
   world = 该纹理在地图坐标系里重复的像素尺寸
   ============================================================ */
const MapTiles = (() => {
  /* 地板：从地板瓦片里取 8 个亮度接近的格子做随机变体，避免大面积重复感 */
  /* 尺寸约定（都是地图格 CFG.TILE = 32px 的整数倍）：
     地板 2 格 = 64px，墙贴图 4 格 = 128px（地板的两倍，两张图重复时网格对齐） */
  const FLOOR = {
    src: 'assets/floor_tiles.png',
    world: 64,
    fallback: '#ddcdb2',
    cols: 4,      /* 变体图集排布 */
    cellPx: 96,   /* 图集里每个变体的像素尺寸 */
    count: 4
  };
  const WALL = { src: 'assets/wall_tile.png', world: 128, fallback: '#efe6d8' };

  /* 墙体下沿暗面 / 描边 / 投影 */
  const SIDE_COLOR = '#3d3e40';
  const OUTLINE = '#241f1c';
  const SHADOW = 'rgba(74,54,32,0.16)';

  const floorImg = new Image();
  const wallImg = new Image();
  let floorTiles = null;   // 预缩放的地板变体（world × world）
  let wallTile = null;     // 预缩放的墙面（world × world）
  const readyCbs = [];

  function load(img, src) {
    img.onerror = () => { img.broken = true; };
    img.src = src;
  }

  function makeTile(img, world, sx, sy, sw, sh) {
    const c = document.createElement('canvas');
    c.width = world;
    c.height = world;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (sx === undefined) g.drawImage(img, 0, 0, world, world);
    else g.drawImage(img, sx, sy, sw, sh, 0, 0, world, world);
    return c;
  }

  function buildFloor() {
    const out = [];
    for (let i = 0; i < FLOOR.count; i++) {
      const c = i % FLOOR.cols;
      const r = (i / FLOOR.cols) | 0;
      out.push(makeTile(floorImg, FLOOR.world,
        c * FLOOR.cellPx, r * FLOOR.cellPx, FLOOR.cellPx, FLOOR.cellPx));
    }
    floorTiles = out;
  }

  function checkReady() {
    if (!floorTiles || !wallTile || !readyCbs.length) return;
    const cbs = readyCbs.splice(0);
    for (const cb of cbs) cb();
  }

  function init() {
    load(floorImg, FLOOR.src);
    load(wallImg, WALL.src);
    floorImg.onload = () => { buildFloor(); checkReady(); };
    wallImg.onload = () => { wallTile = makeTile(wallImg, WALL.world); checkReady(); };
  }

  /* 两张都就绪后回调一次（已就绪则立即回调） */
  function onReady(cb) {
    if (floorTiles && wallTile) cb();
    else readyCbs.push(cb);
  }

  function ready(i) {
    return i === 0 ? !!floorTiles : !!wallTile;
  }

  return {
    init,
    onReady,
    ready,
    FLOOR_WORLD: FLOOR.world,
    WALL_WORLD: WALL.world,
    floorTiles: () => floorTiles,
    wallPattern: ctx => (wallTile ? ctx.createPattern(wallTile, 'repeat') : null),
    FLOOR_FALLBACK: FLOOR.fallback,
    WALL_FALLBACK: WALL.fallback,
    SIDE_COLOR,
    OUTLINE,
    SHADOW
  };
})();
