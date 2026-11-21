'use strict';

/* ============================================================
   大厅：跨局数据账户 + 携带武器 / 初始弹夹配给
   ============================================================ */
const Bank = {
  KEY: 'eofata.bank',
  DEFAULT: 300,
  get() {
    try {
      const v = localStorage.getItem(this.KEY);
      if (v === null) return this.DEFAULT;
      const n = parseInt(v, 10);
      return isFinite(n) ? Math.max(0, n) : this.DEFAULT;
    } catch (e) { return this.DEFAULT; }
  },
  set(v) {
    try { localStorage.setItem(this.KEY, String(Math.max(0, Math.round(v)))); } catch (e) { /* ignore */ }
  }
};

const Lobby = (() => {
  const el = {};
  let picked = [];
  const mags = {};
  let carry = 0;
  let msgTimer = 0;

  function init() {
    el.root = document.getElementById('lobby');
    el.bank = document.getElementById('lobbyBank');
    el.best = document.getElementById('lobbyBest');
    el.pick = document.getElementById('lobbyPick');
    el.weapons = document.getElementById('lobbyWeapons');
    el.load = document.getElementById('lobbyLoad');
    el.cost = document.getElementById('lobbyCost');
    el.remain = document.getElementById('lobbyRemain');
    el.start = document.getElementById('lobbyStart');
    el.msg = document.getElementById('lobbyMsg');
    el.warn = document.getElementById('lobbyWarn');
    el.carry = document.getElementById('lobbyCarry');
    el.carryMax = document.getElementById('lobbyCarryMax');
    el.stashBtn = document.getElementById('lobbyStash');
    el.stashCount = document.getElementById('lobbyStashCount');
    el.stashValue = document.getElementById('lobbyStashValue');

    buildWeapons();
    el.start.addEventListener('click', start);
    document.getElementById('carryMinus').addEventListener('click', () => addCarry(-100));
    document.getElementById('carryPlus').addEventListener('click', () => addCarry(100));
    document.getElementById('carryAll').addEventListener('click', () => {
      carry = maxCarry();
      refresh();
    });
    el.stashBtn.addEventListener('click', () => Stash.show(true));

    refresh();
  }

  function buildWeapons() {
    el.weapons.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'wp-card';
      d.dataset.i = i;
      d.style.setProperty('--wc', w.color);
      d.innerHTML =
        '<span class="wp-tag">' + w.tag + '</span>' +
        '<span class="wp-name">' + w.name + '</span>' +
        '<span class="wp-stats">弹夹 ' + w.mag + ' · ' + w.cost + ' NB/夹</span>' +
        '<span class="wp-check">✓</span>';
      d.addEventListener('click', () => toggle(i));
      el.weapons.appendChild(d);
    });
  }

  function toggle(i) {
    const k = picked.indexOf(i);
    if (k >= 0) {
      picked.splice(k, 1);
    } else {
      if (picked.length >= 2) { msg('最多携带 2 把武器'); return; }
      picked.push(i);
      if (mags[i] === undefined) mags[i] = 0;
    }
    refresh();
  }

  function setMag(i, d) {
    mags[i] = clamp((mags[i] || 0) + d, 0, 3);
    refresh();
  }

  function magsCost() {
    return picked.reduce((s, i) => s + (mags[i] || 0) * WEAPONS[i].cost, 0);
  }

  function maxCarry() {
    const left = Bank.get() - magsCost();
    return Math.max(0, Math.floor(left / 100) * 100);
  }

  function addCarry(d) {
    carry = clamp(carry + d, 0, maxCarry());
    refresh();
  }

  function totalCost() {
    return magsCost() + carry;
  }

  function refresh() {
    const bank = Bank.get();
    el.bank.textContent = fmt(bank);
    el.best.textContent = fmt(Game.getBest());
    el.pick.textContent = picked.length + ' / 2';

    for (let i = 0; i < el.weapons.children.length; i++) {
      el.weapons.children[i].classList.toggle('on', picked.indexOf(i) >= 0);
    }

    el.load.innerHTML = '';
    for (let slot = 0; slot < 2; slot++) {
      const wIdx = picked[slot];
      const row = document.createElement('div');
      if (wIdx === undefined) {
        row.className = 'load-row empty';
        row.innerHTML = '<span class="lr-name">空槽位</span><span class="lr-hint">选择一把武器</span>';
      } else {
        const w = WEAPONS[wIdx];
        const n = mags[wIdx] || 0;
        row.className = 'load-row';
        row.style.setProperty('--wc', w.color);
        row.innerHTML =
          '<span class="lr-name">' + w.name + '</span>' +
          '<button class="lr-btn" data-a="-">−</button>' +
          '<span class="lr-num">' + n + '</span>' +
          '<button class="lr-btn" data-a="+">+</button>' +
          '<span class="lr-cost">' + (n * w.cost) + ' NB</span>';
        row.querySelector('[data-a="-"]').addEventListener('click', () => setMag(wIdx, -1));
        row.querySelector('[data-a="+"]').addEventListener('click', () => setMag(wIdx, 1));
      }
      el.load.appendChild(row);
    }

    const cap = maxCarry();
    if (carry > cap) carry = cap;
    if (carry % 100 !== 0) carry = Math.floor(carry / 100) * 100;
    el.carry.textContent = fmt(carry);
    el.carryMax.textContent = '上限 ' + fmt(cap);

    const magCost = magsCost();
    const cost = magCost + carry;
    el.cost.textContent = fmt(cost);
    el.remain.textContent = fmt(Math.max(0, bank - cost));
    const ok = picked.length === 2 && cost <= bank;
    el.start.classList.toggle('dis', !ok);

    el.stashCount.textContent = Stash.count();
    el.stashValue.textContent = fmt(Stash.total());

    let warn = '';
    if (picked.length === 2) {
      if (magCost > bank) warn = '数据不足，减少配给';
      else if (picked.every(i => !(mags[i] || 0))) warn = '未配给弹夹：进局后需自行搜刮数据制造';
      else if (carry === 0) warn = '未携带数据：局内需先搜刮分解';
    }
    if (el.warn) el.warn.textContent = warn;
  }

  function msg(text) {
    el.msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.msg.textContent = ''; }, 1800);
  }

  function canStart() {
    return picked.length === 2 && totalCost() <= Bank.get();
  }

  function start() {
    if (Stash.isOpen()) return;
    if (picked.length !== 2) { msg('需要携带 2 把武器'); return; }
    const cost = totalCost();
    const bank = Bank.get();
    if (cost > bank) { msg('数据不足，无法配给'); return; }

    Bank.set(bank - cost);
    Game.startRun(null, {
      weapons: picked.slice(),
      mags: picked.map(i => mags[i] || 0),
      data: carry
    });
  }

  function reset() {
    picked = [];
    for (const k in mags) delete mags[k];
    carry = 0;
    if (el.root) refresh();
  }

  function show(v) {
    el.root.classList.toggle('hidden', !v);
    if (v) refresh();
  }

  function getLoadout() {
    return { weapons: picked.slice(), mags: picked.map(i => mags[i] || 0), data: carry };
  }

  return { init, show, refresh, start, canStart, getLoadout, reset };
})();
