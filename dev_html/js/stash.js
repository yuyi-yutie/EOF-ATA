'use strict';

/* ============================================================
   大仓库：跨局保存物资（按尺寸摆格），可瞬时分解
   ============================================================ */
const Stash = (() => {
  const COLS = 12;
  const ROWS = 8;
  const CELL = 52;
  const GAP = 6;
  const PITCH = CELL + GAP;
  const KEY = 'eofata.stash';

  let items = [];
  let selected = null;
  const el = {};
  let msgTimer = 0;

  /* ---------------- 数据 ---------------- */
  function normalize(raw) {
    const tierId = raw.tierId || (raw.tier && raw.tier.id) || 'common';
    return {
      name: String(raw.name || '未知物资'),
      tierId,
      w: clamp(raw.w | 0, 1, COLS),
      h: clamp(raw.h | 0, 1, ROWS),
      value: Math.max(0, raw.value | 0),
      time: raw.time || 1,
      gx: 0, gy: 0, rot: 0
    };
  }

  function dims(it, rot) {
    const r = (rot === undefined ? it.rot : rot) ? 1 : 0;
    return r ? { w: it.h, h: it.w } : { w: it.w, h: it.h };
  }

  function overlaps(it, gx, gy, rot, ignore) {
    const d = dims(it, rot);
    if (gx < 0 || gy < 0 || gx + d.w > COLS || gy + d.h > ROWS) return true;
    for (const o of items) {
      if (o === ignore) continue;
      const od = dims(o);
      if (gx < o.gx + od.w && gx + d.w > o.gx && gy < o.gy + od.h && gy + d.h > o.gy) return true;
    }
    return false;
  }

  function place(it) {
    for (const r of [0, 1]) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!overlaps(it, x, y, r, null)) {
            it.gx = x;
            it.gy = y;
            it.rot = r;
            return true;
          }
        }
      }
    }
    return false;
  }

  function load() {
    let raw = [];
    try {
      const s = localStorage.getItem(KEY);
      raw = s ? JSON.parse(s) : [];
    } catch (e) { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    items = [];
    for (const r of raw) {
      if (!r || !r.name) continue;
      const it = normalize(r);
      if (place(it)) items.push(it);
    }
    save();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(items.map(it => ({
        name: it.name, tierId: it.tierId, w: it.w, h: it.h,
        value: it.value, time: it.time, gx: it.gx, gy: it.gy, rot: it.rot
      }))));
    } catch (e) { /* ignore */ }
  }

  function addRaw(raw) {
    const it = normalize(raw);
    if (!place(it)) return false;
    items.push(it);
    return true;
  }

  function addMany(list) {
    let n = 0;
    for (const raw of list) if (addRaw(raw)) n++;
    save();
    if (isOpen()) refresh();
    return n;
  }

  function dismantle(it) {
    const i = items.indexOf(it);
    if (i < 0) return 0;
    items.splice(i, 1);
    if (selected === it) selected = null;
    Bank.set(Bank.get() + it.value);
    save();
    refresh();
    msg('+' + it.value + ' NB');
    return it.value;
  }

  function dismantleAll() {
    if (!items.length) return 0;
    let sum = 0;
    for (const it of items) sum += it.value;
    items = [];
    selected = null;
    Bank.set(Bank.get() + sum);
    save();
    refresh();
    msg('全部拆解 · +' + sum + ' NB');
    return sum;
  }

  function count() { return items.length; }
  function total() { return items.reduce((s, it) => s + it.value, 0); }
  function all() { return items.slice(); }

  /* ---------------- UI ---------------- */
  function init() {
    el.root = document.getElementById('stash');
    el.grid = document.getElementById('stashGrid');
    el.items = document.getElementById('stashItems');
    el.bank = document.getElementById('stashBank');
    el.count = document.getElementById('stashCount');
    el.value = document.getElementById('stashValue');
    el.detail = document.getElementById('stashDetail');
    el.all = document.getElementById('stashAll');
    el.close = document.getElementById('stashClose');
    el.msg = document.getElementById('stashMsg');

    for (let i = 0; i < COLS * ROWS; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.addEventListener('click', () => { selected = null; refresh(); });
      el.grid.insertBefore(d, el.items);
    }

    el.close.addEventListener('click', () => show(false));
    el.all.addEventListener('click', () => dismantleAll());

    load();
    refresh();
  }

  function tierOf(id) {
    return TIERS.find(t => t.id === id) || TIERS[0];
  }

  function renderItems() {
    el.items.innerHTML = '';
    for (const it of items) {
      const d = dims(it);
      const div = document.createElement('div');
      div.className = 'stash-item' + (selected === it ? ' sel' : '');
      div.style.left = (it.gx * PITCH) + 'px';
      div.style.top = (it.gy * PITCH) + 'px';
      div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      div.style.setProperty('--qc', tierOf(it.tierId).color);
      div.innerHTML =
        '<span class="sz">' + d.w + '×' + d.h + '</span>' +
        '<span class="nm">' + it.name + '</span>' +
        '<span class="val">' + it.value + '</span>';
      div.addEventListener('click', e => {
        e.stopPropagation();
        selected = it;
        refresh();
      });
      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        dismantle(it);
      });
      el.items.appendChild(div);
    }
  }

  function renderDetail() {
    if (!selected || items.indexOf(selected) < 0) {
      el.detail.innerHTML = '<div class="dt-empty">仓库物资会跨局保存<br>右键单件立即分解</div>';
      return;
    }
    const it = selected;
    const d = dims(it);
    const t = tierOf(it.tierId);
    el.detail.innerHTML =
      '<div class="dt-name">' + it.name + '</div>' +
      '<div>' + t.name + ' · 尺寸 <b>' + d.w + '×' + d.h + '</b></div>' +
      '<div>分解价值 <b>' + it.value + ' NB</b></div>';
  }

  function refresh() {
    if (!el.root) return;
    el.bank.textContent = fmt(Bank.get());
    el.count.textContent = items.length;
    el.value.textContent = fmt(total());
    el.all.classList.toggle('dis', items.length === 0);
    renderItems();
    renderDetail();
  }

  function msg(text) {
    if (!el.msg) return;
    el.msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.msg.textContent = ''; }, 1600);
  }

  function show(v) {
    el.root.classList.toggle('hidden', !v);
    if (v) refresh();
    else if (typeof Lobby !== 'undefined') Lobby.refresh();
  }

  function isOpen() {
    return el.root && !el.root.classList.contains('hidden');
  }

  return { init, show, isOpen, refresh, addMany, count, total, all, dismantle, dismantleAll };
})();
