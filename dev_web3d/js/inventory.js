'use strict';

/* ============================================================
   局内背包
   - 6×N 网格，物品按尺寸占格，左键拖动、R 旋转
   - 右键分解（需要读条，移动会中断）
   - 弹药压装 / 数据治疗 / 战术补给
   - 背包打开时世界不暂停，移速降到 55%
   ============================================================ */

const Inventory = (function () {
  let CELL = 72;
  let GAP = 8;
  let PITCH = CELL + GAP;

  const el = {};
  let drag = null, hover = null, ghost = null, lastMouse = null;
  let action = null;
  let builtRows = 0;

  function P() { return G.state.player; }
  function cols() { return CFG.INV_COLS; }
  function rows() { return P().invRows || CFG.INV_ROWS; }

  /* 手机窄/矮屏用更小的格子，保证 6 列背包能完整放下 */
  function layout() {
    const compact = !!window.__touchMode &&
      (window.innerWidth < 820 || window.innerHeight < 520);
    const nextCell = compact ? 54 : 72;
    const nextGap = compact ? 6 : 8;
    if (nextCell === CELL && nextGap === GAP) return false;
    CELL = nextCell;
    GAP = nextGap;
    PITCH = CELL + GAP;
    return true;
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    el.root = UI.$('inventory');
    el.grid = UI.$('invGrid');
    el.items = UI.$('invItems');
    el.drop = UI.$('invDrop');
    el.count = UI.$('invCount');
    el.cap = UI.$('invCap');
    el.data = UI.$('invData');
    el.detail = UI.$('invDetail');
    el.craft = UI.$('craftList');
    el.kit = UI.$('kitList');
    el.heal = UI.$('healBtn');
    el.prog = UI.$('actionProg');
    el.progLabel = UI.$('apLabel');
    el.progFill = UI.$('apFill');
    el.close = UI.$('invClose');
    if (window.__touchMode) el.close.textContent = '关闭';

    el.close.addEventListener('click', function () { close(); });
    el.heal.addEventListener('click', function () { tryHeal(); });

    el.detail.addEventListener('click', function (e) {
      const target = e.target;
      const btn = target && target.closest ? target.closest('[data-inv-act]') : null;
      if (!btn) return;
      const p = P();
      const it = p.sel;
      if (!it || p.inv.indexOf(it) < 0) return;
      if (btn.getAttribute('data-inv-act') === 'rotate') rotate();
      else startAction('dismantle', it);
    });

    layout();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', function () {
      if (layout()) {
        builtRows = 0;
        if (isOpen()) {
          buildGrid(rows(), true);
          refresh();
        }
      }
    });
  }

  /* 每次出击时按强化等级重建格子 */
  function beginRun() {
    buildGrid(rows(), true);
    drag = null;
    action = null;
    hover = null;
    if (el.prog) el.prog.classList.add('hidden');
  }

  function buildGrid(r, force) {
    if (!force && builtRows === r && el.grid.children.length > 2) {
      el.cap.textContent = cols() * r;
      return;
    }
    builtRows = r;
    while (el.grid.firstChild) el.grid.removeChild(el.grid.firstChild);
    el.grid.style.gridTemplateColumns = 'repeat(' + cols() + ', ' + CELL + 'px)';
    el.grid.style.gridTemplateRows = 'repeat(' + r + ', ' + CELL + 'px)';
    for (let i = 0; i < cols() * r; i++) {
      const d = UI.el('div', 'cell');
      d.addEventListener('click', function () {
        if (drag) return;
        P().sel = null;
        refresh();
      });
      el.grid.appendChild(d);
    }
    const items = UI.el('div', 'inv-items');
    items.id = 'invItems';
    const drop = UI.el('div', 'inv-drop');
    drop.id = 'invDrop';
    el.grid.appendChild(items);
    el.grid.appendChild(drop);
    el.items = items;
    el.drop = drop;
    el.cap.textContent = cols() * r;
  }

  /* ---------------- 物品 ---------------- */
  function addItem(raw) {
    const p = P();
    const it = Grid.cloneItem(raw);
    if (!Grid.autoPlace(p.inv, it, cols(), rows())) return false;
    p.inv.push(it);
    refresh();
    return true;
  }

  function removeItem(it) {
    const p = P();
    const i = p.inv.indexOf(it);
    if (i >= 0) p.inv.splice(i, 1);
    if (p.sel === it) p.sel = null;
    refresh();
  }

  function usedCells() { return Grid.usedCells(P().inv); }

  /* ---------------- 渲染 ---------------- */
  function itemNode(it, extra) {
    const d = Grid.dims(it);
    const tier = TIERS.filter(function (t) { return t.id === it.tierId; })[0] || TIERS[0];
    const div = UI.el('div', 'inv-item' + (extra || ''));
    div.style.left = (it.gx * PITCH) + 'px';
    div.style.top = (it.gy * PITCH) + 'px';
    div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    div.style.setProperty('--qc', tier.color);
    div.innerHTML =
      '<span class="gem"></span>' +
      '<span class="nm">' + UI.esc(it.name) + '</span>' +
      '<span class="val">' + it.value + '</span>' +
      '<span class="sz">' + d.w + '×' + d.h + '</span>';
    return div;
  }

  function renderGrid() {
    const p = P();
    el.items.innerHTML = '';
    for (let i = 0; i < p.inv.length; i++) {
      const it = p.inv[i];
      if (drag && drag.it === it) continue;
      const div = itemNode(it, it === p.sel ? ' sel' : '');
      div.addEventListener('pointerdown', function (e) { onDown(e, it); });
      div.addEventListener('mouseenter', function () { hover = it; });
      div.addEventListener('mouseleave', function () { if (hover === it) hover = null; });
      div.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (drag) return;
        startAction('dismantle', it);
      });
      el.items.appendChild(div);
    }
  }

  function tierName(id) {
    const t = TIERS.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '常见';
  }

  function renderDetail() {
    const p = P();
    const it = p.sel;
    if (!it || p.inv.indexOf(it) < 0) {
      const hint = window.__touchMode
        ? '拖动摆放 · 点选物品<br><span>旋转 / 分解在物品详情下方</span>'
        : '左键拖动 · R 旋转 · 右键分解<br><span>物品尺寸固定，可自由摆放</span>';
      el.detail.innerHTML = '<div class="dt-empty">' + hint + '</div>';
      return;
    }
    const d = Grid.dims(it);
    el.detail.innerHTML =
      '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
      '<div class="dt-line"><span>' + tierName(it.tierId) + ' · 数据载体</span><b>' + it.value + ' NB</b></div>' +
      '<div class="dt-line"><span>占格 / 分解</span><b>' + d.w + '×' + d.h + ' · ' + it.time.toFixed(1) + 's</b></div>' +
      '<div class="dt-hint">[拖动] 移动 · [R] 旋转 · [右键] 分解</div>' +
      '<div class="dt-touch">' +
        '<button type="button" class="dt-btn" data-inv-act="rotate">旋转</button>' +
        '<button type="button" class="dt-btn danger" data-inv-act="dismantle">分解</button>' +
      '</div>';
  }

  function renderCraft() {
    const p = P();
    el.craft.innerHTML = '';
    for (let s = 0; s < p.carried.length; s++) {
      const wi = p.carried[s];
      const w = WEAPONS[wi];
      const spare = p.spares[wi] || 0;
      const row = UI.el('div', 'craft-row');
      row.style.setProperty('--wc', w.color);
      const full = spare >= w.maxSpare;
      const poor = p.data < w.cost;
      row.className += full || poor ? ' dis' : '';
      row.innerHTML =
        '<span class="cw">' + (s + 1) + '</span>' +
        '<span class="cn">' + w.name + '</span>' +
        '<span class="cs">' + spare + '/' + w.maxSpare + ' 夹</span>' +
        '<span class="cc">' + w.cost + ' NB</span>';
      row.addEventListener('click', function () { tryCraft(wi); });
      el.craft.appendChild(row);
    }
    if (!p.carried.length) el.craft.innerHTML = '<div class="side-empty">没有携带武器</div>';
  }

  function renderKit() {
    const p = P();
    el.kit.innerHTML = '';
    for (let i = 0; i < SUPPLIES.length; i++) {
      const s = SUPPLIES[i];
      const n = p.kit[s.id] || 0;
      const row = UI.el('div', 'kit-row' + (n <= 0 ? ' dis' : ''));
      row.style.setProperty('--kc', s.color);
      row.innerHTML =
        '<span class="ki"></span>' +
        '<span class="kn">' + s.name + '</span>' +
        '<span class="kd">' + s.desc + '</span>' +
        '<span class="kc">×' + n + '</span>';
      row.addEventListener('click', function () { useSupply(s.id); });
      el.kit.appendChild(row);
    }
    const canHeal = p.hp < p.maxHp && p.data >= CFG.HEAL_COST;
    el.heal.className = 'action-btn' + (canHeal ? '' : ' dis');
    el.heal.innerHTML =
      '<span>数据治疗 · 回复全部生命</span><em>' + CFG.HEAL_COST + ' NB · ' +
      CFG.HEAL_TIME.toFixed(1) + 's</em>';
  }

  function refresh() {
    if (!el.grid) return;
    const p = P();
    renderGrid();
    renderDetail();
    renderCraft();
    renderKit();
    el.count.textContent = usedCells();
    el.cap.textContent = cols() * rows();
    el.data.textContent = UI.fmt(p.data);
  }

  /* ---------------- 拖拽 ---------------- */
  function onDown(e, it) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const p = P();
    const rect = el.grid.getBoundingClientRect();
    const d = Grid.dims(it);
    const itemX = rect.left + it.gx * PITCH;
    const itemY = rect.top + it.gy * PITCH;
    const fx = clamp((e.clientX - itemX) / PITCH, 0, d.w - 0.01);
    const fy = clamp((e.clientY - itemY) / PITCH, 0, d.h - 0.01);

    drag = {
      it: it, ox: it.gx, oy: it.gy, orot: it.rot,
      fx: fx, fy: fy, moved: false, pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      tx: it.gx, ty: it.gy, valid: true
    };
    p.sel = it;
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    refresh();
    updateGhost(e);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    updateGhost(e);
  }

  function onUp(e) {
    if (!drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (d.moved && d.valid) {
      d.it.gx = d.tx;
      d.it.gy = d.ty;
    } else {
      d.it.gx = d.ox;
      d.it.gy = d.oy;
      if (!Grid.fits(P().inv, d.it, d.ox, d.oy, d.it.rot, cols(), rows(), d.it)) {
        d.it.rot = d.orot;
      }
    }
    removeGhost();
    if (el.drop) el.drop.style.display = 'none';
    refresh();
  }

  function updateGhost(e) {
    if (!drag || !e) return;
    const p = P();
    const rect = el.grid.getBoundingClientRect();
    const it = drag.it;
    const d = Grid.dims(it);

    const tx = Math.round((e.clientX - rect.left) / PITCH - drag.fx);
    const ty = Math.round((e.clientY - rect.top) / PITCH - drag.fy);
    const valid = Grid.fits(p.inv, it, tx, ty, it.rot, cols(), rows(), it);
    drag.tx = tx;
    drag.ty = ty;
    drag.valid = valid;

    if (drag.moved) {
      el.drop.style.display = 'block';
      el.drop.style.left = (tx * PITCH) + 'px';
      el.drop.style.top = (ty * PITCH) + 'px';
      el.drop.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      el.drop.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      el.drop.className = 'inv-drop ' + (valid ? 'ok' : 'bad');
    } else {
      el.drop.style.display = 'none';
    }

    const g = ensureGhost(it);
    g.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    g.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    g.style.left = (e.clientX - drag.fx * PITCH) + 'px';
    g.style.top = (e.clientY - drag.fy * PITCH) + 'px';
  }

  function ensureGhost(it) {
    if (!ghost) {
      ghost = UI.el('div', 'inv-item inv-ghost');
      ghost.innerHTML = '<span class="gem"></span><span class="nm"></span><span class="val"></span><span class="sz"></span>';
      document.body.appendChild(ghost);
    }
    const d = Grid.dims(it);
    const tier = TIERS.filter(function (t) { return t.id === it.tierId; })[0] || TIERS[0];
    ghost.style.setProperty('--qc', tier.color);
    ghost.querySelector('.nm').textContent = it.name;
    ghost.querySelector('.val').textContent = it.value;
    ghost.querySelector('.sz').textContent = d.w + '×' + d.h;
    return ghost;
  }

  function removeGhost() {
    if (ghost) ghost.remove();
    ghost = null;
  }

  /* ---------------- 旋转 ---------------- */
  function rotate() {
    if (!isOpen()) return false;
    const p = P();
    if (drag) {
      drag.it.rot = drag.it.rot ? 0 : 1;
      if (lastMouse) updateGhost(lastMouse);
      return true;
    }
    const it = (hover && p.inv.indexOf(hover) >= 0) ? hover : p.sel;
    if (!it) return false;
    const nr = it.rot ? 0 : 1;
    if (!Grid.fits(p.inv, it, it.gx, it.gy, nr, cols(), rows(), it)) {
      HUD.toast('空间不足，无法旋转', 'warn');
      return false;
    }
    it.rot = nr;
    p.sel = it;
    refresh();
    return true;
  }

  /* ---------------- 开关 ---------------- */
  function isOpen() {
    return !!(el.root && !el.root.classList.contains('hidden'));
  }

  function open() {
    const p = P();
    if (p.dead || G.mode !== 'mission') return;
    el.root.classList.remove('hidden');
    HUD.setAimVisible(false);
    if (!p.sel && p.inv.length) p.sel = p.inv[0];
    refresh();
  }

  function close() {
    if (!isOpen()) return;
    drag = null;
    removeGhost();
    cancelAction();
    el.root.classList.add('hidden');
    HUD.setAimVisible(true);
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  /* ---------------- 动作 ---------------- */
  function busy() {
    if (action) { HUD.toast('正在处理其他操作', 'warn'); return true; }
    return false;
  }

  function startAction(type, it) {
    if (!isOpen() || busy()) return;
    const p = P();
    const data = {
      dismantle: { dur: it.time, label: '分解 ' + it.name },
      heal: { dur: CFG.HEAL_TIME, label: '再生治疗' },
      mag: { dur: CFG.MAG_TIME, label: '压制弹夹' },
      supply: { dur: CFG.KIT_TIME, label: '使用补给' }
    }[type];
    if (!data) return;
    action = { type: type, item: it, t: 0, dur: data.dur, label: data.label };
    p.sel = it || p.sel;
    el.prog.classList.remove('hidden');
    el.progFill.style.width = '0%';
    el.progLabel.textContent = data.label + ' · 0%';
    refresh();
  }

  function tryCraft(wi) {
    const p = P();
    if (!isOpen() || busy()) return;
    const w = WEAPONS[wi];
    if (p.carried.indexOf(wi) < 0) { HUD.toast('未携带该武器', 'warn'); return; }
    if ((p.spares[wi] || 0) >= w.maxSpare) { HUD.toast('备弹已满（' + w.maxSpare + ' 夹）', 'warn'); return; }
    if (p.data < w.cost) { HUD.toast('数据不足 · 需要 ' + w.cost + ' NB', 'warn'); return; }
    action = { type: 'mag', weapon: wi, t: 0, dur: CFG.MAG_TIME, label: '压制 ' + w.name + ' 弹夹' };
    el.prog.classList.remove('hidden');
    el.progFill.style.width = '0%';
    el.progLabel.textContent = action.label + ' · 0%';
  }

  function tryHeal() {
    const p = P();
    if (!isOpen() || busy()) return;
    if (p.hp >= p.maxHp) { HUD.toast('生命值已满', 'warn'); return; }
    if (p.data < CFG.HEAL_COST) { HUD.toast('数据不足 · 需要 ' + CFG.HEAL_COST + ' NB', 'warn'); return; }
    action = { type: 'heal', t: 0, dur: CFG.HEAL_TIME, label: '再生治疗' };
    el.prog.classList.remove('hidden');
    el.progFill.style.width = '0%';
    el.progLabel.textContent = action.label + ' · 0%';
  }

  function useSupply(id) {
    const p = P();
    if (!isOpen() || busy()) return;
    const s = SUPPLY_BY_ID[id];
    if (!s) return;
    if ((p.kit[id] || 0) <= 0) { HUD.toast('没有' + s.name, 'warn'); return; }
    if (id === 'medkit' && p.hp >= p.maxHp) { HUD.toast('生命值已满', 'warn'); return; }
    if (id === 'battery' && p.shield >= p.maxShield) { HUD.toast('护盾已满', 'warn'); return; }
    action = { type: 'supply', supplyId: id, t: 0, dur: s.time, label: '使用 ' + s.name };
    el.prog.classList.remove('hidden');
    el.progFill.style.width = '0%';
    el.progLabel.textContent = action.label + ' · 0%';
  }

  function cancelAction(msg) {
    if (!action) return;
    action = null;
    if (el.prog) el.prog.classList.add('hidden');
    if (el.progFill) el.progFill.style.width = '0%';
    if (msg) HUD.toast(msg, 'warn');
  }

  function complete() {
    const p = P();
    const a = action;
    action = null;
    el.prog.classList.add('hidden');
    el.progFill.style.width = '0%';
    if (!a) return;

    if (a.type === 'dismantle') {
      const it = a.item;
      if (!it || p.inv.indexOf(it) < 0) return;
      removeItem(it);
      p.data += it.value;
      p.dismantledValue += it.value;
      HUD.toast('+' + it.value + ' NB · 数据提取完成', 'good');
      refresh();
    } else if (a.type === 'mag') {
      const w = WEAPONS[a.weapon];
      if (!w) return;
      if (p.data < w.cost) { HUD.toast('数据不足', 'warn'); return; }
      p.data -= w.cost;
      p.spares[a.weapon] = Math.min(w.maxSpare, (p.spares[a.weapon] || 0) + 1);
      HUD.toast('弹夹压装完成 · ' + w.name, 'good');
      if (a.weapon === p.weapon) HUD.mag(p.weapon);
      HUD.updateSlots(p);
      refresh();
    } else if (a.type === 'heal') {
      if (p.data < CFG.HEAL_COST) { HUD.toast('数据不足', 'warn'); return; }
      p.data -= CFG.HEAL_COST;
      p.hp = p.maxHp;
      HUD.toast('生命值已回复', 'good');
      refresh();
    } else if (a.type === 'supply') {
      const s = SUPPLY_BY_ID[a.supplyId];
      if (!s || (p.kit[s.id] || 0) <= 0) { HUD.toast('补给不足', 'warn'); return; }
      p.kit[s.id]--;
      if (s.heal) p.hp = Math.min(p.maxHp, p.hp + s.heal);
      if (s.shield) p.shield = Math.min(p.maxShield, p.shield + s.shield);
      HUD.toast(s.name + ' 已使用', 'good');
      refresh();
    }
  }

  function update(dt) {
    if (!action) return;
    const p = P();
    if (!isOpen()) { cancelAction(); return; }
    if (p.moving || p.dead) { cancelAction('操作中断'); return; }
    action.t += dt;
    const pct = clamp(action.t / action.dur, 0, 1) * 100;
    el.progFill.style.width = pct.toFixed(1) + '%';
    el.progLabel.textContent = action.label + ' · ' + Math.floor(pct) + '%';
    if (action.t >= action.dur) complete();
  }

  function reset() {
    drag = null; hover = null; action = null;
    removeGhost();
    if (el.root) el.root.classList.add('hidden');
    if (el.prog) el.prog.classList.add('hidden');
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  return {
    init: init, beginRun: beginRun, reset: reset,
    addItem: addItem, removeItem: removeItem, refresh: refresh,
    open: open, close: close, toggle: toggle, isOpen: isOpen,
    rotate: rotate, update: update, cancelAction: cancelAction,
    startAction: startAction, debugComplete: complete,
    debugCraft: tryCraft, debugHeal: tryHeal, debugUse: useSupply,
    actionType: function () { return action ? action.type : ''; }
  };
})();
