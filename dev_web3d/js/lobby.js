'use strict';

/* ============================================================
   大厅 / 机库
   - 配装：角色、2 把武器、初始弹夹、携带数据
   - 内页：仓库 / 补给站 / 合约 / 档案
   - 3D 机库由 Hangar 渲染，这里只负责界面与状态
   ============================================================ */

const Lobby = (function () {
  const CHARS = [
    { key: 'scout', name: '潜行者', role: '标准型', desc: '均衡 · 视野清晰', color: '#6fa3a8' },
    { key: 'assault', name: '突击手', role: '突击型', desc: '厚重 · 装甲感强', color: '#d0b26a' }
  ];
  const TABS = [
    { id: 'loadout', name: '配装' },
    { id: 'stash', name: '仓库' },
    { id: 'shop', name: '补给站' },
    { id: 'contracts', name: '合约' },
    { id: 'archive', name: '档案' }
  ];

  const el = {};
  let tab = 'loadout';
  let picked = [3, 0];
  let mags = [1, 0];
  let carry = 100;
  let character = 0;
  let msgTimer = 0;

  function init() {
    el.root = UI.$('lobby');
    el.tabs = UI.$('lobbyTabs');
    el.bank = UI.$('lobbyBank');
    el.best = UI.$('lobbyBest');
    el.chars = UI.$('lobbyChars');
    el.charName = UI.$('lobbyCharName');
    el.weapons = UI.$('lobbyWeapons');
    el.pick = UI.$('lobbyPick');
    el.load = UI.$('lobbyLoad');
    el.kit = UI.$('lobbyKit');
    el.carry = UI.$('lobbyCarry');
    el.carryMax = UI.$('lobbyCarryMax');
    el.cost = UI.$('lobbyCost');
    el.carryCost = UI.$('lobbyCarryCost');
    el.remain = UI.$('lobbyRemain');
    el.stashCount = UI.$('lobbyStashCount');
    el.stashValue = UI.$('lobbyStashValue');
    el.start = UI.$('lobbyStart');
    el.warn = UI.$('lobbyWarn');
    el.msg = UI.$('lobbyMsg');
    el.footHint = UI.$('lobbyFootHint');

    el.root.classList.remove('hidden');

    /* 初始配装来自存档 */
    const lo = Store.loadout();
    picked = [lo.weapons[0], lo.weapons[1]];
    mags = [lo.mags[0], lo.mags[1]];
    carry = lo.carry;
    character = Store.char();

    buildTabs();
    buildChars();
    buildWeapons();
    bindStatic();
    refreshBank();
    refresh();
  }

  /* ---------------- 结构 ---------------- */
  function buildTabs() {
    el.tabs.innerHTML = '';
    TABS.forEach(function (t) {
      const b = UI.el('button', 'tab', t.name);
      b.dataset.tab = t.id;
      b.addEventListener('click', function () { setTab(t.id); });
      el.tabs.appendChild(b);
    });
  }

  function buildChars() {
    el.chars.innerHTML = '';
    CHARS.forEach(function (c, i) {
      const d = UI.el('div', 'char-card');
      d.style.setProperty('--cc', c.color);
      d.innerHTML =
        '<span class="char-icon"><i></i></span>' +
        '<span class="char-meta">' +
          '<span class="char-name">' + c.name + '</span>' +
          '<span class="char-role">' + c.role + ' · ' + c.desc + '</span>' +
        '</span>' +
        '<span class="char-check">✓</span>';
      d.addEventListener('click', function () {
        character = i;
        Store.setChar(i);
        refresh();
      });
      el.chars.appendChild(d);
    });
  }

  function buildWeapons() {
    el.weapons.innerHTML = '';
    WEAPONS.forEach(function (w, i) {
      const d = UI.el('div', 'wc');
      d.dataset.w = i;
      d.style.setProperty('--wc', w.color);
      d.innerHTML =
        '<span class="wc-tag">' + w.tag + '</span>' +
        '<span class="wc-main">' +
          '<span class="wc-name">' + w.name + '</span>' +
          '<span class="wc-stats">弹夹 ' + w.mag + ' · ' + w.cost + ' NB/夹</span>' +
        '</span>' +
        '<span class="wc-check">✓</span>';
      d.addEventListener('click', function () { toggleWeapon(i); });
      el.weapons.appendChild(d);
    });
  }

  function bindStatic() {
    el.start.addEventListener('click', launch);
    UI.$('carryMinus').addEventListener('click', function () { addCarry(-CFG.CARRY_UNIT); });
    UI.$('carryPlus').addEventListener('click', function () { addCarry(CFG.CARRY_UNIT); });
    UI.$('carryAll').addEventListener('click', function () {
      carry = maxCarry();
      refresh();
    });
    UI.$('contractReroll').addEventListener('click', function () { Contracts.reroll(); });
    UI.$('archiveWipe').addEventListener('click', onWipe);
    window.addEventListener('keydown', function (e) {
      if (el.root.classList.contains('hidden')) return;
      if (e.code === 'Enter') { e.preventDefault(); launch(); }
      if (e.code === 'Escape' && tab !== 'loadout') setTab('loadout');
    });
  }

  /* ---------------- 状态 ---------------- */
  function setTab(name) {
    tab = name;
    el.root.classList.toggle('pane-mode', name !== 'loadout');
    const books = el.tabs.children;
    for (let i = 0; i < books.length; i++) {
      books[i].classList.toggle('on', books[i].dataset.tab === name);
    }
    const panes = el.root.querySelectorAll('.tab-pane');
    for (let i = 0; i < panes.length; i++) {
      panes[i].classList.toggle('on', panes[i].id === 'pane' + name.charAt(0).toUpperCase() + name.slice(1));
    }
    if (name === 'stash') Stash.selectFirst();
    if (name === 'shop') Shop.refresh();
    if (name === 'contracts') Contracts.refresh();
    if (name === 'archive') renderArchive();
  }

  function toggleWeapon(i) {
    const k = picked.indexOf(i);
    if (k >= 0) {
      picked.splice(k, 1);
      mags.splice(k, 1);
    } else {
      if (picked.length >= 2) { msg('最多携带 2 把武器'); return; }
      picked.push(i);
      mags.push(0);
    }
    refresh();
  }

  function setMag(slot, d) {
    mags[slot] = clamp((mags[slot] || 0) + d, 0, CFG.CARRY_MAX_MAGS);
    refresh();
  }

  function magsCost() {
    let sum = 0;
    for (let i = 0; i < picked.length; i++) sum += (mags[i] || 0) * WEAPONS[picked[i]].cost;
    return sum;
  }

  function maxCarry() {
    const left = Store.bank() - magsCost();
    return Math.max(0, Math.floor(left / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
  }

  function addCarry(d) {
    carry = clamp(carry + d, 0, maxCarry());
    refresh();
  }

  function totalCost() { return magsCost() + carry; }

  function refreshBank() {
    if (!el.bank) return;
    el.bank.textContent = UI.fmt(Store.bank());
    el.best.textContent = UI.fmt(Store.best());
    if (tab === 'stash') Stash.refresh();
    if (tab === 'shop') Shop.refresh();
    if (tab === 'contracts') Contracts.refresh();
    if (tab === 'loadout') refresh();
  }

  /* ---------------- 渲染 ---------------- */
  function refresh() {
    if (!el.root) return;
    const bank = Store.bank();
    el.bank.textContent = UI.fmt(bank);
    el.best.textContent = UI.fmt(Store.best());
    el.pick.textContent = picked.length + ' / 2';
    el.charName.textContent = CHARS[character] ? CHARS[character].name : '潜行者';

    /* 角色 */
    for (let i = 0; i < el.chars.children.length; i++) {
      el.chars.children[i].classList.toggle('on', i === character);
    }

    /* 武器 */
    for (let i = 0; i < el.weapons.children.length; i++) {
      const idx = parseInt(el.weapons.children[i].dataset.w, 10);
      el.weapons.children[i].classList.toggle('on', picked.indexOf(idx) >= 0);
    }

    /* 两个配装槽 */
    el.load.innerHTML = '';
    for (let slot = 0; slot < 2; slot++) {
      const wi = picked[slot];
      const row = UI.el('div', 'load-row' + (wi === undefined ? ' empty' : ''));
      if (wi === undefined) {
        row.innerHTML = '<span class="lr-name">空槽位</span><span class="lr-hint">在左侧选择武器</span>';
      } else {
        const w = WEAPONS[wi];
        const n = mags[slot] || 0;
        row.style.setProperty('--wc', w.color);
        row.innerHTML =
          '<span class="lr-tag">' + w.tag + '</span>' +
          '<span class="lr-name">' + w.name + '</span>' +
          '<button class="lr-btn" data-a="-">−</button>' +
          '<span class="lr-num">' + n + '</span>' +
          '<button class="lr-btn" data-a="+">+</button>' +
          '<span class="lr-cost">' + (n * w.cost) + ' NB</span>';
        row.querySelector('[data-a="-"]').addEventListener('click', function () { setMag(slot, -1); });
        row.querySelector('[data-a="+"]').addEventListener('click', function () { setMag(slot, 1); });
      }
      el.load.appendChild(row);
    }

    /* 数据 */
    const cap = maxCarry();
    if (carry > cap) carry = cap;
    if (carry % CFG.CARRY_UNIT !== 0) carry = Math.floor(carry / CFG.CARRY_UNIT) * CFG.CARRY_UNIT;
    el.carry.textContent = UI.fmt(carry);
    el.carryMax.textContent = '上限 ' + UI.fmt(cap) + ' NB';

    const magCost = magsCost();
    const cost = magCost + carry;
    el.cost.textContent = UI.fmt(cost);
    el.carryCost.textContent = UI.fmt(carry);
    el.remain.textContent = UI.fmt(Math.max(0, bank - cost));
    el.stashCount.textContent = Store.stashCount();
    el.stashValue.textContent = UI.fmt(Store.stashValue());

    /* 战术补给 */
    const kit = Store.kit();
    el.kit.innerHTML =
      '<span class="kit-chip"><i style="--kc:#e2604f"></i>医疗针 <b>' + (kit.medkit || 0) + '</b></span>' +
      '<span class="kit-chip"><i style="--kc:#6fd8ef"></i>护盾电池 <b>' + (kit.battery || 0) + '</b></span>';

    const ok = picked.length === 2 && cost <= bank;
    el.start.classList.toggle('dis', !ok);

    let warn = '';
    if (picked.length < 2) warn = '需要携带 2 把武器';
    else if (magCost > bank) warn = '数据不足，减少弹夹配给';
    else if (carry > 0 && carry > maxCarry()) warn = '携带数据超出可用额度';
    else if (picked.every(function (i, k) { return !(mags[k] || 0); })) warn = '未配给弹夹：进局后需用数据压装';
    else if (carry === 0) warn = '未携带数据：局内需先搜刮分解';
    el.warn.textContent = warn;

    /* 配装随时写回存档，档案页与下次启动都能看到当前选择 */
    if (picked.length === 2) {
      Store.setLoadout({
        weapons: picked.slice(),
        mags: [mags[0] || 0, mags[1] || 0],
        carry: carry
      });
    }
  }

  function msg(text) {
    el.msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.msg.textContent = ''; }, 1800);
  }

  /* ---------------- 出击 ---------------- */
  function launch() {
    if (G.mode !== 'lobby') return;
    if (tab !== 'loadout') { setTab('loadout'); return; }
    if (picked.length !== 2) { msg('需要携带 2 把武器'); return; }
    const cost = totalCost();
    if (cost > Store.bank()) { msg('数据不足，无法配给'); return; }
    if (!Store.spend(cost)) { msg('数据不足，无法配给'); return; }
    Store.setLoadout({ weapons: picked, mags: mags, carry: carry });
    Store.setChar(character);
    Store.save();

    el.root.classList.add('hidden');
    G.beginMission({
      weapons: picked.slice(),
      mags: mags.slice(),
      data: carry,
      character: character
    });
  }

  function show() {
    el.root.classList.remove('hidden');
    setTab('loadout');
    refresh();
  }

  /* 从存档重新读取配装（清档 / 调试填档后调用） */
  function reloadFromSave() {
    const lo = Store.loadout();
    picked = [lo.weapons[0], lo.weapons[1]];
    mags = [lo.mags[0], lo.mags[1]];
    carry = lo.carry;
    character = Store.char();
    refresh();
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  /* ---------------- 档案 ---------------- */
  let wipeArmed = false;
  function renderArchive() {
    const s = Store.stats();
    const set = function (id, v) { const n = UI.$(id); if (n) n.textContent = v; };
    set('arcRuns', s.runs);
    set('arcExtracts', s.extracts);
    set('arcDeaths', s.deaths);
    set('arcKills', UI.fmt(s.kills));
    set('arcLooted', UI.fmt(s.looted));
    set('arcDismantled', UI.fmt(s.dismantled));
    set('arcBestHaul', UI.fmt(s.bestHaul) + ' NB');
    set('arcBestKills', s.bestKills);
    set('arcTime', UI.time(s.time));
    const rate = s.runs ? Math.round(s.extracts / s.runs * 100) : 0;
    set('arcRate', rate + '%');

    /* 强化概览 */
    const box = UI.$('arcAugs');
    if (box) {
      box.innerHTML = '';
      AUGMENTS.forEach(function (a) {
        const lv = Store.aug(a.id);
        const row = UI.el('div', 'arc-aug');
        row.style.setProperty('--ac', a.color);
        row.innerHTML =
          '<span class="aa-name">' + a.name + '</span>' +
          '<span class="aa-lv">Lv.' + lv + ' / ' + a.max + '</span>' +
          '<span class="aa-val">' + a.value(lv) + '</span>';
        box.appendChild(row);
      });
    }

    /* 当前配装 */
    const loadBox = UI.$('arcLoadout');
    if (loadBox) {
      loadBox.innerHTML = '';
      const lo = Store.loadout();
      for (let i = 0; i < 2; i++) {
        const wi = lo.weapons[i];
        const w = WEAPONS[wi];
        const row = UI.el('div', 'ar-row');
        row.innerHTML =
          '<span>' + w.name + '</span>' +
          '<b>' + lo.mags[i] + ' 夹 · ' + w.cost + ' NB/夹</b>';
        loadBox.appendChild(row);
      }
      const carry = UI.el('div', 'ar-row');
      carry.innerHTML = '<span>携带数据</span><b>' + UI.fmt(lo.carry) + ' NB</b>';
      loadBox.appendChild(carry);
    }

    /* 补给与仓库容量 */
    const kitBox = UI.$('arcKit');
    if (kitBox) {
      const kit = Store.kit();
      kitBox.innerHTML =
        '<span>医疗针 <b>' + kit.medkit + '</b></span>' +
        '<span>护盾电池 <b>' + kit.battery + '</b></span>';
    }
    const stashLabel = UI.$('arcStashLabel');
    if (stashLabel) {
      stashLabel.textContent = '仓库 ' + Store.stashCells() + ' / ' +
        (CFG.STASH_COLS * CFG.STASH_ROWS) + ' 格';
    }
    const stashFill = UI.$('arcStashFill');
    if (stashFill) {
      stashFill.style.width = (Store.stashCells() / (CFG.STASH_COLS * CFG.STASH_ROWS) * 100) + '%';
    }

    /* 战绩 */
    const hist = UI.$('arcHistory');
    if (hist) {
      hist.innerHTML = '';
      const list = Store.history();
      if (!list.length) {
        hist.innerHTML = '<div class="arc-empty">还没有出击记录</div>';
      } else {
        list.forEach(function (h) {
          const row = UI.el('div', 'hist-row' + (h.win ? ' win' : ''));
          row.innerHTML =
            '<span class="hr-res">' + (h.win ? '撤离' : '失联') + '</span>' +
            '<span class="hr-k">击杀 ' + h.kills + '</span>' +
            '<span class="hr-l">物资 ' + h.loot + '</span>' +
            '<span class="hr-d">' + UI.fmt(h.data) + ' NB</span>' +
            '<span class="hr-v">' + UI.fmt(h.value) + ' NB</span>' +
            '<span class="hr-t">' + UI.time(h.time) + '</span>';
          hist.appendChild(row);
        });
      }
    }

    /* 镜头默认俯角 */
    const camBox = UI.$('arcCam');
    if (camBox) {
      camBox.innerHTML = '';
      [45, 55, 62, 70].forEach(function (p) {
        const b = UI.el('button', 'chip' + (Store.raw().settings.pitch === p ? ' on' : ''), p + '°');
        b.addEventListener('click', function () {
          Store.raw().settings.pitch = p;
          Store.save();
          renderArchive();
        });
        camBox.appendChild(b);
      });
    }

    const wipe = UI.$('archiveWipe');
    if (wipe) {
      wipe.textContent = wipeArmed ? '再次点击 · 确认清空' : '清空存档';
      wipe.classList.toggle('danger', wipeArmed);
    }
  }

  function onWipe() {
    if (!wipeArmed) {
      wipeArmed = true;
      renderArchive();
      UI.toast('再次点击清空全部存档', 'warn');
      setTimeout(function () { wipeArmed = false; renderArchive(); }, 4000);
      return;
    }
    wipeArmed = false;
    Store.reset();
    reloadFromSave();
    renderArchive();
    refreshBank();
    UI.toast('存档已重置', 'warn');
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  return {
    init: init, show: show, hide: hide, refresh: refresh, refreshBank: refreshBank,
    setTab: setTab, launch: launch, reloadFromSave: reloadFromSave,
    get picked() { return picked; }
  };
})();
