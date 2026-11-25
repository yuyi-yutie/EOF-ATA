'use strict';

/* ============================================================
   Store — 局外存档（localStorage）
   - 数据账户 / 仓库 / 战术补给 / 永久强化 / 合约 / 战绩 / 配装
   - 所有写操作立即落盘；读到坏档自动回退到新档
   ============================================================ */

const Store = (function () {
  const KEY = 'eofata3d.save.v1';
  const SAVE_VERSION = 5;

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
      loadout: { weapons: [null, null], mags: [0, 0], carry: 0 },
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
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind !== 'weapon' && !raw.name) return null;
    const tierId = TIER_BY_ID[raw.tierId] ? raw.tierId : 'common';
    const t = TIER_BY_ID[tierId];
    if (raw.kind === 'weapon') {
      const w = WEAPONS[raw.weaponId];
      if (!w) return null;
      const wt = TIER_BY_ID[w.tierId] || TIER_BY_ID.rare;
      const chips = [];
      if (Array.isArray(raw.chips)) {
        for (let i = 0; i < raw.chips.length && chips.length < 3; i++) {
          const c = sanitizeChipEntry(raw.chips[i]);
          if (c) chips.push(c);
        }
      }
      return {
        kind: 'weapon',
        weaponId: raw.weaponId,
        name: w.name,
        tierId: wt.id,
        w: 3, h: 1,
        value: clampInt(raw.value, 0, 9999, w.value || 0),
        time: Math.max(1, Math.min(8, parseFloat(raw.time) || 2.6)),
        chips: chips,
        gx: 0, gy: 0, rot: 0
      };
    }
    if (raw.kind === 'chip') {
      const def = CHIP_BY_ID[raw.chipId];
      if (!def) return null;
      return {
        kind: 'chip',
        chipId: def.id,
        name: def.name,
        tierId: tierId,
        w: 1, h: 1,
        value: clampInt(raw.value, 0, 9999, t.min),
        time: Math.max(0.4, Math.min(6, parseFloat(raw.time) || t.time)),
        gx: 0, gy: 0, rot: 0
      };
    }
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

  function sanitizeChipEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const def = CHIP_BY_ID[raw.chipId];
    if (!def) return null;
    const tierId = TIER_BY_ID[raw.tierId] ? raw.tierId : 'common';
    return {
      chipId: def.id,
      tierId: tierId,
      value: clampInt(raw.value, 0, 9999, TIER_BY_ID[tierId].min)
    };
  }

  function sanitizeEquippedWeapon(raw, legacyChips) {
    let base = raw;
    if (typeof raw === 'number') {
      base = ITEMS.makeWeaponItem(raw);
      if (!base) return null;
      base = { weaponId: base.weaponId, value: base.value, chips: legacyChips || [] };
    }
    if (!base || typeof base !== 'object') return null;
    const w = WEAPONS[base.weaponId];
    if (!w) return null;
    const wt = TIER_BY_ID[w.tierId] || TIER_BY_ID.rare;
    const chips = [];
    if (Array.isArray(base.chips)) {
      for (let i = 0; i < base.chips.length && chips.length < 3; i++) {
        const c = sanitizeChipEntry(base.chips[i]);
        if (c) chips.push(c);
      }
    }
    return {
      kind: 'weapon',
      weaponId: base.weaponId,
      name: w.name,
      tierId: wt.id,
      value: clampInt(base.value, 0, 9999, w.value || 0),
      time: 2.6,
      chips: chips
    };
  }

  function equippedWeapon(slot) { return data.loadout.weapons[slot] || null; }
  function equippedByWeaponId(wi) {
    const list = data.loadout.weapons;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].weaponId === wi) return list[i];
    }
    return null;
  }

  function load() {
    let raw = null;
    try {
      const s = localStorage.getItem(KEY);
      raw = s ? JSON.parse(s) : null;
    } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return false;

    data.bank = Math.max(0, num(raw.bank, CFG.START_BANK));
    data.char = clampInt(raw.char, 0, 5, 0);

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
    const src = Array.isArray(lo.weapons) ? lo.weapons : [];
    const eq = [null, null];
    for (let i = 0; i < src.length && i < 2; i++) {
      const s = src[i];
      if (s === undefined || s === null) continue;
      let legacy = null;
      if (typeof s === 'number' && Array.isArray(raw.weaponChips)) {
        const old = raw.weaponChips[s] || [];
        legacy = [];
        for (let k = 0; k < old.length && legacy.length < 3; k++) {
          const c = sanitizeChipEntry(old[k]);
          if (c) legacy.push(c);
        }
      }
      const item = sanitizeEquippedWeapon(s, legacy);
      if (item) eq[i] = item;
    }
    data.loadout.weapons = eq;
    data.loadout.mags = [
      clampInt(lo.mags && lo.mags[0], 0, CFG.CARRY_MAX_MAGS, 0),
      clampInt(lo.mags && lo.mags[1], 0, CFG.CARRY_MAX_MAGS, 0)
    ];
    data.loadout.carry = Math.max(0, Math.floor(num(lo.carry, 0) / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
    data.settings.pitch = clampInt(raw.settings && raw.settings.pitch, 30, 90, CFG.CAM.PITCH);
    /* v5：默认俯角统一回到 70°（旧档曾被迁移成 80°） */
    if (!raw.version || raw.version < 5) data.settings.pitch = 70;

    return true;
  }

  function serialize() {
    return {
      version: SAVE_VERSION,
      bank: Math.round(data.bank),
      stash: data.stash.map(function (it) {
        const o = {
          kind: it.kind || 'material',
          name: it.name, tierId: it.tierId, w: it.w, h: it.h,
          value: it.value, time: it.time, gx: it.gx, gy: it.gy, rot: it.rot
        };
        if (o.kind === 'chip') o.chipId = it.chipId;
        if (o.kind === 'weapon') {
          o.weaponId = it.weaponId;
          o.chips = Array.isArray(it.chips) ? it.chips.map(function (c) {
            return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
          }) : [];
        }
        return o;
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
    const keep = [];
    for (let i = 0; i < data.stash.length; i++) {
      const it = data.stash[i];
      if (it.kind === 'weapon') { keep.push(it); continue; }
      sum += Math.max(0, it.value || 0);
    }
    const n = data.stash.length - keep.length;
    data.stash = keep;
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
    const ws = [null, null];
    const src = lo && Array.isArray(lo.weapons) ? lo.weapons : [];
    for (let i = 0; i < 2; i++) {
      let s = src[i];
      if (s === undefined || s === null) continue;
      if (typeof s === 'number') s = ITEMS.makeWeaponItem(s);
      const item = sanitizeEquippedWeapon(s);
      if (item) ws[i] = item;
    }
    data.loadout.weapons = ws;
    data.loadout.mags = [
      clampInt(lo && lo.mags && lo.mags[0], 0, CFG.CARRY_MAX_MAGS, 0),
      clampInt(lo && lo.mags && lo.mags[1], 0, CFG.CARRY_MAX_MAGS, 0)
    ];
    data.loadout.carry = Math.max(0, Math.floor((lo && lo.carry || 0) / CFG.CARRY_UNIT) * CFG.CARRY_UNIT);
    save();
  }

  function equipWeapon(slot, item) {
    if (slot < 0 || slot > 1) return { ok: false, msg: '未知配装槽' };
    if (data.loadout.weapons[slot]) return { ok: false, msg: '该配装槽已被占用' };
    if (!item || item.kind !== 'weapon') return { ok: false, msg: '这不是武器' };
    const w = WEAPONS[item.weaponId];
    if (!w) return { ok: false, msg: '未知武器' };
    const at = data.stash.indexOf(item);
    if (at < 0) return { ok: false, msg: '武器不在仓库中' };
    const eq = sanitizeEquippedWeapon(item);
    if (!eq) return { ok: false, msg: '无法装备该武器' };
    data.stash.splice(at, 1);
    data.loadout.weapons[slot] = eq;
    save();
    return { ok: true, msg: w.name + ' 已装备' };
  }

  function unequipWeapon(slot) {
    const eq = data.loadout.weapons[slot];
    if (!eq) return { ok: false, msg: '该槽位没有武器' };
    const item = ITEMS.makeWeaponItem(eq.weaponId);
    if (!item) return { ok: false, msg: '无法卸下武器' };
    item.value = eq.value || item.value;
    item.tierId = eq.tierId || item.tierId;
    item.chips = (eq.chips || []).slice();
    if (!Grid.autoPlace(data.stash, item, CFG.STASH_COLS, CFG.STASH_ROWS)) {
      return { ok: false, msg: '仓库已满 · 无法卸下武器' };
    }
    data.stash.push(item);
    data.loadout.weapons[slot] = null;
    save();
    return { ok: true, msg: '武器已放回仓库', item: item };
  }

  function clearLoadoutWeapons() {
    data.loadout.weapons = [null, null];
    save();
  }

  /* ---------------- 武器芯片（跟随武器物品） ---------------- */
  function weaponChips(wi) {
    const eq = equippedByWeaponId(wi);
    return eq && Array.isArray(eq.chips) ? eq.chips : [];
  }

  /* 局内撤离后，把每把已装备武器的芯片写回对应武器 */
  function setWeaponChips(list) {
    WEAPONS.forEach(function (_, wi) {
      const eq = equippedByWeaponId(wi);
      if (!eq) return;
      const src = list && list[wi];
      const out = [];
      if (Array.isArray(src)) {
        for (let i = 0; i < src.length && out.length < 3; i++) {
          const c = sanitizeChipEntry(src[i]);
          if (c) out.push(c);
        }
      }
      eq.chips = out;
    });
    save();
  }

  function installChip(wi, item) {
    const eq = equippedByWeaponId(wi);
    if (!eq) return { ok: false, msg: '该武器尚未装备' };
    const list = eq.chips || (eq.chips = []);
    if (list.length >= 3) return { ok: false, msg: '芯片槽已满（最多 3 个）' };
    const entry = ITEMS.chipEntry(item);
    if (!entry) return { ok: false, msg: '这不是芯片' };
    if (!ITEMS.chipFitsWeapon(entry, wi)) {
      const tag = ITEMS.chipRestriction(entry);
      return { ok: false, msg: '该芯片只能装在「' + tag + '」武器上' };
    }
    const at = data.stash.indexOf(item);
    if (at < 0) return { ok: false, msg: '芯片不在仓库中' };
    data.stash.splice(at, 1);
    list.push(entry);
    save();
    return { ok: true, msg: WEAPONS[wi].name + ' 已装入 ' + (CHIP_BY_ID[entry.chipId] || {}).name };
  }

  function uninstallChip(wi, slot) {
    const eq = equippedByWeaponId(wi);
    if (!eq) return { ok: false, msg: '该武器尚未装备' };
    const list = eq.chips || [];
    if (!list[slot]) return { ok: false, msg: '该槽位没有芯片' };
    const item = ITEMS.makeChipItem(list[slot]);
    if (!item || !Grid.autoPlace(data.stash, item, CFG.STASH_COLS, CFG.STASH_ROWS)) {
      return { ok: false, msg: '仓库已满 · 无法卸下芯片' };
    }
    data.stash.push(item);
    list.splice(slot, 1);
    save();
    return { ok: true, msg: '芯片已卸回仓库', item: item };
  }

  /* 机库制造：消耗数据制造芯片 / 武器，成品直接进仓库 */
  function craftChip(chipId) {
    const def = CHIP_BY_ID[chipId];
    if (!def) return { ok: false, msg: '未知芯片' };
    const price = def.price || 0;
    if (data.bank < price) return { ok: false, msg: '数据不足 · 需要 ' + price + ' NB' };
    const item = ITEMS.makeChipItem({
      chipId: def.id,
      tierId: def.tierId || 'fine',
      value: def.value
    });
    if (!item) return { ok: false, msg: '无法制造该芯片' };
    if (!Grid.autoPlace(data.stash, item, CFG.STASH_COLS, CFG.STASH_ROWS)) {
      return { ok: false, msg: '仓库已满 · 请先整理仓库' };
    }
    if (!spend(price)) return { ok: false, msg: '数据不足' };
    data.stash.push(item);
    save();
    return { ok: true, msg: def.name + ' 制造完成 · 数据 -' + price, item: item, value: def.value };
  }

  function craftWeapon(wi) {
    const w = WEAPONS[wi];
    if (!w) return { ok: false, msg: '未知武器' };
    const price = w.craft || 0;
    if (data.bank < price) return { ok: false, msg: '数据不足 · 需要 ' + price + ' NB' };
    const item = ITEMS.makeWeaponItem(wi);
    if (!item) return { ok: false, msg: '无法制造该武器' };
    if (!Grid.autoPlace(data.stash, item, CFG.STASH_COLS, CFG.STASH_ROWS)) {
      return { ok: false, msg: '仓库已满 · 请先整理仓库' };
    }
    if (!spend(price)) return { ok: false, msg: '数据不足' };
    data.stash.push(item);
    save();
    return { ok: true, msg: w.name + ' 制造完成 · 数据 -' + price, item: item, value: w.value };
  }

  /* 芯片修正：加法叠加，射速/换弹/后坐力设一个上限防止数值失控 */
  function weaponMods(wi) {
    return ITEMS.computeMods(weaponChips(wi));
  }

  function modsSummary(wi) {
    const m = weaponMods(wi);
    const parts = [];
    if (m.dmg) parts.push('伤害 +' + Math.round(m.dmg * 100) + '%');
    if (m.rate) parts.push('射速 +' + Math.round(m.rate * 100) + '%');
    if (m.reload) parts.push('换弹 +' + Math.round(m.reload * 100) + '%');
    if (m.recoil) parts.push('后坐 -' + Math.round(m.recoil * 100) + '%');
    if (m.coneRange) parts.push('声域 +' + Math.round(m.coneRange * 100) + '%');
    if (m.bounce) parts.push('反射 +' + m.bounce);
    if (m.zoneR) parts.push('燃域 +' + Math.round(m.zoneR * 100) + '%');
    if (m.pierce) parts.push('穿透 +' + m.pierce);
    if (m.chain) parts.push('链 +' + m.chain);
    return parts.join(' · ');
  }

  function kit() { return data.kit; }
  function setKit(k) {
    data.kit.medkit = clampInt(k.medkit, 0, 6, 0);
    data.kit.battery = clampInt(k.battery, 0, 9, 0);
    save();
  }

  function aug(id) { return data.augments[id] || 0; }
  function char() { return data.char; }
  function setChar(i) { data.char = clampInt(i, 0, 5, 0); save(); }

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
    data.bank = 10000;
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
    for (let i = 0; i < 4; i++) {
      const chip = ITEMS.rollChip(rnd, 0.7);
      if (Grid.autoPlace(data.stash, chip, CFG.STASH_COLS, CFG.STASH_ROWS)) data.stash.push(chip);
    }
    [1, 2, 4].forEach(function (wi) {
      const w = ITEMS.makeWeaponItem(wi);
      if (Grid.autoPlace(data.stash, w, CFG.STASH_COLS, CFG.STASH_ROWS)) data.stash.push(w);
    });
    data.loadout.weapons = [
      sanitizeEquippedWeapon({
        weaponId: 3, value: WEAPONS[3].value,
        chips: [
          { chipId: 'power', tierId: 'fine', value: 90 },
          { chipId: 'cycle', tierId: 'fine', value: 80 }
        ]
      }),
      sanitizeEquippedWeapon({ weaponId: 0, value: WEAPONS[0].value, chips: [] })
    ];
    data.loadout.mags = [1, 0];
    data.loadout.carry = 100;
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
    equipWeapon: equipWeapon, unequipWeapon: unequipWeapon,
    equippedWeapon: equippedWeapon, clearLoadoutWeapons: clearLoadoutWeapons,
    weaponChips: weaponChips, setWeaponChips: setWeaponChips,
    installChip: installChip, uninstallChip: uninstallChip,
    craftChip: craftChip, craftWeapon: craftWeapon,
    weaponMods: weaponMods, modsSummary: modsSummary,
    kit: kit, setKit: setKit,
    aug: aug, augments: function () { return data.augments; },
    char: char, setChar: setChar,
    maxHp: maxHp, maxShield: maxShield, invRows: invRows, reloadMul: reloadMul,
    recordRun: recordRun, stats: stats, history: history, best: best,
    contracts: contracts, setContracts: setContracts,
    raw: function () { return data; }
  };
})();
