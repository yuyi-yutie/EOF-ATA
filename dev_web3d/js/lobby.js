'use strict';

/* ============================================================
   大厅 / 机库
   - 主界面：角色、当前配装摘要、出击
   - 仓库页：内嵌两个配装槽、弹夹与携带数据配置
   - 内页：仓库 / 制造 / 补给站 / 合约 / 档案
   ============================================================ */

const Lobby = (function () {
  const CHARS = [
    { key: 'scout', name: '潜行者', role: '标准型', desc: '均衡 · 视野清晰', color: '#6fa3a8' },
    { key: 'assault', name: '突击手', role: '突击型', desc: '厚重 · 装甲感强', color: '#d0b26a' },
    { key: 'tactical', name: '战术干员', role: '战术型', desc: '夜战装备 · 战术护甲', color: '#8d9aa3' },
    { key: 'scav', name: '拾荒者 · 灰鼠', role: '拾荒者', desc: '破烂兜帽 · 潜行', color: '#8a7656' },
    { key: 'raider', name: '拾荒者 · 暴徒', role: '拾荒者', desc: '废铁护甲 · 近战', color: '#a36a4f' },
    { key: 'veteran', name: '拾荒者 · 老油条', role: '拾荒者', desc: '旧风衣 · 捡漏', color: '#7f8474' },
    { key: 'specter', name: '特种干员 · 幽影', role: '特种型', desc: '长条目镜 · 夜战装甲', color: '#5fb8c9' },
    { key: 'ranger', name: '侦察队员 · 游隼', role: '侦察型', desc: '轻型护甲 · 琥珀条镜', color: '#93a06a' },
    { key: 'breacher', name: '破障队员 · 铁砧', role: '破障型', desc: '重型胸甲 · 破门工具', color: '#d07b44' },
    { key: 'juggernaut', name: '动力甲 · 铁壁', role: '重装型', desc: '全身动力装甲 · 反应堆背包', color: '#9aa3ad' },
    { key: 'vanguard', name: '动力甲 · 先锋', role: '突击型', desc: '白色装甲 · 推进背包', color: '#d8dde2' },
    { key: 'sentinel', name: '动力甲 · 哨戒', role: '哨戒型', desc: '琥珀条镜 · 警戒涂装', color: '#7f8f74' }
  ];
  const TABS = [
    { id: 'home', name: '机库' },
    { id: 'stash', name: '仓库' },
    { id: 'craft', name: '制造' },
    { id: 'shop', name: '补给站' },
    { id: 'contracts', name: '合约' },
    { id: 'archive', name: '档案' }
  ];

  const el = {};
  let tab = 'home';
  let mags = [0, 0];
  let carry = 0;
  let character = 0;
  let chipPicker = -1;
  let weaponPicker = -1;
  let gadgetPick = -1;
  let mapPickTouched = false;
  let msgTimer = 0;
  let chipDrag = null, chipGhost = null, chipDragMovedAt = 0;

  function init() {
    el.root = UI.$('lobby');
    el.tabs = UI.$('lobbyTabs');
    el.bank = UI.$('lobbyBank');
    el.best = UI.$('lobbyBest');
    el.chars = UI.$('lobbyChars');
    el.charName = UI.$('lobbyCharName');
    el.load = UI.$('lobbyLoad');
    el.gadgets = UI.$('lobbyGadgets');
    el.carry = UI.$('lobbyCarry');
    el.carryMax = UI.$('lobbyCarryMax');
    el.cost = UI.$('lobbyCost');
    el.carryCost = UI.$('lobbyCarryCost');
    el.remain = UI.$('lobbyRemain');
    el.stashCount = UI.$('lobbyStashCount');
    el.stashValue = UI.$('lobbyStashValue');
    el.pick = UI.$('lobbyPick');
    el.summary = UI.$('lobbySummary');
    el.gotoStash = UI.$('gotoStash');
    el.start = UI.$('lobbyStart');
    el.warn = UI.$('lobbyWarn');
    el.msg = UI.$('lobbyMsg');
    el.mainMsg = UI.$('lobbyMainMsg');
    el.footHint = UI.$('lobbyFootHint');
    el.mapPick = UI.$('lobbyMapPick');
    el.mapCount = UI.$('lobbyMapCount');
    el.mapHint = UI.$('lobbyMapHint');

    el.root.classList.remove('hidden');

    reloadFromSave();
    buildTabs();
    buildChars();
    bindStatic();
    refreshMapPick();
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

  function bindStatic() {
    el.start.addEventListener('click', launch);
    if (el.gotoStash) el.gotoStash.addEventListener('click', function () { setTab('stash'); });
    const testBtn = UI.$('testMapBtn');
    if (testBtn) testBtn.addEventListener('click', function () {
      if (G.mode !== 'lobby') return;
      if (typeof MOBILE !== 'undefined') MOBILE.enterGame();
      G.beginTestMap();
    });
    const editorBtn = UI.$('openMapEditor');
    if (editorBtn) editorBtn.addEventListener('click', function () {
      window.open('editor.html', '_blank', 'noopener');
    });
    if (el.mapPick) {
      el.mapPick.addEventListener('change', function () {
        mapPickTouched = true;
        if (typeof MAPSTORE !== 'undefined') MAPSTORE.setPicked(el.mapPick.value === 'random' ? '' : el.mapPick.value);
        updateMapHint();
      });
    }
    window.addEventListener('storage', function (e) {
      if (e && e.key && typeof MAPSTORE !== 'undefined' && e.key === MAPSTORE.KEY) refreshMapPick();
    });
    window.addEventListener('focus', refreshMapPick);
    UI.$('carryMinus').addEventListener('click', function () { addCarry(-CFG.CARRY_UNIT); });
    UI.$('carryPlus').addEventListener('click', function () { addCarry(CFG.CARRY_UNIT); });
    UI.$('carryAll').addEventListener('click', function () {
      carry = maxCarry();
      persistLoadout();
      refresh();
    });
    UI.$('contractReroll').addEventListener('click', function () { Contracts.reroll(); });
    UI.$('archiveWipe').addEventListener('click', onWipe);
    window.addEventListener('pointermove', onChipDragMove, { passive: false });
    window.addEventListener('pointerup', onChipDragUp);
    window.addEventListener('pointercancel', onChipDragUp);
    window.addEventListener('keydown', function (e) {
      if (el.root.classList.contains('hidden')) return;
      if (e.code === 'Enter') { e.preventDefault(); launch(); }
      if (e.code === 'Escape' && tab !== 'home') setTab('home');
    });
  }

  /* ---------------- 地图 ---------------- */
  function refreshMapPick() {
    if (!el.mapPick || typeof MAPSTORE === 'undefined') return;
    const maps = MAPSTORE.list();
    const qsMap = (typeof QS !== 'undefined') ? QS.get('map') : '';
    const stored = MAPSTORE.picked();
    const current = mapPickTouched && el.mapPick.value ? el.mapPick.value : '';
    const wanted = current || qsMap || stored;
    el.mapPick.innerHTML = '';
    const random = UI.el('option');
    random.value = 'random';
    random.textContent = '程序化随机设施';
    el.mapPick.appendChild(random);
    maps.forEach(function (m) {
      const o = UI.el('option');
      o.value = m.id;
      o.textContent = m.name + ' · ' + m.cols + '×' + m.rows;
      el.mapPick.appendChild(o);
    });
    const exists = maps.some(function (m) { return m.id === wanted; });
    el.mapPick.value = exists ? wanted : 'random';
    if (exists) MAPSTORE.setPicked(wanted);
    if (el.mapCount) el.mapCount.textContent = maps.length + ' 张自定义';
    updateMapHint();
  }

  function updateMapHint() {
    if (!el.mapHint || !el.mapPick) return;
    if (el.mapPick.value === 'random') {
      el.mapHint.textContent = '程序化随机设施 · 每局重新生成';
      return;
    }
    const m = (typeof MAPSTORE !== 'undefined') ? MAPSTORE.get(el.mapPick.value) : null;
    if (!m) {
      el.mapHint.textContent = '地图不存在，将回退到随机设施';
      return;
    }
    const v = MAPSTORE.validate(m);
    el.mapHint.textContent = m.name + ' · ' + m.cols + '×' + m.rows +
      (v.errors.length ? ' · ' + v.errors.length + ' 处错误' : ' · 校验通过');
  }

  /* ---------------- 状态 ---------------- */
  function setTab(name) {
    if (name === 'loadout') name = 'home';
    tab = name;
    el.root.classList.toggle('pane-mode', name !== 'home');
    const books = el.tabs.children;
    for (let i = 0; i < books.length; i++) {
      books[i].classList.toggle('on', books[i].dataset.tab === name);
    }
    const panes = el.root.querySelectorAll('.tab-pane');
    for (let i = 0; i < panes.length; i++) {
      panes[i].classList.toggle('on', name !== 'home' && panes[i].id === 'pane' + name.charAt(0).toUpperCase() + name.slice(1));
    }
    if (name !== 'stash') { chipPicker = -1; weaponPicker = -1; }
    gadgetPick = -1;
    if (name === 'stash') Stash.refresh();
    if (name === 'craft') ChipShop.refresh();
    if (name === 'shop') Shop.refresh();
    if (name === 'contracts') Contracts.refresh();
    if (name === 'archive') renderArchive();
    refresh();
  }

  function equipped() { return Store.loadout().weapons; }

  function magsCost() {
    const list = equipped();
    let sum = 0;
    for (let i = 0; i < 2; i++) {
      const item = list[i];
      if (!item) continue;
      const w = WEAPONS[item.weaponId];
      if (w) sum += (mags[i] || 0) * w.cost;
    }
    return sum;
  }

  function maxCarry() {
    const left = Store.bank() - magsCost();
    return Math.max(0, Math.floor(left / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
  }

  function addCarry(d) {
    carry = clamp(carry + d, 0, maxCarry());
    persistLoadout();
    refresh();
  }

  function totalCost() { return magsCost() + carry; }

  function persistLoadout() {
    const lo = Store.loadout();
    Store.setLoadout({ weapons: lo.weapons, mags: mags, carry: carry, gadgets: lo.gadgets });
  }

  function setMag(slot, d) {
    const lo = Store.loadout();
    if (!lo.weapons[slot]) return;
    mags[slot] = clamp((mags[slot] || 0) + d, 0, CFG.CARRY_MAX_MAGS);
    persistLoadout();
    refresh();
  }

  function refreshBank() {
    if (!el.bank) return;
    el.bank.textContent = UI.fmt(Store.bank());
    el.best.textContent = UI.fmt(Store.best());
    if (tab === 'stash') Stash.refresh();
    if (tab === 'craft') ChipShop.refresh();
    if (tab === 'shop') Shop.refresh();
    if (tab === 'contracts') Contracts.refresh();
    refresh();
  }

  /* ---------------- 渲染 ---------------- */
  function refresh() {
    if (!el.root) return;
    const bank = Store.bank();
    const lo = Store.loadout();
    const list = lo.weapons;
    const count = list.filter(Boolean).length;

    el.bank.textContent = UI.fmt(bank);
    el.best.textContent = UI.fmt(Store.best());
    el.pick.textContent = count + ' / 2';
    el.charName.textContent = CHARS[character] ? CHARS[character].name : '潜行者';

    for (let i = 0; i < el.chars.children.length; i++) {
      el.chars.children[i].classList.toggle('on', i === character);
    }

    renderLoadout(list);
    renderSummary(list);

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

    renderGadgets();

    el.start.classList.toggle('dis', cost > bank);

    let warn = '';
    if (count === 0) warn = '未携带武器 · 空手入局后可搜刮武器并当场装备';
    else if (magCost > bank) warn = '数据不足，减少弹夹配给';
    else if (carry > 0 && carry > maxCarry()) warn = '携带数据超出可用额度';
    else if (count > 0 && list.every(function (it, k) { return !it || !(mags[k] || 0); })) warn = '未配给弹夹：进局后需用数据压装';
    else if (carry === 0) warn = '未携带数据：局内需先搜刮分解';
    el.warn.textContent = warn;
  }

  function renderLoadout(list) {
    if (!el.load) return;
    el.load.innerHTML = '';
    for (let slot = 0; slot < 2; slot++) {
      const item = list[slot];
      const row = UI.el('div', 'load-row' + (item ? '' : ' empty'));
      row.dataset.eqSlot = slot;
      if (!item) {
        row.innerHTML =
          '<div class="lr-empty-slot">' +
            '<span>空配装槽</span>' +
            '<em>点击从仓库选择武器</em>' +
          '</div>';
        row.addEventListener('click', function () {
          weaponPicker = weaponPicker === slot ? -1 : slot;
          chipPicker = -1;
          refresh();
        });
      } else {
        const wi = item.weaponId;
        const w = WEAPONS[wi];
        const n = mags[slot] || 0;
        const chips = Store.weaponChips(slot);
        row.style.setProperty('--wc', w.color);
        row.innerHTML =
          '<div class="lr-body">' +
            '<div class="lr-art">' + (typeof WeaponView !== 'undefined' ? WeaponView.svg(wi) : '') + '</div>' +
            '<div class="lr-content">' +
              '<div class="lr-main">' +
                '<span class="lr-tag">' + w.tag + '</span>' +
                '<span class="lr-name">' + w.name + '</span>' +
                '<button class="lr-unequip" data-unequip>卸下</button>' +
                '<button class="lr-btn" data-a="-">−</button>' +
                '<span class="lr-num">' + n + '</span>' +
                '<button class="lr-btn" data-a="+">+</button>' +
                '<span class="lr-cost">' + (n * w.cost) + ' NB</span>' +
              '</div>' +
              '<div class="lr-chips">' +
                '<span class="lr-chiplabel">芯片</span>' +
                chipSlotsHtml(chips) +
                '<span class="lr-modtext">' + Store.modsSummary(slot) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>';
        if (typeof ItemTip !== 'undefined') {
          ItemTip.bind(row, item, { touch: false, showElements: true });
        }
        row.querySelector('[data-unequip]').addEventListener('click', function (e) {
          e.stopPropagation();
          unequipWeapon(slot);
        });
        row.addEventListener('pointerdown', function (e) {
          if (e.target.closest('button')) return;
          if (typeof WeaponDrag === 'undefined') return;
          WeaponDrag.start(e, {
            weaponId: wi,
            name: w.name,
            color: w.color,
            onDrop: function (x, y) {
              const grid = document.getElementById('stashGrid');
              if (!grid) return;
              const r = grid.getBoundingClientRect();
              if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) unequipWeapon(slot);
            }
          });
        });
        row.querySelector('[data-a="-"]').addEventListener('click', function () { setMag(slot, -1); });
        row.querySelector('[data-a="+"]').addEventListener('click', function () { setMag(slot, 1); });
        const slotBtns = row.querySelectorAll('[data-chip-slot]');
        for (let b = 0; b < slotBtns.length; b++) {
          (function (btn) {
            const ci = parseInt(btn.getAttribute('data-chip-slot'), 10);
            if (chips[ci] && typeof ItemTip !== 'undefined') {
              ItemTip.bind(btn, ITEMS.makeChipItem(chips[ci]), { touch: false, showElements: true });
            }
            btn.addEventListener('pointerdown', function (e) {
              if (!chips[ci] || (e.pointerType === 'mouse' && e.button !== 0)) return;
              chipDrag = {
                wslot: slot, ci: ci, entry: chips[ci],
                id: e.pointerId, sx: e.clientX, sy: e.clientY,
                moved: false
              };
            });
            btn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (performance.now() - chipDragMovedAt < 260) {
                e.preventDefault();
                return;
              }
              if (chips[ci]) removeLobbyChip(slot, ci);
              else {
                chipPicker = chipPicker === slot ? -1 : slot;
                weaponPicker = -1;
                refresh();
              }
            });
          })(slotBtns[b]);
        }
      }
      el.load.appendChild(row);
      if (weaponPicker === slot) el.load.appendChild(buildWeaponPicker(slot));
      if (item && chipPicker === slot) el.load.appendChild(buildChipPicker(slot));
    }
  }

  function renderSummary(list) {
    if (!el.summary) return;
    let html = '';
    for (let slot = 0; slot < 2; slot++) {
      const item = list[slot];
      if (!item) {
        html += '<div class="summary-row empty"><span class="sr-slot">' + (slot + 1) + '</span><span class="sr-w">空配装槽</span></div>';
        continue;
      }
      const w = WEAPONS[item.weaponId];
      const chips = Store.weaponChips(slot);
      html += '<div class="summary-row" style="--wc:' + w.color + '">' +
        '<span class="sr-slot">' + (slot + 1) + '</span>' +
        '<span class="sr-art">' + (typeof WeaponView !== 'undefined' ? WeaponView.svg(item.weaponId) : '') + '</span>' +
        '<span class="sr-w">' + w.name + '</span>' +
        '<span class="sr-c">芯 ' + chips.length + '/3</span>' +
      '</div>';
    }
    el.summary.innerHTML = html;
  }

  /* ---------------- 战术道具配置 ---------------- */
  const GADGET_KEYS = ['Q', 'E'];

  function renderGadgets() {
    if (!el.gadgets) return;
    const list = Store.loadout().gadgets || [null, null];
    el.gadgets.innerHTML = '';
    for (let slot = 0; slot < 2; slot++) {
      const id = list[slot];
      const g = id ? GADGET_BY_ID[id] : null;
      const b = UI.el('button', 'gadget-config' + (g ? '' : ' empty') +
        (gadgetPick === slot ? ' picking' : ''));
      b.type = 'button';
      if (g) b.style.setProperty('--gc', g.color);
      b.innerHTML = g
        ? '<span class="gc-key">' + GADGET_KEYS[slot] + '</span>' +
          '<span class="gc-body">' +
            '<span class="gc-name">' + g.name + '</span>' +
            '<span class="gc-meta">' + g.tag + ' · ' + g.cost + ' NB · 冷却 ' + g.cooldown + 's</span>' +
          '</span>'
        : '<span class="gc-key">' + GADGET_KEYS[slot] + '</span>' +
          '<span class="gc-body">' +
            '<span class="gc-name">空道具槽</span>' +
            '<span class="gc-meta">点击选择道具</span>' +
          '</span>';
      (function (s) {
        b.addEventListener('click', function () {
          gadgetPick = gadgetPick === s ? -1 : s;
          refresh();
        });
      })(slot);
      el.gadgets.appendChild(b);
    }
    if (gadgetPick >= 0) el.gadgets.appendChild(buildGadgetPicker(gadgetPick));
  }

  function buildGadgetPicker(slot) {
    const box = UI.el('div', 'gadget-picker');
    const cur = (Store.loadout().gadgets || [])[slot] || null;
    box.appendChild(UI.el('div', 'gp-head', '选择 ' + GADGET_KEYS[slot] + ' 槽道具'));
    GADGETS.forEach(function (g) {
      const b = UI.el('button', 'gadget-pick' + (cur === g.id ? ' on' : ''));
      b.type = 'button';
      b.style.setProperty('--gc', g.color);
      b.innerHTML =
        '<i></i>' +
        '<span class="gp-name">' + g.name + '</span>' +
        '<span class="gp-meta">' + g.tag + ' · 使用 ' + g.cost + ' NB · 冷却 ' + g.cooldown + 's</span>' +
        '<span class="gp-desc">' + g.desc + '</span>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        assignGadget(slot, g.id);
      });
      box.appendChild(b);
    });
    const none = UI.el('button', 'gadget-pick none' + (cur ? '' : ' on'), '不携带道具');
    none.type = 'button';
    none.addEventListener('click', function (e) {
      e.stopPropagation();
      assignGadget(slot, null);
    });
    box.appendChild(none);
    return box;
  }

  function assignGadget(slot, id) {
    const next = (Store.loadout().gadgets || [null, null]).slice();
    if (id) {
      /* 同一种道具只能占一个槽：配置到新槽时清掉旧槽 */
      for (let i = 0; i < 2; i++) {
        if (i !== slot && next[i] === id) next[i] = null;
      }
    }
    next[slot] = id || null;
    Store.setGadgets(next);
    gadgetPick = -1;
    refresh();
    if (id && GADGET_BY_ID[id]) {
      msg(GADGET_BY_ID[id].name + ' 已配置到 ' + GADGET_KEYS[slot] + ' 槽');
    } else {
      msg(GADGET_KEYS[slot] + ' 槽已清空');
    }
  }

  function chipSlotsHtml(chips) {
    let out = '';
    for (let i = 0; i < 3; i++) {
      const c = chips[i];
      const def = c ? CHIP_BY_ID[c.chipId] : null;
      out += '<button type="button" class="lchip' + (def ? ' on' : '') + '"' +
        ' data-chip-slot="' + i + '">' +
        (def ? UI.chipTile(c) : '+') +
        '</button>';
    }
    return out;
  }

  function buildWeaponPicker(slot) {
    const box = UI.el('div', 'chip-picker weapon-picker');
    const list = Store.stash().filter(function (it) {
      return it.kind === 'weapon';
    });
    if (!list.length) {
      box.innerHTML = '<div class="cp-head">选择仓库武器</div>' +
        '<div class="cp-empty">仓库里没有可装备的武器 · 可在制造页制造或进局搜刮</div>';
      return box;
    }
    box.appendChild(UI.el('div', 'cp-head', '选择仓库武器 · 放入配装槽 ' + (slot + 1)));
    list.forEach(function (it) {
      const w = WEAPONS[it.weaponId] || { name: it.name, tag: '武器', color: '#9aa4ad' };
      const b = UI.el('button', 'cp-item weapon-pick');
      b.style.setProperty('--cc', w.color);
      b.innerHTML =
        '<span class="cp-weapon-art">' + (typeof WeaponView !== 'undefined' ? WeaponView.svg(it.weaponId) : '') + '</span>' +
        '<span class="cp-name">' + w.name + '</span>' +
        '<span class="cp-desc">' + w.tag + ' · 芯片 ' + ((it.chips || []).length) + '/3</span>' +
        '<span class="cp-val">' + it.value + ' NB</span>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const r = Store.equipWeapon(slot, it);
        if (!r.ok) { msg(r.msg); return; }
        mags[slot] = 0;
        persistLoadout();
        weaponPicker = -1;
        refresh();
        Stash.refresh();
        msg(r.msg);
      });
      box.appendChild(b);
    });
    return box;
  }

  function buildChipPicker(loadoutSlot) {
    const box = UI.el('div', 'chip-picker');
    const eq = Store.loadout().weapons[loadoutSlot];
    const wi = eq ? eq.weaponId : -1;
    const tag = WEAPONS[wi] ? WEAPONS[wi].tag : '';
    const chips = Store.stash().filter(function (it) {
      return it.kind === 'chip' && ITEMS.chipFitsWeapon(it, wi);
    });
    if (!chips.length) {
      box.innerHTML = '<div class="cp-head">选择芯片 · ' + tag + '可用</div>' +
        '<div class="cp-empty">仓库里没有可用于「' + tag + '」武器的芯片</div>';
      return box;
    }
    box.appendChild(UI.el('div', 'cp-head', '选择芯片 · ' + tag + '可用'));
    chips.forEach(function (it) {
      const def = CHIP_BY_ID[it.chipId] || { name: '芯片', desc: '', color: '#9aa4ad' };
      const tier = ITEMS.tier(it.tierId);
      const b = UI.el('button', 'cp-item');
      b.style.setProperty('--cc', def.color);
      b.style.setProperty('--qc', tier.color);
      b.innerHTML =
        '<i></i>' +
        '<span class="cp-name">' + def.name + '</span>' +
        '<span class="cp-desc"><b style="color:' + tier.color + '">' + tier.name + '</b> · ' + def.desc + '</span>' +
        '<span class="cp-val">' + it.value + ' NB</span>';
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const r = Store.installChip(loadoutSlot, it);
        chipPicker = -1;
        msg(r.msg || (r.ok ? '芯片已装入' : '无法装入'));
        refresh();
        Stash.refresh();
      });
      box.appendChild(b);
    });
    return box;
  }

  function removeLobbyChip(loadoutSlot, chipSlot) {
    const r = Store.uninstallChip(loadoutSlot, chipSlot);
    chipPicker = -1;
    msg(r.msg || (r.ok ? '芯片已卸下' : '无法卸下'));
    refresh();
    Stash.refresh();
  }

  function makeChipDragGhost(entry) {
    if (chipGhost) return;
    const def = (typeof CHIP_BY_ID !== 'undefined' && CHIP_BY_ID[entry.chipId])
      ? CHIP_BY_ID[entry.chipId] : { name: '芯片', color: '#9aa4ad' };
    const it = (typeof ITEMS !== 'undefined') ? ITEMS.makeChipItem(entry) : null;
    chipGhost = UI.el('div', 'stash-drag-ghost');
    chipGhost.style.width = '36px';
    chipGhost.style.height = '36px';
    chipGhost.style.padding = '3px';
    chipGhost.style.setProperty('--qc', it ? ITEMS.colorOf(it) : def.color);
    chipGhost.style.setProperty('--cc', def.color);
    chipGhost.innerHTML = '<span class="gem"></span><span class="nm">' + UI.esc(def.name) + '</span>';
    document.body.appendChild(chipGhost);
  }

  function removeChipDragGhost() {
    if (chipGhost) chipGhost.remove();
    chipGhost = null;
  }

  function onChipDragMove(e) {
    if (!chipDrag || e.pointerId !== chipDrag.id) return;
    if (!chipDrag.moved &&
        Math.abs(e.clientX - chipDrag.sx) + Math.abs(e.clientY - chipDrag.sy) > 4) {
      chipDrag.moved = true;
      makeChipDragGhost(chipDrag.entry);
    }
    if (!chipDrag.moved) return;
    e.preventDefault();
    if (chipGhost) {
      chipGhost.style.left = (e.clientX - 18) + 'px';
      chipGhost.style.top = (e.clientY - 18) + 'px';
    }
  }

  function onChipDragUp(e) {
    if (!chipDrag || (e && e.pointerId !== undefined && e.pointerId !== chipDrag.id)) return;
    const d = chipDrag;
    chipDrag = null;
    removeChipDragGhost();
    if (!d.moved) return;
    chipDragMovedAt = performance.now();
    if (!e || e.type === 'pointercancel') return;
    const load = UI.$('lobbyLoad');
    const r = load ? load.getBoundingClientRect() : null;
    const inside = r && e.clientX >= r.left && e.clientX <= r.right &&
      e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) removeLobbyChip(d.wslot, d.ci);
  }

  function unequipWeapon(slot) {
    const r = Store.unequipWeapon(slot);
    msg(r.msg || (r.ok ? '武器已卸下' : '无法卸下'));
    if (r.ok) {
      mags[slot] = 0;
      persistLoadout();
    }
    refresh();
    Stash.refresh();
  }

  function msg(text) {
    if (el.msg) el.msg.textContent = text;
    if (el.mainMsg) el.mainMsg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () {
      if (el.msg) el.msg.textContent = '';
      if (el.mainMsg) el.mainMsg.textContent = '';
    }, 2200);
  }

  /* ---------------- 出击 ---------------- */
  function launch() {
    if (G.mode !== 'lobby') return;
    if (tab !== 'home') { setTab('home'); return; }
    const cost = totalCost();
    if (cost > Store.bank()) { msg('数据不足，无法配给'); return; }
    persistLoadout();
    if (typeof MOBILE !== 'undefined' && location.search.indexOf('selftest=1') < 0) MOBILE.enterGame();
    if (!Store.spend(cost)) { msg('数据不足，无法配给'); return; }
    Store.setChar(character);
    Store.save();

    const mapId = (el.mapPick && el.mapPick.value !== 'random') ? el.mapPick.value : '';
    el.root.classList.add('hidden');
    G.beginMission({
      data: carry,
      character: character,
      mapId: mapId || undefined
    });
  }

  function show() {
    el.root.classList.remove('hidden');
    reloadFromSave();
    refreshMapPick();
    setTab('home');
  }

  function reloadFromSave() {
    const lo = Store.loadout();
    mags = [lo.mags[0] | 0, lo.mags[1] | 0];
    carry = lo.carry;
    character = Store.char();
    chipPicker = -1;
    weaponPicker = -1;
    gadgetPick = -1;
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

    const loadBox = UI.$('arcLoadout');
    if (loadBox) {
      loadBox.innerHTML = '';
      const lo = Store.loadout();
      for (let i = 0; i < 2; i++) {
        const item = lo.weapons[i];
        const w = item ? WEAPONS[item.weaponId] : null;
        const row = UI.el('div', 'ar-row');
        row.innerHTML = w
          ? '<span>' + w.name + '</span><b>' + lo.mags[i] + ' 夹 · ' + w.cost + ' NB/夹</b>'
          : '<span>空配装槽</span><b>—</b>';
        loadBox.appendChild(row);
      }
      const carryRow = UI.el('div', 'ar-row');
      carryRow.innerHTML = '<span>携带数据</span><b>' + UI.fmt(lo.carry) + ' NB</b>';
      loadBox.appendChild(carryRow);
    }

    const kitBox = UI.$('arcKit');
    if (kitBox) {
      const list = Store.loadout().gadgets || [null, null];
      kitBox.innerHTML = [0, 1].map(function (slot) {
        const g = list[slot] ? GADGET_BY_ID[list[slot]] : null;
        return '<span>' + GADGET_KEYS[slot] + ' <b>' + (g ? g.name : '空') + '</b></span>';
      }).join('');
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

    const camBox = UI.$('arcCam');
    if (camBox) {
      camBox.innerHTML = '';
      [55, 62, 70, 80, 90].forEach(function (p) {
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
    get picked() {
      return Store.loadout().weapons.map(function (it) { return it ? it.weaponId : -1; });
    }
  };
})();
