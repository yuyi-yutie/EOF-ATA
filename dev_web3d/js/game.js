'use strict';

/* ============================================================
   主循环：大厅 ⇄ 设施
   - 大厅：3D 机库 + 配装 / 仓库 / 补给 / 合约 / 档案
   - 设施：射击 / 敌人 AI / 搜刮 / 撤离
   - 结算：数据入账、物资入库、合约与战绩更新
   ============================================================ */

const G = (function () {
  let canvas;
  let running = false, last = 0;
  let time = 0;
  let lobbyT = 0;
  let inspectYaw = 0.35;
  let inspectDrag = null;
  let paused = false;
  let ended = false;
  let mode = 'lobby';           // 'lobby' | 'mission'
  let endReason = '';
  let testMap = false;

  const CAM = {
    pitch: CFG.CAM.PITCH,
    dist: CFG.CAM.DIST,
    presets: [55, 62, 70, 80, 90],
    eye: [0, 20, 20],
    focus: [0, 0, 0],
    fov: CFG.CAM.FOV,
    tanHalf: 0
  };

  const player = {
    x: 0, z: 0, yaw: 0, moveYaw: 0,
    hp: CFG.PLAYER.hp, maxHp: CFG.PLAYER.hp,
    shield: CFG.PLAYER.shield, maxShield: CFG.PLAYER.shield,
    stam: CFG.PLAYER.stam, moving: false, animT: 0, sprinting: false,
    weapon: 0, slot: 0, carried: [], cool: 0, reload: 0, recoil: 0,
    reloadDur: 1,
    weaponChips: [], weaponMods: [],
    shieldTimer: 0, stamTimer: 0, dead: false, deadT: 0,
    mags: [], spares: [],
    data: 0, inv: [], sel: null, invRows: CFG.INV_ROWS,
    kit: { medkit: 0, battery: 0 },
    looted: 0, dismantledValue: 0,
    extractT: 0, extracted: false, reloadMul: 1,
    respawnT: 0, respawnDone: false,
    charKey: 'scout'
  };

  let enemies = [];
  let tracers = [];
  let flashes = [];
  let sparks = [];
  let projectiles = [];   // 敌方喷吐弹
  let bullets = [];       // 玩家的实弹（热学/力学/电学）
  let zones = [];         // 热学燃烧区
  let beams = [];         // 激光折线
  let lidDebris = [];     // 撬飞的箱盖
  let bolts = [];         // 电弧链
  let sonicWaves = [];         // 声学冲击锥
  let rings = [];         // 开场冲击环
  let aim = { x: 0, z: -1 };
  let shake = 0;
  let fovPunch = 0;
  let kills = 0, looted = 0, spittersKilled = 0;
  let seed = 20261123;
  const AUTO = QS.get('auto') === '1';
  const WALK = QS.get('walk') === '1';
  const MV = parseFloat(QS.get('mv'));
  const TOUCH_MODE = !!window.__touchMode;
  const SELFTEST = QS.get('selftest') === '1';
  const TOUCH_DEAD = (CFG.TOUCH && CFG.TOUCH.DEAD) || 0.12;
  const TOUCH_AIM_LERP = (CFG.TOUCH && CFG.TOUCH.AIM_LERP) || 22;
  let touchInvSuspended = false;

  const keys = {};
  const mouse = { x: 0, y: 0, down: false };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  const CHAR_KEYS = ['scout', 'assault', 'tactical', 'scav', 'raider', 'veteran'];
  function charKeyOf(i) { return CHAR_KEYS[i] || 'scout'; }
  function angDiff(a, b) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
  function isPortrait() {
    if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
    return window.innerWidth < window.innerHeight;
  }

  /* 品质色 → 渲染器数值数组 */
  const RGB_CACHE = {};
  function tierRgb(id) {
    if (!RGB_CACHE[id]) RGB_CACHE[id] = hexRgb(ITEMS.tier(id).color);
    return RGB_CACHE[id];
  }

  /* ---------- 摄像机 ---------- */
  function updateCamera(dt) {
    const k = 1 - Math.exp(-CFG.CAM.LERP * dt);
    CAM.focus[0] = lerp(CAM.focus[0], player.x, k);
    CAM.focus[1] = lerp(CAM.focus[1], CFG.CAM.HEIGHT_OFF, k);
    CAM.focus[2] = lerp(CAM.focus[2], player.z, k);

    const p = Math.min(89.4, CAM.pitch) * Math.PI / 180;
    const d = CAM.dist;
    let sx = 0, sz = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake * 0.55;
      sz = (Math.random() - 0.5) * shake * 0.55;
      shake = Math.max(0, shake - dt * 6);
    }
    CAM.eye = [
      CAM.focus[0] + sx,
      CAM.focus[1] + Math.sin(p) * d,
      CAM.focus[2] + Math.cos(p) * d + sz
    ];
    fovPunch = Math.max(0, fovPunch - dt * 9);
    const fov = CAM.fov + fovPunch;
    CAM.tanHalf = Math.tan(fov * Math.PI / 360);
    R.setCamera(CAM.eye, CAM.focus, fov);
  }

  function updateLobbyCamera(dt) {
    lobbyT += dt;
    const cam = Hangar.camera(lobbyT);
    CAM.tanHalf = Math.tan(cam.fov * Math.PI / 360);
    R.setCamera(cam.eye, cam.focus, cam.fov);
  }

  function screenToGround(mx, my, hy) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ndcx = (mx / w) * 2 - 1;
    const ndcy = 1 - (my / h) * 2;

    const fx = CAM.focus[0] - CAM.eye[0];
    const fy = CAM.focus[1] - CAM.eye[1];
    const fz = CAM.focus[2] - CAM.eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const f = [fx / fl, fy / fl, fz / fl];

    let rx = -f[2], rz = f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;

    const ux = -rz * f[1];
    const uy = rz * f[0] - rx * f[2];
    const uz = rx * f[1];

    const asp = w / h;
    const dx = f[0] + rx * ndcx * CAM.tanHalf * asp + ux * ndcy * CAM.tanHalf;
    const dy = f[1] + uy * ndcy * CAM.tanHalf;
    const dz = f[2] + rz * ndcx * CAM.tanHalf * asp + uz * ndcy * CAM.tanHalf;
    const dl = Math.hypot(dx, dy, dz) || 1;
    if (Math.abs(dy) < 1e-4) return null;
    const t = (hy - CAM.eye[1]) / (dy / dl);
    if (t <= 0) return null;
    return { x: CAM.eye[0] + (dx / dl) * t, z: CAM.eye[2] + (dz / dl) * t };
  }

  /* 世界坐标 -> 屏幕坐标：触屏模式把命中标记放到枪口前方 */
  function worldToScreen(px, py, pz) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const fx = CAM.focus[0] - CAM.eye[0];
    const fy = CAM.focus[1] - CAM.eye[1];
    const fz = CAM.focus[2] - CAM.eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    const f = [fx / fl, fy / fl, fz / fl];

    let rx = -f[2], rz = f[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;

    const ux = -rz * f[1];
    const uy = rz * f[0] - rx * f[2];
    const uz = rx * f[1];

    const vx = px - CAM.eye[0];
    const vy = py - CAM.eye[1];
    const vz = pz - CAM.eye[2];
    const zc = vx * f[0] + vy * f[1] + vz * f[2];
    if (zc <= 0.05) return null;

    const asp = w / h;
    const xc = (vx * rx + vz * rz) / (zc * CAM.tanHalf * asp);
    const yc = (vx * ux + vy * uy + vz * uz) / (zc * CAM.tanHalf);
    return { x: (xc * 0.5 + 0.5) * w, y: (0.5 - yc * 0.5) * h };
  }

  /* 屏幕外目标：夹到对应方向的屏幕边缘/角落；相机后方目标落到下侧边角 */
  function worldToScreenClamped(px, py, pz) {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const margin = Math.max(26, Math.min(44, Math.min(w, h) * 0.06));
    const s = worldToScreen(px, py, pz);
    if (s) {
      const edge = s.x < margin || s.x > w - margin || s.y < margin || s.y > h - margin;
      return {
        x: clamp(s.x, margin, w - margin),
        y: clamp(s.y, margin, h - margin),
        edge: edge
      };
    }
    const fx = CAM.focus[0] - CAM.eye[0];
    const fz = CAM.focus[2] - CAM.eye[2];
    const fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl, rz = fx / fl;
    const side = (px - CAM.eye[0]) * rx + (pz - CAM.eye[2]) * rz;
    return {
      x: side >= 0 ? w - margin : margin,
      y: h - margin,
      edge: true
    };
  }

  /* ---------- 输入 ---------- */
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;

      if (mode === 'lobby') return;

      /* 结算界面：R / ESC 返回机库 */
      if (ended) {
        if (e.code === 'Escape' || e.code === 'KeyR') { e.preventDefault(); toLobby(); }
        return;
      }

      if (e.code === 'Escape') {
        if (Inventory.isOpen()) { Inventory.close(); e.preventDefault(); return; }
        if (paused) { setPause(false); e.preventDefault(); return; }
        setPause(true);
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyP') { setPause(!paused); e.preventDefault(); return; }
      if (paused) return;

      if (e.code === 'BracketLeft') { setPitch(-1); e.preventDefault(); }
      if (e.code === 'BracketRight') { setPitch(1); e.preventDefault(); }
      if (e.code === 'Tab') { e.preventDefault(); Inventory.toggle(); return; }
      if (e.code === 'KeyR') {
        if (Inventory.isOpen()) Inventory.rotate();
        else startReload();
      }
      if (e.code === 'KeyF') { if (!Inventory.isOpen()) tryLoot(); }
      if (e.code === 'Digit1') switchSlot(0);
      if (e.code === 'Digit2') switchSlot(1);
      if (e.code === 'Digit3') switchSlot(2);
      if (e.code === 'Digit4') switchSlot(3);
      if (e.code === 'Digit5') switchSlot(4);
      if (e.code === 'F3') {
        const d = $('dbg');
        if (d) d.classList.toggle('on');
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    canvas.addEventListener('mousemove', function (e) {
      if (TOUCH_MODE) return;
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      HUD.aimAt(mouse.x, mouse.y);
    });
    canvas.addEventListener('mousedown', function (e) {
      if (TOUCH_MODE) return;
      if (e.button === 0 && mode === 'mission' && !paused && !ended && !Inventory.isOpen()) {
        mouse.down = true;
      }
    });
    window.addEventListener('mouseup', function (e) { if (e.button === 0) mouse.down = false; });
    window.addEventListener('blur', function () { mouse.down = false; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    /* 机库：鼠标左键/手指拖动角色旋转检视 */
    function beginInspect(e) {
      if (mode !== 'lobby') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      inspectDrag = { id: e.pointerId, x: e.clientX };
      canvas.classList.add('inspecting');
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }
    canvas.addEventListener('pointerdown', beginInspect);
    const lobbyEl = $('lobby');
    if (lobbyEl) {
      lobbyEl.addEventListener('pointerdown', function (e) {
        if (mode !== 'lobby') return;
        if (e.target.closest('.panel-sec,.lobby-top,.tab-pane,.launch-zone,.lobby-foot,button,.char-card,.load-list,.stash-left,.stash-side')) return;
        beginInspect(e);
      });
    }
    window.addEventListener('pointermove', function (e) {
      if (!inspectDrag || e.pointerId !== inspectDrag.id) return;
      const dx = e.clientX - inspectDrag.x;
      inspectDrag.x = e.clientX;
      inspectYaw += dx * 0.012;
    }, { passive: true });
    function endInspect(e) {
      if (!inspectDrag || (e && e.pointerId !== undefined && e.pointerId !== inspectDrag.id)) return;
      inspectDrag = null;
      canvas.classList.remove('inspecting');
    }
    window.addEventListener('pointerup', endInspect);
    window.addEventListener('pointercancel', endInspect);
    window.addEventListener('blur', endInspect);
    canvas.addEventListener('wheel', function (e) {
      if (mode !== 'mission') return;
      CAM.dist = clamp(CAM.dist + Math.sign(e.deltaY) * 1.2, 7, 30);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('resize', function () { R.resize(canvas); });

    /* 手机竖屏时自动暂停，避免玩家看旋转提示时被敌人打死 */
    if (TOUCH_MODE && !SELFTEST && window.matchMedia) {
      const portrait = window.matchMedia('(orientation: portrait)');
      const onOrient = function () {
        if (portrait.matches && mode === 'mission' && !paused && !ended) setPause(true);
      };
      if (portrait.addEventListener) portrait.addEventListener('change', onOrient);
      else if (portrait.addListener) portrait.addListener(onOrient);
    }
  }

  function setPitch(dir) {
    const i = CAM.presets.indexOf(CAM.pitch);
    CAM.pitch = CAM.presets[clamp(i < 0 ? 2 : i + dir, 0, CAM.presets.length - 1)];
    HUD.toast('镜头俯角 ' + CAM.pitch + '°');
  }

  /* ---------- 暂停 ---------- */
  function setPause(v) {
    if (mode !== 'mission' || ended) return;
    paused = !!v;
    mouse.down = false;
    if (TOUCH_MODE) TOUCH.setEnabled(!paused);
    const box = $('pause');
    if (box) box.classList.toggle('hidden', !paused);
    if (paused) Inventory.close();
  }

  /* ---------- 武器芯片 ---------- */
  const EMPTY_MODS = { dmg: 0, rate: 0, reload: 0, recoil: 0 };

  function modsOf(wi) { return player.weaponMods[wi] || EMPTY_MODS; }

  function recalcWeaponMods() {
    player.weaponMods = WEAPONS.map(function (_, wi) {
      return ITEMS.computeMods(player.weaponChips[wi] || []);
    });
  }

  function weaponChipList(wi) { return player.weaponChips[wi] || []; }

  function chipFits(wi, item) { return ITEMS.chipFitsWeapon(item, wi); }

  function installChip(wi, item) {
    const list = player.weaponChips[wi];
    if (!list) return false;
    if (list.length >= 3) return false;
    const entry = ITEMS.chipEntry(item);
    if (!entry) return false;
    if (!ITEMS.chipFitsWeapon(entry, wi)) return false;
    list.push(entry);
    recalcWeaponMods();
    HUD.updateSlots(player);
    return true;
  }

  function uninstallChip(wi, slot) {
    const list = player.weaponChips[wi];
    if (!list || !list[slot]) return null;
    const item = ITEMS.makeChipItem(list[slot]);
    if (!item) return null;
    list.splice(slot, 1);
    recalcWeaponMods();
    HUD.updateSlots(player);
    return item;
  }

  /* 局内从背包直接装备武器；两槽已满时替换当前手持槽 */
  function equipWeaponItem(item) {
    if (!item || item.kind !== 'weapon') return false;
    const at = player.inv.indexOf(item);
    if (at < 0) return false;
    const wi = item.weaponId;
    if (!WEAPONS[wi]) return false;
    const copy = Grid.cloneItem(item);
    let slot = player.carried.length;
    if (slot >= 2) slot = player.slot >= 0 ? player.slot : 0;
    const newMag = (typeof copy.mag === 'number') ? copy.mag : WEAPONS[wi].mag;
    const newSpares = (typeof copy.spares === 'number') ? copy.spares : 0;
    player.inv.splice(at, 1);
    if (slot < player.carried.length) {
      const old = player.carried[slot];
      const oldCopy = Grid.cloneItem(old);
      oldCopy.chips = (player.weaponChips[old.weaponId] || []).map(function (c) {
        return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
      });
      oldCopy.mag = (typeof player.mags[slot] === 'number') ? player.mags[slot] : WEAPONS[old.weaponId].mag;
      oldCopy.spares = player.spares[slot] || 0;
      if (!Grid.autoPlace(player.inv, oldCopy, CFG.INV_COLS, player.invRows)) {
        player.inv.splice(at, 0, item);
        return false;
      }
      player.inv.push(oldCopy);
      player.carried[slot] = copy;
      player.mags[slot] = newMag;
      player.spares[slot] = newSpares;
    } else {
      player.carried.push(copy);
      player.mags.push(newMag);
      player.spares.push(newSpares);
    }
    player.weaponChips[wi] = (copy.chips || []).map(function (c) {
      return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
    });
    player.slot = slot;
    player.weapon = wi;
    recalcWeaponMods();
    HUD.buildSlots(player);
    HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
    return true;
  }

  function unequipWeaponSlot(slot) {
    if (slot < 0 || slot >= player.carried.length) return false;
    const item = player.carried[slot];
    const copy = Grid.cloneItem(item);
    copy.chips = (player.weaponChips[item.weaponId] || []).map(function (c) {
      return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
    });
    copy.mag = (typeof player.mags[slot] === 'number') ? player.mags[slot] : WEAPONS[item.weaponId].mag;
    copy.spares = player.spares[slot] || 0;
    if (!Grid.autoPlace(player.inv, copy, CFG.INV_COLS, player.invRows)) return false;
    player.inv.push(copy);
    player.carried.splice(slot, 1);
    player.mags.splice(slot, 1);
    player.spares.splice(slot, 1);
    if (player.slot >= player.carried.length) player.slot = player.carried.length - 1;
    if (player.slot < 0) player.slot = 0;
    player.weapon = player.carried.length ? player.carried[player.slot].weaponId : -1;
    HUD.buildSlots(player);
    if (player.weapon >= 0) HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE && player.weapon >= 0) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
    return true;
  }

  /* ---------- 战斗 ---------- */
  function switchSlot(s) {
    if (s < 0 || s >= player.carried.length || s === player.slot) return;
    player.slot = s;
    player.weapon = player.carried[s].weaponId;
    player.cool = Math.max(player.cool, 0.25);
    player.reload = 0;
    HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
  }

  let lastDryT = -9;
  function startReload() {
    if (player.weapon < 0 || player.slot < 0) return;
    const slot = player.slot;
    const w = WEAPONS[player.weapon];
    if (player.reload > 0) return;
    if (player.mags[slot] >= w.mag) return;
    if (player.spares[slot] <= 0) {
      if (time - lastDryT > 1.2) {
        lastDryT = time;
        HUD.toast('没有备弹 · 打开背包压装弹夹', 'warn');
      }
      return;
    }
    const m = modsOf(player.weapon);
    player.reloadDur = w.reload * player.reloadMul * Math.max(0.4, 1 - m.reload);
    player.reload = player.reloadDur;
  }

  function finishReload() {
    if (player.slot < 0) return;
    const slot = player.slot;
    const wi = player.weapon;
    const w = WEAPONS[wi];
    if (player.spares[slot] <= 0) return;
    /* 备弹按「整夹」计算：换弹丢掉当前弹夹余弹，装入一整个满夹 */
    player.spares[slot]--;
    player.mags[slot] = w.mag;
    HUD.updateSlots(player);
  }

  /* 枪口位置：和右手持枪的位置对齐，子弹从这里出去 */
  function muzzle() {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const rx = -Math.cos(player.yaw), rz = Math.sin(player.yaw);
    return {
      x: player.x + fx * 0.80 + rx * 0.18,
      y: 0.78,
      z: player.z + fz * 0.80 + rz * 0.18
    };
  }

  function fire() {
    if (player.weapon < 0 || player.slot < 0) return;
    const wi = player.weapon;
    const slot = player.slot;
    const w = WEAPONS[wi];
    if (player.cool > 0 || player.reload > 0 || player.dead) return;
    if (player.mags[slot] <= 0) {
      if (player.spares[slot] <= 0) {
        if (time - lastDryT > 1.4) {
          lastDryT = time;
          HUD.toast('弹夹已空 · 打开背包压装弹夹', 'warn');
        }
      } else {
        startReload();
      }
      return;
    }

    player.mags[slot]--;
    const mods = modsOf(wi);
    const stable = Math.max(0.25, 1 - mods.recoil);
    player.cool = w.rate * Math.max(0.35, 1 - mods.rate);
    player.recoil = 1;
    shake = Math.min(2.2, shake + (w.kick || 0.6) * stable * 0.85);
    fovPunch = Math.min(3.2, fovPunch + (w.kick || 0.6) * stable * 1.5);
    noise(player.x, player.z, w.id === 'sonic' ? 18 : 12);

    const m = muzzle();
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.06, s: 0.34 + w.recoil * stable * 0.16, c: w.rgb2 });
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.1, s: 0.18, c: [1, 0.97, 0.88] });

    const dmgMul = 1 + mods.dmg;
    if (w.id === 'sonic') fireCone(w, m, dmgMul);
    else if (w.id === 'laser') fireLaser(w, m, dmgMul);
    else fireBullet(w, m, dmgMul);

    HUD.mag(wi);
    HUD.updateSlots(player);
  }

  /* ---------- 声学：瞬时锥形冲击 ---------- */
  function fireCone(w, m, dmgMul) {
    const mul = dmgMul || 1;
    const mods = modsOf(player.weapon);
    const range = w.range * (1 + mods.coneRange);
    const half = (w.halfAngle || 33) * Math.PI / 180;
    sonicWaves.push({
      x: m.x, z: m.z, ang: player.yaw, half: half, range: range,
      t: 0, life: 0.72, c: w.rgb2, seed: Math.random() * 10
    });
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - m.x, dz = e.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.r) continue;
      const a = Math.atan2(dx, dz);
      if (Math.abs(angDiff(a, player.yaw)) > half + Math.atan2(e.r, Math.max(d, 1))) continue;
      /* 声学伤害穿墙：不检查 World.los */
      const t = clamp(d / range, 0, 1);
      damageEnemy(e, lerp(w.dmg, w.dmgFar, t) * mul, a, w.rgb2);
      HUD.hit();
    }
    sparks.push({ x: m.x, y: m.y, z: m.z, t: 0.22, c: w.rgb2, s: 0.42 });
  }

  /* ---------- 光学：折线激光，最多弹射 ---------------- */
  function fireLaser(w, m, dmgMul) {
    const mul = dmgMul || 1;
    const mods = modsOf(player.weapon);
    const maxB = (w.bounce === undefined ? 3 : w.bounce) + mods.bounce;
    const falloff = w.falloff || 0.85;
    /* 枪口偶尔会探进墙里（贴墙射击时）：把起点收回到玩家方向的地板格 */
    let ox = m.x, oz = m.z;
    if (!World.isFloorAt(ox, oz)) {
      ox = player.x; oz = player.z;
      for (let k = 1; k <= 10; k++) {
        const t = k / 10;
        const tx = m.x + (player.x - m.x) * t;
        const tz = m.z + (player.z - m.z) * t;
        if (World.isFloorAt(tx, tz)) { ox = tx; oz = tz; break; }
      }
    }
    const pts = [{ x: ox, z: oz }];
    let px = ox, pz = oz, a = player.yaw;
    let remain = w.range;

    for (let b = 0; b <= maxB; b++) {
      const dx = Math.sin(a), dz = Math.cos(a);
      const hit = World.rayWallHit(px, pz, dx, dz, remain);
      const d = hit.d;
      const ex = px + dx * d, ez = pz + dz * d;
      pts.push({ x: ex, z: ez });

      /* 光学武器穿透敌人：命中的敌人逐个受伤，但光束继续前进，照常撞墙反射 */
      for (const e of enemies) {
        if (e.dead) continue;
        if (segDist(e.x, e.z, px, pz, ex, ez) > e.r + 0.16) continue;
        damageEnemy(e, w.dmg * Math.pow(falloff, b) * mul, Math.atan2(e.x - px, e.z - pz), w.rgb2);
        HUD.hit();
        sparks.push({ x: e.x, y: 1.05, z: e.z, t: 0.22, c: w.rgb2, s: 0.32 });
        sparks.push({ x: e.x, y: 1.08, z: e.z, t: 0.12, c: [1, 1, 1], s: 0.16 });
      }

      /* 撞墙火花 */
      if (hit.axis) {
        sparks.push({ x: ex, y: 1.0, z: ez, t: 0.22, c: w.rgb2, s: 0.34 });
        sparks.push({ x: ex, y: 1.06, z: ez, t: 0.12, c: [1, 1, 1], s: 0.16 });
      }

      remain -= d;
      if (remain <= 0.05 || !hit.axis) break;

      /* 反射重写：
         1) 按 DDA 给出的格子轴翻转方向；
         2) 起点沿撞墙面的外法线推出 1.2cm，保证任何入射角都落回地板格；
         3) 万一落在墙角缝隙里，再沿入射方向退回上一格；
         4) 在撞点放一个明显的棱镜闪光，垂直入射时也能看出确实弹了。 */
      let nx = dx, nz = dz;
      if (hit.axis === 'x' || hit.axis === 'both') nx = -nx;
      if (hit.axis === 'z' || hit.axis === 'both') nz = -nz;
      let ox = ex, oz = ez;
      if (hit.axis === 'x' || hit.axis === 'both') ox = ex - Math.sign(dx) * 0.012;
      if (hit.axis === 'z' || hit.axis === 'both') oz = ez - Math.sign(dz) * 0.012;
      if (!World.isFloorAt(ox, oz)) {
        const back = Math.min(0.06, d);
        ox = ex - dx * back;
        oz = ez - dz * back;
      }
      if (!World.isFloorAt(ox, oz)) break;
      a = Math.atan2(nx, nz);
      px = ox;
      pz = oz;
      const fyaw = hit.axis === 'x' ? 0 : (hit.axis === 'z' ? Math.PI / 2 : Math.atan2(dx, dz));
      flashes.push({ x: ex, y: 1.05, z: ez, yaw: fyaw, t: 0.3, s: 0.66, c: w.rgb2 });
      flashes.push({ x: ex, y: 1.05, z: ez, yaw: fyaw, t: 0.14, s: 0.3, c: [1, 1, 1] });
    }
    beams.push({ pts: pts, t: 0.24, c: w.rgb2 });
  }

  /* ---------- 热学 / 力学 / 电学：实体弹 ---------- */
  function fireBullet(w, m, dmgMul) {
    const mul = dmgMul || 1;
    const mods = modsOf(player.weapon);
    const speed = w.speed || 46;
    bullets.push({
      kind: w.id, wi: player.weapon, x: m.x, z: m.z, y: 1.0,
      vx: Math.sin(player.yaw) * speed,
      vz: Math.cos(player.yaw) * speed,
      dmg: w.dmg * mul, dmgFar: w.dmgFar * mul, range: w.range,
      zMul: mul, zoneR: mods.zoneR, pierce: mods.pierce, chain: mods.chain,
      hitEnemies: [],
      travelled: 0, r: w.id === 'thermal' ? 0.3 : 0.2,
      c: w.rgb2, dead: false
    });
  }

  function segDist(px, pz, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) return Math.hypot(px - x1, pz - z1);
    let t = ((px - x1) * dx + (pz - z1) * dz) / l2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t));
  }

  function bulletImpact(b) {
    sparks.push({ x: b.x, y: 1.0, z: b.z, t: 0.2, c: b.c, s: 0.28 });
    if (b.kind === 'thermal') {
      for (let i = 0; i < 4; i++) {
        sparks.push({
          x: b.x + (Math.random() - 0.5) * 0.5, y: 0.65 + Math.random() * 0.7,
          z: b.z + (Math.random() - 0.5) * 0.5, t: 0.2 + Math.random() * 0.1,
          c: i % 2 ? [1, 0.48, 0.18] : [1, 0.76, 0.3], s: 0.2 + Math.random() * 0.16
        });
      }
      spawnZone(b.x, b.z, b.c, b.zMul, b.zoneR);
    } else if (b.kind === 'voltaic') {
      for (let i = 0; i < 3; i++) {
        sparks.push({
          x: b.x + (Math.random() - 0.5) * 0.4, y: 0.9 + Math.random() * 0.35,
          z: b.z + (Math.random() - 0.5) * 0.4, t: 0.16 + Math.random() * 0.08,
          c: i === 0 ? [0.95, 0.85, 1] : b.c, s: 0.16 + Math.random() * 0.12
        });
      }
    } else {
      sparks.push({ x: b.x, y: 1.02, z: b.z, t: 0.14, c: [1, 1, 1], s: 0.16 });
      sparks.push({ x: b.x + 0.14, y: 0.9, z: b.z - 0.08, t: 0.18, c: b.c, s: 0.18 });
    }
  }

  function spawnZone(x, z, c, dmgMul, zoneMul) {
    const w = WEAPONS[2];
    zones.push({
      x: x, z: z, r: (w.zoneR || 3.1) * (1 + (zoneMul || 0)), life: w.zoneLife || 3.2,
      tick: 0, dps: (w.tickDmg || 3.5) * 4 * (dmgMul || 1), c: c || w.rgb2,
      seed: Math.random() * 10
    });
  }

  function hitBullet(b, e) {
    const w = WEAPONS[b.wi !== undefined ? b.wi : player.weapon];
    b.hitEnemies = b.hitEnemies || [];
    if (b.hitEnemies.indexOf(e) >= 0) return;
    b.hitEnemies.push(e);
    const t = clamp(b.travelled / b.range, 0, 1);
    const dmg = lerp(b.dmg, b.dmgFar, t);
    const a = Math.atan2(e.x - b.x, e.z - b.z);
    damageEnemy(e, dmg, a, b.c);
    HUD.hit();
    /* 力学系列芯片：额外穿透目标数 */
    if (b.pierce > 0) { b.pierce--; b.dead = false; }
    else b.dead = true;
    sparks.push({ x: b.x, y: 1.02, z: b.z, t: 0.2, c: b.c, s: 0.3 });
    sparks.push({ x: b.x, y: 1.05, z: b.z, t: 0.12, c: [1, 1, 1], s: 0.16 });

    if (b.kind === 'thermal') {
      for (let i = 0; i < 3; i++) {
        sparks.push({
          x: e.x + (Math.random() - 0.5) * 0.45, y: 0.7 + Math.random() * 0.5,
          z: e.z + (Math.random() - 0.5) * 0.45, t: 0.18 + Math.random() * 0.1,
          c: i % 2 ? [1, 0.46, 0.16] : [1, 0.75, 0.28], s: 0.18 + Math.random() * 0.12
        });
      }
      spawnZone(e.x, e.z, b.c, b.zMul, b.zoneR);
    } else if (b.kind === 'voltaic') {
      const chainMul = w.chainMul || [0.6, 0.4, 0.25];
      const maxN = (w.chainMax || 3) + (b.chain || 0);
      const used = [e];
      let src = e;
      for (let i = 0; i < maxN; i++) {
        let best = null, bd = w.chainR || 6;
        for (const o of enemies) {
          if (o.dead || used.indexOf(o) >= 0) continue;
          const d = Math.hypot(o.x - src.x, o.z - src.z);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best) break;
        sparks.push({
          x: best.x, y: 1.08, z: best.z, t: 0.2,
          c: i === 0 ? [0.95, 0.85, 1] : b.c, s: 0.24
        });
        bolts.push({
          x0: src.x, z0: src.z, x1: best.x, z1: best.z,
          t: 0.18, c: b.c, seed: Math.random() * 10
        });
        const mul = i < chainMul.length ? chainMul[i] : (chainMul[chainMul.length - 1] || 0.2) * 0.6;
        damageEnemy(best, dmg * mul, Math.atan2(best.x - src.x, best.z - src.z), b.c);
        used.push(best);
        src = best;
      }
    }
  }

  /* 枪声惊动附近的敌人 */
  function noise(x, z, radius) {
    for (const e of enemies) {
      if (e.dead || e.state === 'chase' || e.state === 'attack') continue;
      if (e.state === 'engage' || e.state === 'cover') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < radius) {
        e.state = 'alert';
        e.alertT = 0.55;
        e.lastSeenX = x; e.lastSeenZ = z;
      }
    }
  }

  function damageEnemy(e, dmg, ang, col, silent, credit, fromX, fromZ) {
    if (!e || e.dead) return;
    const sx = fromX === undefined ? player.x : fromX;
    const sz = fromZ === undefined ? player.z : fromZ;
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (credit !== false) e.playerHit = true;
    if (e.gunner) e.underFire = 1.6;
    if (!silent) HUD.damageNumber(e.x, 1.22, e.z, dmg, col);
    if (e.gunner) {
      if (e.state !== 'engage' && e.state !== 'cover') {
        e.state = 'alert'; e.alertT = 0.3;
        e.lastSeenX = sx; e.lastSeenZ = sz;
      }
    } else if (e.state !== 'chase' && e.state !== 'attack') {
      e.state = 'alert'; e.alertT = 0.35;
      e.lastSeenX = sx; e.lastSeenZ = sz;
    }
    if (e.hp <= 0) {
      e.dead = true;
      if (e.gunner) gunnerCancelPry(e);
      if (e.gunner && !e.corpse) {
        e.corpse = true;
        e.deadT = 0;
        e.fade = 999;
        spawnGunnerCorpse(e);
      }
      if (credit !== false || e.playerHit) {
        kills++;
        if (e.type === 'spitter') spittersKilled++;
        HUD.kills(kills);
        HUD.hit(true);
      }
      sparks.push({ x: e.x, y: 1.0, z: e.z, t: 0.3, c: [0.85, 0.35, 0.25], s: 0.5 });
    }
  }

  function damagePlayer(dmg) {
    if (player.dead || player.extracted || ended || mode !== 'mission') return;
    shake = Math.min(1.6, shake + 0.5);
    HUD.damage();
    if (player.shield > 0) {
      player.shield -= dmg;
      player.shieldTimer = CFG.PLAYER.shieldDelay;
      if (player.shield < 0) { player.hp += player.shield; player.shield = 0; }
    } else {
      player.hp -= dmg;
    }
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.deadT = 0;
      finishRun(false, 'death');
    }
    HUD.vitals();
  }

  function nearestChest() {
    let best = null, bd = CFG.CHEST_INTERACT_R || 1.8;
    for (let i = 0; i < World.chests.length; i++) {
      const c = World.chests[i];
      if (c.corpse && (!c.inv || !c.inv.length) &&
          !(c.weapons && (c.weapons[0] || c.weapons[1]))) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z) - (c.cr || 0);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function startPry(c) {
    if (!c || c.prying || c.pried) return;
    c.prying = true;
    c.pryT = 0;
    c.pryBy = 'player';
    HUD.toast('自动撬开' + (c.name || '物资箱') + ' · 保持站位', 'good');
  }

  function cancelPry(c, msg) {
    c.prying = false;
    c.pryT = 0;
    c.pryBy = null;
    if (msg) HUD.toast(msg, 'warn');
  }

  function finishPry(c, fromX, fromZ, silent) {
    c.prying = false;
    c.pried = true;
    c.pryT = 0;
    c.pryBy = null;
    c.pryBurst = 0.45;
    c.openDelay = CFG.CHEST_OPEN_DELAY;
    c.autoSearch = false;
    spawnLid(c, fromX, fromZ);
    if (!silent) HUD.toast(TOUCH_MODE ? '箱盖被撬飞了 · 点击搜索' : '箱盖被撬飞了 · 按 F 搜索', 'good');
  }

  function spawnLid(c, fromX, fromZ) {
    const A = (typeof ASSETS !== 'undefined') ? (c.type === 'weapon' ? ASSETS.weaponcrate : ASSETS.chest) : null;
    const lc = (A && A.lidCenter) ? A.lidCenter : [0, 0.74, 0];
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const wx = c.x + cy * lc[0] + sy * lc[2];
    const wz = c.z - sy * lc[0] + cy * lc[2];
    const px = fromX === undefined ? player.x : fromX;
    const pz = fromZ === undefined ? player.z : fromZ;
    const away = Math.atan2(c.x - px, c.z - pz);
    const a = away + (Math.random() - 0.5) * 2.4;
    const sp = 1.6 + Math.random() * 2.8;
    lidDebris.push({
      type: c.type || 'supply',
      x: wx, y: lc[1], z: wz,
      vx: Math.sin(a) * sp,
      vy: 5.5 + Math.random() * 3.0,
      vz: Math.cos(a) * sp,
      yaw: c.yaw,
      pitch: (Math.random() - 0.5) * 0.6,
      vyaw: (Math.random() - 0.5) * 9,
      vpitch: (Math.random() - 0.5) * 8,
      sink: 0,
      t: 0, landT: -1, dead: false
    });
  }

  function updateLidDebris(dt) {
    for (let i = 0; i < lidDebris.length; i++) {
      const d = lidDebris[i];
      d.t += dt;
      d.vy -= 17 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.yaw += d.vyaw * dt;
      d.pitch += d.vpitch * dt;
      const floor = 0.1;
      if (d.y < floor) {
        d.y = floor;
        if (d.landT < 0) d.landT = 0;
        d.vy = 0;
        d.vx *= 0.72; d.vz *= 0.72;
        d.vyaw *= 0.78; d.vpitch *= 0.78;
      }
      if (d.landT >= 0) {
        d.landT += dt;
        /* 落地后向最近的平放角度收拢，并按俯仰角抬高中心，避免箱盖插进地面 */
        const flatPitch = Math.round(d.pitch / Math.PI) * Math.PI;
        const k = 1 - Math.exp(-10 * dt);
        d.pitch += (flatPitch - d.pitch) * k;
        d.vpitch *= Math.max(0, 1 - dt * 12);
        d.vyaw *= Math.max(0, 1 - dt * 8);
        const lift = Math.abs(Math.sin(d.pitch)) * 0.42 + Math.abs(Math.cos(d.pitch)) * 0.085;
        d.y = 0.015 + lift;
        const st = clamp((d.landT - 1.8) / 0.9, 0, 1);
        d.sink = st * st * 0.9;
        if (d.landT >= 2.7) d.dead = true;
      }
    }
    if (lidDebris.length) lidDebris = lidDebris.filter(function (d) { return !d.dead; });
  }

  function noteLoot(n) {
    n = n || 1;
    looted += n;
    player.looted += n;
    HUD.loot(looted);
  }

  function tryLoot() {
    if (mode !== 'mission' || ended || paused) return;
    const chest = nearestChest();
    if (chest) {
      if (chest.corpse) {
        chest.autoSearch = false;
        Inventory.openChest(chest);
        return;
      }
      if (!chest.pried) {
        HUD.toast(chest.prying ? '正在撬开物资箱 · 请稍候' : '靠近物资箱会自动撬开', 'warn');
        return;
      }
      chest.autoSearch = false;
      chest.openDelay = 0;
      Inventory.openChest(chest);
      return;
    }
    let best = null, bd = CFG.INTERACT_R + 0.4;
    for (const l of World.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - player.x, l.z - player.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (!best) return;
    if (!Inventory.addItem(best.item)) {
      HUD.toast('背包已满 · 需要先分解或丢弃', 'warn');
      return;
    }
    best.taken = true;
    looted++;
    player.looted++;
    HUD.loot(looted);
    HUD.toast('拾取 ' + best.item.name + ' · ' + best.item.value + ' NB', 'good');
  }

  /* ---------- 敌人 AI ---------- */
  function factionOf(e) {
    return e.faction || (e.gunner ? 'scav' : 'undead');
  }

  function canSeePoint(e, tx, tz, maxD) {
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d > (maxD || e.viewR)) return false;
    if (World.sightBlocked(e.x, e.z, tx, tz)) return false;
    if (d < 3.0) return true;
    const ang = Math.atan2(dx, dz);
    return Math.abs(angDiff(e.yaw, ang)) < e.viewHalf;
  }

  /* 选择当前可见目标：玩家或敌对阵营的敌人，取最近者 */
  function pickEnemyTarget(e) {
    let best = null, bd = Infinity;
    if (!player.dead && !player.extracted) {
      const d = Math.hypot(player.x - e.x, player.z - e.z);
      if (d <= e.viewR && canSeePoint(e, player.x, player.z, e.viewR)) {
        best = { kind: 'player', x: player.x, z: player.z, d: d };
        bd = d;
      }
    }
    const my = factionOf(e);
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      if (factionOf(o) === my) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d >= bd || d > e.viewR) continue;
      if (!canSeePoint(e, o.x, o.z, e.viewR)) continue;
      bd = d;
      best = { kind: 'enemy', ref: o, x: o.x, z: o.z, d: d };
    }
    return best;
  }

  function pickPatrol(e) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.283;
      const r = 2.5 + Math.random() * 7;
      const x = e.home.x + Math.cos(a) * r;
      const z = e.home.z + Math.sin(a) * r;
      if (!World.blocked(x, z, e.r)) return { x: x, z: z };
    }
    return { x: e.home.x, z: e.home.z };
  }

  function stepTo(e, tx, tz, speed, dt) {
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const ux = dx / d, uz = dz / d;
    let mv = World.moveCircle(e.x, e.z, ux * speed * dt, uz * speed * dt, e.r);
    let mx = ux, mz = uz;
    if (Math.hypot(mv.x - e.x, mv.z - e.z) < 0.0005) {
      /* 正面被挡住时沿墙侧移，避免一直顶着墙走 */
      for (const s of [1, -1]) {
        const m2 = World.moveCircle(e.x, e.z, -uz * s * speed * dt, ux * s * speed * dt, e.r);
        if (Math.hypot(m2.x - e.x, m2.z - e.z) > 0.0005) {
          mv = m2; mx = -uz * s; mz = ux * s;
          break;
        }
      }
    }
    if (Math.hypot(mv.x - e.x, mv.z - e.z) < 0.0005) return true;
    e.x = mv.x;
    e.z = mv.z;
    e.yaw = angLerp(e.yaw, Math.atan2(mx, mz), 1 - Math.exp(-9 * dt));
    e.moving = true;
    e.animT += dt;
    return false;
  }

  /* ============================================================
     拾荒者枪手
     - 与丧尸混编，默认使用力学「轨道步枪」
     - 第一版三种模型共用同一套 AI / 数值，后续再分化
     ============================================================ */
  function makeGunnerBag() {
    const bag = [];
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const it = ITEMS.roll(Math.random() < 0.7 ? 'common' : 'fine');
      if (Grid.autoPlace(bag, it, CFG.GUNNER.bagCols, CFG.GUNNER.bagRows)) bag.push(it);
    }
    return bag;
  }

  function makeGunner(type, x, z) {
    const c = CFG.ENEMY[type] || CFG.ENEMY.scav;
    const w = WEAPONS[CFG.GUNNER.weaponId];
    return {
      x: x, z: z, home: { x: x, z: z }, type: type, gunner: true, faction: 'scav',
      hp: c.hp, maxHp: c.hp, r: c.r, speed: c.speed, dmg: c.dmg,
      cd: 0, cdMax: c.cd, yaw: Math.random() * 6.28, animT: 0,
      moving: false, dead: false, fade: 1.9, hitFlash: 0, lunge: 0,
      state: 'idle', alertT: 0, lostT: 0, waitT: 0, patrol: null,
      lastSeenX: x, lastSeenZ: z, seen: false, seenLast: false,
      seed: Math.random() * 10,
      viewR: CFG.GUNNER.viewR, viewHalf: CFG.GUNNER.viewHalf,
      aimT: 0, ammo: w.mag, reloadT: 0,
      burstLeft: 0, burstT: 0, burstCool: 0.4 + Math.random() * 0.7,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 0.6 + Math.random() * 0.9,
      coverTarget: null, coverHold: 0, coverCd: 2 + Math.random() * 3,
      underFire: 0, corpse: false, corpseContainer: null,
      lootBag: makeGunnerBag(), lootTarget: null, lootT: 0, pryingChest: null,
      lootFull: false, lootIgnored: null, lootIgnoredLoot: null
    };
  }

  function gunnerAddLoot(e, item) {
    if (!item) return false;
    if (e.lootBag.length >= (CFG.GUNNER.maxLoot || 6)) return false;
    const copy = Grid.cloneItem(item);
    if (!Grid.autoPlace(e.lootBag, copy, CFG.GUNNER.bagCols, CFG.GUNNER.bagRows)) return false;
    e.lootBag.push(copy);
    return true;
  }

  function gunnerHasSpace(e) {
    const dummy = {
      kind: 'material', name: 'x', value: 0, time: 1, tierId: 'common',
      w: 1, h: 1, gx: 0, gy: 0, rot: 0
    };
    return Grid.autoPlace(e.lootBag, dummy, CFG.GUNNER.bagCols, CFG.GUNNER.bagRows);
  }

  function gunnerCancelPry(e) {
    const c = e.pryingChest;
    if (c && c.pryBy === e) cancelPry(c);
    e.pryingChest = null;
  }

  function pickGunnerLoot(e) {
    if (e.lootFull) return null;
    let best = null, bd = 16;
    for (const l of World.loot) {
      if (l.taken || l === e.lootIgnoredLoot) continue;
      const d = Math.hypot(l.x - e.x, l.z - e.z);
      if (d >= bd) continue;
      if (World.sightBlocked(e.x, e.z, l.x, l.z)) continue;
      bd = d;
      best = { kind: 'loot', ref: l, x: l.x, z: l.z };
    }
    if (best) return best;
    if (Inventory.isChestOpen()) return null;
    bd = 18;
    for (const c of World.chests) {
      if (c.corpse || c === e.lootIgnored || !c.inv || !c.inv.length) continue;
      if (Inventory.currentChest && Inventory.currentChest() === c) continue;
      const d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d >= bd) continue;
      if (World.sightBlocked(e.x, e.z, c.x, c.z, c)) continue;
      bd = d;
      best = { kind: 'chest', ref: c, x: c.x, z: c.z };
    }
    if (!best && !gunnerHasSpace(e)) e.lootFull = true;
    return best;
  }

  /* 返回 true 表示正在搜刮，不再执行巡逻 */
  function gunnerLoot(e, dt) {
    if (e.lootT > 0) e.lootT -= dt;
    let t = e.lootTarget;
    if (t) {
      if (t.kind === 'loot') {
        if (t.ref.taken) t = e.lootTarget = null;
      } else if (t.kind === 'chest') {
        if (!t.ref.inv || !t.ref.inv.length || t.ref.corpse) {
          if (e.pryingChest === t.ref) gunnerCancelPry(e);
          t = e.lootTarget = null;
        }
      }
    }
    if (!t) {
      t = e.lootTarget = pickGunnerLoot(e);
      if (!t) return false;
    }
    /* 玩家正在查看这个箱子时，敌人不要从界面里偷东西 */
    if (t.kind === 'chest' && Inventory.isChestOpen() && Inventory.currentChest() === t.ref) {
      e.moving = false;
      return true;
    }
    const td = Math.hypot(t.x - e.x, t.z - e.z);
    if (td > CFG.GUNNER.lootR) {
      gunnerMove(e, t.x - e.x, t.z - e.z, e.speed * 0.72, dt, Math.atan2(t.x - e.x, t.z - e.z));
      return true;
    }
    e.moving = false;
    e.yaw = angLerp(e.yaw, Math.atan2(t.x - e.x, t.z - e.z), 1 - Math.exp(-10 * dt));
    if (e.lootT > 0) return true;

    if (t.kind === 'loot') {
      if (t.ref.taken) { e.lootTarget = null; return true; }
      if (gunnerAddLoot(e, t.ref.item)) {
        t.ref.taken = true;
        e.lootT = 1.1;
        e.lootTarget = null;
      } else {
        e.lootIgnoredLoot = t.ref;
        e.lootT = 1.2;
        e.lootTarget = null;
        if (!gunnerHasSpace(e)) e.lootFull = true;
      }
      return true;
    }

    /* 箱子：先撬开，再逐件拿走 */
    const c = t.ref;
    if (!c.pried) {
      if (c.prying && c.pryBy && c.pryBy !== e && c.pryBy.dead) cancelPry(c);
      if (c.prying && c.pryBy !== e) {
        e.moving = false;
        e.lootWaitT = (e.lootWaitT || 0) + dt;
        if (e.lootWaitT > 8) {
          e.lootWaitT = 0;
          e.lootIgnored = c;
          e.lootTarget = null;
          e.lootT = 1.0;
        }
        return true;
      }
      e.lootWaitT = 0;
      if (!c.prying) {
        c.prying = true;
        c.pryT = 0;
        c.pryBy = e;
        e.pryingChest = c;
      }
      c.pryT = Math.min(1, (c.pryT || 0) + dt / CFG.CHEST_PRY_TIME);
      e.moving = false;
      if (c.pryT >= 1) {
        finishPry(c, e.x, e.z, true);
        e.pryingChest = null;
        e.lootT = 0.4;
      }
      return true;
    }

    if (e.pryingChest) e.pryingChest = null;
    for (let i = 0; i < c.inv.length; i++) {
      const it = c.inv[i];
      if (gunnerAddLoot(e, it)) {
        c.inv.splice(i, 1);
        e.lootT = 1.5;
        return true;
      }
    }
    e.lootT = 2.0;
    e.lootTarget = null;
    if (!gunnerHasSpace(e)) e.lootFull = true;
    else e.lootIgnored = c;
    return true;
  }

  function findCoverPoint(e, tx, tz) {
    let best = null, bestScore = 1e9;
    /* 优先找真正挡住威胁视线的点 */
    for (let i = 0; i < 16; i++) {
      const a = e.seed + i / 16 * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const dist = 1.5 + k * 0.9;
        const x = e.x + Math.sin(a) * dist;
        const z = e.z + Math.cos(a) * dist;
        if (World.blocked(x, z, e.r + 0.04)) continue;
        if (World.sightBlocked(e.x, e.z, x, z)) continue;
        if (!World.sightBlocked(x, z, tx, tz)) continue;
        const pd = Math.hypot(x - tx, z - tz);
        if (pd < 3.2) continue;
        const score = Math.abs(pd - 10) + dist * 0.35;
        if (score < bestScore) { bestScore = score; best = { x: x, z: z }; }
      }
    }
    if (best) return best;

    /* 没有完全遮挡的点时，退到背向威胁的墙边，形成基础掩体走位 */
    const away = Math.atan2(e.x - tx, e.z - tz);
    for (let i = 0; i < 24; i++) {
      const off = ((i % 2) ? 1 : -1) * Math.ceil(i / 2) / 12 * 1.25;
      const a = away + off;
      for (let k = 0; k < 3; k++) {
        const dist = 1.4 + k * 0.75;
        const x = e.x + Math.sin(a) * dist;
        const z = e.z + Math.cos(a) * dist;
        if (World.blocked(x, z, e.r + 0.04)) continue;
        if (World.sightBlocked(e.x, e.z, x, z)) continue;
        let nearWall = false;
        for (let n = 0; n < 4; n++) {
          const na = n * Math.PI / 2;
          if (World.blocked(x + Math.cos(na) * 0.7, z + Math.sin(na) * 0.7, e.r * 0.5)) {
            nearWall = true;
            break;
          }
        }
        if (!nearWall) continue;
        const pd = Math.hypot(x - tx, z - tz);
        if (pd < 3.2) continue;
        const score = -pd + dist * 0.2;
        if (score < bestScore) { bestScore = score; best = { x: x, z: z }; }
      }
    }
    return best;
  }

  function gunnerMove(e, dirX, dirZ, speed, dt, faceYaw) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.001) { e.moving = false; return false; }
    let mv = World.moveCircle(e.x, e.z, dirX / len * speed * dt, dirZ / len * speed * dt, e.r);
    if (Math.hypot(mv.x - e.x, mv.z - e.z) < 0.0005) {
      /* 正面被挡住时尝试垂直侧移 */
      const px = -dirZ / len, pz = dirX / len;
      for (const s of [1, -1]) {
        const m2 = World.moveCircle(e.x, e.z, px * s * speed * dt, pz * s * speed * dt, e.r);
        if (Math.hypot(m2.x - e.x, m2.z - e.z) > 0.0005) { mv = m2; break; }
      }
    }
    const moved = Math.hypot(mv.x - e.x, mv.z - e.z) > 0.0005;
    e.x = mv.x;
    e.z = mv.z;
    if (speed > 0.01) e.moving = true;
    if (moved) e.animT += dt;
    if (faceYaw !== undefined) e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-10 * dt));
    return moved;
  }

  function fireEnemyBullet(e, tx, tz, d) {
    const w = WEAPONS[CFG.GUNNER.weaponId];
    let spread = CFG.GUNNER.spread;
    if (e.moving) spread += 0.02;
    if (d > 12) spread += 0.015;
    const base = Math.atan2(tx - e.x, tz - e.z);
    const a = base + (Math.random() * 2 - 1) * spread;
    const speed = w.speed || 60;
    const maxX = e.x + Math.sin(a) * 0.78 - Math.cos(a) * 0.10;
    const maxZ = e.z + Math.cos(a) * 0.78 + Math.sin(a) * 0.10;
    let mx = maxX, mz = maxZ;
    if (!World.los(e.x, e.z, mx, mz) || !World.isFloorAt(mx, mz) || World.bulletBlocked(mx, mz)) {
      mx = e.x + Math.sin(a) * 0.3;
      mz = e.z + Math.cos(a) * 0.3;
    }
    bullets.push({
      kind: 'kinetic', wi: CFG.GUNNER.weaponId, hostile: true,
      faction: 'scav', ox: e.x, oz: e.z,
      x: mx, z: mz, y: 1.02,
      vx: Math.sin(a) * speed, vz: Math.cos(a) * speed,
      dmg: w.dmg, dmgFar: w.dmgFar, range: w.range,
      travelled: 0, r: 0.2, c: [1.0, 0.50, 0.22], dead: false
    });
    flashes.push({ x: mx, y: 1.04, z: mz, yaw: a, t: 0.06, s: 0.34, c: [1.0, 0.55, 0.25] });
    flashes.push({ x: mx, y: 1.04, z: mz, yaw: a, t: 0.1, s: 0.16, c: [1.0, 0.95, 0.82] });
    e.ammo = Math.max(0, e.ammo - 1);
  }

  function updateGunnerAI(e, dt, d, sees, dx, dz, target) {
    const w = WEAPONS[CFG.GUNNER.weaponId];
    const faceYaw = Math.atan2(dx, dz);
    const threatX = (sees && target) ? target.x : e.lastSeenX;
    const threatZ = (sees && target) ? target.z : e.lastSeenZ;
    if (e.coverCd > 0) e.coverCd -= dt;
    if (e.underFire > 0) e.underFire -= dt;
    if (e.reloadT > 0) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) {
        e.reloadT = 0;
        e.ammo = w.mag;
        e.burstCool = 0.25;
      }
    }
    if (e.burstCool > 0) e.burstCool = Math.max(0, e.burstCool - dt);

    if (sees && !e.seenLast) e.aimT = Math.max(e.aimT, CFG.GUNNER.reaction);
    e.seenLast = sees;
    if (e.pryingChest) {
      const pc = e.pryingChest;
      const pd = Math.hypot(e.x - pc.x, e.z - pc.z);
      if (sees || e.lostT < 6 || pd > CFG.GUNNER.lootR + 0.5) gunnerCancelPry(e);
    }
    if (sees) {
      if (e.lootTarget && e.lootTarget.kind === 'chest') e.lootTarget = null;
    }

    /* 受击或半血时尝试进入基础掩体 */
    if (sees && !e.coverTarget && e.coverCd <= 0 && (e.underFire > 0.25 || e.hp < e.maxHp * 0.5)) {
      const cover = findCoverPoint(e, threatX, threatZ);
      if (cover) {
        e.coverTarget = cover;
        e.coverHold = 1.0 + Math.random() * 0.8;
        e.coverCd = 5.5 + Math.random() * 4;
        e.state = 'cover';
      } else {
        e.coverCd = 2.0;
      }
    }

    if (e.coverTarget) {
      if (d < 4.5) {
        e.coverTarget = null;
        e.state = 'engage';
      } else {
        const cd = Math.hypot(e.coverTarget.x - e.x, e.coverTarget.z - e.z);
        if (cd > 0.45) {
          gunnerMove(e, e.coverTarget.x - e.x, e.coverTarget.z - e.z, e.speed, dt, faceYaw);
        } else {
          e.moving = false;
          e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-10 * dt));
          e.coverHold -= dt;
          if (e.coverHold <= 0) {
            e.coverTarget = null;
            e.state = sees ? 'engage' : 'search';
            e.aimT = Math.max(e.aimT, 0.25);
          }
        }
        return;
      }
    }

    if (e.state === 'alert') {
      e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-14 * dt));
      e.alertT -= dt;
      if (e.aimT > 0) e.aimT = Math.max(0, e.aimT - dt);
      if (e.alertT <= 0) e.state = 'engage';
      return;
    }

    if (sees && e.state !== 'dead') {
      e.state = 'engage';
      e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-11 * dt));

      if (d > CFG.GUNNER.rangeMax) {
        gunnerMove(e, dx, dz, e.speed, dt, faceYaw);
      } else if (d < CFG.GUNNER.rangeMin) {
        gunnerMove(e, -dx, -dz, e.speed, dt, faceYaw);
      } else {
        e.strafeT -= dt;
        if (e.strafeT <= 0) {
          e.strafeDir *= -1;
          e.strafeT = 0.7 + Math.random() * 0.9;
        }
        const sx = -dz / d * e.strafeDir, sz = dx / d * e.strafeDir;
        if (!gunnerMove(e, sx, sz, e.speed * 0.62, dt, faceYaw)) {
          e.strafeDir *= -1;
          e.strafeT = 0.45;
        }
      }
      e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-12 * dt));

      if (e.aimT > 0) { e.aimT -= dt; return; }
      if (e.reloadT > 0) return;
      if (e.burstLeft > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          if (e.ammo <= 0) {
            e.reloadT = CFG.GUNNER.reload;
            e.burstLeft = 0;
            e.burstCool = 0.45;
          } else {
            fireEnemyBullet(e, threatX, threatZ, d);
            e.burstLeft--;
            e.burstT = w.rate;
            if (e.burstLeft <= 0) e.burstCool = 0.45 + Math.random() * 0.55;
          }
        }
      } else if (e.burstCool <= 0) {
        e.burstLeft = CFG.GUNNER.burstMin +
          Math.floor(Math.random() * (CFG.GUNNER.burstMax - CFG.GUNNER.burstMin + 1));
        e.burstT = 0;
      }
      return;
    }

    /* 失去视野：先前往最后目击点，再开始搜刮 / 巡逻 */
    e.burstLeft = 0;
    e.coverTarget = null;
    if (e.lostT < 6) {
      e.state = 'search';
      const td = Math.hypot(e.lastSeenX - e.x, e.lastSeenZ - e.z);
      if (td > 0.8) {
        gunnerMove(e, e.lastSeenX - e.x, e.lastSeenZ - e.z, e.speed * 0.9, dt,
          Math.atan2(e.lastSeenX - e.x, e.lastSeenZ - e.z));
      } else {
        e.moving = false;
        e.yaw += Math.sin(time * 1.4 + e.seed) * dt * 0.7;
      }
      return;
    }

    e.state = 'patrol';
    if (gunnerLoot(e, dt)) return;
    if (!e.patrol) { e.patrol = pickPatrol(e); e.waitT = 0.6 + Math.random() * 1.4; }
    if (e.waitT > 0) {
      e.waitT -= dt;
      e.yaw += Math.sin(time * 1.1 + e.seed) * dt * 0.5;
      return;
    }
    if (stepTo(e, e.patrol.x, e.patrol.z, e.speed * 0.42, dt)) {
      e.waitT = 1.2 + Math.random() * 2.2;
      e.patrol = pickPatrol(e);
      e.lootTarget = null;
    }
  }

  function dropGroundItem(item, x, z) {
    if (!item) return;
    World.loot.push({
      x: x + (Math.random() - 0.5) * 0.5,
      z: z + (Math.random() - 0.5) * 0.5,
      kind: 'case', taken: false, tier: item.tierId, item: item
    });
  }

  function spawnGunnerCorpse(e) {
    const cols = CFG.GUNNER.corpseCols, rows = CFG.GUNNER.corpseRows;
    const inv = [];
    function add(it) {
      if (!it) return;
      const copy = Grid.cloneItem(it);
      copy.found = true;
      copy.foundAt = 0;
      if (Grid.autoPlace(inv, copy, cols, rows)) inv.push(copy);
      else dropGroundItem(copy, e.x, e.z);
    }
    let held = ITEMS.makeWeaponItem(CFG.GUNNER.weaponId);
    if (held) {
      held.found = true;
      held.foundAt = 0;
      /* 拾荒者当前弹夹里剩多少发，尸体上的枪就带多少发；不凭空补满 */
      held.mag = Math.max(0, Math.min(WEAPONS[CFG.GUNNER.weaponId].mag, e.ammo | 0));
      held.spares = 0;
    }
    const weapons = [held || null, null];
    const bagItems = [];
    for (const it of e.lootBag) {
      if (it.kind === 'weapon' && !weapons[1]) {
        const copy = Grid.cloneItem(it);
        copy.found = true;
        copy.foundAt = 0;
        weapons[1] = copy;
      } else {
        bagItems.push(it);
      }
    }
    for (const it of bagItems) add(it);
    e.lootBag = [];
    const label = (CFG.ENEMY[e.type] && CFG.ENEMY[e.type].name) || '拾荒者';
    const container = {
      type: 'corpse', corpse: true, x: e.x, z: e.z, yaw: e.yaw,
      name: label + ' 尸体', cols: cols, rows: rows, inv: inv,
      weapons: weapons,
      cr: 0.5, pried: true, opened: false, search: null,
      emptyText: '尸体已被搜空'
    };
    World.chests.push(container);
    e.corpseContainer = container;
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead) {
        if (!e.corpse) e.fade -= dt;
        else e.deadT = (e.deadT || 0) + dt;
        continue;
      }

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.cd = Math.max(0, e.cd - dt);

      const target = pickEnemyTarget(e);
      const sees = !!target;
      let tx, tz;
      if (sees) {
        tx = target.x; tz = target.z;
        e.lastSeenX = tx;
        e.lastSeenZ = tz;
        e.lostT = 0;
        e.seen = true;
      } else {
        e.lostT += dt;
        e.seen = false;
        tx = e.lastSeenX;
        tz = e.lastSeenZ;
      }
      const dx = tx - e.x, dz = tz - e.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;

      if (sees && (e.state === 'idle' || e.state === 'patrol')) {
        e.state = 'alert';
        e.alertT = 0.4;
      }

      const prevX = e.x, prevZ = e.z;
      e.moving = false;

      if (e.gunner) {
        updateGunnerAI(e, dt, d, sees, dx, dz, target);
      } else if (e.state === 'alert') {
        e.alertT -= dt;
        e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-14 * dt));
        if (e.alertT <= 0) e.state = 'chase';
      } else if (e.state === 'chase' || e.state === 'attack') {
        const td = Math.hypot(tx - e.x, tz - e.z);
        const tr = (target && target.kind === 'enemy' && target.ref) ? target.ref.r : CFG.PLAYER.r;
        const reach = e.type === 'spitter' ? 8.5 : (e.r + tr + 0.35);

        if (e.type === 'spitter') {
          if (td > 9) stepTo(e, tx, tz, e.speed, dt);
          else if (td < 5) stepTo(e, e.x - ux * 2, e.z - uz * 2, e.speed * 0.8, dt);
          else { e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt)); }
          if (sees && e.cd <= 0 && td < 17) {
            e.cd = CFG.ENEMY.spitter.cd;
            projectiles.push({
              x: e.x + ux * 0.6, y: 1.15, z: e.z + uz * 0.6,
              vx: ux * 12, vz: uz * 12, life: 3, dmg: CFG.ENEMY.spitter.dmg,
              faction: 'undead', srcX: e.x, srcZ: e.z
            });
            flashes.push({ x: e.x + ux * 0.7, y: 1.3, z: e.z + uz * 0.7, yaw: Math.atan2(ux, uz), t: 0.08, s: 0.22 });
          }
        } else {
          if (td > reach) stepTo(e, tx, tz, e.speed, dt);
          else {
            e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
            if (sees && e.cd <= 0 && d < reach + 0.5) {
              e.cd = e.cdMax;
              e.lunge = 0.18;
              if (target && target.kind === 'player') damagePlayer(e.dmg);
              else if (target && target.ref) {
                damageEnemy(target.ref, e.dmg, Math.atan2(dx, dz), [0.85, 0.42, 0.30], true, false, e.x, e.z);
              }
            }
          }
        }
        if (!sees && e.lostT > 5) {
          e.state = 'patrol';
          e.patrol = pickPatrol(e);
          e.waitT = 0.4;
        }
      } else {
        if (!e.patrol) { e.patrol = pickPatrol(e); e.waitT = 0.5 + Math.random(); }
        if (e.waitT > 0) {
          e.waitT -= dt;
          e.yaw += Math.sin(time * 1.2 + e.seed) * dt * 0.6;
        } else if (stepTo(e, e.patrol.x, e.patrol.z, e.speed * 0.42, dt)) {
          e.waitT = 1.2 + Math.random() * 2.2;
          e.patrol = pickPatrol(e);
        }
      }

      /* 卡墙检测：持续想走但没有位移时，放弃当前目标并换方向 */
      const movedNow = Math.hypot(e.x - prevX, e.z - prevZ);
      if (e.moving && movedNow < 0.003) e.stuckT = (e.stuckT || 0) + dt;
      else e.stuckT = Math.max(0, (e.stuckT || 0) - dt * 1.5);
      if (e.stuckT > 0.55) {
        e.stuckT = 0;
        if (e.pryingChest) gunnerCancelPry(e);
        e.lootTarget = null;
        e.coverTarget = null;
        e.coverCd = Math.max(e.coverCd || 0, 1.2);
        if (e.gunner) {
          e.strafeDir *= -1;
          e.strafeT = 0.8;
          e.lootT = Math.max(e.lootT || 0, 1.5);
          e.state = sees ? 'engage' : 'patrol';
        } else {
          e.state = 'patrol';
          e.patrol = pickPatrol(e);
          e.waitT = 0;
        }
      }

      if (e.lunge) e.lunge = Math.max(0, e.lunge - dt);

      for (const o of enemies) {
        if (o === e || o.dead) continue;
        const ox = e.x - o.x, oz = e.z - o.z;
        const od = Math.hypot(ox, oz);
        const mn = e.r + o.r;
        if (od > 0.0001 && od < mn) {
          const push = (mn - od) * 0.5;
          const nx = e.x + ox / od * push;
          const nz = e.z + oz / od * push;
          if (!World.blocked(nx, nz, e.r)) { e.x = nx; e.z = nz; }
        }
      }
    }
    enemies = enemies.filter(function (e) { return e.corpse || !(e.dead && e.fade <= 0); });
  }

  /* ---------- 交互提示 ---------- */
  let promptT = 0;
  function updatePrompt(dt) {
    promptT -= dt;
    if (promptT > 0) return;
    promptT = 0.12;

    const nearChest = nearestChest();
    if (nearChest) {
      const cn = nearChest.name || '物资箱';
      if (nearChest.corpse) HUD.prompt((TOUCH_MODE ? '搜刮' : '[F] 搜刮') + ' ' + cn);
      else if (nearChest.prying) {
        HUD.prompt(nearChest.pryBy && nearChest.pryBy !== 'player' ? '拾荒者正在撬箱' : '自动撬开中 · 保持站位');
      }
      else if (!nearChest.pried) HUD.prompt('靠近自动撬开' + cn);
      else HUD.prompt((TOUCH_MODE ? '搜索' : '[F] 搜索') + ' ' + cn);
      return;
    }

    if (testMap && World.test && World.test.respawn) {
      const rp = World.test.respawn;
      const dr = Math.hypot(player.x - rp.x, player.z - rp.z);
      if (dr < rp.r) {
        HUD.objective(player.respawnDone ? '刷新点 · 已刷新' : '刷新点 · 站定 1 秒', true);
        HUD.prompt(player.respawnDone ? '离开刷新点后可再次刷新敌人' : '站定 1 秒刷新所有敌人');
        return;
      }
      if (dr < rp.r + 5) {
        HUD.objective('刷新点 · 已到达', true);
        HUD.prompt('站上蓝色刷新点');
        return;
      }
    }

    const dp = Math.hypot(player.x - World.pad.x, player.z - World.pad.z);
    if (dp < World.pad.r) HUD.objective('撤离台 · 保持站位', true);
    else if (dp < World.pad.r + 5) HUD.objective('撤离台 · 已到达', true);
    else HUD.objective('撤离点 · ' + Math.round(dp) + ' m', false);

    let best = null, bd = CFG.INTERACT_R + 0.6;
    for (const l of World.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - player.x, l.z - player.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (best) {
      const it = best.item;
      HUD.prompt((TOUCH_MODE ? '拾取' : '[F] 拾取') + ' <b style="color:' + ITEMS.tier(it.tierId).color + '">' +
        ITEMS.tier(it.tierId).name + ' · ' + it.name + '</b>');
      return;
    }
    if (dp < World.pad.r) HUD.prompt('保持站位 · 撤离同步中');
    else if (dp < World.pad.r + 5) HUD.prompt('撤离台就在附近');
    else HUD.prompt(null);
  }

  /* ---------- 更新 ---------- */
  /* 视野：24m 内且没有被墙/木箱遮挡；玩家本身 360° */
  function visionVisible(x, z) {
    const dx = x - player.x, dz = z - player.z;
    if (dx * dx + dz * dz > CFG.VISION.RANGE * CFG.VISION.RANGE) return false;
    return !World.sightBlocked(player.x, player.z, x, z);
  }

  function updateVision() {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      e.inVision = !e.dead && visionVisible(e.x, e.z);
    }
  }

  /* 硬边地面阴影：按玩家视线方向直接生成遮挡物的阴影多边形（直线边缘） */
  function buildShadowGeo() {
    const sg = R.shadow;
    if (!sg) return;
    const px = player.x, pz = player.z;
    const RANGE = CFG.VISION.RANGE;
    const FAR = RANGE + 10;

    function addRect(cx, cz, yaw, h) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const pts = [
        { x: cx + c * -h + s * -h, z: cz - s * -h + c * -h },
        { x: cx + c * h + s * -h, z: cz - s * h + c * -h },
        { x: cx + c * h + s * h, z: cz - s * h + c * h },
        { x: cx + c * -h + s * h, z: cz - s * -h + c * h }
      ];
      const angs = pts.map(function (q) { return Math.atan2(q.x - px, q.z - pz); });
      let best = -1, ai = 0, bi = 1;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          let d = Math.abs(angs[i] - angs[j]);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d > best) { best = d; ai = i; bi = j; }
        }
      }
      if (best < 0.02) return;
      const A = pts[ai], B = pts[bi];
      const ax = A.x - px, az = A.z - pz;
      const bx = B.x - px, bz = B.z - pz;
      const al = Math.hypot(ax, az) || 1;
      const bl = Math.hypot(bx, bz) || 1;
      const A2x = A.x + ax / al * FAR, A2z = A.z + az / al * FAR;
      const B2x = B.x + bx / bl * FAR, B2z = B.z + bz / bl * FAR;
      const Y = 0.045;
      sg.tri(A.x, A.z, B.x, B.z, B2x, B2z, Y, [1, 1, 1]);
      sg.tri(A.x, A.z, B2x, B2z, A2x, A2z, Y, [1, 1, 1]);
    }

    /* 墙体：只取靠近地板的实心格，避免把地图外的虚空当墙 */
    const CELL = CFG.CELL;
    const reach = Math.ceil((RANGE + CELL) / CELL);
    const pcx = Math.floor(px / CELL), pcz = Math.floor(pz / CELL);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (cx < 0 || cz < 0 || cx >= World.W || cz >= World.H) continue;
        if (World.isFloor(cx, cz)) continue;
        let nearFloor = false;
        for (let oz = -1; oz <= 1 && !nearFloor; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (World.isFloor(cx + ox, cz + oz)) { nearFloor = true; break; }
          }
        }
        if (!nearFloor) continue;
        const wc = World.cellCenter(cx, cz);
        if (Math.hypot(wc.x - px, wc.z - pz) > RANGE + CELL * 1.5) continue;
        addRect(wc.x, wc.z, 0, CELL * 0.5);
      }
    }

    /* 木箱 / 设备（物资箱不遮挡视野） */
    for (let i = 0; i < World.props.length; i++) {
      const p = World.props[i];
      if (Math.hypot(p.x - px, p.z - pz) > RANGE + 2) continue;
      addRect(p.x, p.z, p.rot, p.kind === 'crate' ? 0.6 : 0.33);
    }
  }

  function update(dt) {
    if (mode !== 'mission' || ended) return;
    if (paused) return;
    time += dt;

    /* 靠近物资箱自动开始撬箱；箱盖撬飞后由 F 主动搜索 */
    const autoChest = nearestChest();
    if (autoChest && !autoChest.corpse && !autoChest.pried && !autoChest.prying) startPry(autoChest);

    /* 物资箱：撬箱进度 / 撬飞箱盖 / 延迟进入搜索 */
    for (let i = 0; i < World.chests.length; i++) {
      const c = World.chests[i];
      if (c.corpse) continue;
      if (c.prying) {
        if (c.pryBy && c.pryBy !== 'player') {
          /* 敌人正在撬箱，由敌人 AI 推进进度 */
          if (c.pryBy.dead) cancelPry(c);
        } else {
          const d = Math.hypot(c.x - player.x, c.z - player.z) - (c.cr || 0);
          if (d > (CFG.CHEST_INTERACT_R || 1.8) + 0.9) {
            cancelPry(c, '离得太远 · 撬箱中断');
          } else {
            c.pryT += dt / CFG.CHEST_PRY_TIME;
            if (c.pryT >= 1) finishPry(c);
          }
        }
      }
      if (c.pryBurst > 0) c.pryBurst = Math.max(0, c.pryBurst - dt);
      if (c.openDelay > 0) c.openDelay = Math.max(0, c.openDelay - dt);
      /* 撬开后自动进入搜索；若当时不在附近或正在查看其它箱子，等条件满足时再自动打开 */
      if (c.autoSearch && c.openDelay <= 0 && !Inventory.isOpen()) {
        const d = Math.hypot(c.x - player.x, c.z - player.z) - (c.cr || 0);
        if (d <= (CFG.CHEST_INTERACT_R || 1.8) + 0.9) {
          c.autoSearch = false;
          Inventory.openChest(c);
        }
      }
    }
    updateLidDebris(dt);

    const invOpen = Inventory.isOpen();
    if (TOUCH_MODE) {
      if (invOpen && !touchInvSuspended) {
        touchInvSuspended = true;
        TOUCH.setEnabled(false);
      } else if (!invOpen && touchInvSuspended) {
        touchInvSuspended = false;
        TOUCH.setEnabled(true);
      }
    }
    Inventory.update(dt);

    /* 鼠标位置 → 地面瞄准点：角色与枪械朝向始终跟随鼠标 */
    if (TOUCH_MODE) {
      const tr = TOUCH.right;
      if (tr.active && tr.aimActive) {
        player.yaw = angLerp(player.yaw, tr.aimYaw, 1 - Math.exp(-TOUCH_AIM_LERP * dt));
      }
    } else {
      const gp = screenToGround(mouse.x, mouse.y, 0.9);
      if (gp) aim = gp;

      const adx = aim.x - player.x, adz = aim.z - player.z;
      if (Math.hypot(adx, adz) > 0.3) {
        player.yaw = angLerp(player.yaw, Math.atan2(adx, adz), 1 - Math.exp(-18 * dt));
      }
    }

    const tl = TOUCH.left;
    if (TOUCH_MODE && tl.autoMove &&
        (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD)) {
      TOUCH.cancelAuto();
    }

    let ix = 0, iz = 0, touchRun = false;
    const touchActive = TOUCH_MODE && tl.active && tl.mag > TOUCH_DEAD;
    if (touchActive) {
      ix = tl.x;
      iz = tl.y;
      touchRun = tl.zone !== 'inner';
    } else if (TOUCH_MODE && tl.autoMove) {
      /* 圈外松手后：保持松手瞬间的方向持续奔跑，直到再次触摸左摇杆 */
      ix = tl.autoX;
      iz = tl.autoY;
      touchRun = true;
    } else {
      if (keys.KeyW) iz -= 1;
      if (keys.KeyS) iz += 1;
      if (keys.KeyA) ix -= 1;
      if (keys.KeyD) ix += 1;
    }
    /* 打开转移界面时锁住角色移动（世界照常运行） */
    if (invOpen) { ix = 0; iz = 0; touchRun = false; }
    const mag = Math.hypot(ix, iz);
    player.moving = (mag > 0 || WALK) && !player.dead;
    if (mag > 0) player.moveYaw = Math.atan2(ix, iz);
    if (!isNaN(MV)) player.moveYaw = player.yaw + MV * Math.PI / 180;
    const wantSprint = touchActive
      ? touchRun
      : ((TOUCH_MODE && tl.autoMove) ? true : !!(keys.ShiftLeft || keys.ShiftRight));
    player.sprinting = wantSprint && player.stam > 1 && player.moving;

    let speed = player.sprinting ? CFG.PLAYER.run : CFG.PLAYER.walk;
    if (player.dead) speed = 0;
    if (mag > 0) { ix /= mag; iz /= mag; }

    if (player.sprinting) {
      player.stam = Math.max(0, player.stam - CFG.PLAYER.stamDrain * dt);
      player.stamTimer = CFG.PLAYER.stamDelay;
    } else {
      player.stamTimer = Math.max(0, player.stamTimer - dt);
      if (player.stamTimer <= 0) player.stam = Math.min(CFG.PLAYER.stam, player.stam + CFG.PLAYER.stamRegen * dt);
    }
    /* 测试场：无限体力，方便持续测试武器与走位 */
    if (testMap) {
      player.stam = CFG.PLAYER.stam;
      player.stamTimer = 0;
    }

    const mv = World.moveCircle(player.x, player.z, ix * speed * dt, iz * speed * dt, CFG.PLAYER.r);
    player.x = mv.x;
    player.z = mv.z;

    player.animT += dt * (player.sprinting ? 1.35 : 1);
    if (!player.moving) player.animT = 0;

    player.shieldTimer = Math.max(0, player.shieldTimer - dt);
    if (player.shieldTimer <= 0 && player.shield < player.maxShield && !player.dead) {
      player.shield = Math.min(player.maxShield, player.shield + CFG.PLAYER.shieldRate * dt);
    }

    player.cool = Math.max(0, player.cool - dt);
    player.recoil = Math.max(0, player.recoil - dt * 6);
    if (player.reload > 0) {
      player.reload -= dt;
      if (player.reload <= 0) {
        player.reload = 0;
        finishReload();
        HUD.mag(player.weapon);
      }
    }
    const curW = player.weapon >= 0 ? WEAPONS[player.weapon] : null;
    if (TOUCH_MODE && curW) {
      if (!invOpen) {
        if (curW.auto) {
          if (TOUCH.right.firing) fire();
        } else if (TOUCH.takeSemiShot()) {
          const tr = TOUCH.right;
          if (tr.aimActive) player.yaw = tr.aimYaw;
          fire();
        }
      }
    } else if ((mouse.down || AUTO) && !invOpen) {
      fire();
    }

    updateEnemies(dt);
    updateVision();

    /* 弹体 */
    for (const p of projectiles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (World.blocked(p.x, p.z, 0.1)) {
        p.life = 0;
        sparks.push({ x: p.x, y: p.y, z: p.z, t: 0.2, c: [0.73, 0.55, 1.0], s: 0.24 });
      }
      if (Math.hypot(p.x - player.x, p.z - player.z) < 0.7) {
        damagePlayer(p.dmg);
        p.life = 0;
      }
      if (p.life > 0) {
        const pf = p.faction || 'undead';
        let best = null, bestD = 1e9;
        for (const o of enemies) {
          if (o.dead || factionOf(o) === pf) continue;
          const od = Math.hypot(p.x - o.x, p.z - o.z);
          if (od < o.r + 0.32 && od < bestD) { bestD = od; best = o; }
        }
        if (best) {
          damageEnemy(best, p.dmg, Math.atan2(best.x - p.x, best.z - p.z),
            [0.73, 0.55, 1.0], true, false,
            p.srcX === undefined ? p.x : p.srcX,
            p.srcZ === undefined ? p.z : p.srcZ);
          sparks.push({ x: best.x, y: 1.0, z: best.z, t: 0.2, c: [0.73, 0.55, 1.0], s: 0.28 });
          p.life = 0;
        }
      }
    }
    projectiles = projectiles.filter(function (p) { return p.life > 0; });

    for (const b of bullets) {
      if (b.dead) continue;
      const dist = Math.hypot(b.vx, b.vz) * dt;
      const n = Math.max(1, Math.ceil(dist / 0.22));
      const sx = b.vx * dt / n, sz = b.vz * dt / n;
      for (let i = 0; i < n && !b.dead; i++) {
        const stepLen = Math.hypot(sx, sz) || 0.0001;
        const ux = sx / stepLen, uz = sz / stepLen;
        /* 子弹被墙体和非互动障碍物阻挡；可互动箱子/尸体可以穿过 */
        if (World.bulletBlocked(b.x, b.z)) {
          b.dead = true;
          bulletImpact(b);
          break;
        }
        const wallHit = World.rayWallHit(b.x, b.z, ux, uz, stepLen);
        if (!World.isFloorAt(b.x, b.z) || wallHit.axis) {
          if (wallHit.axis) {
            b.x += ux * wallHit.d;
            b.z += uz * wallHit.d;
          }
          b.dead = true;
          bulletImpact(b);
          break;
        }
        b.x += sx;
        b.z += sz;
        b.travelled += stepLen;
        if (World.bulletBlocked(b.x, b.z)) {
          b.dead = true;
          bulletImpact(b);
          break;
        }
        if (b.hostile) {
          const bf = b.faction || 'scav';
          let hitPlayer = false, hitEnemy = null, hitD = 1e9;
          if (!player.dead && !player.extracted) {
            const pd = Math.hypot(player.x - b.x, player.z - b.z);
            if (pd < CFG.PLAYER.r + b.r) { hitPlayer = true; hitD = pd; }
          }
          for (const e of enemies) {
            if (e.dead || factionOf(e) === bf) continue;
            const ed = Math.hypot(e.x - b.x, e.z - b.z);
            if (ed < e.r + b.r && ed < hitD) { hitD = ed; hitEnemy = e; hitPlayer = false; }
          }
          if (hitPlayer) {
            const t = clamp(b.travelled / b.range, 0, 1);
            damagePlayer(lerp(b.dmg, b.dmgFar, t));
            sparks.push({ x: b.x, y: 1.0, z: b.z, t: 0.2, c: b.c, s: 0.3 });
            b.dead = true;
            bulletImpact(b);
            break;
          }
          if (hitEnemy) {
            const t = clamp(b.travelled / b.range, 0, 1);
            damageEnemy(hitEnemy, lerp(b.dmg, b.dmgFar, t),
              Math.atan2(hitEnemy.x - b.x, hitEnemy.z - b.z),
              b.c, true, false,
              b.ox === undefined ? b.x : b.ox,
              b.oz === undefined ? b.z : b.oz);
            sparks.push({ x: hitEnemy.x, y: 1.02, z: hitEnemy.z, t: 0.2, c: b.c, s: 0.3 });
            b.dead = true;
            bulletImpact(b);
            break;
          }
        } else {
          for (const e of enemies) {
            if (e.dead) continue;
            if (b.hitEnemies && b.hitEnemies.indexOf(e) >= 0) continue;
            if (Math.hypot(e.x - b.x, e.z - b.z) < e.r + b.r) { hitBullet(b, e); break; }
          }
        }
        if (b.travelled >= b.range) { b.dead = true; bulletImpact(b); }
      }
    }
    bullets = bullets.filter(function (b) { return !b.dead; });

    for (const z of zones) {
      z.life -= dt;
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.25;
        for (const e of enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - z.x, e.z - z.z) < z.r) {
            damageEnemy(e, z.dps * 0.25, Math.atan2(e.x - z.x, e.z - z.z), z.c, true);
          }
        }
      }
    }
    zones = zones.filter(function (z) { return z.life > 0; });

    for (const t of tracers) t.t -= dt;
    tracers = tracers.filter(function (t) { return t.t > 0; });
    for (const f of flashes) f.t -= dt;
    flashes = flashes.filter(function (f) { return f.t > 0; });
    for (const s of sparks) s.t -= dt;
    sparks = sparks.filter(function (s) { return s.t > 0; });
    for (const b of beams) b.t -= dt;
    beams = beams.filter(function (b) { return b.t > 0; });
    for (const b of bolts) b.t -= dt;
    bolts = bolts.filter(function (b) { return b.t > 0; });
    for (const w of sonicWaves) w.t += dt;
    sonicWaves = sonicWaves.filter(function (w) { return w.t < w.life; });
    for (const r of rings) r.t -= dt;
    rings = rings.filter(function (r) { return r.t > 0; });

    /* 撤离 */
    const exHold = (testMap && World.test && World.test.extractHold) ? World.test.extractHold : CFG.EXTRACT_HOLD;
    const dp = Math.hypot(player.x - World.pad.x, player.z - World.pad.z);
    if (dp < World.pad.r && !player.dead) {
      player.extractT += dt;
      HUD.extract(player.extractT / exHold);
      if (player.extractT >= exHold) {
        player.extracted = true;
        finishRun(true, 'extract');
      }
    } else if (player.extractT > 0) {
      player.extractT = Math.max(0, player.extractT - dt * 2);
      HUD.extract(player.extractT / exHold);
    }

    /* 测试场刷新点：站定 1 秒刷新所有测试敌人 */
    if (testMap && World.test && World.test.respawn) {
      const rp = World.test.respawn;
      const dr = Math.hypot(player.x - rp.x, player.z - rp.z);
      if (dr < rp.r && !player.dead) {
        if (!player.respawnDone) {
          player.respawnT += dt;
          HUD.respawn(player.respawnT);
          if (player.respawnT >= 1) {
            player.respawnT = 0;
            player.respawnDone = true;
            respawnTestEnemies();
            HUD.respawn(0);
          }
        } else {
          HUD.respawn(0);
        }
      } else {
        player.respawnDone = false;
        if (player.respawnT > 0) {
          player.respawnT = Math.max(0, player.respawnT - dt * 2);
          HUD.respawn(player.respawnT);
        } else {
          HUD.respawn(0);
        }
      }
    } else if (testMap) {
      HUD.respawn(0);
    }

    if (player.dead) player.deadT += dt;
    updatePrompt(dt);
    HUD.vitals();
    HUD.data(player.data);
  }

  /* ---------- 渲染 ---------- */
  function drawLoot(geo) {
    const mask = R.mask;
    function put(o) {
      geo.box(o);
      if (mask) {
        const m = {};
        for (const k in o) m[k] = o[k];
        m.shadow = false;
        m.castOnly = false;
        mask.box(m);
      }
    }
    for (const l of World.loot) {
      if (l.taken) continue;
      const col = tierRgb(l.item ? l.item.tierId : 'common');
      const bob = Math.sin(time + l.x * 0.7) * 0.03;
      if (l.kind === 'case') {
        put({ x: l.x, y: 0.24 + bob, z: l.z, sx: 0.62, sy: 0.46, sz: 0.5, yaw: 0.4, color: PAL.teal, outline: 0.016, shadow: true });
        put({ x: l.x, y: 0.50 + bob, z: l.z, sx: 0.44, sy: 0.05, sz: 0.3, yaw: 0.4, color: col, outline: 0, emis: true });
      } else {
        put({ x: l.x, y: 0.3 + bob, z: l.z, sx: 0.36, sy: 0.6, sz: 0.36, yaw: 0.2, color: PAL.gunL, outline: 0.014, shadow: true });
        put({ x: l.x, y: 0.62 + bob, z: l.z, sx: 0.30, sy: 0.06, sz: 0.30, yaw: 0.2, color: col, outline: 0, emis: true });
      }
    }
  }

  function drawChests(geo) {
    const list = World.chests;
    if (!list || !list.length) return;
    const mask = R.mask;
    function maskBox(o) {
      if (!mask) return;
      const m = {};
      for (const k in o) m[k] = o[k];
      m.shadow = false;
      m.castOnly = false;
      mask.box(m);
    }
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.corpse) continue;
      const isW = c.type === 'weapon';
      const A = (typeof ASSETS !== 'undefined') ? (c.type === 'weapon' ? ASSETS.weaponcrate : ASSETS.chest) : null;
      const bx = c.x, bz = c.z;
      /* 简易落地阴影 */
      geo.box({
        x: bx, y: 0.03, z: bz, sx: isW ? 1.58 : 1.24, sy: 0.05, sz: isW ? 0.99 : 0.90, yaw: c.yaw,
        color: [0.335, 0.295, 0.285], outline: 0, castOnly: true, shadow: true
      });
      if (A && A.ready) {
        geo.mesh(A.body, { x: bx, y: 0, z: bz, yaw: c.yaw });
        if (mask) mask.mesh(A.body, { x: bx, y: 0, z: bz, yaw: c.yaw });
        if (!c.pried) {
          geo.mesh(A.lid, { x: bx, y: 0, z: bz, yaw: c.yaw });
          if (mask) mask.mesh(A.lid, { x: bx, y: 0, z: bz, yaw: c.yaw });
        }
      } else {
        const bodyBox = isW
          ? { x: bx, y: 0.15, z: bz, sx: 1.50, sy: 0.20, sz: 0.90, yaw: c.yaw, color: [0.135, 0.155, 0.180], shadow: false }
          : { x: bx, y: 0.315, z: bz, sx: 1.1, sy: 0.5, sz: 0.74, yaw: c.yaw, color: [0.16, 0.20, 0.23], shadow: false };
        const plinthBox = isW
          ? { x: bx, y: 0.03, z: bz, sx: 1.58, sy: 0.06, sz: 0.96, yaw: c.yaw, color: [0.455, 0.495, 0.535], shadow: false }
          : { x: bx, y: 0.035, z: bz, sx: 1.2, sy: 0.07, sz: 0.84, yaw: c.yaw, color: [0.46, 0.50, 0.54], shadow: false };
        const rimBox = isW
          ? { x: bx, y: 0.26, z: bz, sx: 1.56, sy: 0.04, sz: 0.92, yaw: c.yaw, color: [0.455, 0.495, 0.535], shadow: false }
          : { x: bx, y: 0.59, z: bz, sx: 1.16, sy: 0.05, sz: 0.80, yaw: c.yaw, color: [0.46, 0.50, 0.54], shadow: false };
        geo.box(plinthBox); maskBox(plinthBox);
        geo.box(bodyBox); maskBox(bodyBox);
        geo.box(rimBox); maskBox(rimBox);
        if (!c.pried) {
          const lidBox = isW
            ? { x: bx, y: 0.303, z: bz, sx: 1.52, sy: 0.054, sz: 0.90, yaw: c.yaw, color: [0.135, 0.155, 0.180], shadow: false }
            : { x: bx, y: 0.70, z: bz, sx: 1.16, sy: 0.17, sz: 0.80, yaw: c.yaw, color: [0.16, 0.20, 0.23], shadow: false };
          geo.box(lidBox); maskBox(lidBox);
          if (isW) {
            /* 后备模型的箱盖顶面也画出武器剪影，保证资产加载失败时外观一致 */
            const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
            const putLid = function (lx, ly, lz, sx, sy2, sz, color, emis) {
              const m = { x: bx + cs * lx + sn * lz, y: ly, z: bz - sn * lx + cs * lz, sx: sx, sy: sy2, sz: sz, yaw: c.yaw, color: color, outline: 0, emis: !!emis };
              geo.box(m); maskBox(m);
            };
            putLid(0, 0.334, 0, 1.42, 0.010, 0.80, [0.43, 0.465, 0.50]);
            putLid(0, 0.340, 0, 1.18, 0.008, 0.58, [0.040, 0.048, 0.056]);
            putLid(0.17, 0.346, -0.10, 0.64, 0.014, 0.040, [1.0, 0.56, 0.12], true);
            putLid(-0.04, 0.346, -0.10, 0.30, 0.016, 0.115, [1.0, 0.56, 0.12], true);
            putLid(-0.33, 0.346, -0.10, 0.24, 0.014, 0.095, [1.0, 0.56, 0.12], true);
            putLid(-0.17, 0.346, -0.015, 0.065, 0.016, 0.115, [0.93, 0.51, 0.165]);
            putLid(-0.03, 0.346, 0.020, 0.10, 0.018, 0.135, [0.93, 0.51, 0.165]);
            putLid(0.10, 0.346, -0.035, 0.16, 0.014, 0.045, [0.93, 0.51, 0.165]);
            putLid(0.22, 0.348, -0.155, 0.10, 0.016, 0.030, [1.0, 0.72, 0.26], true);
            putLid(-0.06, 0.350, -0.175, 0.14, 0.020, 0.050, [1.0, 0.72, 0.26], true);
            putLid(0.50, 0.348, -0.10, 0.05, 0.018, 0.060, [1.0, 0.72, 0.26], true);
            putLid(0, 0.334, -0.34, 1.24, 0.008, 0.045, [0.93, 0.51, 0.165]);
          }
        }
        geo.box({
          x: bx + Math.sin(c.yaw) * 0.39, y: 0.42, z: bz + Math.cos(c.yaw) * 0.39,
          sx: 0.07, sy: 0.05, sz: 0.04, yaw: c.yaw, color: [1, 0.78, 0.34], outline: 0, emis: true
        });
      }
      /* 撬开后露出黑色内腔和里面剩余的物资 */
      if (c.pried) {
        geo.box({
          x: bx, y: isW ? 0.263 : 0.622, z: bz,
          sx: isW ? 1.40 : 1.0, sy: 0.02, sz: isW ? 0.80 : 0.64,
          yaw: c.yaw, color: [0.035, 0.045, 0.055], outline: 0
        });
        geo.box({
          x: bx, y: isW ? 0.259 : 0.618, z: bz,
          sx: isW ? 1.42 : 1.02, sy: 0.008, sz: isW ? 0.82 : 0.66,
          yaw: c.yaw, color: [0.9, 0.55, 0.20], outline: 0, emis: true
        });
        const n = Math.min(3, c.inv.length);
        for (let k = 0; k < n; k++) {
          const it = c.inv[k];
          const col = it ? tierRgb(it.tierId) : [0.6, 0.6, 0.6];
          const lx = (k - (n - 1) / 2) * 0.28;
          const lz = 0.05;
          const wx = bx + Math.cos(c.yaw) * lx + Math.sin(c.yaw) * lz;
          const wz = bz - Math.sin(c.yaw) * lx + Math.cos(c.yaw) * lz;
          geo.box({
            x: wx, y: isW ? 0.28 : 0.64, z: wz, sx: 0.16, sy: 0.10, sz: 0.16,
            yaw: c.yaw, color: col, outline: 0, emis: true
          });
        }
      }
      /* 撬箱：底部环形进度 + 完成时向外散去的环 */
      if (c.prying) {
        const t = Math.max(0, Math.min(1, c.pryT || 0));
        const a0 = -Math.PI / 2;
        geo.arc(c.x, c.z, 0.82, 0.90, 0, Math.PI * 2, 0.055, [0.12, 0.07, 0.03], 56);
        if (t > 0) {
          geo.arc(c.x, c.z, 0.82, 0.90, a0, a0 + t * Math.PI * 2, 0.066,
            [1.0, 0.62, 0.22], Math.max(8, Math.ceil(t * 56)));
        }
      }
      if (c.pryBurst > 0) {
        const k = Math.max(0, Math.min(1, c.pryBurst / 0.45));
        const r = 0.90 + (1 - k) * 0.95;
        geo.arc(c.x, c.z, r, r + 0.07, 0, Math.PI * 2, 0.07,
          [k, k * 0.55, k * 0.18], 56);
      }
    }

    /* 撬飞的箱盖：绕自身中心翻滚 */
    if (!lidDebris.length) return;
    for (let i = 0; i < lidDebris.length; i++) {
      const d = lidDebris[i];
      const A = (typeof ASSETS !== 'undefined') ? (d.type === 'weapon' ? ASSETS.weaponcrate : ASSETS.chest) : null;
      const lc = (A && A.lidCenter) ? A.lidCenter : [0, 0.74, 0];
      if (A && A.ready) {
        geo.mesh(A.lid, {
          x: d.x - lc[0], y: d.y - lc[1] - (d.sink || 0), z: d.z - lc[2],
          yaw: d.yaw, rotX: d.pitch,
          px: lc[0], py: lc[1], pz: lc[2]
        });
      } else {
        const isW = d.type === 'weapon';
        geo.box({
          x: d.x, y: d.y - (d.sink || 0), z: d.z,
          sx: isW ? 1.52 : 1.16, sy: isW ? 0.054 : 0.17, sz: isW ? 0.90 : 0.80,
          yaw: d.yaw, rotX: d.pitch, color: [0.16, 0.20, 0.23], shadow: false
        });
      }
    }
  }

  function render() {
    R.setVision({
      x: player.x, z: player.z, yaw: player.yaw,
      half: CFG.VISION.HALF_DEG * Math.PI / 180,
      range: CFG.VISION.RANGE,
      soft: CFG.VISION.EDGE_SOFT_DEG * Math.PI / 180,
      shade: CFG.VISION.SHADE
    });
    R.begin();
    buildShadowGeo();
    const geo = R.dyn;
    const xray = R.xray;
    const ov = R.overlay;
    const um = R.unitMask;

    MODELS.drawUnit(geo, player.charKey, {
      x: player.x, y: 0, z: player.z, yaw: player.yaw,
      moving: player.moving, animT: player.animT,
      moveYaw: player.moveYaw,
      deadT: player.dead ? player.deadT : 0
    });

    const gy = 0.74 - player.recoil * 0.03;
    const gx = player.x - Math.cos(player.yaw) * 0.20;
    const gz = player.z + Math.sin(player.yaw) * 0.20;
    if (!player.dead && player.weapon >= 0) {
      MODELS.drawGun(geo, player.weapon, {
        x: gx + Math.sin(player.yaw) * 0.32,
        y: gy,
        z: gz + Math.cos(player.yaw) * 0.32,
        yaw: player.yaw, scale: 1.15
      });
    }
    if (um) {
      MODELS.drawUnit(um, player.charKey, {
        x: player.x, y: 0, z: player.z, yaw: player.yaw,
        moving: player.moving, animT: player.animT,
        moveYaw: player.moveYaw,
        deadT: player.dead ? player.deadT : 0
      });
      if (!player.dead && player.weapon >= 0) {
        MODELS.drawGun(um, player.weapon, {
          x: gx + Math.sin(player.yaw) * 0.32,
          y: gy,
          z: gz + Math.cos(player.yaw) * 0.32,
          yaw: player.yaw, scale: 1.15
        });
      }
    }
    if (ov) {
      MODELS.drawUnit(ov, player.charKey, {
        x: player.x, y: 0, z: player.z, yaw: player.yaw,
        moving: player.moving, animT: player.animT, moveYaw: player.moveYaw,
        deadT: player.dead ? player.deadT : 0,
        overlay: true
      });
      if (!player.dead && player.weapon >= 0) {
        MODELS.drawGun(ov, player.weapon, {
          x: gx + Math.sin(player.yaw) * 0.32,
          y: gy,
          z: gz + Math.cos(player.yaw) * 0.32,
          yaw: player.yaw, scale: 1.15, overlay: true
        });
      }
    }

    for (const e of enemies) {
      if (e.dead) {
        if (e.corpse) {
          const spread = Math.min(0.36, e.deadT || 0);
          MODELS.drawUnit(geo, e.type, {
            x: e.x, y: 0, z: e.z, yaw: e.yaw,
            animT: e.animT, deadT: spread
          });
          if (um) MODELS.drawUnit(um, e.type, {
            x: e.x, y: 0, z: e.z, yaw: e.yaw,
            animT: e.animT, deadT: spread
          });
          if ((e.deadT || 0) > 0.45 && e.corpseContainer &&
              (e.corpseContainer.inv.length ||
               (e.corpseContainer.weapons && (e.corpseContainer.weapons[0] || e.corpseContainer.weapons[1])))) {
            const bob = Math.sin(time * 2.2 + e.seed) * 0.045;
            geo.box({
              x: e.x, y: 0.62 + bob, z: e.z,
              sx: 0.11, sy: 0.11, sz: 0.11, yaw: 0.6,
              color: [1.0, 0.70, 0.28], outline: 0, emis: true
            });
          }
        } else {
          const deadT = Math.max(0, 1.9 - e.fade);
          const sinkT = deadT > 1.1 ? Math.min(1, (deadT - 1.1) / 0.8) : 0;
          const sink = sinkT * sinkT;
          MODELS.drawUnit(geo, e.type, {
            x: e.x, y: -sink * 0.95, z: e.z, yaw: e.yaw,
            animT: e.animT, deadT: deadT
          });
          if (um) MODELS.drawUnit(um, e.type, {
            x: e.x, y: -sink * 0.95, z: e.z, yaw: e.yaw,
            animT: e.animT, deadT: deadT
          });
        }
        continue;
      }
      /* 阴影/视野外：不画模型、枪、状态标记和橙色遮挡剪影 */
      if (e.inVision !== true) continue;
      MODELS.drawUnit(geo, e.type, {
        x: e.x, y: 0, z: e.z, yaw: e.yaw,
        moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw
      });
      if (e.gunner) {
        const gx = e.x + Math.sin(e.yaw) * 0.42 - Math.cos(e.yaw) * 0.15;
        const gz = e.z + Math.cos(e.yaw) * 0.42 + Math.sin(e.yaw) * 0.15;
        MODELS.drawGun(geo, CFG.GUNNER.weaponId, {
          x: gx, y: 1.0, z: gz, yaw: e.yaw, scale: 0.92
        });
        if (um) MODELS.drawGun(um, CFG.GUNNER.weaponId, {
          x: gx, y: 1.0, z: gz, yaw: e.yaw, scale: 0.92
        });
      }
      if (um) MODELS.drawUnit(um, e.type, {
        x: e.x, y: 0, z: e.z, yaw: e.yaw,
        moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw
      });
      if (ov) {
        MODELS.drawUnit(ov, e.type, {
          x: e.x, y: 0, z: e.z, yaw: e.yaw,
          moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw,
          overlay: true
        });
        if (e.gunner) {
          const ox = e.x + Math.sin(e.yaw) * 0.42 - Math.cos(e.yaw) * 0.15;
          const oz = e.z + Math.cos(e.yaw) * 0.42 + Math.sin(e.yaw) * 0.15;
          MODELS.drawGun(ov, CFG.GUNNER.weaponId, {
            x: ox, y: 1.0, z: oz, yaw: e.yaw, scale: 0.92, overlay: true
          });
        }
      }
      if (e.hitFlash > 0) {
        const hf = e.hitFlash / 0.12;
        geo.box({
          x: e.x, y: MODELS.height(e.type) * 0.45, z: e.z,
          sx: 0.52 * hf, sy: MODELS.height(e.type) * 0.9 * hf, sz: 0.52 * hf,
          yaw: e.yaw, color: [1, 0.95, 0.9], outline: 0, emis: true
        });
      }
      if (e.state === 'alert' || e.state === 'chase' || e.state === 'attack' ||
          e.state === 'engage' || e.state === 'cover' || e.state === 'search') {
        const c = (e.state === 'alert' || e.state === 'search') ? [1.0, 0.82, 0.25] : [1.0, 0.26, 0.20];
        const bob = Math.sin(time * 7 + e.seed) * 0.05;
        geo.box({
          x: e.x, y: MODELS.height(e.type) + 0.30 + bob, z: e.z,
          sx: 0.13, sy: 0.13, sz: 0.13, yaw: 0.5,
          color: c, outline: 0, emis: true
        });
      }
    }

    drawLoot(geo);
    drawChests(geo);

    for (const p of projectiles) {
      geo.box({ x: p.x, y: p.y, z: p.z, sx: 0.16, sy: 0.16, sz: 0.16, color: [0.73, 0.55, 1.0], outline: 0, emis: true });
    }

    for (const s of tracers) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      geo.box({
        x: (s.x0 + s.x1) / 2, y: 1.0, z: (s.z0 + s.z1) / 2,
        sx: 0.055, sy: 0.055, sz: len,
        yaw: Math.atan2(dx, dz),
        color: s.c, outline: 0, emis: true
      });
    }

    for (const f of flashes) {
      const k = clamp(f.t / 0.07, 0, 1);
      const c = f.c || [1.0, 0.82, 0.42];
      geo.box({
        x: f.x, y: f.y, z: f.z, sx: f.s * k * 0.55, sy: f.s * k * 0.55, sz: f.s * 1.7 * k,
        yaw: f.yaw, color: c, outline: 0, emis: true
      });
      geo.box({
        x: f.x, y: f.y, z: f.z, sx: f.s * k * 0.5, sy: f.s * k * 0.18, sz: f.s * k * 1.1,
        yaw: f.yaw + Math.PI / 2, color: c, outline: 0, emis: true
      });
      geo.box({
        x: f.x, y: f.y, z: f.z, sx: f.s * k * 0.42, sy: f.s * k * 0.42, sz: f.s * k * 0.42,
        yaw: f.yaw, color: [1, 1, 0.96], outline: 0, emis: true
      });
    }

    for (const b of bullets) {
      const yaw = Math.atan2(b.vx, b.vz);
      const sp = Math.hypot(b.vx, b.vz) || 1;
      const ux = b.vx / sp, uz = b.vz / sp;
      if (b.kind === 'thermal') {
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.30, sy: 0.30, sz: 0.44, yaw: yaw, color: b.c, outline: 0, emis: true });
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.14, sy: 0.14, sz: 0.30, yaw: yaw, color: [1, 0.86, 0.56], outline: 0, emis: true });
        const tl = 1.6;
        geo.box({
          x: b.x - ux * tl * 0.5, y: b.y, z: b.z - uz * tl * 0.5,
          sx: 0.22, sy: 0.22, sz: tl, yaw: yaw, color: b.c, outline: 0, emis: true
        });
        for (let i = 0; i < 3; i++) {
          const f = 0.25 + i * 0.22;
          const side = Math.sin(time * 30 + i * 2.1) * 0.18;
          geo.box({
            x: b.x - ux * tl * f + Math.cos(yaw) * side,
            y: b.y + Math.sin(time * 20 + i) * 0.12,
            z: b.z - uz * tl * f - Math.sin(yaw) * side,
            sx: 0.12, sy: 0.12, sz: 0.16, yaw: yaw,
            color: i % 2 ? [1, 0.5, 0.18] : [1, 0.75, 0.3], outline: 0, emis: true
          });
        }
      } else if (b.kind === 'kinetic') {
        const tl = 2.4;
        geo.box({
          x: b.x - ux * tl * 0.5, y: b.y, z: b.z - uz * tl * 0.5,
          sx: 0.055, sy: 0.055, sz: tl, yaw: yaw, color: b.c, outline: 0, emis: true
        });
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.16, sy: 0.16, sz: 0.44, yaw: yaw, color: b.c, outline: 0, emis: true });
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.08, sy: 0.08, sz: 0.26, yaw: yaw, color: [1, 1, 1], outline: 0, emis: true });
      } else {
        const tl = 1.1;
        geo.box({
          x: b.x - ux * tl * 0.5, y: b.y, z: b.z - uz * tl * 0.5,
          sx: 0.13, sy: 0.13, sz: tl, yaw: yaw, color: b.c, outline: 0, emis: true
        });
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.26, sy: 0.26, sz: 0.30, yaw: yaw, color: b.c, outline: 0, emis: true });
        geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.12, sy: 0.12, sz: 0.22, yaw: yaw, color: [1, 1, 1], outline: 0, emis: true });
        for (let i = 0; i < 3; i++) {
          const a = yaw + Math.PI / 2 + (i - 1) * 0.9;
          const rr = 0.22 + (i % 2) * 0.08;
          geo.box({
            x: b.x + Math.cos(a) * rr,
            y: b.y + Math.sin(time * 31 + i) * 0.16,
            z: b.z - Math.sin(a) * rr,
            sx: 0.08, sy: 0.08, sz: 0.08, yaw: a,
            color: i === 0 ? [0.95, 0.85, 1] : b.c, outline: 0, emis: true
          });
        }
      }
    }

    for (const bm of beams) {
      const bk = clamp(bm.t / 0.24, 0, 1);
      const pulse = Math.sin((1 - bk) * Math.PI);
      const outer = 0.14 + pulse * 0.06;
      const inner = 0.04 + pulse * 0.03;
      for (let i = 1; i < bm.pts.length; i++) {
        const p0 = bm.pts[i - 1], p1 = bm.pts[i];
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const yaw = Math.atan2(dx, dz);
        geo.box({
          x: (p0.x + p1.x) / 2, y: 1.02, z: (p0.z + p1.z) / 2,
          sx: outer, sy: outer, sz: len, yaw: yaw,
          color: bm.c, outline: 0, emis: true
        });
        geo.box({
          x: (p0.x + p1.x) / 2, y: 1.02, z: (p0.z + p1.z) / 2,
          sx: inner, sy: inner, sz: len, yaw: yaw,
          color: [1, 1, 1], outline: 0, emis: true
        });
        if (i > 1) {
          geo.box({
            x: p0.x, y: 1.08, z: p0.z,
            sx: 0.22 + pulse * 0.1, sy: 0.04, sz: 0.22 + pulse * 0.1,
            yaw: yaw + Math.PI / 4, color: [1, 1, 1], outline: 0, emis: true
          });
        }
      }
    }

    for (const bo of bolts) {
      const dx = bo.x1 - bo.x0, dz = bo.z1 - bo.z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const yaw = Math.atan2(dx, dz);
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const f = k / segs;
        const jx = Math.sin(bo.seed + k * 2.1 + time * 25) * 0.15;
        const jz = Math.cos(bo.seed * 1.7 + k * 1.7 + time * 23) * 0.15;
        const y = 1.05 + Math.sin(bo.seed + k * 3.3 + time * 28) * 0.12;
        geo.box({
          x: bo.x0 + dx * f + jx, y: y, z: bo.z0 + dz * f + jz,
          sx: 0.09, sy: 0.09, sz: len / segs * 1.2,
          yaw: yaw, color: bo.c, outline: 0, emis: true
        });
        geo.box({
          x: bo.x0 + dx * f + jx, y: y, z: bo.z0 + dz * f + jz,
          sx: 0.035, sy: 0.035, sz: len / segs * 1.2,
          yaw: yaw, color: [1, 1, 1], outline: 0, emis: true
        });
      }
      geo.box({ x: bo.x0, y: 1.12, z: bo.z0, sx: 0.14, sy: 0.14, sz: 0.14, yaw: yaw, color: bo.c, outline: 0, emis: true });
      geo.box({ x: bo.x1, y: 1.12, z: bo.z1, sx: 0.2, sy: 0.2, sz: 0.2, yaw: yaw, color: [0.95, 0.85, 1], outline: 0, emis: true });
    }

    for (const w of sonicWaves) {
      /* xray 层：声波穿墙可见。三条错开的波面，每段都断开成
         独立能量块，避免连成一条弧线（近场也不再画同心弧）。 */
      for (let b = 0; b < 3; b++) {
        const bt = w.t - b * 0.075;
        if (bt <= 0 || bt >= 0.52) continue;
        const pb = clamp(bt / 0.52, 0, 1);
        const ease = 1 - (1 - pb) * (1 - pb);
        const r = 0.55 + ease * (w.range - 0.55);
        const fade = 1 - pb;
        const near = 1 - r / w.range;
        const amp = (0.1 + 0.75 * fade) * (0.35 + near * 0.65);
        const seg = 18;
        const a0 = w.ang - w.half;
        const a1 = w.ang + w.half;
        const step = (a1 - a0) / seg;
        for (let i = 0; i < seg; i++) {
          /* 隔段留空：波面是碎片状的，而不是一条连续弧 */
          if ((i + b * 2) % 3 === 2) continue;
          const t0 = a0 + step * i;
          const mid = t0 + step * 0.5;
          const edge = Math.cos((mid - w.ang) / w.half * Math.PI * 0.5);
          if (edge < 0.12) continue;
          const phase = i * 0.9 + w.seed + b * 1.7 + pb * 6;
          const wave = Math.sin(phase);
          const h = 0.14 + amp * (0.5 + 0.5 * wave) * edge;
          if (h < 0.1) continue;
          const x = w.x + Math.sin(mid) * r;
          const z = w.z + Math.cos(mid) * r;
          const bright = wave > 0.25 ? [1, 0.94, 0.78] : w.c;
          xray.box({
            x: x,
            y: 0.16 + h * 0.5 + Math.sin(phase * 0.7) * 0.04 * near,
            z: z,
            sx: 0.10 + near * 0.05,
            sy: h,
            sz: Math.max(0.14, r * step * 0.72),
            yaw: mid + Math.PI / 2,
            color: bright, outline: 0, emis: true
          });
        }
      }
    }

    for (const z of zones) {
      const k = clamp(z.life / 0.6, 0, 1);
      /* 不画地面范围线：用满半径的火舌和边缘余烬表达燃烧范围 */
      for (let i = 0; i < 12; i++) {
        const a = z.seed + i * 2.399;
        const rr = z.r * (0.2 + 0.78 * ((i * 0.37) % 1));
        const flick = 0.5 + 0.5 * Math.abs(Math.sin(time * 7 + i * 1.7 + z.seed));
        const h = (0.2 + 0.55 * flick) * Math.max(0.18, k);
        const col = i % 2 ? [1, 0.44, 0.16] : [1, 0.72, 0.28];
        geo.box({
          x: z.x + Math.sin(a) * rr,
          y: 0.04 + h * 0.5,
          z: z.z + Math.cos(a) * rr,
          sx: 0.16 + 0.08 * flick,
          sy: h,
          sz: 0.16 + 0.08 * flick,
          yaw: a,
          color: col, outline: 0, emis: true
        });
      }
      /* 边缘余烬：断续的小火点，替代原来的一圈指示线 */
      for (let i = 0; i < 8; i++) {
        const a = z.seed + i * (Math.PI * 2 / 8);
        const rr = z.r * (0.9 + 0.05 * Math.sin(time * 3 + i));
        const h = 0.08 + 0.1 * Math.abs(Math.sin(time * 9 + i));
        geo.box({
          x: z.x + Math.sin(a) * rr,
          y: 0.04 + h * 0.5,
          z: z.z + Math.cos(a) * rr,
          sx: 0.14, sy: h, sz: 0.14, yaw: a,
          color: i % 2 ? [1, 0.5, 0.18] : z.c,
          outline: 0, emis: true
        });
      }
      const pulse = 0.35 + Math.sin(time * 9 + z.seed) * 0.12;
      geo.box({
        x: z.x, y: 0.12, z: z.z,
        sx: pulse * Math.max(0.35, k), sy: 0.3, sz: pulse * Math.max(0.35, k),
        yaw: z.seed, color: [1, 0.72, 0.3], outline: 0, emis: true
      });
    }

    for (const s of sparks) {
      const k = Math.max(0.12, s.t / 0.18);
      geo.box({
        x: s.x, y: s.y, z: s.z,
        sx: s.s * k, sy: s.s * k, sz: s.s * k,
        color: s.c, outline: 0, emis: true
      });
    }

    R.end();
  }

  function renderLobby() {
    R.setVision(null);
    R.begin();
    const geo = R.dyn;
    const sway = Math.sin(lobbyT * 0.45) * 0.28;
    const charKey = charKeyOf(Store.char());
    const yaw = inspectYaw + (inspectDrag ? 0 : sway * 0.35);
    MODELS.drawUnit(geo, charKey, {
      x: 0, y: 0.06, z: 0, yaw: yaw,
      moving: false, animT: lobbyT, moveYaw: 0
    });
    if (R.unitMask) MODELS.drawUnit(R.unitMask, charKey, {
      x: 0, y: 0.06, z: 0, yaw: yaw,
      moving: false, animT: lobbyT, moveYaw: 0
    });
    Hangar.drawDynamic(geo, lobbyT);
    R.end();
  }

  /* ---------- 出击 / 结算 / 回大厅 ---------- */
  function beginMission(cfg) {
    if (mode === 'mission') return;
    cfg = cfg || {};
    const isTest = !!cfg.testMap;
    testMap = isTest;
    document.body.classList.toggle('test-map', isTest);
    let entries;
    if (isTest) {
      entries = WEAPONS.map(function (_, wi) {
        return { item: ITEMS.makeWeaponItem(wi), mags: 9 };
      });
    } else if (cfg.weapons !== undefined) {
      const list = Array.isArray(cfg.weapons) ? cfg.weapons : [];
      const mags = Array.isArray(cfg.mags) ? cfg.mags : [];
      entries = list.slice(0, 2).map(function (x, i) {
        const item = (typeof x === 'number') ? ITEMS.makeWeaponItem(x) : Grid.cloneItem(x);
        return { item: item, mags: clamp(mags[i] | 0, 0, CFG.CARRY_MAX_MAGS) };
      }).filter(function (e) { return e.item && e.item.kind === 'weapon'; });
    } else {
      const lo = Store.loadout();
      entries = [];
      for (let i = 0; i < 2; i++) {
        if (!lo.weapons[i]) continue;
        entries.push({ item: Grid.cloneItem(lo.weapons[i]), mags: lo.mags[i] | 0 });
      }
    }

    seed = (Math.random() * 1e9) | 0;
    if (isTest) World.genTest(seed);
    else World.gen(seed);
    R.buildStatic(function (geo) { World.buildStatic(geo); });
    if (typeof MINIMAP !== 'undefined') MINIMAP.build();

    const aug = Store.augments();
    player.maxHp = Store.maxHp();
    player.maxShield = Store.maxShield();
    player.hp = player.maxHp;
    player.shield = player.maxShield;
    player.stam = CFG.PLAYER.stam;
    player.dead = false;
    player.deadT = 0;
    player.extracted = false;
    player.extractT = 0;
    player.respawnT = 0;
    player.respawnDone = false;
    player.reloadMul = Store.reloadMul();
    player.invRows = Store.invRows();
    player.charKey = charKeyOf(cfg.character !== undefined ? cfg.character : Store.char());

    player.carried = entries.map(function (e) { return e.item; });
    player.slot = player.carried.length ? 0 : -1;
    player.weapon = player.carried.length ? player.carried[0].weaponId : -1;
    player.weaponChips = WEAPONS.map(function () { return []; });
    for (let i = 0; i < player.carried.length; i++) {
      const it = player.carried[i];
      player.weaponChips[it.weaponId] = (it.chips || []).map(function (c) {
        return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
      });
    }
    recalcWeaponMods();
    player.mags = [];
    player.spares = [];
    if (isTest) {
      for (let i = 0; i < entries.length; i++) {
        player.mags[i] = WEAPONS[entries[i].item.weaponId].mag;
        player.spares[i] = 9;
      }
    } else {
      for (let e = 0; e < entries.length; e++) {
        const wi = entries[e].item.weaponId;
        const w = WEAPONS[wi];
        const n = clamp(entries[e].mags | 0, 0, CFG.CARRY_MAX_MAGS);
        player.mags[e] = n > 0 ? w.mag : 0;
        player.spares[e] = n > 0 ? Math.min(w.maxSpare, n - 1) : 0;
      }
    }
    player.data = isTest ? 3000 : (cfg.data || 0);
    player.inv = [];
    player.sel = null;
    player.looted = 0;
    player.dismantledValue = 0;
    player.kit = isTest ? { medkit: 6, battery: 9 } : {
      medkit: Store.kit().medkit, battery: Store.kit().battery
    };

    player.x = World.spawn.x;
    player.z = World.spawn.z;
    player.yaw = TOUCH_MODE ? Math.PI : 0;
    player.moveYaw = player.yaw;
    player.cool = 0;
    player.reload = 0;
    player.recoil = 0;
    player.shieldTimer = 0;
    player.stamTimer = 0;

    /* 鼠标默认停在屏幕中心，开局面向设施深处 */
    if (canvas && canvas.clientWidth) {
      mouse.x = canvas.clientWidth * 0.5;
      mouse.y = canvas.clientHeight * 0.5;
      HUD.aimAt(mouse.x, mouse.y);
    }

    kills = 0; looted = 0; spittersKilled = 0; time = 0;
    tracers = []; flashes = []; sparks = []; projectiles = [];
    bullets = []; zones = []; beams = []; bolts = []; sonicWaves = []; rings = [];
    lidDebris = [];
    CAM.pitch = (Q_PITCH >= 30 && Q_PITCH <= 90)
      ? Q_PITCH
      : clamp(Store.raw().settings.pitch || CFG.CAM.PITCH, 30, 90);
    CAM.focus = [player.x, CFG.CAM.HEIGHT_OFF, player.z];
    CAM.eye = [player.x, player.maxShield + 12, player.z + 12];

    enemies = [];
    if (isTest) {
      spawnTestEnemies();
    } else {
      const types = ['zombie', 'zombie', 'zombie', 'gaunt', 'spitter'];
      for (let i = 0; i < CFG.ENEMY_COUNT; i++) {
        const c = i < CFG.NEAR_SPAWN ? spawnNear(player.x, player.z, 7, 15)
          : World.randomFloorPoint({ x: player.x, z: player.z }, CFG.SPAWN_MIN);
        const t = types[i % types.length];
        const ecfg = CFG.ENEMY[t];
        enemies.push({
          x: c.x, z: c.z, home: { x: c.x, z: c.z }, type: t, faction: 'undead',
          hp: ecfg.hp, maxHp: ecfg.hp, r: ecfg.r, speed: ecfg.speed, dmg: ecfg.dmg,
          cd: 0, cdMax: ecfg.cd, yaw: Math.random() * 6.28, animT: 0,
          moving: false, dead: false, fade: 1.9, hitFlash: 0, lunge: 0,
          state: 'idle', alertT: 0, lostT: 0, waitT: 0, patrol: null,
          lastSeenX: c.x, lastSeenZ: c.z, seen: false, seed: Math.random() * 10,
          viewR: t === 'spitter' ? 20 : (t === 'gaunt' ? 15 : 16),
          viewHalf: t === 'spitter' ? 1.15 : 0.95
        });
      }

      /* 拾荒者枪手：与丧尸混编，三种模型第一版共用同一套 AI */
      const gtypes = ['scav', 'raider', 'scav', 'veteran', 'scav', 'raider', 'scav', 'veteran', 'raider'];
      for (let i = 0; i < CFG.GUNNER_COUNT; i++) {
        let c = null;
        for (let k = 0; k < 40; k++) {
          const p = World.randomFloorPoint({ x: player.x, z: player.z }, 18);
          if (World.blocked(p.x, p.z, 0.5)) continue;
          c = p;
          break;
        }
        if (!c) c = World.randomFloorPoint({ x: player.x, z: player.z }, 16);
        enemies.push(makeGunner(gtypes[i % gtypes.length], c.x, c.z));
      }
    }

    mode = 'mission';
    ended = false;
    endReason = '';
    if (canvas) canvas.style.cursor = '';
    paused = false;
    mouse.down = false;
    Inventory.beginRun();
    Inventory.reset();
    Lobby.hide();
    HUD.reset();
    HUD.buildSlots(player);
    HUD.setCombatMode(true);
    HUD.hideEnd();
    HUD.data(player.data);
    HUD.prompt(null);
    const d0 = Math.hypot(World.spawn.x - World.pad.x, World.spawn.z - World.pad.z);
    HUD.objective('撤离点 · ' + Math.round(d0) + ' m', false);
    if (isTest) {
      HUD.objective('测试场 · 撤离台 ' + Math.round(d0) + ' m', false);
      HUD.toast('测试场 · 1-5 切换武器 · 蓝色刷新点站 1 秒', 'good');
    } else {
      HUD.toast('进入设施 · 搜刮物资并寻找撤离台', 'good');
    }
    setPause(false);
    if (TOUCH_MODE) {
      touchInvSuspended = false;
      TOUCH.reset();
      TOUCH.setAuto(player.weapon >= 0 && !!WEAPONS[player.weapon].auto);
      if (!SELFTEST && isPortrait()) setPause(true);
    }
    if (QS.get('die') === '1') { player.dead = true; player.deadT = 0.5; }
    flash(380);
  }

  function finishRun(win, reason) {
    if (ended || mode !== 'mission') return;
    for (let i = 0; i < World.chests.length; i++) {
      World.chests[i].prying = false;
      World.chests[i].pryT = 0;
      World.chests[i].pryBy = null;
      World.chests[i].autoSearch = false;
      World.chests[i].openDelay = 0;
    }
    if (testMap) {
      setPause(false);
      ended = true;
      paused = false;
      mouse.down = false;
      if (TOUCH_MODE) TOUCH.setEnabled(false);
      Inventory.close();
      toLobby();
      HUD.toast('测试场结束 · 返回机库', 'good');
      return;
    }
    setPause(false);
    ended = true;
    endReason = reason || (win ? 'extract' : 'death');
    paused = false;
    mouse.down = false;
    if (TOUCH_MODE) TOUCH.setEnabled(false);
    const pauseBox = $('pause');
    if (pauseBox) pauseBox.classList.add('hidden');
    Inventory.close();
    HUD.setCombatMode(true);

    const haul = player.inv.reduce(function (s, it) { return s + (it.value || 0); }, 0);
    const itemCount = player.inv.length;
    const t = time;
    let stored = 0, overflow = 0, overflowValue = 0;

    if (win) {
      /* 局内装卸过的芯片随撤离写回武器物品 */
      for (let i = 0; i < player.carried.length; i++) {
        const it = player.carried[i];
        it.chips = (player.weaponChips[it.weaponId] || []).map(function (c) {
          return { chipId: c.chipId, tierId: c.tierId, value: c.value | 0 };
        });
      }
      const oldLo = Store.loadout();
      Store.setLoadout({ weapons: player.carried, mags: oldLo.mags, carry: oldLo.carry });
      const r = Store.stashAddMany(player.inv);
      stored = r.stored;
      overflow = r.overflowCount;
      overflowValue = r.overflowValue;
      Store.addBank(player.data);
      Store.setKit(player.kit);
    } else {
      Store.clearLoadoutWeapons();
      Store.setKit({ medkit: 0, battery: 0 });
    }

    const before = Store.contracts().map(function (c) { return c.progress; });
    Contracts.applyRun({
      win: win,
      kills: kills,
      loot: looted,
      data: player.data,
      haul: haul,
      spitters: spittersKilled,
      dismantled: player.dismantledValue
    });
    const after = Store.contracts();
    const done = [];
    for (let i = 0; i < after.length; i++) {
      if (!after[i].claimed && after[i].progress >= after[i].target && before[i] < after[i].target) {
        done.push(after[i].title);
      }
    }

    Store.recordRun({
      win: win, kills: kills, loot: looted,
      data: win ? player.data : 0,
      haul: win ? haul : 0,
      time: t
    });
    Store.save();

    HUD.end(win, {
      reason: endReason,
      kills: kills,
      loot: looted,
      time: t,
      data: win ? player.data : 0,
      haul: win ? haul : 0,
      itemCount: itemCount,
      stored: stored,
      overflow: overflow,
      overflowValue: overflowValue,
      dismantled: player.dismantledValue,
      contracts: done,
      best: Store.best()
    });
  }

  function toLobby() {
    if (mode === 'lobby') return;
    mode = 'lobby';
    ended = false;
    paused = false;
    mouse.down = false;
    endReason = '';
    testMap = false;
    document.body.classList.remove('test-map');
    if (canvas) canvas.style.cursor = 'grab';
    if (TOUCH_MODE) TOUCH.setEnabled(false);
    HUD.respawn(0);
    Inventory.reset();
    HUD.setCombatMode(false);
    HUD.hideEnd();
    const pauseBox = $('pause');
    if (pauseBox) pauseBox.classList.add('hidden');
    R.buildStatic(function (geo) { Hangar.buildStatic(geo); });
    CAM.pitch = 23;
    Lobby.show();
    Lobby.refreshBank();
  }

  let flashTimer = 0;
  function flash(ms) {
    if (QS.get('go')) return;              // 调试截图不做闪屏
    const f = $('flash');
    if (!f) return;
    clearTimeout(flashTimer);
    f.style.display = 'block';
    f.classList.add('on');
    flashTimer = setTimeout(function () {
      f.classList.remove('on');
      f.style.display = 'none';
    }, ms || 300);
  }

  /* 测试场固定靶：不移动、不攻击，血量较高，站在刷新点可整体重置 */
  function spawnTestEnemies() {
    enemies = [];
    if (!World.test || !World.test.spawns) return;
    for (let i = 0; i < World.test.spawns.length; i++) {
      const s = World.test.spawns[i];
      const ecfg = CFG.ENEMY[s.type] || CFG.ENEMY.zombie;
      enemies.push({
        x: s.x, z: s.z, home: { x: s.x, z: s.z }, type: s.type, faction: 'undead',
        hp: 400, maxHp: 400, r: ecfg.r, speed: 0, dmg: 0,
        cd: 0, cdMax: 999, yaw: Math.random() * 6.28, animT: 0,
        moving: false, dead: false, fade: 1.9, hitFlash: 0, lunge: 0,
        state: 'idle', alertT: 0, lostT: 0, waitT: 0, patrol: null,
        lastSeenX: s.x, lastSeenZ: s.z, seen: false, seed: Math.random() * 10,
        viewR: 0, viewHalf: 0, testGroup: s.group
      });
    }
  }

  function respawnTestEnemies() {
    spawnTestEnemies();
    HUD.toast('测试场 · 所有敌人已刷新', 'good');
  }

  /* 在玩家周围环形刷几只，开局就有压迫感 */
  function spawnNear(px, pz, minD, maxD) {
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * 6.2832;
      const d = minD + Math.random() * (maxD - minD);
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (World.blocked(x, z, 0.55)) continue;
      if (World.los(x, z, px, pz)) return { x: x, z: z };
      if (i > 60) return { x: x, z: z };
    }
    return World.randomFloorPoint({ x: px, z: pz }, minD);
  }

  /* ---------- 主循环 ---------- */
  function frame(ts) {
    if (!running) return;
    try {
      const now = ts / 1000;
      const dt = Math.min(0.05, now - last);
      last = now;
      if (mode === 'lobby') {
        updateLobbyCamera(dt);
        renderLobby();
      } else {
        update(dt);
        updateCamera(dt);
        if (TOUCH_MODE) {
          const ax = player.x + Math.sin(player.yaw) * 2.4;
          const az = player.z + Math.cos(player.yaw) * 2.4;
          const sp = worldToScreen(ax, 0.9, az);
          if (sp) HUD.aimAt(sp.x, sp.y);
        }
        render();
      }
      HUD.tick(dt);
    } catch (err) {
      running = false;
      const el = $('loading');
      if (el) {
        el.classList.remove('hidden');
        el.textContent = '运行时错误: ' + (err && err.message ? err.message : err) +
          ' @' + (err && err.stack ? String(err.stack).split('\n')[1] : '');
      }
      console.error(err);
      return;
    }
    requestAnimationFrame(frame);
  }

  function bindUi() {
    $('againBtn').addEventListener('click', toLobby);
    $('resumeBtn').addEventListener('click', function () { setPause(false); });
    $('abandonBtn').addEventListener('click', function () { finishRun(false, 'abandon'); });

    const actions = document.querySelectorAll('[data-touch-act]');
    for (let i = 0; i < actions.length; i++) {
      const btn = actions[i];
      btn.addEventListener('click', function () {
        if (mode !== 'mission' || ended || paused || player.dead) return;
        const act = btn.getAttribute('data-touch-act');
        if (act === 'reload') startReload();
        else if (act === 'loot') tryLoot();
        else if (act === 'inventory') Inventory.toggle();
        else if (act === 'pause') setPause(true);
      });
    }

    const rotateBtn = $('rotateBtn');
    if (rotateBtn) {
      rotateBtn.addEventListener('click', function () {
        const status = $('rotateStatus');
        const note = function (s) { if (status) status.textContent = s; };
        if (typeof MOBILE === 'undefined') return;
        MOBILE.enterGame().then(function (ok) {
          setTimeout(function () {
            if (window.innerWidth < window.innerHeight) {
              note('浏览器未自动旋转，请手动把手机横过来');
            } else {
              note(ok ? '已进入横屏' : '请手动把手机横过来');
            }
          }, 800);
        });
      });
    }
  }

  function boot() {
    canvas = $('gl');
    canvas.style.cursor = 'grab';
    Store.load();
    try {
      R.init(canvas);
      R.resize(canvas);
      R.setFog(34, 92);
      R.setSky([0.11, 0.13, 0.15]);

      Inventory.init();
      Stash.init();
      Shop.init();
      ChipShop.init();
      Contracts.init();
      Lobby.init();
      HUD.setCombatMode(false);
      TOUCH.init();
      if (typeof MOBILE !== 'undefined') MOBILE.init();

      bindInput();
      bindUi();

      R.buildStatic(function (geo) { Hangar.buildStatic(geo); });
      player.charKey = charKeyOf(Store.char());
      mode = 'lobby';
      CAM.pitch = 23;

      running = true;
      last = performance.now() / 1000;
      requestAnimationFrame(frame);
      $('loading').classList.add('hidden');

      devBoot();
    } catch (err) {
      const el = $('loading');
      if (el) {
        el.classList.remove('hidden');
        el.textContent = '启动失败: ' + (err && err.message ? err.message : err);
      }
      console.error(err);
    }
  }

  /* ---------- 调试入口（截图 / 自测用） ---------- */
  function devBoot() {
    if (QS.get('demo') === '1') {
      Store.demo();
      Lobby.reloadFromSave();
      Lobby.refreshBank();
    }
    const tab = QS.get('tab');
    if (tab) Lobby.setTab(tab);

    const go = QS.get('go');
    if (!go) return;
    setTimeout(function () {
      try {
        devGo(go);
      } catch (e) {
        console.error(e);
        document.title = 'DEVGO-ERR: ' + (e && e.message);
      }
    }, 60);
  }

  function devGo(kind) {
    if (kind === 'lobby') return;
    if (kind === 'test') {
      beginMission({ testMap: true, character: Store.char() });
      return;
    }
    const lo = Store.loadout();
    beginMission({
      weapons: lo.weapons, mags: lo.mags,
      data: 500, character: Store.char()
    });
    if (QS.get('safe') === '1') enemies.length = 0;
    if (kind === 'pause') { setPause(true); return; }
    if (kind === 'mission') return;

    for (let i = 0; i < 6; i++) Inventory.addItem(ITEMS.roll(null, null, 0.4));
    if (kind === 'inventory') { Inventory.open(); return; }
    if (kind === 'end') { finishRun(true, 'extract'); return; }
    if (kind === 'death') { finishRun(false, 'death'); return; }
    if (kind === 'extract') { finishRun(true, 'extract'); return; }
  }

  window.addEventListener('DOMContentLoaded', boot);

  return {
    get mode() { return mode; },
    get ended() { return ended; },
    beginMission: beginMission,
    beginTestMap: function () { beginMission({ testMap: true, character: Store.char() }); },
    finishRun: finishRun,
    toLobby: toLobby,
    switchSlot: switchSlot,
    installChip: installChip,
    uninstallChip: uninstallChip,
    equipWeaponItem: equipWeaponItem,
    unequipWeaponSlot: unequipWeaponSlot,
    weaponChips: weaponChipList,
    weaponMods: function (wi) { return modsOf(wi); },
    chipFits: chipFits,
    setPaused: setPause,
    togglePause: function () { setPause(!paused); },
    vision: visionVisible,
    startReload: startReload,
    tryLoot: tryLoot,
    noteLoot: noteLoot,
    toggleInventory: function () { Inventory.toggle(); },
    worldToScreen: worldToScreen,
    worldToScreenClamped: worldToScreenClamped,
    devGo: devGo,
    debug: {
      tick: function (dt) { if (mode === 'mission' && !paused) update(dt); },
      pickup: tryLoot,
      teleport: function (x, z) { player.x = x; player.z = z; },
      clearEnemies: function () { enemies.length = 0; },
      hurtEnemy: function (i, dmg) {
        const e = enemies[i];
        if (e) damageEnemy(e, dmg || 1, 0, [1, 1, 1], true);
      },
      reload: startReload,
      finishReload: finishReload
    },
    state: {
      player: player,
      cam: CAM,
      get enemies() { return enemies; },
      get beams() { return beams; },
      get lidDebris() { return lidDebris; },
      get time() { return time; },
      get kills() { return kills; },
      get looted() { return looted; }
    }
  };
})();
