'use strict';

/* ============================================================
   军械库
   - 武器：查看详情、从仓库装备到两个配装槽、卸下
   - 芯片：查看详情、装入已装备武器、卸回仓库
   - 战术道具：查看详情，配置 Q / E 两个槽位
   ============================================================ */

const Armory = (function () {
  const el = {};
  let msgTimer = 0;

  function init() {
    el.root = UI.$('paneArmory');
    el.bank = UI.$('armoryBank');
    el.weaponCount = UI.$('armoryWeaponCount');
    el.chipCount = UI.$('armoryChipCount');
    el.slots = UI.$('armorySlots');
    el.weapons = UI.$('armoryWeapons');
    el.installed = UI.$('armoryInstalled');
    el.chips = UI.$('armoryChips');
    el.gadgets = UI.$('armoryGadgets');
    el.msg = UI.$('armoryMsg');
  }

  function msg(text, bad) {
    if (!el.msg) return;
    el.msg.textContent = text || '';
    el.msg.className = 'pane-msg' + (bad ? ' bad' : '');
    clearTimeout(msgTimer);
    if (text) {
      msgTimer = setTimeout(function () {
        el.msg.textContent = '';
        el.msg.className = 'pane-msg';
      }, 2200);
    }
  }

  function addButton(parent, text, cls, onClick, disabled) {
    const b = UI.el('button', 'ac-btn' + (cls ? ' ' + cls : '') + (disabled ? ' dis' : ''));
    b.type = 'button';
    b.textContent = text;
    if (disabled) b.disabled = true;
    else b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  function weaponStats(w) {
    return '<span>弹夹 <b>' + w.mag + '</b></span>' +
      '<span>伤害 <b>' + w.dmg + '</b></span>' +
      '<span>射速 <b>' + (w.rate ? w.rate.toFixed(2) : '—') + '</b></span>' +
      '<span>换弹 <b>' + (w.reload ? w.reload.toFixed(1) : '—') + 's</b></span>' +
      '<span>射程 <b>' + w.range + 'm</b></span>';
  }

  function renderSlots() {
    if (!el.slots) return;
    el.slots.innerHTML = '';
    const lo = Store.loadout();
    for (let slot = 0; slot < 2; slot++) {
      const item = lo.weapons[slot];
      const row = UI.el('div', 'armory-slot' + (item ? '' : ' empty'));
      if (item) {
        const w = WEAPONS[item.weaponId];
        row.style.setProperty('--wc', w ? w.color : '#888');
        row.innerHTML =
          '<div class="as-art">' + (typeof WeaponView !== 'undefined' ? WeaponView.svg(item.weaponId) : '') + '</div>' +
          '<div class="as-name">' + UI.esc(w ? w.name : '未知武器') + '</div>' +
          '<div class="as-meta">' + (w ? w.tag : '') + ' · 芯片 ' + ((item.chips || []).length) + '/3 · 价值 ' + UI.fmt(item.value || 0) + ' NB</div>';
        addButton(row, '卸下', '', function () {
          const r = Store.unequipWeapon(slot);
          msg(r.msg, !r.ok);
          if (r.ok) refresh();
        });
      } else {
        row.innerHTML =
          '<div class="as-art"></div>' +
          '<div class="as-name">空配装槽 ' + (slot + 1) + '</div>' +
          '<div class="as-meta">从下方仓库武器中装备</div>';
      }
      el.slots.appendChild(row);
    }
  }

  function renderWeapons() {
    if (!el.weapons) return;
    el.weapons.innerHTML = '';
    const lo = Store.loadout();
    const list = Store.stash().filter(function (it) { return it.kind === 'weapon'; });
    if (!list.length) {
      el.weapons.innerHTML = '<div class="armory-note">仓库里没有武器。可在制造台制造，或从战局中带出。</div>';
      return;
    }
    list.forEach(function (item) {
      const w = WEAPONS[item.weaponId];
      if (!w) return;
      const tier = ITEMS.tier(item.tierId);
      const card = UI.el('div', 'armory-card');
      card.style.setProperty('--ac', w.color);
      card.innerHTML =
        '<div class="ac-head">' +
          '<span class="ac-name">' + UI.esc(w.name) + '</span>' +
          '<span class="ac-tag" style="color:' + tier.color + '">' + tier.name + ' · ' + w.tag + '</span>' +
        '</div>' +
        '<div class="ac-art">' + (typeof WeaponView !== 'undefined' ? WeaponView.svg(item.weaponId) : '') + '</div>' +
        '<div class="ac-stats">' + weaponStats(w) + '</div>' +
        '<div class="ac-desc">' + UI.esc(w.desc) + ' · 已装芯片 ' + ((item.chips || []).length) + '/3</div>' +
        '<div class="ac-foot"><span class="ac-price">' + UI.fmt(item.value || 0) + ' NB</span></div>';
      const foot = card.querySelector('.ac-foot');
      for (let slot = 0; slot < 2; slot++) {
        const occupied = !!lo.weapons[slot];
        addButton(foot, occupied ? '替换 ' + (slot + 1) : '装备 ' + (slot + 1), slot === 0 ? '' : 'ice', function () {
          equipTo(slot, item);
        }, false);
      }
      el.weapons.appendChild(card);
    });
  }

  function equipTo(slot, item) {
    const lo = Store.loadout();
    if (lo.weapons[slot]) {
      const u = Store.unequipWeapon(slot);
      if (!u.ok) { msg(u.msg, true); return; }
    }
    const r = Store.equipWeapon(slot, item);
    msg(r.msg, !r.ok);
    if (r.ok) refresh();
  }

  function renderInstalled() {
    if (!el.installed) return;
    el.installed.innerHTML = '';
    const lo = Store.loadout();
    let any = false;
    for (let slot = 0; slot < 2; slot++) {
      const eq = lo.weapons[slot];
      if (!eq) continue;
      any = true;
      const w = WEAPONS[eq.weaponId];
      const box = UI.el('div', 'installed-weapon');
      box.style.setProperty('--wc', w ? w.color : '#888');
      const head = UI.el('div', 'iw-head');
      head.innerHTML = '<span class="iw-name">槽 ' + (slot + 1) + ' · ' + UI.esc(w ? w.name : '武器') + '</span>' +
        '<span class="iw-tag">芯片 ' + ((eq.chips || []).length) + '/3</span>';
      box.appendChild(head);
      const row = UI.el('div', 'chip-slot-row');
      for (let k = 0; k < 3; k++) {
        const entry = (eq.chips || [])[k];
        const def = entry ? CHIP_BY_ID[entry.chipId] : null;
        const b = UI.el('button', 'chip-slot' + (def ? ' on' : ''));
        b.type = 'button';
        if (def) {
          b.style.setProperty('--cc', def.color);
          b.textContent = def.name;
          b.title = def.desc + ' · 点击卸回仓库';
          b.addEventListener('click', function () {
            const r = Store.uninstallChip(slot, k);
            msg(r.msg, !r.ok);
            if (r.ok) refresh();
          });
        } else {
          b.textContent = '空槽 ' + (k + 1);
          b.disabled = true;
        }
        row.appendChild(b);
      }
      box.appendChild(row);
      el.installed.appendChild(box);
    }
    if (!any) {
      el.installed.innerHTML = '<div class="armory-note">先装备武器，才能安装芯片。</div>';
    }
  }

  function renderChips() {
    if (!el.chips) return;
    el.chips.innerHTML = '';
    const lo = Store.loadout();
    const list = Store.stash().filter(function (it) { return it.kind === 'chip'; });
    if (!list.length) {
      el.chips.innerHTML = '<div class="armory-note">仓库里没有芯片。可在制造台制造，或从战利品中获取。</div>';
      return;
    }
    list.forEach(function (item) {
      const def = CHIP_BY_ID[item.chipId];
      if (!def) return;
      const tier = ITEMS.tier(item.tierId);
      const card = UI.el('div', 'armory-card');
      card.style.setProperty('--ac', def.color);
      const restriction = def.forTag ? def.forTag + '专属' : '通用';
      card.innerHTML =
        '<div class="ac-head">' +
          '<span class="ac-name">' + UI.esc(def.name) + '</span>' +
          '<span class="ac-tag" style="color:' + tier.color + '">' + tier.name + ' · ' + restriction + '</span>' +
        '</div>' +
        '<div class="ac-desc">' + UI.esc(def.desc) + '</div>' +
        '<div class="ac-stats"><span>价值 <b>' + UI.fmt(item.value || def.value || 0) + ' NB</b></span><span>1×1</span></div>' +
        '<div class="ac-foot"><span class="ac-price">' + (def.forTag ? '仅限 ' + def.forTag : '任意武器') + '</span></div>';
      const foot = card.querySelector('.ac-foot');
      for (let slot = 0; slot < 2; slot++) {
        const eq = lo.weapons[slot];
        const fits = !!eq && ITEMS.chipFitsWeapon(item, eq.weaponId) && (eq.chips || []).length < 3;
        addButton(foot, '装入 ' + (slot + 1), slot === 0 ? '' : 'ice', function () {
          const r = Store.installChip(slot, item);
          msg(r.msg, !r.ok);
          if (r.ok) refresh();
        }, !fits);
      }
      el.chips.appendChild(card);
    });
  }

  function setGadget(slot, id) {
    const cur = Store.loadout().gadgets || [];
    const next = [cur[0] || null, cur[1] || null];
    const other = slot === 0 ? 1 : 0;
    if (next[other] === id) next[other] = null;
    next[slot] = id;
    Store.setGadgets(next);
    msg('战术道具已配置');
    refresh();
  }

  function clearGadget(slot) {
    const cur = Store.loadout().gadgets || [];
    const next = [cur[0] || null, cur[1] || null];
    if (!next[slot]) return;
    next[slot] = null;
    Store.setGadgets(next);
    msg('已清空道具槽');
    refresh();
  }

  function renderGadgets() {
    if (!el.gadgets) return;
    el.gadgets.innerHTML = '';
    const cur = Store.loadout().gadgets || [];
    const head = UI.el('div', 'armory-note');
    head.innerHTML = '当前：<b style="color:var(--amber)">Q</b> ' +
      UI.esc((GADGET_BY_ID[cur[0]] || {}).name || '空') + ' · ' +
      '<b style="color:var(--ice)">E</b> ' +
      UI.esc((GADGET_BY_ID[cur[1]] || {}).name || '空');
    el.gadgets.appendChild(head);
    for (let i = 0; i < GADGETS.length; i++) {
      const g = GADGETS[i];
      const card = UI.el('div', 'armory-gadget');
      card.style.setProperty('--gc', g.color);
      const facts = ['消耗 ' + g.cost + ' NB', '冷却 ' + g.cooldown + 's'];
      if (g.damage) facts.push('伤害 ' + g.damage);
      if (g.radius) facts.push('半径 ' + g.radius + 'm');
      card.innerHTML =
        '<div class="ag-head"><span class="ag-name">' + UI.esc(g.name) + '</span><span class="ag-tag">' + g.tag + '</span></div>' +
        '<div class="ag-desc">' + UI.esc(g.desc) + '</div>' +
        '<div class="ag-foot"><span class="ag-cost">' + facts.join(' · ') + '</span></div>';
      const foot = card.querySelector('.ag-foot');
      for (let slot = 0; slot < 2; slot++) {
        const b = UI.el('button', 'ag-btn' + (cur[slot] === g.id ? ' on' : ''));
        b.type = 'button';
        b.textContent = slot === 0 ? 'Q' : 'E';
        b.title = '配置到 ' + (slot === 0 ? 'Q' : 'E') + ' 槽';
        b.addEventListener('click', function () {
          if (cur[slot] === g.id) clearGadget(slot);
          else setGadget(slot, g.id);
        });
        foot.appendChild(b);
      }
      el.gadgets.appendChild(card);
    }
  }

  function refresh() {
    if (!el.root) return;
    const all = Store.stash();
    let weapons = 0, chips = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i].kind === 'weapon') weapons++;
      else if (all[i].kind === 'chip') chips++;
    }
    if (el.bank) el.bank.textContent = UI.fmt(Store.bank());
    if (el.weaponCount) el.weaponCount.textContent = weapons;
    if (el.chipCount) el.chipCount.textContent = chips;
    renderSlots();
    renderWeapons();
    renderInstalled();
    renderChips();
    renderGadgets();
  }

  return { init: init, refresh: refresh };
})();
