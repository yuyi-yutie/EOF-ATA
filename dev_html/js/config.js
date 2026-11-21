'use strict';

/* ============================================================
   EOFATA — 数值与配置
   调平衡基本只需要改这个文件
   ============================================================ */

const CFG = {
  VW: 1280,
  VH: 720,
  TILE: 32,
  MAP_W: 128,
  MAP_H: 96,

  BUILDINGS: 18,
  COVERS: 96,
  LOOT_COUNT: 82,

  INV_COLS: 6,
  INV_ROWS: 4,
  INV_SIZE: 24,

  HEAL_COST: 50,
  HEAL_TIME: 3.0,
  MAG_TIME: 1.5,
  EXTRACT_HOLD: 6.0,
  INTERACT_RANGE: 62,

  PLAYER: {
    r: 12,
    speed: 200,
    walkSpeed: 122,
    hp: 100,
    shield: 60,
    shieldDelay: 4.5,
    shieldRate: 30,
    stamina: 100,
    staminaDrain: 21,
    staminaRegen: 17,
    staminaDelay: 0.7,
    staminaRecover: 28
  },

  /* 敌人：近战 / 冲锋 / 远程 */
  ENEMY: {
    crawler: {
      key: 'crawler', name: '裂体', hp: 45, speed: 112, dmg: 8, r: 11,
      color: '#ff6b5a', dark: '#5c211b', windup: 0.22, cd: 0.85,
      behavior: 'melee'
    },
    brute: {
      key: 'brute', name: '蚀甲体', hp: 140, speed: 64, dmg: 16, r: 16,
      color: '#d8a03c', dark: '#4d3a12', windup: 0.32, cd: 1.15,
      behavior: 'melee'
    },
    charger: {
      key: 'charger', name: '突刺体', hp: 72, speed: 98, dmg: 20, r: 12,
      color: '#ff9f43', dark: '#5a3210', windup: 0.52, cd: 2.6,
      behavior: 'charger', dashSpeed: 540, dashTime: 0.30
    },
    spitter: {
      key: 'spitter', name: '喷吐体', hp: 95, speed: 76, dmg: 12, r: 13,
      color: '#c07bff', dark: '#3d1f52', windup: 0.2, cd: 2.2,
      behavior: 'ranged', keepMin: 230, keepMax: 420,
      shotSpeed: 330, shotDmg: 12, shotLife: 3.2
    }
  },

  ENEMY_COUNT: 52,
  PACK_COUNT: 13,

  /* 撤离台 */
  PAD_R: 66
};

/* ------------------------------------------------------------
   五把武器：声学 / 光学 / 热学 / 力学 / 电学
   ------------------------------------------------------------ */
const WEAPONS = [
  {
    id: 'sonic', slot: 1, name: '共振霰弹', tag: '声学', color: '#ffb648',
    mag: 6, maxSpare: 2, rate: 0.75, reload: 2.4, cost: 40, noise: 760,
    dmg: 40, dmgFar: 16, range: 268, halfAngle: 33, knock: 150,
    desc: '开火释放扇形冲击波，随距离衰减，可击退近身敌人。'
  },
  {
    id: 'laser', slot: 2, name: '棱镜激光', tag: '光学', color: '#9fe6ff',
    mag: 6, maxSpare: 2, rate: 0.5, reload: 2.0, cost: 60, noise: 560,
    dmg: 46, bounce: 3, beamLen: 2600, falloff: 0.85, width: 3,
    desc: '开火瞬间结算整条反射路径上的所有敌人，可在墙面反射 3 次。'
  },
  {
    id: 'thermal', slot: 3, name: '辐射投射器', tag: '热学', color: '#ff7043',
    mag: 5, maxSpare: 2, rate: 0.9, reload: 2.6, cost: 70, noise: 560,
    dmg: 10, speed: 620, zoneR: 76, zoneLife: 3.2, tick: 3.5, tickRate: 0.25,
    desc: '弹体命中处生成辐射场，持续灼烧区域内敌人。'
  },
  {
    id: 'kinetic', slot: 4, name: '轨道步枪', tag: '力学', color: '#e8e8e8',
    mag: 12, maxSpare: 2, rate: 0.28, reload: 1.8, cost: 25, noise: 520,
    dmg: 34, speed: 1800,
    desc: '最朴素的高速动能弹，单发高伤、后坐极小。'
  },
  {
    id: 'voltaic', slot: 5, name: '电弧枪', tag: '电学', color: '#b28cff',
    mag: 8, maxSpare: 2, rate: 0.45, reload: 2.0, cost: 60, noise: 540,
    dmg: 22, speed: 1150, chainR: 152, chainMax: 3, chainMul: [0.6, 0.4, 0.25],
    desc: '击中后向附近敌人链式放电，最多连锁 3 个目标。'
  }
];

/* ------------------------------------------------------------
   收集物品质
   ------------------------------------------------------------ */
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
TIERS.forEach(t => { TIER_BY_ID[t.id] = t; });
