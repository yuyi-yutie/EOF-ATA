'use strict';

/* ============================================================
   EOFATA 3D — 配置
   1 世界单位 = 1 米；地图格 2m；角色 1.7m
   ============================================================ */

/* 可用 ?pitch=45 直接指定开局俯角，方便试镜头 */
const QS = (typeof location !== 'undefined' && location.search)
  ? new URLSearchParams(location.search) : new URLSearchParams('');
const Q_PITCH = parseInt(QS.get('pitch'), 10);
const Q_DIST = parseFloat(QS.get('dist'));

const CFG = {
  CELL: 2.0,          // 地图格边长（米）
  MAP_W: 44,          // 格
  MAP_H: 44,

  WALL_H: 2.4,
  WALL_T: 2.0,        // 墙体占满整格

  /* 镜头 */
  CAM: {
    FOV: 44,
    PITCH: (Q_PITCH >= 30 && Q_PITCH <= 90) ? Q_PITCH : 70,   // 与地面夹角（度）——[ ] 切换
    DIST: (Q_DIST > 3 && Q_DIST < 40) ? Q_DIST : 12.5,       // 相机到目标的距离
    HEIGHT_OFF: 1.1,  // 目标点高度
    LERP: 9.0         // 跟随平滑
  },

  /* 玩家视野锥：视锥外的敌人不绘制、不上小地图 */
  VISION: {
    HALF_DEG: 180,     // 玩家全向视野（360°）
    RANGE: 24,         // 有效距离（米）
    EDGE_SOFT_DEG: 3.5, // 视锥侧边柔和带（角度）
    SHADE: 0.42        // 视野外地面阴影亮度（1 = 无阴影）
  },

  /* 触屏双摇杆：比例都相对于摇杆底座半径 */
  TOUCH: {
    INNER: 0.55,       // 内圆直径 / 底座直径
    DEAD: 0.13,        // 中心死区
    AIM_LERP: 22       // 上半身瞄准跟随速度
  },

  PLAYER: {
    r: 0.42,
    walk: 3.4,
    run: 5.6,
    hp: 100,
    shield: 60,
    shieldDelay: 4.5,
    shieldRate: 12,
    stam: 100,
    stamDrain: 21,
    stamRegen: 17,
    stamDelay: 0.7
  },

  ENEMY: {
    zombie: { name: '僵尸', hp: 45, speed: 3.3, dmg: 8, r: 0.45, color: 'zombie', cd: 0.85 },
    spitter: { name: '喷吐僵尸', hp: 95, speed: 2.2, dmg: 12, r: 0.48, color: 'spitter', cd: 2.2 },
    gaunt: { name: '干尸', hp: 32, speed: 4.2, dmg: 6, r: 0.40, color: 'gaunt', cd: 0.7 },
    scav: { name: '拾荒者 · 灰鼠', hp: 70, speed: 2.9, dmg: 0, r: 0.42, color: 'zombie', cd: 0.85 },
    raider: { name: '拾荒者 · 暴徒', hp: 70, speed: 2.9, dmg: 0, r: 0.42, color: 'zombie', cd: 0.85 },
    veteran: { name: '拾荒者 · 老油条', hp: 70, speed: 2.9, dmg: 0, r: 0.42, color: 'zombie', cd: 0.85 }
  },
  ENEMY_COUNT: 26,

  /* 拾荒者枪手：与丧尸混编；第一版三种使用同一套 AI 与数值 */
  GUNNER_COUNT: 9,
  GUNNER: {
    weaponId: 3,              // 力学 · 轨道步枪
    viewR: 18,
    viewHalf: 1.05,
    reaction: 0.5,
    burstMin: 3,
    burstMax: 5,
    spread: 0.075,
    rangeMin: 6,
    rangeMax: 14,
    bagCols: 4,
    bagRows: 3,
    maxLoot: 6,
    corpseCols: 4,
    corpseRows: 3,
    lootR: 1.3,
    reload: 1.8
  },

  /* 敌群：开局在离玩家一定距离外的房间刷 */
  SPAWN_MIN: 16,

  /* 开局在玩家周围环形刷新的数量 */
  NEAR_SPAWN: 5,

  EXTRACT_R: 3.2,
  EXTRACT_HOLD: 6.0,
  INTERACT_R: 2.2,

  LOOT_COUNT: 26,

  /* 可开启物资箱（训练场） */
  CHEST_COLS: 4,
  CHEST_ROWS: 4,
  CHEST_ITEMS: 6,
  CHEST_R: 0.55,
  CHEST_INTERACT_R: 1.8,   // 靠近自动撬箱 / F 搜索的判定距离（已扣除箱体半径）
  WEAPON_CHEST_COLS: 3,
  WEAPON_CHEST_ROWS: 2,
  WEAPON_CHEST_COUNT: 2,
  WEAPON_CHEST_R: 0.72,
  CHEST_PRY_TIME: 1.6,
  CHEST_OPEN_DELAY: 0.55,
  CHEST_SEARCH_TIME: 0.34,
  CHEST_SEARCH_GAP: 0.10,

  /* ----------------------------------------------------------
     局外系统（大厅 / 仓库 / 背包 / 经济）
     ---------------------------------------------------------- */
  START_BANK: 10000,        // 新档数据
  CARRY_UNIT: 100,          // 出征数据的最小单位
  CARRY_MAX_MAGS: 3,        // 每把武器可配给的初始弹夹（含枪内）

  INV_COLS: 6,
  INV_ROWS: 4,
  STASH_COLS: 12,
  STASH_ROWS: 8,

  HEAL_COST: 50,
  HEAL_TIME: 3.0,
  MAG_TIME: 1.5,
  KIT_TIME: 0.7
};

