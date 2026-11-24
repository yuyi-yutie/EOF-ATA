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

const ITEMS = (function () {
  function tier(id) { return TIER_BY_ID[id] || TIERS[0]; }

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

  function colorOf(item) {
    return tier(item && item.tierId).color;
  }

  function label(item) {
    if (!item) return '';
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
    colorOf: colorOf,
    label: label
  };
})();
