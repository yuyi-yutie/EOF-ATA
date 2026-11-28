'use strict';

/* ============================================================
   AI 调试遥测
   - 默认关闭；?aidbg=1 或 ?aistuck=1 开启
   - 每 0.5s 采样所有存活 AI：位置 / 状态 / 路径 / 障碍 / 门 / 附近单位
   - 记录持续卡住、撞墙停止、无路径、等门等事件
   - window.__aiDebug.snapshot() 返回可直接复制的 JSON
   - window.__aiDebug.dump() 输出到控制台并下载 JSON
   ============================================================ */

const AIDebug = (function () {
  let enabled = false;
  let panel = null, panelBody = null;
  let units = {};
  let events = [];
  let counts = {};
  let lastSample = -1;
  let lastRender = -1;
  let startTime = 0;
  const seen = {};

  function now() {
    if (typeof G !== 'undefined' && G.state && typeof G.state.time === 'number') return G.state.time;
    return performance.now() / 1000;
  }

  function init(flag) {
    enabled = !!flag;
    if (!enabled) return;
    startTime = now();
    buildPanel();
    try { console.info('[AIDEBUG] enabled · snapshot() / dump()'); } catch (e) {}
  }

  function clear() {
    units = {};
    events = [];
    counts = {};
    lastSample = -1;
    lastRender = -1;
    startTime = now();
    for (const k in seen) delete seen[k];
    if (panelBody) panelBody.textContent = '';
  }

  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'aiDebugPanel';
    panel.style.cssText = [
      'position:fixed', 'left:300px', 'top:96px', 'z-index:90',
      'max-width:420px', 'max-height:52vh', 'overflow:hidden',
      'padding:8px 10px', 'pointer-events:none',
      'background:rgba(6,9,12,.86)', 'border:1px solid rgba(160,220,255,.35)',
      'color:#cfe8f5', 'font:10px/1.45 Consolas,monospace',
      'box-shadow:0 8px 26px rgba(0,0,0,.45)', 'white-space:pre-wrap'
    ].join(';');
    const head = document.createElement('div');
    head.textContent = 'AI DEBUG';
    head.style.cssText = 'color:#8fe3ff;letter-spacing:.18em;margin-bottom:4px';
    panelBody = document.createElement('div');
    panel.appendChild(head);
    panel.appendChild(panelBody);
    document.body.appendChild(panel);
  }

  function shortGoal(p) {
    return p ? (Math.round(p.x * 10) / 10) + ',' + (Math.round(p.z * 10) / 10) : '-';
  }

  function event(type, data, unit) {
    if (!enabled) return;
    const t = now();
    const key = (unit ? (unit.aiId || unit.type || '?') : '') + '|' + type + '|' + ((data && data.reason) || '');
    if (seen[key] !== undefined && t - seen[key] < 0.5) return;
    seen[key] = t;
    const rec = { t: Math.round(t * 10) / 10, type: type };
    if (unit) {
      rec.id = unit.aiId || 0;
      rec.unit = unit.type || '';
      rec.state = unit.state || '';
    }
    if (data) for (const k in data) rec[k] = data[k];
    events.push(rec);
    if (events.length > 500) events.shift();
    counts[type] = (counts[type] || 0) + 1;
  }

  function sample(enemies) {
    if (!enabled || !enemies) return;
    const t = now();
    if (lastSample >= 0 && t - lastSample < 0.5) return;
    lastSample = t;
    const alive = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e && !e.dead) alive.push(e);
    }
    for (let i = 0; i < alive.length; i++) {
      const e = alive[i];
      const id = e.aiId || ('x' + Math.round(e.x * 10) + '_' + Math.round(e.z * 10));
      let other = null, otherD = Infinity;
      for (let j = 0; j < alive.length; j++) {
        const o = alive[j];
        if (o === e) continue;
        const d = Math.hypot(o.x - e.x, o.z - e.z);
        if (d < otherD) { otherD = d; other = o; }
      }
      let door = null, doorD = Infinity;
      if (typeof World !== 'undefined' && World.nearestDoor) {
        const d = World.nearestDoor(e.x, e.z);
        if (d) {
          doorD = Math.hypot(d.x - e.x, d.z - e.z);
          if (doorD <= 3.0) door = { x: Math.round(d.x * 10) / 10, z: Math.round(d.z * 10) / 10, open: !!d.open, d: Math.round(doorD * 10) / 10 };
        }
      }
      const inWall = !!(typeof World !== 'undefined' && World.blocked && World.blocked(e.x, e.z, e.r, true));
      const rec = {
        id: id,
        type: e.type || '',
        faction: e.faction || '',
        x: Math.round(e.x * 10) / 10,
        z: Math.round(e.z * 10) / 10,
        state: e.state || '',
        moving: !!e.moving,
        stopT: Math.round((e.stopT || 0) * 100) / 100,
        moveStuckT: Math.round((e.moveStuckT || 0) * 100) / 100,
        stuckT: Math.round((e.stuckT || 0) * 100) / 100,
        doorWaitT: Math.round((e.doorWaitT || 0) * 100) / 100,
        path: e.path ? e.path.length : 0,
        goal: e.pathGoal ? { x: Math.round(e.pathGoal.x * 10) / 10, z: Math.round(e.pathGoal.z * 10) / 10 } : null,
        patrol: e.patrol ? { x: Math.round(e.patrol.x * 10) / 10, z: Math.round(e.patrol.z * 10) / 10 } : null,
        seen: !!e.seen,
        inWall: inWall,
        door: door,
        other: other ? {
          id: other.aiId || 0,
          type: other.type || '',
          d: Math.round(otherD * 10) / 10
        } : null
      };
      const old = units[id];
      const goalDist = rec.goal ? Math.hypot(rec.goal.x - e.x, rec.goal.z - e.z) : 0;
      const searchHold = rec.state === 'search' && goalDist < 1.2;
      const stuck = inWall || rec.stopT > 0.05 || rec.doorWaitT > 0.05 || rec.moveStuckT > 0.1 ||
        (rec.path === 0 && !rec.moving && !searchHold &&
         (rec.state === 'chase' || rec.state === 'search') &&
         (rec.goal || rec.patrol));
      rec.stuck = stuck;
      if (stuck) {
        if (!old || !old.stuck) {
          rec.stuckStart = t;
          event('stuck-start', {
            x: rec.x, z: rec.z, inWall: inWall,
            stopT: rec.stopT, moveStuckT: rec.moveStuckT, doorWaitT: rec.doorWaitT,
            path: rec.path, goal: shortGoal(rec.goal || rec.patrol),
            door: door ? (door.d + (door.open ? ' open' : ' closed')) : '-',
            other: rec.other ? (rec.other.type + '#' + rec.other.id + ' ' + rec.other.d + 'm') : '-'
          }, e);
        } else {
          rec.stuckStart = old.stuckStart || t;
        }
        rec.stuckFor = Math.round((t - rec.stuckStart) * 10) / 10;
        if (rec.stuckFor >= 2 && (!old || !old.longReported)) {
          rec.longReported = true;
          event('stuck-long', {
            dur: rec.stuckFor, x: rec.x, z: rec.z, inWall: inWall,
            stopT: rec.stopT, moveStuckT: rec.moveStuckT, doorWaitT: rec.doorWaitT,
            path: rec.path, goal: shortGoal(rec.goal || rec.patrol),
            door: door ? (door.d + (door.open ? ' open' : ' closed')) : '-',
            other: rec.other ? (rec.other.type + '#' + rec.other.id + ' ' + rec.other.d + 'm') : '-'
          }, e);
        }
      } else {
        if (old && old.stuck) {
          event('stuck-end', { dur: old.stuckFor || 0, x: rec.x, z: rec.z, state: rec.state }, e);
        }
        rec.stuckStart = 0;
        rec.stuckFor = 0;
        rec.longReported = false;
      }
      units[id] = rec;
    }
    render();
  }

  function render() {
    if (!enabled || !panelBody) return;
    const t = now();
    if (lastRender >= 0 && t - lastRender < 0.25) return;
    lastRender = t;
    const list = [];
    for (const id in units) {
      const u = units[id];
      if (u.stuck) list.push(u);
    }
    list.sort(function (a, b) { return (b.stuckFor || 0) - (a.stuckFor || 0); });
    const lines = [];
    lines.push('t=' + t.toFixed(1) + '  units=' + Object.keys(units).length + '  stuck=' + list.length);
    lines.push('stop=' + (counts['move-stop'] || 0) + '  noPath=' + (counts['no-path'] || 0) +
      '  doorWait=' + (counts['door-wait'] || 0) + '  skipWp=' + (counts['skip-waypoint'] || 0));
    for (let i = 0; i < Math.min(8, list.length); i++) {
      const u = list[i];
      lines.push('#' + u.id + ' ' + u.type + ' ' + u.state + ' (' + u.x + ',' + u.z + ')' +
        ' stuck=' + (u.stuckFor || 0) + 's' +
        (u.inWall ? ' WALL' : '') +
        (u.stopT ? ' stop=' + u.stopT : '') +
        (u.moveStuckT ? ' moveStuck=' + u.moveStuckT : '') +
        (u.doorWaitT ? ' doorWait=' + u.doorWaitT : '') +
        ' path=' + u.path +
        ' goal=' + shortGoal(u.goal || u.patrol) +
        (u.door ? ' door=' + u.door.d + (u.door.open ? 'O' : 'C') : '') +
        (u.other && u.other.d < 1.2 ? ' near=' + u.other.type + '#' + u.other.id + '@' + u.other.d : ''));
    }
    for (let i = Math.max(0, events.length - 4); i < events.length; i++) {
      const e = events[i];
      lines.push('· ' + e.type + (e.unit ? ' ' + e.unit + '#' + e.id : '') +
        (e.x !== undefined ? ' (' + e.x + ',' + e.z + ')' : '') +
        (e.dur !== undefined ? ' ' + e.dur + 's' : '') +
        (e.other ? ' ' + e.other : ''));
    }
    panelBody.textContent = lines.join('\n');
  }

  function stuckList() {
    const out = [];
    for (const id in units) if (units[id].stuck) out.push(units[id]);
    out.sort(function (a, b) { return (b.stuckFor || 0) - (a.stuckFor || 0); });
    return out;
  }

  function snapshot() {
    const all = [];
    for (const id in units) all.push(units[id]);
    return {
      time: Math.round(now() * 10) / 10,
      counts: JSON.parse(JSON.stringify(counts)),
      stuck: stuckList(),
      units: all,
      events: events.slice(-200)
    };
  }

  function dump() {
    const report = snapshot();
    try { console.log('[AIDEBUG]', report); } catch (e) {}
    try {
      const text = JSON.stringify(report, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = 'ai-debug-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) {
      console.warn('[AIDEBUG] download failed', e);
    }
    return report;
  }

  return {
    init: init,
    event: event,
    sample: sample,
    clear: clear,
    snapshot: snapshot,
    dump: dump,
    get enabled() { return enabled; }
  };
})();

try { window.__aiDebug = AIDebug; } catch (e) {}
