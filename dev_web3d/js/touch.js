'use strict';

/* ============================================================
   触屏双摇杆
   - 左摇杆：内圆行走 / 外环奔跑 / 越出外圆锁定方向奔跑
   - 右摇杆：内圆瞄准 / 外环开火 / 越出外圆全自动锁定
   - 非全自动（当前全部武器）：
     A 内圆按下  ：瞄准；首次进入火力环立刻开火一次；回内圆后可再次开火
     B 环/外圆按下：只瞄准；在同心圆外松手开火；回到内圆取消，重新拉出可再待发
   - 全自动：环内持续开火；越出外圆锁定持续开火直到松手，新触摸重置
   ============================================================ */

const TOUCH = (function () {
  const IS_TOUCH = !!window.__touchMode;
  const TCFG = (typeof CFG !== 'undefined' && CFG.TOUCH) ? CFG.TOUCH : {};
  const INNER = TCFG.INNER || 0.58;
  const DEAD = TCFG.DEAD || 0.12;
  const KNOB = TCFG.KNOB || 0.82;

  function blank() {
    return {
      active: false, pointerId: null,
      x: 0, y: 0, mag: 0, zone: 'idle',
      aimActive: false, aimYaw: 0,
      locked: false, lockYaw: 0,
      startZone: 'idle', semiMode: '', semiArmed: false, entryFired: false,
      firing: false, auto: false
    };
  }

  const state = { enabled: false, left: blank(), right: blank() };
  const pads = {}, bases = {}, knobs = {};
  const geo = {
    left: { x: 0, y: 0, r: 70 },
    right: { x: 0, y: 0, r: 70 }
  };

  let root = null;
  let semiPending = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    if (!IS_TOUCH) return;
    root = $('touchControls');
    pads.left = $('stickMove');
    pads.right = $('stickAim');
    if (!root || !pads.left || !pads.right) return;
    bases.left = pads.left.querySelector('.stick-base');
    bases.right = pads.right.querySelector('.stick-base');
    knobs.left = pads.left.querySelector('.stick-knob');
    knobs.right = pads.right.querySelector('.stick-knob');

    bindPad('left');
    bindPad('right');

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', function (e) { onUp(e, false); });
    window.addEventListener('pointercancel', function (e) { onUp(e, true); });
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', function () {
      reset();
      setTimeout(measure, 120);
    });
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) reset();
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', measure);

    measure();
    requestAnimationFrame(measure);
  }

  function bindPad(side) {
    const pad = pads[side];
    pad.addEventListener('pointerdown', function (e) { onDown(e, side); });
    pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    pad.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  function measure() {
    measureSide('left');
    measureSide('right');
  }

  function measureSide(side) {
    const base = bases[side];
    if (!base) return;
    const r = base.getBoundingClientRect();
    if (r.width > 8) {
      geo[side].x = r.left + r.width / 2;
      geo[side].y = r.top + r.height / 2;
      geo[side].r = r.width / 2;
    }
  }

  function onDown(e, side) {
    if (!state.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const st = state[side];
    if (st.active) return;

    e.preventDefault();
    measureSide(side);

    st.active = true;
    st.pointerId = e.pointerId;
    st.locked = false;
    st.firing = false;
    st.entryFired = false;
    st.semiMode = '';
    st.semiArmed = false;

    setStick(side, e.clientX, e.clientY);

    if (side === 'right') {
      st.startZone = st.zone;
      st.semiMode = st.zone === 'inner' ? 'A' : 'B';
      st.semiArmed = st.zone !== 'inner';
      updateClasses(side);
    }

    pads[side].classList.add('is-active');
    try { pads[side].setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onMove(e) {
    if (!state.enabled) return;
    const side = findSide(e.pointerId);
    if (!side) return;
    e.preventDefault();
    setStick(side, e.clientX, e.clientY);
  }

  function findSide(pointerId) {
    if (state.left.active && state.left.pointerId === pointerId) return 'left';
    if (state.right.active && state.right.pointerId === pointerId) return 'right';
    return null;
  }

  function onUp(e, canceled) {
    const side = findSide(e.pointerId);
    if (!side) return;
    const st = state[side];

    /* 用最终触点位置补一次判定，避免快速甩动时漏掉最后一帧 pointermove */
    if (!canceled && e && isFinite(e.clientX) && isFinite(e.clientY) &&
        (e.clientX !== 0 || e.clientY !== 0)) {
      setStick(side, e.clientX, e.clientY);
    }

    /* 非全自动 B：在同心圆外松手 -> 开火一次；回内圆则已取消 */
    if (!canceled && side === 'right' && !st.auto &&
        st.semiMode === 'B' && st.semiArmed && st.zone !== 'inner') {
      semiPending = true;
    }

    resetStick(side);
  }

  function setStick(side, clientX, clientY) {
    const st = state[side];
    const g = geo[side];

    let dx = clientX - g.x;
    let dy = clientY - g.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.0001) { dx = 0; dy = 0; dist = 0; }

    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    const mag = dist / g.r;
    const zone = dist <= g.r * INNER ? 'inner' : (dist <= g.r ? 'ring' : 'outer');

    st.mag = mag;
    st.zone = zone;
    st.aimActive = mag > DEAD;
    if (st.aimActive) st.aimYaw = Math.atan2(ux, uy);

    if (side === 'left') {
      if (st.locked) {
        /* 越过外圆后方向锁死；回到外圆内才解锁 */
        st.x = Math.sin(st.lockYaw);
        st.y = Math.cos(st.lockYaw);
        if (zone !== 'outer') st.locked = false;
      } else {
        st.x = ux;
        st.y = uy;
        if (zone === 'outer') {
          st.locked = true;
          st.lockYaw = st.aimYaw;
        }
      }
      if (mag <= DEAD) { st.x = 0; st.y = 0; }
    } else {
      if (st.auto) {
        if (zone === 'outer') st.locked = true;
        st.firing = st.active && (st.locked || zone !== 'inner');
      } else {
        st.locked = false;
        st.firing = false;

        if (st.semiMode === 'A') {
          if (zone !== 'inner') {
            if (!st.entryFired) {
              st.entryFired = true;
              semiPending = true;
            }
          } else {
            st.entryFired = false;
          }
        } else if (st.semiMode === 'B') {
          st.semiArmed = zone !== 'inner';
        }
      }
    }

    const kMax = g.r * KNOB;
    let kx = dx, ky = dy;
    if (dist > kMax && dist > 0) {
      kx = ux * kMax;
      ky = uy * kMax;
    }
    const knob = knobs[side];
    if (knob) {
      knob.style.setProperty('--tx', kx.toFixed(1) + 'px');
      knob.style.setProperty('--ty', ky.toFixed(1) + 'px');
    }

    updateClasses(side);
  }

  function updateClasses(side) {
    const pad = pads[side];
    const st = state[side];
    if (!pad) return;
    pad.classList.toggle('is-active', st.active);
    pad.classList.toggle('zone-inner', st.active && st.zone === 'inner');
    pad.classList.toggle('zone-ring', st.active && st.zone === 'ring');
    pad.classList.toggle('zone-outer', st.active && st.zone === 'outer');
    pad.classList.toggle('locked', st.active && st.locked);
    pad.classList.toggle('firing', st.active && st.firing);

    const semiB = side === 'right' && !st.auto && st.active && st.semiMode === 'B';
    pad.classList.toggle('armed', semiB && st.semiArmed);
    pad.classList.toggle('canceled', semiB && !st.semiArmed);
  }

  function resetStick(side) {
    const st = state[side];
    const pad = pads[side];
    const pid = st.pointerId;

    if (pad && pid !== null) {
      try { pad.releasePointerCapture(pid); } catch (err) { /* ignore */ }
      pad.classList.remove('is-active', 'zone-inner', 'zone-ring', 'zone-outer',
        'locked', 'firing', 'armed', 'canceled');
    }

    const knob = knobs[side];
    if (knob) {
      knob.style.setProperty('--tx', '0px');
      knob.style.setProperty('--ty', '0px');
    }

    st.active = false;
    st.pointerId = null;
    st.x = 0;
    st.y = 0;
    st.mag = 0;
    st.zone = 'idle';
    st.aimActive = false;
    st.locked = false;
    st.startZone = 'idle';
    st.semiMode = '';
    st.semiArmed = false;
    st.entryFired = false;
    st.firing = false;
  }

  function reset() {
    semiPending = false;
    resetStick('left');
    resetStick('right');
  }

  function setEnabled(on) {
    on = !!on;
    if (state.enabled === on) { if (on) measure(); return; }
    state.enabled = on;
    if (root) root.classList.toggle('off', !on);
    if (on) {
      reset();
      measure();
      requestAnimationFrame(measure);
    } else {
      reset();
    }
  }

  function setAuto(on) {
    const r = state.right;
    r.auto = !!on;
    if (!r.auto) {
      r.locked = false;
      r.firing = false;
    }
    if (r.active) {
      if (!r.auto) {
        r.semiMode = r.startZone === 'inner' ? 'A' : 'B';
        r.semiArmed = r.zone !== 'inner';
        r.entryFired = r.zone !== 'inner';
      } else if (r.locked || r.zone !== 'inner') {
        r.firing = true;
      }
    }
    updateClasses('right');
  }

  function takeSemiShot() {
    if (!semiPending) return false;
    semiPending = false;
    return true;
  }

  return {
    init: init,
    measure: measure,
    setEnabled: setEnabled,
    setAuto: setAuto,
    takeSemiShot: takeSemiShot,
    reset: reset,
    get isTouch() { return IS_TOUCH; },
    get enabled() { return state.enabled; },
    left: state.left,
    right: state.right,
    debugSemiPending: function () { return semiPending; }
  };
})();
