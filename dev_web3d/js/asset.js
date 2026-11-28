'use strict';

/* ============================================================
   外部资产：Blender 导出的 OBJ / MTL
   - 目前只有可开合物资箱：chest_body / chest_lid
   - 解析成 gl.js Geo.mesh() 需要的每顶点 10 元组
   ============================================================ */

const ASSETS = (function () {
  const V = '20261128d1';
  const DEVICE_IDS = ['armory', 'printer', 'storage', 'fabricator', 'comms', 'teleporter'];
  const chest = {
    ready: false,
    body: null,
    lid: null,
    hinge: [0, 0.615, -0.40],
    openAngle: -1.9,
    lidCenter: [0, 0.74, 0],
    error: null
  };
  const weaponcrate = {
    ready: false,
    body: null,
    lid: null,
    hinge: [0, 0.405, -0.455],
    openAngle: -1.72,
    lidCenter: [0, 0.4525, -0.0163],
    error: null
  };
  /* Blender 安全屋：2m 模块化组件共用一个 OBJ。
     外墙模块外侧朝局部 +Z；门模型原点在铰链，向 +X 延伸。 */
  const house = {
    ready: false,
    wall: null,
    wallWindow: null,
    wallDoor: null,
    door: null,
    corner: null,
    floor: null,
    roofTile: null,
    roofEdge: null,
    roofCorner: null,
    roofUnit: null,
    hinge: [-0.68, 0.0, 0.0],
    openAngle: 1.76,
    error: null
  };
  /* 大厅六个装置：Blender 导出的 OBJ / MTL，每个文件一个整体网格 */
  const devices = { ready: false, list: {}, error: null };
  let loading = null;

  function parseMtl(text) {
    const out = {};
    let cur = null;
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim();
      if (!s || s.charAt(0) === '#') continue;
      const p = s.split(/\s+/);
      if (p[0] === 'newmtl') {
        cur = p.slice(1).join(' ');
        /* 武器剪影保留，但不要用发光材质：跟随正常光照，避免永远是一块纯色 */
        out[cur] = { color: [0.7, 0.7, 0.7], emis: /glow/i.test(cur) && !/gunglow/i.test(cur) };
      } else if (p[0] === 'Kd' && cur) {
        out[cur].color = [
          parseFloat(p[1]) || 0,
          parseFloat(p[2]) || 0,
          parseFloat(p[3]) || 0
        ];
      }
    }
    /* 武器箱盖的武器剪影用普通钢灰，不再使用橙色 */
    for (const k in out) {
      if (/gunglow/i.test(k)) out[k].color = [0.56, 0.59, 0.63];
    }
    return out;
  }

  function groupOf(name) {
    const n = String(name || '').toLowerCase();
    /* wall_solid 末尾的 "lid" 会被下面的 lid 规则误判，先处理墙模块 */
    if (n.indexOf('wall_solid') >= 0) return 'wall';
    if (n.indexOf('wall_door') >= 0) return 'wall_door';
    if (n.indexOf('wall_window') >= 0) return 'wall_window';
    if (n.indexOf('lid') >= 0) return 'lid';
    if (n.indexOf('roof_tile') >= 0) return 'roof_tile';
    if (n.indexOf('roof_edge') >= 0) return 'roof_edge';
    if (n.indexOf('roof_corner') >= 0) return 'roof_corner';
    if (n.indexOf('roof_unit') >= 0) return 'roof_unit';
    if (n.indexOf('wall') >= 0) return 'wall';
    if (n.indexOf('door') >= 0) return 'door';
    if (n.indexOf('floor') >= 0) return 'floor';
    if (n.indexOf('corner') >= 0) return 'corner';
    return 'body';
  }

  function parseObj(text, mtl, keepWinding) {
    const verts = [];
    const faces = [];
    let group = 'body';
    let matName = null;
    const lines = String(text || '').split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim();
      if (!s || s.charAt(0) === '#') continue;
      const p = s.split(/\s+/);
      if (p[0] === 'v') {
        verts.push([parseFloat(p[1]) || 0, parseFloat(p[2]) || 0, parseFloat(p[3]) || 0]);
      } else if (p[0] === 'o' || p[0] === 'g') {
        const n = p.slice(1).join(' ');
        group = groupOf(n);
      } else if (p[0] === 'usemtl') {
        matName = p.slice(1).join(' ');
      } else if (p[0] === 'f') {
        const ids = [];
        for (let k = 1; k < p.length; k++) {
          const a = p[k].split('/')[0];
          let n = parseInt(a, 10);
          if (!isFinite(n) || n === 0) continue;
          ids.push(n < 0 ? verts.length + n : n - 1);
        }
        if (ids.length >= 3) faces.push({ ids: ids, mat: matName, group: group });
      }
    }

    /* 每组质心：用于纠正可能的反向法线/绕序 */
    const centroid = {};
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const c = centroid[f.group] || (centroid[f.group] = [0, 0, 0, 0]);
      for (let k = 0; k < f.ids.length; k++) {
        const v = verts[f.ids[k]];
        if (!v) continue;
        c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; c[3]++;
      }
    }
    for (const k in centroid) {
      if (centroid[k][3] > 0) {
        centroid[k][0] /= centroid[k][3];
        centroid[k][1] /= centroid[k][3];
        centroid[k][2] /= centroid[k][3];
      }
    }

    const groups = {};
    const orient = {};
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const arr = groups[f.group] || (groups[f.group] = []);
      if (orient[f.group] === undefined) orient[f.group] = 0;
      const c = (mtl && mtl[f.mat]) ? mtl[f.mat] : { color: [0.62, 0.62, 0.62], emis: false };
      const cen = centroid[f.group] || [0, 0, 0];
      const a = verts[f.ids[0]];
      if (!a) continue;
      for (let k = 1; k + 1 < f.ids.length; k++) {
        const b = verts[f.ids[k]];
        const d = verts[f.ids[k + 1]];
        if (!b || !d) continue;
        let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        let vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9) continue;
        nx /= nl; ny /= nl; nz /= nl;
        /* 保持原始绕序；只统计整组朝向，避免逐面翻转导致相邻面法线相反 */
        const fcx = (a[0] + b[0] + d[0]) / 3 - cen[0];
        const fcy = (a[1] + b[1] + d[1]) / 3 - cen[1];
        const fcz = (a[2] + b[2] + d[2]) / 3 - cen[2];
        orient[f.group] += (nx * fcx + ny * fcy + nz * fcz) >= 0 ? 1 : -1;
        const emis = c.emis ? 1 : 0;
        arr.push(a[0], a[1], a[2], nx, ny, nz, c.color[0], c.color[1], c.color[2], emis);
        arr.push(b[0], b[1], b[2], nx, ny, nz, c.color[0], c.color[1], c.color[2], emis);
        arr.push(d[0], d[1], d[2], nx, ny, nz, c.color[0], c.color[1], c.color[2], emis);
      }
    }
    /* 整组法线朝内时统一翻转：反转绕序并取反法线。
       Blender 直接导出的多盒体网格绕序正确，可用 keepWinding 跳过该启发式。 */
    if (!keepWinding) {
      for (const g in groups) {
        if (orient[g] >= 0) continue;
        const arr = groups[g];
        for (let i = 0; i + 29 < arr.length; i += 30) {
          for (let k = 0; k < 10; k++) {
            const tmp = arr[i + 10 + k];
            arr[i + 10 + k] = arr[i + 20 + k];
            arr[i + 20 + k] = tmp;
          }
          arr[i + 3] = -arr[i + 3]; arr[i + 4] = -arr[i + 4]; arr[i + 5] = -arr[i + 5];
          arr[i + 13] = -arr[i + 13]; arr[i + 14] = -arr[i + 14]; arr[i + 15] = -arr[i + 15];
          arr[i + 23] = -arr[i + 23]; arr[i + 24] = -arr[i + 24]; arr[i + 25] = -arr[i + 25];
        }
      }
    }
    return groups;
  }

  function boundsOf(data) {
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < data.length; i += 10) {
      const x = data[i], y = data[i + 1], z = data[i + 2];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    return {
      center: [(mnx + mxx) * 0.5, (mny + mxy) * 0.5, (mnz + mxz) * 0.5],
      size: [mxx - mnx, mxy - mny, mxz - mnz]
    };
  }

  function get(url) { return fetch(url, { cache: 'no-cache' }); }

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      get('assets/chest/chest.obj?v=' + V).then(function (r) {
        if (!r.ok) throw new Error('chest.obj ' + r.status);
        return r.text();
      }),
      get('assets/chest/chest.mtl?v=' + V).then(function (r) {
        return r.ok ? r.text() : '';
      }).catch(function () { return ''; }),
      get('assets/chest/chest.json?v=' + V).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }),
      get('assets/weaponcrate/weaponcrate.obj?v=' + V).then(function (r) {
        if (!r.ok) throw new Error('weaponcrate.obj ' + r.status);
        return r.text();
      }),
      get('assets/weaponcrate/weaponcrate.mtl?v=' + V).then(function (r) {
        return r.ok ? r.text() : '';
      }).catch(function () { return ''; }),
      get('assets/weaponcrate/weaponcrate.json?v=' + V).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }),
      get('assets/house/house.obj?v=' + V).then(function (r) {
        if (!r.ok) throw new Error('house.obj ' + r.status);
        return r.text();
      }),
      get('assets/house/house.mtl?v=' + V).then(function (r) {
        return r.ok ? r.text() : '';
      }).catch(function () { return ''; }),
      get('assets/house/house.json?v=' + V).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; }),
      Promise.all(DEVICE_IDS.map(function (id) {
        return Promise.all([
          get('assets/devices/' + id + '.obj?v=' + V).then(function (r) {
            if (!r.ok) throw new Error(id + '.obj ' + r.status);
            return r.text();
          }).catch(function () { return null; }),
          get('assets/devices/' + id + '.mtl?v=' + V).then(function (r) {
            return r.ok ? r.text() : '';
          }).catch(function () { return ''; })
        ]);
      }))
    ]).then(function (res) {
      function assign(target, objText, mtlText, json) {
        const mtl = parseMtl(mtlText);
        const groups = parseObj(objText, mtl);
        target.body = groups.body;
        target.lid = groups.lid;
        if (target.body && target.body.length) target.bodyCenter = boundsOf(target.body).center;
        if (target.lid && target.lid.length) {
          const lb = boundsOf(target.lid);
          target.lidCenter = lb.center;
          target.lidSize = lb.size;
        }
        if (json) {
          if (Array.isArray(json.hinge) && json.hinge.length === 3) target.hinge = json.hinge;
          if (typeof json.openAngle === 'number') target.openAngle = json.openAngle;
          if (Array.isArray(json.lidCenter) && json.lidCenter.length === 3) target.lidCenter = json.lidCenter;
        }
        target.ready = !!(target.body && target.body.length && target.lid && target.lid.length);
        return target;
      }
      function assignHouse(target, objText, mtlText, json) {
        const mtl = parseMtl(mtlText);
        const groups = parseObj(objText, mtl);
        target.wall = groups.wall;
        target.wallWindow = groups.wall_window || groups.wall;
        target.wallDoor = groups.wall_door;
        target.door = groups.door;
        target.corner = groups.corner;
        target.floor = groups.floor;
        target.roofTile = groups.roof_tile;
        target.roofEdge = groups.roof_edge;
        target.roofCorner = groups.roof_corner;
        target.roofUnit = groups.roof_unit;
        if (json) {
          const h = json.hinge || json.doorHinge;
          if (Array.isArray(h) && h.length === 3) target.hinge = h;
          if (typeof json.openAngle === 'number') target.openAngle = json.openAngle;
          if (typeof json.doorOpenAngle === 'number') target.openAngle = json.doorOpenAngle;
        }
        target.ready = !!(target.wall && target.wall.length &&
          target.wallDoor && target.wallDoor.length &&
          target.door && target.door.length &&
          target.corner && target.corner.length &&
          target.floor && target.floor.length &&
          target.roofTile && target.roofTile.length);
        return target;
      }
      assign(chest, res[0], res[1], res[2]);
      assign(weaponcrate, res[3], res[4], res[5]);
      assignHouse(house, res[6], res[7], res[8]);
      const devRes = Array.isArray(res[9]) ? res[9] : [];
      for (let i = 0; i < DEVICE_IDS.length; i++) {
        const pair = devRes[i] || [];
        if (!pair[0]) continue;
        const groups = parseObj(pair[0], parseMtl(pair[1]), true);
        let arr = [];
        for (const k in groups) {
          for (let j = 0; j < groups[k].length; j++) arr.push(groups[k][j]);
        }
        if (arr.length) devices.list[DEVICE_IDS[i]] = arr;
      }
      devices.ready = DEVICE_IDS.every(function (id) {
        return !!(devices.list[id] && devices.list[id].length);
      });
      return { chest: chest, weaponcrate: weaponcrate, house: house, devices: devices };
    }).catch(function (err) {
      chest.error = String(err);
      weaponcrate.error = String(err);
      house.error = String(err);
      devices.error = String(err);
      chest.ready = false;
      weaponcrate.ready = false;
      house.ready = false;
      devices.ready = false;
      return { chest: chest, weaponcrate: weaponcrate, house: house, devices: devices };
    });
    return loading;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', load);
    else load();
  }

  return {
    chest: chest,
    weaponcrate: weaponcrate,
    house: house,
    devices: devices,
    load: load
  };
})();
