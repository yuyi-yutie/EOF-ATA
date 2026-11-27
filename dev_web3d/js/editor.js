'use strict';

/* ============================================================
   EOFATA 地图编辑器
   - 2m 网格俯视画布，所有坐标直接对应游戏世界（米）
   - 房屋可在网格上画成任意 L / T / 凹形，再放内墙和内门
   - 数据保存在 localStorage，也可导入 / 导出 JSON
   ============================================================ */

const Editor = (function () {
  const CELL = (typeof CFG !== 'undefined' && CFG.CELL) ? CFG.CELL : 2.0;
  const DOOR_W = (typeof CFG !== 'undefined' && CFG.HOUSE) ? CFG.HOUSE.DOOR_W : 1.36;
  const WALL_T = (typeof CFG !== 'undefined' && CFG.HOUSE) ? CFG.HOUSE.WALL_T : 0.26;
  const DIRS = MAPSTORE.DIRS;
  const DIR_KEYS = MAPSTORE.DIR_KEYS;

  const ENEMY_TYPES = {
    zombie: { name: '僵尸', color: '#c8573f' },
    spitter: { name: '喷吐僵尸', color: '#8fbf5a' },
    gaunt: { name: '干尸', color: '#b8a06a' },
    scav: { name: '拾荒者（随机皮肤）', color: '#d2814a' },
    squad: { name: '清剿小队（4人）', color: '#6fd8ef' }
  };

  const TOOLS = [
    { id: 'select', key: 'V', name: '选择', icon: '↖', hint: '点击选择物体；拖动移动；Delete 删除；Ctrl+D 复制' },
    { id: 'pan', key: '空格', name: '平移', icon: '✋', hint: '拖动平移画布；任意工具下按住空格 / 中键也可以平移' },
    { sep: true },
    { id: 'floor', key: 'G', name: '地板', icon: '▦', hint: '拖拽绘制可通行地板；笔刷 1 / 3 / 5 格可在右侧切换' },
    { id: 'wall', key: 'X', name: '墙体', icon: '▩', hint: '拖拽绘制实心墙体 / 空地；覆盖房屋格会把它从房屋中移除' },
    { id: 'house', key: 'H', name: '房屋', icon: '⌂', hint: '在网格上拖拽画房屋轮廓；相邻格会并入当前房屋，Esc 结束当前房屋' },
    { id: 'partition', key: 'P', name: '内墙', icon: '┃', hint: '在房屋内部相邻两格之间画隔墙；右键擦除' },
    { id: 'door', key: 'D', name: '门', icon: '◫', hint: '点击外墙 / 内墙切换门；右键移除门' },
    { sep: true },
    { id: 'supply', key: '1', name: '物资箱', icon: '▣', hint: '点击放置物资箱；拖动移动' },
    { id: 'weapon', key: '2', name: '武器箱', icon: '▤', hint: '点击放置武器箱；拖动移动' },
    { id: 'loot', key: '3', name: '露天物资', icon: '◆', hint: '点击放置露天物资刷新点；右侧可调品质倾向' },
    { id: 'enemy', key: '4', name: '敌人', icon: '☠', hint: '点击放置敌人刷新点；右侧可调类型 / 数量 / 半径' },
    { id: 'player', key: '5', name: '玩家出生', icon: '➤', hint: '点击放置玩家出生点；右侧可调朝向' },
    { id: 'extract', key: '6', name: '撤离点', icon: '◎', hint: '点击放置撤离点；右侧可调半径 / 停留时间' },
    { id: 'prop', key: '7', name: '障碍物', icon: '▧', hint: '点击放置木箱 / 油桶；参与移动、子弹与 AI 视线遮挡' },
    { sep: true },
    { id: 'erase', key: 'E', name: '擦除', icon: '⌫', hint: '点击删除物体、门、内墙或房屋格；点墙体格会恢复成地板。地板不会自动变成墙。' }
  ];

  const LAYERS = [
    { id: 'floor', name: '地板 / 墙体', on: true },
    { id: 'grid', name: '网格', on: true },
    { id: 'houses', name: '房屋与门', on: true },
    { id: 'props', name: '障碍物', on: true },
    { id: 'chests', name: '物资箱 / 武器箱', on: true },
    { id: 'loot', name: '露天物资点', on: true },
    { id: 'enemies', name: '敌人刷新点', on: true },
    { id: 'spawns', name: '出生点 / 撤离点', on: true },
    { id: 'labels', name: '文字标签', on: true }
  ];

  let canvas = null, ctx = null;
  let map = null;
  let view = { x: 0, z: 0, scale: 14 };
  let tool = 'select';
  let selection = null;
  let activeHouse = null;
  let drag = null;
  let hover = null;
  let mouseWorld = { x: 0, z: 0 };
  let spaceDown = false;
  let brush = 1;
  let propKind = 'crate';
  let snap = 0.5;
  let dirty = false;
  let history = [];
  let future = [];
  let saveTimer = 0;
  let toastTimer = 0;
  let invalidRefs = new Set();
  let warnRefs = new Set();
  let ownerCache = null;
  let layersOn = {};
  let needsFit = true;
  let lastValidation = { errors: [], warnings: [], issues: [] };

  const el = {};

  /* ================= 基础工具 ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function canvasSize() {
    return { w: canvas.clientWidth, h: canvas.clientHeight };
  }
  function w2s(x, z) {
    return { x: (x - view.x) * view.scale, y: (z - view.z) * view.scale };
  }
  function s2w(px, py) {
    return { x: px / view.scale + view.x, z: py / view.scale + view.z };
  }
  function cellAt(w) {
    return { cx: Math.floor(w.x / CELL), cz: Math.floor(w.z / CELL) };
  }
  function cellCenter(cx, cz) {
    return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
  }
  function keyOf(cx, cz) { return cx + ',' + cz; }
  function snapVal(v, free) {
    const s = free ? 0.1 : snap;
    return Math.round(v / s) * s;
  }
  function fmt1(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  function toast(text, type) {
    const n = el.toast;
    if (!n) return;
    n.textContent = text;
    n.className = 'ed-toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove('show'); }, 2200);
  }

  function pushHistory() {
    if (!map) return;
    try {
      history.push(JSON.stringify(map));
      if (history.length > 90) history.shift();
      future.length = 0;
    } catch (e) {}
  }

  function undo() {
    if (!history.length) return;
    try {
      future.push(JSON.stringify(map));
      map = MAPSTORE.normalize(JSON.parse(history.pop()));
      selection = null;
      activeHouse = null;
      afterMapReplaced();
    } catch (e) {
      toast('撤销失败', 'warn');
    }
  }

  function redo() {
    if (!future.length) return;
    try {
      history.push(JSON.stringify(map));
      map = MAPSTORE.normalize(JSON.parse(future.pop()));
      selection = null;
      activeHouse = null;
      afterMapReplaced();
    } catch (e) {
      toast('重做失败', 'warn');
    }
  }

  function afterMapReplaced() {
    el.name.value = map.name;
    invalidateOwners();
    dirty = true;
    selection = null;
    activeHouse = null;
    renderInspector();
    updateValidation();
    updateStatus();
    scheduleSave();
  }

  /* ================= 房屋 / 网格辅助 ================= */
  function invalidateOwners() { ownerCache = null; }

  function ownerMap() {
    if (ownerCache) return ownerCache;
    const owners = {};
    map.houses.forEach(function (h) {
      MAPSTORE.houseCells(h).forEach(function (c) {
        owners[keyOf(c.cx, c.cz)] = h;
      });
    });
    ownerCache = owners;
    return owners;
  }

  function houseHasCell(h, cx, cz) {
    return MAPSTORE.houseHasCell(h, cx, cz);
  }

  function createHouse(cx, cz) {
    const h = {
      id: MAPSTORE.uid('h'),
      name: '房屋 ' + (map.houses.length + 1),
      cells: [],
      doors: [],
      partitions: []
    };
    map.houses.push(h);
    activeHouse = h;
    addHouseCell(h, cx, cz);
    return h;
  }

  function houseAdjacentToCell(h, cx, cz) {
    for (let i = 0; i < DIR_KEYS.length; i++) {
      const d = DIRS[DIR_KEYS[i]];
      if (houseHasCell(h, cx + d.dx, cz + d.dz)) return true;
    }
    return false;
  }

  function addHouseCell(h, cx, cz) {
    if (!h || !MAPSTORE.inBounds(map, cx, cz)) return false;
    if (houseHasCell(h, cx, cz)) return false;
    const owners = ownerMap();
    if (owners[keyOf(cx, cz)]) return false;
    h.cells.push([cx, cz]);
    MAPSTORE.setCellValue(map, cx, cz, 1);
    invalidateOwners();
    return true;
  }

  function pruneHouseEdges(h, cx, cz) {
    if (!h) return;
    h.doors = (h.doors || []).filter(function (d) {
      return !(d.cx === cx && d.cz === cz);
    });
    h.partitions = (h.partitions || []).filter(function (p) {
      if (p.cx === cx && p.cz === cz) return false;
      const n = DIRS[p.dir];
      if (p.cx + n.dx === cx && p.cz + n.dz === cz) return false;
      return true;
    });
  }

  function removeHouseCell(h, cx, cz) {
    if (!h) return;
    let at = -1;
    for (let i = 0; i < h.cells.length; i++) {
      const c = h.cells[i];
      if ((Array.isArray(c) ? c[0] : c.cx) === cx &&
          (Array.isArray(c) ? c[1] : c.cz) === cz) { at = i; break; }
    }
    if (at < 0) return;
    h.cells.splice(at, 1);
    invalidateOwners();
    /* 只改变房屋轮廓，不自动把缺口变成墙；地形由设计师用墙体 / 地板笔刷决定。 */
    pruneHouseEdges(h, cx, cz);
    if (!h.cells.length) {
      const hi = map.houses.indexOf(h);
      if (hi >= 0) map.houses.splice(hi, 1);
      if (activeHouse === h) activeHouse = null;
      if (selection && selection.ref === h) selection = null;
    }
  }

  function deleteHouse(h) {
    const at = map.houses.indexOf(h);
    if (at >= 0) map.houses.splice(at, 1);
    invalidateOwners();
    if (activeHouse === h) activeHouse = null;
    if (selection && selection.ref === h) selection = null;
  }

  /* 找到光标附近的房屋边：返回 house / cell / dir / interior */
  function houseEdgeAt(w) {
    const c = cellAt(w);
    const owners = ownerMap();
    const h = owners[keyOf(c.cx, c.cz)];
    if (!h) return null;
    const center = cellCenter(c.cx, c.cz);
    const lx = w.x - center.x, lz = w.z - center.z;
    const cand = [
      { dir: 'front', d: CELL * 0.5 - lz },
      { dir: 'back', d: CELL * 0.5 + lz },
      { dir: 'right', d: CELL * 0.5 - lx },
      { dir: 'left', d: CELL * 0.5 + lx }
    ];
    cand.sort(function (a, b) { return a.d - b.d; });
    const best = cand[0];
    if (!best || best.d < 0 || best.d > Math.min(1.2, Math.max(0.5, 9 / view.scale))) return null;
    const n = DIRS[best.dir];
    const neighbor = owners[keyOf(c.cx + n.dx, c.cz + n.dz)];
    if (neighbor && neighbor !== h) return null;
    return {
      house: h,
      cx: c.cx, cz: c.cz, dir: best.dir,
      interior: neighbor === h
    };
  }

  function edgeLine(e) {
    const d = DIRS[e.dir];
    const center = cellCenter(e.cx, e.cz);
    const mx = center.x + d.nx * CELL * 0.5;
    const mz = center.z + d.nz * CELL * 0.5;
    const tx = Math.cos(d.yaw) * CELL * 0.5;
    const tz = -Math.sin(d.yaw) * CELL * 0.5;
    return { x1: mx - tx, z1: mz - tz, x2: mx + tx, z2: mz + tz };
  }

  /* ================= 画布交互 ================= */
  function eventWorld(e) {
    const r = canvas.getBoundingClientRect();
    return s2w(e.clientX - r.left, e.clientY - r.top);
  }

  function pickAt(w) {
    const th = Math.max(0.55, 9 / view.scale);
    let best = null, bd = th;
    function test(list, kind) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const d = Math.hypot(o.x - w.x, o.z - w.z);
        if (d < bd) { bd = d; best = { kind: kind, ref: o }; }
      }
    }
    test(map.playerSpawns, 'player');
    test(map.extractions, 'extraction');
    test(map.enemies, 'enemy');
    test(map.loot, 'loot');
    test(map.chests, 'chest');
    test(map.props, 'prop');
    if (best) return best;
    const c = cellAt(w);
    const owners = ownerMap();
    const h = owners[keyOf(c.cx, c.cz)];
    if (h) return { kind: 'house', ref: h, cell: c };
    return null;
  }

  function selectTool(id) {
    tool = id;
    drag = null;
    document.body.classList.remove('tool-select', 'tool-pan', 'tool-floor', 'tool-wall',
      'tool-house', 'tool-partition', 'tool-door', 'tool-erase', 'tool-point');
    document.body.classList.add('tool-' + id);
    const list = el.tools.querySelectorAll('.ed-tool');
    for (let i = 0; i < list.length; i++) {
      list[i].classList.toggle('on', list[i].dataset.tool === id);
    }
    updateHint();
    updateStatus();
    renderInspector();
  }

  function brushCells(cx, cz) {
    const half = Math.floor((brush - 1) * 0.5);
    const out = [];
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) out.push({ cx: cx + dx, cz: cz + dz });
    }
    return out;
  }

  function applyFloor(cell) {
    if (!MAPSTORE.inBounds(map, cell.cx, cell.cz)) return;
    MAPSTORE.setCellValue(map, cell.cx, cell.cz, 1);
  }

  function applyWall(cell) {
    if (!MAPSTORE.inBounds(map, cell.cx, cell.cz)) return;
    const owners = ownerMap();
    const h = owners[keyOf(cell.cx, cell.cz)];
    if (h) removeHouseCell(h, cell.cx, cell.cz);
    MAPSTORE.setCellValue(map, cell.cx, cell.cz, 0);
  }

  function paintAt(kind, w, e) {
    const c = cellAt(w);
    if (kind === 'floor' || kind === 'wall') {
      brushCells(c.cx, c.cz).forEach(function (cc) {
        if (kind === 'floor') applyFloor(cc); else applyWall(cc);
      });
    } else if (kind === 'house') {
      if (!MAPSTORE.inBounds(map, c.cx, c.cz)) return;
      if (!drag.house) {
        const owners = ownerMap();
        let h = owners[keyOf(c.cx, c.cz)];
        if (!h) {
          /* 只有点在与当前房屋相邻的格子上才继续扩建，否则新开一栋 */
          if (activeHouse && houseAdjacentToCell(activeHouse, c.cx, c.cz)) h = activeHouse;
          else h = createHouse(c.cx, c.cz);
        }
        drag.house = h;
      }
      if (drag.house) {
        addHouseCell(drag.house, c.cx, c.cz);
        selection = { kind: 'house', ref: drag.house };
        activeHouse = drag.house;
      }
    }
    markDirty();
  }

  function lineCells(a, b) {
    const out = [];
    let x0 = a.cx, z0 = a.cz, x1 = b.cx, z1 = b.cz;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (let guard = 0; guard < 400; guard++) {
      out.push({ cx: x0, cz: z0 });
      if (x0 === x1 && z0 === z1) break;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
    return out;
  }

  function applyPartitionAt(w) {
    const e = houseEdgeAt(w);
    if (!e || !e.interior) return;
    const c = MAPSTORE.canonicalEdge(e.cx, e.cz, e.dir);
    if (MAPSTORE.partitionAt(e.house, c.cx, c.cz, c.dir)) return;
    e.house.partitions.push({ cx: c.cx, cz: c.cz, dir: c.dir, door: false });
    selection = { kind: 'house', ref: e.house };
    markDirty();
  }

  function toggleDoorAt(w) {
    const e = houseEdgeAt(w);
    if (!e) return;
    if (e.interior) {
      const c = MAPSTORE.canonicalEdge(e.cx, e.cz, e.dir);
      let p = MAPSTORE.partitionAt(e.house, c.cx, c.cz, c.dir);
      if (!p) {
        p = { cx: c.cx, cz: c.cz, dir: c.dir, door: true };
        e.house.partitions.push(p);
      } else {
        p.door = !p.door;
      }
    } else {
      const list = e.house.doors;
      let at = -1;
      for (let i = 0; i < list.length; i++) {
        if (list[i].cx === e.cx && list[i].cz === e.cz && list[i].dir === e.dir) { at = i; break; }
      }
      if (at >= 0) list.splice(at, 1);
      else list.push({ cx: e.cx, cz: e.cz, dir: e.dir });
    }
    selection = { kind: 'house', ref: e.house };
    markDirty();
  }

  function removeDoorAt(w) {
    const e = houseEdgeAt(w);
    if (!e) return;
    if (e.interior) {
      const c = MAPSTORE.canonicalEdge(e.cx, e.cz, e.dir);
      const p = MAPSTORE.partitionAt(e.house, c.cx, c.cz, c.dir);
      if (p) p.door = false;
    } else {
      const list = e.house.doors;
      for (let i = 0; i < list.length; i++) {
        if (list[i].cx === e.cx && list[i].cz === e.cz && list[i].dir === e.dir) {
          list.splice(i, 1);
          break;
        }
      }
    }
    markDirty();
  }

  function removePartitionAt(w) {
    const e = houseEdgeAt(w);
    if (!e || !e.interior) return;
    const c = MAPSTORE.canonicalEdge(e.cx, e.cz, e.dir);
    const list = e.house.partitions;
    for (let i = 0; i < list.length; i++) {
      if (MAPSTORE.edgeKey(list[i].cx, list[i].cz, list[i].dir) ===
          MAPSTORE.edgeKey(c.cx, c.cz, c.dir)) {
        list.splice(i, 1);
        break;
      }
    }
    markDirty();
  }

  function eraseAt(w) {
    /* 先处理墙边：内墙 / 门比整格更容易被误点，但只在该边确实有东西时优先 */
    const e = houseEdgeAt(w);
    if (e) {
      if (e.interior) {
        const c = MAPSTORE.canonicalEdge(e.cx, e.cz, e.dir);
        if (MAPSTORE.partitionAt(e.house, c.cx, c.cz, c.dir)) {
          removePartitionAt(w);
          return;
        }
      } else if (MAPSTORE.hasBoundaryDoor(e.house, e.cx, e.cz, e.dir)) {
        removeDoorAt(w);
        return;
      }
    }
    const hit = pickAt(w);
    if (hit) {
      if (hit.kind === 'house') {
        removeHouseCell(hit.ref, hit.cell.cx, hit.cell.cz);
      } else {
        deleteObject(hit);
      }
      markDirty();
      return;
    }
    /* 最后处理墙体：非地板格恢复成可通行地板。
       地板格不会被擦成墙；要造墙请用「墙体」笔刷。 */
    const c = cellAt(w);
    if (MAPSTORE.inBounds(map, c.cx, c.cz) && !MAPSTORE.cellValue(map, c.cx, c.cz)) {
      MAPSTORE.setCellValue(map, c.cx, c.cz, 1);
      invalidateOwners();
      markDirty();
      return;
    }
  }

  function deleteObject(sel) {
    if (!sel) return;
    const list = listForKind(sel.kind);
    if (!list) return;
    const at = list.indexOf(sel.ref);
    if (at >= 0) list.splice(at, 1);
    if (selection && selection.ref === sel.ref) selection = null;
  }

  function listForKind(kind) {
    switch (kind) {
      case 'prop': return map.props;
      case 'chest': return map.chests;
      case 'loot': return map.loot;
      case 'enemy': return map.enemies;
      case 'player': return map.playerSpawns;
      case 'extraction': return map.extractions;
      default: return null;
    }
  }

  function placeAt(kind, w, e) {
    const free = e && e.shiftKey;
    const x = snapVal(w.x, free), z = snapVal(w.z, free);
    let obj = null;
    if (kind === 'supply' || kind === 'weapon') {
      obj = { x: x, z: z, type: kind === 'weapon' ? 'weapon' : 'supply', yaw: 0, luck: 0.5 };
      map.chests.push(obj);
      selection = { kind: 'chest', ref: obj };
    } else if (kind === 'loot') {
      obj = { x: x, z: z, luck: 0.5, kind: 'auto' };
      map.loot.push(obj);
      selection = { kind: 'loot', ref: obj };
    } else if (kind === 'enemy') {
      obj = { x: x, z: z, type: 'zombie', count: 2, radius: 4, faction: '' };
      map.enemies.push(obj);
      selection = { kind: 'enemy', ref: obj };
    } else if (kind === 'player') {
      obj = { x: x, z: z, yaw: 0 };
      map.playerSpawns.push(obj);
      selection = { kind: 'player', ref: obj };
    } else if (kind === 'extract') {
      obj = {
        x: x, z: z,
        r: (typeof CFG !== 'undefined' && CFG.EXTRACT_R) ? CFG.EXTRACT_R : 3.2,
        hold: (typeof CFG !== 'undefined' && CFG.EXTRACT_HOLD) ? CFG.EXTRACT_HOLD : 6
      };
      map.extractions.push(obj);
      selection = { kind: 'extraction', ref: obj };
    } else if (kind === 'prop') {
      obj = {
        x: x, z: z, kind: propKind, rot: 0,
        h: propKind === 'crate' ? 1.1 : 0.8,
        cr: propKind === 'crate' ? 0.72 : 0.45
      };
      map.props.push(obj);
      selection = { kind: 'prop', ref: obj };
    }
    markDirty();
    renderInspector();
    return obj;
  }

  function pointToolKind(toolId) {
    return toolId === 'supply' || toolId === 'weapon' || toolId === 'loot' ||
      toolId === 'enemy' || toolId === 'player' || toolId === 'extract' || toolId === 'prop';
  }

  function onPointerDown(e) {
    if (!map) return;
    const r = canvas.getBoundingClientRect();
    const w = eventWorld(e);
    mouseWorld = w;
    if (e.button === 1 || tool === 'pan' || spaceDown) {
      drag = {
        type: 'pan', sx: e.clientX, sy: e.clientY,
        vx: view.x, vz: view.z
      };
      document.body.classList.add('panning');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (tool === 'door') { removeDoorAt(w); }
      else if (tool === 'partition') { removePartitionAt(w); }
      else if (tool === 'select' || tool === 'erase') {
        pushHistory();
        eraseAt(w);
        pushHistoryIfNeeded();
      }
      updateValidation();
      updateStatus();
      return;
    }
    if (e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}

    if (tool === 'select') {
      const hit = pickAt(w);
      selection = hit;
      renderInspector();
      if (hit) {
        pushHistory();
        const c = cellAt(w);
        if (hit.kind === 'house') {
          drag = {
            type: 'moveHouse', house: hit.ref,
            startCell: c, lastDx: 0, lastDz: 0,
            origCells: MAPSTORE.houseCells(hit.ref).map(function (x) { return [x.cx, x.cz]; }),
            origDoors: (hit.ref.doors || []).map(function (d) { return { cx: d.cx, cz: d.cz, dir: d.dir }; }),
            origPartitions: (hit.ref.partitions || []).map(function (p) {
              return { cx: p.cx, cz: p.cz, dir: p.dir, door: !!p.door };
            })
          };
        } else {
          drag = {
            type: 'movePoint', obj: hit.ref,
            sx: w.x, sz: w.z, ox: hit.ref.x, oz: hit.ref.z
          };
        }
      }
      return;
    }

    if (tool === 'floor' || tool === 'wall' || tool === 'house') {
      pushHistory();
      drag = { type: 'paint', kind: tool, lastCell: cellAt(w), house: null };
      paintAt(tool, w, e);
      renderInspector();
      return;
    }

    if (tool === 'partition') {
      pushHistory();
      drag = { type: 'partition' };
      applyPartitionAt(w);
      renderInspector();
      return;
    }

    if (tool === 'door') {
      pushHistory();
      toggleDoorAt(w);
      renderInspector();
      return;
    }

    if (tool === 'erase') {
      pushHistory();
      drag = { type: 'erase' };
      eraseAt(w);
      return;
    }

    if (pointToolKind(tool)) {
      pushHistory();
      placeAt(tool, w, e);
      const hit = selection;
      if (hit) {
        drag = {
          type: 'movePoint', obj: hit.ref,
          sx: w.x, sz: w.z, ox: hit.ref.x, oz: hit.ref.z
        };
      }
      return;
    }
  }

  function pushHistoryIfNeeded() {
    /* 右键擦除时如果什么都没删掉，撤销栈会多一条空记录；这里不处理也无碍 */
  }

  function onPointerMove(e) {
    if (!map) return;
    const w = eventWorld(e);
    mouseWorld = w;
    hover = { x: w.x, z: w.z, cell: cellAt(w) };
    if (drag) {
      if (drag.type === 'pan') {
        view.x = drag.vx - (e.clientX - drag.sx) / view.scale;
        view.z = drag.vz - (e.clientY - drag.sy) / view.scale;
      } else if (drag.type === 'paint') {
        const c = cellAt(w);
        if (!drag.lastCell || c.cx !== drag.lastCell.cx || c.cz !== drag.lastCell.cz) {
          const from = drag.lastCell || c;
          lineCells(from, c).forEach(function (cc) {
            if (drag.kind === 'floor' || drag.kind === 'wall') {
              brushCells(cc.cx, cc.cz).forEach(function (b) {
                if (drag.kind === 'floor') applyFloor(b); else applyWall(b);
              });
            } else if (drag.kind === 'house' && drag.house) {
              addHouseCell(drag.house, cc.cx, cc.cz);
            }
          });
          drag.lastCell = c;
          markDirty();
        }
      } else if (drag.type === 'partition') {
        applyPartitionAt(w);
      } else if (drag.type === 'erase') {
        eraseAt(w);
      } else if (drag.type === 'movePoint') {
        drag.obj.x = snapVal(drag.ox + (w.x - drag.sx), e.shiftKey);
        drag.obj.z = snapVal(drag.oz + (w.z - drag.sz), e.shiftKey);
        markDirty();
      } else if (drag.type === 'moveHouse') {
        const c = cellAt(w);
        const dx = c.cx - drag.startCell.cx;
        const dz = c.cz - drag.startCell.cz;
        if (dx !== drag.lastDx || dz !== drag.lastDz) {
          if (tryMoveHouse(drag.house, drag.origCells, drag.origDoors, drag.origPartitions, dx, dz)) {
            drag.lastDx = dx;
            drag.lastDz = dz;
            markDirty();
          }
        }
      }
    }
    updateStatus();
  }

  function onPointerUp(e) {
    if (drag && drag.type === 'pan') document.body.classList.remove('panning');
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    updateValidation();
    updateStatus();
  }

  function tryMoveHouse(h, origCells, origDoors, origPartitions, dx, dz) {
    if (!h) return false;
    if (!dx && !dz) return true;
    const owners = ownerMap();
    const target = {};
    for (let i = 0; i < origCells.length; i++) {
      const cx = origCells[i][0] + dx;
      const cz = origCells[i][1] + dz;
      if (!MAPSTORE.inBounds(map, cx, cz)) return false;
      const k = keyOf(cx, cz);
      const o = owners[k];
      if (o && o !== h) return false;
      target[k] = true;
    }
    h.cells = origCells.map(function (c) { return [c[0] + dx, c[1] + dz]; });
    h.doors = origDoors.map(function (d) {
      return { cx: d.cx + dx, cz: d.cz + dz, dir: d.dir };
    });
    h.partitions = origPartitions.map(function (p) {
      return { cx: p.cx + dx, cz: p.cz + dz, dir: p.dir, door: !!p.door };
    });
    invalidateOwners();
    for (const k in target) {
      if (!target.hasOwnProperty(k)) continue;
      const parts = k.split(',');
      MAPSTORE.setCellValue(map, +parts[0], +parts[1], 1);
    }
    return true;
  }

  function onWheel(e) {
    if (!map) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const before = s2w(px, py);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.scale = clamp(view.scale * factor, 4, 56);
    view.x = before.x - px / view.scale;
    view.z = before.z - py / view.scale;
    updateZoomLabel();
  }

  /* ================= 渲染 ================= */
  function hash2(cx, cz) {
    const h = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    return (h % 1000) / 1000;
  }

  function drawRotRect(cx, cz, yaw, hx, hz, fill, stroke, lw) {
    const p = w2s(cx, cz);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-yaw);
    const w = hx * 2 * view.scale, h = hz * 2 * view.scale;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1;
      ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
    }
    ctx.restore();
  }

  function drawWorldLine(x1, z1, x2, z2, color, width, dash) {
    const a = w2s(x1, z1), b = w2s(x2, z2);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function visibleRange() {
    const s = canvasSize();
    return {
      x0: Math.max(0, Math.floor(view.x / CELL) - 1),
      x1: Math.min(map.cols - 1, Math.ceil((view.x + s.w / view.scale) / CELL) + 1),
      z0: Math.max(0, Math.floor(view.z / CELL) - 1),
      z1: Math.min(map.rows - 1, Math.ceil((view.z + s.h / view.scale) / CELL) + 1)
    };
  }

  function render() {
    if (!ctx || !map) return;
    const s = canvasSize();
    if (!s.w || !s.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(s.w * dpr) || canvas.height !== Math.round(s.h * dpr)) {
      canvas.width = Math.round(s.w * dpr);
      canvas.height = Math.round(s.h * dpr);
      canvas.style.width = s.w + 'px';
      canvas.style.height = s.h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = '#0b0e11';
    ctx.fillRect(0, 0, s.w, s.h);

    if (needsFit) {
      needsFit = false;
      fitView();
    }

    const range = visibleRange();
    const owners = ownerMap();

    /* 地板 / 墙体 */
    if (layersOn.floor) {
      for (let cz = range.z0; cz <= range.z1; cz++) {
        for (let cx = range.x0; cx <= range.x1; cx++) {
          const x = cx * CELL, z = cz * CELL;
          const p = w2s(x, z);
          const w = CELL * view.scale, h = CELL * view.scale;
          if (MAPSTORE.cellValue(map, cx, cz)) {
            const v = 0.92 + hash2(cx, cz) * 0.12;
            ctx.fillStyle = 'rgb(' + Math.round(58 * v) + ',' + Math.round(50 * v) + ',' + Math.round(41 * v) + ')';
            ctx.fillRect(p.x, p.y, w + 0.4, h + 0.4);
          } else {
            let near = false;
            for (let dz = -1; dz <= 1 && !near; dz++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (MAPSTORE.cellValue(map, cx + dx, cz + dz)) { near = true; break; }
              }
            }
            if (near) {
              ctx.fillStyle = '#7b6e5c';
              ctx.fillRect(p.x, p.y, w + 0.4, h + 0.4);
              ctx.fillStyle = 'rgba(255,255,255,.09)';
              ctx.fillRect(p.x, p.y, w + 0.4, Math.max(1, 1.5));
              ctx.strokeStyle = 'rgba(8,10,12,.55)';
              ctx.lineWidth = 1;
              ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);
            } else {
              ctx.fillStyle = '#0f1215';
              ctx.fillRect(p.x, p.y, w + 0.4, h + 0.4);
            }
          }
        }
      }
    }

    /* 网格 */
    if (layersOn.grid) {
      const maxLines = 240;
      const step = Math.max(1, Math.ceil(9 / (CELL * view.scale)));
      let count = 0;
      for (let cx = range.x0; cx <= range.x1 + 1 && count < maxLines; cx += step) {
        const p = w2s(cx * CELL, 0).x;
        const major = cx % 5 === 0;
        ctx.strokeStyle = major ? 'rgba(240,236,226,.14)' : 'rgba(240,236,226,.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(p) + 0.5, 0);
        ctx.lineTo(Math.round(p) + 0.5, s.h);
        ctx.stroke();
        count++;
      }
      count = 0;
      for (let cz = range.z0; cz <= range.z1 + 1 && count < maxLines; cz += step) {
        const p = w2s(0, cz * CELL).y;
        const major = cz % 5 === 0;
        ctx.strokeStyle = major ? 'rgba(240,236,226,.14)' : 'rgba(240,236,226,.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(p) + 0.5);
        ctx.lineTo(s.w, Math.round(p) + 0.5);
        ctx.stroke();
        count++;
      }
    }

    /* 房屋 */
    if (layersOn.houses) {
      for (let hi = 0; hi < map.houses.length; hi++) drawHouse(map.houses[hi], owners);
    }

    /* 物体 */
    if (layersOn.props) map.props.forEach(drawProp);
    if (layersOn.chests) map.chests.forEach(drawChest);
    if (layersOn.loot) map.loot.forEach(drawLoot);
    if (layersOn.enemies) map.enemies.forEach(drawEnemy);
    if (layersOn.spawns) {
      map.playerSpawns.forEach(drawPlayerSpawn);
      map.extractions.forEach(drawExtraction);
    }

    /* 选择 / 悬停 */
    drawSelection();
    drawHover();

    /* 地图边框 */
    const a = w2s(0, 0);
    ctx.strokeStyle = 'rgba(240,176,76,.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, map.cols * CELL * view.scale, map.rows * CELL * view.scale);

    if (invalidRefs.size || warnRefs.size) drawInvalidRefs();
  }

  function drawHouse(h, owners) {
    const cells = MAPSTORE.houseCells(h);
    if (!cells.length) return;
    const cellSet = {};
    for (let ci = 0; ci < cells.length; ci++) cellSet[keyOf(cells[ci].cx, cells[ci].cz)] = 1;
    const selected = selection && selection.kind === 'house' && selection.ref === h;
    const invalid = invalidRefs.has(h);
    const warned = !invalid && warnRefs.has(h);

    /* 轮廓底色 */
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const p = w2s(c.cx * CELL, c.cz * CELL);
      const w = CELL * view.scale;
      ctx.fillStyle = selected ? 'rgba(240,176,76,.18)' : 'rgba(240,176,76,.075)';
      ctx.fillRect(p.x, p.y, w + 0.4, w + 0.4);
      ctx.strokeStyle = 'rgba(240,176,76,.20)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, w - 1);
    }

    /* 按格子轮廓现场生成墙体：外墙 + 外门 + 内墙 + 内门 */
    const wallFill = '#b4a78f';
    const wallLine = 'rgba(15,17,19,.8)';
    function drawWallEdge(cx, cz, dir, type, interior) {
      const d = DIRS[dir];
      const center = cellCenter(cx, cz);
      const offset = interior ? CELL * 0.5 : CELL * 0.5 - WALL_T * 0.5;
      const mx = center.x + d.nx * offset;
      const mz = center.z + d.nz * offset;
      const cos = Math.cos(d.yaw), sin = Math.sin(d.yaw);
      if (type === 'door') {
        const halfDoor = DOOR_W * 0.5;
        const sideSeg = (CELL - DOOR_W) * 0.25;
        const segW = (CELL - DOOR_W) * 0.5;
        for (let s = -1; s <= 1; s += 2) {
          const ox = s * (halfDoor + sideSeg);
          drawRotRect(mx + cos * ox, mz - sin * ox, d.yaw, segW * 0.5, WALL_T * 0.5,
            wallFill, wallLine, 1);
        }
        /* 门板 + 开启弧线 */
        const hx = mx + cos * -halfDoor;
        const hz = mz - sin * -halfDoor;
        const hinge = w2s(hx, hz);
        const a = -d.yaw;
        const r = DOOR_W * view.scale;
        ctx.save();
        ctx.strokeStyle = interior ? 'rgba(111,216,239,.95)' : 'rgba(240,176,76,.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hinge.x, hinge.y);
        ctx.lineTo(hinge.x + Math.cos(a) * r, hinge.y + Math.sin(a) * r);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(hinge.x, hinge.y, r, a, a - 1.76, true);
        ctx.stroke();
        ctx.restore();
      } else {
        drawRotRect(mx, mz, d.yaw, CELL * 0.5, WALL_T * 0.5, wallFill, wallLine, 1);
        if (type === 'window') {
          drawWorldLine(mx - cos * 0.68, mz + sin * 0.68,
            mx + cos * 0.68, mz - sin * 0.68,
            'rgba(111,216,239,.85)', 2);
        }
      }
    }

    cells.forEach(function (c) {
      DIR_KEYS.forEach(function (dir, di) {
        const n = DIRS[dir];
        if (cellSet[keyOf(c.cx + n.dx, c.cz + n.dz)]) return;
        const isDoor = MAPSTORE.hasBoundaryDoor(h, c.cx, c.cz, dir);
        const hv = ((c.cx * 73856093) ^ (c.cz * 19349663) ^ (di * 83492791)) >>> 0;
        const type = isDoor ? 'door' : ((hv % 4 === 0) ? 'window' : 'solid');
        drawWallEdge(c.cx, c.cz, dir, type, false);
      });
    });
    (h.partitions || []).forEach(function (p) {
      drawWallEdge(p.cx, p.cz, p.dir, p.door ? 'door' : 'solid', true);
    });

    if (selected || invalid || warned) {
      ctx.save();
      ctx.strokeStyle = invalid ? 'rgba(226,96,79,.95)'
        : (warned ? 'rgba(240,176,76,.8)' : 'rgba(240,176,76,.95)');
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const minX = Math.min.apply(null, cells.map(function (c) { return c.cx; }));
      const maxX = Math.max.apply(null, cells.map(function (c) { return c.cx; }));
      const minZ = Math.min.apply(null, cells.map(function (c) { return c.cz; }));
      const maxZ = Math.max.apply(null, cells.map(function (c) { return c.cz; }));
      const p = w2s(minX * CELL, minZ * CELL);
      ctx.strokeRect(p.x - 2, p.y - 2,
        (maxX - minX + 1) * CELL * view.scale + 4,
        (maxZ - minZ + 1) * CELL * view.scale + 4);
      ctx.restore();
    }
  }

  function drawLabel(text, x, y, color, font) {
    if (!layersOn.labels) return;
    ctx.save();
    ctx.font = font || '10px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,7,9,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#e8e2d6';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function pointPx(x, z) { return w2s(x, z); }

  function drawProp(p) {
    const q = pointPx(p.x, p.z);
    const size = Math.max(9, (p.cr || 0.5) * 2 * view.scale);
    const invalid = invalidRefs.has(p);
    const selected = selection && selection.ref === p;
    if (p.kind === 'barrel') {
      ctx.beginPath();
      ctx.arc(q.x, q.y, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3d6e70';
      ctx.fill();
      ctx.strokeStyle = invalid ? '#e2604f' : 'rgba(10,12,14,.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, size * 0.28, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(160,225,228,.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(-(p.rot || 0));
      ctx.fillStyle = '#a97c49';
      ctx.fillRect(-size * 0.5, -size * 0.5, size, size);
      ctx.strokeStyle = invalid ? '#e2604f' : 'rgba(10,12,14,.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(-size * 0.5, -size * 0.5, size, size);
      ctx.restore();
    }
    if (selected) ring(q.x, q.y, size * 0.5 + 4, 'rgba(240,176,76,.95)');
    if (layersOn.labels && view.scale > 11) drawLabel(p.kind === 'crate' ? '箱' : '桶', q.x, q.y, '#f0e6d2', '9px sans-serif');
  }

  function drawChest(c) {
    const q = pointPx(c.x, c.z);
    const weapon = c.type === 'weapon';
    const size = Math.max(14, (weapon ? 0.9 : 0.75) * view.scale);
    const invalid = invalidRefs.has(c);
    const selected = selection && selection.ref === c;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(-(c.yaw || 0));
    ctx.fillStyle = weapon ? '#7d3f36' : '#6b4c22';
    ctx.fillRect(-size * 0.5, -size * 0.5, size, size);
    ctx.strokeStyle = invalid ? '#e2604f' : (weapon ? '#e2604f' : '#f0b04c');
    ctx.lineWidth = 2;
    ctx.strokeRect(-size * 0.5, -size * 0.5, size, size);
    ctx.fillStyle = weapon ? '#ffb0a3' : '#ffd58f';
    ctx.fillRect(-size * 0.5, -size * 0.5, size, Math.max(2, size * 0.22));
    ctx.restore();
    if (layersOn.labels && view.scale > 8) {
      drawLabel(weapon ? '武器箱' : '物资箱', q.x, q.y - size * 0.5 - 7, weapon ? '#ffb0a3' : '#ffd18a');
    }
    if (selected) ring(q.x, q.y, size * 0.62 + 3, 'rgba(240,176,76,.95)');
  }

  function luckColor(l) {
    if (l >= 0.75) return '#b96bff';
    if (l >= 0.5) return '#4d8bff';
    if (l >= 0.25) return '#5ad46a';
    return '#9aa4ad';
  }

  function drawLoot(l) {
    const q = pointPx(l.x, l.z);
    const invalid = invalidRefs.has(l);
    const selected = selection && selection.ref === l;
    const r = Math.max(6, 0.32 * view.scale);
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - r);
    ctx.lineTo(q.x + r, q.y);
    ctx.lineTo(q.x, q.y + r);
    ctx.lineTo(q.x - r, q.y);
    ctx.closePath();
    ctx.fillStyle = luckColor(l.luck || 0);
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = invalid ? '#e2604f' : 'rgba(8,10,12,.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (selected) ring(q.x, q.y, r + 4, 'rgba(240,176,76,.95)');
  }

  function drawEnemy(e) {
    const q = pointPx(e.x, e.z);
    const def = ENEMY_TYPES[e.type] || { name: e.type, color: '#c8573f' };
    const invalid = invalidRefs.has(e);
    const selected = selection && selection.ref === e;
    if (e.radius > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(226,96,79,.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, e.radius * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(7, 0.35 * view.scale), 0, Math.PI * 2);
    ctx.fillStyle = def.color;
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = invalid ? '#fff' : 'rgba(8,10,12,.9)';
    ctx.lineWidth = invalid ? 2 : 1.5;
    ctx.stroke();
    if (layersOn.labels && view.scale > 9) {
      drawLabel(def.name + (e.count > 1 ? ' ×' + e.count : ''),
        q.x, q.y - Math.max(7, 0.35 * view.scale) - 7, '#ffc8bd');
    }
    if (selected) ring(q.x, q.y, Math.max(7, 0.35 * view.scale) + 4, 'rgba(240,176,76,.95)');
  }

  function drawPlayerSpawn(p) {
    const q = pointPx(p.x, p.z);
    const invalid = invalidRefs.has(p);
    const selected = selection && selection.ref === p;
    const a = Math.atan2(Math.cos(p.yaw || 0), Math.sin(p.yaw || 0));
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = invalid ? '#e2604f' : '#6fd8ef';
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,12,.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    if (layersOn.labels && view.scale > 9) drawLabel('出生', q.x, q.y - 15, '#bdf4ff');
    if (selected) ring(q.x, q.y, 15, 'rgba(240,176,76,.95)');
  }

  function drawExtraction(p) {
    const q = pointPx(p.x, p.z);
    const invalid = invalidRefs.has(p);
    const selected = selection && selection.ref === p;
    ctx.save();
    ctx.strokeStyle = invalid ? 'rgba(226,96,79,.9)' : 'rgba(240,176,76,.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(q.x, q.y, p.r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - 9);
    ctx.lineTo(q.x + 9, q.y);
    ctx.lineTo(q.x, q.y + 9);
    ctx.lineTo(q.x - 9, q.y);
    ctx.closePath();
    ctx.fillStyle = '#f0b04c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,12,.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (layersOn.labels && view.scale > 8) {
      drawLabel('撤离 ' + (p.hold || 6) + 's', q.x, q.y - 16, '#ffd28f');
    }
    if (selected) ring(q.x, q.y, 15, 'rgba(240,176,76,.95)');
  }

  function ring(x, y, r, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSelection() {
    if (!selection) return;
    const ref = selection.ref;
    if (!ref) return;
    if (selection.kind === 'house') return; /* 房屋框在 drawHouse 中画 */
    const q = pointPx(ref.x, ref.z);
    const r = selection.kind === 'extraction' ? 15 : 14;
    ring(q.x, q.y, r, 'rgba(240,176,76,.95)');
  }

  function drawHover() {
    if (!hover) return;
    if (tool === 'select') {
      const hit = pickAt(hover);
      if (hit && hit.ref && hit.kind !== 'house') {
        const q = pointPx(hit.ref.x, hit.ref.z);
        ring(q.x, q.y, 17, 'rgba(111,216,239,.75)');
      }
      return;
    }
    if (tool === 'floor' || tool === 'wall' || tool === 'house') {
      const cell = hover.cell;
      const cells = tool === 'house' ? [{ cx: cell.cx, cz: cell.cz }] : brushCells(cell.cx, cell.cz);
      const color = tool === 'wall' ? 'rgba(226,96,79,.22)' : (tool === 'house' ? 'rgba(240,176,76,.24)' : 'rgba(240,176,76,.18)');
      ctx.save();
      cells.forEach(function (c) {
        const p = w2s(c.cx * CELL, c.cz * CELL);
        ctx.fillStyle = color;
        ctx.fillRect(p.x, p.y, CELL * view.scale, CELL * view.scale);
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, CELL * view.scale - 1, CELL * view.scale - 1);
      });
      ctx.restore();
      return;
    }
    if (tool === 'partition' || tool === 'door') {
      const e = houseEdgeAt(hover);
      if (e) {
        const l = edgeLine(e);
        drawWorldLine(l.x1, l.z1, l.x2, l.z2,
          tool === 'door' ? 'rgba(240,176,76,.95)' : 'rgba(111,216,239,.95)',
          Math.max(4, WALL_T * view.scale + 2));
      }
      return;
    }
    if (pointToolKind(tool)) {
      const q = pointPx(snapVal(hover.x, false), snapVal(hover.z, false));
      ctx.save();
      ctx.strokeStyle = 'rgba(240,176,76,.7)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx.moveTo(q.x - 15, q.y); ctx.lineTo(q.x + 15, q.y);
      ctx.moveTo(q.x, q.y - 15); ctx.lineTo(q.x, q.y + 15);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawInvalidRefs() {
    invalidRefs.forEach(function (ref) {
      if (!ref || !isFinite(ref.x) || !isFinite(ref.z)) return;
      const q = pointPx(ref.x, ref.z);
      ring(q.x, q.y, 19, 'rgba(226,96,79,.75)');
    });
    warnRefs.forEach(function (ref) {
      if (!ref || !isFinite(ref.x) || !isFinite(ref.z)) return;
      const q = pointPx(ref.x, ref.z);
      ring(q.x, q.y, 19, 'rgba(240,176,76,.55)');
    });
  }

  /* ================= 右侧属性面板 ================= */
  function renderInspector() {
    if (!map) return;
    const root = el.inspector;
    el.selKind.textContent = selection ? ({
      house: '房屋', prop: '障碍物', chest: '箱子', loot: '露天物资',
      enemy: '敌人刷新点', player: '玩家出生点', extraction: '撤离点'
    }[selection.kind] || '物体') : '地图';
    if (!selection) {
      root.innerHTML = mapInspectorHtml();
      bindInspector(null);
      return;
    }
    const ref = selection.ref;
    if (!ref) { selection = null; renderInspector(); return; }
    let html = '';
    if (selection.kind === 'house') html = houseInspectorHtml(ref);
    else if (selection.kind === 'prop') html = propInspectorHtml(ref);
    else if (selection.kind === 'chest') html = chestInspectorHtml(ref);
    else if (selection.kind === 'loot') html = lootInspectorHtml(ref);
    else if (selection.kind === 'enemy') html = enemyInspectorHtml(ref);
    else if (selection.kind === 'player') html = playerInspectorHtml(ref);
    else if (selection.kind === 'extraction') html = extractionInspectorHtml(ref);
    root.innerHTML = html;
    bindInspector(ref);
  }

  function metaRow(label, value) {
    return '<div class="ed-meta"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function mapInspectorHtml() {
    let walk = 0;
    for (let z = 0; z < map.rows; z++) {
      for (let x = 0; x < map.cols; x++) if (MAPSTORE.cellValue(map, x, z)) walk++;
    }
    return '' +
      '<div class="ed-empty" style="margin-bottom:8px">在左侧选择工具开始设计。新地图默认全部是可通行地板，用<b>墙体</b>工具画出外墙和通道。</div>' +
      metaRow('地图尺寸', map.cols + ' × ' + map.rows + ' 格') +
      metaRow('世界尺寸', (map.cols * CELL) + ' × ' + (map.rows * CELL) + ' m') +
      metaRow('可通行格', walk + ' / ' + (map.cols * map.rows)) +
      metaRow('房屋', map.houses.length + ' 栋') +
      metaRow('物资箱 / 武器箱', map.chests.length + ' 个') +
      metaRow('露天物资点', map.loot.length + ' 个') +
      metaRow('敌人刷新点', map.enemies.length + ' 个') +
      metaRow('撤离点', map.extractions.length + ' 个') +
      '<div class="ed-section-title">工具设置</div>' +
      '<div class="ed-field"><label>地板 / 墙体笔刷 <b>' + brush + '×' + brush + '</b></label>' +
        '<select data-mapopt="brush">' +
          [1, 3, 5].map(function (n) { return '<option value="' + n + '"' + (brush === n ? ' selected' : '') + '>' + n + ' × ' + n + ' 格</option>'; }).join('') +
        '</select></div>' +
      '<div class="ed-field"><label>吸附 <b>' + snap + ' m</b></label>' +
        '<select data-mapopt="snap">' +
          [0.25, 0.5, 1].map(function (n) { return '<option value="' + n + '"' + (snap === n ? ' selected' : '') + '>' + n + ' m</option>'; }).join('') +
        '</select></div>' +
      '<div class="ed-field"><label>障碍物类型</label>' +
        '<select data-mapopt="propKind">' +
          '<option value="crate"' + (propKind === 'crate' ? ' selected' : '') + '>木箱</option>' +
          '<option value="barrel"' + (propKind === 'barrel' ? ' selected' : '') + '>油桶</option>' +
        '</select></div>' +
      '<div class="ed-btn-row"><button type="button" class="ed-btn small" id="edUndo">撤销</button>' +
      '<button type="button" class="ed-btn small" id="edRedo">重做</button></div>' +
      '<button type="button" class="ed-btn small" id="edHelp">快捷键 / 使用说明</button>';
  }

  function bindInspector(obj) {
    const root = el.inspector;
    root.querySelectorAll('[data-mapopt]').forEach(function (input) {
      input.addEventListener('change', function () {
        const k = input.dataset.mapopt;
        if (k === 'brush') brush = clamp(parseInt(input.value, 10) || 1, 1, 5);
        else if (k === 'snap') snap = parseFloat(input.value) || 0.5;
        else if (k === 'propKind') propKind = input.value === 'barrel' ? 'barrel' : 'crate';
        renderInspector();
        updateStatus();
      });
    });
    const undoBtn = $('edUndo');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    const redoBtn = $('edRedo');
    if (redoBtn) redoBtn.addEventListener('click', redo);
    const helpBtn = $('edHelp');
    if (helpBtn) helpBtn.addEventListener('click', openHelp);

    if (!obj) return;
    root.querySelectorAll('[data-prop]').forEach(function (input) {
      let focused = false;
      input.addEventListener('focus', function () {
        if (!focused) { pushHistory(); focused = true; }
      });
      const read = function () {
        let v;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'range' || input.type === 'number') v = parseFloat(input.value);
        else v = input.value;
        if (typeof v === 'number' && !isFinite(v)) return;
        const prop = input.dataset.prop;
        if (input.dataset.cast === 'int') v = Math.round(v);
        obj[prop] = v;
        if (prop === 'kind' && selection && selection.kind === 'prop') {
          obj.h = v === 'crate' ? 1.1 : 0.8;
          obj.cr = v === 'crate' ? 0.72 : 0.45;
        }
        const out = root.querySelector('[data-out="' + prop + '"]');
        if (out) out.textContent = typeof v === 'number' ? (input.dataset.digits === '0' ? Math.round(v) : fmt1(v)) : v;
        if (selection && selection.kind === 'house' && prop === 'name') {
          /* 房屋名称也同步到顶部提示 */
        }
        markDirty();
        updateStatus();
      };
      input.addEventListener('input', read);
      input.addEventListener('change', read);
    });

    const endBtn = $('edEndHouse');
    if (endBtn) endBtn.addEventListener('click', function () {
      activeHouse = null;
      updateStatus();
      toast('已结束当前房屋，下次画房屋会新建一栋');
    });
    const delBtn = $('edDelete');
    if (delBtn) delBtn.addEventListener('click', deleteSelection);
    const dupBtn = $('edDuplicate');
    if (dupBtn) dupBtn.addEventListener('click', duplicateSelection);
    const rotBtn = $('edRotate');
    if (rotBtn) rotBtn.addEventListener('click', rotateSelection);
    const centerBtn = $('edCenterSel');
    if (centerBtn) centerBtn.addEventListener('click', centerOnSelection);
    const carveBtn = $('edCarveHouse');
    if (carveBtn) carveBtn.addEventListener('click', function () {
      if (selection && selection.kind === 'house') carveHouseNotch(selection.ref);
    });
  }

  function carveHouseNotch(h) {
    if (!h || !MAPSTORE.houseBounds(h)) return;
    pushHistory();
    MAPSTORE.carveHouseFloors(map);
    invalidateOwners();
    markDirty();
    renderInspector();
    toast('已按房屋轮廓清空缺口地板，需要时可用地板笔刷补回');
  }

  function field(label, prop, value, opts) {
    opts = opts || {};
    const type = opts.type || 'number';
    if (type === 'range') {
      return '<div class="ed-field"><label>' + label + ' <b data-out="' + prop + '">' +
        (opts.digits === '0' ? Math.round(value) : fmt1(value)) + '</b></label>' +
        '<input type="range" data-prop="' + prop + '" min="' + opts.min + '" max="' + opts.max +
        '" step="' + (opts.step || 0.1) + '" value="' + value + '"' +
        (opts.digits === '0' ? ' data-digits="0"' : '') + ' /></div>';
    }
    if (type === 'select') {
      return '<div class="ed-field"><label>' + label + '</label><select data-prop="' + prop + '"' +
        (opts.cast ? ' data-cast="' + opts.cast + '"' : '') + '>' +
        opts.options.map(function (o) {
          const v = typeof o === 'string' ? o : o.v;
          const t = typeof o === 'string' ? o : o.t;
          return '<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select></div>';
    }
    if (type === 'text') {
      return '<div class="ed-field"><label>' + label + '</label><input type="text" data-prop="' + prop +
        '" value="' + esc(value) + '" maxlength="32" /></div>';
    }
    return '<div class="ed-field"><label>' + label + '</label><input type="number" data-prop="' + prop +
      '" value="' + value + '" step="' + (opts.step || 0.1) + '"' +
      (opts.cast ? ' data-cast="' + opts.cast + '"' : '') + ' /></div>';
  }

  function objHeaderHtml(ref, extra) {
    return '<div class="ed-row2">' +
      field('X (m)', 'x', Math.round(ref.x * 10) / 10, { step: 0.1 }) +
      field('Z (m)', 'z', Math.round(ref.z * 10) / 10, { step: 0.1 }) +
      '</div>' + (extra || '');
  }

  function houseInspectorHtml(h) {
    const cells = MAPSTORE.houseCells(h);
    const b = MAPSTORE.houseBounds(h) || { w: 0, d: 0 };
    return '' +
      field('房屋名称', 'name', h.name || '', { type: 'text' }) +
      metaRow('格子数', cells.length + ' 格') +
      metaRow('占地', b.w + ' × ' + b.d + ' 格 · ' + (b.w * CELL) + ' × ' + (b.d * CELL) + ' m') +
      metaRow('外门', (h.doors || []).length + ' 扇') +
      metaRow('内墙 / 内门', (h.partitions || []).length + ' 段') +
      '<div class="ed-note" style="margin:8px 0;color:#7f7768;font-size:10px;line-height:1.6">' +
        '外墙会自动沿轮廓生成。用<b style="color:#f0b04c">门</b>工具点外墙放外门，点内墙切换内门。' +
        '<br>地板和屋顶只覆盖房屋格子；非矩形缺口的地形由你自己用墙体 / 地板笔刷决定。' +
      '</div>' +
      '<button type="button" class="ed-btn small" id="edEndHouse">结束当前房屋 (Esc)</button>' +
      '<button type="button" class="ed-btn small" id="edCenterSel">定位到房屋</button>' +
      '<button type="button" class="ed-btn small" id="edCarveHouse" title="把房屋外接矩形内、不属于这栋房屋的格子清成墙体 / 空地">清空轮廓缺口地板</button>' +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除整栋房屋</button>';
  }

  function propInspectorHtml(p) {
    return objHeaderHtml(p,
      field('类型', 'kind', p.kind, { type: 'select', options: [{ v: 'crate', t: '木箱 · 1.15m' }, { v: 'barrel', t: '油桶 · 0.62m' }] }) +
      field('旋转 (°)', 'rot', Math.round((p.rot || 0) * 180 / Math.PI), { step: 5 }) +
      '<button type="button" class="ed-btn small" id="edRotate">旋转 90°</button>' +
      '<button type="button" class="ed-btn small" id="edDuplicate">复制</button>' +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function chestInspectorHtml(c) {
    return objHeaderHtml(c,
      field('箱子类型', 'type', c.type, { type: 'select', options: [{ v: 'supply', t: '物资箱 · 4×4' }, { v: 'weapon', t: '武器箱 · 3×2' }] }) +
      field('品质倾向', 'luck', c.luck || 0, { type: 'range', min: 0, max: 1, step: 0.05 }) +
      field('朝向 (°)', 'yaw', Math.round((c.yaw || 0) * 180 / Math.PI), { step: 15 }) +
      '<button type="button" class="ed-btn small" id="edRotate">旋转 90°</button>' +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function lootInspectorHtml(l) {
    return objHeaderHtml(l,
      field('品质倾向', 'luck', l.luck || 0, { type: 'range', min: 0, max: 1, step: 0.05 }) +
      field('外观', 'kind', l.kind || 'auto', { type: 'select', options: [{ v: 'auto', t: '自动' }, { v: 'case', t: '物资盒' }, { v: 'canister', t: '罐体' }] }) +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function enemyInspectorHtml(e) {
    const opts = Object.keys(ENEMY_TYPES).map(function (k) { return { v: k, t: ENEMY_TYPES[k].name }; });
    return objHeaderHtml(e,
      field('敌人类型', 'type', e.type, { type: 'select', options: opts }) +
      field('数量', 'count', e.count, { step: 1, cast: 'int' }) +
      (e.type === 'squad'
        ? '<div class="ed-note" style="margin:6px 0;color:#7f7768;font-size:10px;line-height:1.6">清剿小队每队 4 人；数量为小队数。初始对玩家中立，攻击后整队敌对。</div>'
        : '') +
      field('散布半径', 'radius', e.radius, { type: 'range', min: 0, max: 16, step: 0.5 }) +
      field('阵营', 'faction', e.faction || '', { type: 'select', options: [{ v: '', t: '按类型自动' }, { v: 'undead', t: '丧尸阵营' }, { v: 'scav', t: '拾荒者阵营' }] }) +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function playerInspectorHtml(p) {
    return objHeaderHtml(p,
      field('朝向 (°)', 'yaw', Math.round((p.yaw || 0) * 180 / Math.PI), { step: 15 }) +
      '<div class="ed-note" style="margin:6px 0;color:#7f7768;font-size:10px;line-height:1.6">' +
        '可以放多个出生点；出击时使用列表中的第一个。' +
      '</div>' +
      '<button type="button" class="ed-btn small" id="edRotate">旋转 90°</button>' +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function extractionInspectorHtml(p) {
    return objHeaderHtml(p,
      field('半径', 'r', p.r, { type: 'range', min: 1.5, max: 8, step: 0.1 }) +
      field('停留时间 (s)', 'hold', p.hold, { type: 'range', min: 1, max: 20, step: 0.5 }) +
      '<button type="button" class="ed-btn small danger" id="edDelete">删除</button>');
  }

  function deleteSelection() {
    if (!selection) return;
    pushHistory();
    if (selection.kind === 'house') deleteHouse(selection.ref);
    else deleteObject(selection);
    selection = null;
    markDirty();
    renderInspector();
  }

  function duplicateSelection() {
    if (!selection) return;
    pushHistory();
    if (selection.kind === 'house') {
      const h = selection.ref;
      const cells = MAPSTORE.houseCells(h);
      if (!cells.length) return;
      const clone = {
        id: MAPSTORE.uid('h'),
        name: (h.name || '房屋') + ' 副本',
        cells: cells.map(function (c) { return [c.cx + 1, c.cz + 1]; }),
        doors: (h.doors || []).map(function (d) { return { cx: d.cx + 1, cz: d.cz + 1, dir: d.dir }; }),
        partitions: (h.partitions || []).map(function (p) { return { cx: p.cx + 1, cz: p.cz + 1, dir: p.dir, door: !!p.door }; })
      };
      map.houses.push(clone);
      clone.cells.forEach(function (c) { MAPSTORE.setCellValue(map, c[0], c[1], 1); });
      invalidateOwners();
      activeHouse = clone;
      selection = { kind: 'house', ref: clone };
    } else {
      const list = listForKind(selection.kind);
      if (!list) return;
      const copy = JSON.parse(JSON.stringify(selection.ref));
      copy.x += 1;
      copy.z += 1;
      list.push(copy);
      selection = { kind: selection.kind, ref: copy };
    }
    markDirty();
    renderInspector();
    toast('已复制');
  }

  function rotateSelection() {
    if (!selection || !selection.ref) return;
    pushHistory();
    const o = selection.ref;
    if (selection.kind === 'prop' || selection.kind === 'chest') {
      o.rot = (o.rot || 0) + Math.PI * 0.5;
      if (o.yaw !== undefined) o.yaw = (o.yaw || 0) + Math.PI * 0.5;
    } else if (selection.kind === 'player') {
      o.yaw = (o.yaw || 0) + Math.PI * 0.5;
    }
    markDirty();
    renderInspector();
  }

  function centerOnSelection() {
    if (!selection) return;
    if (selection.kind === 'house') {
      const b = MAPSTORE.houseBounds(selection.ref);
      if (!b) return;
      centerView((b.minX + b.maxX + 1) * CELL * 0.5, (b.minZ + b.maxZ + 1) * CELL * 0.5);
    } else if (selection.ref) {
      centerView(selection.ref.x, selection.ref.z);
    }
  }

  function centerView(x, z) {
    const s = canvasSize();
    view.x = x - (s.w * 0.5) / view.scale;
    view.z = z - (s.h * 0.5) / view.scale;
  }

  /* ================= 状态 / 校验 ================= */
  function updateHint() {
    const def = TOOLS.filter(function (t) { return t.id === tool; })[0];
    el.hint.textContent = def ? def.hint : '';
  }

  function updateZoomLabel() {
    if (!el.zoomLabel) return;
    el.zoomLabel.textContent = Math.round(view.scale / 14 * 100) + '%';
  }

  function updateStatus() {
    if (!el.statusTool) return;
    const def = TOOLS.filter(function (t) { return t.id === tool; })[0];
    el.statusTool.textContent = '工具 · ' + (def ? def.name : tool);
    el.statusCursor.textContent = 'x ' + fmt1(mouseWorld.x) + ' · z ' + fmt1(mouseWorld.z) +
      ' · 格 ' + Math.floor(mouseWorld.x / CELL) + ',' + Math.floor(mouseWorld.z / CELL);
    el.statusHouse.textContent = activeHouse
      ? '当前房屋 · ' + (activeHouse.name || activeHouse.id) + ' · ' + activeHouse.cells.length + ' 格'
      : '';
    el.statusCount.textContent =
      '地板 ' + countFloor() + ' · 房屋 ' + map.houses.length +
      ' · 箱 ' + map.chests.length + ' · 物资 ' + map.loot.length +
      ' · 敌人 ' + totalEnemies() + ' · 撤离 ' + map.extractions.length;
    el.statusSaved.textContent = dirty ? '未保存' : '已保存';
    el.statusSaved.className = 'ed-status-right' + (dirty ? ' dirty' : '');
    updateZoomLabel();
  }

  function countFloor() {
    let n = 0;
    for (let z = 0; z < map.rows; z++) {
      for (let x = 0; x < map.cols; x++) if (MAPSTORE.cellValue(map, x, z)) n++;
    }
    return n;
  }
  function totalEnemies() {
    let n = 0;
    map.enemies.forEach(function (e) {
      const c = Math.max(1, e.count | 0);
      n += e.type === 'squad' ? c * 4 : c;
    });
    return n;
  }

  function updateValidation() {
    const v = MAPSTORE.validate(map);
    lastValidation = v;
    invalidRefs = new Set();
    warnRefs = new Set();
    v.errors.forEach(function (i) { if (i.ref) invalidRefs.add(i.ref); });
    v.warnings.forEach(function (i) { if (i.ref && !invalidRefs.has(i.ref)) warnRefs.add(i.ref); });
    el.validState.textContent = v.errors.length
      ? (v.errors.length + ' 错误')
      : (v.warnings.length ? v.warnings.length + ' 警告' : 'OK');
    el.validState.style.color = v.errors.length ? 'var(--red)' : (v.warnings.length ? 'var(--amber)' : 'var(--green)');
    const list = v.errors.concat(v.warnings).slice(0, 14);
    if (!list.length) {
      el.issues.innerHTML = '<div class="ed-ok">✓ 地图校验通过，可以出击</div>';
      return;
    }
    el.issues.innerHTML = list.map(function (i, idx) {
      return '<div class="ed-issue ' + i.level + '"><i>' + String(idx + 1).padStart(2, '0') +
        '</i><span>' + esc(i.msg) + '</span></div>';
    }).join('');
  }

  /* ================= 保存 / 地图库 ================= */
  function scheduleSave() {
    dirty = true;
    el.statusSaved.textContent = '未保存';
    el.statusSaved.className = 'ed-status-right dirty';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(true); }, 1000);
  }

  function markDirty() {
    scheduleSave();
    updateValidation();
    updateStatus();
  }

  function saveNow(silent) {
    if (!map) return false;
    const saved = MAPSTORE.save(map);
    if (!saved) {
      toast('保存失败：浏览器本地存储不可用或已满', 'warn');
      return false;
    }
    map.id = saved.id;
    map.updatedAt = saved.updatedAt;
    MAPSTORE.setPicked(map.id);
    dirty = false;
    el.statusSaved.textContent = '已保存';
    el.statusSaved.className = 'ed-status-right';
    if (!silent) toast('已保存到本地地图库', 'good');
    return true;
  }

  function openMap(m) {
    map = MAPSTORE.normalize(m);
    invalidateOwners();
    if (map.id && MAPSTORE.get(map.id)) MAPSTORE.setPicked(map.id);
    el.name.value = map.name;
    selection = null;
    activeHouse = null;
    history = [];
    future = [];
    dirty = false;
    needsFit = true;
    renderInspector();
    updateValidation();
    updateStatus();
    clearTimeout(saveTimer);
  }

  function fitView() {
    const s = canvasSize();
    if (!s.w || !s.h) return;
    const w = map.cols * CELL, h = map.rows * CELL;
    const pad = 32;
    const sc = Math.min((s.w - pad * 2) / w, (s.h - pad * 2) / h);
    view.scale = clamp(sc, 4, 40);
    view.x = (w - s.w / view.scale) * 0.5;
    view.z = (h - s.h / view.scale) * 0.5;
    updateZoomLabel();
  }

  function openNewDialog() {
    openModal('新建地图', '' +
      '<div class="ed-field"><label>地图名称</label><input type="text" id="edNewName" value="新地图" maxlength="32" /></div>' +
      '<div class="ed-row2">' +
        '<div class="ed-field"><label>横向格数（2m / 格）</label><input type="number" id="edNewCols" value="44" min="16" max="96" step="2" /></div>' +
        '<div class="ed-field"><label>纵向格数</label><input type="number" id="edNewRows" value="44" min="16" max="96" step="2" /></div>' +
      '</div>' +
      '<div class="ed-note">新地图默认全部为可通行地板。用「墙体」工具画外墙和通道，用「房屋」工具画任意轮廓的房屋。</div>',
      [
        { text: '取消', cls: '' },
        { text: '创建', cls: 'primary', run: function () {
          const name = ($('edNewName').value || '新地图').slice(0, 32);
          const cols = clamp(parseInt($('edNewCols').value, 10) || 44, 16, 96);
          const rows = clamp(parseInt($('edNewRows').value, 10) || 44, 16, 96);
          const m = MAPSTORE.blank(name, cols, rows);
          MAPSTORE.save(m);
          openMap(m);
          closeModal();
          toast('已创建 ' + name, 'good');
        } }
      ]);
    setTimeout(function () {
      const n = $('edNewName');
      if (n) { n.focus(); n.select(); }
    }, 30);
  }

  function openLibrary() {
    const maps = MAPSTORE.list();
    let body = '';
    if (!maps.length) {
      body = '<div class="ed-empty">本地还没有地图。点击「新建」创建一张，或使用「导入」读取 JSON。</div>';
    } else {
      body = '<div class="ed-lib-list">' + maps.map(function (m) {
        return '<div class="ed-lib-row" data-id="' + esc(m.id) + '">' +
          '<div class="ed-lib-main"><span class="ed-lib-name">' + esc(m.name) + '</span>' +
          '<span class="ed-lib-meta">' + m.cols + '×' + m.rows + ' 格 · ' + m.houses + ' 栋房屋 · ' +
          new Date(m.updatedAt || Date.now()).toLocaleString() + '</span></div>' +
          '<button type="button" class="ed-btn small" data-act="open">打开</button>' +
          '<button type="button" class="ed-btn small" data-act="dup">复制</button>' +
          '<button type="button" class="ed-btn small danger" data-act="del">删除</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    openModal('本地地图库', body, [{ text: '关闭', cls: '' }]);
    el.modalBody.querySelectorAll('.ed-lib-row').forEach(function (row) {
      const id = row.dataset.id;
      row.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const act = btn.dataset.act;
          if (act === 'open') {
            const m = MAPSTORE.get(id);
            if (m) { openMap(m); closeModal(); toast('已打开 ' + m.name, 'good'); }
          } else if (act === 'dup') {
            const m = MAPSTORE.duplicate(id);
            if (m) { openLibrary(); toast('已复制地图', 'good'); }
          } else if (act === 'del') {
            if (!confirm('删除地图「' + (MAPSTORE.get(id) || {}).name + '」？此操作不可撤销。')) return;
            MAPSTORE.remove(id);
            openLibrary();
            toast('已删除地图');
          }
        });
      });
    });
  }

  function openHelp() {
    openModal('使用说明', '' +
      '<div class="ed-help-grid">' +
        '<div><b>V</b> 选择 / 拖动</div><div><b>空格 / 中键</b> 平移画布</div>' +
        '<div><b>G</b> 地板笔刷</div><div><b>X</b> 墙体笔刷</div>' +
        '<div><b>H</b> 房屋轮廓</div><div><b>P</b> 内墙</div>' +
        '<div><b>D</b> 门</div><div><b>E</b> 擦除</div>' +
        '<div><b>1 / 2</b> 物资箱 / 武器箱</div><div><b>3</b> 露天物资点</div>' +
        '<div><b>4</b> 敌人刷新点</div><div><b>5</b> 玩家出生点</div>' +
        '<div><b>6</b> 撤离点</div><div><b>7</b> 障碍物</div>' +
        '<div><b>Delete</b> 删除选择</div><div><b>Ctrl+D</b> 复制选择</div>' +
        '<div><b>Ctrl+Z / Ctrl+Y</b> 撤销 / 重做</div><div><b>Ctrl+S</b> 保存</div>' +
        '<div><b>F</b> 适应窗口</div><div><b>Esc</b> 取消选择 / 结束当前房屋</div>' +
        '<div><b>Shift+拖动</b> 自由摆放（0.1m 吸附）</div><div><b>滚轮</b> 缩放</div>' +
      '</div>' +
      '<div class="ed-note">房屋外墙自动生成；画成 L / T / 凹形都可以。内墙只能放在同一栋房屋的两个相邻格之间。' +
      '门工具点外墙放外门，点内墙切换内门。' +
      '每张地图至少需要 1 个玩家出生点和 1 个撤离点才能出击。</div>',
      [{ text: '知道了', cls: 'primary' }]);
  }

  /* ================= 弹窗 ================= */
  function openModal(title, body, buttons) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = body;
    el.modalFoot.innerHTML = '';
    (buttons || []).forEach(function (b) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ed-btn ' + (b.cls || '');
      btn.textContent = b.text;
      btn.addEventListener('click', function () {
        if (b.run) b.run();
        else closeModal();
      });
      el.modalFoot.appendChild(btn);
    });
    el.modal.classList.remove('hidden');
  }
  function closeModal() {
    el.modal.classList.add('hidden');
  }

  /* ================= 文件导入导出 ================= */
  function exportMap() {
    saveNow(true);
    const text = MAPSTORE.exportText(map);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (map.name || 'map').replace(/[\\/:*?"<>|]+/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 400);
    toast('已导出地图 JSON', 'good');
  }

  function importMap(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const m = MAPSTORE.importText(String(reader.result));
        MAPSTORE.save(m);
        openMap(m);
        toast('已导入 ' + m.name, 'good');
      } catch (e) {
        toast('导入失败：不是有效的地图 JSON', 'warn');
        console.error(e);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function playtest() {
    if (!saveNow(true)) return;
    const v = MAPSTORE.validate(map);
    if (v.errors.length) {
      const go = confirm('地图还有 ' + v.errors.length + ' 处错误：\n\n' +
        v.errors.slice(0, 5).map(function (i) { return '· ' + i.msg; }).join('\n') +
        '\n\n仍然开始试玩？');
      if (!go) return;
    }
    const url = 'index.html?map=' + encodeURIComponent(map.id) + '&go=mission';
    window.open(url, '_blank', 'noopener');
    toast('已在新标签页打开试玩', 'good');
  }

  /* ================= 键盘 ================= */
  function onKeyDown(e) {
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.code === 'Escape') {
      if (!el.modal.classList.contains('hidden')) { closeModal(); return; }
      if (typing) { e.target.blur(); return; }
      if (activeHouse) { activeHouse = null; updateStatus(); return; }
      if (selection) { selection = null; renderInspector(); return; }
      selectTool('select');
      return;
    }
    if (!el.modal.classList.contains('hidden')) return;
    if (e.code === 'Space') {
      if (!typing) { spaceDown = true; e.preventDefault(); }
      return;
    }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); redo(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault(); saveNow(false); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault(); duplicateSelection(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); deleteSelection(); return;
    }
    if (e.key === 'f' || e.key === 'F') { fitView(); return; }
    if (e.key === 'r' || e.key === 'R') { rotateSelection(); return; }
    const key = e.key.toUpperCase();
    const mapKeys = {
      V: 'select', G: 'floor', X: 'wall', H: 'house', P: 'partition',
      D: 'door', E: 'erase', '1': 'supply', '2': 'weapon', '3': 'loot',
      '4': 'enemy', '5': 'player', '6': 'extract', '7': 'prop'
    };
    if (mapKeys[key]) {
      e.preventDefault();
      selectTool(mapKeys[key]);
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') spaceDown = false;
  }

  /* ================= 启动 ================= */
  function buildTools() {
    el.tools.innerHTML = '';
    TOOLS.forEach(function (t) {
      if (t.sep) {
        const sep = document.createElement('div');
        sep.className = 'ed-tool-sep';
        el.tools.appendChild(sep);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-tool';
      b.dataset.tool = t.id;
      b.title = t.name + (t.key ? ' (' + t.key + ')' : '') + ' · ' + t.hint;
      b.innerHTML = '<span class="ti">' + t.icon + '</span><span class="tn">' + t.name + '</span>' +
        '<span class="tk">' + t.key + '</span>';
      b.addEventListener('click', function () { selectTool(t.id); });
      el.tools.appendChild(b);
    });
    const note = document.createElement('div');
    note.className = 'ed-tool-note';
    note.innerHTML = '滚轮缩放<br>空格 / 中键平移';
    el.tools.appendChild(note);
  }

  function buildLayers() {
    el.layers.innerHTML = '';
    LAYERS.forEach(function (l) {
      layersOn[l.id] = l.on;
      const row = document.createElement('label');
      row.className = 'ed-layer' + (l.on ? ' on' : '');
      row.innerHTML = '<input type="checkbox"' + (l.on ? ' checked' : '') + ' /><span>' + l.name + '</span>';
      const cb = row.querySelector('input');
      cb.addEventListener('change', function () {
        layersOn[l.id] = cb.checked;
        row.classList.toggle('on', cb.checked);
      });
      el.layers.appendChild(row);
    });
  }

  function bindUi() {
    el.name.addEventListener('input', function () {
      map.name = el.name.value.slice(0, 32);
      markDirty();
    });
    $('edNew').addEventListener('click', openNewDialog);
    $('edLib').addEventListener('click', openLibrary);
    $('edSideToggle').addEventListener('click', function () {
      $('edApp').classList.toggle('side-open');
    });
    $('edSave').addEventListener('click', function () { saveNow(false); });
    $('edImport').addEventListener('click', function () { el.file.click(); });
    $('edExport').addEventListener('click', exportMap);
    $('edPlay').addEventListener('click', playtest);
    $('edFit').addEventListener('click', fitView);
    function zoomStep(mul) {
      const s = canvasSize();
      const mid = s2w(s.w * 0.5, s.h * 0.5);
      view.scale = clamp(view.scale * mul, 4, 56);
      centerView(mid.x, mid.z);
      updateZoomLabel();
    }
    $('edZoomIn').addEventListener('click', function () { zoomStep(1.15); });
    $('edZoomOut').addEventListener('click', function () { zoomStep(1 / 1.15); });
    $('edModalClose').addEventListener('click', closeModal);
    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal) closeModal();
    });
    el.file.addEventListener('change', function () {
      if (el.file.files && el.file.files[0]) importMap(el.file.files[0]);
      el.file.value = '';
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { spaceDown = false; drag = null; });
    window.addEventListener('resize', function () { updateZoomLabel(); });
    window.addEventListener('beforeunload', function () {
      if (dirty) saveNow(true);
    });
  }

  function pickInitialMap() {
    const qs = new URLSearchParams(location.search);
    let m = qs.get('map') ? MAPSTORE.get(qs.get('map')) : null;
    if (!m && MAPSTORE.picked()) m = MAPSTORE.get(MAPSTORE.picked());
    if (!m) {
      const list = MAPSTORE.list();
      if (list.length) m = MAPSTORE.get(list[0].id);
    }
    if (!m) m = MAPSTORE.blank('新地图', 44, 44);
    return m;
  }

  function boot() {
    canvas = $('edCanvas');
    ctx = canvas.getContext('2d');
    el.tools = $('edTools');
    el.layers = $('edLayers');
    el.inspector = $('edInspector');
    el.issues = $('edIssues');
    el.validState = $('edValidState');
    el.selKind = $('edSelKind');
    el.name = $('edName');
    el.hint = $('edHint');
    el.zoomLabel = $('edZoomLabel');
    el.statusTool = $('edStatusTool');
    el.statusCursor = $('edStatusCursor');
    el.statusHouse = $('edStatusHouse');
    el.statusCount = $('edStatusCount');
    el.statusSaved = $('edStatusSaved');
    el.modal = $('edModal');
    el.modalTitle = $('edModalTitle');
    el.modalBody = $('edModalBody');
    el.modalFoot = $('edModalFoot');
    el.toast = $('edToast');
    el.file = $('edFile');

    buildTools();
    buildLayers();
    bindUi();
    map = pickInitialMap();
    openMap(map);
    selectTool('select');

    if (location.protocol === 'file:') {
      setTimeout(function () {
        toast('提示：file:// 下试玩可能无法共享本地地图，建议用本地静态服务器打开', 'warn');
      }, 900);
    }

    let last = 0;
    function loop(ts) {
      render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }

  return {
    undo: undo,
    redo: redo,
    save: function () { return saveNow(false); },
    get map() { return map; }
  };
})();
