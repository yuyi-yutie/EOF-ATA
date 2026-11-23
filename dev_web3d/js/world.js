'use strict';

/* ============================================================
   世界：随机设施地图 + 静态几何
   网格 2m 一格，地图 88m x 88m
   ============================================================ */

const World = (function () {
  let W = 0, H = 0;
  let floor = null;        // Uint8Array
  let rooms = [];
  let spawn = { x: 0, z: 0 };
  let pad = { x: 0, z: 0, r: CFG.EXTRACT_R };
  let props = [];
  let loot = [];

  const CELL = CFG.CELL;

  function idx(cx, cz) { return cz * W + cx; }
  function inside(cx, cz) { return cx >= 0 && cz >= 0 && cx < W && cz < H; }
  function isFloor(cx, cz) { return inside(cx, cz) && floor[idx(cx, cz)] === 1; }

  function isFloorAt(x, z) {
    const c = worldToCell(x, z);
    return isFloor(c.cx, c.cz);
  }
  function solidAtCell(cx, cz) { return !isFloor(cx, cz); }

  function worldToCell(x, z) {
    return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
  }
  function cellCenter(cx, cz) {
    return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
  }

  let rngState = 1;
  function rnd() {
    rngState ^= rngState << 13; rngState >>>= 0;
    rngState ^= rngState >> 17;
    rngState ^= rngState << 5; rngState >>>= 0;
    return (rngState >>> 0) / 4294967296;
  }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

  function gen(seed) {
    rngState = (seed || 1234567) >>> 0 || 1;
    W = CFG.MAP_W; H = CFG.MAP_H;
    floor = new Uint8Array(W * H);
    rooms = []; props = []; loot = [];

    /* 1. 房间 */
    const target = 9;
    for (let tries = 0; tries < 400 && rooms.length < target; tries++) {
      const w = ri(5, 9), h = ri(5, 9);
      const x = ri(2, W - w - 3), z = ri(2, H - h - 3);
      let ok = true;
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (x < r.x + r.w + 2 && x + w + 2 > r.x && z < r.z + r.h + 2 && z + h + 2 > r.z) { ok = false; break; }
      }
      if (!ok) continue;
      rooms.push({ x: x, z: z, w: w, h: h, cx: x + (w >> 1), cz: z + (h >> 1) });
    }

    /* 2. 挖房间 */
    for (const r of rooms) {
      for (let z = r.z; z < r.z + r.h; z++) {
        for (let x = r.x; x < r.x + r.w; x++) floor[idx(x, z)] = 1;
      }
    }

    /* 3. 走廊（L 形，2 格宽） */
    function carve(cx, cz) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 1) continue;
          if (inside(cx + dx, cz + dz)) floor[idx(cx + dx, cz + dz)] = 1;
        }
      }
    }
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1], b = rooms[i];
      let cx = a.cx, cz = a.cz;
      while (cx !== b.cx) { carve(cx, cz); cx += cx < b.cx ? 1 : -1; }
      while (cz !== b.cz) { carve(cx, cz); cz += cz < b.cz ? 1 : -1; }
      carve(b.cx, b.cz);
    }
    /* 额外连一条环线，避免一条肠子 */
    if (rooms.length > 3) {
      const a = rooms[0], b = rooms[rooms.length - 1];
      let cx = a.cx, cz = a.cz;
      while (cz !== b.cz) { carve(cx, cz); cz += cz < b.cz ? 1 : -1; }
      while (cx !== b.cx) { carve(cx, cz); cx += cx < b.cx ? 1 : -1; }
    }

    /* 4. 出生点 / 撤离台 */
    const r0 = rooms[0];
    const c0 = cellCenter(r0.cx, r0.cz);
    spawn = { x: c0.x, z: c0.z };
    const rl = rooms[rooms.length - 1];
    const cl = cellCenter(rl.cx, rl.cz);
    pad = { x: cl.x, z: cl.z, r: CFG.EXTRACT_R };

    /* 5. 道具 & 战利品 */
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const n = i === 0 ? 3 : ri(2, 4);
      for (let k = 0; k < n; k++) {
        const cx = ri(r.x + 1, r.x + r.w - 2);
        const cz = ri(r.z + 1, r.z + r.h - 2);
        if (!isFloor(cx, cz)) continue;
        const c = cellCenter(cx, cz);
        if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 4.5) continue;
        if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 2) continue;
        if (rnd() < 0.55) {
          props.push({
            x: c.x + (rnd() - 0.5) * 0.6, z: c.z + (rnd() - 0.5) * 0.6,
            kind: rnd() < 0.6 ? 'crate' : 'barrel',
            rot: rnd() * 6.28, h: rnd() < 0.5 ? 1.1 : 0.8,
            cr: rnd() < 0.6 ? 0.72 : 0.45
          });
        } else {
          loot.push({
            x: c.x, z: c.z, kind: rnd() < 0.7 ? 'case' : 'canister',
            taken: false, tier: rnd() < 0.6 ? 'common' : (rnd() < 0.7 ? 'fine' : 'rare')
          });
        }
      }
    }
    return api;
  }

  /* ---------- 静态几何 ---------- */
  function buildStatic(geo) {
    const P = PAL;
    /* 勾缝底面 */
    geo.plane({
      x: W * CELL * 0.5, y: 0, z: H * CELL * 0.5,
      sx: W * CELL + 8, sz: H * CELL + 8, color: P.grout
    });

    /* 地砖：每格一块，亮度轻微抖动 */
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (!isFloor(cx, cz)) continue;
        const c = cellCenter(cx, cz);
        const h = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
        const v = 0.965 + ((h % 100) / 100) * 0.07;
        geo.plane({
          x: c.x, y: 0.02, z: c.z,
          sx: CELL - 0.06, sz: CELL - 0.06,
          color: [P.floor[0] * v, P.floor[1] * v, P.floor[2] * v]
        });
      }
    }

    /* 墙体：紧贴地板的实心格 */
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (isFloor(cx, cz)) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (isFloor(cx + dx, cz + dz)) { near = true; break; }
          }
        }
        if (!near) continue;
        const c = cellCenter(cx, cz);
        const h = CFG.WALL_H;
        geo.box({
          x: c.x, y: h * 0.5, z: c.z,
          sx: CELL, sy: h, sz: CELL,
          color: PAL.wall, outline: 0.020, shadow: true
        });
      }
    }

    /* 道具 */
    for (const p of props) {
      if (p.kind === 'crate') {
        geo.box({ x: p.x, y: 0.55, z: p.z, sx: 1.15, sy: 1.1, sz: 1.15, yaw: p.rot, color: PAL.wood, outline: 0.02, shadow: true });
        geo.box({ x: p.x, y: 1.14, z: p.z, sx: 1.2, sy: 0.1, sz: 1.2, yaw: p.rot, color: PAL.woodD, outline: 0.014 });
      } else {
        geo.box({ x: p.x, y: 0.5, z: p.z, sx: 0.62, sy: 1.0, sz: 0.62, yaw: p.rot, color: PAL.teal, outline: 0.018, shadow: true });
        geo.box({ x: p.x, y: 0.78, z: p.z, sx: 0.68, sy: 0.08, sz: 0.68, yaw: p.rot, color: PAL.gun, outline: 0.012 });
        geo.box({ x: p.x, y: 0.98, z: p.z, sx: 0.5, sy: 0.06, sz: 0.5, yaw: p.rot, color: PAL.steel, outline: 0 });
      }
    }

    /* 撤离台 */
    const padC = [0.94, 0.69, 0.30];
    geo.plane({ x: pad.x, y: 0.03, z: pad.z, sx: pad.r * 2, sz: pad.r * 2, color: [0.22, 0.19, 0.14] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      geo.box({
        x: pad.x + Math.cos(a) * (pad.r - 0.35), y: 0.06, z: pad.z + Math.sin(a) * (pad.r - 0.35),
        sx: 0.5, sy: 0.06, sz: 0.5, yaw: a,
        color: padC, outline: 0, emis: true
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      geo.box({
        x: pad.x + Math.cos(a) * pad.r, y: 0.9, z: pad.z + Math.sin(a) * pad.r,
        sx: 0.16, sy: 1.8, sz: 0.16, color: PAL.steel, outline: 0.012, shadow: true
      });
      geo.box({
        x: pad.x + Math.cos(a) * pad.r, y: 1.86, z: pad.z + Math.sin(a) * pad.r,
        sx: 0.22, sy: 0.12, sz: 0.22, color: padC, outline: 0, emis: true
      });
    }
    return geo;
  }

  /* ---------- 查询 ---------- */
  function blocked(x, z, r) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cc = worldToCell(x + dx * r, z + dz * r);
        if (!isFloor(cc.cx, cc.cz)) return true;
      }
    }
    /* 道具圆柱碰撞 */
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (Math.hypot(x - p.x, z - p.z) < r + p.cr) return true;
    }
    return false;
  }

  /* 射线：返回撞墙距离（没有墙返回 maxD） */
  function rayWall(x0, z0, dx, dz, maxD, step) {
    step = step || 0.35;
    for (let d = 0; d < maxD; d += step) {
      const x = x0 + dx * d, z = z0 + dz * d;
      const c = worldToCell(x, z);
      if (!isFloor(c.cx, c.cz)) return d;
    }
    return maxD;
  }

  /* 视线：两点之间是否被墙挡住 */
  function los(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    return rayWall(x0, z0, dx / d, dz / d, d) >= d - 0.35;
  }

  function randomFloorPoint(minDistFrom, minDist) {
    for (let i = 0; i < 300; i++) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      if (!r) break;
      const cx = ri(r.x, r.x + r.w - 1);
      const cz = ri(r.z, r.z + r.h - 1);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (minDistFrom && Math.hypot(c.x - minDistFrom.x, c.z - minDistFrom.z) < minDist) continue;
      return c;
    }
    return { x: spawn.x + 6, z: spawn.z + 6 };
  }

  const api = {
    gen: gen,
    buildStatic: buildStatic,
    isFloor: isFloor,
    isFloorAt: isFloorAt,
    solidAtCell: solidAtCell,
    worldToCell: worldToCell,
    cellCenter: cellCenter,
    blocked: blocked,
    rayWall: rayWall,
    los: los,
    randomFloorPoint: randomFloorPoint,
    get W() { return W; },
    get H() { return H; },
    get rooms() { return rooms; },
    get spawn() { return spawn; },
    get pad() { return pad; },
    get props() { return props; },
    get loot() { return loot; }
  };
  return api;
})();
