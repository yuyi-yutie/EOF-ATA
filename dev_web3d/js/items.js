'use strict';

/* ============================================================
   物品 / 品质 / 补给 / 强化 —— 局外系统内容表
   - 物资尺寸按种类固定，和 dev_html 原型一致
   - 品质决定颜色、价值区间、分解耗时、掉落权重
   ============================================================ */

const TIERS = [
  {
    id: 'common', name: '常见', color: '#9aa4ad', min: 8, max: 16,
    time: 1.0, weight: 50,
    items: [
      { name: '磨损存储片', w: 1, h: 1 },
      { name: '氧化内存条', w: 1, h: 2 },
      { name: '杂讯磁带', w: 2, h: 1 },
      { name: '废弃传感器', w: 1, h: 1 }
    ]
  },
  {
    id: 'fine', name: '优良', color: '#5ad46a', min: 28, max: 44,
    time: 1.8, weight: 30,
    items: [
      { name: '加密数据块', w: 2, h: 2 },
      { name: '校验芯片', w: 1, h: 1 },
      { name: '冷却核心', w: 1, h: 2 },
      { name: '结构蓝图', w: 2, h: 1 }
    ]
  },
  {
    id: 'rare', name: '稀有', color: '#4d8bff', min: 70, max: 100,
    time: 2.8, weight: 14,
    items: [
      { name: '相位碎片', w: 2, h: 2 },
      { name: '拓扑密钥', w: 1, h: 3 },
      { name: '湮灭记录仪', w: 3, h: 1 }
    ]
  },
  {
    id: 'epic', name: '史诗', color: '#b96bff', min: 160, max: 220,
    time: 4.0, weight: 6,
    items: [
      { name: '奇点残核', w: 2, h: 3 },
      { name: 'ATA 黑匣', w: 3, h: 2 },
      { name: '熵减样本', w: 2, h: 2 }
    ]
  }
];

const TIER_BY_ID = {};
TIERS.forEach(function (t) { TIER_BY_ID[t.id] = t; });

/* 战术补给：买一次，带进局，用掉才消失 */
const SUPPLIES = [
  {
    id: 'medkit', name: '应急医疗针', price: 90, max: 6,
    heal: 60, time: 0.8, color: '#e2604f',
    desc: '立即回复 60 生命，不消耗数据'
  },
  {
    id: 'battery', name: '护盾电池', price: 70, max: 9,
    shield: 45, time: 0.5, color: '#6fd8ef',
    desc: '立即回复 45 护盾，不消耗数据'
  }
];
const SUPPLY_BY_ID = {};
SUPPLIES.forEach(function (s) { SUPPLY_BY_ID[s.id] = s; });

/* 永久强化：只能在大厅用数据购买 */
const AUGMENTS = [
  {
    id: 'armor', name: '护盾矩阵', tag: 'DEF', max: 3,
    costs: [260, 520, 900], color: '#6fd8ef',
    desc: '每级护盾上限 +12', value: function (lv) { return '当前 +' + (lv * 12) + ' 护盾'; }
  },
  {
    id: 'vitality', name: '生命维持', tag: 'VIT', max: 3,
    costs: [220, 460, 820], color: '#e2604f',
    desc: '每级生命上限 +12', value: function (lv) { return '当前 +' + (lv * 12) + ' 生命'; }
  },
  {
    id: 'pack', name: '负重模组', tag: 'INV', max: 2,
    costs: [300, 700], color: '#f0b04c',
    desc: '每级背包行数 +1', value: function (lv) { return '当前 6×' + (CFG.INV_ROWS + lv); }
  },
  {
    id: 'loader', name: '装填伺服', tag: 'SPD', max: 3,
    costs: [200, 420, 760], color: '#b491f0',
    desc: '每级换弹时间 -8%', value: function (lv) { return '当前 -' + (lv * 8) + '% 换弹'; }
  }
];

/* 芯片：通用芯片 + 系列专属芯片，1×1，每把最多 3 个。
   - 通用芯片用 stat/pct 做加法叠加
   - 系列芯片用 forTag 限定武器系别，用 bonus 提供独特加成 */