/* ------------------------------------------------------------
   五把武器：数值沿用 2D 原型
   ------------------------------------------------------------ */
const WEAPONS = [
  { id: 'sonic', auto: false, name: '共振霰弹', tag: '声学', color: '#ffb648', accent: '#F0B04C',
    mag: 6, maxSpare: 2, rate: 0.75, reload: 2.4, dmg: 40, dmgFar: 16, cost: 40,
    range: 26, halfAngle: 33, recoil: 0.9, kick: 1.15, noise: 760,
    craft: 1600, value: 640, tierId: 'rare',
    desc: '扇形冲击波，随距离衰减' },
  { id: 'laser', auto: false, name: '棱镜激光', tag: '光学', color: '#9fe6ff', accent: '#8FE3F2',
    mag: 6, maxSpare: 2, rate: 0.5, reload: 2.0, dmg: 46, dmgFar: 34, cost: 60,
    range: 60, bounce: 3, falloff: 0.85, recoil: 0.3, kick: 0.55, noise: 560,
    craft: 1800, value: 720, tierId: 'rare',
    desc: '单发高伤光束' },
  { id: 'thermal', auto: false, name: '辐射投射器', tag: '热学', color: '#ff7043', accent: '#F0703C',
    mag: 5, maxSpare: 2, rate: 0.9, reload: 2.6, dmg: 34, dmgFar: 20, cost: 70,
    range: 40, speed: 24, zoneR: 3.1, zoneLife: 3.2, tickDmg: 3.5, recoil: 1.4, kick: 1.3, noise: 560,
    craft: 1700, value: 680, tierId: 'rare',
    desc: '弹体命中后灼烧一小片区域' },
  { id: 'kinetic', auto: true, name: '轨道步枪', tag: '力学', color: '#e8e8e8', accent: '#DDE3EA',
    mag: 30, maxSpare: 2, rate: 0.28, reload: 1.8, dmg: 20, dmgFar: 16, cost: 25,
    range: 70, speed: 60, recoil: 0.35, kick: 0.5, noise: 520,
    craft: 1200, value: 480, tierId: 'fine',
    desc: '高速动能弹，全自动压制' },
  { id: 'voltaic', auto: false, name: '电弧枪', tag: '电学', color: '#b28cff', accent: '#B491F0',
    mag: 8, maxSpare: 2, rate: 0.45, reload: 2.0, dmg: 22, dmgFar: 14, cost: 60,
    range: 34, speed: 42, chainR: 6.0, chainMax: 3, chainMul: [0.6, 0.4, 0.25], recoil: 0.5, kick: 0.75, noise: 540,
    craft: 2000, value: 800, tierId: 'epic',
    desc: '命中后向附近敌人放电' }
];

/* ------------------------------------------------------------
   调色板（与 artbible 一致）
   ------------------------------------------------------------ */
const PAL = {
  floor: [0.62, 0.49, 0.38],
  grout: [0.31, 0.26, 0.21],
  wall: [0.85, 0.79, 0.71],
  wallCap: [0.79, 0.72, 0.61],
  slab: [0.20, 0.21, 0.24],

  slate: [0.18, 0.21, 0.25],
  slateM: [0.24, 0.28, 0.34],
  slateL: [0.32, 0.37, 0.45],
  steel: [0.73, 0.76, 0.80],
  amber: [0.94, 0.69, 0.30],
  visor: [0.53, 0.91, 0.95],

  skin: [0.79, 0.60, 0.46],
  hair: [0.23, 0.18, 0.16],
  helmet: [0.23, 0.26, 0.30],
  scout: [0.25, 0.36, 0.38],
  scoutVest: [0.36, 0.50, 0.51],
  scoutPants: [0.16, 0.23, 0.26],

  olive: [0.56, 0.68, 0.42],
  oliveM: [0.43, 0.54, 0.32],
  oliveD: [0.29, 0.34, 0.22],

  blue: [0.50, 0.66, 0.82],
  blueM: [0.35, 0.49, 0.65],
  blueD: [0.21, 0.29, 0.42],
  violet: [0.73, 0.55, 1.00],

  tactical: [0.205, 0.235, 0.240],
  tacticalL: [0.300, 0.335, 0.330],
  tacticalD: [0.105, 0.120, 0.125],
  tacticalVest: [0.300, 0.335, 0.315],
  tacticalTan: [0.430, 0.395, 0.300],
  tacticalCyan: [0.390, 0.860, 0.880],

  ragBrown: [0.330, 0.270, 0.195],
  ragBrownL: [0.450, 0.375, 0.270],
  ragGrey: [0.245, 0.240, 0.215],
  ragOlive: [0.325, 0.325, 0.245],
  ragRust: [0.500, 0.285, 0.175],
  ragSkin: [0.620, 0.485, 0.380],
  ragHair: [0.150, 0.125, 0.105],
  ragLeather: [0.270, 0.205, 0.150],

  gaunt: [0.70, 0.67, 0.56],
  gauntM: [0.49, 0.48, 0.38],
  gauntD: [0.33, 0.32, 0.25],

  gun: [0.20, 0.22, 0.25],
  gunL: [0.29, 0.32, 0.36],
  wood: [0.66, 0.49, 0.31],
  woodD: [0.48, 0.34, 0.21],
  teal: [0.25, 0.37, 0.39],
  ink: [0.086, 0.075, 0.059]
};

/* 灯光方向（指向光源） */
const LIGHT = (function () {
  const v = [-0.30, 0.86, 0.41];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
})();

/* 十六进制色 -> [r,g,b]（0..1），渲染器只吃数值数组 */
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
WEAPONS.forEach(function (w) {
  w.rgb = hexRgb(w.color);
  w.rgb2 = hexRgb(w.accent);
});