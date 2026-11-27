'use strict';

/* ============================================================
   制造工坊（大厅内页）
   - 用账户数据制造武器与芯片，成品直接进仓库
   - 武器成品为 3×1 收集物，芯片固定 1×1
   ============================================================ */

const ChipShop = (function () {
  const el = {};
  let msgTimer = 0;

  function init() {
    el.root = UI.$('paneCraft');
    el.bank = UI.$('craftBank');
    el.owned = UI.$('craftOwned');
    el.elements = UI.$('craftElements');
    el.weapons = UI.$('craftWeapons');
    el.generic = UI.$('craftGeneric');
    el.series = UI.$('craftSeries');
    el.msg = UI.$('craftMsg');
  }

  function weaponCard(wi) {
    const w = WEAPONS[wi];
    const bank = Store.bank();
    const price = w.craft || 0;
    const elemCost = ITEMS.elementsForWeapon(wi);
    const elemText = ITEMS.elementSummary(elemCost);
    const elemPoor = !Store.canAffordElements(elemCost);
    const poor = bank < price || elemPoor;
    let owned = 0;
    const stash = Store.stash();
    for (let i = 0; i < stash.length; i++) {
      if (stash[i].kind === 'weapon' && stash[i].weaponId === wi) owned++;
    }
    const row = UI.el('div', 'shop-card weapon-craft' + (poor ? ' dis' : ''));
    row.style.setProperty('--sc', w.color);
    row.innerHTML =
      '<div class="craft-weapon-art">' +
        (typeof WeaponView !== 'undefined' ? WeaponView.svg(wi) : '') +
      '</div>' +
      '<div class="sc-head">' +
        '<span class="sc-name">' + w.name + '</span>' +
        '<span class="sc-tag">' + w.tag + ' · 3×1</span>' +
      '</div>' +
      '<div class="sc-desc">' + w.desc + '</div>' +
      '<div class="chip-facts">' +
        '<span>弹夹 <b>' + w.mag + '</b> 发</span>' +
        '<span>基础伤害 <b>' + w.dmg + '</b></span>' +
        '<span>仓库 <b>' + owned + '</b> 把</span>' +
        '<span>数据价值 <b>' + w.value + ' NB</b></span>' +
        '<span>元素消耗 <b' + (elemPoor ? ' class="bad"' : '') + '>' + (elemText || '无') + '</b></span>' +
      '</div>' +
      '<div class="sc-foot">' +
        '<span class="sc-price">' + price + ' <em>NB</em></span>' +
        '<button class="btn-mini">' + (bank < price ? '数据不足' : (elemPoor ? '元素不足' : '制造')) + '</button>' +
      '</div>';
    const btn = row.querySelector('button');
    if (poor) btn.disabled = true;
    btn.addEventListener('click', function () { craftWeapon(wi); });
    return row;
  }

  function chipCard(def) {
    const bank = Store.bank();
    const price = def.price || 0;
    const elemCost = ITEMS.elementsForChip(def.id);
    const elemText = ITEMS.elementSummary(elemCost);
    const elemPoor = !Store.canAffordElements(elemCost);
    const poor = bank < price || elemPoor;
    let owned = 0;
    const stash = Store.stash();
    for (let i = 0; i < stash.length; i++) {
      if (stash[i].kind === 'chip' && stash[i].chipId === def.id) owned++;
    }

    const row = UI.el('div', 'shop-card chip-card' + (poor ? ' dis' : ''));
    const tier = TIER_BY_ID[def.tierId] || TIERS[0];
    row.style.setProperty('--sc', tier.color);
    row.innerHTML =
      '<div class="sc-head">' +
        '<span class="sc-name"><i class="chip-type-dot" style="--cc:' + def.color + '"></i>' + def.name + '</span>' +
        '<span class="sc-tag">' + tier.name + ' · ' + (def.forTag ? def.forTag + '专属' : '通用') + '</span>' +
      '</div>' +
      '<div class="sc-desc">' + def.desc + '</div>' +
      '<div class="chip-facts">' +
        '<span>数据价值 <b>' + def.value + ' NB</b></span>' +
        '<span>仓库 <b>' + owned + '</b> 块</span>' +
        '<span>分解可得 <b>' + def.value + ' NB</b></span>' +
        (elemText ? '<span>元素消耗 <b' + (elemPoor ? ' class="bad"' : '') + '>' + elemText + '</b></span>' : '') +
      '</div>' +
      '<div class="sc-foot">' +
        '<span class="sc-price">' + price + ' <em>NB</em></span>' +
        '<button class="btn-mini">' + (bank < price ? '数据不足' : (elemPoor ? '元素不足' : '制造')) + '</button>' +
      '</div>';

    const btn = row.querySelector('button');
    if (poor) btn.disabled = true;
    btn.addEventListener('click', function () { craft(def); });
    return row;
  }

  function renderGroup(box, defs) {
    if (!box) return;
    box.innerHTML = '';
    if (!defs.length) {
      box.innerHTML = '<div class="side-empty">暂无可制造芯片</div>';
      return;
    }
    for (let i = 0; i < defs.length; i++) box.appendChild(chipCard(defs[i]));
  }

  function render() {
    if (!el.root) return;
    const generic = [];
    const series = [];
    for (let i = 0; i < CHIP_TYPES.length; i++) {
      if (CHIP_TYPES[i].forTag) series.push(CHIP_TYPES[i]);
      else generic.push(CHIP_TYPES[i]);
    }
    let owned = 0;
    const stash = Store.stash();
    for (let i = 0; i < stash.length; i++) if (stash[i].kind === 'chip') owned++;

    if (el.bank) el.bank.textContent = UI.fmt(Store.bank());
    if (el.owned) el.owned.textContent = owned;
    if (el.elements) el.elements.innerHTML = UI.elementStrip(Store.elements());
    if (el.weapons) {
      el.weapons.innerHTML = '';
      for (let wi = 0; wi < WEAPONS.length; wi++) el.weapons.appendChild(weaponCard(wi));
    }
    renderGroup(el.generic, generic);
    renderGroup(el.series, series);
  }

  function craft(def) {
    const r = Store.craftChip(def.id);
    if (!r.ok) { msg(r.msg, true); return; }
    msg(r.msg);
    refresh();
    Lobby.refreshBank();
  }

  function craftWeapon(wi) {
    const r = Store.craftWeapon(wi);
    if (!r.ok) { msg(r.msg, true); return; }
    msg(r.msg);
    refresh();
    Lobby.refreshBank();
  }

  function msg(text, bad) {
    if (!el.msg) return;
    el.msg.textContent = text;
    el.msg.className = 'shop-msg' + (bad ? ' bad' : '');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () {
      el.msg.textContent = '';
      el.msg.className = 'shop-msg';
    }, 2200);
  }

  function refresh() { render(); }

  return { init: init, refresh: refresh };
})();
