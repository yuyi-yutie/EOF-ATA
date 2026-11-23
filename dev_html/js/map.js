'use strict';

/* ============================================================
   地图：开放场地 + 建筑掩体 + 散落小掩体
   ============================================================ */
const MapGen = (() => {

  function generate(seed) {
    seed = (seed >>> 0) || 1;
    let best = null;
    for (let i = 0; i < 8; i++) {
      const m = tryGenerate((seed + i * 7919) >>> 0);
      if (!best || m.openRatio > best.openRatio) best = m;
      if (m.openRatio >= 0.995) break;
    }
    buildVisuals(best);
    return best;
  }

  function tryGenerate(seed) {
    const rng = mulberry32(seed);
    const W = CFG.MAP_W, H = CFG.MAP_H, T = CFG.TILE;

    const tiles = new Uint8Array(W * H).fill(2);
    const bmask = new Uint8Array(W * H); // 建筑屋顶
    const cmask = new Uint8Array(W * H); // 小掩体

    /* 整张图先铺成空地 */
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) tiles[y * W + x] = 1;
    }

    const buildings = [];
    const covers = [];
    const reserve = new Uint8Array(W * H);

    function isFloorRect(x, y, w, h, pad) {
      if (x - pad < 2 || y - pad < 2 || x + w + pad > W - 2 || y + h + pad > H - 2) return false;
      for (let j = y - pad; j < y + h + pad; j++) {
        for (let i = x - pad; i < x + w + pad; i++) {
          if (tiles[j * W + i] !== 1) return false;
        }
      }
      return true;
    }

    function areaFree(x, y, w, h, pad) {
      if (!isFloorRect(x, y, w, h, pad)) return false;
      for (let j = y - pad; j < y + h + pad; j++) {
        for (let i = x - pad; i < x + w + pad; i++) {
          if (reserve[j * W + i]) return false;
        }
      }
      return true;
    }

    function stamp(x, y, w, h, mask) {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) continue;
          tiles[j * W + i] = 2;
          mask[j * W + i] = 1;
        }
      }
    }

    function wallTile(x, y) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return;
      tiles[y * W + x] = 2;
      bmask[y * W + x] = 1;
    }

    /* 用几段墙把一块空地围成建筑：四角 L 形墙 + 大开口 + 内部隔断 */
    function addBuilding(bx, by, bw, bh) {
      const left = bx, right = bx + bw - 1;
      const top = by, bottom = by + bh - 1;
      const armLen = () => 2 + Math.floor(rng() * 4);

      let tL = armLen(), tR = armLen();
      let bL = armLen(), bR = armLen();
      let lT = armLen(), lB = armLen();
      let rT = armLen(), rB = armLen();

      if (tL + tR >= bw) tR = Math.max(1, bw - tL - 1);
      if (bL + bR >= bw) bR = Math.max(1, bw - bL - 1);
      if (lT + lB >= bh) lB = Math.max(1, bh - lT - 1);
      if (rT + rB >= bh) rB = Math.max(1, bh - rT - 1);

      for (let i = 0; i < tL; i++) wallTile(left + i, top);
      for (let i = 0; i < tR; i++) wallTile(right - i, top);
      for (let i = 0; i < bL; i++) wallTile(left + i, bottom);
      for (let i = 0; i < bR; i++) wallTile(right - i, bottom);
      for (let i = 0; i < lT; i++) wallTile(left, top + i);
      for (let i = 0; i < lB; i++) wallTile(left, bottom - i);
      for (let i = 0; i < rT; i++) wallTile(right, top + i);
      for (let i = 0; i < rB; i++) wallTile(right, bottom - i);

      /* 大开口中间补一段墙，把开口切成两个门洞 */
      const topGap = bw - tL - tR;
      if (topGap >= 6 && rng() < 0.7) {
        const len = 2 + Math.floor(rng() * 2);
        const x0 = left + tL + Math.floor((topGap - len) / 2);
        for (let i = 0; i < len; i++) wallTile(x0 + i, top);
      }
      const bottomGap = bw - bL - bR;
      if (bottomGap >= 6 && rng() < 0.55) {
        const len = 2 + Math.floor(rng() * 2);
        const x0 = left + bL + Math.floor((bottomGap - len) / 2);
        for (let i = 0; i < len; i++) wallTile(x0 + i, bottom);
      }
      const leftGap = bh - lT - lB;
      if (leftGap >= 6 && rng() < 0.5) {
        const len = 2 + Math.floor(rng() * 2);
        const y0 = top + lT + Math.floor((leftGap - len) / 2);
        for (let i = 0; i < len; i++) wallTile(left, y0 + i);
      }
      const rightGap = bh - rT - rB;
      if (rightGap >= 6 && rng() < 0.5) {
        const len = 2 + Math.floor(rng() * 2);
        const y0 = top + rT + Math.floor((rightGap - len) / 2);
        for (let i = 0; i < len; i++) wallTile(right, y0 + i);
      }

      /* 内部隔断，制造房间感 */
      if (bw >= 11 && bh >= 9 && rng() < 0.6) {
        const dir = Math.floor(rng() * 4);
        const len = 3 + Math.floor(rng() * 3);
        if (dir === 0 || dir === 1) {
          const x = left + 3 + Math.floor(rng() * Math.max(1, bw - 7));
          const y0 = dir === 0 ? top + 1 : bottom - 1;
          for (let i = 0; i < len; i++) wallTile(x, dir === 0 ? y0 + i : y0 - i);
        } else {
          const y = top + 3 + Math.floor(rng() * Math.max(1, bh - 7));
          const x0 = dir === 2 ? left + 1 : right - 1;
          for (let i = 0; i < len; i++) wallTile(dir === 2 ? x0 + i : x0 - i, y);
        }
      }

      /* 内部柱子 */
      if (bw >= 10 && bh >= 8 && rng() < 0.5) {
        const px = left + 3 + Math.floor(rng() * Math.max(1, bw - 7));
        const py = top + 3 + Math.floor(rng() * Math.max(1, bh - 7));
        wallTile(px, py);
        if (rng() < 0.6) wallTile(px + 1, py);
      }

      buildings.push({ x: bx, y: by, w: bw, h: bh });
    }

    /* ---------- 1. 建筑 ---------- */
    let guard = 0;
    while (buildings.length < CFG.BUILDINGS && guard++ < 1600) {
      const bw = 9 + Math.floor(rng() * 8);   // 9..16
      const bh = 7 + Math.floor(rng() * 6);   // 7..12
      const bx = 6 + Math.floor(rng() * Math.max(1, W - bw - 12));
      const by = 6 + Math.floor(rng() * Math.max(1, H - bh - 12));
      if (!areaFree(bx, by, bw, bh, 4)) continue;

      addBuilding(bx, by, bw, bh);

      for (let j = by - 3; j <= by + bh + 2; j++) {
        for (let i = bx - 3; i <= bx + bw + 2; i++) {
          if (i > 0 && j > 0 && i < W && j < H) reserve[j * W + i] = 1;
        }
      }
    }

    /* ---------- 2. 散落小掩体 ---------- */
    guard = 0;
    while (covers.length < CFG.COVERS && guard++ < 3200) {
      const roll = rng();
      const w = roll < 0.4 ? 2 : 1;
      const h = roll < 0.28 ? 2 : 1;
      const x = 4 + Math.floor(rng() * Math.max(1, W - w - 8));
      const y = 4 + Math.floor(rng() * Math.max(1, H - h - 8));
      if (!isFloorRect(x, y, w, h, 2)) continue;
      stamp(x, y, w, h, cmask);
      covers.push({ x, y, w, h });
    }

    /* ---------- 3. 出生点（左侧空地） ---------- */
    function clearAt(tx, ty, r) {
      for (let j = ty - r; j <= ty + r; j++) {
        for (let i = tx - r; i <= tx + r; i++) {
          if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) return false;
          if (tiles[j * W + i] !== 1) return false;
        }
      }
      return true;
    }

    let spawn = null;
    for (let t = 0; t < 900 && !spawn; t++) {
      const tx = 5 + Math.floor(rng() * Math.floor(W * 0.22));
      const ty = 6 + Math.floor(rng() * (H - 12));
      if (clearAt(tx, ty, 3)) spawn = { x: (tx + 0.5) * T, y: (ty + 0.5) * T };
    }
    if (!spawn) spawn = { x: 7 * T, y: (H / 2) * T };

    /* ---------- 4. BFS：出生点距离场 ---------- */
    const spawnDist = new Int32Array(W * H);
    const queue = new Int32Array(W * H);
    const stx = Math.floor(spawn.x / T), sty = Math.floor(spawn.y / T);

    function bfs(field, sx, sy) {
      field.fill(-1);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return 0;
      const s = sy * W + sx;
      if (tiles[s] !== 1) return 0;
      let head = 0, tail = 0, maxD = 0;
      field[s] = 0;
      queue[tail++] = s;
      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % W, cy = (cur / W) | 0;
        const d = field[cur];
        if (d > maxD) maxD = d;
        if (cx > 0 && field[cur - 1] < 0 && tiles[cur - 1] === 1) { field[cur - 1] = d + 1; queue[tail++] = cur - 1; }
        if (cx < W - 1 && field[cur + 1] < 0 && tiles[cur + 1] === 1) { field[cur + 1] = d + 1; queue[tail++] = cur + 1; }
        if (cy > 0 && field[cur - W] < 0 && tiles[cur - W] === 1) { field[cur - W] = d + 1; queue[tail++] = cur - W; }
        if (cy < H - 1 && field[cur + W] < 0 && tiles[cur + W] === 1) { field[cur + W] = d + 1; queue[tail++] = cur + W; }
      }
      return maxD;
    }

    const maxSpawnDist = bfs(spawnDist, stx, sty);

    /* ---------- 5. 撤离点（右侧两处） ---------- */
    const extracts = [];
    const zones = [
      { x: W - 13, y: Math.floor(H * 0.2) },
      { x: W - 13, y: Math.floor(H * 0.8) }
    ];

    for (const z of zones) {
      let found = null;
      for (let t = 0; t < 600 && !found; t++) {
        const tx = Math.floor(z.x + rnd(-9, 9));
        const ty = Math.floor(z.y + rnd(-7, 7));
        if (tx < 5 || ty < 5 || tx > W - 6 || ty > H - 6) continue;
        if (!clearAt(tx, ty, 3)) continue;
        const wx = (tx + 0.5) * T, wy = (ty + 0.5) * T;
        if (dist(wx, wy, spawn.x, spawn.y) < 800) continue;
        if (extracts.some(e => dist(e.x, e.y, wx, wy) < 700)) continue;
        found = { x: wx, y: wy, r: CFG.PAD_R };
      }
      if (found) extracts.push(found);
    }

    while (extracts.length < 2) {
      let found = null;
      for (let t = 0; t < 2500 && !found; t++) {
        const tx = 6 + Math.floor(rng() * (W - 12));
        const ty = 6 + Math.floor(rng() * (H - 12));
        if (!clearAt(tx, ty, 3)) continue;
        const wx = (tx + 0.5) * T, wy = (ty + 0.5) * T;
        if (dist(wx, wy, spawn.x, spawn.y) < 700) continue;
        if (extracts.some(e => dist(e.x, e.y, wx, wy) < 500)) continue;
        found = { x: wx, y: wy, r: CFG.PAD_R };
      }
      if (!found) break;
      extracts.push(found);
    }

    /* ---------- 6. 连通性 ---------- */
    let floors = 0, reach = 0;
    for (let i = 0; i < W * H; i++) {
      if (tiles[i] === 1) {
        floors++;
        if (spawnDist[i] >= 0) reach++;
      }
    }
    const openRatio = floors ? reach / floors : 0;

    const map = {
      seed, W, H, tiles, bmask, cmask, buildings, covers,
      spawn, extracts,
      dist: new Int32Array(W * H),
      spawnDist,
      maxSpawnDist,
      queue,
      flowTimer: 0,
      openRatio
    };

    return map;
  }

  /* ---------- 预渲染 ---------- */
  function buildVisuals(map) {
    const { tiles, W, H } = map;
    const T = CFG.TILE;
    const cv = document.createElement('canvas');
    cv.width = W * T;
    cv.height = H * T;
    const g = cv.getContext('2d');

    const rawAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 2 : tiles[y * W + x];
    const floorAt = (x, y) => rawAt(x, y) === 1;

    /* 地板：按 80px 一块铺地砖，随机挑变体，避免整片重复 */
    const floorTiles = MapTiles.floorTiles();
    if (floorTiles) {
      const B = MapTiles.FLOOR_WORLD;
      const cols = Math.ceil(cv.width / B);
      const rows = Math.ceil(cv.height / B);
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < cols; bx++) {
          const h = ((bx * 73856093) ^ (by * 19349663)) >>> 0;
          g.drawImage(floorTiles[h % floorTiles.length], bx * B, by * B);
        }
      }
    } else {
      g.fillStyle = MapTiles.FLOOR_FALLBACK;
      g.fillRect(0, 0, cv.width, cv.height);
    }

    /* 墙体：瓦片纹理 */
    const wallPat = MapTiles.wallPattern(g);
    g.fillStyle = wallPat || MapTiles.WALL_FALLBACK;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (floorAt(x, y)) continue;
        g.fillRect(x * T, y * T, T, T);
      }
    }

    /* 墙脚投影：紧贴墙体下方的地板压一层软阴影 */
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!floorAt(x, y) || floorAt(x, y - 1)) continue;
        const grad = g.createLinearGradient(0, y * T, 0, y * T + 16);
        grad.addColorStop(0, MapTiles.SHADOW);
        grad.addColorStop(1, 'rgba(74,54,32,0)');
        g.fillStyle = grad;
        g.fillRect(x * T, y * T, T, 16);
      }
    }

    /* 墙体：下沿可见侧面 + 描边 */
    const SIDE = 9;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (floorAt(x, y)) continue;
        const x0 = x * T, y0 = y * T;

        if (floorAt(x, y + 1)) {
          g.fillStyle = MapTiles.SIDE_COLOR;
          g.fillRect(x0, y0 + T - SIDE, T, SIDE);
          g.fillStyle = 'rgba(0,0,0,0.30)';
          g.fillRect(x0, y0 + T - SIDE, T, 2);
        }

        g.fillStyle = MapTiles.OUTLINE;
        if (floorAt(x, y - 1)) g.fillRect(x0, y0, T, 2);
        if (floorAt(x, y + 1)) g.fillRect(x0, y0 + T - 2, T, 2);
        if (floorAt(x - 1, y)) g.fillRect(x0, y0, 2, T);
        if (floorAt(x + 1, y)) g.fillRect(x0 + T - 2, y0, 2, T);
      }
    }

    map.canvas = cv;

    /* 小地图 */
    const mini = document.createElement('canvas');
    mini.width = W;
    mini.height = H;
    const mg = mini.getContext('2d');
    mg.fillStyle = '#ffffff';
    mg.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = tiles[y * W + x];
        if (t === 1) mg.fillStyle = '#d3bfa1';
        else if (map.bmask[y * W + x]) mg.fillStyle = '#2e2f31';
        else if (map.cmask[y * W + x]) mg.fillStyle = '#4e5054';
        else continue;
        mg.fillRect(x, y, 1, 1);
      }
    }
    map.mini = mini;

    /* 贴图还没加载完（autostart 等场景）：加载好后重铺一次 */
    if (!MapTiles.ready(0) || !MapTiles.ready(1)) {
      MapTiles.onReady(() => buildVisuals(map));
    }
  }

  /* ---------- 碰撞与查询 ---------- */
  function tileAt(map, wx, wy) {
    const tx = Math.floor(wx / CFG.TILE);
    const ty = Math.floor(wy / CFG.TILE);
    if (tx < 0 || ty < 0 || tx >= map.W || ty >= map.H) return 2;
    return map.tiles[ty * map.W + tx];
  }

  function isWall(map, wx, wy) {
    return tileAt(map, wx, wy) !== 1;
  }

  function circleHitsWall(map, x, y, r) {
    const T = CFG.TILE;
    const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T);
    const y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.W || ty >= map.H) return true;
        if (map.tiles[ty * map.W + tx] === 1) continue;
        const cx = clamp(x, tx * T, tx * T + T);
        const cy = clamp(y, ty * T, ty * T + T);
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  function moveCircle(map, ent, dx, dy) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      ent.x += sx;
      if (circleHitsWall(map, ent.x, ent.y, ent.r)) ent.x -= sx;
      ent.y += sy;
      if (circleHitsWall(map, ent.x, ent.y, ent.r)) ent.y -= sy;
    }
  }

  function hasLOS(map, x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2);
    const steps = Math.ceil(d / 9);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isWall(map, lerp(x1, x2, t), lerp(y1, y2, t))) return false;
    }
    return true;
  }

  /* ---------- 流场寻路 ---------- */
  function computeFlow(map, wx, wy) {
    const W = map.W, H = map.H;
    const field = map.dist;
    const queue = map.queue;
    field.fill(-1);
    const sx = Math.floor(wx / CFG.TILE), sy = Math.floor(wy / CFG.TILE);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H || map.tiles[sy * W + sx] !== 1) return;
    let head = 0, tail = 0;
    const start = sy * W + sx;
    field[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % W, cy = (cur / W) | 0;
      const d = field[cur];
      if (cx > 0 && field[cur - 1] < 0 && map.tiles[cur - 1] === 1) { field[cur - 1] = d + 1; queue[tail++] = cur - 1; }
      if (cx < W - 1 && field[cur + 1] < 0 && map.tiles[cur + 1] === 1) { field[cur + 1] = d + 1; queue[tail++] = cur + 1; }
      if (cy > 0 && field[cur - W] < 0 && map.tiles[cur - W] === 1) { field[cur - W] = d + 1; queue[tail++] = cur - W; }
      if (cy < H - 1 && field[cur + W] < 0 && map.tiles[cur + W] === 1) { field[cur + W] = d + 1; queue[tail++] = cur + W; }
    }
  }

  function flowDir(map, wx, wy) {
    const W = map.W;
    const tx = Math.floor(wx / CFG.TILE), ty = Math.floor(wy / CFG.TILE);
    if (tx < 0 || ty < 0 || tx >= W || ty >= map.H) return null;
    const d0 = map.dist[ty * W + tx];
    if (d0 < 0) return null;
    let best = null, bd = d0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        const nx = tx + i, ny = ty + j;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= map.H - 1) continue;
        if (i && j) {
          if (map.tiles[ty * W + nx] !== 1 || map.tiles[ny * W + tx] !== 1) continue;
        }
        const d = map.dist[ny * W + nx];
        if (d >= 0 && d < bd) { bd = d; best = { x: nx, y: ny }; }
      }
    }
    if (!best) return null;
    return { x: (best.x + 0.5) * CFG.TILE, y: (best.y + 0.5) * CFG.TILE };
  }

  return {
    generate, tileAt, isWall, circleHitsWall, moveCircle, hasLOS,
    computeFlow, flowDir
  };
})();
