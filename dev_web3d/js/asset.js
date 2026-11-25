'use strict';

/* ============================================================
   外部资产：Blender 导出的 OBJ / MTL
   - 目前只有可开合物资箱：chest_body / chest_lid
   - 解析成 gl.js Geo.mesh() 需要的每顶点 10 元组
   ============================================================ */

const ASSETS = (function () {
  const V = '20261128z10';
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
        out[cur] = { color: [0.7, 0.7, 0.7], emis: /glow/i.test(cur) };
      } else if (p[0] === 'Kd' && cur) {
        out[cur].color = [
          parseFloat(p[1]) || 0,
          parseFloat(p[2]) || 0,
          parseFloat(p[3]) || 0
        ];
      }
    }
    return out;
  }

  function parseObj(text, mtl) {    const verts = [];
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
        const n = p.slice(1).join(' ').toLowerCase();
        group = n.indexOf('lid') >= 0 ? 'lid' : 'body';
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
    const centroid = { body: [0, 0, 0, 0], lid: [0, 0, 0, 0] };
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

    const groups = { body: [], lid: [] };
    const orient = { body: 0, lid: 0 };
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const arr = groups[f.group] || groups.body;
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
    /* 整组法线朝内时统一翻转：反转绕序并取反法线 */
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
      }).catch(function () { return null; })
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
      assign(chest, res[0], res[1], res[2]);
      assign(weaponcrate, res[3], res[4], res[5]);
      return { chest: chest, weaponcrate: weaponcrate };
    }).catch(function (err) {
      chest.error = String(err);
      weaponcrate.error = String(err);
      chest.ready = false;
      weaponcrate.ready = false;
      return { chest: chest, weaponcrate: weaponcrate };
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
    load: load
  };
})();