const CHIP_TYPES = [
  { id: 'power', name: '火力芯片', stat: 'dmg', pct: 0.10, short: '伤+10%', color: '#ff8155', desc: '伤害 +10%', weight: 10, tierId: 'fine', value: 90, price: 180 },
  { id: 'cycle', name: '循环芯片', stat: 'rate', pct: 0.10, short: '速+10%', color: '#ffd166', desc: '射速 +10%', weight: 10, tierId: 'fine', value: 80, price: 160 },
  { id: 'loader', name: '装填芯片', stat: 'reload', pct: 0.10, short: '装+10%', color: '#6fd8ef', desc: '换弹速度 +10%', weight: 10, tierId: 'common', value: 70, price: 140 },
  { id: 'gyro', name: '陀螺芯片', stat: 'recoil', pct: 0.15, short: '稳-15%', color: '#b491f0', desc: '后坐力 -15%', weight: 10, tierId: 'fine', value: 100, price: 200 },

  { id: 'sonic_amp', name: '声学共振芯片', short: '声域+30%', color: '#ffb648', forTag: '声学', bonus: { coneRange: 0.30 }, desc: '声学专属 · 冲击波范围 +30%', weight: 3, tierId: 'rare', value: 200, price: 400 },
  { id: 'laser_prism', name: '光学棱镜芯片', short: '反射+1', color: '#8fe3f2', forTag: '光学', bonus: { bounce: 1 }, desc: '光学专属 · 激光反射次数 +1', weight: 3, tierId: 'rare', value: 220, price: 440 },
  { id: 'thermal_spread', name: '热学扩散芯片', short: '燃域+25%', color: '#f0703c', forTag: '热学', bonus: { zoneR: 0.25 }, desc: '热学专属 · 燃烧区域半径 +25%', weight: 3, tierId: 'rare', value: 210, price: 420 },
  { id: 'kinetic_pierce', name: '力学穿甲芯片', short: '穿透+1', color: '#dde3ea', forTag: '力学', bonus: { pierce: 1 }, desc: '力学专属 · 子弹额外穿透 1 个目标', weight: 3, tierId: 'epic', value: 260, price: 520 },
  { id: 'voltaic_relay', name: '电学导流芯片', short: '链+1', color: '#b491f0', forTag: '电学', bonus: { chain: 1 }, desc: '电学专属 · 电弧额外跳 1 个目标', weight: 3, tierId: 'epic', value: 280, price: 560 }
];
const CHIP_BY_ID = {};
CHIP_TYPES.forEach(function (c) { CHIP_BY_ID[c.id] = c; });

