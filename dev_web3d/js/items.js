'use strict';

/* ============================================================
   物品 / 品质 / 补给 / 强化 —— 局外系统内容表
   - 物资尺寸按种类固定，和 dev_html 原型一致
   - 品质决定颜色、价值区间、分解耗时、掉落权重
   ============================================================ */

/* 五系元素：和武器系列 / 专属芯片共用同一套名称与配色 */
const ELEMENTS = [
  { id: 'acoustic', name: '声学', color: '#ffb648' },
  { id: 'optical', name: '光学', color: '#9fe6ff' },
  { id: 'thermal', name: '热学', color: '#ff7043' },
  { id: 'kinetic', name: '力学', color: '#e8e8e8' },
  { id: 'voltaic', name: '电学', color: '#b28cff' }
];
const ELEMENT_BY_ID = {};
const ELEMENT_BY_TAG = {};
ELEMENTS.forEach(function (e) {
  ELEMENT_BY_ID[e.id] = e;
  ELEMENT_BY_TAG[e.name] = e;
});

/* 每种收集物固定元素表；品质只影响数据价值，不改变元素 */
const TIERS = [
  {
    id: 'common', name: '常见', color: '#9aa4ad', min: 8, max: 16,
    time: 1.0, weight: 50,
    items: [
      { name: '磨损存储片', w: 1, h: 1, elements: { optical: 3 } },
      { name: '氧化内存条', w: 1, h: 2, elements: { voltaic: 4 } },
      { name: '杂讯磁带', w: 2, h: 1, elements: { acoustic: 5 } },
      { name: '废弃传感器', w: 1, h: 1, elements: { optical: 2, kinetic: 2 } }
    ]
  },
  {
    id: 'fine', name: '优良', color: '#5ad46a', min: 28, max: 44,
    time: 1.8, weight: 30,
    items: [
      { name: '加密数据块', w: 2, h: 2, elements: { optical: 6, voltaic: 3 } },
      { name: '校验芯片', w: 1, h: 1, elements: { optical: 6 } },
      { name: '冷却核心', w: 1, h: 2, elements: { thermal: 8 } },
      { name: '结构蓝图', w: 2, h: 1, elements: { kinetic: 7 } }
    ]
  },
  {
    id: 'rare', name: '稀有', color: '#4d8bff', min: 70, max: 100,
    time: 2.8, weight: 14,
    items: [
      { name: '相位碎片', w: 2, h: 2, elements: { optical: 9, voltaic: 6 } },
      { name: '拓扑密钥', w: 1, h: 3, elements: { kinetic: 10, optical: 5 } },
      { name: '湮灭记录仪', w: 3, h: 1, elements: { thermal: 11, acoustic: 5 } }
    ]
  },
  {
    id: 'epic', name: '史诗', color: '#b96bff', min: 160, max: 220,
    time: 4.0, weight: 6,
    items: [
      { name: '奇点残核', w: 2, h: 3, elements: { voltaic: 16, kinetic: 12 } },
      { name: 'ATA 黑匣', w: 3, h: 2, elements: { optical: 16, acoustic: 10 } },
      { name: '熵减样本', w: 2, h: 2, elements: { thermal: 18, optical: 10 } }
    ]
  }
];

const TIER_BY_ID = {};
TIERS.forEach(function (t) { TIER_BY_ID[t.id] = t; });

/* 战术道具：局外配置，最多携带两种；局内用 Q / E 长按瞄准、松手使用。
   - cost 为每次使用立刻扣除的局内数据
   - cooldown 为使用后的冷却秒数
   - 道具不是收集物，不会进入背包 / 仓库，也不能在局内更换 */
