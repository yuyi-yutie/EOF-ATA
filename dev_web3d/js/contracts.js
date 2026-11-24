'use strict';

/* ============================================================
   合约（大厅内页）
   - 同时挂 3 个合约，完成后领取数据奖励
   - 单局类合约取「最好的一次」，累计类直接累加
   - 全部领取后可签订新一轮
   ============================================================ */

const Contracts = (function () {
  const KINDS = {
    kills: {
      title: '清剿协议',
      desc: function (n) { return '单局击杀 ' + n + ' 个敌人'; },
      targets: [8, 12, 16],
      reward: [140, 200, 280],
      single: true,
      key: 'kills'
    },
    loot: {
      title: '回收清单',
      desc: function (n) { return '单局拾取 ' + n + ' 件物资'; },
      targets: [5, 7, 9],
      reward: [120, 180, 240],
      single: true,
      key: 'loot'
    },
    haul: {
      title: '满载而归',
      desc: function (n) { return '单次撤离带出价值 ' + n + ' NB 的物资'; },
      targets: [400, 650, 900],
      reward: [180, 260, 360],
      single: true,
      key: 'haul'
    },
    spitter: {
      title: '抑制喷吐体',
      desc: function (n) { return '累计击杀 ' + n + ' 只喷吐僵尸'; },
      targets: [6, 10, 14],
      reward: [150, 220, 300],
      single: false,
      key: 'spitters'
    },
    dismantle: {
      title: '数据采掘',
      desc: function (n) { return '累计分解 ' + n + ' NB 的物资'; },
      targets: [600, 1200, 2000],
      reward: [160, 240, 340],
      single: false,
      key: 'dismantled'
    }
  };
  const KIND_IDS = ['kills', 'loot', 'haul', 'spitter', 'dismantle'];

  function el(id) { return document.getElementById(id); }

  function rollOne(kindId, avoidTarget) {
    const k = KINDS[kindId];
    let ti = Math.floor(Math.random() * k.targets.length);
    if (avoidTarget !== undefined && ti === avoidTarget) ti = (ti + 1) % k.targets.length;
    const target = k.targets[ti];
    return {
      kind: kindId,
      title: k.title,
      desc: k.desc(target),
      target: target,
      reward: k.reward[ti],
      progress: 0,
      claimed: false
    };
  }

  function rollSet(avoid) {
    const pool = KIND_IDS.slice();
    /* 打乱后取 3 个 */
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const out = [];
    for (let i = 0; i < 3; i++) out.push(rollOne(pool[i]));
    return out;
  }

  function ensure() {
    if (Store.contracts().length < 3) {
      Store.setContracts(rollSet());
    }
  }

  function allClaimed() {
    const list = Store.contracts();
    return list.length > 0 && list.every(function (c) { return c.claimed; });
  }

  function reroll() {
    if (!allClaimed()) return false;
    Store.setContracts(rollSet());
    return true;
  }

  /* result: { win, kills, loot, data, haul, spitters, dismantled } */
  function applyRun(result) {
    const list = Store.contracts();
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.claimed) continue;
      const k = KINDS[c.kind];
      if (!k) continue;
      let v = 0;
      if (c.kind === 'haul') {
        if (!result.win) continue;
        v = result.haul || 0;
      } else {
        v = result[k.key] || 0;
      }
      let next = k.single ? Math.max(c.progress, v) : c.progress + v;
      next = Math.min(c.target, next);
      if (next !== c.progress) { c.progress = next; changed = true; }
    }
    if (changed) Store.save();
  }

  function claim(i) {
    const list = Store.contracts();
    const c = list[i];
    if (!c || c.claimed || c.progress < c.target) return { ok: false, msg: '合约未完成' };
    c.claimed = true;
    Store.addBank(c.reward);
    Store.save();
    return { ok: true, msg: '合约完成 · +' + UI.fmt(c.reward) + ' NB' };
  }

  /* ---------------- 渲染 ---------------- */
  let elRoot = null;

  function init() {
    elRoot = UI.$('paneContracts');
    refresh();
  }

  function refresh() {
    if (!elRoot) return;
    ensure();
    const list = Store.contracts();
    const bankEl = el('contractBank');
    if (bankEl) bankEl.textContent = UI.fmt(Store.bank());
    const box = el('contractList');
    if (!box) return;
    box.innerHTML = '';

    const doneCount = list.filter(function (c) { return c.progress >= c.target; }).length;
    const head = UI.el('div', 'contract-list-head');
    head.innerHTML = '<span>当前合约</span><em>' + doneCount + ' / ' + list.length + ' 完成</em>';
    box.appendChild(head);

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const done = c.progress >= c.target;
      const k = KINDS[c.kind];
      const card = UI.el('div', 'contract-card' + (done ? ' done' : '') + (c.claimed ? ' claimed' : ''));
      const pct = Math.min(100, c.progress / c.target * 100);
      card.innerHTML =
        '<div class="cc-top">' +
          '<span class="cc-idx">0' + (i + 1) + '</span>' +
          '<span class="cc-title">' + UI.esc(c.title) + '</span>' +
          '<span class="cc-reward">' + UI.fmt(c.reward) + ' NB</span>' +
        '</div>' +
        '<div class="cc-desc">' + UI.esc(c.desc) + '</div>' +
        '<div class="cc-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="cc-foot">' +
          '<span class="cc-prog">' + Math.min(c.progress, c.target) + ' / ' + c.target + '</span>' +
          '<button class="btn-mini">' +
            (c.claimed ? '已领取' : (done ? '领取奖励' : '进行中')) +
          '</button>' +
        '</div>';
      const btn = card.querySelector('button');
      btn.disabled = c.claimed || !done;
      btn.addEventListener('click', function () { claimAndRefresh(i); });
      box.appendChild(card);
    }

    const claimed = list.filter(function (c) { return c.claimed; }).length;
    const got = list.reduce(function (s, c) { return s + (c.claimed ? c.reward : 0); }, 0);
    const all = list.reduce(function (s, c) { return s + c.reward; }, 0);
    const setTxt = function (id, txt) {
      const n = el(id);
      if (n) n.textContent = txt;
    };
    setTxt('contractClaimed', claimed + ' / ' + list.length);
    setTxt('contractReward', UI.fmt(got) + ' / ' + UI.fmt(all) + ' NB');
    setTxt('contractEpoch', allClaimed() ? '已完成' : '进行中');
    const fill = el('contractFill');
    if (fill) fill.style.width = (claimed / Math.max(1, list.length) * 100) + '%';

    const rerollBtn = el('contractReroll');
    if (rerollBtn) {
      rerollBtn.classList.toggle('dis', !allClaimed());
      rerollBtn.disabled = !allClaimed();
      rerollBtn.textContent = allClaimed() ? '签订新一轮合约' : '完成并领取全部合约后可刷新';
    }
  }

  function claimAndRefresh(i) {
    const r = claim(i);
    refresh();
    if (r.ok) {
      UI.toast(r.msg, 'good');
      if (typeof Lobby !== 'undefined') Lobby.refreshBank();
    } else {
      UI.toast(r.msg, 'warn');
    }
  }

  function rerollAndRefresh() {
    if (reroll()) {
      refresh();
      UI.toast('已签订新一轮合约', 'good');
    }
  }

  return {
    init: init, refresh: refresh, applyRun: applyRun,
    ensure: ensure, allClaimed: allClaimed, reroll: rerollAndRefresh
  };
})();
