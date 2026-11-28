'use strict';

/* ============================================================
   HUD：DOM 覆盖层（局内）
   ============================================================ */

const HUD = (function () {
  let el = {};
  let fpsT = 0, fpsN = 0, fps = 0;
  let hitT = 0;
  let minimapT = 0;
  let dmgPool = [], dmgCursor = 0;
  let edgePool = [], edgePortraits = {};

  function $(id) { return document.getElementById(id); }

  function boot() {
    el = {
      hud: $('hud'),
      hpFill: $('hpFill'), hpNum: $('hpNum'),
      shdFill: $('shdFill'), shdNum: $('shdNum'),
      staFill: $('staFill'),
      wName: $('wName'), wTag: $('wTag'), wMag: $('wMag'), wRes: $('wRes'),
      kills: $('kills'), loot: $('loot'), timer: $('timer'),
      data: $('dataNum'),
      camInfo: $('camInfo'),
      objective: $('objective'), objText: $('objText'),
      slots: $('slots'),
      gadgets: $('gadgets'),
      prompt: $('prompt'),
      exWrap: $('extractWrap'), exFill: $('exFill'),
      respawnWrap: $('respawnWrap'), respawnFill: $('respawnFill'),
      dmgLayer: $('dmgLayer'),
      edgeLayer: $('edgeLayer'),
      dmg: $('dmgFlash'),
      end: $('endScreen'), endTag: $('endTag'), endTitle: $('endTitle'),
      endBody: $('endBody'), endNote: $('endNote'), endContracts: $('endContracts'),
      reload: $('reloadWrap'), reloadFill: $('reloadFill'),
      hitmark: $('hitmark'),
      cursor: $('gameCursor'),
      reloadBtn: document.querySelector('[data-touch-act="reload"]')
    };
    buildDmgPool();
  }

  /* 伤害跳字：固定 DOM 池，按世界坐标每帧投影，数字向上飘并淡出 */
  function buildDmgPool() {
    dmgPool = [];
    dmgCursor = 0;
    if (!el.dmgLayer) return;
    el.dmgLayer.innerHTML = '';
    for (let i = 0; i < 36; i++) {
      const node = document.createElement('div');
      node.className = 'dmgnum';
      node.style.display = 'none';
      el.dmgLayer.appendChild(node);
      dmgPool.push({
        node: node, active: false, t: 0, life: 0.85,
        x: 0, y: 1.2, z: 0, drift: 0
      });
    }
  }

  function damageNumber(x, y, z, amount, rgb) {
    if (!dmgPool.length) return;
    if (typeof G === 'undefined' || G.mode !== 'mission') return;
    const d = dmgPool[dmgCursor++ % dmgPool.length];
    d.active = true;
    d.t = 0;
    d.life = 0.8 + Math.random() * 0.18;
    d.x = x; d.y = y; d.z = z;
    d.drift = (Math.random() - 0.5) * 30;
    const c = rgb || [1, 0.9, 0.68];
    const r = Math.round((c[0] * 0.4 + 0.6) * 255);
    const g = Math.round((c[1] * 0.4 + 0.6) * 255);
    const b = Math.round((c[2] * 0.4 + 0.6) * 255);
    const n = d.node;
    n.textContent = String(Math.max(1, Math.round(amount)));
    n.style.color = 'rgb(' + r + ',' + g + ',' + b + ')';
    n.style.textShadow = '0 0 8px rgba(' + r + ',' + g + ',' + b + ',.55), 0 2px 3px rgba(0,0,0,.9)';
    n.classList.toggle('big', amount >= 30);
    n.style.display = 'block';
    n.style.opacity = '1';
  }

  function updateDamageNumbers(dt) {
    if (!dmgPool.length) return;
    for (let i = 0; i < dmgPool.length; i++) {
      const d = dmgPool[i];
      if (!d.active) continue;
      d.t += dt;
      if (d.t >= d.life) {
        d.active = false;
        d.node.style.display = 'none';
        continue;
      }
      const wy = d.y + d.t * 1.4;
      const s = G.worldToScreenClamped
        ? G.worldToScreenClamped(d.x, wy, d.z)
        : (G.worldToScreen ? G.worldToScreen(d.x, wy, d.z) : null);
      if (!s) { d.node.style.opacity = '0'; continue; }
      const k = d.t / d.life;
      const alpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      const pop = 1 + 0.32 * Math.max(0, 1 - d.t / 0.1);
      const drift = s.edge ? 0 : d.drift * d.t;
      d.node.classList.toggle('edge', !!s.edge);
      d.node.style.opacity = alpha.toFixed(2);
      d.node.style.transform = 'translate(-50%,-50%) translate(' +
        (s.x + drift).toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) scale(' + pop.toFixed(3) + ')';
    }
  }

  /* 屏幕外敌人：头像标识 + 方向三角。
     头像由 MODELS.headPortrait 用现有方块头部正面投影生成，尺寸随距离缩小。 */
  const EDGE_COLORS = {
    zombie: '#e2604f',
    spitter: '#b98cff',
    gaunt: '#d8c27a',
    scav: '#f0a04c',
    raider: '#f0a04c',
    veteran: '#f0a04c'
  };

  function edgeColor(type) { return EDGE_COLORS[type] || '#e2604f'; }

  function edgeSize(dist, w, h) {
    const k = Math.max(0, Math.min(1, dist / CFG.VISION.RANGE));
    const base = 62 - 34 * k;
    const ui = Math.max(0.68, Math.min(1, Math.min(w / 1440, h / 900)));
    return Math.max(20, Math.round(base * ui));
  }

  function edgePortrait(type) {
    if (edgePortraits[type] !== undefined) return edgePortraits[type];
    const src = (typeof MODELS !== 'undefined' && MODELS.headPortrait)
      ? MODELS.headPortrait(type, 128) : '';
    edgePortraits[type] = src || '';
    return edgePortraits[type];
  }

  function edgeNode(i) {
    while (edgePool.length <= i) {
      const node = document.createElement('div');
      node.className = 'edge-mark';
      const face = document.createElement('div');
      face.className = 'em-face';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      face.appendChild(img);
      const arrow = document.createElement('i');
      arrow.className = 'em-arrow';
      node.appendChild(face);
      node.appendChild(arrow);
      if (el.edgeLayer) el.edgeLayer.appendChild(node);
      edgePool.push({ node: node, face: face, img: img, arrow: arrow, type: '', size: 0 });
    }
    return edgePool[i];
  }

  function updateEdgeMarkers() {
    if (!el.edgeLayer) return;
    const data = (typeof G !== 'undefined' && G.offscreenEnemyMarkers)
      ? G.offscreenEnemyMarkers() : null;
    const list = data && data.list ? data.list : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const e = edgeNode(i);
      const size = edgeSize(m.dist, data.w, data.h);
      const r = size * 0.5;
      const pad = r + 10;
      const hw = Math.max(1, data.w * 0.5 - pad);
      const hh = Math.max(1, data.h * 0.5 - pad);
      const ax = Math.abs(m.dx), ay = Math.abs(m.dy);
      let k = Math.min(ax > 1e-4 ? hw / ax : 1e9, ay > 1e-4 ? hh / ay : 1e9);
      if (!isFinite(k) || k <= 0) k = 1;
      const x = data.w * 0.5 + m.dx * k;
      const y = data.h * 0.5 + m.dy * k;

      e.node.style.display = 'block';
      if (e.size !== size) {
        e.size = size;
        e.node.style.width = size + 'px';
        e.node.style.height = size + 'px';
      }
      e.node.style.transform = 'translate(-50%,-50%) translate(' +
        x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';

      if (e.type !== m.type) {
        e.type = m.type;
        e.node.style.setProperty('--ec', edgeColor(m.type));
        const src = edgePortrait(m.type);
        if (src) {
          e.img.src = src;
          e.img.style.visibility = 'visible';
        } else {
          e.img.removeAttribute('src');
          e.img.style.visibility = 'hidden';
        }
      }

      const ang = Math.atan2(m.dy, m.dx) * 180 / Math.PI + 90;
      e.arrow.style.transform = 'rotate(' + ang.toFixed(1) + 'deg) translateY(' +
        (-(r + 5)).toFixed(1) + 'px)';
    }
    for (let i = list.length; i < edgePool.length; i++) {
      edgePool[i].node.style.display = 'none';
    }
  }

  function pct(v, m) { return Math.max(0, Math.min(1, v / m)) * 100; }

  function vitals() {
    const p = G.state.player;
    if (!el.hpFill) return;
    el.hpFill.style.width = pct(p.hp, p.maxHp) + '%';
    el.shdFill.style.width = pct(p.shield, p.maxShield) + '%';
    el.staFill.style.width = pct(p.stam, CFG.PLAYER.stam) + '%';
    el.hpNum.textContent = Math.ceil(p.hp);
    el.shdNum.textContent = Math.ceil(p.shield);
  }

  function data(n) {
    if (!el.data) return;
    const p = (typeof G !== 'undefined' && G.state && G.state.player) ? G.state.player : null;
    el.data.textContent = (p && p.infiniteData) ? '∞' : UI.fmt(n);
  }

  function mag(i) {
    const p = G.state.player;
    if (i === undefined || i === null) i = p.weapon;
    const w = WEAPONS[i];
    if (!w) {
      el.wName.textContent = '未装备武器';
      el.wTag.textContent = '空手';
      el.wMag.textContent = '0';
      el.wRes.textContent = '0';
      return;
    }
    const slot = p.slot;
    el.wName.textContent = w.name;
    el.wTag.textContent = w.tag;
    el.wMag.textContent = (slot >= 0 && p.mags[slot] !== undefined) ? p.mags[slot] : 0;
    el.wRes.textContent = (slot >= 0 && p.spares[slot] !== undefined) ? p.spares[slot] : 0;
  }

  /* 左下武器槽 */
  function buildSlots(p) {
    if (!el.slots) return;
    el.slots.innerHTML = '';
    for (let s = 0; s < p.carried.length; s++) {
      const wi = p.carried[s].weaponId;
      const w = WEAPONS[wi];
      const d = UI.el('div', 'slot');
      d.dataset.slot = s;
      d.style.setProperty('--wc', w.color);
      d.innerHTML =
        '<div class="s-top"><span class="s-key">' + (s + 1) + '</span>' +
        '<span class="s-tag">' + w.tag + '</span></div>' +
        '<div class="s-name">' + w.name + '</div>' +
        '<div class="s-ammo"><b data-mag>0</b> / <span data-spare>0</span> 夹</div>' +
        '<div class="s-chips"><i></i><i></i><i></i></div>';
      d.addEventListener('click', function () { G.switchSlot(s); });
      el.slots.appendChild(d);
    }
    if (!p.carried.length) {
      const d = UI.el('div', 'slot-empty', '未装备武器<br><span>可在背包中装备搜到的武器</span>');
      el.slots.appendChild(d);
    }
    updateSlots(p);
  }

  function updateSlots(p) {
    if (!el.slots) return;
    p = p || G.state.player;
    const list = el.slots.querySelectorAll('.slot');
    for (let s = 0; s < list.length; s++) {
      if (!p.carried[s]) continue;
      const node = list[s];
      node.classList.toggle('on', s === p.slot);
      const m = node.querySelector('[data-mag]');
      const sp = node.querySelector('[data-spare]');
      if (m) m.textContent = p.mags[s] !== undefined ? p.mags[s] : 0;
      if (sp) sp.textContent = p.spares[s] !== undefined ? p.spares[s] : 0;
      const chips = p.carried[s].chips || [];
      const dots = node.querySelectorAll('.s-chips i');
      for (let k = 0; k < dots.length; k++) {
        const c = chips[k];
        const def = c ? CHIP_BY_ID[c.chipId] : null;
        const tier = c ? ITEMS.tier(c.tierId) : null;
        dots[k].className = def ? 'on' : '';
        dots[k].style.setProperty('--cc', tier ? tier.color : 'transparent');
      }
    }
  }

  /* 左下角 Q / E 道具槽：显示数据消耗、冷却与瞄准状态 */
  function buildGadgets(p) {
    if (!el.gadgets) return;
    p = p || G.state.player;
    el.gadgets.innerHTML = '';
    for (let slot = 0; slot < 2; slot++) {
      const id = p.gadgets ? p.gadgets[slot] : null;
      const g = id ? GADGET_BY_ID[id] : null;
      const d = UI.el('div', 'gadget-slot' + (g ? '' : ' empty'));
      d.dataset.gslot = slot;
      if (g) d.style.setProperty('--gc', g.color);
      d.innerHTML = g
        ? '<div class="g-top"><span class="g-key">' + (slot === 0 ? 'Q' : 'E') + '</span>' +
            '<span class="g-tag">' + g.tag + '</span></div>' +
          '<div class="g-name">' + g.name + '</div>' +
          '<div class="g-foot"><span class="g-cost">' + g.cost + ' NB</span>' +
            '<span class="g-state">就绪</span></div>' +
          '<i class="g-cdbar"></i>'
        : '<div class="g-top"><span class="g-key">' + (slot === 0 ? 'Q' : 'E') + '</span></div>' +
          '<div class="g-name">空道具槽</div>' +
          '<div class="g-foot"><span class="g-state">军械库配置</span></div>';
      el.gadgets.appendChild(d);
    }
    updateGadgets(p);
  }

  function updateGadgets(p) {
    if (!el.gadgets) return;
    p = p || G.state.player;
    const list = el.gadgets.querySelectorAll('.gadget-slot');
    for (let slot = 0; slot < list.length; slot++) {
      const node = list[slot];
      const id = p.gadgets ? p.gadgets[slot] : null;
      const g = id ? GADGET_BY_ID[id] : null;
      if (!g) {
        node.className = 'gadget-slot empty';
        continue;
      }
      const cd = (p.gadgetCd && p.gadgetCd[slot]) || 0;
      const poor = p.data < g.cost;
      const aiming = p.gadgetAim === slot;
      node.className = 'gadget-slot' +
        (aiming ? ' aim' : '') +
        (cd > 0 ? ' cooling' : '') +
        (poor ? ' no-data' : '') +
        (cd <= 0 && !poor ? ' ready' : '');
      const st = node.querySelector('.g-state');
      if (st) {
        st.textContent = cd > 0 ? '冷却 ' + cd.toFixed(1) + 's'
          : (poor ? '数据不足' : (aiming ? '瞄准中' : '就绪'));
      }
      const bar = node.querySelector('.g-cdbar');
      if (bar) bar.style.width = cd > 0 ? (cd / g.cooldown * 100).toFixed(1) + '%' : '0%';
    }
  }

  function reset() {
    const p = G.state.player;
    vitals();
    mag(p.weapon);
    el.kills.textContent = '0';
    el.loot.textContent = '0';
    el.data.textContent = '0';
    el.end.classList.add('hidden');
    el.dmg.classList.remove('hit');
    el.exWrap.classList.remove('on');
    el.exFill.style.width = '0%';
    if (el.respawnWrap) el.respawnWrap.classList.remove('on');
    if (el.respawnFill) el.respawnFill.style.width = '0%';
    for (let i = 0; i < dmgPool.length; i++) {
      dmgPool[i].active = false;
      dmgPool[i].node.style.display = 'none';
    }
    for (let i = 0; i < edgePool.length; i++) {
      edgePool[i].node.style.display = 'none';
      edgePool[i].type = '';
    }
    el.reload.classList.add('hidden');
    prompt(null);
    objective('撤离点', false);
    el.hpNum.textContent = Math.ceil(p.maxHp);
    el.shdNum.textContent = Math.ceil(p.maxShield);
    updateSlots(p);
    buildGadgets(p);
  }

  function kills(n) { el.kills.textContent = n; }
  function loot(n) { el.loot.textContent = n; }

  function extract(p) {
    if (p <= 0.001) {
      el.exWrap.classList.remove('on');
      el.exFill.style.width = '0%';
      return;
    }
    el.exWrap.classList.add('on');
    el.exFill.style.width = (p * 100) + '%';
  }

  function respawn(p) {
    if (!el.respawnWrap || !el.respawnFill) return;
    if (p <= 0.001) {
      el.respawnWrap.classList.remove('on');
      el.respawnFill.style.width = '0%';
      return;
    }
    el.respawnWrap.classList.add('on');
    el.respawnFill.style.width = (Math.min(1, p) * 100) + '%';
  }

  function damage() {
    el.dmg.classList.remove('hit');
    void el.dmg.offsetWidth;
    el.dmg.classList.add('hit');
  }

  function toast(msg, type) { UI.toast(msg, type); }

  function prompt(html) {
    if (!el.prompt) return;
    if (!html) {
      el.prompt.classList.add('hidden');
      el.prompt.innerHTML = '';
      return;
    }
    el.prompt.classList.remove('hidden');
    el.prompt.innerHTML = html;
  }

  function objective(text, near) {
    if (!el.objective) return;
    el.objective.classList.toggle('on', !!near);
    el.objText.textContent = text;
  }

  function setCombatMode(on) {
    if (el.hud) el.hud.classList.toggle('hidden', !on);
    if (el.hitmark) el.hitmark.classList.toggle('hidden', !on);
    if (el.dmg) el.dmg.style.display = on ? '' : 'none';
    if (!on) setCursorVisible(false);
    document.body.classList.toggle('combat', !!on);
  }

  function setAimVisible(on) {
    if (el.hitmark) el.hitmark.classList.toggle('hidden', !on);
  }

  /* 游戏内鼠标指针：跟随虚拟鼠标坐标 */
  function setCursorVisible(on) {
    if (el.cursor) el.cursor.classList.toggle('hidden', !on);
    document.body.classList.toggle('show-game-cursor', !!on);
  }

  /* 命中标记 / 游戏内鼠标跟随鼠标位置 */
  function aimAt(x, y) {
    if (el.cursor) {
      el.cursor.style.left = x + 'px';
      el.cursor.style.top = y + 'px';
    }
    if (!el.hitmark) return;
    el.hitmark.style.left = x + 'px';
    el.hitmark.style.top = y + 'px';
  }

  /* 命中反馈：命中标记 */
  function hit(kill) {
    if (!el.hitmark) return;
    el.hitmark.classList.toggle('kill', !!kill);
    el.hitmark.classList.remove('on');
    void el.hitmark.offsetWidth;
    el.hitmark.classList.add('on');
    hitT = kill ? 0.2 : 0.12;
  }

  function end(win, info) {
    el.end.classList.remove('hidden');
    const abandon = info.reason === 'abandon';
    el.endTag.textContent = abandon ? '// ABORTED' : (win ? '// EXTRACTION' : '// SIGNAL LOST');
    el.endTag.className = 'end-tag' + (win ? '' : ' lose');

    let title = win ? '撤离成功' : (abandon ? '行动中止' : '信号中断');
    el.endTitle.textContent = title;
    el.endTitle.className = 'end-title ' + (win ? 'win' : 'lose');

    const time = UI.time(info.time);
    el.endBody.innerHTML =
      '<div><span>击杀</span><b>' + info.kills + '</b></div>' +
      '<div><span>拾取</span><b>' + info.loot + '</b></div>' +
      '<div><span>用时</span><b>' + time + '</b></div>' +
      '<div><span>数据</span><b class="' + (win ? 'amber' : '') + '">' +
        (win ? '+' + UI.fmt(info.data) + ' NB' : '0 NB') + '</b></div>' +
      '<div><span>物资价值</span><b>' + (win ? UI.fmt(info.haul) + ' NB' : '0 NB') + '</b></div>' +
      '<div><span>入库</span><b class="' + (win ? 'green' : '') + '">' +
        (win ? info.stored + ' 件' : '0 件') + '</b></div>';

    let note;
    if (win) {
      note = '数据 <b>+' + UI.fmt(info.data) + ' NB</b> 已入账 · ' +
        info.stored + ' 件物资已入库';
      if (info.overflow > 0) {
        note += ' · 仓库已满，' + info.overflow + ' 件自动分解为 ' + UI.fmt(info.overflowValue) + ' NB';
        const oe = info.overflowElements ? ITEMS.elementSummary(info.overflowElements) : '';
        if (oe) note += '，元素 +' + oe;
      }
    } else {
      const cause = info.reason === 'death' ? '生命体征归零。' : '你主动放弃了本次行动。';
      note = cause + '本局物资与未花完的数据全部丢失；账户、仓库和强化不受影响。';
    }
    if (info.dismantled > 0) note += '<br>局内分解 ' + UI.fmt(info.dismantled) + ' NB';
    el.endNote.innerHTML = note;

    if (info.contracts && info.contracts.length) {
      el.endContracts.textContent = '合约已完成待领取：' + info.contracts.join(' / ');
    } else {
      el.endContracts.textContent = '最佳带出记录 ' + UI.fmt(info.best) + ' NB';
    }
  }

  function hideEnd() { el.end.classList.add('hidden'); }

  function tick(dt) {
    if (!G.state || !G.state.player) return;
    fpsT += dt; fpsN++;
    if (fpsT > 0.4) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
    const p = G.state.player;
    if (G.mode !== 'mission') return;
    /* 小地图每帧遍历所有敌人 / 物资 / 箱子；20Hz 足够，且能显著降低长局扫描。 */
    minimapT += dt;
    if (minimapT >= 0.05) {
      if (typeof MINIMAP !== 'undefined') MINIMAP.draw(minimapT);
      minimapT = 0;
    }
    updateDamageNumbers(dt);
    updateEdgeMarkers();
    el.camInfo.textContent = Math.round(G.state.cam.pitch) + '° · ' + fps + 'fps';
    el.data.textContent = p.infiniteData ? '∞' : UI.fmt(p.data);
    updateSlots(p);
    updateGadgets(p);

    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) {
        if (el.hitmark) el.hitmark.classList.remove('on');
      }
    }
    const t = Math.floor(G.state.time);
    if (el.timer) el.timer.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    if (p.reload > 0) {
      el.reload.classList.remove('hidden');
      const dur = p.reloadDur || (WEAPONS[p.weapon].reload * p.reloadMul);
      el.reloadFill.style.width = (100 - (p.reload / dur) * 100) + '%';
    } else if (el.reload) {
      el.reload.classList.add('hidden');
    }
    if (el.reloadBtn) {
      const busy = p.reload > 0;
      const flag = busy ? '1' : '0';
      if (el.reloadBtn.dataset.busy !== flag) {
        el.reloadBtn.dataset.busy = flag;
        el.reloadBtn.textContent = busy ? '换弹中' : '换弹';
      }
    }
  }

  window.addEventListener('DOMContentLoaded', boot);

  return {
    vitals: vitals, mag: mag, reset: reset, kills: kills, loot: loot,
    data: data, prompt: prompt, setCombatMode: setCombatMode, setAimVisible: setAimVisible,
    setCursorVisible: setCursorVisible,
    aimAt: aimAt,
    objective: objective,
    buildSlots: buildSlots, updateSlots: updateSlots,
    buildGadgets: buildGadgets, updateGadgets: updateGadgets,
    extract: extract, respawn: respawn, damage: damage, toast: toast, hit: hit,
    damageNumber: damageNumber,
    end: end, hideEnd: hideEnd, tick: tick
  };
})();