const GADGETS = [
  {
    id: 'knife', name: '飞刀', tag: '力学', color: '#e8e8e8', accent: '#DDE3EA',
    cost: 60, cooldown: 7,
    damage: 55, range: 16, speed: 36,
    desc: '向前投出飞刀，直线贯穿命中的敌人'
  },
  {
    id: 'grenade', name: '手榴弹', tag: '力学', color: '#ffb648', accent: '#F0B04C',
    cost: 120, cooldown: 18,
    damage: 110, radius: 4.2, range: 18, flight: 0.62,
    desc: '越过墙体投掷，落点爆炸造成范围伤害；落点不能进入有屋顶的房屋'
  },
  {
    id: 'radiation', name: '辐射场', tag: '热学', color: '#ff7043', accent: '#F0703C',
    cost: 100, cooldown: 26,
    radius: 4.0, duration: 8, dps: 16,
    desc: '在脚下放置装置，持续灼烧附近敌人'
  }
];
const GADGET_BY_ID = {};
GADGETS.forEach(function (g) {
  g.rgb = hexRgb(g.color);
  GADGET_BY_ID[g.id] = g;
});

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

  { id: 'sonic_amp', name: '声学共振芯片', short: '声域+30%', color: '#ffb648', forTag: '声学', bonus: { coneRange: 0.30 }, elements: { acoustic: 20 }, desc: '声学专属 · 冲击波范围 +30%', weight: 3, tierId: 'rare', value: 200, price: 400 },
  { id: 'laser_prism', name: '光学棱镜芯片', short: '反射+1', color: '#8fe3f2', forTag: '光学', bonus: { bounce: 1 }, elements: { optical: 22 }, desc: '光学专属 · 激光反射次数 +1', weight: 3, tierId: 'rare', value: 220, price: 440 },
  { id: 'thermal_spread', name: '热学扩散芯片', short: '燃域+25%', color: '#f0703c', forTag: '热学', bonus: { zoneR: 0.25 }, elements: { thermal: 21 }, desc: '热学专属 · 燃烧区域半径 +25%', weight: 3, tierId: 'rare', value: 210, price: 420 },
  { id: 'kinetic_pierce', name: '力学穿甲芯片', short: '穿透+1', color: '#dde3ea', forTag: '力学', bonus: { pierce: 1 }, elements: { kinetic: 28 }, desc: '力学专属 · 子弹额外穿透 1 个目标', weight: 3, tierId: 'epic', value: 260, price: 520 },
  { id: 'voltaic_relay', name: '电学导流芯片', short: '链+1', color: '#b491f0', forTag: '电学', bonus: { chain: 1 }, elements: { voltaic: 30 }, desc: '电学专属 · 电弧额外跳 1 个目标', weight: 3, tierId: 'epic', value: 280, price: 560 }
];
const CHIP_BY_ID = {};
CHIP_TYPES.forEach(function (c) { CHIP_BY_ID[c.id] = c; });

