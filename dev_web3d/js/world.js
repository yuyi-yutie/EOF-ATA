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
  let spawnYaw = 0;
  let pad = { x: 0, z: 0, r: CFG.EXTRACT_R, hold: CFG.EXTRACT_HOLD };
  let pads = [];
  let respawn = null;
  let test = null;
  let props = [];
  let loot = [];
  let chests = [];
  let houses = [];
  let enemySpawns = [];
  let customMap = false;
  let floorPoints = [];
  let houseCellIndex = null;
  let pathWallEdges = null;
  let pathCornerBlocked = null;
  /* 2m 网格导航可走表：按标准 AI 半径预先排除木箱 / 设备 / 物资箱附近的格子，
     A* 不再把“穿箱子”当成可行路线。 */
  let navWalk = null;
  const NAV_RADIUS = 0.55;
  /* A* 复用缓冲区：避免每次寻路都分配 4 张全地图 typed array。 */
  let pathCap = 0;
  let pathG = null, pathF = null, pathParent = null, pathClosed = null, pathInOpen = null;
  let pathOpen = [];
  let mapId = '';
  let mapName = '';

  const CELL = CFG.CELL;

  function idx(cx, cz) { return cz * W + cx; }
  function inside(cx, cz) { return cx >= 0 && cz >= 0 && cx < W && cz < H; }
  function isFloor(cx, cz) { return inside(cx, cz) && floor[idx(cx, cz)] === 1; }

  function isFloorAt(x, z) {
    return isFloor(Math.floor(x / CELL), Math.floor(z / CELL));
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
      const it = ITEMS.makeWeaponItem(wi, { found: true });
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

  /* ============================================================
     安全屋：Blender 模型（墙壁 / 屋顶 / 门）在游戏里拼装
     - 模型正面朝局部 -Z，门铰链在局部 [-doorW/2, 0, frontZ]
     - 墙壁阻挡移动 / 子弹 / 视线；门关闭时同样阻挡
     - 屋顶没有碰撞，只在玩家能看见屋内且距离够近时隐藏
     ============================================================ */
  function houseLocal(h, lx, lz) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    return { x: h.x + c * lx + s * lz, z: h.z - s * lx + c * lz };
  }

  function houseToLocal(h, x, z) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    const dx = x - h.x, dz = z - h.z;
    return { x: c * dx - s * dz, z: s * dx + c * dz };
  }

  function makeHouse(x, z, yaw, wModules, dModules, doorList, id, partitions) {
    const C = CFG.HOUSE;
    const M = C.MODULE;
    const w = Math.max(C.MIN_MODULES, Math.min(C.MAX_MODULES, wModules | 0));
    const d = Math.max(C.MIN_MODULES, Math.min(C.MAX_MODULES, dModules | 0));
    const h = {
      id: id || ('house_' + x.toFixed(1) + '_' + z.toFixed(1)),
      x: x, z: z, yaw: yaw,
      w: w, d: d, module: M,
      halfW: w * M * 0.5, halfD: d * M * 0.5,
      wallH: C.WALL_H, wallT: C.WALL_T,
      doorW: C.DOOR_W, doorH: C.DOOR_H, doorT: C.DOOR_T,
      openAngle: 1.76,
      roofHidden: false,
      walls: [], doors: [], modules: [], interiorModules: [],
      floorCells: [], roofCells: [],
      corners: [], roofUnits: [],
      samples: []
    };
    const hw = h.halfW, hd = h.halfD;
    const doorSet = {};
    (doorList || []).forEach(function (d) {
      if (d && d.side && isFinite(d.index)) doorSet[d.side + '#' + (d.index | 0)] = true;
    });

    function modulePoint(module, ox, oz) {
      const c = Math.cos(module.yaw), s = Math.sin(module.yaw);
      return { x: module.cx + c * ox + s * oz, z: module.cz - s * ox + c * oz };
    }

    const sides = [
      { key: 'front', count: w, yaw: 0,
        center: function (i) { return { x: -hw + M * 0.5 + i * M, z: hd - C.WALL_T * 0.5 }; } },
      { key: 'right', count: d, yaw: Math.PI * 0.5,
        center: function (i) { return { x: hw - C.WALL_T * 0.5, z: hd - M * 0.5 - i * M }; } },
      { key: 'back', count: w, yaw: Math.PI,
        center: function (i) { return { x: -hw + M * 0.5 + i * M, z: -hd + C.WALL_T * 0.5 }; } },
      { key: 'left', count: d, yaw: -Math.PI * 0.5,
        center: function (i) { return { x: -hw + C.WALL_T * 0.5, z: hd - M * 0.5 - i * M }; } }
    ];

    function addHouseModule(sideKey, index, localX, localZ, moduleYaw, type, interior) {
      const world = houseLocal(h, localX, localZ);
      const module = {
        side: sideKey, index: index,
        cx: world.x, cz: world.z,
        yaw: h.yaw + moduleYaw,
        sideYaw: moduleYaw,
        type: type,
        lx: localX, lz: localZ,
        interior: !!interior,
        door: null
      };
      if (type === 'door') {
        const halfDoor = C.DOOR_W * 0.5;
        const sideSeg = (M - C.DOOR_W) * 0.25;
        const segW = (M - C.DOOR_W) * 0.5;
        const left = modulePoint(module, -(halfDoor + sideSeg), 0);
        const right = modulePoint(module,  (halfDoor + sideSeg), 0);
        h.walls.push({ x: left.x, z: left.z, yaw: module.yaw, hx: segW * 0.5, hz: C.WALL_T * 0.5 });
        h.walls.push({ x: right.x, z: right.z, yaw: module.yaw, hx: segW * 0.5, hz: C.WALL_T * 0.5 });

        const hinge = modulePoint(module, -halfDoor, 0);
        let maxDepth = 1.5;
        if (!interior) {
          const roomDepth = (sideKey === 'front' || sideKey === 'back' ? h.halfD : h.halfW);
          maxDepth = Math.max(0.4, roomDepth - C.WALL_T * 0.5 - 0.2);
        }
        const door = {
          house: h,
          side: sideKey, index: index,
          x: module.cx, z: module.cz,
          yaw: module.yaw,
          hingeX: hinge.x, hingeZ: hinge.z,
          maxDepth: maxDepth,
          open: false, t: 0, angle: 0,
          rect: { x: module.cx, z: module.cz, yaw: module.yaw, hx: halfDoor, hz: C.DOOR_T * 0.5 },
          module: module
        };
        module.door = door;
        h.doors.push(door);
      } else {
        h.walls.push({ x: module.cx, z: module.cz, yaw: module.yaw, hx: M * 0.5, hz: C.WALL_T * 0.5 });
      }
      (interior ? h.interiorModules : h.modules).push(module);
      return module;
    }

    for (let si = 0; si < sides.length; si++) {
      const side = sides[si];
      for (let i = 0; i < side.count; i++) {
        const local = side.center(i);
        const isDoor = !!doorSet[side.key + '#' + i];
        const type = isDoor ? 'door' : ((i % 2 === 1) ? 'window' : 'solid');
        addHouseModule(side.key, i, local.x, local.z, side.yaw, type, false);
      }
    }

    /* 室内隔断：沿 2m 网格线放置，doors 为从 from 端开始的模块索引 */
    (partitions || []).forEach(function (part) {
      if (!part) return;
      const axis = part.axis === 'z' ? 'z' : 'x';
      const line = +part.line || 0;
      const from = +part.from || 0;
      const to = +part.to || 0;
      if (to <= from) return;
      const count = Math.max(1, Math.round((to - from) / M));
      const pdoors = Array.isArray(part.doors) ? part.doors : [];
      for (let i = 0; i < count; i++) {
        const isDoor = pdoors.indexOf(i) >= 0;
        let lx, lz, moduleYaw;
        if (axis === 'x') {
          lx = from + M * 0.5 + i * M;
          lz = line;
          moduleYaw = 0;
        } else {
          lx = line;
          lz = from + M * 0.5 + i * M;
          moduleYaw = Math.PI * 0.5;
        }
        addHouseModule('interior', i, lx, lz, moduleYaw,
          isDoor ? 'door' : 'solid', true);
      }
    });

    /* 地板 / 屋顶瓦片 */
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        const lx = -hw + M * 0.5 + i * M;
        const lz = -hd + M * 0.5 + j * M;
        const p = houseLocal(h, lx, lz);
        const cell = { x: p.x, z: p.z, yaw: h.yaw, i: i, j: j };
        h.floorCells.push(cell);
        h.roofCells.push(cell);
      }
    }

    /* 角柱：向内收 0.16m，柱身和底座都不超出外墙；柱顶藏在屋顶下方 */
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const p = houseLocal(h, sx * (hw - 0.16), sz * (hd - 0.16));
        h.corners.push({ x: p.x, z: p.z, yaw: h.yaw });
      }
    }
    /* 大一点的房子加一个屋顶空调装饰 */
    if (w >= 4 && d >= 3) {
      const p = houseLocal(h, -hw + M * 1.5, hd - M * 1.5);
      h.roofUnits.push({ x: p.x, z: p.z, yaw: h.yaw });
    }

    /* 屋内采样点：3×3 网格 + 每扇门向内的采样点 */
    const fx = [-0.34, 0, 0.34];
    for (let a = 0; a < fx.length; a++) {
      for (let b = 0; b < fx.length; b++) {
        const p = houseLocal(h, fx[a] * hw, fx[b] * hd);
        h.samples.push(p);
      }
    }
    for (let i = 0; i < h.doors.length; i++) {
      const door = h.doors[i];
      const module = door.module;
      if (!module) continue;
      const p = modulePoint(module, 0, -1.0);
      h.samples.push({ x: p.x, z: p.z });
    }
    return h;
  }

  /* ============================================================
     自定义地图：任意正交轮廓房屋
     - 房屋由若干 2m 格子组成，可拼成 L / T / 凹形
     - 与外部相邻的边界自动生成外墙；门用 (cx,cz,dir) 指定
     - 内墙 / 内门用相邻两格之间的共享边指定
     - 仍然复用 makeHouse 产出的 h.walls / h.doors / modules 等结构，
       所以碰撞、视线、屋顶显隐、小地图、渲染都不需要另写一套
     ============================================================ */
  const HOUSE_DIRS = {
    front: { dx: 0, dz: 1, nx: 0, nz: 1, yaw: 0 },
    right: { dx: 1, dz: 0, nx: 1, nz: 0, yaw: Math.PI * 0.5 },
    back: { dx: 0, dz: -1, nx: 0, nz: -1, yaw: Math.PI },
    left: { dx: -1, dz: 0, nx: -1, nz: 0, yaw: -Math.PI * 0.5 }
  };

  function makeGridHouse(spec) {
    const C = CFG.HOUSE;
    const M = C.MODULE;
    const T = C.WALL_T;
    const cellMap = {};
    const cells = [];
    (spec && spec.cells ? spec.cells : []).forEach(function (c) {
      if (!c) return;
      const rawX = Array.isArray(c) ? c[0] : c.cx;
      const rawZ = Array.isArray(c) ? c[1] : c.cz;
      if (!isFinite(rawX) || !isFinite(rawZ)) return;
      const cx = rawX | 0;
      const cz = rawZ | 0;
      const k = cx + ',' + cz;
      if (cellMap[k]) return;
      cellMap[k] = 1;
      cells.push({ cx: cx, cz: cz });
    });
    if (!cells.length) return null;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.cx < minX) minX = c.cx;
      if (c.cz < minZ) minZ = c.cz;
      if (c.cx > maxX) maxX = c.cx;
      if (c.cz > maxZ) maxZ = c.cz;
    }
    const bw = maxX - minX + 1;
    const bd = maxZ - minZ + 1;
    const h = {
      id: (spec && spec.id) || ('grid_' + minX + '_' + minZ),
      name: (spec && spec.name) || '',
      x: (minX + maxX + 1) * CELL * 0.5,
      z: (minZ + maxZ + 1) * CELL * 0.5,
      yaw: 0, grid: true,
      w: bw, d: bd, module: M,
      halfW: bw * CELL * 0.5, halfD: bd * CELL * 0.5,
      minCx: minX, maxCx: maxX, minCz: minZ, maxCz: maxZ,
      cells: cells, cellMap: cellMap,
      wallH: C.WALL_H, wallT: T,
      doorW: C.DOOR_W, doorH: C.DOOR_H, doorT: C.DOOR_T,
      openAngle: 1.76,
      roofHidden: false,
      walls: [], doors: [], modules: [], interiorModules: [],
      floorCells: [], roofCells: [], rects: [],
      corners: [], roofUnits: [],
      samples: []
    };

    function inHouse(cx, cz) { return !!cellMap[cx + ',' + cz]; }

    const doorSet = {};
    (spec && spec.doors ? spec.doors : []).forEach(function (d) {
      if (!d || !HOUSE_DIRS[d.dir]) return;
      doorSet[(d.cx | 0) + ',' + (d.cz | 0) + ',' + d.dir] = true;
    });

    function addGridModule(cx, cz, dirKey, type, interior) {
      const d = HOUSE_DIRS[dirKey];
      const c = cellCenter(cx, cz);
      const offset = interior ? CELL * 0.5 : CELL * 0.5 - T * 0.5;
      const mx = c.x + d.nx * offset;
      const mz = c.z + d.nz * offset;
      const module = {
        side: interior ? 'interior' : dirKey,
        index: 0,
        cx: mx, cz: mz,
        yaw: d.yaw, sideYaw: d.yaw,
        type: type,
        lx: 0, lz: 0,
        interior: !!interior,
        door: null
      };
      if (type === 'door') {
        const halfDoor = C.DOOR_W * 0.5;
        const sideSeg = (M - C.DOOR_W) * 0.25;
        const segW = (M - C.DOOR_W) * 0.5;
        const cos = Math.cos(d.yaw), sin = Math.sin(d.yaw);
        const left = { x: mx + cos * -(halfDoor + sideSeg), z: mz - sin * -(halfDoor + sideSeg) };
        const right = { x: mx + cos * (halfDoor + sideSeg), z: mz - sin * (halfDoor + sideSeg) };
        h.walls.push({ x: left.x, z: left.z, yaw: d.yaw, hx: segW * 0.5, hz: T * 0.5 });
        h.walls.push({ x: right.x, z: right.z, yaw: d.yaw, hx: segW * 0.5, hz: T * 0.5 });

        const hinge = { x: mx + cos * -halfDoor, z: mz - sin * -halfDoor };
        const door = {
          house: h,
          side: interior ? 'interior' : dirKey,
          index: 0,
          x: mx, z: mz,
          yaw: d.yaw,
          hingeX: hinge.x, hingeZ: hinge.z,
          maxDepth: interior ? 1.5 : 2.2,
          open: false, t: 0, angle: 0,
          rect: { x: mx, z: mz, yaw: d.yaw, hx: halfDoor, hz: C.DOOR_T * 0.5 },
          module: module
        };
        module.door = door;
        h.doors.push(door);
      } else {
        h.walls.push({ x: mx, z: mz, yaw: d.yaw, hx: M * 0.5, hz: T * 0.5 });
      }
      (interior ? h.interiorModules : h.modules).push(module);
      return module;
    }

    /* 外墙：每格 4 条边，邻格不属于同一栋房屋时生成一段 2m 墙 */
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      for (let di = 0; di < 4; di++) {
        const dirKey = ['front', 'right', 'back', 'left'][di];
        const d = HOUSE_DIRS[dirKey];
        if (inHouse(cell.cx + d.dx, cell.cz + d.dz)) continue;
        const isDoor = !!doorSet[cell.cx + ',' + cell.cz + ',' + dirKey];
        const hv = ((cell.cx * 73856093) ^ (cell.cz * 19349663) ^ (di * 83492791)) >>> 0;
        const type = isDoor ? 'door' : ((hv % 4 === 0) ? 'window' : 'solid');
        addGridModule(cell.cx, cell.cz, dirKey, type, false);
      }
    }

    /* 内墙 / 内门：使用共享边中坐标较小的那一格 + front/right */
    (spec && spec.partitions ? spec.partitions : []).forEach(function (p) {
      if (!p || !HOUSE_DIRS[p.dir]) return;
      let cx = p.cx | 0, cz = p.cz | 0, dirKey = p.dir;
      if (dirKey === 'back') { cz -= 1; dirKey = 'front'; }
      else if (dirKey === 'left') { cx -= 1; dirKey = 'right'; }
      const d = HOUSE_DIRS[dirKey];
      if (!inHouse(cx, cz) || !inHouse(cx + d.dx, cz + d.dz)) return;
      addGridModule(cx, cz, dirKey, p.door ? 'door' : 'solid', true);
    });

    /* 地板 / 屋顶：每格一块 2×2m 瓦片（用于采样和旧绘制路径） */
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const c = cellCenter(cell.cx, cell.cz);
      h.floorCells.push({ x: c.x, z: c.z, yaw: 0, i: cell.cx, j: cell.cz });
      h.roofCells.push({ x: c.x, z: c.z, yaw: 0, i: cell.cx, j: cell.cz });
    }

    /* 把轮廓拆成尽量少的矩形：地板 / 屋顶整块绘制，避免每 2m 出现接缝。
       例如矩形房 = 1 个矩形，L 形房通常 = 2 个矩形。 */
    const visited = {};
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!inHouse(cx, cz) || visited[cx + ',' + cz]) continue;
        let rw = 0;
        while (inHouse(cx + rw, cz) && !visited[(cx + rw) + ',' + cz]) rw++;
        let rd = 0;
        let grow = true;
        while (grow) {
          const nz = cz + rd;
          if (nz > maxZ) break;
          for (let i = 0; i < rw; i++) {
            if (!inHouse(cx + i, nz) || visited[(cx + i) + ',' + nz]) { grow = false; break; }
          }
          if (grow) rd++;
        }
        if (rd < 1) rd = 1;
        for (let dz = 0; dz < rd; dz++) {
          for (let dx = 0; dx < rw; dx++) visited[(cx + dx) + ',' + (cz + dz)] = 1;
        }
        h.rects.push({
          x0: cx, z0: cz, w: rw, d: rd,
          x: (cx + rw * 0.5) * CELL,
          z: (cz + rd * 0.5) * CELL
        });
      }
    }

    /* 角柱：只放在轮廓拐角；从顶点向房屋内部收 0.16m */
    const vertexMap = {};
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          const vx = cell.cx + (sx > 0 ? 1 : 0);
          const vz = cell.cz + (sz > 0 ? 1 : 0);
          const key = vx + ',' + vz;
          if (vertexMap[key]) continue;
          let ax = 0, az = 0, n = 0;
          for (let a = -1; a <= 0; a++) {
            for (let b = -1; b <= 0; b++) {
              if (!inHouse(vx + a, vz + b)) continue;
              const cc = cellCenter(vx + a, vz + b);
              ax += cc.x; az += cc.z; n++;
            }
          }
          /* 只在真正的凸角放角柱：n = 1。
             直线墙缝（n = 2）和凹角（n = 3）不放，否则每 2m 一根柱子，
             会形成大片“龙骨”状的柱列，遮挡室内视线。 */
          if (n !== 1) { vertexMap[key] = 1; continue; }
          ax /= n; az /= n;
          const wx = vx * CELL, wz = vz * CELL;
          const dx = ax - wx, dz = az - wz;
          const dl = Math.hypot(dx, dz) || 1;
          vertexMap[key] = 1;
          h.corners.push({ x: wx + dx / dl * 0.16, z: wz + dz / dl * 0.16, yaw: 0 });
        }
      }
    }

    /* 屋内采样点：每格中心 + 四角内缩点 */
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const c = cellCenter(cell.cx, cell.cz);
      h.samples.push({ x: c.x, z: c.z });
      const offs = [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];
      for (let k = 0; k < offs.length; k++) {
        h.samples.push({ x: c.x + offs[k][0], z: c.z + offs[k][1] });
      }
    }
    return h;
  }

  /* 射线与带旋转的矩形求交；返回最近命中距离和世界法线 */
  function rayRectHit(x0, z0, dx, dz, maxD, cx, cz, yaw, hx, hz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ox = c * (x0 - cx) - s * (z0 - cz);
    const oz = s * (x0 - cx) + c * (z0 - cz);
    const ldx = c * dx - s * dz;
    const ldz = s * dx + c * dz;
    let tmin = 0, tmax = maxD;
    let nxL = 0, nzL = 0, axis = null;

    if (Math.abs(ldx) < 1e-9) {
      if (ox < -hx || ox > hx) return null;
    } else {
      let t1 = (-hx - ox) / ldx;
      let t2 = (hx - ox) / ldx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) { tmin = t1; nxL = ldx > 0 ? -1 : 1; nzL = 0; axis = 'x'; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }

    if (Math.abs(ldz) < 1e-9) {
      if (oz < -hz || oz > hz) return null;
    } else {
      let t1 = (-hz - oz) / ldz;
      let t2 = (hz - oz) / ldz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) { tmin = t1; nxL = 0; nzL = ldz > 0 ? -1 : 1; axis = 'z'; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }

    if (!axis || tmin < 0 || tmin > maxD) return null;
    return {
      d: tmin,
      nx: c * nxL + s * nzL,
      nz: -s * nxL + c * nzL,
      axis: axis
    };
  }

  function doorClosed(d) {
    return !!d && d.t < 0.35;
  }

  function houseHasOpenDoor(h) {
    for (let i = 0; i < h.doors.length; i++) {
      if (h.doors[i].t > 0.35) return true;
    }
    return false;
  }

  /* 房屋世界包围盒（缓存）：大量房屋 / 墙体查询先做包围盒剔除。 */
  function houseBounds(h) {
    if (h._bounds) return h._bounds;
    let b;
    if (h.grid) {
      b = {
        minX: h.minCx * CELL - 0.35,
        maxX: (h.maxCx + 1) * CELL + 0.35,
        minZ: h.minCz * CELL - 0.35,
        maxZ: (h.maxCz + 1) * CELL + 0.35
      };
    } else {
      b = {
        minX: h.x - h.halfW - 0.35,
        maxX: h.x + h.halfW + 0.35,
        minZ: h.z - h.halfD - 0.35,
        maxZ: h.z + h.halfD + 0.35
      };
    }
    h._bounds = b;
    return b;
  }

  function houseAabbDistance(h, x, z) {
    const b = houseBounds(h);
    const dx = Math.max(0, b.minX - x, x - b.maxX);
    const dz = Math.max(0, b.minZ - z, z - b.maxZ);
    return Math.hypot(dx, dz);
  }

  /* 线段是否可能穿过房屋包围盒（slab 测试） */
  function houseRayMayHit(h, x0, z0, dx, dz, maxD) {
    const b = houseBounds(h);
    let t0 = 0, t1 = maxD;
    if (Math.abs(dx) < 1e-8) {
      if (x0 < b.minX || x0 > b.maxX) return false;
    } else {
      let a = (b.minX - x0) / dx, c = (b.maxX - x0) / dx;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-8) {
      if (z0 < b.minZ || z0 > b.maxZ) return false;
    } else {
      let a = (b.minZ - z0) / dz, c = (b.maxZ - z0) / dz;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return false;
    }
    return t1 >= 0;
  }

  function houseRayHit(x0, z0, dx, dz, maxD) {
    if (!houses.length) return null;
    let best = null;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      if (!houseRayMayHit(h, x0, z0, dx, dz, maxD)) continue;
      for (let i = 0; i < h.walls.length; i++) {
        const w = h.walls[i];
        const hit = rayRectHit(x0, z0, dx, dz, maxD, w.x, w.z, w.yaw, w.hx, w.hz);
        if (hit && (!best || hit.d < best.d)) best = hit;
      }
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        if (!doorClosed(d)) continue;
        const hit = rayRectHit(x0, z0, dx, dz, maxD, d.rect.x, d.rect.z, d.rect.yaw, d.rect.hx, d.rect.hz);
        if (hit && (!best || hit.d < best.d)) best = hit;
      }
    }
    return best;
  }

  /* AI 过门通道：门开着一半时，门框两端的墙仍会挡住半径较大的单位。
     给 AI 在门洞中心线附近开一条无墙体碰撞的通道，避免反复刮门框卡死。 */
  function inOpenDoorChannel(x, z) {
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        if (doorClosed(d)) continue;
        const dx = x - d.x, dz = z - d.z;
        if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
        const yaw = d.rect ? d.rect.yaw : 0;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const along = dx * c + dz * s;
        const norm = -dx * s + dz * c;
        /* 门洞宽 1.36m，单位半径 0.42m：中心偏出 0.26m 就会穿进门框。
           通道给到 0.45m 已经足够宽容，再多就是肉眼可见的“卡在门框里”。 */
        if (Math.abs(along) < 0.45 && Math.abs(norm) < 1.4) return true;
      }
    }
    return false;
  }

  function houseBlocked(x, z, r, passDoors) {
    if (!houses.length) return false;
    if (passDoors && inOpenDoorChannel(x, z)) return false;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      if (houseAabbDistance(h, x, z) > r + 0.35) continue;
      for (let i = 0; i < h.walls.length; i++) {
        const w = h.walls[i];
        if (rectOverlap2(w.x, w.z, w.yaw, w.hx, w.hz, x, z, r)) return true;
      }
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        if (!doorClosed(d)) continue;
        if (rectOverlap2(d.rect.x, d.rect.z, d.rect.yaw, d.rect.hx, d.rect.hz, x, z, r)) return true;
      }
    }
    return false;
  }

  function houseWallAtPointForHouse(h, x, z, r) {
    for (let i = 0; i < h.walls.length; i++) {
      const w = h.walls[i];
      if (rectOverlap2(w.x, w.z, w.yaw, w.hx, w.hz, x, z, r)) return true;
    }
    return false;
  }

  /* A* 用的房屋墙体边表：格子地板本身不含墙，提前把被墙/隔断覆盖的
     相邻格边标记出来。门洞中点没有墙，因此仍然可通行。 */
  function rebuildPathWallEdges() {
    pathWallEdges = new Set();
    if (!houses.length) return;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      const cells = h.grid ? h.cells : null;
      const list = [];
      if (cells) {
        for (let i = 0; i < cells.length; i++) list.push({ cx: cells[i].cx, cz: cells[i].cz });
      } else {
        const b = houseBounds(h);
        const x0 = Math.max(0, Math.floor(b.minX / CELL));
        const x1 = Math.min(W - 1, Math.ceil(b.maxX / CELL));
        const z0 = Math.max(0, Math.floor(b.minZ / CELL));
        const z1 = Math.min(H - 1, Math.ceil(b.maxZ / CELL));
        for (let cz = z0; cz <= z1; cz++) {
          for (let cx = x0; cx <= x1; cx++) list.push({ cx: cx, cz: cz });
        }
      }
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        for (let di = 0; di < dirs.length; di++) {
          const nx = c.cx + dirs[di][0], nz = c.cz + dirs[di][1];
          if (!inside(nx, nz)) continue;
          const mx = (c.cx + nx + 1) * CELL * 0.5;
          const mz = (c.cz + nz + 1) * CELL * 0.5;
          if (!houseWallAtPointForHouse(h, mx, mz, 0.04)) continue;
          const a = c.cz * W + c.cx, b = nz * W + nx;
          const total = W * H;
          pathWallEdges.add(a < b ? a * total + b : b * total + a);
        }
      }
    }
  }

  function pathEdgeBlocked(cx, cz, nx, nz) {
    if (pathWallEdges === null) rebuildPathWallEdges();
    if (!pathWallEdges || !pathWallEdges.size) return false;
    const total = W * H;
    const a = cz * W + cx, b = nz * W + nx;
    return pathWallEdges.has(a < b ? a * total + b : b * total + a);
  }

  /* 预计算 A* 可走格：格子中心按标准 AI 半径做一次完整碰撞检测。
     墙体格子本身仍由 isFloor 排除；木箱 / 油桶 / 物资箱会被这里排除。 */
  function rebuildNavWalk() {
    navWalk = new Uint8Array(W * H);
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (!isFloor(cx, cz)) continue;
        const c = cellCenter(cx, cz);
        if (!blocked(c.x, c.z, NAV_RADIUS, true)) navWalk[idx(cx, cz)] = 1;
      }
    }
    /* 预计算斜向边：格子中心连线被墙 / 门框 / 箱子挡住时，A* 不允许斜穿。
       只算一次，避免每个 A* 节点都做射线检测。 */
    pathCornerBlocked = new Set();
    const total = W * H;
    const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (!navWalk[idx(cx, cz)]) continue;
        const ca = cellCenter(cx, cz);
        for (let di = 0; di < diag.length; di++) {
          const nx = cx + diag[di][0], nz = cz + diag[di][1];
          if (!inside(nx, nz) || !navWalk[idx(nx, nz)]) continue;
          const cb = cellCenter(nx, nz);
          if (!moveLineBlocked(ca.x, ca.z, cb.x, cb.z, NAV_RADIUS)) continue;
          const a = idx(cx, cz), b = idx(nx, nz);
          pathCornerBlocked.add(a < b ? a * total + b : b * total + a);
        }
      }
    }
  }

  function pathCornerIsBlocked(cx, cz, nx, nz) {
    if (!pathCornerBlocked || !pathCornerBlocked.size) return false;
    const total = W * H;
    const a = idx(cx, cz), b = idx(nx, nz);
    return pathCornerBlocked.has(a < b ? a * total + b : b * total + a);
  }

  function segmentCircleHit(x0, z0, x1, z1, cx, cz, rr) {
    const dx = x1 - x0, dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    let t = 0;
    if (l2 > 1e-9) t = ((cx - x0) * dx + (cz - z0) * dz) / l2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = x0 + dx * t, qz = z0 + dz * t;
    const sx = cx - qx, sz = cz - qz;
    return sx * sx + sz * sz < rr * rr;
  }

  /* 移动用直线检测：墙体 / 关闭的门 + 木箱 / 设备 / 物资箱。
     与 los() 不同，这里把障碍物也当作不可穿越，并考虑单位半径。 */
  function moveLineBlocked(x0, z0, x1, z1, r) {
    if (!los(x0, z0, x1, z1)) return true;
    r = r || 0.45;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const pr = (p.cr || (p.kind === 'crate' ? 0.72 : 0.45)) + r;
      if (segmentCircleHit(x0, z0, x1, z1, p.x, p.z, pr)) return true;
    }
    for (let i = 0; i < chests.length; i++) {
      const c = chests[i];
      if (c.corpse || !(c.cr > 0)) continue;
      if (segmentCircleHit(x0, z0, x1, z1, c.x, c.z, c.cr + r)) return true;
    }
    return false;
  }

  function houseSegmentBlocked(x0, z0, x1, z1, includeDoor) {
    if (!houses.length) return false;
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return false;
    const ux = dx / dist, uz = dz / dist;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      if (!houseRayMayHit(h, x0, z0, ux, uz, dist)) continue;
      for (let i = 0; i < h.walls.length; i++) {
        const w = h.walls[i];
        const hit = rayRectHit(x0, z0, ux, uz, dist, w.x, w.z, w.yaw, w.hx, w.hz);
        if (hit && hit.d < dist - 0.06) return true;
      }
      if (!includeDoor) continue;
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        if (!doorClosed(d)) continue;
        const hit = rayRectHit(x0, z0, ux, uz, dist, d.rect.x, d.rect.z, d.rect.yaw, d.rect.hx, d.rect.hz);
        if (hit && hit.d < dist - 0.06) return true;
      }
    }
    return false;
  }

  function houseDistance(h, x, z) {
    if (h.grid) {
      /* 先用外接矩形快速排除远处房屋，再逐格算精确距离 */
      const bx = Math.max(0, h.minCx * CELL - x, x - (h.maxCx + 1) * CELL);
      const bz = Math.max(0, h.minCz * CELL - z, z - (h.maxCz + 1) * CELL);
      if (bx > 0 || bz > 0) return Math.hypot(bx, bz);
      let best = Infinity;
      for (let i = 0; i < h.cells.length; i++) {
        const c = cellCenter(h.cells[i].cx, h.cells[i].cz);
        const dx = Math.max(0, Math.abs(x - c.x) - CELL * 0.5);
        const dz = Math.max(0, Math.abs(z - c.z) - CELL * 0.5);
        const d = Math.hypot(dx, dz);
        if (d < best) best = d;
      }
      return best;
    }
    const l = houseToLocal(h, x, z);
    const dx = Math.max(0, Math.abs(l.x) - h.halfW);
    const dz = Math.max(0, Math.abs(l.z) - h.halfD);
    return Math.hypot(dx, dz);
  }

  function houseContains(h, x, z, pad) {
    const p = pad || 0;
    if (h.grid) {
      /* 房屋由格子组成：落在任一格内即视为在屋内。
         内部格边界（x / z 正好为 2m 整数倍）也算屋内，避免站在共享墙上时屋顶突然恢复。 */
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      return !!h.cellMap[cx + ',' + cz];
    }
    const l = houseToLocal(h, x, z);
    return Math.abs(l.x) <= h.halfW - p && Math.abs(l.z) <= h.halfD - p;
  }

  function rebuildHouseCellIndex() {
    houseCellIndex = {};
    if (!houses.length) return;
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (h.grid) {
        for (let k = 0; k < h.cells.length; k++) {
          const c = h.cells[k];
          houseCellIndex[c.cx + ',' + c.cz] = h;
        }
      } else {
        const r = Math.max(h.halfW, h.halfD) + CELL;
        const x0 = Math.max(0, Math.floor((h.x - r) / CELL));
        const x1 = Math.min(W - 1, Math.ceil((h.x + r) / CELL));
        const z0 = Math.max(0, Math.floor((h.z - r) / CELL));
        const z1 = Math.min(H - 1, Math.ceil((h.z + r) / CELL));
        for (let cz = z0; cz <= z1; cz++) {
          for (let cx = x0; cx <= x1; cx++) {
            const c = cellCenter(cx, cz);
            if (houseContains(h, c.x, c.z, 0)) houseCellIndex[cx + ',' + cz] = h;
          }
        }
      }
    }
  }

  function inAnyHouse(x, z, pad) {
    return !!houseAt(x, z, pad);
  }

  function houseAt(x, z, pad) {
    if (!houses.length) return null;
    if (!houseCellIndex) rebuildHouseCellIndex();
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const h = houseCellIndex[cx + ',' + cz];
    if (!h) return null;
    if (pad && !houseContains(h, x, z, pad)) return null;
    return h;
  }

  /* 屋顶显隐只需要判断“墙 / 门”是否挡住视线，不考虑木箱等可绕开的道具。
     用一次 rayWallHit 代替 sightBlocked 的重复墙检测，门洞采样也更精简。 */
  function wallSightBlocked(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return false;
    const hit = rayWallHit(x0, z0, dx / d, dz / d, d);
    return !!hit.axis && hit.d < d - 0.06;
  }

  function houseCanSeeInterior(h, px, pz) {
    const C = CFG.HOUSE;
    /* 门洞专用采样：从斜角看进去时，固定屋内采样点可能都被门框挡住，
       但门洞另一侧仍能看到屋内。沿整扇门宽、多个深度取样。 */
    for (let i = 0; i < h.doors.length; i++) {
      const d = h.doors[i];
      if (d.t <= 0.35) continue;
      const ix = -Math.sin(d.yaw), iz = -Math.cos(d.yaw); // 向内
      const rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);  // 沿门宽
      const half = C.DOOR_W * 0.5 - 0.06;
      const fracs = [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9];
      const depths = [0.2, 0.8, 1.7, 2.8];
      const maxDepth = d.maxDepth || 3.0;
      for (let fi = 0; fi < fracs.length; fi++) {
        for (let di = 0; di < depths.length; di++) {
          const depth = depths[di];
          if (depth > maxDepth) continue;
          const ox = fracs[fi] * half;
          const sx = d.x + rx * ox + ix * depth;
          const sz = d.z + rz * ox + iz * depth;
          if (!wallSightBlocked(px, pz, sx, sz)) return true;
        }
      }
    }
    /* 网格房屋已经有门洞专用采样；h.samples 里每格 5 个点会把屋内采样
       放大到几百上千次射线，纯属浪费。非网格老房子才需要全屋采样兜底。 */
    if (!h.grid) {
      for (let i = 0; i < h.samples.length; i++) {
        const s = h.samples[i];
        if (!wallSightBlocked(px, pz, s.x, s.z)) return true;
      }
    }
    return false;
  }

  /* 玩家视线中心（准星）沿地面方向命中的最近房屋。
     直接使用第一次墙体命中：命中房屋墙时，命中点已落在房屋轮廓内，
     再取该点的 houseAt 即可，避免每帧对所有房屋做射线采样。 */
  function aimedHouse(x0, z0, dx, dz, maxD) {
    if (!houses.length) return null;
    const hit = rayWallHit(x0, z0, dx, dz, maxD);
    if (!hit.axis || hit.axis !== 'house') return null;
    const d = Math.min(maxD, hit.d + 0.12);
    return houseAt(x0 + dx * d, z0 + dz * d, 0.05);
  }

  function updateHouses(dt, px, pz, aimX, aimZ, aimRange) {
    if (!houses.length) return;
    if (typeof ASSETS !== 'undefined' && ASSETS.house && ASSETS.house.ready &&
        typeof ASSETS.house.openAngle === 'number') {
      for (let i = 0; i < houses.length; i++) houses[i].openAngle = ASSETS.house.openAngle;
    }
    const C = CFG.HOUSE;
    const k = 1 - Math.exp(-9 * Math.max(0, Math.min(0.1, dt)));
    const aimHouse = (aimX !== undefined && aimZ !== undefined)
      ? aimedHouse(px, pz, aimX, aimZ, aimRange || CFG.VISION.RANGE)
      : null;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      let openMask = 0, openN = 0;
      for (let i = 0; i < h.doors.length; i++) {
        const door = h.doors[i];
        const target = door.open ? 1 : 0;
        door.t += (target - door.t) * k;
        if (Math.abs(target - door.t) < 0.002) door.t = target;
        door.angle = door.t * h.openAngle;
        if (door.t > 0.35) {
          openN++;
          if (i < 31) openMask |= (1 << i);
        }
      }
      const dist = houseDistance(h, px, pz);
      const range = C.ROOF_HIDE_DIST + (h.roofHidden ? 0.6 : 0);
      let see = false;
      if (dist <= range) {
        if (houseContains(h, px, pz, 0.02)) {
          see = true;
          h._seeValid = false;
        } else if (openN > 0) {
          /* 门后视线采样很贵：玩家原地不动且门状态不变时直接复用上一帧结果，
             移动超过 0.45m 或门开 / 关状态变化才重新计算。 */
          const moved = !h._seeValid ||
            Math.hypot(px - (h._seeX || 0), pz - (h._seeZ || 0)) > 0.45;
          const doorsChanged = h._seeMask !== openMask || h._seeOpenN !== openN;
          if (moved || doorsChanged) {
            h._seeInterior = houseCanSeeInterior(h, px, pz);
            h._seeX = px;
            h._seeZ = pz;
            h._seeMask = openMask;
            h._seeOpenN = openN;
            h._seeValid = true;
          }
          if (h._seeInterior) see = true;
        } else {
          h._seeValid = false;
        }
      } else {
        h._seeValid = false;
      }
      /* 准星指向房屋时也隐藏屋顶，允许隔着一段距离观察室内 */
      if (h === aimHouse) see = true;
      h.roofHidden = see;
    }
  }

  function nearestDoor(px, pz) {
    let best = null, bd = CFG.HOUSE.DOOR_INTERACT_R;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        const dist = Math.hypot(d.x - px, d.z - pz);
        if (dist < bd) { bd = dist; best = d; }
      }
    }
    return best;
  }

  function toggleDoor(door) {
    if (!door) return false;
    door.open = !door.open;
    return door.open;
  }

  /* AI 开门：幂等，只负责“打开”，永远不会把别人刚打开的门又关上。
     以前 AI 用 toggle 开门，两名队员在同一帧（或门还没转到位的那几十毫秒里）
     先后点同一扇门会互相抵消 —— 门最后是关的，整队顶着门板推。
     玩家交互仍然走 toggleDoor。 */
  function openDoor(door) {
    if (!door || door.open) return false;
    door.open = true;
    return true;
  }

  function doorOccupied(door, x, z, r) {
    if (!door) return false;
    return rectOverlap2(door.rect.x, door.rect.z, door.rect.yaw, door.rect.hx, door.rect.hz, x, z, r || 0.48);
  }

  /* 门关上后把卡在门里的单位推到门外。
     沿门的法线方向推开，并把横向位置收进门洞中央，避免推进门框。 */
  function resolveDoorTrap(x, z, r) {
    if (!houses.length) return null;
    r = r || 0.48;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      for (let i = 0; i < h.doors.length; i++) {
        const d = h.doors[i];
        if (!doorClosed(d)) continue;
        const rc = d.rect;
        if (!rectOverlap2(rc.x, rc.z, rc.yaw, rc.hx, rc.hz, x, z, r)) continue;

        const c = Math.cos(rc.yaw), s = Math.sin(rc.yaw);
        const dx = x - rc.x, dz = z - rc.z;
        const lx = c * dx - s * dz;
        const lz = s * dx + c * dz;
        const maxLx = Math.max(0, rc.hx - r - 0.08);
        const clx = Math.max(-maxLx, Math.min(maxLx, lx));
        const basePush = rc.hz + r + 0.08;
        const dirs = lz >= 0 ? [1, -1] : [-1, 1];
        for (let di = 0; di < dirs.length; di++) {
          const dir = dirs[di];
          const tries = [0, r * 0.6, r * 1.4, r * 2.2];
          for (let k = 0; k < tries.length; k++) {
            const nz = dir * (basePush + tries[k]);
            const nx = rc.x + c * clx + s * nz;
            const nzWorld = rc.z - s * clx + c * nz;
            if (!blocked(nx, nzWorld, r)) return { x: nx, z: nzWorld };
          }
        }
      }
    }
    return null;
  }

  function drawFallbackHouseStatic(geo, h) {
    const C = CFG.HOUSE;
    const P = PAL;
    const T = h.wallT;
    if (h.grid) {
      /* 没有 Blender 地板资产时，按矩形块画地板，绝不补成矩形外轮廓 */
      const rects = h.rects && h.rects.length ? h.rects : h.cells.map(function (c) {
        const p = cellCenter(c.cx, c.cz);
        return { x: p.x, z: p.z, w: 1, d: 1 };
      });
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        geo.box({
          x: r.x, y: 0.025, z: r.z,
          sx: r.w * CELL + 0.06, sy: 0.05, sz: r.d * CELL + 0.06,
          yaw: 0, color: [0.30, 0.21, 0.14], outline: 0
        });
      }
    } else {
      geo.box({
        x: h.x, y: 0.025, z: h.z,
        sx: h.halfW * 2 - T * 2, sy: 0.05, sz: h.halfD * 2 - T * 2,
        yaw: h.yaw, color: [0.30, 0.21, 0.14], outline: 0
      });
    }
    function drawWallGroup(list) {
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
        function put(ox, oz, y, sx, sy, sz, color, outline, shadow) {
          geo.box({
            x: m.cx + c * ox + s * oz, y: y, z: m.cz - s * ox + c * oz,
            sx: sx, sy: sy, sz: sz, yaw: m.yaw,
            color: color, outline: outline || 0, shadow: !!shadow
          });
        }
        if (m.type === 'door') {
          put(-0.84, 0, h.wallH * 0.5, 0.32, h.wallH, T, P.wall, 0.02, true);
          put( 0.84, 0, h.wallH * 0.5, 0.32, h.wallH, T, P.wall, 0.02, true);
          put(0, 0, (h.doorH + h.wallH) * 0.5, h.doorW, h.wallH - h.doorH, T, P.wall, 0.02, true);
        } else {
          put(0, 0, h.wallH * 0.5, C.MODULE, h.wallH, T, P.wall, 0.02, true);
        }
      }
    }
    drawWallGroup(h.modules);
    drawWallGroup(h.interiorModules);
    for (let i = 0; i < h.corners.length; i++) {
      const p = h.corners[i];
      geo.box({
        x: p.x, y: 1.40, z: p.z, sx: 0.24, sy: 2.80, sz: 0.24,
        yaw: h.yaw, color: P.steel, outline: 0.012, shadow: true
      });
    }
  }

  function drawFallbackDoor(geo, door) {
    const C = CFG.HOUSE;
    const total = door.yaw + door.angle;
    const half = C.DOOR_W * 0.5 - 0.01;
    geo.box({
      x: door.hingeX + Math.cos(total) * half,
      y: C.DOOR_H * 0.5,
      z: door.hingeZ - Math.sin(total) * half,
      sx: C.DOOR_W - 0.02, sy: C.DOOR_H, sz: C.DOOR_T,
      yaw: total, color: PAL.wood, outline: 0.016, shadow: true
    });
  }

  function drawHouseStatic(geo) {
    if (!houses.length) return;
    const A = (typeof ASSETS !== 'undefined') ? ASSETS.house : null;
    const C = CFG.HOUSE;
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      /* 整栋房屋的平涂落地阴影；自定义轮廓按格投影，避免 L 形空角也投出阴影 */
      const sy = h.wallH + 0.5;
      if (h.grid) {
        for (let ci = 0; ci < h.cells.length; ci++) {
          const cc = cellCenter(h.cells[ci].cx, h.cells[ci].cz);
          geo.box({
            x: cc.x, y: sy * 0.5, z: cc.z,
            sx: CELL + 0.7, sy: sy, sz: CELL + 0.7,
            yaw: 0, color: [0, 0, 0], outline: 0,
            castOnly: true, shadow: true
          });
        }
      } else {
        geo.box({
          x: h.x, y: sy * 0.5, z: h.z,
          sx: h.halfW * 2 + 0.7, sy: sy, sz: h.halfD * 2 + 0.7,
          yaw: h.yaw, color: [0, 0, 0], outline: 0,
          castOnly: true, shadow: true
        });
      }
      if (!A || !A.ready) {
        drawFallbackHouseStatic(geo, h);
        continue;
      }
      if (h.grid && h.rects.length) {
        /* 自定义房屋使用整块平涂地板：不铺 2m 瓷砖，因此没有格缝。
           地板颜色沿用房屋地板的深木色，轮廓由墙体勾勒。 */
        for (let i = 0; i < h.rects.length; i++) {
          const r = h.rects[i];
          geo.box({
            x: r.x, y: 0.025, z: r.z,
            sx: r.w * CELL + 0.04, sy: 0.05, sz: r.d * CELL + 0.04,
            yaw: 0, color: [0.31, 0.22, 0.15], outline: 0
          });
        }
      } else {
        for (let i = 0; i < h.floorCells.length; i++) {
          const cell = h.floorCells[i];
          geo.mesh(A.floor, { x: cell.x, y: 0, z: cell.z, yaw: cell.yaw });
        }
      }
      function drawWallGroup(list) {
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          const mesh = m.type === 'door' ? A.wallDoor : (m.type === 'window' ? A.wallWindow : A.wall);
          if (mesh) geo.mesh(mesh, { x: m.cx, y: 0, z: m.cz, yaw: m.yaw });
        }
      }
      drawWallGroup(h.modules);
      drawWallGroup(h.interiorModules);
      for (let i = 0; i < h.corners.length; i++) {
        const p = h.corners[i];
        geo.mesh(A.corner, { x: p.x, y: 0, z: p.z, yaw: h.yaw });
      }
    }
  }

  function drawFallbackRoof(geo, h) {
    const C = CFG.HOUSE;
    if (h.grid) {
      const rects = h.rects && h.rects.length ? h.rects :
        h.roofCells.map(function (c) { return { x: c.x, z: c.z, w: 1, d: 1 }; });
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        geo.box({
          x: r.x, y: C.ROOF_Y + 0.15, z: r.z,
          sx: r.w * CELL + 0.06, sy: 0.30, sz: r.d * CELL + 0.06,
          yaw: 0, color: [0.32, 0.34, 0.35], outline: 0.02, shadow: true
        });
      }
    } else {
      geo.box({
        x: h.x, y: C.ROOF_Y + 0.15, z: h.z,
        sx: h.halfW * 2 - 0.02, sy: 0.30, sz: h.halfD * 2 - 0.02,
        yaw: h.yaw, color: [0.32, 0.34, 0.35], outline: 0.02, shadow: true
      });
    }
    if (h.roofUnits.length) {
      const u = h.roofUnits[0];
      geo.box({
        x: u.x, y: C.ROOF_TOP + 0.22, z: u.z,
        sx: 1.3, sy: 0.44, sz: 1.0,
        yaw: u.yaw, color: [0.40, 0.43, 0.46], outline: 0.016, shadow: true
      });
    }
  }

  function drawHouseScene(geo, px, pz) {
    if (!houses.length) return;
    const A = (typeof ASSETS !== 'undefined') ? ASSETS.house : null;
    const C = CFG.HOUSE;
    const cull = (px !== undefined && pz !== undefined);
    for (let hi = 0; hi < houses.length; hi++) {
      const h = houses[hi];
      /* 远处房屋的门 / 屋顶不写动态几何；静态墙体和地板仍然保留。 */
      if (cull && houseDistance(h, px, pz) > 40) continue;
      for (let i = 0; i < h.doors.length; i++) {
        const door = h.doors[i];
        if (A && A.ready) {
          geo.mesh(A.door, { x: door.hingeX, y: 0, z: door.hingeZ, yaw: door.yaw + door.angle });
        } else {
          drawFallbackDoor(geo, door);
        }
      }
      if (h.roofHidden) continue;
      if (!A || !A.ready) {
        drawFallbackRoof(geo, h);
        continue;
      }
      if (h.grid && h.rects.length) {
        /* 自定义房屋使用整块屋顶板，避免每 2m 瓦片接缝 */
        for (let i = 0; i < h.rects.length; i++) {
          const r = h.rects[i];
          geo.box({
            x: r.x, y: C.ROOF_Y + 0.15, z: r.z,
            sx: r.w * CELL + 0.04, sy: 0.30, sz: r.d * CELL + 0.04,
            yaw: 0, color: [0.32, 0.34, 0.35], outline: 0, shadow: true
          });
        }
      } else {
        for (let i = 0; i < h.roofCells.length; i++) {
          const cell = h.roofCells[i];
          geo.mesh(A.roofTile, { x: cell.x, y: C.ROOF_Y, z: cell.z, yaw: cell.yaw });
        }
      }
      if (A.roofUnit) {
        for (let i = 0; i < h.roofUnits.length; i++) {
          const u = h.roofUnits[i];
          geo.mesh(A.roofUnit, { x: u.x, y: C.ROOF_TOP, z: u.z, yaw: u.yaw });
        }
      }
    }
  }

  function gen(seed) {
    rngState = (seed || 1234567) >>> 0 || 1;
    W = CFG.MAP_W; H = CFG.MAP_H;
    floor = new Uint8Array(W * H);
    rooms = []; props = []; loot = [];
    respawn = null; test = null;
    chests = []; houses = []; houseCellIndex = null; pathWallEdges = null; navWalk = null; pathCornerBlocked = null;
    pads = []; enemySpawns = []; customMap = false;
    spawnYaw = 0; floorPoints = []; mapId = ''; mapName = '';

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
    pad = { x: cl.x, z: cl.z, r: CFG.EXTRACT_R, hold: CFG.EXTRACT_HOLD };
    pads = [pad];
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (floor[idx(cx, cz)]) floorPoints.push(cellCenter(cx, cz));
      }
    }

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
    rebuildNavWalk();
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
    props = []; loot = []; respawn = null; test = null; chests = []; houses = []; houseCellIndex = null; pathWallEdges = null; navWalk = null; pathCornerBlocked = null;
    pads = []; enemySpawns = []; customMap = false;
    spawnYaw = 0; floorPoints = []; mapId = ''; mapName = '';

    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) floor[idx(x, z)] = 1;
    }
    /* 光学测试走廊：两堵竖墙，中间留 3 格宽 */
    for (let z = 3; z <= 9; z++) {
      floor[idx(16, z)] = 0;
      floor[idx(20, z)] = 0;
    }

    spawn = cellCenter(11, 20);
    pad = { x: cellCenter(20, 20).x, z: cellCenter(20, 20).z, r: CFG.EXTRACT_R, hold: CFG.EXTRACT_HOLD };
    pads = [pad];
    respawn = { x: 7, z: 42.5, r: CFG.EXTRACT_R };
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (floor[idx(cx, cz)]) floorPoints.push(cellCenter(cx, cz));
      }
    }
    /* 训练配装台：站在附近按 F 可切换训练场携带的武器 / 道具 */
    const loadoutPad = { x: cellCenter(14, 20).x, z: cellCenter(14, 20).z, r: 1.7 };

    /* 三栋模块化示例房：3×2 / 4×3 / 6×5 模块，门在任意外墙模块位。
       放在训练场南侧左右两翼，给中间留出通往北侧靶区的通道。
       改尺寸/门：makeHouse(x, z, yaw, wModules, dModules, doorList, id)，模块数 2–12。 */
    houses.push(makeHouse(7, 35, 0, 3, 2, [
      { side: 'front', index: 1 }
    ], 'small', [
      /* 6×4m 横向隔断，中间一扇内门 */
      { axis: 'x', line: 0, from: -3, to: 3, doors: [1] }
    ]));
    houses.push(makeHouse(16, 35, 0, 4, 3, [
      { side: 'front', index: 2 },
      { side: 'right', index: 1 }
    ], 'medium', [
      /* 8×6m 纵向隔断，中间一扇内门 */
      { axis: 'z', line: 0, from: -3, to: 3, doors: [1] }
    ]));
    houses.push(makeHouse(35, 30, 0, 6, 5, [
      { side: 'front', index: 1 },
      { side: 'front', index: 4 },
      { side: 'right', index: 2 }
    ], 'large', [
      /* 12×10m：一道纵向 + 一道横向隔断，三个房间 */
      { axis: 'z', line: 0, from: -5, to: 5, doors: [2] },
      { axis: 'x', line: 1, from: -6, to: 0, doors: [1] }
    ]));

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
    const chestCells = [[4, 15], [15, 19], [22, 19], [22, 10]];
    for (let ci = 0; ci < chestCells.length; ci++) {
      const c = cellCenter(chestCells[ci][0], chestCells[ci][1]);
      chests.push(makeChest(c.x, c.z, Math.atan2(spawn.x - c.x, spawn.z - c.z), 0.62));
    }
    const wc = cellCenter(18, 10);
    chests.push(makeWeaponCrate(wc.x, wc.z, Math.atan2(spawn.x - wc.x, spawn.z - wc.z), rnd));

    /* 5. 随机物资 */
    let guard = 0;
    while (loot.length < 12 && guard++ < 400) {
      const cx = ri(2, W - 3);
      const cz = ri(2, H - 3);
      if (!isFloor(cx, cz)) continue;
      const c = cellCenter(cx, cz);
      if (inAnyHouse(c.x, c.z, 0.9)) continue;
      if (Math.hypot(c.x - spawn.x, c.z - spawn.z) < 3) continue;
      if (Math.hypot(c.x - pad.x, c.z - pad.z) < pad.r + 1) continue;
      if (Math.hypot(c.x - respawn.x, c.z - respawn.z) < respawn.r + 1) continue;
      if (Math.hypot(c.x - loadoutPad.x, c.z - loadoutPad.z) < loadoutPad.r + 1.2) continue;
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

    test = { respawn: respawn, spawns: spawns, extractHold: 2.0, loadout: loadoutPad };
    rebuildPathWallEdges();
    rebuildNavWalk();
    return api;
  }

  /* ---------- 自定义地图 ----------
     地图数据由 js/mapstore.js 规范化：
     - floor：每行字符串，'1' 可通行 / '0' 墙体
     - houses：格子轮廓 + 外门 + 内墙
     - 其余为世界坐标（米）的箱子 / 物资点 / 刷怪点 / 出生点 / 撤离点
  */
  function loadMap(map, seed) {
    rngState = (seed || 1234567) >>> 0 || 1;
    W = Math.max(8, map.cols | 0);
    H = Math.max(8, map.rows | 0);
    floor = new Uint8Array(W * H);
    rooms = []; props = []; loot = []; chests = []; houses = []; houseCellIndex = null; pathWallEdges = null; navWalk = null; pathCornerBlocked = null;
    pads = []; enemySpawns = []; respawn = null; test = null;
    customMap = true;
    spawnYaw = 0;
    floorPoints = [];
    mapId = map.id || '';
    mapName = map.name || '';

    for (let cz = 0; cz < H; cz++) {
      const row = map.floor[cz] || '';
      for (let cx = 0; cx < W; cx++) {
        if (row.charAt(cx) === '1') {
          floor[idx(cx, cz)] = 1;
          floorPoints.push(cellCenter(cx, cz));
        }
      }
    }

    (map.houses || []).forEach(function (spec) {
      const h = makeGridHouse(spec);
      if (h) houses.push(h);
    });

    (map.props || []).forEach(function (p) {
      if (!p) return;
      const kind = p.kind === 'barrel' ? 'barrel' : 'crate';
      props.push({
        x: +p.x, z: +p.z, kind: kind,
        rot: isFinite(p.rot) ? +p.rot : 0,
        h: isFinite(p.h) ? +p.h : (kind === 'crate' ? 1.1 : 0.8),
        cr: isFinite(p.cr) ? +p.cr : (kind === 'crate' ? 0.72 : 0.45)
      });
    });

    (map.chests || []).forEach(function (p) {
      if (!p) return;
      const luck = clampNum(p.luck, 0, 1, 0.5);
      if (p.type === 'weapon') {
        chests.push(makeWeaponCrate(p.x, p.z, isFinite(p.yaw) ? +p.yaw : 0, rnd));
      } else {
        chests.push(makeChest(p.x, p.z, isFinite(p.yaw) ? +p.yaw : 0, luck));
      }
    });

    (map.loot || []).forEach(function (p) {
      if (!p) return;
      const luck = clampNum(p.luck, 0, 1, 0.5);
      const tier = ITEMS.pickTier(rnd, luck);
      const item = ITEMS.rollForTier(tier, rnd);
      loot.push({
        x: +p.x, z: +p.z,
        kind: (p.kind === 'case' || p.kind === 'canister')
          ? p.kind : (rnd() < 0.7 ? 'case' : 'canister'),
        taken: false,
        tier: tier.id,
        item: item
      });
    });

    /* 玩家出生点：取第一个；没有时退回地图中心附近 */
    const spawns = (map.playerSpawns || []).filter(function (p) {
      return p && isFinite(p.x) && isFinite(p.z);
    });
    if (spawns.length) {
      spawn = { x: +spawns[0].x, z: +spawns[0].z };
      spawnYaw = isFinite(spawns[0].yaw) ? +spawns[0].yaw : 0;
    } else {
      let best = null;
      for (let i = 0; i < floorPoints.length; i++) {
        const p = floorPoints[i];
        if (!best || Math.hypot(p.x - W * CELL * 0.5, p.z - H * CELL * 0.5) <
            Math.hypot(best.x - W * CELL * 0.5, best.z - H * CELL * 0.5)) best = p;
      }
      spawn = best || { x: W * CELL * 0.5, z: H * CELL * 0.5 };
      spawnYaw = 0;
    }

    (map.extractions || []).forEach(function (p) {
      if (!p) return;
      pads.push({
        x: +p.x, z: +p.z,
        r: clampNum(p.r, 1.5, 8, CFG.EXTRACT_R),
        hold: clampNum(p.hold, 1, 20, CFG.EXTRACT_HOLD)
      });
    });
    if (!pads.length) {
      /* 校验会拦住没有撤离点的地图；这里给一个兜底，避免直接试玩时报错 */
      let far = null, fd = -1;
      for (let i = 0; i < floorPoints.length; i++) {
        const d = Math.hypot(floorPoints[i].x - spawn.x, floorPoints[i].z - spawn.z);
        if (d > fd) { fd = d; far = floorPoints[i]; }
      }
      pad = {
        x: far ? far.x : spawn.x, z: far ? far.z : spawn.z,
        r: CFG.EXTRACT_R, hold: CFG.EXTRACT_HOLD
      };
      pads = [pad];
    } else {
      pad = pads[0];
    }

    (map.enemies || []).forEach(function (p) {
      if (!p) return;
      enemySpawns.push({
        x: +p.x, z: +p.z,
        type: String(p.type || 'zombie'),
        count: clampNum(p.count, 1, 40, 1) | 0,
        radius: clampNum(p.radius, 0, 24, 4),
        faction: (p.faction === 'scav' || p.faction === 'undead') ? p.faction : ''
      });
    });
    rebuildPathWallEdges();
    rebuildNavWalk();
    return api;
  }

  function clampNum(v, a, b, def) {
    const n = +v;
    if (!isFinite(n)) return def;
    return n < a ? a : (n > b ? b : n);
  }

  /* ---------- 静态几何 ---------- */
  function buildStatic(geo) {
    const P = PAL;
    /* 勾缝底面 */
    geo.plane({
      x: W * CELL * 0.5, y: 0, z: H * CELL * 0.5,
      sx: W * CELL + 8, sz: H * CELL + 8, color: P.grout
    });

    /* 地砖：每格一块，亮度轻微抖动。
       房屋格由模块化地板覆盖，跳过底层地砖，避免从地板缝隙里透出 2m 网格。 */
    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (!isFloor(cx, cz)) continue;
        const c = cellCenter(cx, cz);
        if (inAnyHouse(c.x, c.z, 0)) continue;
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
    if (test && test.loadout) drawLoadoutPad(geo, test.loadout);

    /* 模块化安全屋：地板 / 墙 / 角柱进静态几何；屋顶和门是动态场景几何 */
    drawHouseStatic(geo);
    return geo;
  }

  /* 训练配装台：地面平台 + 操作台 + 悬浮全息块 */
  function drawLoadoutPad(geo, p) {
    const cyan = [0.56, 0.90, 0.96];
    geo.plane({ x: p.x, y: 0.035, z: p.z, sx: 2.7, sz: 2.7, color: [0.12, 0.19, 0.21] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      geo.box({
        x: p.x + Math.cos(a) * (p.r - 0.25), y: 0.055, z: p.z + Math.sin(a) * (p.r - 0.25),
        sx: 0.38, sy: 0.05, sz: 0.38, yaw: a, color: cyan, outline: 0, emis: true
      });
    }
    /* 操作台放在平台外侧，玩家站到平台中央即可按 F */
    const cx = p.x, cz = p.z - 1.05;
    geo.box({ x: cx, y: 0.44, z: cz, sx: 1.05, sy: 0.88, sz: 0.52, yaw: 0, color: [0.16, 0.24, 0.25], outline: 0.018, shadow: true });
    geo.box({ x: cx, y: 0.93, z: cz, sx: 0.92, sy: 0.10, sz: 0.44, yaw: 0, color: cyan, outline: 0.012 });
    geo.box({ x: cx, y: 1.02, z: cz - 0.02, sx: 0.72, sy: 0.34, sz: 0.06, yaw: 0, color: [0.08, 0.20, 0.23], outline: 0.010 });
    geo.box({ x: cx, y: 1.02, z: cz - 0.06, sx: 0.58, sy: 0.16, sz: 0.02, yaw: 0, color: cyan, outline: 0, emis: true });
    const bob = Math.sin((typeof performance !== 'undefined' ? performance.now() : 0) * 0.002) * 0.06;
    geo.box({ x: cx, y: 1.55 + bob, z: p.z, sx: 0.26, sy: 0.26, sz: 0.26, yaw: 0.6, color: cyan, outline: 0, emis: true });
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
    return rectOverlap2(cx, cz, yaw, h, h, x, z, r);
  }

  function rectOverlap2(cx, cz, yaw, hx, hz, x, z, r) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = x - cx, dz = z - cz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    const qx = lx < -hx ? -hx : (lx > hx ? hx : lx);
    const qz = lz < -hz ? -hz : (lz > hz ? hz : lz);
    const ex = lx - qx, ez = lz - qz;
    return ex * ex + ez * ez <= r * r + 1e-9;
  }

  function propOverlap(p, x, z, r) {
    return rectOverlap(p.x, p.z, p.rot, propHalf(p), x, z, r);
  }

  function blocked(x, z, r, passDoors) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = Math.floor((x + dx * r) / CELL);
        const cz = Math.floor((z + dz * r) / CELL);
        if (!isFloor(cx, cz)) return true;
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
    if (houseBlocked(x, z, r, passDoors)) return true;
    return false;
  }

  /* 平滑移动：撞到障碍时沿墙/圆形障碍的切向滑动，而不是硬停。
     分小步推进，优先整步，其次单轴滑动，再尝试圆形障碍切线和角度偏转。 */
  /* 子弹障碍：墙体 + 不可互动的场景道具；物资箱/武器箱/尸体不挡子弹 */
  function bulletBlocked(x, z) {
    if (!isFloor(Math.floor(x / CELL), Math.floor(z / CELL))) return true;
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (propOverlap(p, x, z, 0)) return true;
    }
    if (houseBlocked(x, z, 0)) return true;
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

  function moveCircle(x, z, dx, dz, r, passDoors) {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return { x: x, z: z };
    /* 如果单位已经被挤进墙体 / 门框里，小步移动会一直判定为 blocked，
       永远出不来。先用稍大的半径搜索最近的可站立点，把自己推出去。 */
    if (blocked(x, z, r, passDoors)) {
      let best = null, bd = Infinity;
      for (let rad = 0.15; rad <= 1.2 && !best; rad += 0.15) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const nx = x + Math.cos(a) * rad;
          const nz = z + Math.sin(a) * rad;
          if (blocked(nx, nz, r, passDoors)) continue;
          const d = Math.hypot(nx - x, nz - z);
          if (d < bd) { bd = d; best = { x: nx, z: nz }; }
        }
      }
      if (best) { x = best.x; z = best.z; }
    }
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
        if (!blocked(cx + t[0], cz + t[1], r, passDoors)) {
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
        if (!blocked(cx + ax, cz + az, r, passDoors)) {
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
        if (!blocked(cx + t[0], cz + t[1], r, passDoors)) {
          cx += t[0]; cz += t[1];
          return true;
        }
      }
      return false;
    }

    for (let i = 0; i < steps; i++) {
      if (!blocked(cx + sx, cz + sz, r, passDoors)) {
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
          if (Math.hypot(tx, tz) > stepLen * 0.3 && !blocked(cx + tx, cz + tz, r, passDoors)) {
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
  function rayGridWallHit(x0, z0, dx, dz, maxD) {
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

  function rayWallHit(x0, z0, dx, dz, maxD) {
    const grid = rayGridWallHit(x0, z0, dx, dz, maxD);
    const hh = houseRayHit(x0, z0, dx, dz, maxD);
    if (hh && hh.d < grid.d - 1e-6) {
      return { d: hh.d, axis: 'house', nx: hh.nx, nz: hh.nz };
    }
    return grid;
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
    /* los() 已经通过 rayWallHit 覆盖了网格墙、房屋墙和关闭的门；
       这里不再重复跑一遍 houseSegmentBlocked。 */
    return false;
  }

  /* 2m 网格 A*：给 AI 提供绕墙路径。
     opts.blockHouseIds = { houseId: true } 时，这些房屋格不可通行。 */
  function findPath(x0, z0, x1, z1, opts) {
    opts = opts || {};
    const a = worldToCell(x0, z0), b = worldToCell(x1, z1);
    if (!inside(a.cx, a.cz) || !inside(b.cx, b.cz)) return null;
    if (!isFloor(b.cx, b.cz)) {
      /* 目标点贴着墙 / 门框时，2m 网格中心可能不是地板：
         向周围找最近的可行走格，避免整条路径直接失败导致 AI 原地等待。 */
      let fx = 0, fz = 0, fd = Infinity;
      for (let r = 1; r <= 4; r++) {
        for (let ox = -r; ox <= r; ox++) {
          for (let oz = -r; oz <= r; oz++) {
            if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
            if (!isFloor(b.cx + ox, b.cz + oz)) continue;
            const dd = ox * ox + oz * oz;
            if (dd < fd) { fd = dd; fx = ox; fz = oz; }
          }
        }
        if (fd < Infinity) break;
      }
      if (fd === Infinity) return null;
      b.cx += fx; b.cz += fz;
    }
    const block = opts.blockHouseIds || null;
    const maxNodes = opts.maxNodes || 1300;
    const total = W * H;
    if (pathCap < total) {
      pathCap = total;
      pathG = new Float32Array(total);
      pathF = new Float32Array(total);
      pathParent = new Int32Array(total);
      pathClosed = new Uint8Array(total);
      pathInOpen = new Uint8Array(total);
    }
    const g = pathG, f = pathF, parent = pathParent, closed = pathClosed, inOpen = pathInOpen;
    g.fill(Infinity);
    parent.fill(-1);
    closed.fill(0);
    inOpen.fill(0);
    const start = idx(a.cx, a.cz), goal = idx(b.cx, b.cz);
    const hfn = function (cx, cz) {
      const dx = Math.abs(cx - b.cx), dz = Math.abs(cz - b.cz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const walkable = function (cx, cz) {
      if (!isFloor(cx, cz)) return false;
      /* 木箱 / 设备 / 物资箱附近的格子不可走；目标格本身允许进入，
         这样单位可以走到障碍旁再靠最终接近 / 交互判定处理。 */
      if (navWalk && navWalk[idx(cx, cz)] === 0 && idx(cx, cz) !== goal) return false;
      if (block) {
        const c = cellCenter(cx, cz);
        const h = houseAt(c.x, c.z, 0.01);
        if (h && block[h.id || 'house']) return false;
      }
      return true;
    };
    const open = pathOpen;
    open.length = 0;
    open.push(start);
    inOpen[start] = 1;
    g[start] = 0;
    f[start] = hfn(a.cx, a.cz);
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
    ];
    let found = false;
    for (let guard = 0; guard < maxNodes && open.length; guard++) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (f[open[i]] < f[open[bi]]) bi = i;
      }
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      inOpen[cur] = 0;
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let di = 0; di < dirs.length; di++) {
        const d = dirs[di];
        const nx = cx + d[0], nz = cz + d[1];
        if (!inside(nx, nz) || !walkable(nx, nz)) continue;
        if (d[0] && d[1] && (!walkable(cx + d[0], cz) || !walkable(cx, cz + d[1]))) continue;
        /* 预计算的房屋墙体边表：A* 不能从墙格边穿过去，门洞中点仍然可通行。 */
        if (d[0] && d[1]) {
          if (pathEdgeBlocked(cx, cz, cx + d[0], cz) ||
              pathEdgeBlocked(cx, cz, cx, cz + d[1])) continue;
          /* 斜线本身也要检查墙体 / 门框，避免从门角斜穿过去 */
          if (pathCornerIsBlocked(cx, cz, nx, nz)) continue;
        } else if (pathEdgeBlocked(cx, cz, nx, nz)) {
          continue;
        }
        const ni = idx(nx, nz);
        if (closed[ni]) continue;
        const ng = g[cur] + d[2];
        if (ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = cur;
          f[ni] = ng + hfn(nx, nz);
          if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    let cur = goal;
    for (let guard = 0; guard < total && cur >= 0; guard++) {
      const cx = cur % W, cz = (cur / W) | 0;
      if (cur !== start) cells.push(cellCenter(cx, cz));
      cur = parent[cur];
    }
    cells.reverse();
    return cells;
  }

  function randomFloorPoint(minDistFrom, minDist) {
    /* 自定义地图没有 room 结构，直接从地板点里挑 */
    if (customMap && floorPoints.length) {
      for (let i = 0; i < 400; i++) {
        const c = floorPoints[Math.floor(rnd() * floorPoints.length)];
        if (minDistFrom && Math.hypot(c.x - minDistFrom.x, c.z - minDistFrom.z) < minDist) continue;
        return c;
      }
      return floorPoints[Math.floor(rnd() * floorPoints.length)];
    }
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
    loadMap: loadMap,
    buildStatic: buildStatic,
    isFloor: isFloor,
    isFloorAt: isFloorAt,
    solidAtCell: solidAtCell,
    worldToCell: worldToCell,
    cellCenter: cellCenter,
    blocked: blocked,
    moveLineBlocked: moveLineBlocked,
    bulletBlocked: bulletBlocked,
    nearWall: nearWall,
    moveCircle: moveCircle,
    rayWall: rayWall,
    rayWallHit: rayWallHit,
    los: los,
    sightBlocked: sightBlocked,
    findPath: findPath,
    randomFloorPoint: randomFloorPoint,
    updateHouses: updateHouses,
    nearestDoor: nearestDoor,
    toggleDoor: toggleDoor,
    openDoor: openDoor,
    isDoorClosed: doorClosed,
    doorOccupied: doorOccupied,
    resolveDoorTrap: resolveDoorTrap,
    drawHouseScene: drawHouseScene,
    inAnyHouse: inAnyHouse,
    houseAt: houseAt,
    houseDistance: houseDistance,
    get houses() { return houses; },
    get W() { return W; },
    get H() { return H; },
    get rooms() { return rooms; },
    get spawn() { return spawn; },
    get spawnYaw() { return spawnYaw; },
    get pad() { return pad; },
    get pads() { return pads; },
    get respawn() { return respawn; },
    get test() { return test; },
    get props() { return props; },
    get loot() { return loot; },
    get chests() { return chests; },
    get enemySpawns() { return enemySpawns; },
    get customMap() { return customMap; },
    get mapId() { return mapId; },
    get mapName() { return mapName; }
  };
  return api;
})();
