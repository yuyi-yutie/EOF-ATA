'use strict';

/* ============================================================
   仓库（大厅内页）
   - 12×8 大网格，物品按尺寸占格，跨局保存
   - 右键单件立即分解成数据；也可以一键全部拆解 / 整理
   ============================================================ */

const Stash = (function () {
  let CELL = 52;
  let GAP = 6;
  let PITCH = CELL + GAP;

  const el = {};
  let selected = null;
  let msgTimer = 0;
  let sDrag = null;
  let sGhost = null;
  let sDrop = null;

  /* 手机横屏用更小的格子，保证 12×8 仓库 + 右侧详情能塞进屏幕 */
  function layout() {
    const touch = !!window.__touchMode;
    const tiny = touch && window.innerWidth < 700;
    const compact = touch && (window.innerWidth < 1100 || window.innerHeight < 600);
    const nextCell = tiny ? 27 : (compact ? 30 : 52);
    const nextGap = tiny ? 2 : (compact ? 3 : 6);
    if (nextCell === CELL && nextGap === GAP) return false;
    CELL = nextCell;
    GAP = nextGap;
    PITCH = CELL + GAP;
    return true;
  }

  function applyGrid() {
    if (!el.grid) return;
    el.grid.style.gridTemplateColumns = 'repeat(' + CFG.STASH_COLS + ', ' + CELL + 'px)';
    el.grid.style.gridTemplateRows = 'repeat(' + CFG.STASH_ROWS + ', ' + CELL + 'px)';
    el.grid.style.gap = GAP + 'px';
  }

  function init() {
    el.root = UI.$('paneStash');
    el.grid = UI.$('stashGrid');
    el.items = UI.$('stashItems');
    el.list = UI.$('stashListMobile');
    el.bank = UI.$('stashBank');
    el.count = UI.$('stashCount');
    el.value = UI.$('stashValue');
    el.cells = UI.$('stashCells');
    el.detail = UI.$('stashDetail');
    el.breakdown = UI.$('stashBreak');
    el.all = UI.$('stashAll');
    el.sort = UI.$('stashSort');
    el.msg = UI.$('stashMsg');
    const tip = el.root.querySelector('.pane-tip');
    if (tip && window.__touchMode) {
      tip.innerHTML = '点选物资行 → 直接分解（不消耗时间）<br>撤离成功才会入库';
    }

    layout();
    applyGrid();

    for (let i = 0; i < CFG.STASH_COLS * CFG.STASH_ROWS; i++) {
      const d = UI.el('div', 'cell');
      d.addEventListener('click', function () { selected = null; refresh(); });
      el.grid.insertBefore(d, el.items);
    }

    sDrop = UI.el('div', 'stash-drop');
    sDrop.id = 'stashDrop';
    el.grid.appendChild(sDrop);

    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);

    el.all.addEventListener('click', function () {
      if (!Store.stashCount()) return;
      const r = Store.stashDismantleAll();
      selected = null;
      refresh();
      Lobby.refreshBank();
      msg('全部拆解 · +' + UI.fmt(r.value) + ' NB');
    });

    el.sort.addEventListener('click', function () {
      Store.stashRepack();
      refresh();
      msg('已整理');
    });

    el.detail.addEventListener('click', function (e) {
      const target = e.target;
      const btn = target && target.closest ? target.closest('[data-stash-act]') : null;
      if (!btn || !selected) return;
      const act = btn.getAttribute('data-stash-act');
      if (act === 'equip0') equip(selected, 0);
      else if (act === 'equip1') equip(selected, 1);
      else dismantle(selected);
    });

    if (el.list) el.list.addEventListener('click', function (e) {
      const target = e.target;
      if (!target || !target.closest) return;
      const del = target.closest('[data-stash-dismantle]');
      if (del) {
        const it = Store.stash()[parseInt(del.getAttribute('data-stash-dismantle'), 10)];
        if (it) dismantle(it);
        return;
      }
      const eq = target.closest('[data-stash-equip]');
      if (eq) {
        const it = Store.stash()[parseInt(eq.getAttribute('data-stash-equip'), 10)];
        if (it) equip(it, -1);
        return;
      }
      const row = target.closest('.stash-row');
      if (!row || !row.dataset.idx) return;
      const it = Store.stash()[parseInt(row.dataset.idx, 10)];
      if (!it) return;
      selected = it;
      refresh();
    });

    window.addEventListener('resize', function () {
      if (layout()) refresh();
    });
  }

  function tierOf(id) {
    return TIER_BY_ID[id] || TIERS[0];
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function ensureGhost(it) {
    if (sGhost) return sGhost;
    const d = Grid.dims(it);
    sGhost = UI.el('div', 'stash-drag-ghost');
    const tier = tierOf(it.tierId);
    sGhost.style.setProperty('--qc', ITEMS.colorOf(it));
    if (it.kind === 'chip' && CHIP_BY_ID[it.chipId]) {
      sGhost.style.setProperty('--cc', CHIP_BY_ID[it.chipId].color);
    }
    sGhost.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    sGhost.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    sGhost.innerHTML =
      (it.kind === 'weapon' && typeof WeaponView !== 'undefined'
        ? '<span class="weapon-thumb">' + WeaponView.svg(it.weaponId) + '</span>'
        : '<span class="gem"></span>') +
      '<span class="nm">' + UI.esc(it.name) + '</span>';
    document.body.appendChild(sGhost);
    return sGhost;
  }

  function removeGhost() {
    if (sGhost) sGhost.remove();
    sGhost = null;
  }

  function showDrop(it, tx, ty, valid) {
    if (!sDrop) return;
    const d = Grid.dims(it);
    sDrop.style.display = 'block';
    sDrop.style.left = (tx * PITCH) + 'px';
    sDrop.style.top = (ty * PITCH) + 'px';
    sDrop.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    sDrop.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    sDrop.className = 'stash-drop ' + (valid ? 'ok' : 'bad');
  }

  function hideDrop() {
    if (sDrop) sDrop.style.display = 'none';
  }

  function onItemDown(e, it, node) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const rect = el.grid.getBoundingClientRect();
    const d = Grid.dims(it);
    const itemX = rect.left + it.gx * PITCH;
    const itemY = rect.top + it.gy * PITCH;
    const fx = clamp((e.clientX - itemX) / PITCH, 0, d.w - 0.01);
    const fy = clamp((e.clientY - itemY) / PITCH, 0, d.h - 0.01);
    sDrag = {
      it: it, fx: fx, fy: fy, id: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      ox: it.gx, oy: it.gy, moved: false,
      tx: it.gx, ty: it.gy, valid: true
    };
    selected = it;
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    refresh();
  }

  function onDragMove(e) {
    if (!sDrag || e.pointerId !== sDrag.id) return;
    if (!sDrag.moved && Math.abs(e.clientX - sDrag.sx) + Math.abs(e.clientY - sDrag.sy) > 4) {
      sDrag.moved = true;
      document.body.classList.add('weapon-dragging');
    }
    if (!sDrag.moved) return;
    e.preventDefault();
    const rect = el.grid.getBoundingClientRect();
    const it = sDrag.it;
    const tx = Math.round((e.clientX - rect.left) / PITCH - sDrag.fx);
    const ty = Math.round((e.clientY - rect.top) / PITCH - sDrag.fy);
    const valid = Grid.fits(Store.stash(), it, tx, ty, it.rot, CFG.STASH_COLS, CFG.STASH_ROWS, it);
    sDrag.tx = tx; sDrag.ty = ty; sDrag.valid = valid;

    const g = ensureGhost(it);
    g.style.left = (e.clientX - sDrag.fx * PITCH) + 'px';
    g.style.top = (e.clientY - sDrag.fy * PITCH) + 'px';

    // 武器/芯片拖到配装槽：隐藏网格落点，高亮配装行
    const rows = document.querySelectorAll('#lobbyLoad .load-row');
    let overRow = null;
    if (it.kind === 'weapon' || it.kind === 'chip') {
      for (let i = 0; i < rows.length; i++) {
        if (pointInRect(rows[i].getBoundingClientRect(), e.clientX, e.clientY)) { overRow = rows[i]; break; }
      }
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.remove('drop-weapon');
      rows[i].classList.remove('drop-chip');
      rows[i].classList.remove('bad');
    }
    if (overRow) {
      if (it.kind === 'chip') {
        overRow.classList.add('drop-chip');
        const target = chipTargetForRow(overRow, it);
        overRow.classList.toggle('bad', !target.valid);
      } else {
        overRow.classList.add('drop-weapon');
      }
      hideDrop();
      return;
    }

    if (pointInRect(rect, e.clientX, e.clientY)) showDrop(it, tx, ty, valid);
    else hideDrop();
  }

  function onDragUp(e) {
    if (!sDrag || (e && e.pointerId !== undefined && e.pointerId !== sDrag.id)) return;
    const d = sDrag;
    sDrag = null;
    removeGhost();
    hideDrop();
    document.body.classList.remove('weapon-dragging');
    const rows = document.querySelectorAll('#lobbyLoad .load-row');
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.remove('drop-weapon');
      rows[i].classList.remove('drop-chip');
      rows[i].classList.remove('bad');
    }
    if (!e || e.type === 'pointercancel' || !d.moved) { refresh(); return; }

    if (d.it.kind === 'weapon' || d.it.kind === 'chip') {
      let overRow = null;
      for (let i = 0; i < rows.length; i++) {
        if (pointInRect(rows[i].getBoundingClientRect(), e.clientX, e.clientY)) { overRow = rows[i]; break; }
      }
      if (overRow) {
        if (d.it.kind === 'weapon') dropWeaponOnLoadout(d.it, e.clientX, e.clientY);
        else dropChipOnLoadout(d.it, e.clientX, e.clientY);
        return;
      }
    }

    const rect = el.grid.getBoundingClientRect();
    if (pointInRect(rect, e.clientX, e.clientY) && d.valid) {
      d.it.gx = d.tx;
      d.it.gy = d.ty;
      Store.save();
      selected = d.it;
      msg('已移动 ' + d.it.name);
    }
    refresh();
  }

  function renderItems() {
    const list = Store.stash();
    el.items.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const d = Grid.dims(it);
      const chip = it.kind === 'chip';
      const weapon = it.kind === 'weapon';
      const div = UI.el('div', 'stash-item' + (chip ? ' chip-item' : '') + (weapon ? ' weapon-item' : '') + (selected === it ? ' sel' : ''));
      div.style.left = (it.gx * PITCH) + 'px';
      div.style.top = (it.gy * PITCH) + 'px';
      div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      div.style.setProperty('--qc', ITEMS.colorOf(it));
      if (chip && CHIP_BY_ID[it.chipId]) div.style.setProperty('--cc', CHIP_BY_ID[it.chipId].color);
      div.innerHTML =
        (weapon && typeof WeaponView !== 'undefined'
          ? '<span class="weapon-thumb">' + WeaponView.svg(it.weaponId) + '</span>'
          : (chip ? '<span class="chip-ico"></span>' : '')) +
        '<span class="sz">' + d.w + '×' + d.h + '</span>' +
        '<span class="nm">' + UI.esc(it.name) + '</span>' +
        '<span class="val">' + it.value + '</span>';
      div.addEventListener('click', function (e) {
        e.stopPropagation();
        selected = it;
        refresh();
      });
      div.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dismantle(it);
      });
      div.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button')) return;
        onItemDown(e, it, div);
      });
      if (typeof ItemTip !== 'undefined') ItemTip.bind(div, it);
      el.items.appendChild(div);
    }
  }

  /* 手机端用列表代替 12×8 小格子，避免文字和按钮被压扁 */
  function renderList() {
    if (!el.list) return;
    const list = Store.stash();
    el.list.innerHTML = '';
    if (!list.length) {
      el.list.innerHTML = '<div class="stash-row empty">仓库为空</div>';
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const d = Grid.dims(it);
      const t = tierOf(it.tierId);
      const chipDef = it.kind === 'chip' ? CHIP_BY_ID[it.chipId] : null;
      const weapon = it.kind === 'weapon';
      const wdef = weapon ? WEAPONS[it.weaponId] : null;
      const row = UI.el('div', 'stash-row' + (chipDef ? ' chip' : '') + (weapon ? ' weapon' : '') + (selected === it ? ' sel' : ''));
      row.dataset.idx = i;
      row.style.setProperty('--qc', ITEMS.colorOf(it));
      if (chipDef) row.style.setProperty('--cc', chipDef.color);
      row.innerHTML =
        '<span class="sr-dot"></span>' +
        '<span class="sr-name">' + UI.esc(it.name) + '</span>' +
        '<span class="sr-tier">' + (weapon && wdef ? wdef.tag + ' · 武器' : (chipDef ? t.name + ' · ' + chipDef.desc : t.name)) + '</span>' +
        '<span class="sr-size">' + d.w + '×' + d.h + '</span>' +
        '<span class="sr-val">' + it.value + '</span>' +
        (weapon ? '<button type="button" class="sr-btn" data-stash-equip="' + i + '">装备</button>' : '') +
        '<button type="button" class="sr-btn" data-stash-dismantle="' + i + '">分解</button>';
      if (typeof ItemTip !== 'undefined') ItemTip.bind(row, it);
      el.list.appendChild(row);
    }
  }

  function renderDetail() {
    const list = Store.stash();
    if (!selected || list.indexOf(selected) < 0) {
      el.detail.innerHTML = window.__touchMode
        ? '<div class="dt-empty">仓库物资会跨局保存<br><span>点选物资后在下方分解</span></div>'
        : '<div class="dt-empty">仓库物资会跨局保存<br><span>右键单件立即分解</span></div>';
      return;
    }
    const it = selected;
    const d = Grid.dims(it);
    const t = tierOf(it.tierId);
    if (it.kind === 'weapon') {
      const w = WEAPONS[it.weaponId] || { name: it.name, tag: '武器', mag: 0, rate: 0 };
      const lo = Store.loadout();
      const chips = (it.chips || []).length;
      el.detail.innerHTML =
        '<div class="dt-weapon-art">' +
          (typeof WeaponView !== 'undefined' ? WeaponView.svg(it.weaponId) : '') +
        '</div>' +
        '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
        '<div class="dt-line"><span>类型</span><b style="color:' + (w.color || '#e8e2d6') + '">' + w.tag + ' · 武器</b></div>' +
        '<div class="dt-line"><span>弹夹 / 射速</span><b>' + (w.mag || 0) + ' 发 · ' + (w.rate || 0).toFixed(2) + 's</b></div>' +
        '<div class="dt-line"><span>已装芯片</span><b>' + chips + ' / 3</b></div>' +
        '<div class="dt-line"><span>数据价值</span><b>' + it.value + ' NB</b></div>' +
        '<div class="dt-line"><span>尺寸</span><b>' + d.w + '×' + d.h + '</b></div>' +
        '<div class="dt-actions">' +
          '<button type="button" class="dt-btn" data-stash-act="equip0"' + (lo.weapons[0] ? ' disabled' : '') + '>装备到槽 1</button>' +
          '<button type="button" class="dt-btn" data-stash-act="equip1"' + (lo.weapons[1] ? ' disabled' : '') + '>装备到槽 2</button>' +
          '<button type="button" class="dt-btn danger" data-stash-act="dismantle">分解</button>' +
        '</div>';
      return;
    }
    const def = it.kind === 'chip' ? CHIP_BY_ID[it.chipId] : null;
    el.detail.innerHTML =
      '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
      (def
        ? '<div class="dt-line"><span>芯片效果</span><b style="color:' + def.color + '">' + def.desc + '</b></div>' +
          '<div class="dt-line"><span>数据价值</span><b>' + it.value + ' NB</b></div>' +
          '<div class="dt-line"><span>品质 / 类型</span><b>' + t.name + ' · ' + (def.forTag ? def.forTag + '专属芯片' : '通用芯片') + '</b></div>' +
          (def.forTag ? '<div class="dt-line"><span>安装限制</span><b style="color:' + def.color + '">仅限 ' + def.forTag + ' 武器</b></div>' : '')
        : '<div class="dt-line"><span>' + t.name + ' · 数据载体</span><b>' + it.value + ' NB</b></div>') +
      '<div class="dt-line"><span>尺寸</span><b>' + d.w + '×' + d.h + '</b></div>' +
      '<div class="dt-line"><span>分解耗时</span><b>仓库内瞬发</b></div>' +
      '<div class="dt-hint">' + (def ? '在机库「配装」页点芯片槽装备' : '[右键] 立即分解为数据') + '</div>' +
      '<div class="dt-touch"><button type="button" class="dt-btn danger" data-stash-act="dismantle">分解</button></div>';
  }

  function dismantle(it) {
    if (it && it.kind === 'weapon' && it.chips && it.chips.length) {
      msg('武器上还有芯片 · 先装备后卸下芯片再分解');
      return;
    }
    const v = Store.stashDismantle(it);
    if (!v) return;
    if (selected === it) selected = null;
    refresh();
    Lobby.refreshBank();
    msg('+' + UI.fmt(v) + ' NB');
  }

  function equip(it, slot) {
    if (!it || it.kind !== 'weapon') return;
    const lo = Store.loadout();
    let target = slot;
    if (target < 0) {
      if (!lo.weapons[0]) target = 0;
      else if (!lo.weapons[1]) target = 1;
      else target = -1;
    }
    if (target < 0) { msg('两个配装槽都已占用 · 先卸下一把武器'); return; }
    const r = Store.equipWeapon(target, it);
    if (!r.ok) { msg(r.msg); return; }
    selected = null;
    refresh();
    HUD.toast(r.msg, 'good');
    if (typeof Lobby !== 'undefined') { Lobby.refreshBank(); Lobby.refresh(); }
  }

  function pointInRect(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function dropWeaponOnLoadout(it, x, y) {
    const rows = document.querySelectorAll('#lobbyLoad .load-row');
    for (let i = 0; i < rows.length; i++) {
      if (!pointInRect(rows[i].getBoundingClientRect(), x, y)) continue;
      const slot = parseInt(rows[i].dataset.eqSlot, 10);
      if (!(slot >= 0)) continue;
      if (Store.loadout().weapons[slot]) { msg('该配装槽已被占用'); return; }
      const r = Store.equipWeapon(slot, it);
      if (!r.ok) { msg(r.msg); return; }
      selected = null;
      refresh();
      HUD.toast(r.msg, 'good');
      if (typeof Lobby !== 'undefined') { Lobby.refreshBank(); Lobby.refresh(); }
      return;
    }
  }

  function chipTargetForRow(row, it) {
    const slot = parseInt(row.dataset.eqSlot, 10);
    if (!(slot >= 0)) return { valid: false, wi: -1 };
    const eq = Store.loadout().weapons[slot];
    if (!eq) return { valid: false, wi: -1 };
    const chips = Store.weaponChips(eq.weaponId);
    return {
      valid: ITEMS.chipFitsWeapon(it, eq.weaponId) && chips.length < 3,
      wi: eq.weaponId
    };
  }

  function dropChipOnLoadout(it, x, y) {
    const rows = document.querySelectorAll('#lobbyLoad .load-row');
    for (let i = 0; i < rows.length; i++) {
      if (!pointInRect(rows[i].getBoundingClientRect(), x, y)) continue;
      const target = chipTargetForRow(rows[i], it);
      if (!(target.wi >= 0)) { msg('该配装槽没有武器'); return; }
      const r = Store.installChip(target.wi, it);
      msg(r.msg || (r.ok ? '芯片已安装' : '无法安装'));
      if (!r.ok) return;
      selected = null;
      refresh();
      if (typeof Lobby !== 'undefined') { Lobby.refreshBank(); Lobby.refresh(); }
      return;
    }
  }

  function renderBreakdown() {
    if (!el.breakdown) return;
    const list = Store.stash();
    const rows = TIERS.map(function (t) { return { t: t, n: 0, v: 0 }; });
    for (let i = 0; i < list.length; i++) {
      let row = rows[rows.length - 1];
      for (let k = 0; k < rows.length; k++) {
        if (rows[k].t.id === list[i].tierId) { row = rows[k]; break; }
      }
      row.n++;
      row.v += list[i].value || 0;
    }
    const total = list.length || 1;
    el.breakdown.innerHTML = '';
    rows.forEach(function (r) {
      const d = UI.el('div', 'sb-row');
      d.style.setProperty('--tc', r.t.color);
      d.innerHTML =
        '<span class="sb-dot"></span>' +
        '<span class="sb-name">' + r.t.name + '</span>' +
        '<span class="sb-count">' + r.n + ' 件</span>' +
        '<span class="sb-val">' + UI.fmt(r.v) + '</span>' +
        '<span class="sb-bar"><i style="width:' + (r.n / total * 100).toFixed(1) + '%"></i></span>';
      el.breakdown.appendChild(d);
    });
  }

  function refresh() {
    if (!el.root) return;
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    applyGrid();
    const list = Store.stash();
    if (selected && list.indexOf(selected) < 0) selected = null;
    el.bank.textContent = UI.fmt(Store.bank());
    el.count.textContent = list.length;
    el.value.textContent = UI.fmt(Store.stashValue());
    el.cells.textContent = Store.stashCells() + ' / ' + (CFG.STASH_COLS * CFG.STASH_ROWS);
    el.all.classList.toggle('dis', list.length === 0);
    renderItems();
    renderList();
    renderDetail();
    renderBreakdown();
  }

  function msg(text) {
    if (!el.msg) return;
    el.msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.msg.textContent = ''; }, 1800);
  }

  /* 打开仓库时默认选中第一件，右侧详情不至于空着 */
  function selectFirst() {
    const list = Store.stash();
    if (list.length && (!selected || list.indexOf(selected) < 0)) selected = list[0];
    refresh();
  }

  return { init: init, refresh: refresh, selectFirst: selectFirst, msg: msg };
})();
