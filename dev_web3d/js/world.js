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
  let respawn = null;
  let test = null;
  let props = [];
  let loot = [];
  let chests = [];

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

  /* 物资箱内容：先决定出 0–2 块芯片，再用普通物资填满。
     芯片固定 1×1，能塞进 4×4 箱子的任何空位。 */
  function fillChest(ch, luck) {
    let guard = 0;
    const chipN = rnd() < 0.62 ? (rnd() < 0.28 ? 2 : 1) : 0;
    for (let i = 0; i < chipN && ch.inv.length < CFG.CHEST_ITEMS; i++) {
      const chip = ITEMS.rollChip(rnd, luck);
      if (chip && Grid.autoPlace(ch.inv, chip, CFG.CHEST_COLS, CFG.CHEST_ROWS)) ch.inv.push(chip);
    }
    while (ch.inv.length < CFG.CHEST_ITEMS && guard++ < 60) {
      const raw = ITEMS.roll(null, rnd, luck);
      const it = Grid.cloneItem(raw);
      if (Grid.autoPlace(ch.inv, it, CFG.CHEST_COLS, CFG.CHEST_ROWS)) ch.inv.push(it);
    }
  }

  function makeChest(x, z, yaw, luck) {
    const ch = {
      x: x, z: z, yaw: yaw,
      cr: CFG.CHEST_R,
      type: 'supply',
      name: '物资箱',
      cols: CFG.CHEST_COLS,
      rows: CFG.CHEST_ROWS,
      pried: false, prying: false, pryT: 0, pryBurst: 0, openDelay: 0,
      search: null, inv: []
    };
    fillChest(ch, luck);
    return ch;
  }

  /* 武器箱：3×2，只出武器和芯片 */
  function fillWeaponCrate(ch, rnd) {
    const r = rnd || Math.random;
    const twoWeapons = r() < 0.35;
    const weaponCount = twoWeapons ? 2 : 1;
    for (let i = 0; i < weaponCount; i++) {
      const wi = Math.floor(r() * WEAPONS.length) % WEAPONS.length;
      const it = ITEMS.makeWeaponItem(wi);
      if (it && Grid.autoPlace(ch.inv, it, ch.cols, ch.rows)) ch.inv.push(it);
    }
    if (!twoWeapons) {
      const chipN = 1 + Math.floor(r() * 3);
      for (let i = 0; i < chipN; i++) {
        const chip = ITEMS.rollChip(r, 0.7);
        if (chip && Grid.autoPlace(ch.inv, chip, ch.cols, ch.rows)) ch.inv.push(chip);
      }
    }
    /* 极端情况下武器没放下：至少塞一块芯片 */
    if (!ch.inv.length) {
      const chip = ITEMS.rollChip(r, 0.7);
      if (chip && Grid.autoPlace(ch.inv, chip, ch.cols, ch.rows)) ch.inv.push(chip);
    }
  }

  function makeWeaponCrate(x, z, yaw, rnd) {
    const ch = {
      x: x, z: z, yaw: yaw,
      cr: CFG.WEAPON_CHEST_R || 0.72,
      type: 'weapon',
      name: '武器箱',
      cols: CFG.WEAPON_CHEST_COLS || 3,
      rows: CFG.WEAPON_CHEST_ROWS || 2,
      pried: false, prying: false, pryT: 0, pryBurst: 0, openDelay: 0,
      search: null, inv: []
    };
    fillWeaponCrate(ch, rnd);
    return ch;
  }

  function gen(seed) {
    rngState = (seed || 1234567) >>> 0 || 1;
    W = CFG.MAP_W; H = CFG.MAP_H;
    floor = new Uint8Array(W * H);
    rooms = []; props = []; loot = [];
    respawn = null; test = null;
    chests = [];

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
          /* 越远的房间越容易出高品质物资 */
          const dist = Math.hypot(c.x - spawn.x, c.z - spawn.z);
          const luck = Math.max(0, Math.min(1, dist / (W * CELL * 0.55)));
          const tier = ITEMS.pickTier(rnd, luck);
          loot.push({
            x: c.x, z: c.z, kind: rnd() < 0.7 ? 'case' : 'canister',
            taken: false, tier: tier.id,
            item: ITEMS.rollForTier(tier, rnd)
          });
        }
      }
    }
    /* 房间里的物资不够就补足到 LOOT_COUNT，保证每局都有可搜刮目标 */
    let guard = 0;
    while (loot.length < CFG.LOOT_COUNT && guard++ < 500) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      if (!r) break;
      const cx = ri(r.x + 1, r.x + r.w - 2);
      const cz = ri(r.z + 1, r.z + r.h - 2);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 5) continue;
      if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 2) continue;
      let tooClose = false;
      for (let k = 0; k < loot.length; k++) {
        if (Math.hypot(loot[k].x - c.x, loot[k].z - c.z) < 1.4) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let k = 0; k < props.length; k++) {
        if (Math.hypot(props[k].x - c.x, props[k].z - c.z) < 1.2) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const dist = Math.hypot(c.x - spawn.x, c.z - spawn.z);
      const luck = Math.max(0, Math.min(1, dist / (W * CELL * 0.55)));
      const tier = ITEMS.pickTier(rnd, luck);
      loot.push({
        x: c.x, z: c.z, kind: rnd() < 0.7 ? 'case' : 'canister',
        taken: false, tier: tier.id,
        item: ITEMS.rollForTier(tier, rnd)
      });
    }

    /* 6. 物资箱：普通局也生成，芯片主要从这里出 */
    const chestTarget = 4;
    let cguard = 0;
    while (chests.length < chestTarget && cguard++ < 500) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      if (!r) break;
      const cx = ri(r.x + 1, r.x + r.w - 2);
      const cz = ri(r.z + 1, r.z + r.h - 2);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 5.5) continue;
      if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 2.5) continue;
      let tooClose = false;
      for (let k = 0; k < props.length; k++) {
        if (Math.hypot(props[k].x - c.x, props[k].z - c.z) < 1.8) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let k = 0; k < loot.length; k++) {
        if (Math.hypot(loot[k].x - c.x, loot[k].z - c.z) < 3.2) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let k = 0; k < chests.length; k++) {
        if (Math.hypot(chests[k].x - c.x, chests[k].z - c.z) < 3.0) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const dist = Math.hypot(c.x - spawn.x, c.z - spawn.z);
      const luck = Math.max(0, Math.min(1, dist / (W * CELL * 0.55)));
      chests.push(makeChest(c.x, c.z, Math.atan2(spawn.x - c.x, spawn.z - c.z), luck));
    }

    /* 7. 武器箱：容量 3×2，只出武器和芯片 */
    let weaponCrates = 0;
    const weaponTarget = CFG.WEAPON_CHEST_COUNT || 2;
    let wguard = 0;
    while (weaponCrates < weaponTarget && wguard++ < 500) {
      const r = rooms[Math.floor(rnd() * rooms.length)];
      if (!r) break;
      const cx = ri(r.x + 1, r.x + r.w - 2);
      const cz = ri(r.z + 1, r.z + r.h - 2);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 6.0) continue;
      if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 3.0) continue;
      let tooClose = false;
      for (let k = 0; k < props.length; k++) {
        if (Math.hypot(props[k].x - c.x, props[k].z - c.z) < 2.0) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let k = 0; k < loot.length; k++) {
        if (Math.hypot(loot[k].x - c.x, loot[k].z - c.z) < 3.2) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let k = 0; k < chests.length; k++) {
        if (Math.hypot(chests[k].x - c.x, chests[k].z - c.z) < 3.4) { tooClose = true; break; }
      }
      if (tooClose) continue;
      chests.push(makeWeaponCrate(c.x, c.z, Math.atan2(spawn.x - c.x, spawn.z - c.z), rnd));
      weaponCrates++;
    }
    return api;
  }

  /* ---------- 测试场 ----------
     48×48m 开放场地：
     - 东侧走廊：两墙之间放光学测试靶
     - 西侧扇形：声学测试靶
     - 北侧圆圈：热学测试靶
     - 南侧蓝色刷新点 + 东侧琥珀撤离点
     - 全图随机物资；无限体力
  */
  function genTest(seed) {
    rngState = (seed || 1234567) >>> 0 || 1;
    W = 24; H = 24;
    floor = new Uint8Array(W * H);
    rooms = [{ x: 1, z: 1, w: W - 2, h: H - 2, cx: W >> 1, cz: H >> 1 }];
    props = []; loot = []; respawn = null; test = null; chests = [];

    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) floor[idx(x, z)] = 1;
    }
    /* 光学测试走廊：两堵竖墙，中间留 3 格宽 */
    for (let z = 3; z <= 9; z++) {
      floor[idx(16, z)] = 0;
      floor[idx(20, z)] = 0;
    }

    spawn = cellCenter(11, 20);
    pad = { x: cellCenter(20, 20).x, z: cellCenter(20, 20).z, r: CFG.EXTRACT_R };
    respawn = { x: cellCenter(11, 16).x, z: cellCenter(11, 16).z, r: CFG.EXTRACT_R };

    const spawns = [];
    const add = function (group, type, x, z) {
      spawns.push({ group: group, type: type, x: x, z: z });
    };

    /* 1. 两墙之间：光学武器靶 */
    const laserTypes = ['zombie', 'gaunt', 'spitter'];
    let li = 0;
    for (const zc of [4, 6, 8]) {
      for (const xc of [17, 19]) {
        const c = cellCenter(xc, zc);
        add('laser', laserTypes[li++ % laserTypes.length], c.x, c.z);
      }
    }

    /* 2. 扇形：声学武器靶（北向扇面） */
    const fanOrigin = cellCenter(6, 14);
    const fanAngles = [-28, 0, 28, -20, 0, 20, -12, 0, 12];
    const fanDists = [7, 7, 7, 10, 10, 10, 13, 13, 13];
    for (let i = 0; i < fanAngles.length; i++) {
      const a = fanAngles[i] * Math.PI / 180;
      const d = fanDists[i];
      add('fan', i % 3 === 0 ? 'gaunt' : (i % 3 === 1 ? 'zombie' : 'spitter'),
        fanOrigin.x + Math.sin(a) * d,
        fanOrigin.z - Math.cos(a) * d);
    }

    /* 3. 圆圈：热学武器靶 */
    const circleC = cellCenter(12, 6);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      add('circle', i % 3 === 0 ? 'spitter' : (i % 3 === 1 ? 'zombie' : 'gaunt'),
        circleC.x + Math.cos(a) * 2.2,
        circleC.z + Math.sin(a) * 2.2);
    }

    /* 4. 训练场物资箱：先放箱子，再让散落物资避开箱子 */
    const chestCells = [[8, 17], [15, 18], [14, 12], [21, 15]];
    for (let ci = 0; ci < chestCells.length; ci++) {
      const c = cellCenter(chestCells[ci][0], chestCells[ci][1]);
      chests.push(makeChest(c.x, c.z, Math.atan2(spawn.x - c.x, spawn.z - c.z), 0.62));
    }
    const wc = cellCenter(17, 12);
    chests.push(makeWeaponCrate(wc.x, wc.z, Math.atan2(spawn.x - wc.x, spawn.z - wc.z), rnd));

    /* 5. 随机物资 */
    let guard = 0;
    while (loot.length < 12 && guard++ < 400) {
      const cx = ri(2, W - 3);
      const cz = ri(2, H - 3);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 3) continue;
      if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 1) continue;
      if (Math.hypot(c.x - respawn.x, c.z - respawn.z) < respawn.r + 1) continue;
      let tooClose = false;
      for (let i = 0; i < chests.length; i++) {
        if (Math.hypot(chests[i].x - c.x, chests[i].z - c.z) < 3.2) { tooClose = true; break; }
      }
      if (tooClose) continue;
      for (let i = 0; i < loot.length; i++) {
        if (Math.hypot(loot[i].x - c.x, loot[i].z - c.z) < 1.5) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const item = ITEMS.roll(null, rnd, 0.7);
      loot.push({
        x: c.x + (rnd() - 0.5) * 0.4,
        z: c.z + (rnd() - 0.5) * 0.4,
        kind: rnd() < 0.7 ? 'case' : 'canister',
        taken: false, tier: item.tierId, item: item
      });
    }

    test = { respawn: respawn, spawns: spawns, extractHold: 2.0 };
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

    /* 撤离台 / 测试场刷新点 */
    const padC = [0.94, 0.69, 0.30];
    drawPad(geo, pad, padC, false);
    if (respawn) drawPad(geo, respawn, [0.43, 0.85, 0.94], true);
    return geo;
  }

  function drawPad(geo, p, color, isRespawn) {
    geo.plane({ x: p.x, y: 0.03, z: p.z, sx: p.r * 2, sz: p.r * 2, color: [0.22, 0.19, 0.14] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      geo.box({
        x: p.x + Math.cos(a) * (p.r - 0.35), y: 0.06, z: p.z + Math.sin(a) * (p.r - 0.35),
        sx: 0.5, sy: 0.06, sz: 0.5, yaw: a,
        color: color, outline: 0, emis: true
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      geo.box({
        x: p.x + Math.cos(a) * p.r, y: 0.9, z: p.z + Math.sin(a) * p.r,
        sx: 0.16, sy: 1.8, sz: 0.16, color: PAL.steel, outline: 0.012, shadow: true
      });
      geo.box({
        x: p.x + Math.cos(a) * p.r, y: 1.86, z: p.z + Math.sin(a) * p.r,
        sx: 0.22, sy: 0.12, sz: 0.22, color: color, outline: 0, emis: true
      });
      geo.box({
        x: p.x + Math.cos(a) * p.r, y: 6.4, z: p.z + Math.sin(a) * p.r,
        sx: 0.09, sy: 8.6, sz: 0.09, color: color, outline: 0, emis: true
      });
      geo.box({
        x: p.x + Math.cos(a) * p.r, y: 10.7, z: p.z + Math.sin(a) * p.r,
        sx: 0.26, sy: 0.26, sz: 0.26, color: color, outline: 0, emis: true
      });
    }
    if (isRespawn) {
      geo.box({ x: p.x, y: 0.07, z: p.z, sx: 0.26, sy: 0.04, sz: 1.15, color: color, outline: 0, emis: true });
      geo.box({ x: p.x, y: 0.07, z: p.z, sx: 1.15, sy: 0.04, sz: 0.26, color: color, outline: 0, emis: true });
    }
  }

  /* ---------- 查询 ---------- */
  /* 方形道具的碰撞：用带旋转的矩形而不是圆 */
  function propHalf(p) {
    return p.kind === 'crate' ? 0.60 : 0.33;
  }

  function rectOverlap(cx, cz, yaw, h, x, z, r) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = x - cx, dz = z - cz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    const qx = lx < -h ? -h : (lx > h ? h : lx);
    const qz = lz < -h ? -h : (lz > h ? h : lz);
    const ex = lx - qx, ez = lz - qz;
    return ex * ex + ez * ez <= r * r + 1e-9;
  }

  function propOverlap(p, x, z, r) {
    return rectOverlap(p.x, p.z, p.rot, propHalf(p), x, z, r);
  }

  function blocked(x, z, r) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cc = worldToCell(x + dx * r, z + dz * r);
        if (!isFloor(cc.cx, cc.cz)) return true;
      }
    }
    /* 道具矩形碰撞 */
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (propOverlap(p, x, z, r)) return true;
    }
    /* 物资箱碰撞（方形，随箱子朝向） */
    for (let i = 0; i < chests.length; i++) {
      const ch = chests[i];
      if (ch.corpse || ch.cr <= 0) continue;
      if (rectOverlap(ch.x, ch.z, ch.yaw || 0, 0.62, x, z, r)) return true;
    }
    return false;
  }

  /* 平滑移动：撞到障碍时沿墙/圆形障碍的切向滑动，而不是硬停。
     分小步推进，优先整步，其次单轴滑动，再尝试圆形障碍切线和角度偏转。 */
  /* 子弹障碍：墙体 + 不可互动的场景道具；物资箱/武器箱/尸体不挡子弹 */
  function bulletBlocked(x, z) {
    const cc = worldToCell(x, z);
    if (!isFloor(cc.cx, cc.cz)) return true;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (propOverlap(p, x, z, 0)) return true;
    }
    return false;
  }

  /* 玩家附近是否有墙（用于墙体透明） */
  function nearWall(x, z, r) {
    const c = worldToCell(x, z);
    const n = Math.ceil(r / CELL) + 1;
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        if (isFloor(c.cx + dx, c.cz + dz)) continue;
        const x0 = (c.cx + dx) * CELL, x1 = x0 + CELL;
        const z0 = (c.cz + dz) * CELL, z1 = z0 + CELL;
        const px = Math.max(x0, Math.min(x, x1));
        const pz = Math.max(z0, Math.min(z, z1));
        if (Math.hypot(x - px, z - pz) <= r) return true;
      }
    }
    return false;
  }

  function nearestObstacle(x, z, r) {
    let best = null, bd = Infinity;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!propOverlap(p, x, z, r)) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = p; }
    }
    for (let i = 0; i < chests.length; i++) {
      const ch = chests[i];
      if (ch.corpse || ch.cr <= 0) continue;
      if (!rectOverlap(ch.x, ch.z, ch.yaw || 0, 0.62, x, z, r)) continue;
      const d = Math.hypot(x - ch.x, z - ch.z);
      if (d < bd) { bd = d; best = ch; }
    }
    return best;
  }

  function moveCircle(x, z, dx, dz, r) {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return { x: x, z: z };
    const maxStep = Math.max(0.08, Math.min(0.22, r * 0.55));
    const steps = Math.min(14, Math.max(1, Math.ceil(dist / maxStep)));
    const sx = dx / steps, sz = dz / steps;
    const stepLen = Math.hypot(sx, sz);
    const base = Math.atan2(sz, sx);
    let cx = x, cz = z;

    function tryAxis() {
      const firstX = Math.abs(sx) >= Math.abs(sz);
      const tries = firstX
        ? [[sx, 0], [0, sz]]
        : [[0, sz], [sx, 0]];
      for (let k = 0; k < tries.length; k++) {
        const t = tries[k];
        if (Math.abs(t[0]) + Math.abs(t[1]) < 1e-6) continue;
        if (!blocked(cx + t[0], cz + t[1], r)) {
          cx += t[0]; cz += t[1];
          return true;
        }
      }
      return false;
    }

    function tryAngles() {
      const angles = [0.22, -0.22, 0.44, -0.44, 0.69, -0.69, 0.96, -0.96, 1.22, -1.22, 1.48, -1.48];
      for (let k = 0; k < angles.length; k++) {
        const a = base + angles[k];
        const ax = Math.cos(a) * stepLen;
        const az = Math.sin(a) * stepLen;
        if (!blocked(cx + ax, cz + az, r)) {
          cx += ax; cz += az;
          return true;
        }
      }
      return false;
    }

    function tryCardinal() {
      const card = [[stepLen, 0], [-stepLen, 0], [0, stepLen], [0, -stepLen]];
      for (let k = 0; k < card.length; k++) {
        const t = card[k];
        if (!blocked(cx + t[0], cz + t[1], r)) {
          cx += t[0]; cz += t[1];
          return true;
        }
      }
      return false;
    }

    for (let i = 0; i < steps; i++) {
      if (!blocked(cx + sx, cz + sz, r)) {
        cx += sx; cz += sz;
        continue;
      }

      const obs = nearestObstacle(cx + sx, cz + sz, r);
      if (obs) {
        /* 圆形障碍：先尝试足够强的切向滑动，避免贴脸时被“吸住” */
        let nx = cx - obs.x, nz = cz - obs.z;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        const dot = sx * nx + sz * nz;
        if (dot < 0) {
          const tx = sx - nx * dot;
          const tz = sz - nz * dot;
          if (Math.hypot(tx, tz) > stepLen * 0.3 && !blocked(cx + tx, cz + tz, r)) {
            cx += tx; cz += tz;
            continue;
          }
        }
        /* 正面撞圆：优先角度偏转，再单轴，再直角 */
        if (tryAngles()) continue;
        if (tryAxis()) continue;
        if (tryCardinal()) continue;
      } else {
        /* 墙体/格子：单轴滑动优先 */
        if (tryAxis()) continue;
        if (tryAngles()) continue;
        if (tryCardinal()) continue;
      }
      break;
    }
    return { x: cx, z: cz };
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

  /* 精确射线（DDA 逐格步进）：返回撞墙距离与穿越的格子轴。
     axis = 'x' / 'z' / 'both'（正好穿过格角），没有撞墙为 null。
     光学武器用它计算反射面，掠射角下也不会漏掉墙角。 */
  function rayWallHit(x0, z0, dx, dz, maxD) {
    let cx = Math.floor(x0 / CELL);
    let cz = Math.floor(z0 / CELL);
    if (!isFloor(cx, cz)) return { d: 0, axis: null };

    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tdx = adx > 1e-9 ? CELL / adx : Infinity;
    const tdz = adz > 1e-9 ? CELL / adz : Infinity;
    let tmx = adx > 1e-9
      ? (stepX > 0 ? ((cx + 1) * CELL - x0) / adx : (x0 - cx * CELL) / adx)
      : Infinity;
    let tmz = adz > 1e-9
      ? (stepZ > 0 ? ((cz + 1) * CELL - z0) / adz : (z0 - cz * CELL) / adz)
      : Infinity;

    for (let guard = 0; guard < 20000; guard++) {
      let axis, d;
      if (tmx < tmz) {
        d = tmx; cx += stepX; tmx += tdx; axis = 'x';
      } else if (tmz < tmx) {
        d = tmz; cz += stepZ; tmz += tdz; axis = 'z';
      } else {
        d = tmx; cx += stepX; cz += stepZ; tmx += tdx; tmz += tdz; axis = 'both';
      }
      if (d > maxD) return { d: maxD, axis: null };
      if (!isFloor(cx, cz)) return { d: d, axis: axis };
    }
    return { d: maxD, axis: null };
  }

  /* 视线：两点之间是否被墙挡住 */
  function los(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    const hit = rayWallHit(x0, z0, dx / d, dz / d, d);
    return !hit.axis || hit.d >= d - 0.35;
  }

  /* 遮挡视线：墙 + 木箱/设备；物资箱/武器箱不遮挡视野 */
  function sightBlocked(x0, z0, x1, z1, ignoreChest) {
    if (!los(x0, z0, x1, z1)) return true;
    const dx = x1 - x0, dz = z1 - z0;
    const L2 = dx * dx + dz * dz;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      let t = 0;
      if (L2 > 1e-6) {
        t = ((p.x - x0) * dx + (p.z - z0) * dz) / L2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
      }
      const qx = x0 + dx * t, qz = z0 + dz * t;
      const rr = p.kind === 'crate' ? 0.62 : 0.36;
      if (Math.hypot(p.x - qx, p.z - qz) < rr) return true;
    }
    return false;
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
    genTest: genTest,
    buildStatic: buildStatic,
    isFloor: isFloor,
    isFloorAt: isFloorAt,
    solidAtCell: solidAtCell,
    worldToCell: worldToCell,
    cellCenter: cellCenter,
    blocked: blocked,
    bulletBlocked: bulletBlocked,
    nearWall: nearWall,
    moveCircle: moveCircle,
    rayWall: rayWall,
    rayWallHit: rayWallHit,
    los: los,
    sightBlocked: sightBlocked,
    randomFloorPoint: randomFloorPoint,
    get W() { return W; },
    get H() { return H; },
    get rooms() { return rooms; },
    get spawn() { return spawn; },
    get pad() { return pad; },
    get respawn() { return respawn; },
    get test() { return test; },
    get props() { return props; },
    get loot() { return loot; },
    get chests() { return chests; }
  };
  return api;
})();
