'use strict';

/* ============================================================
   自定义地图：数据格式 / 本地存档 / 校验
   - 编辑器与游戏共用这一份格式
   - 2m 网格；地板格为 1，实体 / 空地格为 0
   - 房屋由若干 2m 格子组成，可画成任意正交轮廓（L / T / 凹形）
   - 外墙沿房屋格子边界自动生成，内墙 / 门由 designer 显式放置
   ============================================================ */

const MAPSTORE = (function () {
  const KEY = 'eofata3d.maps.v1';
  const PICK_KEY = 'eofata3d.mapPick';
  const VERSION = 1;
  const CELL = (typeof CFG !== 'undefined' && CFG.CELL) ? CFG.CELL : 2.0;

  const DIRS = {
    front: { dx: 0, dz: 1, nx: 0, nz: 1, yaw: 0, name: '前' },
    right: { dx: 1, dz: 0, nx: 1, nz: 0, yaw: Math.PI * 0.5, name: '右' },
    back: { dx: 0, dz: -1, nx: 0, nz: -1, yaw: Math.PI, name: '后' },
    left: { dx: -1, dz: 0, nx: -1, nz: 0, yaw: -Math.PI * 0.5, name: '左' }
  };
  const DIR_KEYS = ['front', 'right', 'back', 'left'];
  const OPPOSITE = { front: 'back', right: 'left', back: 'front', left: 'right' };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, def) { return isFinite(v) ? +v : def; }
  function uid(prefix) {
    return (prefix || 'map') + '_' + Date.now().toString(36) + '_' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function blank(name, cols, rows) {
    cols = clamp((cols | 0) || 44, 16, 96);
    rows = clamp((rows | 0) || 44, 16, 96);
    const floor = [];
    for (let z = 0; z < rows; z++) {
      let row = '';
      for (let x = 0; x < cols; x++) row += '1';
      floor.push(row);
    }
    return normalize({
      version: VERSION,
      id: uid('map'),
      name: name || '未命名地图',
      cols: cols,
      rows: rows,
      cell: CELL,
      floor: floor,
      houses: [],
      props: [],
      chests: [],
      loot: [],
      enemies: [],
      playerSpawns: [],
      extractions: []
    });
  }

  /* ---------- 网格坐标 ---------- */
  function inBounds(map, cx, cz) {
    return cx >= 0 && cz >= 0 && cx < map.cols && cz < map.rows;
  }
  function cellValue(map, cx, cz) {
    if (!inBounds(map, cx, cz)) return 0;
    const row = map.floor[cz];
    return row && row.charAt(cx) === '1' ? 1 : 0;
  }
  function setCellValue(map, cx, cz, v) {
    if (!inBounds(map, cx, cz)) return;
    const row = (map.floor[cz] || '').split('');
    while (row.length < map.cols) row.push('0');
    row[cx] = v ? '1' : '0';
    map.floor[cz] = row.join('');
  }
  function cellCenter(cx, cz) {
    return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL };
  }
  function worldToCell(x, z) {
    return { cx: Math.floor(x / CELL), cz: Math.floor(z / CELL) };
  }
  function onFloor(map, x, z) {
    const c = worldToCell(x, z);
    return cellValue(map, c.cx, c.cz) === 1;
  }

  /* ---------- 房屋 ---------- */
  function houseCellKey(cx, cz) { return cx + ',' + cz; }
  function houseHasCell(house, cx, cz) {
    const list = house.cells || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if ((Array.isArray(c) ? c[0] : c.cx) === cx &&
          (Array.isArray(c) ? c[1] : c.cz) === cz) return true;
    }
    return false;
  }
  function canonicalEdge(cx, cz, dir) {
    if (dir === 'back') return { cx: cx, cz: cz - 1, dir: 'front' };
    if (dir === 'left') return { cx: cx - 1, cz: cz, dir: 'right' };
    return { cx: cx, cz: cz, dir: dir };
  }
  /* 共享边的唯一键：front = 当前格与 +z 邻格；right = 当前格与 +x 邻格 */
  function edgeKey(cx, cz, dir) {
    const c = canonicalEdge(cx, cz, dir);
    return c.cx + ',' + c.cz + ',' + c.dir;
  }

  function houseCells(house) {
    const out = [];
    (house.cells || []).forEach(function (c) {
      const cx = Array.isArray(c) ? c[0] : c.cx;
      const cz = Array.isArray(c) ? c[1] : c.cz;
      if (isFinite(cx) && isFinite(cz)) out.push({ cx: cx | 0, cz: cz | 0 });
    });
    return out;
  }

  function houseBounds(house) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    houseCells(house).forEach(function (c) {
      if (c.cx < minX) minX = c.cx;
      if (c.cz < minZ) minZ = c.cz;
      if (c.cx > maxX) maxX = c.cx;
      if (c.cz > maxZ) maxZ = c.cz;
    });
    if (!isFinite(minX)) return null;
    return {
      minX: minX, minZ: minZ, maxX: maxX, maxZ: maxZ,
      w: maxX - minX + 1, d: maxZ - minZ + 1
    };
  }

  /* 全图格子归属：key -> house */
  function cellOwners(map) {
    const owners = {};
    (map.houses || []).forEach(function (h) {
      houseCells(h).forEach(function (c) {
        owners[houseCellKey(c.cx, c.cz)] = h;
      });
    });
    return owners;
  }

  function hasBoundaryDoor(house, cx, cz, dir) {
    const list = house.doors || [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.cx === cx && d.cz === cz && d.dir === dir) return true;
    }
    return false;
  }

  function partitionAt(house, cx, cz, dir) {
    const key = edgeKey(cx, cz, dir);
    const list = house.partitions || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (edgeKey(p.cx, p.cz, p.dir) === key) return p;
    }
    return null;
  }

  /* ---------- 规范化 / 导入容错 ---------- */
  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const cols = clamp((src.cols | 0) || 44, 16, 96);
    const rows = clamp((src.rows | 0) || 44, 16, 96);
    const map = {
      version: VERSION,
      id: src.id || uid('map'),
      name: String(src.name || '未命名地图').slice(0, 48),
      cols: cols,
      rows: rows,
      cell: CELL,
      floor: [],
      houses: [],
      props: [],
      chests: [],
      loot: [],
      enemies: [],
      playerSpawns: [],
      extractions: []
    };

    let rowsIn = src.floor;
    if (typeof rowsIn === 'string') rowsIn = rowsIn.split(/\r?\n/);
    if (!Array.isArray(rowsIn)) rowsIn = [];
    for (let z = 0; z < rows; z++) {
      let row = rowsIn[z] === undefined ? '' : String(rowsIn[z]);
      let out = '';
      for (let x = 0; x < cols; x++) out += row.charAt(x) === '0' ? '0' : '1';
      map.floor.push(out);
    }

    (Array.isArray(src.houses) ? src.houses : []).forEach(function (h, hi) {
      if (!h) return;
      const house = {
        id: h.id || ('h' + hi),
        name: String(h.name || ('房屋 ' + (hi + 1))).slice(0, 32),
        cells: [],
        doors: [],
        partitions: []
      };
      const seen = {};
      houseCells(h).forEach(function (c) {
        if (!inBounds(map, c.cx, c.cz)) return;
        const k = houseCellKey(c.cx, c.cz);
        if (seen[k]) return;
        seen[k] = 1;
        house.cells.push([c.cx, c.cz]);
        setCellValue(map, c.cx, c.cz, 1);
      });
      (Array.isArray(h.doors) ? h.doors : []).forEach(function (d) {
        if (!d || DIRS[d.dir] === undefined) return;
        const cx = num(d.cx, NaN) | 0, cz = num(d.cz, NaN) | 0;
        if (!houseHasCell(house, cx, cz)) return;
        const key = cx + ',' + cz + ',' + d.dir;
        if (house.doors.some(function (o) { return (o.cx + ',' + o.cz + ',' + o.dir) === key; })) return;
        house.doors.push({ cx: cx, cz: cz, dir: d.dir });
      });
      (Array.isArray(h.partitions) ? h.partitions : []).forEach(function (p) {
        if (!p || DIRS[p.dir] === undefined) return;
        const c = canonicalEdge(p.cx | 0, p.cz | 0, p.dir);
        if (!houseHasCell(house, c.cx, c.cz)) return;
        const n = DIRS[c.dir];
        if (!houseHasCell(house, c.cx + n.dx, c.cz + n.dz)) return;
        if (partitionAt(house, c.cx, c.cz, c.dir)) return;
        house.partitions.push({ cx: c.cx, cz: c.cz, dir: c.dir, door: !!p.door });
      });
      if (house.cells.length) map.houses.push(house);
    });

    function putPoint(list, p, fields) {
      if (!p) return null;
      const x = num(p.x, NaN), z = num(p.z, NaN);
      if (!isFinite(x) || !isFinite(z) || !inBounds(map, Math.floor(x / CELL), Math.floor(z / CELL))) return null;
      const o = { x: x, z: z };
      for (const k in fields) {
        if (fields.hasOwnProperty(k)) o[k] = p[k] === undefined ? fields[k] : p[k];
      }
      list.push(o);
      return o;
    }

    (Array.isArray(src.props) ? src.props : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.props, p, { kind: 'crate', rot: 0 });
      if (!o) return;
      o.kind = p.kind === 'barrel' ? 'barrel' : 'crate';
      o.rot = num(p.rot, 0);
      o.h = num(p.h, o.kind === 'crate' ? 1.1 : 0.8);
      o.cr = num(p.cr, o.kind === 'crate' ? 0.72 : 0.45);
    });

    (Array.isArray(src.chests) ? src.chests : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.chests, p, { type: 'supply', yaw: 0, luck: 0.5 });
      if (!o) return;
      o.type = p.type === 'weapon' ? 'weapon' : 'supply';
      o.yaw = num(p.yaw, 0);
      o.luck = clamp(num(p.luck, 0.5), 0, 1);
    });

    (Array.isArray(src.loot) ? src.loot : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.loot, p, { luck: 0.5, kind: 'auto' });
      if (!o) return;
      o.luck = clamp(num(p.luck, 0.5), 0, 1);
      o.kind = (p.kind === 'case' || p.kind === 'canister') ? p.kind : 'auto';
    });

    (Array.isArray(src.enemies) ? src.enemies : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.enemies, p, { type: 'zombie', count: 1, radius: 4, faction: '' });
      if (!o) return;
      let type = String(p.type || 'zombie');
      /* 拾荒者是一种类别，具体皮肤由游戏在生成时随机决定 */
      if (type === 'raider' || type === 'veteran') type = 'scav';
      o.type = type;
      o.count = clamp(num(p.count, 1) | 0, 1, 40);
      o.radius = clamp(num(p.radius, 4), 0, 24);
      o.faction = p.faction === 'scav' || p.faction === 'undead' ? p.faction : '';
    });

    (Array.isArray(src.playerSpawns) ? src.playerSpawns : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.playerSpawns, p, { yaw: 0 });
      if (o) o.yaw = num(p.yaw, 0);
    });

    (Array.isArray(src.extractions) ? src.extractions : []).forEach(function (p) {
      if (!p) return;
      const o = putPoint(map.extractions, p, { r: CFG_EXTRACT_R(), hold: CFG_EXTRACT_HOLD() });
      if (!o) return;
      o.r = clamp(num(p.r, CFG_EXTRACT_R()), 1.5, 8);
      o.hold = clamp(num(p.hold, CFG_EXTRACT_HOLD()), 1, 20);
    });

    map.updatedAt = num(src.updatedAt, Date.now());
    return map;
  }

  /* 把每栋房屋外接矩形内、不属于任何房屋的格子清空。
     用于修复旧地图和保证非矩形房屋的地板 / 屋顶与轮廓一致。 */
  function carveHouseFloors(map) {
    if (!map || !Array.isArray(map.houses) || !map.houses.length) return false;
    const owned = {};
    map.houses.forEach(function (h) {
      houseCells(h).forEach(function (c) {
        owned[houseCellKey(c.cx, c.cz)] = 1;
      });
    });
    let changed = false;
    map.houses.forEach(function (h) {
      const b = houseBounds(h);
      if (!b) return;
      for (let cz = b.minZ; cz <= b.maxZ; cz++) {
        for (let cx = b.minX; cx <= b.maxX; cx++) {
          if (!inBounds(map, cx, cz)) continue;
          if (owned[houseCellKey(cx, cz)]) continue;
          if (cellValue(map, cx, cz) === 1) {
            setCellValue(map, cx, cz, 0);
            changed = true;
          }
        }
      }
    });
    return changed;
  }

  function CFG_EXTRACT_R() {
    return (typeof CFG !== 'undefined' && CFG.EXTRACT_R) ? CFG.EXTRACT_R : 3.2;
  }
  function CFG_EXTRACT_HOLD() {
    return (typeof CFG !== 'undefined' && CFG.EXTRACT_HOLD) ? CFG.EXTRACT_HOLD : 6.0;
  }

  /* ---------- 校验 ---------- */
  function pointIssue(map, p, label) {
    if (!onFloor(map, p.x, p.z)) return { level: 'error', msg: label + ' 落在墙体 / 空地格上', ref: p };
    return null;
  }

  function validate(map) {
    const issues = [];
    const cells = cellOwners(map);
    let walkable = 0;
    for (let z = 0; z < map.rows; z++) {
      for (let x = 0; x < map.cols; x++) if (cellValue(map, x, z)) walkable++;
    }
    if (!walkable) issues.push({ level: 'error', msg: '地图没有任何可通行地板' });
    if (!map.playerSpawns.length) issues.push({ level: 'error', msg: '缺少玩家出生点' });
    if (!map.extractions.length) issues.push({ level: 'error', msg: '缺少撤离点' });

    const ownerSeen = {};
    map.houses.forEach(function (h) {
      houseCells(h).forEach(function (c) {
        if (!inBounds(map, c.cx, c.cz)) {
          issues.push({ level: 'error', msg: '房屋 ' + (h.name || h.id) + ' 有格子超出地图边界', ref: h });
          return;
        }
        if (!cellValue(map, c.cx, c.cz)) {
          issues.push({ level: 'error', msg: '房屋 ' + (h.name || h.id) + ' 的格子不是地板', ref: h });
        }
        const k = houseCellKey(c.cx, c.cz);
        if (ownerSeen[k] && ownerSeen[k] !== h) {
          issues.push({ level: 'error', msg: '两栋房屋占用了同一格 ' + k, ref: h });
        }
        ownerSeen[k] = h;
      });
      (h.doors || []).forEach(function (d) {
        if (!houseHasCell(h, d.cx, d.cz)) {
          issues.push({ level: 'warn', msg: '外门不在房屋边界上', ref: h });
          return;
        }
        const n = DIRS[d.dir];
        if (houseHasCell(h, d.cx + n.dx, d.cz + n.dz)) {
          issues.push({ level: 'warn', msg: '外门位于两格房屋之间，应使用内门', ref: h });
        }
      });
      (h.partitions || []).forEach(function (p) {
        const n = DIRS[p.dir];
        if (!houseHasCell(h, p.cx, p.cz) || !houseHasCell(h, p.cx + n.dx, p.cz + n.dz)) {
          issues.push({ level: 'warn', msg: '内墙没有连接同一栋房屋的两个格子', ref: h });
        }
      });
    });

    const points = [
      [map.chests, '物资箱'], [map.loot, '露天物资点'],
      [map.enemies, '敌人刷新点'], [map.playerSpawns, '玩家出生点'], [map.extractions, '撤离点']
    ];
    points.forEach(function (pair) {
      pair[0].forEach(function (p) {
        const issue = pointIssue(map, p, pair[1]);
        if (issue) issues.push(issue);
      });
    });
    map.props.forEach(function (p) {
      const issue = pointIssue(map, p, '障碍物');
      if (issue) issues.push(issue);
    });

    /* 出生点 / 撤离点 / 刷怪点不要叠在同一个位置 */
    map.enemies.forEach(function (e) {
      map.playerSpawns.forEach(function (s) {
        if (Math.hypot(e.x - s.x, e.z - s.z) < 3) {
          issues.push({ level: 'warn', msg: '敌人刷新点离玩家出生点太近（<3m）', ref: e });
        }
      });
    });

    const errors = issues.filter(function (i) { return i.level === 'error'; });
    const warns = issues.filter(function (i) { return i.level === 'warn'; });
    return { issues: issues, errors: errors, warnings: warns };
  }

  /* ---------- 本地存档 ---------- */
  function loadAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { version: VERSION, maps: {} };
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return { version: VERSION, maps: {} };
      if (!obj.maps) obj.maps = {};
      return obj;
    } catch (e) {
      return { version: VERSION, maps: {} };
    }
  }
  function persistAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; }
    catch (e) { return false; }
  }
  function list() {
    const all = loadAll();
    const out = [];
    for (const id in all.maps) {
      if (!all.maps.hasOwnProperty(id)) continue;
      const m = all.maps[id];
      out.push({
        id: id,
        name: m.name || '未命名地图',
        cols: m.cols || 44,
        rows: m.rows || 44,
        updatedAt: m.updatedAt || 0,
        houses: (m.houses || []).length
      });
    }
    out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return out;
  }
  function get(id) {
    if (!id) return null;
    const all = loadAll();
    if (!all.maps[id]) return null;
    const m = normalize(all.maps[id]);
    m.id = id;
    return m;
  }
  function save(map) {
    const m = normalize(map);
    if (!m.id) m.id = uid('map');
    m.updatedAt = Date.now();
    const all = loadAll();
    all.maps[m.id] = m;
    all.version = VERSION;
    if (!persistAll(all)) return null;
    map.id = m.id;
    map.updatedAt = m.updatedAt;
    return m;
  }
  function remove(id) {
    const all = loadAll();
    if (!all.maps[id]) return false;
    delete all.maps[id];
    persistAll(all);
    if (picked() === id) setPicked('');
    return true;
  }
  function duplicate(id, name) {
    const m = get(id);
    if (!m) return null;
    m.id = uid('map');
    m.name = name || (m.name + ' 副本');
    m.updatedAt = Date.now();
    return save(m);
  }
  function picked() {
    try { return localStorage.getItem(PICK_KEY) || ''; } catch (e) { return ''; }
  }
  function setPicked(id) {
    try { localStorage.setItem(PICK_KEY, id || ''); } catch (e) {}
  }
  function exportText(map) {
    return JSON.stringify(normalize(map), null, 2);
  }
  function importText(text) {
    const obj = JSON.parse(text);
    const m = normalize(obj);
    m.id = uid('map');
    m.name = (obj && obj.name ? String(obj.name) : m.name) + ' (导入)';
    m.updatedAt = Date.now();
    return m;
  }

  return {
    KEY: KEY,
    PICK_KEY: PICK_KEY,
    VERSION: VERSION,
    CELL: CELL,
    DIRS: DIRS,
    DIR_KEYS: DIR_KEYS,
    OPPOSITE: OPPOSITE,
    blank: blank,
    normalize: normalize,
    validate: validate,
    list: list,
    get: get,
    save: save,
    remove: remove,
    duplicate: duplicate,
    picked: picked,
    setPicked: setPicked,
    exportText: exportText,
    importText: importText,
    uid: uid,
    inBounds: inBounds,
    cellValue: cellValue,
    setCellValue: setCellValue,
    cellCenter: cellCenter,
    worldToCell: worldToCell,
    onFloor: onFloor,
    houseCells: houseCells,
    houseBounds: houseBounds,
    houseHasCell: houseHasCell,
    carveHouseFloors: carveHouseFloors,
    cellOwners: cellOwners,
    canonicalEdge: canonicalEdge,
    edgeKey: edgeKey,
    hasBoundaryDoor: hasBoundaryDoor,
    partitionAt: partitionAt
  };
})();
