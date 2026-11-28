'use strict';

/* ============================================================
   ATA 固定提示对话
   - 没有分支 / 选项，只按 id 播放一条固定文本
   - 气泡锚定在大厅中央的 ATA 泛光字上方，由 game.js 每帧提供屏幕坐标
   - 文本、停留时间、显示延迟都写在 LINES 里，后续加对话只改数据
   ============================================================ */

const Dialogue = (function () {
  const LINES = {
    welcome: {
      tag: '// 大厅',
      text: '欢迎回来，干员。六台装置已上线——靠近时我会说明用途，按 F 打开终端。',
      hold: 6.4,
      delay: 0.85
    },
    armory: {
      tag: '// 军械库',
      text: '军械库已连接。武器、芯片与战术道具都在这里管理，出击前记得把两个配装槽填满。'
    },
    printer: {
      tag: '// 躯体打印机',
      text: '躯体打印机已连接。这里可以查看战术道具，并用数据强化生命、护盾、背包与装填。'
    },
    storage: {
      tag: '// 仓库',
      text: '仓库已解锁。带回来的物资、武器与芯片都存放在这里；空间不够时，可以分解成数据与元素。'
    },
    fabricator: {
      tag: '// 制造台',
      text: '制造台已就绪。消耗数据与对应元素即可制造武器和芯片；注意，成品不会附带元素。'
    },
    comms: {
      tag: '// 联络台',
      text: '联络台收到新的信号。这里接取合约、查阅行动档案，完成目标可以换取额外数据。'
    },
    teleporter: {
      tag: '// 传送台',
      text: '传送台已校准。确认角色、武器和战局地图后，从这里进入战局。'
    }
  };

  const LEAVE_TIME = 0.28;
  const DEFAULT_HOLD = 8.2;

  const el = { root: null, tag: null, text: null };
  let state = null;          // { id, device, phase, t, hold, delay }
  let pulseT = 0;
  let bubbleW = 0;
  let bubbleH = 0;
  let measuredAt = 0;

  function init() {
    if (el.root) return;
    el.root = UI.$('ataDialogue');
    el.tag = UI.$('ataDialogueTag');
    el.text = UI.$('ataDialogueText');
    window.addEventListener('resize', measure);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function measure() {
    if (!el.root) return;
    bubbleW = el.root.offsetWidth;
    bubbleH = el.root.offsetHeight;
    measuredAt = performance.now();
  }

  function line(id) { return LINES[id] || null; }

  /* 播放一条固定对话；delay 秒后才出现，hold 秒后自动收起 */
  function say(id, opt) {
    if (!el.root) init();
    const data = line(id);
    if (!el.root || !data) return false;
    opt = opt || {};
    const delay = opt.delay !== undefined ? Math.max(0, opt.delay) : (data.delay || 0);
    const hold = opt.hold !== undefined ? Math.max(0.4, opt.hold) : (data.hold || DEFAULT_HOLD);

    state = {
      id: id,
      device: !!opt.device,
      phase: delay > 0 ? 'delay' : 'show',
      t: 0,
      delay: delay,
      hold: hold
    };
    pulseT = 0;

    el.tag.textContent = data.tag;
    el.text.textContent = data.text;
    el.root.classList.toggle('hidden', false);
    measure();
    el.root.classList.toggle('show', state.phase === 'show');
    return true;
  }

  /* 立即收起（镜头推进装置终端、离开大厅等） */
  function hide() {
    state = null;
    pulseT = 0;
    if (el.root) el.root.classList.remove('show');
  }

  /* 只收起装置提示，不打断欢迎语 */
  function hideDevice() {
    if (state && state.device) hide();
  }

  function update(dt) {
    if (!state) return;
    state.t += dt;
    if (state.phase === 'delay') {
      if (state.t >= state.delay) {
        state.phase = 'show';
        state.t = 0;
        measure();
        el.root.classList.add('show');
      }
    } else if (state.phase === 'show') {
      pulseT += dt;
      if (state.t >= state.hold) {
        state.phase = 'leave';
        state.t = 0;
        el.root.classList.remove('show');
      }
    } else if (state.phase === 'leave') {
      if (state.t >= LEAVE_TIME) {
        state = null;
        pulseT = 0;
      }
    }
  }

  /* 需要每帧根据 ATA 的世界坐标调用；坐标已由 game.js 投影到屏幕 */
  function place(sx, sy) {
    if (!isVisible() || !el.root) return;
    if (performance.now() - measuredAt > 800) measure();
    const w = bubbleW || el.root.offsetWidth;
    const h = bubbleH || el.root.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw <= 720;
    const side = narrow ? 12 : 20;
    const topMin = narrow ? 66 : Math.max(74, vh * 0.09);
    const bottomMax = vh - (narrow ? 112 : 96);
    const gap = 16;

    let left = clamp(sx, side + w * 0.5, vw - side - w * 0.5);
    let bottom = sy - gap;
    let top = bottom - h;
    if (top < topMin) {
      top = topMin;
      bottom = top + h;
    }
    if (bottom > bottomMax) {
      bottom = bottomMax;
      top = bottom - h;
    }
    if (top < topMin) top = topMin;

    el.root.style.left = Math.round(left) + 'px';
    el.root.style.top = Math.round(bottom) + 'px';
    /* 气泡被边缘推开时，尾巴继续指向 ATA */
    const tail = clamp(sx - (left - w * 0.5), 18, w - 18);
    el.root.style.setProperty('--tail', tail.toFixed(1) + 'px');
  }

  /* 说话期间的呼吸值（0..1），用于 ATA 字泛光脉冲 */
  function pulse() {
    if (!state || state.phase !== 'show') return 0;
    return 0.55 + 0.45 * Math.sin(pulseT * 3.4);
  }

  function isVisible() {
    return !!state && (state.phase === 'show' || state.phase === 'leave');
  }

  return {
    init: init,
    say: say,
    hide: hide,
    hideDevice: hideDevice,
    update: update,
    place: place,
    pulse: pulse,
    isVisible: isVisible,
    get currentId() { return state ? state.id : ''; },
    get currentIsDevice() { return !!(state && state.device); },
    has: function (id) { return !!line(id); }
  };
})();
