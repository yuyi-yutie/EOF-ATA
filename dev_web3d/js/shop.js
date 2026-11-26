'use strict';

/* ============================================================
   补给站（大厅内页）
   - 战术道具：全部默认解锁，在机库配置；这里展示数据消耗 / 冷却
   - 永久强化：护盾、生命、背包、装填，用数据逐级解锁
   ============================================================ */

const Shop = (function () {
  const el = {};
  let msgTimer = 0;

  function init() {
    el.root = UI.$('paneShop');
    el.bank = UI.$('shopBank');
    el.supplies = UI.$('shopSupplies');
    el.augments = UI.$('shopAugments');
    el.msg = UI.$('shopMsg');
  }

  function renderGadgets() {
    el.supplies.innerHTML = '';
    for (let i = 0; i < GADGETS.length; i++) {
      const g = GADGETS[i];
      const row = UI.el('div', 'shop-card');
      row.style.setProperty('--sc', g.color);
      row.innerHTML =
        '<div class="sc-head">' +
          '<span class="sc-name">' + g.name + '</span>' +
          '<span class="sc-tag">' + g.tag + ' · 已解锁</span>' +
        '</div>' +
        '<div class="sc-desc">' + g.desc + '</div>' +
        '<div class="sc-foot">' +
          '<span class="sc-price">使用 ' + g.cost + ' <em>NB</em></span>' +
          '<span class="sc-cd">冷却 ' + g.cooldown + 's</span>' +
        '</div>';
      el.supplies.appendChild(row);
    }
  }

  function renderAugments() {
    const bank = Store.bank();
    el.augments.innerHTML = '';
    for (let i = 0; i < AUGMENTS.length; i++) {
      const a = AUGMENTS[i];
      const lv = Store.aug(a.id);
      const maxed = lv >= a.max;
      const cost = maxed ? 0 : a.costs[lv];
      const poor = !maxed && bank < cost;
      const row = UI.el('div', 'shop-card aug' + (maxed ? ' maxed' : '') + (poor ? ' dis' : ''));
      row.style.setProperty('--sc', a.color);
      let pips = '';
      for (let k = 0; k < a.max; k++) pips += '<i class="' + (k < lv ? 'on' : '') + '"></i>';
      row.innerHTML =
        '<div class="sc-head">' +
          '<span class="sc-name">' + a.name + '</span>' +
          '<span class="sc-tag">' + a.tag + ' · Lv.' + lv + '/' + a.max + '</span>' +
        '</div>' +
        '<div class="sc-desc">' + a.desc + ' <b>' + a.value(lv) + '</b></div>' +
        '<div class="sc-pips">' + pips + '</div>' +
        '<div class="sc-foot">' +
          '<span class="sc-price">' + (maxed ? 'MAX' : cost + ' <em>NB</em>') + '</span>' +
          '<button class="btn-mini">' + (maxed ? '已满级' : '强化') + '</button>' +
        '</div>';
      const btn = row.querySelector('button');
      if (maxed) btn.disabled = true;
      btn.addEventListener('click', function () { buyAugment(a); });
      el.augments.appendChild(row);
    }
  }

  function buyAugment(a) {
    const lv = Store.aug(a.id);
    const r = Store.buyAugment(a.id);
    if (!r.ok) { msg(r.msg, true); return; }
    msg(r.msg + ' · 数据 -' + a.costs[lv]);
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
    }, 1900);
  }

  function refresh() {
    if (!el.root) return;
    el.bank.textContent = UI.fmt(Store.bank());
    renderGadgets();
    renderAugments();
  }

  return { init: init, refresh: refresh };
})();
