'use strict';

/* ============================================================
   局内语言气泡
   - 固定台词表，按单位类型 / 事件随机播放
   - 只显示玩家 24m 感知半径内的台词（声音性质，不看墙体）
   - 屏幕内：气泡浮在说话者头顶；屏幕外：贴边显示并带方向箭头
   ============================================================ */

const Speech = (function () {
  const RANGE = (typeof CFG !== 'undefined' && CFG.VISION) ? CFG.VISION.RANGE : 24;
  const LIFE = 2.6;
  const COMPACT_AT = 5;
  const LOOT_CHANCE = 0.55;
  const IDLE_CHANCE = 0.10;
  const IDLE_MIN = 22;
  const IDLE_MAX = 40;

  /* 阵营代表色 */
  const COLORS = {
    undead: '#e2604f',
    scav: '#f0b04c',
    squad: '#6fd8ef'
  };

  /* 同类台词的单个单位冷却（秒） */
  const COOLDOWN = {
    detect: 7,
    loot: 7,
    idle: 60,
    cover: 9,
    reload: 9,
    door: 10,
    hostile: 12,
    warn: 14,
    kill: 6
  };

  const LINES = {
    undead: {
      detect: ['（吼叫~）'],
      idle: [
        '（低吼……）',
        '（喉咙里的咕噜声）',
        '（拖着脚步的喘息）'
      ]
    },
    scav: {
      detect: [
        '我去这啥',
        '有人！',
        '谁在那儿？',
        '见鬼，怎么撞上了',
        '别过来啊！',
        '有活人！',
        '坏了，是敌袭！',
        '站住！'
      ],
      loot: [
        '这下赚翻了',
        '嘿嘿，归我了',
        '这玩意儿值钱',
        '发财了发财了',
        '捡到宝了',
        '今晚加餐'
      ],
      idle: [
        '这地方真够破的',
        '今天又白跑一趟',
        '烟都没了',
        '有人来过这儿',
        '得赶紧换个地方',
        '这箱子怎么是空的'
      ]
    },
    squad: {
      detect: [
        '发现目标。',
        '接触！十一点方向。',
        '锁定敌人，准备交火。',
        '有动静，全队戒备。',
        '目标进入射程。'
      ],
      cover: [
        '找掩体！',
        '压制住他，我换位！',
        '掩护我！',
        '散开，别挤在一起！'
      ],
      reload: [
        '换弹，掩护我！',
        '弹匣空了，顶住！',
        '装填中，别让他过来！'
      ],
      door: [
        '开门，进！',
        '破门，跟上！',
        '门开了，保持队形！'
      ],
      hostile: [
        '敌袭！是那个干员！',
        '他先动的手，全队还击！',
        '目标转敌对，自由开火！'
      ],
      warn: [
        '退后，别靠这么近。',
        '离我远点。',
        '别跟着我，走开。',
        '再靠近一步我就不客气了。',
        '这里不欢迎你，滚开。',
        '站远点，别逼我开枪。'
      ],
      kill: [
        '目标清除。',
        '解决了。',
        '确认击毙。',
        '下一个。'
      ],
      idle: [
        '保持队形。',
        '这栋楼检查过了。',
        '无线电信号不太稳。',
        '注意脚下。',
        '别走太散。',
        '检查弹药，别掉队。'
      ]
    }
  };

  let layer = null;
  let bubbles = [];
  let pool = [];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function init() {
    if (layer) return;
    if (typeof UI === 'undefined') return;
    layer = UI.$('speechLayer');
  }

  function missionTime() {
    if (typeof G !== 'undefined' && G.state && typeof G.state.time === 'number') {
      return G.state.time;
    }
    return performance.now() / 1000;
  }

  function groupOf(unit) {
    if (!unit) return '';
    if (unit.squadRef) return 'squad';
    if (unit.gunner) return 'scav';
    return 'undead';
  }

  function speakerName(unit, group) {
    if (group === 'undead') {
      const def = (typeof CFG !== 'undefined' && CFG.ENEMY) ? CFG.ENEMY[unit.type] : null;
      return (def && def.name) || '僵尸';
    }
    if (group === 'squad') return unit.isLeader ? '清剿队长' : '清剿队员';
    return '拾荒者';
  }

  function allowed(unit) {
    if (!unit || unit.dead) return false;
    if (typeof G === 'undefined' || G.mode !== 'mission' || G.ended) return false;
    const p = G.state && G.state.player;
    if (!p || p.dead || p.extracted) return false;
    if (typeof Inventory !== 'undefined' && Inventory.isOpen()) return false;
    return Math.hypot(unit.x - p.x, unit.z - p.z) <= RANGE;
  }

  function pickLine(unit, group, event, lines) {
    unit.barkLast = unit.barkLast || {};
    const key = group + ':' + event;
    let idx = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && lines[idx] === unit.barkLast[key]) {
      idx = (idx + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
    }
    unit.barkLast[key] = lines[idx];
    return lines[idx];
  }

  /* 主入口：unit 为敌人对象，event 为 detect / loot / idle / cover / reload / door / hostile / warn / kill */
  function bark(unit, event) {
    if (!layer) init();
    if (!layer || !allowed(unit)) return false;
    const group = groupOf(unit);
    const lines = LINES[group] && LINES[group][event];
    if (!lines || !lines.length) return false;

    const t = missionTime();
    unit.barkCd = unit.barkCd || {};
    if ((unit.barkCd[event] || 0) > t) return false;
    /* 闲聊：低概率，且任何其他台词后 8 秒内不触发 */
    if (event === 'idle') {
      if (unit.barkAnyT !== undefined && t - unit.barkAnyT < 8) return false;
      if (Math.random() > IDLE_CHANCE) return false;
    }
    if (event === 'loot' && Math.random() > LOOT_CHANCE) return false;

    unit.barkCd[event] = t + (COOLDOWN[event] || 6);
    unit.barkAnyT = t;
    if (event !== 'idle') {
      /* 战斗 / 搜刮台词后，把下一次闲聊往后推 */
      unit.idleChatT = Math.max(unit.idleChatT || 0, 12 + Math.random() * 12);
    }
    show(unit, group, pickLine(unit, group, event, lines));
    return true;
  }

  /* 脱战、非搜刮状态下的低频闲聊计时 */
  function calm(unit) {
    if (!unit || unit.dead || unit.seen) return false;
    if (unit.state !== 'idle' && unit.state !== 'patrol') return false;
    if (unit.lootTarget || unit.pryingChest) return false;
    if (unit.squadRef && unit.squadRef.combatT) {
      const t = missionTime();
      if (t - unit.squadRef.combatT < 8) return false;
    }
    return true;
  }

  function idleTick(unit, dt) {
    if (!calm(unit)) return;
    if (unit.idleChatT === undefined) unit.idleChatT = 10 + Math.random() * 20;
    unit.idleChatT -= dt;
    if (unit.idleChatT > 0) return;
    unit.idleChatT = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
    bark(unit, 'idle');
  }

  function makeNode() {
    const el = document.createElement('div');
    el.className = 'speech-bubble';
    const box = document.createElement('div');
    box.className = 'sp-box';
    const name = document.createElement('span');
    name.className = 'sp-name';
    const text = document.createElement('span');
    text.className = 'sp-text';
    const arrow = document.createElement('i');
    arrow.className = 'sp-arrow';
    box.appendChild(name);
    box.appendChild(text);
    el.appendChild(box);
    el.appendChild(arrow);
    return { el: el, name: name, text: text, arrow: arrow, unit: null, w: 0, h: 0, t: 0, life: 0, fade: false };
  }

  function acquire() {
    const b = pool.pop() || makeNode();
    if (b.el.parentNode !== layer) layer.appendChild(b.el);
    b.el.style.display = 'block';
    b.el.style.left = '0px';
    b.el.style.top = '0px';
    return b;
  }

  function measure(b) {
    b.w = b.el.offsetWidth || 0;
    b.h = b.el.offsetHeight || 0;
    b.needMeasure = false;
  }

  function show(unit, group, text) {
    const b = acquire();
    b.unit = unit;
    b.t = 0;
    b.life = LIFE + Math.random() * 0.35;
    b.fade = false;
    b.el.className = 'speech-bubble sp-' + group;
    b.el.style.setProperty('--sp', COLORS[group]);
    b.name.textContent = speakerName(unit, group);
    b.text.textContent = text;
    /* 先让图层可见，否则父级 display:none 时量出来的宽高是 0 */
    layer.classList.remove('hidden');
    measure(b);
    b.needMeasure = true;
    /* 强制一次布局，让透明度过渡从 0 开始 */
    void b.el.offsetWidth;
    b.el.classList.add('on');
    bubbles.push(b);
  }

  function release(b) {
    b.el.classList.remove('on');
    b.el.style.display = 'none';
    b.unit = null;
    b.w = 0;
    b.h = 0;
    pool.push(b);
  }

  function clear() {
    for (let i = 0; i < bubbles.length; i++) release(bubbles[i]);
    bubbles.length = 0;
    if (layer) layer.classList.add('hidden');
  }

  function update(dt) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      if (!b.fade && b.t >= b.life - 0.3) {
        b.fade = true;
        b.el.classList.remove('on');
      }
      if (b.t >= b.life) {
        release(b);
        bubbles.splice(i, 1);
      }
    }
  }

  function setPos(b, left, top) {
    b.el.style.left = Math.round(left) + 'px';
    b.el.style.top = Math.round(top) + 'px';
  }

  /* 把小三角放到气泡朝向说话者的边上，并旋转到同方向 */
  function setArrow(b, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tx = Math.abs(ux) > 1e-4 ? (b.w * 0.5) / Math.abs(ux) : 1e9;
    const ty = Math.abs(uy) > 1e-4 ? (b.h * 0.5) / Math.abs(uy) : 1e9;
    const t = Math.min(tx, ty);
    b.arrow.style.left = (b.w * 0.5 + ux * (t + 2)).toFixed(1) + 'px';
    b.arrow.style.top = (b.h * 0.5 + uy * (t + 2)).toFixed(1) + 'px';
    b.arrow.style.transform = 'translate(-50%,-50%) rotate(' +
      (Math.atan2(uy, ux) * 180 / Math.PI).toFixed(1) + 'deg)';
  }

  /* 每帧由 game.js 在相机更新后调用 */
  function layout(visible) {
    if (!layer) return;
    if (!visible || !bubbles.length) {
      layer.classList.add('hidden');
      return;
    }
    layer.classList.remove('hidden');
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const compact = bubbles.length >= COMPACT_AT;
    if (layer.classList.contains('compact') !== compact) {
      layer.classList.toggle('compact', compact);
      for (let i = 0; i < bubbles.length; i++) measure(bubbles[i]);
    }

    const pad = 14;
    const halfW = vw * 0.5, halfH = vh * 0.5;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const u = b.unit;
      if (!u) continue;
      if (b.needMeasure || !b.w || !b.h) measure(b);
      const h = (typeof MODELS !== 'undefined' && MODELS.height) ? MODELS.height(u.type || 'zombie') : 1.7;
      const s = G.worldToScreen(u.x, h + 0.18, u.z);
      let dx, dy;

      if (s) {
        dx = s.x - halfW;
        dy = s.y - halfH;
        /* 说话者在屏幕内：气泡浮在头顶 */
        if (s.x > pad && s.x < vw - pad && s.y > pad && s.y < vh - pad) {
          const maxL = Math.max(pad, vw - pad - b.w);
          const maxT = Math.max(pad, vh - pad - b.h);
          const left = clamp(s.x - b.w * 0.5, pad, maxL);
          let top = s.y - 9 - b.h;
          let ay = 1;
          if (top < pad) { top = s.y + 9; ay = -1; }
          setPos(b, left, clamp(top, pad, maxT));
          setArrow(b, 0, ay);
          continue;
        }
      } else {
        /* 相机后方：用相机地面朝向把世界方向换算成屏幕方向 */
        const cam = G.state.cam;
        const fx = cam.focus[0] - cam.eye[0];
        const fz = cam.focus[2] - cam.eye[2];
        const fl = Math.hypot(fx, fz) || 1;
        const rx = -fz / fl, rz = fx / fl;
        const p = G.state.player;
        const vx = u.x - p.x, vz = u.z - p.z;
        dx = vx * rx + vz * rz;
        dy = -(vx * (fx / fl) + vz * (fz / fl));
      }

      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = 1;
      /* 屏幕外：沿说话者方向挤到安全边缘，气泡整体保持在屏幕内 */
      const hw = Math.max(1, halfW - (b.w * 0.5 + pad));
      const hh = Math.max(1, halfH - (b.h * 0.5 + pad));
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let k = Math.min(ax > 1e-4 ? hw / ax : 1e9, ay > 1e-4 ? hh / ay : 1e9);
      if (!isFinite(k) || k <= 0) k = 1;
      const cx = halfW + dx * k;
      const cy = halfH + dy * k;
      setPos(b, cx - b.w * 0.5, cy - b.h * 0.5);
      setArrow(b, dx, dy);
    }
  }

  return {
    init: init,
    bark: bark,
    idleTick: idleTick,
    update: update,
    layout: layout,
    clear: clear,
    get count() { return bubbles.length; },
    get ids() { return bubbles.map(function (b) { return b.group; }); }
  };
})();
