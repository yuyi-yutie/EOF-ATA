'use strict';

/* ============================================================
   小地图：本地雷达（北向上）
   - 以玩家为中心，显示固定半径内的地板 / 墙体 / 物资 / 敌人 / 撤离点
   - 撤离点、刷新点超出范围时贴在圆环边缘做方向指示
   - 静态地图一次性烘焙成贴图，每帧只做一次缩放绘制
   ============================================================ */

const MINIMAP = (function () {
  const CELL = CFG.CELL;
  const RANGE = 27;          // 雷达半径（米）
  const TEX_CELL = 6;        // 静态贴图每格像素
  const TAU = Math.PI * 2;

  const COL = {
    bg: '#05070a',
    wall: '#0c1013',
    floor: '#232b32',
    floorAlt: '#1d242a',
    grid: 'rgba(240,236,226,.055)',
    ring: 'rgba(240,236,226,.22)',
    prop: 'rgba(120,142,152,.5)',
    player: '#ffe6b0',
    playerEdge: 'rgba(6,9,11,.85)',
    enemy: '#e2604f',
    pad: '#f0b04c',
    respawn: '#6fd8ef',
    loadout: '#b7f3ff'
  };

  let cv = null, ctx = null;
  let tex = null, texW = 0, texH = 0;
  let size = 0;              // CSS 像素边长
  let dpr = 1;
  let ready = false;
  let blinkT = 0;

  function init(canvas) {
    cv = canvas;
    if (!cv) return;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () {
      window.setTimeout(resize, 120);
    });
  }

  function resize() {
    if (!cv || !ctx) return;
    const r = cv.getBoundingClientRect();
    const s = Math.round(Math.min(r.width, r.height));
    if (s < 8) { size = 0; return; }
    size = s;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  /* 根据当前 World 的地板格烘焙一张静态贴图 */
  function build() {
    const W = World.W, H = World.H;
    if (!W || !H) { ready = false; return; }
    texW = W * TEX_CELL;
    texH = H * TEX_CELL;
    tex = document.createElement('canvas');
    tex.width = texW;
    tex.height = texH;
    const g = tex.getContext('2d');

    g.fillStyle = COL.wall;
    g.fillRect(0, 0, texW, texH);

    for (let cz = 0; cz < H; cz++) {
      for (let cx = 0; cx < W; cx++) {
        if (!World.isFloor(cx, cz)) continue;
        const h = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
        g.fillStyle = (h % 7 === 0) ? COL.floorAlt : COL.floor;
        g.fillRect(cx * TEX_CELL, cz * TEX_CELL, TEX_CELL, TEX_CELL);
      }
    }

    /* 安全屋墙体烘焙到静态地图：门洞会自然留下地板色缺口 */
    const houses = World.houses || [];
    g.fillStyle = COL.wall;
    for (let hi = 0; hi < houses.length; hi++) {
      const walls = houses[hi].walls;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const c = Math.cos(w.yaw), s = Math.sin(w.yaw);
        const pts = [
          [-w.hx, -w.hz], [w.hx, -w.hz], [w.hx, w.hz], [-w.hx, w.hz]
        ];
        g.beginPath();
        for (let k = 0; k < pts.length; k++) {
          const wx = w.x + c * pts[k][0] + s * pts[k][1];
          const wz = w.z - s * pts[k][0] + c * pts[k][1];
          const px = wx / CELL * TEX_CELL;
          const py = wz / CELL * TEX_CELL;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }

    ready = true;
    blinkT = 0;
  }

  function tierColor(item) {
    try {
      return ITEMS.tier(item ? item.tierId : 'common').color;
    } catch (e) {
      return '#9aa4ad';
    }
  }

  function diamond(x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function draw(dt) {
    if (!ctx) return;
    if (!size && cv) resize();
    if (!size) return;
    if (typeof G === 'undefined' || !G.state || !G.state.player) return;
    if (G.mode !== 'mission') return;

    const p = G.state.player;
    blinkT += dt || 0;
    if (blinkT > 1000) blinkT = 0;

    const cx = size * 0.5;
    const cy = size * 0.5;
    const R = size * 0.5 - 1;
    const S = size / (RANGE * 2);          // 像素 / 米

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, TAU);
    ctx.clip();

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, size, size);

    /* 静态地图 */
    if (ready && tex) {
      const ox = cx - p.x * S;
      const oy = cy - p.z * S;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(tex, 0, 0, texW, texH, ox, oy, World.W * CELL * S, World.H * CELL * S);
      ctx.globalAlpha = 1;
    }

    /* 雷达圈与十字线 */
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    function w2s(x, z) {
      return { x: cx + (x - p.x) * S, y: cy + (z - p.z) * S };
    }

    /* 道具 */
    for (const pr of World.props) {
      const q = w2s(pr.x, pr.z);
      if (Math.hypot(q.x - cx, q.y - cy) > R - 2) continue;
      const s = Math.max(1.6, (pr.cr || 0.4) * S * 1.5);
      ctx.fillStyle = COL.prop;
      ctx.fillRect(q.x - s * 0.5, q.y - s * 0.5, s, s);
    }

    /* 物资：只显示玩家视野内的收集物 */
    for (const l of World.loot) {
      if (l.taken || !l.inVision) continue;
      const q = w2s(l.x, l.z);
      if (Math.hypot(q.x - cx, q.y - cy) > R - 3) continue;
      ctx.fillStyle = tierColor(l.item);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.7, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 物资箱：未开为暗琥珀，开过后为亮琥珀 */
    if (World.chests) {
      for (const c of World.chests) {
        if (c.corpse) continue;
        const q = w2s(c.x, c.z);
        if (Math.hypot(q.x - cx, q.y - cy) > R - 4) continue;
        const s = 3.4;
        ctx.fillStyle = c.pried ? '#f0b04c' : '#9a6a2e';
        ctx.fillRect(q.x - s * 0.5, q.y - s * 0.5, s, s);
        ctx.strokeStyle = 'rgba(6,9,11,.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(q.x - s * 0.5, q.y - s * 0.5, s, s);
      }
    }

    /* 撤离点 / 刷新点：范围内画菱形，范围外贴边指方向 */
    const marks = [];
    const pads = (World.pads && World.pads.length) ? World.pads : (World.pad ? [World.pad] : []);
    for (let pi = 0; pi < pads.length; pi++) {
      marks.push({ x: pads[pi].x, z: pads[pi].z, c: COL.pad });
    }
    if (World.respawn) marks.push({ x: World.respawn.x, z: World.respawn.z, c: COL.respawn });
    if (World.test && World.test.loadout) {
      marks.push({ x: World.test.loadout.x, z: World.test.loadout.z, c: COL.loadout });
    }
    for (const m of marks) {
      const q = w2s(m.x, m.z);
      const dx = q.x - cx, dy = q.y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= R - 7) {
        diamond(q.x, q.y, 4.6, m.c);
        ctx.strokeStyle = 'rgba(6,9,11,.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const k = (R - 8) / (d || 1);
        const ex = cx + dx * k, ey = cy + dy * k;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
        ctx.fillStyle = m.c;
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4, 3);
        ctx.lineTo(-4, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    /* 敌人 */
    const pulse = 0.55 + 0.45 * Math.sin(blinkT * 5);
    for (const en of G.state.enemies) {
      if (en.dead || en.inVision !== true) continue;
      const q = w2s(en.x, en.z);
      if (Math.hypot(q.x - cx, q.y - cy) > R - 3) continue;
      const r = en.type === 'spitter' ? 2.6 : (en.type === 'gaunt' ? 2.2 : 2.0);
      const col = en.relation === 'neutral' ? '#e8c04c'
        : (en.relation === 'friendly' ? '#5ad46a' : COL.enemy);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.18 + 0.22 * pulse;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r + 2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 玩家视野范围：120° 视锥，与 3D 遮罩一致 */
    const lookYaw = (p.headWorldYaw !== undefined) ? p.headWorldYaw : p.yaw;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const ang = Math.atan2(Math.cos(lookYaw), Math.sin(lookYaw));
    const half = CFG.VISION.HALF_DEG * Math.PI / 180;
    const vr = Math.min(R, CFG.VISION.RANGE * S);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, vr);
    grd.addColorStop(0, 'rgba(240,176,76,.16)');
    grd.addColorStop(1, 'rgba(240,176,76,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, vr, ang - half, ang + half);
    ctx.closePath();
    ctx.fill();

    /* 玩家箭头 */
    ctx.beginPath();
    ctx.moveTo(cx + fx * 7, cy + fz * 7);
    ctx.lineTo(cx - fx * 4 + fz * 4.2, cy - fz * 4 - fx * 4.2);
    ctx.lineTo(cx - fx * 4 - fz * 4.2, cy - fz * 4 + fx * 4.2);
    ctx.closePath();
    ctx.fillStyle = COL.player;
    ctx.fill();
    ctx.strokeStyle = COL.playerEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    /* 外圈 + 北向标记 */
    ctx.strokeStyle = COL.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = 'rgba(240,236,226,.4)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 10);
  }

  window.addEventListener('DOMContentLoaded', function () {
    init(document.getElementById('minimap'));
  });

  return {
    init: init,
    resize: resize,
    build: build,
    draw: draw
  };
})();
