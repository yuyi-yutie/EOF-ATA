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
  let chest = null;
  let chestBuilt = false;
  let chestDrag = null;

  function P() { return G.state.player; }
  function cols() { return CFG.INV_COLS; }
  function rows() { return P().invRows || CFG.INV_ROWS; }

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
      else startAction('dismantle', it);
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

  /* ---------------- 物资箱 ---------------- */
  function nowSec() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  function buildChestGrid() {
    if (!el.chestGrid) return;
    if (chestBuilt && el.chestGrid.children.length > 1) {
      el.chestCap.textContent = CFG.CHEST_COLS * CFG.CHEST_ROWS;
      return;
    }
    chestBuilt = true;
    el.chestGrid.innerHTML = '';
    el.chestGrid.style.gridTemplateColumns = 'repeat(' + CFG.CHEST_COLS + ', ' + CELL + 'px)';
    el.chestGrid.style.gridTemplateRows = 'repeat(' + CFG.CHEST_ROWS + ', ' + CELL + 'px)';
    for (let i = 0; i < CFG.CHEST_COLS * CFG.CHEST_ROWS; i++) {
      el.chestGrid.appendChild(UI.el('div', 'cell'));
    }
    const items = UI.el('div', 'inv-items');
    items.id = 'chestItems';
    el.chestGrid.appendChild(items);
    const lens = UI.el('div', 'chest-lens hidden');
    lens.id = 'chestLens';
    el.chestGrid.appendChild(lens);
    el.chestItems = items;
    el.chestLens = lens;
    el.chestCap.textContent = CFG.CHEST_COLS * CFG.CHEST_ROWS;
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
    if (el.chestStatus) {
      el.chestStatus.textContent = s.total
        ? (s.active ? '搜索中 ' + found + ' / ' + s.total : '搜索完成')
        : '空箱子';
    }
    if (el.takeAll) {
      el.takeAll.disabled = s.active;
      el.takeAll.classList.toggle('dis', s.active);
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
      div.title = found ? '点击或拖拽放入背包' : '搜索中…';
      div.addEventListener('pointerdown', function (e) { onChestDown(e, it); });
      el.chestItems.appendChild(div);
    }
    el.chestCount.textContent = Grid.usedCells(chest.inv);
    el.chestCap.textContent = CFG.CHEST_COLS * CFG.CHEST_ROWS;
    updateChestStatus();
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
      if (Grid.fits(chest.inv, copy, tx, ty, copy.rot, CFG.CHEST_COLS, CFG.CHEST_ROWS)) {
        copy.gx = tx;
        copy.gy = ty;
        return true;
      }
      return false;
    }
    return Grid.autoPlace(chest.inv, copy, CFG.CHEST_COLS, CFG.CHEST_ROWS);
  }

  function transferToBag(it, tx, ty) {
    if (!chest) return;
    const s = chest.search;
    if (s && s.active) {
      HUD.toast('还在搜索物资 · 请稍候', 'warn');
      return;
    }
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
    if (chest.search && chest.search.active) {
      HUD.toast('还在搜索物资 · 请稍候', 'warn');
      return;
    }
    if (!chest.inv.length) {
      HUD.toast('物资箱是空的', 'warn');
      return;
    }
    const p = P();
    let n = 0, full = false;
    for (const it of chest.inv.slice()) {
      const copy = Grid.cloneItem(it);
      if (!Grid.autoPlace(p.inv, copy, cols(), rows())) { full = true; break; }
      p.inv.push(copy);
      chest.inv.splice(chest.inv.indexOf(it), 1);
      n++;
    }
    if (n && G.noteLoot) G.noteLoot(n);
    refresh();
    if (n) HUD.toast('拿走 ' + n + ' 件' + (full ? ' · 背包已满' : ''), 'good');
    else HUD.toast('背包已满', 'warn');
  }

  function storeAll() {
    if (!chest) return;
    const p = P();
    if (!p.inv.length) {
      HUD.toast('背包是空的', 'warn');
      return;
    }
    let n = 0, full = false;
    for (const it of p.inv.slice()) {
      const copy = Grid.cloneItem(it);
      if (!Grid.autoPlace(chest.inv, copy, CFG.CHEST_COLS, CFG.CHEST_ROWS)) { full = true; break; }
      copy.found = true;
      copy.foundAt = nowSec();
      chest.inv.push(copy);
      p.inv.splice(p.inv.indexOf(it), 1);
      n++;
    }
    if (p.sel && p.inv.indexOf(p.sel) < 0) p.sel = null;
    refresh();
    if (n) HUD.toast('存入 ' + n + ' 件' + (full ? ' · 箱子已满' : ''), 'good');
    else HUD.toast('物资箱已满', 'warn');
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
      tx: it.gx, ty: it.gy, valid: true
    };
    p.sel = it;
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    refresh();
    updateGhost(e);
  }

  function onMove(e) {
    if (chestDrag) { onChestMove(e); return; }
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
    if (!it.found || (chest && chest.search && chest.search.active)) return;
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
    if (pointIn(el.grid, e)) {
      const r = el.grid.getBoundingClientRect();
      const tx = Math.round((e.clientX - r.left) / PITCH - chestDrag.fx);
      const ty = Math.round((e.clientY - r.top) / PITCH - chestDrag.fy);
      const valid = Grid.fits(P().inv, chestDrag.it, tx, ty, chestDrag.it.rot, cols(), rows());
      showDrop(tx, ty, chestDrag.it, valid);
      if (el.chestGrid) {
        el.chestGrid.classList.remove('drop-over');
        el.chestGrid.classList.remove('bad');
      }
    } else {
      hideDrop();
    }
  }

  function onChestUp(e) {
    if (!chestDrag) return;
    const d = chestDrag;
    chestDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    if (!e || e.type === 'pointercancel') { refresh(); return; }
    if (!d.moved) { transferToBag(d.it); return; }
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
      if (Grid.fits(chest.inv, d.it, tx, ty, d.it.rot, CFG.CHEST_COLS, CFG.CHEST_ROWS, d.it)) {
        d.it.gx = tx;
        d.it.gy = ty;
      }
      refresh();
      return;
    }
    refresh();
  }

  function onUp(e) {
    if (chestDrag) { onChestUp(e); return; }
    if (!drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    const canceled = e && e.type === 'pointercancel';
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

  function clearChestHighlight() {
    if (el.chestGrid) {
      el.chestGrid.classList.remove('drop-over');
      el.chestGrid.classList.remove('bad');
    }
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

    const overChest = !!(chest && pointIn(el.chestGrid, e));
    if (el.chestGrid) {
      el.chestGrid.classList.toggle('drop-over', overChest);
      if (overChest) {
        const cr = el.chestGrid.getBoundingClientRect();
        const ctx = Math.round((e.clientX - cr.left) / PITCH - drag.fx);
        const cty = Math.round((e.clientY - cr.top) / PITCH - drag.fy);
        const cvalid = Grid.fits(chest.inv, it, ctx, cty, it.rot, CFG.CHEST_COLS, CFG.CHEST_ROWS);
        el.chestGrid.classList.toggle('bad', !cvalid);
      } else {
        el.chestGrid.classList.remove('bad');
      }
    }
    if (drag.moved && !overChest) showDrop(tx, ty, it, valid);
    else hideDrop();

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
    chestDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
    cancelAction();
    if (chest) {
      chest.search = null;
      chest = null;
    }
    hideChestLens();
    el.root.classList.remove('chest-open');
    if (el.chestPanel) el.chestPanel.classList.add('hidden');
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
    if (el.title) el.title.textContent = '物资箱 + 背包 / CONTAINER';
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
    chest = null; chestDrag = null;
    removeGhost();
    hideDrop();
    clearChestHighlight();
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
    rotate: rotate, update: update, cancelAction: cancelAction,
    startAction: startAction, debugComplete: complete,
    debugCraft: tryCraft, debugHeal: tryHeal, debugUse: useSupply,
    actionType: function () { return action ? action.type : ''; }
  };
})();
