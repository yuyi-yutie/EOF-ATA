'use strict';

/* ============================================================
   Store — 局外存档（localStorage）
   - 数据账户 / 仓库 / 战术补给 / 永久强化 / 合约 / 战绩 / 配装
   - 所有写操作立即落盘；读到坏档自动回退到新档
   ============================================================ */

const Store = (function () {
  const KEY = 'eofata3d.save.v1';
  const SAVE_VERSION = 1;

  const data = defaults();

  function defaults() {
    return {
      version: SAVE_VERSION,
      bank: CFG.START_BANK,
      stash: [],
      kit: { medkit: 1, battery: 1 },
      augments: { armor: 0, vitality: 0, pack: 0, loader: 0 },
      contracts: [],
      stats: {
        runs: 0, extracts: 0, deaths: 0,
        kills: 0, looted: 0, dismantled: 0,
        bestHaul: 0, bestKills: 0, time: 0
      },
      history: [],
      char: 0,
      loadout: { weapons: [3, 0], mags: [1, 0], carry: 100 },
      settings: { pitch: CFG.CAM.PITCH }
    };
  }

  function num(v, d) {
    const n = parseInt(v, 10);
    return isFinite(n) ? n : d;
  }

  function clampInt(v, a, b, d) {
    const n = num(v, d);
    return n < a ? a : (n > b ? b : n);
  }

  function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object' || !raw.name) return null;
    const tierId = TIER_BY_ID[raw.tierId] ? raw.tierId : 'common';
    const t = TIER_BY_ID[tierId];
    return {
      kind: 'material',
      name: String(raw.name).slice(0, 24),
      tierId: tierId,
      w: clampInt(raw.w, 1, CFG.STASH_COLS, 1),
      h: clampInt(raw.h, 1, CFG.STASH_ROWS, 1),
      value: clampInt(raw.value, 0, 9999, t.min),
      time: Math.max(0.4, Math.min(6, parseFloat(raw.time) || t.time)),
      gx: 0, gy: 0, rot: 0
    };
  }

  function load() {
    let raw = null;
    try {
      const s = localStorage.getItem(KEY);
      raw = s ? JSON.parse(s) : null;
    } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return false;

    data.bank = Math.max(0, num(raw.bank, CFG.START_BANK));
    data.char = clampInt(raw.char, 0, 1, 0);

    data.stats.runs = Math.max(0, num(raw.stats && raw.stats.runs, 0));
    data.stats.extracts = Math.max(0, num(raw.stats && raw.stats.extracts, 0));
    data.stats.deaths = Math.max(0, num(raw.stats && raw.stats.deaths, 0));
    data.stats.kills = Math.max(0, num(raw.stats && raw.stats.kills, 0));
    data.stats.looted = Math.max(0, num(raw.stats && raw.stats.looted, 0));
    data.stats.dismantled = Math.max(0, num(raw.stats && raw.stats.dismantled, 0));
    data.stats.bestHaul = Math.max(0, num(raw.stats && raw.stats.bestHaul, 0));
    data.stats.bestKills = Math.max(0, num(raw.stats && raw.stats.bestKills, 0));
    data.stats.time = Math.max(0, num(raw.stats && raw.stats.time, 0));

    data.kit.medkit = clampInt(raw.kit && raw.kit.medkit, 0, 6, 0);
    data.kit.battery = clampInt(raw.kit && raw.kit.battery, 0, 9, 0);

    AUGMENTS.forEach(function (a) {
      data.augments[a.id] = clampInt(raw.augments && raw.augments[a.id], 0, a.max, 0);
    });

    data.stash = [];
    if (Array.isArray(raw.stash)) {
      for (let i = 0; i < raw.stash.length; i++) {
        const it = sanitizeItem(raw.stash[i]);
        if (it && Grid.autoPlace(data.stash, it, CFG.STASH_COLS, CFG.STASH_ROWS)) data.stash.push(it);
      }
    }

    data.contracts = [];
    if (Array.isArray(raw.contracts)) {
      for (let i = 0; i < raw.contracts.length && i < 3; i++) {
        const c = raw.contracts[i];
        if (!c || !c.kind) continue;
        data.contracts.push({
          kind: String(c.kind),
          title: String(c.title || '合约'),
          desc: String(c.desc || ''),
          target: Math.max(1, num(c.target, 1)),
          reward: Math.max(0, num(c.reward, 100)),
          progress: Math.max(0, num(c.progress, 0)),
          claimed: !!c.claimed
        });
      }
    }

    data.history = [];
    if (Array.isArray(raw.history)) {
      for (let i = 0; i < raw.history.length && i < 12; i++) {
        const h = raw.history[i];
        if (!h) continue;
        data.history.push({
          win: !!h.win,
          kills: Math.max(0, num(h.kills, 0)),
          loot: Math.max(0, num(h.loot, 0)),
          data: Math.max(0, num(h.data, 0)),
          value: Math.max(0, num(h.value, 0)),
          time: Math.max(0, num(h.time, 0))
        });
      }
    }

    const lo = raw.loadout || {};
    const w = Array.isArray(lo.weapons) ? lo.weapons.filter(function (i) { return i >= 0 && i < WEAPONS.length; }) : [];
    const uniq = [];
    for (let i = 0; i < w.length && uniq.length < 2; i++) {
      if (uniq.indexOf(w[i]) < 0) uniq.push(w[i]);
    }
    while (uniq.length < 2) {
      for (let i = 0; i < WEAPONS.length && uniq.length < 2; i++) {
        if (uniq.indexOf(i) < 0) uniq.push(i);
      }
    }
    data.loadout.weapons = uniq;
    data.loadout.mags = [
      clampInt(lo.mags && lo.mags[0], 0, CFG.CARRY_MAX_MAGS, 0),
      clampInt(lo.mags && lo.mags[1], 0, CFG.CARRY_MAX_MAGS, 0)
    ];
    data.loadout.carry = Math.max(0, Math.floor(num(lo.carry, 0) / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
    data.settings.pitch = clampInt(raw.settings && raw.settings.pitch, 30, 85, CFG.CAM.PITCH);

    return true;
  }

  function serialize() {
    return {
      version: SAVE_VERSION,
      bank: Math.round(data.bank),
      stash: data.stash.map(function (it) {
        return {
          name: it.name, tierId: it.tierId, w: it.w, h: it.h,
          value: it.value, time: it.time, gx: it.gx, gy: it.gy, rot: it.rot
        };
      }),
      kit: { medkit: data.kit.medkit, battery: data.kit.battery },
      augments: {
        armor: data.augments.armor, vitality: data.augments.vitality,
        pack: data.augments.pack, loader: data.augments.loader
      },
      contracts: data.contracts,
      stats: data.stats,
      history: data.history,
      char: data.char,
      loadout: data.loadout,
      settings: data.settings
    };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(serialize())); } catch (e) { /* ignore */ }
  }

  function reset() {
    const d = defaults();
    for (const k in d) data[k] = d[k];
    save();
  }

  /* ---------------- 账户 ---------------- */
  function bank() { return Math.floor(data.bank); }
  function addBank(n) { data.bank = Math.max(0, data.bank + n); return bank(); }
  function spend(n) {
    n = Math.round(n);
    if (n <= 0) return true;
    if (data.bank < n) return false;
    data.bank -= n;
    return true;
  }

  /* ---------------- 仓库 ---------------- */
  function stashAdd(item) {
    const it = Grid.cloneItem(item);
    if (!Grid.autoPlace(data.stash, it, CFG.STASH_COLS, CFG.STASH_ROWS)) return false;
    data.stash.push(it);
    return true;
  }

  /* 返回 { stored, overflowValue, overflowCount } */
  function stashAddMany(list) {
    let stored = 0, overflowValue = 0, overflowCount = 0;
    for (let i = 0; i < list.length; i++) {
      const it = Grid.cloneItem(list[i]);
      if (Grid.autoPlace(data.stash, it, CFG.STASH_COLS, CFG.STASH_ROWS)) {
        data.stash.push(it);
        stored++;
      } else {
        overflowValue += it.value || 0;
        overflowCount++;
      }
    }
    if (overflowValue > 0) addBank(overflowValue);
    return { stored: stored, overflowValue: overflowValue, overflowCount: overflowCount };
  }

  function stashRemove(it) {
    const i = data.stash.indexOf(it);
    if (i < 0) return false;
    data.stash.splice(i, 1);
    return true;
  }

  function stashDismantle(it) {
    if (!stashRemove(it)) return 0;
    const v = Math.max(0, it.value || 0);
    addBank(v);
    data.stats.dismantled += v;
    save();
    return v;
  }

  function stashDismantleAll() {
    let sum = 0;
    for (let i = 0; i < data.stash.length; i++) sum += Math.max(0, data.stash[i].value || 0);
    const n = data.stash.length;
    data.stash = [];
    addBank(sum);
    data.stats.dismantled += sum;
    save();
    return { value: sum, count: n };
  }

  function stashRepack() {
    data.stash = Grid.repack(data.stash, CFG.STASH_COLS, CFG.STASH_ROWS);
    save();
  }

  function stashCount() { return data.stash.length; }
  function stashValue() {
    return data.stash.reduce(function (s, it) { return s + (it.value || 0); }, 0);
  }
  function stashCells() { return Grid.usedCells(data.stash); }

  /* ---------------- 补给 / 强化 ---------------- */
  function buySupply(id) {
    const s = SUPPLY_BY_ID[id];
    if (!s) return { ok: false, msg: '未知补给' };
    const have = data.kit[id] || 0;
    if (have >= s.max) return { ok: false, msg: '携带上限已满' };
    if (!spend(s.price)) return { ok: false, msg: '数据不足' };
    data.kit[id] = have + 1;
    save();
    return { ok: true, msg: '已装填 ' + s.name };
  }

  function buyAugment(id) {
    const a = AUGMENTS.find(function (x) { return x.id === id; });
    if (!a) return { ok: false, msg: '未知强化' };
    const lv = data.augments[id] || 0;
    if (lv >= a.max) return { ok: false, msg: '已满级' };
    const cost = a.costs[lv];
    if (!spend(cost)) return { ok: false, msg: '数据不足' };
    data.augments[id] = lv + 1;
    save();
    return { ok: true, msg: a.name + ' → Lv.' + (lv + 1) };
  }

  /* ---------------- 配装 ---------------- */
  function loadout() { return data.loadout; }
  function setLoadout(lo) {
    data.loadout.weapons = [lo.weapons[0], lo.weapons[1]];
    data.loadout.mags = [lo.mags[0] | 0, lo.mags[1] | 0];
    data.loadout.carry = Math.max(0, Math.floor(lo.carry / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
    save();
  }

  function kit() { return data.kit; }
  function setKit(k) {
    data.kit.medkit = clampInt(k.medkit, 0, 6, 0);
    data.kit.battery = clampInt(k.battery, 0, 9, 0);
    save();
  }

  function aug(id) { return data.augments[id] || 0; }
  function char() { return data.char; }
  function setChar(i) { data.char = clampInt(i, 0, 1, 0); save(); }

  /* ---------------- 派生数值 ---------------- */
  function maxHp() { return CFG.PLAYER.hp + aug('vitality') * 12; }
  function maxShield() { return CFG.PLAYER.shield + aug('armor') * 12; }
  function invRows() { return CFG.INV_ROWS + aug('pack'); }
  function reloadMul() { return 1 - aug('loader') * 0.08; }

  /* ---------------- 战绩 ---------------- */
  function recordRun(r) {
    const s = data.stats;
    s.runs++;
    s.kills += r.kills;
    s.looted += r.loot;
    s.time += Math.round(r.time);
    if (r.win) s.extracts++; else s.deaths++;
    if (r.win) {
      if (r.haul > s.bestHaul) s.bestHaul = r.haul;
      if (r.kills > s.bestKills) s.bestKills = r.kills;
    }
    data.history.unshift({
      win: !!r.win, kills: r.kills, loot: r.loot,
      data: Math.round(r.data), value: Math.round(r.haul), time: Math.round(r.time)
    });
    if (data.history.length > 12) data.history.length = 12;
    save();
  }

  function stats() { return data.stats; }
  function history() { return data.history; }
  function best() { return data.stats.bestHaul; }

  /* ---------------- 合约 ---------------- */
  function contracts() { return data.contracts; }
  function setContracts(list) { data.contracts = list; save(); }

  /* ---------------- 调试：填充一套展示用存档 ---------------- */
  function demo() {
    reset();
    data.bank = 2480;
    data.augments = { armor: 2, vitality: 1, pack: 1, loader: 2 };
    data.kit = { medkit: 3, battery: 2 };
    data.stats = {
      runs: 14, extracts: 9, deaths: 5, kills: 187, looted: 142,
      dismantled: 6120, bestHaul: 1460, bestKills: 21, time: 6320
    };
    data.history = [
      { win: true, kills: 14, loot: 11, data: 780, value: 940, time: 412 },
      { win: false, kills: 6, loot: 4, data: 210, value: 240, time: 236 },
      { win: true, kills: 19, loot: 13, data: 1240, value: 1460, time: 508 }
    ];
    let seed = 20261124;
    const rnd = function () {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5; seed >>>= 0;
      return (seed >>> 0) / 4294967296;
    };
    data.stash = [];
    for (let i = 0; i < 22; i++) {
      const it = ITEMS.roll(null, rnd, 0.5);
      if (Grid.autoPlace(data.stash, it, CFG.STASH_COLS, CFG.STASH_ROWS)) data.stash.push(it);
    }
    save();
  }

  return {
    load: load, save: save, reset: reset, demo: demo,
    bank: bank, addBank: addBank, spend: spend,
    stash: function () { return data.stash; },
    stashAdd: stashAdd, stashAddMany: stashAddMany, stashRemove: stashRemove,
    stashDismantle: stashDismantle, stashDismantleAll: stashDismantleAll, stashRepack: stashRepack,
    stashCount: stashCount, stashValue: stashValue, stashCells: stashCells,
    buySupply: buySupply, buyAugment: buyAugment,
    loadout: loadout, setLoadout: setLoadout,
    kit: kit, setKit: setKit,
    aug: aug, augments: function () { return data.augments; },
    char: char, setChar: setChar,
    maxHp: maxHp, maxShield: maxShield, invRows: invRows, reloadMul: reloadMul,
    recordRun: recordRun, stats: stats, history: history, best: best,
    contracts: contracts, setContracts: setContracts,
    raw: function () { return data; }
  };
})();
