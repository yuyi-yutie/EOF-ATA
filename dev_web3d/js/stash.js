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
    el.bank = UI.$('stashBank');
    el.count = UI.$('stashCount');
    el.value = UI.$('stashValue');
    el.cells = UI.$('stashCells');
    el.detail = UI.$('stashDetail');
    el.breakdown = UI.$('stashBreak');
    el.all = UI.$('stashAll');
    el.sort = UI.$('stashSort');
    el.msg = UI.$('stashMsg');

    layout();
    applyGrid();

    for (let i = 0; i < CFG.STASH_COLS * CFG.STASH_ROWS; i++) {
      const d = UI.el('div', 'cell');
      d.addEventListener('click', function () { selected = null; refresh(); });
      el.grid.insertBefore(d, el.items);
    }

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
      dismantle(selected);
    });

    window.addEventListener('resize', function () {
      if (layout()) refresh();
    });
  }

  function tierOf(id) {
    return TIER_BY_ID[id] || TIERS[0];
  }

  function renderItems() {
    const list = Store.stash();
    el.items.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const d = Grid.dims(it);
      const div = UI.el('div', 'stash-item' + (selected === it ? ' sel' : ''));
      div.style.left = (it.gx * PITCH) + 'px';
      div.style.top = (it.gy * PITCH) + 'px';
      div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      div.style.setProperty('--qc', tierOf(it.tierId).color);
      div.innerHTML =
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
      el.items.appendChild(div);
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
    el.detail.innerHTML =
      '<div class="dt-name">' + UI.esc(it.name) + '</div>' +
      '<div class="dt-line"><span>' + t.name + ' · 数据载体</span><b>' + it.value + ' NB</b></div>' +
      '<div class="dt-line"><span>尺寸</span><b>' + d.w + '×' + d.h + '</b></div>' +
      '<div class="dt-line"><span>分解耗时</span><b>仓库内瞬发</b></div>' +
      '<div class="dt-hint">[右键] 立即分解为数据</div>' +
      '<div class="dt-touch"><button type="button" class="dt-btn danger" data-stash-act="dismantle">分解</button></div>';
  }

  function dismantle(it) {
    const v = Store.stashDismantle(it);
    if (!v) return;
    if (selected === it) selected = null;
    refresh();
    Lobby.refreshBank();
    msg('+' + UI.fmt(v) + ' NB');
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
    applyGrid();
    const list = Store.stash();
    if (selected && list.indexOf(selected) < 0) selected = null;
    el.bank.textContent = UI.fmt(Store.bank());
    el.count.textContent = list.length;
    el.value.textContent = UI.fmt(Store.stashValue());
    el.cells.textContent = Store.stashCells() + ' / ' + (CFG.STASH_COLS * CFG.STASH_ROWS);
    el.all.classList.toggle('dis', list.length === 0);
    renderItems();
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
