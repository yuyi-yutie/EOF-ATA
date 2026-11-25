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
  let socketDrag = null;
  let action = null;
  let builtRows = 0;
  let chest = null;
  let chestBuilt = false;
  let chestBuiltKey = '';
  let chestDrag = null;
  let corpseDrag = null;

  function P() { return G.state.player; }
  function cols() { return CFG.INV_COLS; }
  function rows() { return P().invRows || CFG.INV_ROWS; }
  function chestCols() { return (chest && chest.cols) || CFG.CHEST_COLS; }
  function chestRows() { return (chest && chest.rows) || CFG.CHEST_ROWS; }
  function chestName() { return (chest && chest.name) || '物资箱'; }

  /* 窄/矮屏用更小的格子，保证 6 列背包能完整放下 */
  function layout() {
    const compact = (window.innerWidth < 820 || window.innerHeight < 520);
    const tiny = window.innerWidth < 620;
    const nextCell = tiny ? 48 : (compact ? 54 : 72);
    const nextGap = tiny ? 5 : (compact ? 6 : 8);
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
    el.weapons = UI.$('invWeapons');
    el.craft = UI.$('craftList');
    el.kit = UI.$('kitList');
    el.heal = UI.$('healBtn');
    el.prog = UI.$('actionProg');
    el.progLabel = UI.$('apLabel');
    el.progFill = UI.$('apFill');
    el.close = UI.$('invClose');
    el.title = document.querySelector('.inv-title');
    el.chestPanel = UI.$('chestPanel');
    el.chestGrid = UI.$('chestGrid');
    el.chestItems = UI.$('chestItems');
    el.chestCount = UI.$('chestCount');
    el.chestCap = UI.$('chestCap');
    el.chestStatus = UI.$('chestStatus');
    el.chestHint = document.querySelector('#chestPanel .chest-status-hint');
    el.chestWeapons = UI.$('chestWeapons');
    el.corpseWeaponWrap = UI.$('corpseWeaponWrap');
    el.chestTitle = document.querySelector('.chest-title');
    el.chestLens = UI.$('chestLens');
    el.takeAll = UI.$('chestTakeAll');
    el.storeAll = UI.$('chestStoreAll');
    el.chestClose = UI.$('chestClose');
    if (window.__touchMode) el.close.textContent = '关闭';

    el.close.addEventListener('click', function () { close(); });
    el.heal.addEventListener('click', function () { tryHeal(); });
    if (el.takeAll) el.takeAll.addEventListener('click', takeAll);
    if (el.storeAll) el.storeAll.addEventListener('click', storeAll);
    if (el.chestClose) el.chestClose.addEventListener('click', close);

    el.detail.addEventListener('click', function (e) {
      const target = e.target;
      const btn = target && target.closest ? target.closest('[data-inv-act]') : null;
      if (!btn) return;
      const p = P();
      const it = p.sel;
      if (!it || p.inv.indexOf(it) < 0) return;
      if (btn.getAttribute('data-inv-act') === 'rotate') rotate();
      else if (btn.getAttribute('data-inv-act') === 'chip') quickInstallAny();
      else if (btn.getAttribute('data-inv-act') === 'equip') quickEquipWeapon();
      else startAction('dismantle', it, 'bag');
    });

    layout();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', function () {
      if (layout()) {
        builtRows = 0;
        chestBuilt = false;
        if (isOpen()) {
          buildGrid(rows(), true);
          if (chest) buildChestGrid();
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
    socketDrag = null;
    chest = null;
    chestDrag = null;
    chestBuilt = false;
    hideDrop();
    clearChestHighlight();
    hideChestLens();
    if (el.root) el.root.classList.remove('chest-open');
    if (el.chestPanel) el.chestPanel.classList.add('hidden');
    if (el.chestGrid) el.chestGrid.classList.remove('searching');
    if (el.title) el.title.textContent = '背包 / INVENTORY';
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
    const div = UI.el('div', 'inv-item' + (it.kind === 'chip' ? ' chip-item' : '') + (extra || ''));
    div.style.left = (it.gx * PITCH) + 'px';
    div.style.top = (it.gy * PITCH) + 'px';
    div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    div.style.setProperty('--qc', ITEMS.colorOf(it));
    if (it.kind === 'chip' && CHIP_BY_ID[it.chipId]) {
      div.style.setProperty('--cc', CHIP_BY_ID[it.chipId].color);
    }
    if (it.kind === 'weapon') div.classList.add('weapon-item');
    const icon = (it.kind === 'weapon' && typeof WeaponView !== 'undefined')
      ? '<span class="weapon-thumb">' + WeaponView.svg(it.weaponId) + '</span>'
      : '<span class="gem"></span>';
    div.innerHTML =
      icon +
      '<span class="nm">' + UI.esc(it.name) + '</span>' +
      '<span class="val">' + it.value + '</span>' +
      '<span class="sz">' + d.w + '×' + d.h + '</span>';
    if (typeof ItemTip !== 'undefined') ItemTip.bind(div, it);
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
        startAction('dismantle', it, 'bag');
      });
      el.items.appendChild(div);
    }
  }

  /* ---------------- 物资箱 ---------------- */
  function nowSec() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  function buildChestGrid() {
    if (!el.chestGrid) return;
    const key = chestCols() + 'x' + chestRows();
    if (chestBuilt && chestBuiltKey === key && el.chestGrid.children.length > 1) {
      el.chestCap.textContent = chestCols() * chestRows();
      return;
    }
    chestBuilt = true;
    chestBuiltKey = key;
    el.chestGrid.innerHTML = '';
    el.chestGrid.style.gridTemplateColumns = 'repeat(' + chestCols() + ', ' + CELL + 'px)';
    el.chestGrid.style.gridTemplateRows = 'repeat(' + chestRows() + ', ' + CELL + 'px)';
    for (let i = 0; i < chestCols() * chestRows(); i++) {
      el.chestGrid.appendChild(UI.el('div', 'cell'));
    }
    const items = UI.el('div', 'inv-items');
    items.id = 'chestItems';
    el.chestGrid.appendChild(items);
    const drop = UI.el('div', 'inv-drop chest-drop');
    drop.id = 'chestDrop';
    el.chestGrid.appendChild(drop);
    const lens = UI.el('div', 'chest-lens hidden');
    lens.id = 'chestLens';
    el.chestGrid.appendChild(lens);
    el.chestItems = items;
    el.chestDrop = drop;
    el.chestLens = lens;
    el.chestCap.textContent = chestCols() * chestRows();
  }

  /* 开箱搜索：保留已搜索过的物品；已全部搜索过则直接显示，不重播动画 */
  function initChestSearch(c) {
    const s = {
      active: false, done: true,
      order: [], idx: -1, t: 0,
      found: 0, total: 0, lastFound: null
    };
    c.search = s;
    const unfound = [];
    for (let i = 0; i < c.inv.length; i++) {
      const it = c.inv[i];
      if (it.found) s.found++;
      else unfound.push(it);
    }
    s.total = c.inv.length;
    s.order = unfound.sort(function (a, b) {
      return (a.gy - b.gy) || (a.gx - b.gx);
    });
    s.active = s.order.length > 0;
    s.done = !s.active;
    s.idx = s.active ? 0 : -1;
    s.t = 0;
    renderChest();
    updateChestStatus();
    if (s.active) updateChestLens(s.order[0], s);
    else hideChestLens();
  }

  function nextChestItem() {
    if (!chest || !chest.search) return;
    const s = chest.search;
    s.idx++;
    s.t = 0;
    if (s.idx >= s.order.length) { finishChestSearch(); return; }
    renderChest();
    updateChestStatus();
    updateChestLens(s.order[s.idx], s);
  }

  function finishChestSearch() {
    if (!chest || !chest.search) return;
    const s = chest.search;
    s.active = false;
    s.done = true;
    hideChestLens();
    renderChest();
    updateChestStatus();
  }

  function updateChestSearch(dt) {
    if (!chest || !chest.search) return;
    const s = chest.search;
    if (!s.active) return;
    const it = s.order[s.idx];
    if (!it) { finishChestSearch(); return; }
    s.t += dt;
    if (!it.found && s.t >= CFG.CHEST_SEARCH_TIME) {
      it.found = true;
      it.foundAt = nowSec();
      s.lastFound = it;
      s.found++;
      foundBurst(it);
      renderChest();
      hideChestLens();
      updateChestStatus();
    }
    if (s.t >= CFG.CHEST_SEARCH_TIME + CFG.CHEST_SEARCH_GAP) {
      nextChestItem();
    } else if (!it.found) {
      updateChestLens(it, s);
    }
  }

  function updateChestStatus() {
    if (!chest || !chest.search) return;
    const s = chest.search;
    let found = 0;
    for (let i = 0; i < chest.inv.length; i++) if (chest.inv[i].found) found++;
    s.found = found;
    s.total = chest.inv.length;
    let weaponCount = 0;
    if (chest.corpse) {
      const ws = corpseWeaponSlots();
      weaponCount = (ws[0] ? 1 : 0) + (ws[1] ? 1 : 0);
    }
    const totalAll = s.total + weaponCount;
    if (el.chestStatus) {
      el.chestStatus.textContent = totalAll
        ? (chest.corpse ? '可搜刮' : (s.active ? '搜索中 ' + found + ' / ' + s.total : '搜索完成'))
        : (chest.emptyText || '空箱子');
    }
    if (el.takeAll) {
      el.takeAll.disabled = false;
      el.takeAll.classList.remove('dis');
      el.takeAll.textContent = s.active ? '拿走已发现' : '全部拿走';
    }
    if (el.chestHint) {
      el.chestHint.textContent = s.active
        ? '搜索中 · 已发现的物资可先拿取'
        : (chest.corpse ? '搜刮尸体 · 武器与物资可分别拿取' : '从上到下 · 从左到右');
    }
    if (el.chestGrid) el.chestGrid.classList.toggle('searching', s.active);
  }

  function updateChestLens(it, s) {
    if (!el.chestLens || !it) { hideChestLens(); return; }
    const d = Grid.dims(it);
    const w = d.w * CELL + (d.w - 1) * GAP;
    const h = d.h * CELL + (d.h - 1) * GAP;
    const cx = it.gx * PITCH + w * 0.5;
    const cy = it.gy * PITCH + h * 0.5;
    const rad = Math.max(6, Math.min(w, h) * 0.24);
    const a = s.t * 9 + s.idx * 1.7;
    el.chestLens.style.left = (cx + Math.cos(a) * rad) + 'px';
    el.chestLens.style.top = (cy + Math.sin(a) * rad * 0.82) + 'px';
    el.chestLens.classList.remove('hidden');
  }

  function hideChestLens() {
    if (el.chestLens) el.chestLens.classList.add('hidden');
  }

  function foundBurst(it) {
    if (!el.chestGrid) return;
    /* 一次只保留当前物品的成功特效，避免上一个物品的特效同时播放 */
    const olds = el.chestGrid.querySelectorAll('.chest-burst');
    for (let i = 0; i < olds.length; i++) olds[i].remove();
    const d = Grid.dims(it);
    const b = UI.el('div', 'chest-burst');
    b.style.left = (it.gx * PITCH) + 'px';
    b.style.top = (it.gy * PITCH) + 'px';
    b.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    b.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    el.chestGrid.appendChild(b);
    setTimeout(function () {
      if (b.parentNode) b.parentNode.removeChild(b);
    }, 560);
  }

  function renderChest() {
    if (!chest || !el.chestItems) return;
    el.chestItems.innerHTML = '';
    const s = chest.search;
    const cur = (s && s.active && s.idx >= 0) ? s.order[s.idx] : null;
    const now = nowSec();
    for (let i = 0; i < chest.inv.length; i++) {
      const it = chest.inv[i];
      const found = !!it.found;
      const recent = found && s && s.lastFound === it && it.foundAt && (now - it.foundAt < 0.4);
      const cls = ' chest-item' + (found ? ' found' : ' unknown') +
        (it === cur && !found ? ' scanning' : '') +
        (recent ? ' pop' : '');
      const div = itemNode(it, cls);
      if (!found) div.innerHTML = '';
      div.addEventListener('pointerdown', function (e) { onChestDown(e, it); });
      div.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (!found) return;
        if (chest && chest.search && chest.search.active) return;
        startAction('dismantle', it, 'chest');
      });
      el.chestItems.appendChild(div);
    }
    el.chestCount.textContent = Grid.usedCells(chest.inv);
    el.chestCap.textContent = chestCols() * chestRows();
    renderChestWeapon();
    updateChestStatus();
  }

  function corpseWeaponSlots() {
    if (!chest || !chest.corpse) return [null, null];
    if (!chest.weapons) chest.weapons = [chest.weapon || null, null];
    if (chest.weapon) {
      if (!chest.weapons[0]) chest.weapons[0] = chest.weapon;
      chest.weapon = null;
    }
    if (!chest.weapons[1]) chest.weapons[1] = null;
    chest.weapons[0] = chest.weapons[0] || null;
    return chest.weapons;
  }

  function renderChestWeapon() {
    if (!el.chestWeapons) return;
    el.chestWeapons.innerHTML = '';
    if (!chest || !chest.corpse) return;
    const slots = corpseWeaponSlots();
    for (let s = 0; s < 2; s++) {
      const it = slots[s];
      const card = UI.el('div', 'iw-card corpse-weapon-card' + (it ? '' : ' empty'));
      card.setAttribute('data-cslot', String(s));
      if (!it) {
        card.innerHTML =
          '<div class="iw-empty-slot"><span>空武器槽 ' + (s + 1) + '</span>' +
          '<em>拖拽武器到此槽</em></div>';
        el.chestWeapons.appendChild(card);
        continue;
      }
      const w = WEAPONS[it.weaponId] || { name: it.name, color: '#9aa4ad' };
      card.style.setProperty('--wc', w.color);
      const chips = (it.chips || []);
      let chipSlots = '';
      for (let i = 0; i < 3; i++) {
        const c = chips[i];
        const def = c ? CHIP_BY_ID[c.chipId] : null;
        chipSlots += '<span class="iw-slot' + (def ? ' on' : '') + '">' +
          (def ? UI.chipTile(c) : '<span class="plus">+</span>') + '</span>';
      }
      card.innerHTML =
        '<div class="iw-body">' +
          '<div class="iw-preview">' +
            (typeof WeaponView !== 'undefined' ? WeaponView.svg(it.weaponId) : '') +
          '</div>' +
          '<div class="iw-main">' +
            '<div class="iw-head">' +
              '<span class="iw-key">' + (s + 1) + '</span>' +
              '<span class="iw-name">' + UI.esc(it.name) + '</span>' +
              '<span class="iw-mods">拖拽 / 点击拿取</span>' +
            '</div>' +
            '<div class="iw-slots">' + chipSlots + '</div>' +
          '</div>' +
        '</div>';
      card.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        onCorpseDown(e, s);
      });
      if (typeof ItemTip !== 'undefined') ItemTip.bind(card, it);
      el.chestWeapons.appendChild(card);
    }
  }

  function takeCorpseWeapon(slot, tx, ty) {
    if (!chest || !chest.corpse) return false;
    const slots = corpseWeaponSlots();
    const it = slots[slot];
    if (!it) return false;
    const p = P();
    if (!placeInBag(it, tx, ty)) {
      HUD.toast(tx !== undefined ? '这里放不下' : '背包已满 · 无法拿走武器', 'warn');
      return false;
    }
    p.inv.push(it);
    slots[slot] = null;
    if (G.noteLoot) G.noteLoot(1);
    HUD.toast('拿取 ' + it.name, 'good');
    refresh();
    return true;
  }

  function equipFromCorpse(slot) {
    if (!chest || !chest.corpse || !G.equipWeaponItem) return false;
    const slots = corpseWeaponSlots();
    const it = slots[slot];
    if (!it) return false;
    const p = P();
    if (!Grid.autoPlace(p.inv, it, cols(), rows())) {
      HUD.toast('背包已满 · 无法装备', 'warn');
      return false;
    }
    p.inv.push(it);
    if (G.equipWeaponItem(it)) {
      slots[slot] = null;
      if (G.noteLoot) G.noteLoot(1);
      HUD.toast('已装备 ' + it.name, 'good');
      refresh();
      pulseWeaponCard(P().slot);
      return true;
    }
    const i = p.inv.indexOf(it);
    if (i >= 0) p.inv.splice(i, 1);
    HUD.toast('无法装备 · 武器类型重复', 'warn');
    refresh();
    return false;
  }

  function corpseSlotAtPoint(e) {
    if (!chest || !chest.corpse || !el.chestWeapons) return null;
    const cards = el.chestWeapons.querySelectorAll('[data-cslot]');
    for (let i = 0; i < cards.length; i++) {
      if (pointIn(cards[i], e)) return parseInt(cards[i].getAttribute('data-cslot'), 10);
    }
    return null;
  }

  function clearCorpseSlotHover() {
    if (!el.chestWeapons) return;
    const cards = el.chestWeapons.querySelectorAll('[data-cslot]');
    for (let i = 0; i < cards.length; i++) {
      cards[i].classList.remove('drop-corpse', 'bad');
    }
  }

  function markCorpseSlotHover(slot, valid) {
    clearCorpseSlotHover();
    if (slot === null || slot === undefined || !el.chestWeapons) return;
    const card = el.chestWeapons.querySelector('[data-cslot="' + slot + '"]');
    if (!card) return;
    card.classList.add('drop-corpse');
    if (!valid) card.classList.add('bad');
  }

  function putWeaponInCorpseSlot(slot, item) {
    if (!chest || !chest.corpse || !item || item.kind !== 'weapon') return false;
    const slots = corpseWeaponSlots();
    if (slot !== 0 && slot !== 1) return false;
    if (slots[slot]) return false;
    const p = P();
    const i = p.inv.indexOf(item);
    if (i < 0) return false;
    p.inv.splice(i, 1);
    if (p.sel === item) p.sel = null;
    slots[slot] = item;
    refresh();
    return true;
  }

  function placeInBag(copy, tx, ty) {
    const p = P();
    if (tx !== undefined && ty !== undefined) {
      if (Grid.fits(p.inv, copy, tx, ty, copy.rot, cols(), rows())) {
        copy.gx = tx;
        copy.gy = ty;
        return true;
      }
      return false;
    }
    return Grid.autoPlace(p.inv, copy, cols(), rows());
  }

  function placeInChest(copy, tx, ty) {
    if (tx !== undefined && ty !== undefined) {
      if (Grid.fits(chest.inv, copy, tx, ty, copy.rot, chestCols(), chestRows())) {
        copy.gx = tx;
        copy.gy = ty;
        return true;
      }
      return false;
    }
    return Grid.autoPlace(chest.inv, copy, chestCols(), chestRows());
  }

  function transferToBag(it, tx, ty) {
    if (!chest || !it || !it.found) return;
    const i = chest.inv.indexOf(it);
    if (i < 0) return;
    const p = P();
    const copy = Grid.cloneItem(it);
    if (!placeInBag(copy, tx, ty)) {
      HUD.toast(tx !== undefined ? '这里放不下' : '背包已满 · 先分解或存入箱子', 'warn');
      return;
    }
    p.inv.push(copy);
    chest.inv.splice(i, 1);
    if (G.noteLoot) G.noteLoot(1);
    refresh();
  }

  function transferToChest(it, tx, ty) {
    if (!chest) return;
    if (chest.corpse && it.kind === 'weapon') {
      HUD.toast('武器请放入尸体武器槽', 'warn');
      return;
    }
    const p = P();
    const i = p.inv.indexOf(it);
    if (i < 0) return;
    const copy = Grid.cloneItem(it);
    if (!placeInChest(copy, tx, ty)) {
      HUD.toast(tx !== undefined ? '这里放不下' : '物资箱已满', 'warn');
      refresh();
      return;
    }
    /* 自己放进去的东西直接可见，不参与搜索队列 */
    copy.found = true;
    copy.foundAt = nowSec();
    chest.inv.push(copy);
    p.inv.splice(i, 1);
    if (p.sel === it) p.sel = null;
    refresh();
  }

  function takeAll() {
    if (!chest) return;
    const s = chest.search;
    const onlyFound = !!(s && s.active);
    const corpseWs = chest.corpse ? corpseWeaponSlots() : null;
    if (!chest.inv.length && !(corpseWs && (corpseWs[0] || corpseWs[1]))) {
      HUD.toast(chest.corpse ? '尸体已被搜空' : '物资箱是空的', 'warn');
      return;
    }
    const p = P();
    let n = 0, full = false, left = 0;
    if (corpseWs) {
      for (let s2 = 0; s2 < 2; s2++) {
        if (!corpseWs[s2]) continue;
        if (Grid.autoPlace(p.inv, corpseWs[s2], cols(), rows())) {
          p.inv.push(corpseWs[s2]);
          corpseWs[s2] = null;
          n++;
        } else {
          full = true;
        }
      }
    }
    for (const it of chest.inv.slice()) {
      if (onlyFound && !it.found) { left++; continue; }
      const copy = Grid.cloneItem(it);
      if (!Grid.autoPlace(p.inv, copy, cols(), rows())) { full = true; break; }
      p.inv.push(copy);
      chest.inv.splice(chest.inv.indexOf(it), 1);
      n++;
    }
    if (n && G.noteLoot) G.noteLoot(n);
    refresh();
    if (n) {
      HUD.toast('拿走 ' + n + ' 件' + (full ? ' · 背包已满' : '') +
        (left && !full ? ' · 其余仍在搜索' : ''), 'good');
    } else if (onlyFound && !full) {
      HUD.toast('还没有搜到可拿取的物资', 'warn');
    } else {
      HUD.toast('背包已满', 'warn');
    }
  }

  function storeAll() {
    if (!chest) return;
    const p = P();
    if (!p.inv.length) {
      HUD.toast('背包是空的', 'warn');
      return;
    }
    let n = 0, full = false, skipped = 0;
    if (chest.corpse) {
      const slots = corpseWeaponSlots();
      for (const it of p.inv.slice()) {
        if (it.kind !== 'weapon') continue;
        let slot = -1;
        if (!slots[0]) slot = 0;
        else if (!slots[1]) slot = 1;
        if (slot < 0) { skipped++; continue; }
        const copy = Grid.cloneItem(it);
        copy.found = true;
        copy.foundAt = nowSec();
        slots[slot] = copy;
        p.inv.splice(p.inv.indexOf(it), 1);
        n++;
      }
    }
    for (const it of p.inv.slice()) {
      if (chest.corpse && it.kind === 'weapon') continue;
      const copy = Grid.cloneItem(it);
      if (!Grid.autoPlace(chest.inv, copy, chestCols(), chestRows())) { full = true; break; }
      copy.found = true;
      copy.foundAt = nowSec();
      chest.inv.push(copy);
      p.inv.splice(p.inv.indexOf(it), 1);
      n++;
    }
    if (p.sel && p.inv.indexOf(p.sel) < 0) p.sel = null;
    refresh();
    if (n) {
      HUD.toast('存入 ' + n + ' 件' +
        (full ? ' · 背包已满' : '') +
        (skipped ? ' · 尸体武器槽已满' : ''), 'good');
    } else if (skipped) {
      HUD.toast('尸体武器槽已满', 'warn');
    } else {
      HUD.toast(chest.corpse ? '尸体背包已满' : '物资箱已满', 'warn');
    }
  }

  function tierName(id) {
    const t = TIERS.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '常见';
  }

  /* ---------------- 武器 / 芯片槽 ---------------- */
  function modsText(wi) {
    const m = G.weaponMods(wi);
    const parts = [];
    if (m.dmg) parts.push('伤+' + Math.round(m.dmg * 100) + '%');
    if (m.rate) parts.push('速+' + Math.round(m.rate * 100) + '%');
    if (m.reload) parts.push('装+' + Math.round(m.reload * 100) + '%');
    if (m.recoil) parts.push('稳-' + Math.round(m.recoil * 100) + '%');
    if (m.coneRange) parts.push('声域+' + Math.round(m.coneRange * 100) + '%');
    if (m.bounce) parts.push('反射+' + m.bounce);
    if (m.zoneR) parts.push('燃域+' + Math.round(m.zoneR * 100) + '%');
    if (m.pierce) parts.push('穿透+' + m.pierce);
    if (m.chain) parts.push('链+' + m.chain);
    return parts.join(' ') || '无芯片';
  }

  function renderWeaponBar() {
    if (!el.weapons) return;
    const p = P();
    el.weapons.innerHTML = '';
    const maxSlots = Math.max(2, p.carried.length);
    for (let s = 0; s < maxSlots; s++) {
      const item = p.carried[s];
      if (!item) {
        const empty = UI.el('div', 'iw-card empty');
        empty.innerHTML =
          '<div class="iw-empty-slot">' +
            '<span>空武器槽</span>' +
            '<em>点击装备背包中的武器</em>' +
          '</div>';
        empty.addEventListener('click', quickEquipWeapon);
        el.weapons.appendChild(empty);
        continue;
      }
      const wi = item.weaponId;
      const w = WEAPONS[wi];
      const list = (p.weaponChips && p.weaponChips[wi]) || [];
      const card = UI.el('div', 'iw-card');
      card.style.setProperty('--wc', w.color);
      let slots = '';
      for (let i = 0; i < 3; i++) {
        const c = list[i];
        const def = c ? CHIP_BY_ID[c.chipId] : null;
        slots += '<button type="button" class="iw-slot' + (def ? ' on' : '') + '"' +
          ' data-wi="' + wi + '" data-slot="' + i + '"' +
          '>' + (def ? UI.chipTile(c) : '<span class="plus">+</span>') +
          '</button>';
      }
      card.innerHTML =
        '<div class="iw-body">' +
          '<div class="iw-preview">' +
            (typeof WeaponView !== 'undefined' ? WeaponView.svg(wi) : '') +
          '</div>' +
          '<div class="iw-main">' +
            '<div class="iw-head">' +
              '<span class="iw-key">' + (s + 1) + '</span>' +
              '<span class="iw-name">' + w.name + '</span>' +
              '<span class="iw-mods">' + modsText(wi) + '</span>' +
            '</div>' +
            '<div class="iw-slots">' + slots + '</div>' +
          '</div>' +
        '</div>';
      el.weapons.appendChild(card);
      if (s === p.slot) card.classList.add('on');
      if (typeof ItemTip !== 'undefined') {
        const tipItem = Grid.cloneItem(item);
        tipItem.chips = (p.weaponChips[wi] || []).slice();
        ItemTip.bind(card, tipItem);
      }

      card.addEventListener('pointerdown', function (e) {
        if (e.target.closest('button')) return;
        if (typeof WeaponDrag === 'undefined') return;
        WeaponDrag.start(e, {
          weaponId: wi,
          name: w.name,
          color: w.color,
          onDrop: function (x, y) {
            if (!pointIn(el.grid, { clientX: x, clientY: y })) return;
            if (G.unequipWeaponSlot(s)) {
              HUD.toast('武器已放回背包', 'good');
              refresh();
            } else {
              HUD.toast('背包已满 · 无法卸下武器', 'warn');
            }
          }
        });
      });

      const btns = card.querySelectorAll('.iw-slot');
      for (let b = 0; b < btns.length; b++) {
        (function (btn, slot) {
          const filled = !!list[slot];
          if (filled && typeof ItemTip !== 'undefined' && list[slot]) {
            ItemTip.bind(btn, ITEMS.makeChipItem(list[slot]));
          }
          btn.addEventListener('pointerdown', function (e) {
            if (filled) onSocketDown(e, wi, slot);
          });
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!filled) quickInstall(wi);
          });
        })(btns[b], b);
      }
    }
  }

  function quickEquipWeapon() {
    const p = P();
    const selected = (p.sel && p.sel.kind === 'weapon' && p.inv.indexOf(p.sel) >= 0) ? p.sel : null;
    let item = selected;
    if (!item) {
      for (let i = 0; i < p.inv.length; i++) {
        if (p.inv[i].kind === 'weapon') { item = p.inv[i]; break; }
      }
    }
    if (!item) { HUD.toast('背包里没有可装备的武器', 'warn'); return; }
    if (G.equipWeaponItem(item)) {
      HUD.toast('已装备 ' + item.name, 'good');
      refresh();
      pulseWeaponCard(P().slot);
    } else {
      HUD.toast('无法装备 · 背包空间不足或武器类型重复', 'warn');
    }
  }

  function socketAtPoint(e) {
    if (!el.weapons || !e) return null;
    const nodes = el.weapons.querySelectorAll('.iw-slot');
    for (let i = 0; i < nodes.length; i++) {
      if (pointIn(nodes[i], e)) return nodes[i];
    }
    return null;
  }

  /* 芯片拖到整张武器卡都算有效：自动落入第一个空槽 */
  function chipSlotForCard(card, chip) {
    if (!card) return null;
    const slots = card.querySelectorAll('.iw-slot');
    if (!slots.length) return null;
    const wi = parseInt(slots[0].getAttribute('data-wi'), 10);
    if (!(wi >= 0) || !G.chipFits(wi, chip)) return null;
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].classList.contains('on')) return slots[i];
    }
    return null;
  }

  function chipTargetAtPoint(e, chip) {
    const card = weaponCardAtPoint(e);
    const slot = chipSlotForCard(card, chip);
    if (slot) return slot;
    return socketAtPoint(e);
  }

  function markChipCardHover(card) {
    if (!el.weapons) return;
    const all = el.weapons.querySelectorAll('.iw-card.chip-drop');
    for (let i = 0; i < all.length; i++) all[i].classList.remove('chip-drop');
    if (card) card.classList.add('chip-drop');
  }

  function markSocketHover(node) {
    if (!el.weapons) return;
    const all = el.weapons.querySelectorAll('.iw-slot.hover');
    for (let i = 0; i < all.length; i++) all[i].classList.remove('hover');
    if (node) node.classList.add('hover');
  }

  function weaponCardAtPoint(e) {
    if (!el.weapons || !e) return null;
    const cards = el.weapons.querySelectorAll('.iw-card');
    for (let i = 0; i < cards.length; i++) {
      if (pointIn(cards[i], e)) return cards[i];
    }
    return null;
  }

  function markWeaponCardHover(node) {
    if (!el.weapons) return;
    const all = el.weapons.querySelectorAll('.iw-card.drop-weapon');
    for (let i = 0; i < all.length; i++) all[i].classList.remove('drop-weapon');
    if (node) node.classList.add('drop-weapon');
  }

  /* 装备成功后给目标武器卡一个短促的脉冲动效 */
  function pulseWeaponCard(slot) {
    if (!el.weapons) return;
    const cards = el.weapons.querySelectorAll('.iw-card');
    const card = cards[slot];
    if (!card) return;
    card.classList.add('just-equipped');
    setTimeout(function () {
      if (card) card.classList.remove('just-equipped');
    }, 360);
  }

  function firstChipInContainers(wi) {
    const p = P();
    function fits(it) { return it.kind === 'chip' && G.chipFits(wi, it); }
    for (let i = 0; i < p.inv.length; i++) {
      if (fits(p.inv[i])) return { it: p.inv[i], from: 'bag' };
    }
    if (chest && !(chest.search && chest.search.active)) {
      for (let i = 0; i < chest.inv.length; i++) {
        if (chest.inv[i].found && fits(chest.inv[i])) return { it: chest.inv[i], from: 'chest' };
      }
    }
    return null;
  }

  function chipMismatchMsg(it) {
    const tag = ITEMS.chipRestriction(it);
    return tag ? ('该芯片只能装在「' + tag + '」武器上') : '该芯片无法装在当前武器上';
  }

  function installFoundChip(found, wi) {
    if (!found) return false;
    if (!G.chipFits(wi, found.it)) { HUD.toast(chipMismatchMsg(found.it), 'warn'); return false; }
    if (!G.installChip(wi, found.it)) { HUD.toast('芯片槽已满（最多 3 个）', 'warn'); return false; }
    if (found.from === 'chest') {
      const i = chest.inv.indexOf(found.it);
      if (i >= 0) chest.inv.splice(i, 1);
      refresh();
    } else {
      removeItem(found.it);
    }
    HUD.toast('芯片已装入 ' + WEAPONS[wi].name, 'good');
    return true;
  }

  function quickInstall(wi) {
    if (!isOpen()) return false;
    const p = P();
    const found = (p.sel && p.sel.kind === 'chip' && p.inv.indexOf(p.sel) >= 0)
      ? { it: p.sel, from: 'bag' } : firstChipInContainers(wi);
    if (!found) { HUD.toast('背包和物资箱里没有芯片', 'warn'); return false; }
    return installFoundChip(found, wi);
  }

  function quickInstallAny() {
    const p = P();
    const selected = (p.sel && p.sel.kind === 'chip' && p.inv.indexOf(p.sel) >= 0)
      ? { it: p.sel, from: 'bag' } : null;
    if (selected) {
      let fitsSome = false;
      for (let s = 0; s < p.carried.length; s++) {
        const wi = p.carried[s].weaponId;
        if (!G.chipFits(wi, selected.it)) continue;
        fitsSome = true;
        if (((p.weaponChips[wi] || []).length) < 3) return installFoundChip(selected, wi);
      }
      HUD.toast(fitsSome ? '所有武器芯片槽已满' : chipMismatchMsg(selected.it), 'warn');
      return false;
    }
    for (let s = 0; s < p.carried.length; s++) {
      const wi = p.carried[s].weaponId;
      if (((p.weaponChips[wi] || []).length) >= 3) continue;
      const found = firstChipInContainers(wi);
      if (found) return installFoundChip(found, wi);
    }
    HUD.toast('背包和物资箱里没有可安装的芯片', 'warn');
    return false;
  }

  function chipDropTargets(item, target, tx, ty) {
    const p = P();
    const chestOK = !!(chest && !(chest.search && chest.search.active));
    function toBag() {
      if (placeInBag(item, tx, ty)) { p.inv.push(item); return true; }
      if (tx !== undefined && placeInBag(item)) { p.inv.push(item); return true; }
      return false;
    }
    function toChest() {
      if (!chestOK) return false;
      if (placeInChest(item, tx, ty) || (tx !== undefined && placeInChest(item))) {
        item.found = true;
        item.foundAt = nowSec();
        chest.inv.push(item);
        return true;
      }
      return false;
    }
    if (target === 'chest') return toChest() || toBag();
    return toBag() || toChest();
  }

  function takeOffChip(wi, slot, target, tx, ty) {
    const item = G.uninstallChip(wi, slot);
    if (!item) return false;
    if (!chipDropTargets(item, target, tx, ty)) {
      G.installChip(wi, item);
      HUD.toast('背包和物资箱都满了 · 无法卸下芯片', 'warn');
      refresh();
      return false;
    }
    HUD.toast('芯片已卸下', 'good');
    refresh();
    return true;
  }

  function onSocketDown(e, wi, slot) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = P();
    const list = (p.weaponChips && p.weaponChips[wi]) || [];
    if (!list[slot]) return;
    e.preventDefault();
    socketDrag = {
      wi: wi, slot: slot, pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY, moved: false
    };
    const chip = ITEMS.makeChipItem(list[slot]);
    const g = ensureGhost(chip);
    g.style.width = CELL + 'px';
    g.style.height = CELL + 'px';
    g.style.left = (e.clientX - CELL * 0.5) + 'px';
    g.style.top = (e.clientY - CELL * 0.5) + 'px';
  }

  function onSocketMove(e) {
    if (!socketDrag || e.pointerId !== socketDrag.pointerId) return;
    e.preventDefault();
    if (Math.abs(e.clientX - socketDrag.sx) + Math.abs(e.clientY - socketDrag.sy) > 3) {
      socketDrag.moved = true;
    }
    if (ghost) {
      ghost.style.visibility = 'visible';
      ghost.style.left = (e.clientX - CELL * 0.5) + 'px';
      ghost.style.top = (e.clientY - CELL * 0.5) + 'px';
    }
    if (!socketDrag.moved) return;
    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left - CELL * 0.5) / PITCH);
      const ty = Math.round((e.clientY - r.top - CELL * 0.5) / PITCH);
      showDrop(tx, ty, { w: 1, h: 1 }, true);
      if (el.chestGrid) { el.chestGrid.classList.remove('drop-over'); el.chestGrid.classList.remove('bad'); }
    } else if (chest && pointIn(el.chestGrid, e)) {
      hideDrop();
      el.chestGrid.classList.add('drop-over');
      el.chestGrid.classList.remove('bad');
    } else {
      hideDrop();
      if (el.chestGrid) el.chestGrid.classList.remove('drop-over');
    }
  }

  function onSocketUp(e) {
    if (!socketDrag) return;
    const d = socketDrag;
    socketDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    markSocketHover(null);
    if (!e || e.type === 'pointercancel') { refresh(); return; }
    if (!d.moved) { takeOffChip(d.wi, d.slot); return; }
    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left - CELL * 0.5) / PITCH);
      const ty = Math.round((e.clientY - r.top - CELL * 0.5) / PITCH);
      takeOffChip(d.wi, d.slot, 'bag', tx, ty);
      return;
    }
    if (chest && pointIn(el.chestGrid, e)) {
      const r = el.chestGrid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left - CELL * 0.5) / PITCH);
      const ty = Math.round((e.clientY - r.top - CELL * 0.5) / PITCH);
      takeOffChip(d.wi, d.slot, 'chest', tx, ty);
      return;
    }
    refresh();
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
    if (it.kind === 'chip') {
      const def = CHIP_BY_ID[it.chipId] || { name: '芯片', desc: '通用芯片', color: '#9aa4ad' };
      const typeLabel = def.forTag ? def.forTag + '专属芯片' : '通用芯片';
      el.detail.innerHTML =
        '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
        '<div class="dt-line"><span>芯片效果</span><b style="color:' + def.color + '">' + def.desc + '</b></div>' +
        '<div class="dt-line"><span>数据价值</span><b>' + it.value + ' NB</b></div>' +
        '<div class="dt-line"><span>品质 / 类型</span><b>' + tierName(it.tierId) + ' · ' + typeLabel + '</b></div>' +
        (def.forTag ? '<div class="dt-line"><span>安装限制</span><b style="color:' + def.color + '">仅限 ' + def.forTag + ' 武器</b></div>' : '') +
        '<div class="dt-line"><span>占格 / 分解</span><b>' + d.w + '×' + d.h + ' · ' + it.time.toFixed(1) + 's</b></div>' +
        '<div class="dt-hint">拖到上方武器芯片槽 · 或点击空槽快速安装</div>' +
        '<div class="dt-touch">' +
          '<button type="button" class="dt-btn" data-inv-act="chip">快速安装</button>' +
          '<button type="button" class="dt-btn danger" data-inv-act="dismantle">分解</button>' +
        '</div>';
      return;
    }
    if (it.kind === 'weapon') {
      const w = WEAPONS[it.weaponId] || { name: it.name, tag: '武器', color: '#9aa4ad' };
      el.detail.innerHTML =
        '<div class="dt-weapon-art">' +
          (typeof WeaponView !== 'undefined' ? WeaponView.svg(it.weaponId) : '') +
        '</div>' +
        '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
        '<div class="dt-line"><span>类型</span><b style="color:' + w.color + '">' + w.tag + ' · 武器</b></div>' +
        '<div class="dt-line"><span>弹夹 / 射速</span><b>' + (w.mag || 0) + ' 发 · ' + (w.rate || 0).toFixed(2) + 's</b></div>' +
        '<div class="dt-line"><span>数据价值</span><b>' + it.value + ' NB</b></div>' +
        '<div class="dt-line"><span>占格</span><b>' + d.w + '×' + d.h + '</b></div>' +
        '<div class="dt-hint">点击下方按钮装备到武器槽；两槽已满时替换当前手持武器</div>' +
        '<div class="dt-actions">' +
          '<button type="button" class="dt-btn" data-inv-act="equip">装备武器</button>' +
          '<button type="button" class="dt-btn danger" data-inv-act="dismantle">分解</button>' +
        '</div>';
      return;
    }
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
      const wi = p.carried[s].weaponId;
      const w = WEAPONS[wi];
      const spare = p.spares[s] || 0;
      const chipN = (p.weaponChips && p.weaponChips[wi] ? p.weaponChips[wi].length : 0);
      const row = UI.el('div', 'craft-row');
      row.style.setProperty('--wc', w.color);
      const full = spare >= w.maxSpare;
      const poor = p.data < w.cost;
      row.className += full || poor ? ' dis' : '';
      row.innerHTML =
        '<span class="cw">' + (s + 1) + '</span>' +
        '<span class="cn">' + w.name + '</span>' +
        '<span class="cx">芯 ' + chipN + '/3</span>' +
        '<span class="cs">' + spare + '/' + w.maxSpare + ' 夹</span>' +
        '<span class="cc">' + w.cost + ' NB</span>';
      row.addEventListener('click', function () { tryCraft(s, wi); });
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
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    const p = P();
    renderGrid();
    renderWeaponBar();
    renderDetail();
    renderCraft();
    renderKit();
    if (chest) renderChest();
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
      tx: it.gx, ty: it.gy, valid: true, corpseSlot: null
    };
    p.sel = it;
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    refresh();
    updateGhost(e);
  }

  function onMove(e) {
    if (socketDrag) { onSocketMove(e); return; }
    if (chestDrag) { onChestMove(e); return; }
    if (corpseDrag) { onCorpseMove(e); return; }
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    updateGhost(e);
  }

  function pointIn(node, e) {
    if (!node || !e) return false;
    const r = node.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right &&
      e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onChestDown(e, it) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!it.found) return;
    e.preventDefault();
    const rect = el.chestGrid.getBoundingClientRect();
    const d = Grid.dims(it);
    const itemX = rect.left + it.gx * PITCH;
    const itemY = rect.top + it.gy * PITCH;
    chestDrag = {
      it: it, pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY, moved: false,
      fx: clamp((e.clientX - itemX) / PITCH, 0, d.w - 0.01),
      fy: clamp((e.clientY - itemY) / PITCH, 0, d.h - 0.01)
    };
    const g = ensureGhost(it);
    g.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    g.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    g.style.left = (e.clientX - chestDrag.fx * PITCH) + 'px';
    g.style.top = (e.clientY - chestDrag.fy * PITCH) + 'px';
  }

  function onChestMove(e) {
    if (!chestDrag || e.pointerId !== chestDrag.pointerId) return;
    e.preventDefault();
    if (Math.abs(e.clientX - chestDrag.sx) + Math.abs(e.clientY - chestDrag.sy) > 3) {
      chestDrag.moved = true;
    }
    if (ghost) {
      ghost.style.left = (e.clientX - chestDrag.fx * PITCH) + 'px';
      ghost.style.top = (e.clientY - chestDrag.fy * PITCH) + 'px';
    }
    const chipCard = chestDrag.it.kind === 'chip' ? weaponCardAtPoint(e) : null;
    chestDrag.chipCard = chipCard;
    const sock = chestDrag.it.kind === 'chip' ? chipTargetAtPoint(e, chestDrag.it) : null;
    chestDrag.socket = sock;
    markSocketHover(sock);
    markChipCardHover(chipCard);
    if (ghost) ghost.style.visibility = 'visible';
    if (sock) { hideDrop(); hideChestDrop(); return; }
    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - chestDrag.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - chestDrag.fy);
      const valid = Grid.fits(P().inv, chestDrag.it, tx, ty, chestDrag.it.rot, cols(), rows());
      showDrop(tx, ty, chestDrag.it, valid);
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
    } else if (pointIn(el.chestGrid, e)) {
      hideDrop();
      const r = el.chestGrid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - chestDrag.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - chestDrag.fy);
      const valid = Grid.fits(chest.inv, chestDrag.it, tx, ty, chestDrag.it.rot, chestCols(), chestRows(), chestDrag.it);
      showChestDrop(tx, ty, chestDrag.it, valid);
    } else {
      hideDrop();
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
    }
  }

  function onChestUp(e) {
    if (!chestDrag) return;
    const d = chestDrag;
    chestDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    markSocketHover(null);
    markChipCardHover(null);
    if (!e || e.type === 'pointercancel') { refresh(); return; }
    if (!d.moved) { transferToBag(d.it); return; }
    if (d.socket && d.it.kind === 'chip') {
      const wi = parseInt(d.socket.getAttribute('data-wi'), 10);
      if (!G.chipFits(wi, d.it)) {
        HUD.toast(chipMismatchMsg(d.it), 'warn');
        refresh();
      } else if (G.installChip(wi, d.it)) {
        const i = chest.inv.indexOf(d.it);
        if (i >= 0) chest.inv.splice(i, 1);
        HUD.toast('芯片已装入 ' + WEAPONS[wi].name, 'good');
        refresh();
      } else {
        HUD.toast('芯片槽已满（最多 3 个）', 'warn');
        refresh();
      }
      return;
    }
    if (d.it.kind === 'chip' && d.chipCard) {
      const slots = d.chipCard.querySelectorAll('.iw-slot');
      const wi = slots.length ? parseInt(slots[0].getAttribute('data-wi'), 10) : -1;
      if (wi >= 0 && !G.chipFits(wi, d.it)) {
        HUD.toast(chipMismatchMsg(d.it), 'warn');
      } else {
        HUD.toast('芯片槽已满（最多 3 个）', 'warn');
      }
      refresh();
      return;
    }
    if (el.weapons && pointIn(el.weapons, e)) { refresh(); return; }
    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - d.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - d.fy);
      transferToBag(d.it, tx, ty);
      return;
    }
    if (pointIn(el.chestGrid, e)) {
      const rect = el.chestGrid.getBoundingClientRect();
      const tx = Math.round((e.clientX - rect.left) / PITCH - d.fx);
      const ty = Math.round((e.clientY - rect.top) / PITCH - d.fy);
      if (Grid.fits(chest.inv, d.it, tx, ty, d.it.rot, chestCols(), chestRows(), d.it)) {
        d.it.gx = tx;
        d.it.gy = ty;
      }
      refresh();
      return;
    }
    refresh();
  }

  function onCorpseDown(e, slot) {
    if (!chest || !chest.corpse) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const slots = corpseWeaponSlots();
    const it = slots[slot];
    if (!it) return;
    e.preventDefault();
    const d = Grid.dims(it);
    corpseDrag = {
      slot: slot, it: it, pointerId: e.pointerId,
      sx: e.clientX, sy: e.clientY, moved: false,
      fx: d.w / 2, fy: d.h / 2
    };
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    hideDrop();
    hideChestDrop();
    clearCorpseSlotHover();
    markWeaponCardHover(null);
    markSocketHover(null);
    const g = ensureGhost(it);
    g.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    g.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    g.style.left = (e.clientX - (d.w * CELL + (d.w - 1) * GAP) / 2) + 'px';
    g.style.top = (e.clientY - (d.h * CELL + (d.h - 1) * GAP) / 2) + 'px';
    g.style.visibility = 'visible';
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
  }

  function onCorpseMove(e) {
    if (!corpseDrag || e.pointerId !== corpseDrag.pointerId) return;
    e.preventDefault();
    if (!corpseDrag.moved &&
        Math.abs(e.clientX - corpseDrag.sx) + Math.abs(e.clientY - corpseDrag.sy) > 3) {
      corpseDrag.moved = true;
    }
    const it = corpseDrag.it;
    const d = Grid.dims(it);
    const g = ensureGhost(it);
    g.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    g.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    g.style.left = (e.clientX - (d.w * CELL + (d.w - 1) * GAP) / 2) + 'px';
    g.style.top = (e.clientY - (d.h * CELL + (d.h - 1) * GAP) / 2) + 'px';

    const slot = corpseSlotAtPoint(e);
    if (slot !== null) {
      markCorpseSlotHover(slot, slot !== corpseDrag.slot);
      markWeaponCardHover(null);
      hideDrop();
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
      g.style.visibility = 'visible';
      return;
    }
    clearCorpseSlotHover();

    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - corpseDrag.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - corpseDrag.fy);
      const valid = Grid.fits(P().inv, it, tx, ty, it.rot, cols(), rows());
      markWeaponCardHover(null);
      showDrop(tx, ty, it, valid);
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
      g.style.visibility = 'visible';
      return;
    }
    hideDrop();

    const overWeapons = !!(el.weapons && pointIn(el.weapons, e));
    if (overWeapons) {
      markWeaponCardHover(weaponCardAtPoint(e));
      hideChestDrop();
      g.style.visibility = 'visible';
      return;
    }
    markWeaponCardHover(null);

    const overChest = !!(chest && pointIn(el.chestGrid, e));
    if (el.chestGrid) {
      el.chestGrid.classList.remove('drop-over');
      el.chestGrid.classList.toggle('bad', overChest);
    }
    hideChestDrop();
    g.style.visibility = 'visible';
  }

  function onCorpseUp(e) {
    if (!corpseDrag) return;
    const d = corpseDrag;
    corpseDrag = null;
    removeGhost();
    hideDrop();
    hideChestDrop();
    clearCorpseSlotHover();
    markWeaponCardHover(null);
    markSocketHover(null);
    if (el.chestGrid) {
      el.chestGrid.classList.remove('drop-over');
      el.chestGrid.classList.remove('bad');
    }
    if (!e || e.type === 'pointercancel') { refresh(); return; }
    if (!d.moved) { takeCorpseWeapon(d.slot); return; }

    const slot = corpseSlotAtPoint(e);
    if (slot !== null) {
      if (slot === d.slot) { refresh(); return; }
      const slots = corpseWeaponSlots();
      const tmp = slots[slot];
      slots[slot] = d.it;
      slots[d.slot] = tmp;
      HUD.toast(tmp ? '交换尸体武器槽' : '已放入尸体武器槽', 'good');
      refresh();
      return;
    }

    if (el.weapons && pointIn(el.weapons, e)) {
      equipFromCorpse(d.slot);
      return;
    }

    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - d.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - d.fy);
      takeCorpseWeapon(d.slot, tx, ty);
      return;
    }

    if (chest && pointIn(el.chestGrid, e)) {
      HUD.toast('武器请放入尸体武器槽', 'warn');
    }
    refresh();
  }

  function onUp(e) {
    if (e && typeof ItemTip !== 'undefined' && ItemTip.consume(e.pointerId)) {
      drag = null;
      chestDrag = null;
      corpseDrag = null;
      socketDrag = null;
      removeGhost();
      hideDrop();
      clearChestHighlight();
      clearCorpseSlotHover();
      markSocketHover(null);
      markWeaponCardHover(null);
      markChipCardHover(null);
      refresh();
      return;
    }
    if (socketDrag) { onSocketUp(e); return; }
    if (chestDrag) { onChestUp(e); return; }
    if (corpseDrag) { onCorpseUp(e); return; }
    if (!drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    clearCorpseSlotHover();
    markSocketHover(null);
    markWeaponCardHover(null);
    markChipCardHover(null);
    const canceled = e && e.type === 'pointercancel';
    if (d.moved && d.corpseSlot !== null && d.corpseSlot !== undefined &&
        d.it.kind === 'weapon' && !canceled) {
      const slots = corpseWeaponSlots();
      if (slots[d.corpseSlot]) {
        HUD.toast('该尸体武器槽已占用', 'warn');
        refresh();
      } else if (putWeaponInCorpseSlot(d.corpseSlot, d.it)) {
        HUD.toast('已放入尸体武器槽', 'good');
      } else {
        refresh();
      }
      return;
    }
    if (d.moved && d.socket && d.it.kind === 'chip' && !canceled) {
      const wi = parseInt(d.socket.getAttribute('data-wi'), 10);
      if (!G.chipFits(wi, d.it)) {
        HUD.toast(chipMismatchMsg(d.it), 'warn');
        refresh();
      } else if (G.installChip(wi, d.it)) {
        removeItem(d.it);
        HUD.toast('芯片已装入 ' + WEAPONS[wi].name, 'good');
      } else {
        HUD.toast('芯片槽已满（最多 3 个）', 'warn');
        refresh();
      }
      return;
    }
    if (d.moved && d.it.kind === 'chip' && d.chipCard && !canceled) {
      const slots = d.chipCard.querySelectorAll('.iw-slot');
      const wi = slots.length ? parseInt(slots[0].getAttribute('data-wi'), 10) : -1;
      if (wi >= 0 && !G.chipFits(wi, d.it)) {
        HUD.toast(chipMismatchMsg(d.it), 'warn');
      } else {
        HUD.toast('芯片槽已满（最多 3 个）', 'warn');
      }
      refresh();
      return;
    }
    if (d.moved && d.weaponCard && d.it.kind === 'weapon' && !canceled) {
      if (G.equipWeaponItem(d.it)) {
        HUD.toast('已装备 ' + d.it.name, 'good');
        refresh();
        pulseWeaponCard(P().slot);
      } else {
        HUD.toast('无法装备 · 背包空间不足或武器类型重复', 'warn');
        refresh();
      }
      return;
    }
    if (e && el.weapons && pointIn(el.weapons, e)) { refresh(); return; }
    if (chest && !canceled) {
      if (!d.moved) {
        /* 点击背包物品：自动放入箱子 */
        transferToChest(d.it);
        return;
      }
      if (pointIn(el.chestGrid, e)) {
        /* 拖到箱子：按落点放置 */
        const r = el.chestGrid.getBoundingClientRect();
        const tx = Math.round((e.clientX - r.left) / PITCH - d.fx);
        const ty = Math.round((e.clientY - r.top) / PITCH - d.fy);
        transferToChest(d.it, tx, ty);
        return;
      }
    }
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
    refresh();
  }

  function showDrop(tx, ty, it, valid) {
    if (!el.drop) return;
    const d = Grid.dims(it);
    el.drop.style.display = 'block';
    el.drop.style.left = (tx * PITCH) + 'px';
    el.drop.style.top = (ty * PITCH) + 'px';
    el.drop.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    el.drop.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    el.drop.className = 'inv-drop ' + (valid ? 'ok' : 'bad');
  }

  function hideDrop() {
    if (el.drop) el.drop.style.display = 'none';
  }

  function showChestDrop(tx, ty, it, valid) {
    if (!el.chestDrop) return;
    const d = Grid.dims(it);
    el.chestDrop.style.display = 'block';
    el.chestDrop.style.left = (tx * PITCH) + 'px';
    el.chestDrop.style.top = (ty * PITCH) + 'px';
    el.chestDrop.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    el.chestDrop.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    el.chestDrop.className = 'inv-drop chest-drop ' + (valid ? 'ok' : 'bad');
  }

  function hideChestDrop() {
    if (el.chestDrop) el.chestDrop.style.display = 'none';
  }

  function clearChestHighlight() {
    if (el.chestGrid) {
      el.chestGrid.classList.remove('drop-over');
      el.chestGrid.classList.remove('bad');
    }
    hideChestDrop();
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

    const cslot = (chest && chest.corpse && it.kind === 'weapon') ? corpseSlotAtPoint(e) : null;
    drag.corpseSlot = cslot;
    if (cslot !== null) {
      const slots = corpseWeaponSlots();
      markCorpseSlotHover(cslot, !slots[cslot]);
      markSocketHover(null);
      markWeaponCardHover(null);
      hideDrop();
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
      const g0 = ensureGhost(it);
      g0.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      g0.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      g0.style.left = (e.clientX - drag.fx * PITCH) + 'px';
      g0.style.top = (e.clientY - drag.fy * PITCH) + 'px';
      g0.style.visibility = 'visible';
      return;
    }
    clearCorpseSlotHover();

    const overChest = !!(chest && pointIn(el.chestGrid, e));
    const chipCard = it.kind === 'chip' ? weaponCardAtPoint(e) : null;
    const sock = it.kind === 'chip' ? chipTargetAtPoint(e, it) : null;
    const wcard = it.kind === 'weapon' ? weaponCardAtPoint(e) : null;
    drag.socket = sock;
    drag.weaponCard = wcard;
    drag.chipCard = chipCard;
    markSocketHover(sock);
    markWeaponCardHover(wcard);
    markChipCardHover(chipCard);
    if (sock || wcard || chipCard) {
      hideDrop();
      hideChestDrop();
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
    }
    if (el.chestGrid) {
      el.chestGrid.classList.toggle('drop-over', overChest);
      if (overChest) {
        const cr = el.chestGrid.getBoundingClientRect();
        const ctx = Math.round((e.clientX - cr.left) / PITCH - drag.fx);
        const cty = Math.round((e.clientY - cr.top) / PITCH - drag.fy);
        const cvalid = Grid.fits(chest.inv, it, ctx, cty, it.rot, chestCols(), chestRows()) &&
          !(chest.corpse && it.kind === 'weapon');
        el.chestGrid.classList.toggle('bad', !cvalid);
        showChestDrop(ctx, cty, it, cvalid);
      } else {
        el.chestGrid.classList.remove('bad');
        hideChestDrop();
      }
    }
    const overGrid = pointIn(el.grid, e);
    if (drag.moved && overGrid && !overChest && !sock && !wcard && !chipCard) showDrop(tx, ty, it, valid);
    else hideDrop();

    const g = ensureGhost(it);
    g.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
    g.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
    g.style.left = (e.clientX - drag.fx * PITCH) + 'px';
    g.style.top = (e.clientY - drag.fy * PITCH) + 'px';
    g.style.visibility = 'visible';
  }

  function ensureGhost(it) {
    if (!ghost) {
      ghost = UI.el('div', 'inv-item inv-ghost');
      ghost.innerHTML = '<span class="gem"></span><span class="nm"></span><span class="val"></span><span class="sz"></span>';
      document.body.appendChild(ghost);
    }
    const d = Grid.dims(it);
    if (it.kind === 'chip') ghost.classList.add('chip-item');
    else ghost.classList.remove('chip-item');
    ghost.style.setProperty('--qc', ITEMS.colorOf(it));
    if (it.kind === 'chip' && CHIP_BY_ID[it.chipId]) {
      ghost.style.setProperty('--cc', CHIP_BY_ID[it.chipId].color);
    }
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
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    drag = null;
    chestDrag = null;
    corpseDrag = null;
    socketDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    clearCorpseSlotHover();
    markSocketHover(null);
    markWeaponCardHover(null);
    cancelAction();
    if (chest) {
      chest.search = null;
      chest = null;
    }
    hideChestLens();
    el.root.classList.remove('chest-open');
    if (el.chestPanel) el.chestPanel.classList.add('hidden');
    if (el.corpseWeaponWrap) el.corpseWeaponWrap.classList.add('hidden');
    if (el.chestWeapons) el.chestWeapons.innerHTML = '';
    if (el.chestGrid) el.chestGrid.classList.remove('searching');
    if (el.title) el.title.textContent = '背包 / INVENTORY';
    el.root.classList.add('hidden');
    HUD.setAimVisible(true);
  }

  function openChest(c) {
    if (!c) return;
    const p = P();
    if (p.dead || G.mode !== 'mission') return;
    chest = c;
    c.opened = true;
    buildChestGrid();
    initChestSearch(c);
    if (!isOpen()) open();
    el.root.classList.add('chest-open');
    if (el.chestPanel) el.chestPanel.classList.remove('hidden');
    if (el.storeAll) el.storeAll.style.display = '';
    if (el.corpseWeaponWrap) el.corpseWeaponWrap.classList.toggle('hidden', !c.corpse);
    renderChestWeapon();
    if (el.chestTitle) el.chestTitle.textContent = chestName() + ' / CONTAINER';
    if (el.title) el.title.textContent = chestName() + ' + 背包 / CONTAINER';
    refresh();
  }

  function closeChest() {
    if (chest) {
      chest.search = null;
      chest = null;
    }
    hideChestLens();
    if (el.root) el.root.classList.remove('chest-open');
    if (el.chestPanel) el.chestPanel.classList.add('hidden');
    if (el.corpseWeaponWrap) el.corpseWeaponWrap.classList.add('hidden');
    if (el.chestWeapons) el.chestWeapons.innerHTML = '';
    if (el.chestGrid) el.chestGrid.classList.remove('searching');
    if (el.title) el.title.textContent = '背包 / INVENTORY';
    if (isOpen()) refresh();
  }

  function isChestOpen() { return !!chest; }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  /* ---------------- 动作 ---------------- */
  function busy() {
    if (action) { HUD.toast('正在处理其他操作', 'warn'); return true; }
    return false;
  }

  function startAction(type, it, from) {
    if (!isOpen() || busy()) return;
    const p = P();
    const src = from || 'bag';
    const data = {
      dismantle: { dur: it.time, label: '分解 ' + it.name },
      heal: { dur: CFG.HEAL_TIME, label: '再生治疗' },
      mag: { dur: CFG.MAG_TIME, label: '压制弹夹' },
      supply: { dur: CFG.KIT_TIME, label: '使用补给' }
    }[type];
    if (!data) return;
    action = { type: type, item: it, t: 0, dur: data.dur, label: data.label, from: src };
    if (!(type === 'dismantle' && src === 'chest')) p.sel = it || p.sel;
    el.prog.classList.remove('hidden');
    el.progFill.style.width = '0%';
    el.progLabel.textContent = data.label + ' · 0%';
    refresh();
  }

  function tryCraft(slot, wi) {
    const p = P();
    if (!isOpen() || busy()) return;
    if (wi === undefined) {
      wi = slot;
      slot = -1;
      for (let i = 0; i < p.carried.length; i++) {
        if (p.carried[i].weaponId === wi) { slot = i; break; }
      }
    }
    const w = WEAPONS[wi];
    if (slot < 0 || !p.carried[slot] || p.carried[slot].weaponId !== wi) { HUD.toast('未携带该武器', 'warn'); return; }
    if ((p.spares[slot] || 0) >= w.maxSpare) { HUD.toast('备弹已满（' + w.maxSpare + ' 夹）', 'warn'); return; }
    if (p.data < w.cost) { HUD.toast('数据不足 · 需要 ' + w.cost + ' NB', 'warn'); return; }
    action = { type: 'mag', slot: slot, weapon: wi, t: 0, dur: CFG.MAG_TIME, label: '压制 ' + w.name + ' 弹夹' };
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
      const from = (a.from === 'chest' && chest) ? 'chest' : 'bag';
      const arr = from === 'chest' ? chest.inv : p.inv;
      if (!it || arr.indexOf(it) < 0) return;
      arr.splice(arr.indexOf(it), 1);
      if (from === 'bag' && p.sel === it) p.sel = null;
      p.data += it.value;
      p.dismantledValue += it.value;
      HUD.toast('+' + it.value + ' NB · 数据提取完成', 'good');
      refresh();
    } else if (a.type === 'mag') {
      const w = WEAPONS[a.weapon];
      if (!w) return;
      if (p.data < w.cost) { HUD.toast('数据不足', 'warn'); return; }
      p.data -= w.cost;
      p.spares[a.slot] = Math.min(w.maxSpare, (p.spares[a.slot] || 0) + 1);
      HUD.toast('弹夹压装完成 · ' + w.name, 'good');
      if (a.slot === p.slot) HUD.mag(p.weapon);
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
    if (!isOpen()) { cancelAction(); return; }
    if (chest) updateChestSearch(dt);
    if (!action) return;
    const p = P();
    if (p.moving || p.dead) { cancelAction('操作中断'); return; }
    action.t += dt;
    const pct = clamp(action.t / action.dur, 0, 1) * 100;
    el.progFill.style.width = pct.toFixed(1) + '%';
    el.progLabel.textContent = action.label + ' · ' + Math.floor(pct) + '%';
    if (action.t >= action.dur) complete();
  }

  function reset() {
    drag = null; hover = null; action = null;
    chest = null; chestDrag = null; corpseDrag = null; socketDrag = null;
    if (typeof ItemTip !== 'undefined') ItemTip.hide();
    removeGhost();
    hideDrop();
    clearChestHighlight();
    clearCorpseSlotHover();
    markSocketHover(null);
    markWeaponCardHover(null);
    hideChestLens();
    if (el.root) el.root.classList.add('hidden');
    if (el.prog) el.prog.classList.add('hidden');
    if (el.title) el.title.textContent = '背包 / INVENTORY';
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  return {
    init: init, beginRun: beginRun, reset: reset,
    addItem: addItem, removeItem: removeItem, refresh: refresh,
    open: open, close: close, toggle: toggle, isOpen: isOpen,
    openChest: openChest, closeChest: closeChest, isChestOpen: isChestOpen,
    currentChest: function () { return chest; },
    rotate: rotate, update: update, cancelAction: cancelAction,
    startAction: startAction, debugComplete: complete,
    debugCraft: tryCraft, debugHeal: tryHeal, debugUse: useSupply,
    actionType: function () { return action ? action.type : ''; }
  };
})();