const ITEMS = (function () {
  const MATERIAL_ELEMENTS = {};
  TIERS.forEach(function (t) {
    t.items.forEach(function (it) { MATERIAL_ELEMENTS[it.name] = it.elements || {}; });
  });

  const FALLBACK_EL_AMOUNT = { common: 3, fine: 6, rare: 12, epic: 24 };

  function tier(id) { return TIER_BY_ID[id] || TIERS[0]; }

  function chipDef(id) { return CHIP_BY_ID[id] || null; }

  function cleanElements(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const id in raw) {
      if (!ELEMENT_BY_ID[id]) continue;
      const n = Math.floor(Number(raw[id]));
      if (isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }

  function cloneElements(raw) { return cleanElements(raw); }

  function addElements(dst, src) {
    const clean = cleanElements(src);
    for (const id in clean) dst[id] = (dst[id] || 0) + clean[id];
    return dst;
  }

  function elementPool(raw) {
    const out = {};
    const clean = cleanElements(raw);
    ELEMENTS.forEach(function (e) { out[e.id] = clean[e.id] || 0; });
    return out;
  }

  /* 五系元素统一给同一个初始数量 */
  function fullElementPool(n) {
    const out = {};
    const v = Math.max(0, Math.round(n || 0));
    ELEMENTS.forEach(function (e) { out[e.id] = v; });
    return out;
  }

  function elementEntries(raw) {
    const clean = cleanElements(raw);
    const out = [];
    ELEMENTS.forEach(function (e) {
      if (clean[e.id] > 0) out.push({ id: e.id, name: e.name, color: e.color, amount: clean[e.id] });
    });
    return out;
  }

  function elementSummary(raw) {
    return elementEntries(raw).map(function (e) { return e.name + ' ' + e.amount; }).join(' · ');
  }

  function elementTotal(raw) {
    let n = 0;
    const clean = cleanElements(raw);
    for (const id in clean) n += clean[id];
    return n;
  }

  function hasElements(raw) { return elementTotal(raw) > 0; }

  function fallbackMaterialElements(name, tierId) {
    const t = tier(tierId);
    const s = String(name || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const e = ELEMENTS[h % ELEMENTS.length];
    if (!e) return {};
    const out = {};
    out[e.id] = FALLBACK_EL_AMOUNT[t.id] || FALLBACK_EL_AMOUNT.fine;
    return out;
  }

  function elementsForMaterial(name, tierId) {
    return cloneElements(MATERIAL_ELEMENTS[name] || fallbackMaterialElements(name, tierId));
  }

  function elementsForWeapon(wi) {
    return cloneElements(WEAPONS[wi] && WEAPONS[wi].elements);
  }

  function elementsForChip(chipId) {
    const def = chipDef(chipId);
    return cloneElements(def && def.elements);
  }

  function cloneChipEntry(entry) {
    if (!entry || !chipDef(entry.chipId)) return null;
    const def = chipDef(entry.chipId);
    const tierId = TIER_BY_ID[entry.tierId] ? entry.tierId : (def.tierId || 'common');
    return {
      chipId: entry.chipId,
      tierId: tierId,
      value: Math.max(0, entry.value | 0),
      elements: entry.elements !== undefined
        ? cloneElements(entry.elements)
        : elementsForChip(entry.chipId)
    };
  }

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
      elements: cloneElements(def.elements),
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
    }, { found: true });
  }

  function makeChipItem(entry, opts) {
    const def = chipDef(entry && entry.chipId);
    if (!def) return null;
    const t = tier(entry.tierId || def.tierId);
    const elements = entry.elements !== undefined
      ? cloneElements(entry.elements)
      : ((opts && opts.found) ? elementsForChip(def.id) : {});
    return {
      kind: 'chip',
      chipId: def.id,
      name: def.name,
      tierId: t.id,
      w: 1, h: 1,
      value: entry.value === undefined ? (def.value || 0) : Math.max(0, entry.value | 0),
      time: t.time,
      elements: elements,
      gx: 0, gy: 0, rot: 0
    };
  }

  function chipEntry(it) {
    if (!it || it.kind !== 'chip' || !chipDef(it.chipId)) return null;
    return cloneChipEntry(it);
  }

  /* 武器物品：统一 3×1，可放入仓库/物资箱；chips 跟随武器保存。
     opts.found = true 时带出该武器固定元素；制造品默认不带元素。 */
  function makeWeaponItem(wi, opts) {
    const w = WEAPONS[wi];
    if (!w) return null;
    const t = tier(w.tierId || 'rare');
    const elements = (opts && opts.elements !== undefined)
      ? cloneElements(opts.elements)
      : ((opts && opts.found) ? elementsForWeapon(wi) : {});
    return {
      kind: 'weapon',
      weaponId: wi,
      name: w.name,
      tierId: t.id,
      w: 3, h: 1,
      value: w.value || 0,
      time: 2.6,
      chips: [],
      elements: elements,
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
    return '物资';
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
    cloneChipEntry: cloneChipEntry,
    cleanElements: cleanElements,
    cloneElements: cloneElements,
    addElements: addElements,
    elementPool: elementPool,
    fullElementPool: fullElementPool,
    elementEntries: elementEntries,
    elementSummary: elementSummary,
    elementTotal: elementTotal,
    hasElements: hasElements,
    elementsForMaterial: elementsForMaterial,
    elementsForWeapon: elementsForWeapon,
    elementsForChip: elementsForChip,
    colorOf: colorOf,
    label: label
  };
})();