const ITEMS = (function () {
  function tier(id) { return TIER_BY_ID[id] || TIERS[0]; }

  function chipDef(id) { return CHIP_BY_ID[id] || null; }

  /* rnd: 0..1；luck: 0..1，离出生点越远越容易出高品质 */
  function pickTier(rnd, luck) {
    luck = luck || 0;
    let total = 0;
    const w = [];
    for (let i = 0; i < TIERS.length; i++) {
      const t = TIERS[i];
      const k = 1 + luck * i * 1.1;
      w[i] = t.weight * k;
      total += w[i];
    }
    let r = (rnd ? rnd() : Math.random()) * total;
    for (let i = 0; i < TIERS.length; i++) {
      r -= w[i];
      if (r <= 0) return TIERS[i];
    }
    return TIERS[0];
  }

  function rollForTier(t, rnd) {
    const r = rnd || Math.random;
    const def = t.items[Math.floor(r() * t.items.length) % t.items.length];
    const value = t.min + Math.floor(r() * (t.max - t.min + 1));
    return {
      kind: 'material',
      name: def.name,
      tierId: t.id,
      w: def.w,
      h: def.h,
      value: value,
      time: t.time,
      gx: 0, gy: 0, rot: 0
    };
  }

  /* 生成一件物资；不给 tierId 就按权重随机 */
  function roll(tierId, rnd, luck) {
    const t = tierId ? tier(tierId) : pickTier(rnd, luck);
    return rollForTier(t, rnd);
  }

  /* 生成一块芯片；每种芯片固定品质与数据价值。
     系列芯片权重更低，避免专属芯片挤占通用芯片掉落。 */
  function rollChip(rnd, luck) {
    const r = rnd || Math.random;
    let total = 0;
    for (let i = 0; i < CHIP_TYPES.length; i++) total += CHIP_TYPES[i].weight || 10;
    let pick = r() * total;
    let def = CHIP_TYPES[0];
    for (let i = 0; i < CHIP_TYPES.length; i++) {
      pick -= CHIP_TYPES[i].weight || 10;
      if (pick <= 0) { def = CHIP_TYPES[i]; break; }
    }
    return makeChipItem({
      chipId: def.id,
      tierId: def.tierId || 'fine',
      value: def.value
    });
  }

  function makeChipItem(entry) {
    const def = chipDef(entry && entry.chipId);
    if (!def) return null;
    const t = tier(entry.tierId || def.tierId);
    return {
      kind: 'chip',
      chipId: def.id,
      name: def.name,
      tierId: t.id,
      w: 1, h: 1,
      value: entry.value === undefined ? (def.value || 0) : Math.max(0, entry.value | 0),
      time: t.time,
      gx: 0, gy: 0, rot: 0
    };
  }

  function chipEntry(it) {
    if (!it || it.kind !== 'chip' || !chipDef(it.chipId)) return null;
    return { chipId: it.chipId, tierId: it.tierId || 'common', value: Math.max(0, it.value | 0) };
  }

  /* 武器物品：统一 3×1，可放入仓库/物资箱；chips 跟随武器保存 */
  function makeWeaponItem(wi) {
    const w = WEAPONS[wi];
    if (!w) return null;
    const t = tier(w.tierId || 'rare');
    return {
      kind: 'weapon',
      weaponId: wi,
      name: w.name,
      tierId: t.id,
      w: 3, h: 1,
      value: w.value || 0,
      time: 2.6,
      chips: [],
      gx: 0, gy: 0, rot: 0
    };
  }

  function weaponChips(item) {
    if (!item || item.kind !== 'weapon') return [];
    return Array.isArray(item.chips) ? item.chips : [];
  }

  /* 系列芯片只能装在对应 tag 的武器上；通用芯片 forTag 为空，任何武器都能用 */
  function chipFitsWeapon(chip, wi) {
    const def = chipDef(chip && chip.chipId);
    if (!def) return false;
    if (!def.forTag) return true;
    return !!(WEAPONS[wi] && WEAPONS[wi].tag === def.forTag);
  }

  function chipRestriction(chip) {
    const def = chipDef(chip && chip.chipId);
    return def && def.forTag ? def.forTag : '';
  }

  /* 武器修正：通用芯片 stat/pct + 系列芯片 bonus，全部加法叠加 */
  function computeMods(list) {
    const out = {
      dmg: 0, rate: 0, reload: 0, recoil: 0,
      coneRange: 0, bounce: 0, zoneR: 0, pierce: 0, chain: 0
    };
    for (let i = 0; i < (list || []).length; i++) {
      const def = chipDef(list[i].chipId);
      if (!def) continue;
      if (def.stat && out[def.stat] !== undefined) out[def.stat] += def.pct || 0;
      if (def.bonus) {
        for (const k in def.bonus) {
          if (out[k] !== undefined) out[k] += def.bonus[k];
        }
      }
    }
    out.rate = Math.min(0.6, out.rate);
    out.reload = Math.min(0.6, out.reload);
    out.recoil = Math.min(0.75, out.recoil);
    out.coneRange = Math.min(1.2, out.coneRange);
    out.zoneR = Math.min(1.0, out.zoneR);
    out.bounce = Math.min(3, out.bounce);
    out.pierce = Math.min(3, out.pierce);
    out.chain = Math.min(3, out.chain);
    return out;
  }

  function colorOf(item) {
    if (item && item.kind === 'weapon' && WEAPONS[item.weaponId]) return WEAPONS[item.weaponId].color;
    return tier(item && item.tierId).color;
  }

  function label(item) {
    if (!item) return '';
    if (item.kind === 'weapon') {
      const w = WEAPONS[item.weaponId];
      return w ? (w.tag + ' · ' + w.name) : '武器';
    }
    if (item.kind === 'chip') {
      const c = chipDef(item.chipId);
      return c ? (c.name + ' · ' + c.desc) : '芯片';
    }
    if (item.kind === 'material') {
      return tier(item.tierId).name + ' · ' + item.w + '×' + item.h;
    }
    const s = SUPPLY_BY_ID[item.supplyId];
    return s ? s.name : '补给';
  }

  return {
    tier: tier,
    pickTier: pickTier,
    roll: roll,
    rollForTier: rollForTier,
    rollChip: rollChip,
    chipDef: chipDef,
    chipFitsWeapon: chipFitsWeapon,
    chipRestriction: chipRestriction,
    computeMods: computeMods,
    makeChipItem: makeChipItem,
    makeWeaponItem: makeWeaponItem,
    weaponChips: weaponChips,
    chipEntry: chipEntry,
    colorOf: colorOf,
    label: label
  };
})();
