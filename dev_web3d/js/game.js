'use strict';

/* ============================================================
   主循环：大厅 ⇄ 设施
   - 大厅：3D 机库 + 配装 / 仓库 / 补给 / 合约 / 档案
   - 设施：射击 / 敌人 AI / 搜刮 / 撤离
   - 结算：数据入账、物资入库、合约与战绩更新
   ============================================================ */

const G = (function () {
  window.__gameBuild = window.__build || '20261127c1';
  if (typeof console !== 'undefined') console.info('EOFATA game ' + window.__gameBuild);
  if (typeof document !== 'undefined') {
    document.title = 'EOFATA 3D — End of Future : ATA · ' + window.__gameBuild;
  }
  let canvas;
  let running = false, last = 0;
  let time = 0;
  /* 可见性 / 地面收集物视野不需要每帧重算，10–14Hz 足够且能省下大量 LOS。 */
  let visionClock = 0.08;
  let lootVisionClock = 0.1;
  let lootCompactT = 0;
  let lobbyT = 0;
  let inspectYaw = 0.35;
  let inspectDrag = null;
  let paused = false;
  let ended = false;
  let mode = 'lobby';           // 'lobby' | 'mission'
  let endReason = '';
  let testMap = false;
  let trainingOpen = false;     // 训练场配装台界面
  let trainingWeapons = [];     // 训练场当前选择的武器 id
  let trainingGadgets = [];     // 训练场当前选择的道具 id

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
    aimYaw: 0, headYaw: 0, headWorldYaw: 0, aimActive: false,
    swayT: 0, moveBlend: 0, gunCarryMix: 0, sprintBlend: 0,
    hp: CFG.PLAYER.hp, maxHp: CFG.PLAYER.hp,
    shield: CFG.PLAYER.shield, maxShield: CFG.PLAYER.shield,
    stam: CFG.PLAYER.stam, moving: false, animT: 0, sprinting: false,
    weapon: 0, slot: 0, carried: [], cool: 0, reload: 0, recoil: 0,
    reloadDur: 1,
    weaponMods: [],
    shieldTimer: 0, stamTimer: 0, dead: false, deadT: 0,
    mags: [], spares: [],
    data: 0, infiniteData: false, inv: [], sel: null, invRows: CFG.INV_ROWS,
    gadgets: [], gadgetCd: [0, 0], gadgetAim: -1,
    gadgetTarget: { x: 0, z: 0 },
    gadgetAimOffset: { x: 0, z: 0 },
    looted: 0, dismantledValue: 0,
    extractT: 0, extracted: false, reloadMul: 1,
    respawnT: 0, respawnDone: false,
    charKey: 'scout'
  };

  let enemies = [];
  let enemyAlive = [];    // 每帧复用：只含存活单位，避免目标 / 推挤扫描尸体
  let squads = [];        // 清剿小队编组 / 共享目标
  let aiPathBudget = 0;   // 每帧最多重算几条 A*，避免所有 AI 同帧寻路造成尖峰
  let squadPathBudget = 0; // 小队队员跟随轨迹单独预算，避免被其他 AI 抢光
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
  let knives = [];        // 道具：飞刀
  let grenades = [];      // 道具：手榴弹投掷物
  let blasts = [];        // 道具：手榴弹爆炸
  let radFields = [];     // 道具：辐射场
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
  let touchInvSuspended = false;

  const keys = {};
  const mouse = {
    x: 0, y: 0, down: false,
    locked: false,
    autoLockPending: false,
    lastUiLock: false
  };

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  const CHAR_KEYS = ['scout', 'assault', 'tactical', 'scav', 'raider', 'veteran',
    'specter', 'ranger', 'breacher', 'juggernaut', 'vanguard', 'sentinel'];
  function charKeyOf(i) { return CHAR_KEYS[i] || 'scout'; }
  function angDiff(a, b) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
  function normAngle(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function isPortrait() {
    if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
    return window.innerWidth < window.innerHeight;
  }

  /* 可选鼠标锁定：真实指针被浏览器锁在窗口中心，游戏用相对位移维持虚拟准星。
     按 L 切换；打开背包 / 暂停 / 结算时自动解除，避免无法操作 UI。 */
  /* 需要在用户手势里重新请求锁定：解除 UI 后调用 */
  function armMouseLock() {
    if (TOUCH_MODE) return;
    mouse.autoLockPending = true;
    setMouseLock(true);
  }

  function setMouseLock(on) {
    if (TOUCH_MODE || !canvas) return;
    if (on) {
      if (mode !== 'mission' || paused || ended || Inventory.isOpen()) return;
      if (canvas.requestPointerLock) {
        const p = canvas.requestPointerLock();
        if (p && p.catch) {
          p.catch(function () {
            HUD.toast('无法锁定鼠标 · 点击画面或按 L 重试', 'warn');
          });
        }
      }
    } else if (document.exitPointerLock && document.pointerLockElement) {
      document.exitPointerLock();
    }
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

  /* 屏幕外敌人：只统计小地图上已经显示的敌人（inVision），
     如果胸口投影落在屏幕内就交给 3D 画面；否则返回屏幕方向给 HUD 画边缘头像。 */
  function offscreenEnemyMarkers() {
    if (mode !== 'mission' || ended || paused || player.dead) return null;
    if (Inventory.isOpen() || trainingOpen) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 40 || h < 40) return { w: w, h: h, list: [] };

    const list = [];
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead || e.inVision !== true) continue;

      const eyeY = MODELS.height(e.type) * 0.55;
      const s = worldToScreen(e.x, eyeY, e.z);
      if (s && s.x > 4 && s.x < w - 4 && s.y > 4 && s.y < h - 4) continue;

      let dx, dy;
      if (s) {
        dx = s.x - halfW;
        dy = s.y - halfH;
      } else {
        /* 敌人在相机后方：用相机地面朝向把世界方向换算成屏幕方向 */
        const fx = CAM.focus[0] - CAM.eye[0];
        const fz = CAM.focus[2] - CAM.eye[2];
        const fl = Math.hypot(fx, fz) || 1;
        const rx = -fz / fl, rz = fx / fl;
        const vx = e.x - player.x, vz = e.z - player.z;
        dx = vx * rx + vz * rz;
        dy = -(vx * (fx / fl) + vz * (fz / fl));
      }
      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = 1;

      list.push({
        type: e.type,
        dist: Math.hypot(e.x - player.x, e.z - player.z),
        dx: dx,
        dy: dy
      });
    }
    return { w: w, h: h, list: list };
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

      /* 训练配装台界面：F / TAB / ESC 关闭，P 暂停 */
      if (trainingOpen) {
        if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyF') {
          e.preventDefault();
          closeTrainingLoadout();
          armMouseLock();
          return;
        }
        if (e.code === 'KeyP') {
          e.preventDefault();
          closeTrainingLoadout();
          setPause(true);
          return;
        }
        return;
      }

      if (e.code === 'Escape') {
        if (Inventory.isOpen()) {
          Inventory.close();
          e.preventDefault();
          armMouseLock();
          return;
        }
        if (paused) {
          setPause(false);
          e.preventDefault();
          armMouseLock();
          return;
        }
        setPause(true);
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (paused) { setPause(false); armMouseLock(); }
        else setPause(true);
        return;
      }
      if (paused) return;

      if (e.code === 'KeyL') {
        e.preventDefault();
        if (mouse.locked) {
          mouse.autoLockPending = false;
          setMouseLock(false);
        } else {
          mouse.autoLockPending = true;
          setMouseLock(true);
        }
        return;
      }
      if (e.code === 'BracketLeft') { setPitch(-1); e.preventDefault(); }
      if (e.code === 'BracketRight') { setPitch(1); e.preventDefault(); }
      if (e.code === 'Tab') {
        e.preventDefault();
        cancelGadgetAim();
        if (Inventory.isOpen()) {
          Inventory.close();
          armMouseLock();
        } else {
          setMouseLock(false);
          Inventory.open();
        }
        return;
      }
      if (e.code === 'KeyQ') {
        if (!e.repeat) startGadgetAim(0);
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyE') {
        if (!e.repeat) startGadgetAim(1);
        e.preventDefault();
        return;
      }
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
    window.addEventListener('keyup', function (e) {
      keys[e.code] = false;
      if (mode !== 'mission') return;
      if (e.code === 'KeyQ' && player.gadgetAim === 0) { e.preventDefault(); useGadget(0); }
      else if (e.code === 'KeyE' && player.gadgetAim === 1) { e.preventDefault(); useGadget(1); }
    });
    window.addEventListener('mousemove', function (e) {
      if (TOUCH_MODE) return;
      /* 正在操作物资箱 / 背包 / 尸体等界面时只移动界面指针，不更新瞄准，避免转动视角 */
      if (Inventory.isOpen() || trainingOpen) {
        const r = canvas.getBoundingClientRect();
        HUD.aimAt(e.clientX - r.left, e.clientY - r.top);
        return;
      }
      if (mouse.locked) {
        /* 指针锁定后 clientX/Y 固定在中心，用相对位移驱动虚拟准星 */
        const w = canvas.clientWidth, h = canvas.clientHeight;
        mouse.x = clamp(mouse.x + (e.movementX || 0), 0, w);
        mouse.y = clamp(mouse.y + (e.movementY || 0), 0, h);
      } else {
        const r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left;
        mouse.y = e.clientY - r.top;
      }
      player.aimActive = true;
      addGrenadeAimDelta(e.movementX || 0, e.movementY || 0);
      HUD.aimAt(mouse.x, mouse.y);
    });
    document.addEventListener('pointerlockchange', function () {
      mouse.locked = document.pointerLockElement === canvas;
      if (mouse.locked) {
        mouse.autoLockPending = false;
        HUD.toast('鼠标已锁定 · 移动鼠标瞄准 · L 解除', 'good');
      } else if (!Inventory.isOpen() && !trainingOpen) {
        /* 解除锁定后系统指针回到窗口中心：同步一下虚拟指针，方便操作 UI。
           打开界面时不解锁重置，避免关闭界面后视角突然回正。 */
        mouse.x = canvas.clientWidth * 0.5;
        mouse.y = canvas.clientHeight * 0.5;
        HUD.aimAt(mouse.x, mouse.y);
      }
    });
    document.addEventListener('pointerlockerror', function () {
      mouse.locked = false;
      HUD.toast('浏览器拒绝锁定鼠标 · 点击画面或按 L 重试', 'warn');
    });
    canvas.addEventListener('mousedown', function (e) {
      if (TOUCH_MODE) return;
      if (e.button !== 0 || mode !== 'mission' || paused || ended || Inventory.isOpen()) return;
      /* 系统指针未锁定：第一次点击用来请求锁定，不误开火 */
      if (!mouse.locked && mouse.autoLockPending) {
        mouse.autoLockPending = false;
        setMouseLock(true);
        e.preventDefault();
        return;
      }
      mouse.down = true;
    });
    window.addEventListener('mouseup', function (e) { if (e.button === 0) mouse.down = false; });
    window.addEventListener('blur', function () {
      mouse.down = false;
      cancelGadgetAim();
    });
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
    if (paused) {
      cancelGadgetAim();
      closeTrainingLoadout();
      setMouseLock(false);
    }
    mouse.down = false;
    HUD.setCursorVisible(paused && !TOUCH_MODE);
    if (TOUCH_MODE) TOUCH.setEnabled(!paused);
    const box = $('pause');
    if (box) box.classList.toggle('hidden', !paused);
    if (paused) Inventory.close();
  }

  /* ---------- 武器芯片 ---------- */
  const EMPTY_MODS = { dmg: 0, rate: 0, reload: 0, recoil: 0 };

  function modsOf(slot) { return player.weaponMods[slot] || EMPTY_MODS; }

  function recalcWeaponMods() {
    player.weaponMods = player.carried.map(function (it) {
      return ITEMS.computeMods(it.chips || []);
    });
  }

  function weaponChipList(slot) {
    const it = player.carried[slot];
    return it && Array.isArray(it.chips) ? it.chips : [];
  }

  function chipFits(slot, item) {
    const it = player.carried[slot];
    return !!(it && WEAPONS[it.weaponId] && ITEMS.chipFitsWeapon(item, it.weaponId));
  }

  function installChip(slot, item) {
    const carried = player.carried[slot];
    if (!carried) return false;
    const list = carried.chips || (carried.chips = []);
    if (list.length >= 3) return false;
    const entry = ITEMS.chipEntry(item);
    if (!entry) return false;
    if (!ITEMS.chipFitsWeapon(entry, carried.weaponId)) return false;
    list.push(entry);
    recalcWeaponMods();
    HUD.updateSlots(player);
    return true;
  }

  function uninstallChip(slot, chipSlot) {
    const carried = player.carried[slot];
    const list = carried && carried.chips;
    if (!list || !list[chipSlot]) return null;
    const item = ITEMS.makeChipItem(list[chipSlot]);
    if (!item) return null;
    list.splice(chipSlot, 1);
    recalcWeaponMods();
    HUD.updateSlots(player);
    return item;
  }

  /* 局内从背包或容器直接装备武器；两槽已满时替换当前手持槽。
     opts.external = true 时物品不必在背包中（物资箱 / 尸体直接装备）。 */
  function equipWeaponItem(item, opts) {
    if (!item || item.kind !== 'weapon') return false;
    const external = !!(opts && opts.external);
    const at = player.inv.indexOf(item);
    if (at < 0 && !external) return false;
    const wi = item.weaponId;
    if (!WEAPONS[wi]) return false;
    const copy = Grid.cloneItem(item);
    let slot = player.carried.length;
    if (slot >= 2) slot = player.slot >= 0 ? player.slot : 0;
    const newMag = (typeof copy.mag === 'number') ? copy.mag : WEAPONS[wi].mag;
    const newSpares = (typeof copy.spares === 'number') ? copy.spares : 0;
    if (at >= 0) player.inv.splice(at, 1);
    if (slot < player.carried.length) {
      const old = player.carried[slot];
      const oldCopy = Grid.cloneItem(old);
      oldCopy.mag = (typeof player.mags[slot] === 'number') ? player.mags[slot] : WEAPONS[old.weaponId].mag;
      oldCopy.spares = player.spares[slot] || 0;
      if (!Grid.autoPlace(player.inv, oldCopy, CFG.INV_COLS, player.invRows)) {
        if (at >= 0) player.inv.splice(at, 0, item);
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
    copy.mag = (typeof player.mags[slot] === 'number') ? player.mags[slot] : WEAPONS[item.weaponId].mag;
    copy.spares = player.spares[slot] || 0;
    if (!Grid.autoPlace(player.inv, copy, CFG.INV_COLS, player.invRows)) return false;
    player.inv.push(copy);
    player.carried.splice(slot, 1);
    player.mags.splice(slot, 1);
    player.spares.splice(slot, 1);
    recalcWeaponMods();
    if (player.slot >= player.carried.length) player.slot = player.carried.length - 1;
    if (player.slot < 0) player.slot = 0;
    player.weapon = player.carried.length ? player.carried[player.slot].weaponId : -1;
    HUD.buildSlots(player);
    if (player.weapon >= 0) HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE && player.weapon >= 0) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
    return true;
  }

  /* ---------- 丢出物品 ----------
     朝准星地面落点抛出；落点不可站立时沿投掷线退回，最后退回脚边。 */
  const THROW_MAX = 6.5;
  function throwLandingPoint() {
    const px = player.x, pz = player.z;
    let tx = px, tz = pz;
    const adx = aim ? (aim.x - px) : 0;
    const adz = aim ? (aim.z - pz) : 0;
    const ad = Math.hypot(adx, adz);
    if (aim && ad >= 1.2 && ad <= THROW_MAX + 0.3) {
      tx = aim.x; tz = aim.z;
    } else {
      const yaw = (player.aimYaw === undefined) ? player.yaw : player.aimYaw;
      const d = Math.min(THROW_MAX, Math.max(2.2, ad || THROW_MAX));
      tx = px + Math.sin(yaw) * d;
      tz = pz + Math.cos(yaw) * d;
    }
    const walkable = function (x, z) { return !World.blocked(x, z, 0.36); };
    if (!walkable(tx, tz)) {
      const dx = tx - px, dz = tz - pz;
      for (let f = 0.85; f >= 0.18; f -= 0.11) {
        const nx = px + dx * f, nz = pz + dz * f;
        if (walkable(nx, nz)) return { x: nx, z: nz };
      }
      return { x: px, z: pz };
    }
    return { x: tx, z: tz };
  }

  function spawnThrownLoot(item, to) {
    const copy = Grid.cloneItem(item);
    copy.found = true;
    copy.foundAt = 0;
    const isWeapon = copy.kind === 'weapon';
    const dx = to.x - player.x, dz = to.z - player.z;
    const dist = Math.hypot(dx, dz);
    const drop = {
      x: player.x,
      z: player.z,
      kind: isWeapon ? 'weapon' : (copy.kind === 'chip' ? 'canister' : 'case'),
      taken: false,
      tier: copy.tierId,
      item: copy,
      yaw: Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.5,
      throwT: 0,
      throwDur: 0.32 + Math.min(0.28, dist * 0.035),
      throwArc: 0.65 + Math.min(0.45, dist * 0.055),
      fromX: player.x,
      fromZ: player.z,
      toX: to.x,
      toZ: to.z,
      dropH: 0
    };
    World.loot.push(drop);
    return drop;
  }

  function throwBackpackItem(item) {
    if (mode !== 'mission' || ended || player.dead) return false;
    if (!item || player.inv.indexOf(item) < 0) return false;
    const to = throwLandingPoint();
    player.inv.splice(player.inv.indexOf(item), 1);
    if (player.sel === item) player.sel = null;
    spawnThrownLoot(item, to);
    HUD.toast('已丢出 ' + item.name, 'good');
    return true;
  }

  function throwEquippedWeapon(slot) {
    if (mode !== 'mission' || ended || player.dead) return false;
    if (slot < 0 || slot >= player.carried.length) return false;
    const item = player.carried[slot];
    const copy = Grid.cloneItem(item);
    copy.mag = (typeof player.mags[slot] === 'number') ? player.mags[slot] : WEAPONS[item.weaponId].mag;
    copy.spares = player.spares[slot] || 0;
    player.carried.splice(slot, 1);
    player.mags.splice(slot, 1);
    player.spares.splice(slot, 1);
    recalcWeaponMods();
    if (player.slot > slot) player.slot--;
    else if (player.slot === slot) {
      player.slot = Math.min(slot, player.carried.length - 1);
    }
    if (player.slot < 0) player.slot = 0;
    player.weapon = player.carried.length ? player.carried[player.slot].weaponId : -1;
    player.reload = 0;
    HUD.buildSlots(player);
    if (player.weapon >= 0) HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE && player.weapon >= 0) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
    spawnThrownLoot(copy, throwLandingPoint());
    HUD.toast('已丢出 ' + item.name, 'good');
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
  let lastSprintFireT = -9;
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
    /* 奔跑中按 R：先停下，再进入换弹；换弹结束前不会重新起跑 */
    player.sprinting = false;
    const m = modsOf(player.slot);
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

  /* 玩家枪械姿势：普通持枪 / 横枪奔跑 / 换弹
     sway 与身体使用同一组摆动；gunCarryMix 让进入 / 离开奔跑时快速缓动 */
  function playerGunPose(sway) {
    if (player.dead || player.weapon < 0) return null;
    const sw = sway || { yaw: 0, shift: 0 };
    const mix = Math.max(0, Math.min(1, player.gunCarryMix));
    const bodyYaw = player.yaw + sw.yaw * mix;
    const cy = Math.cos(bodyYaw), sy = Math.sin(bodyYaw);
    const normalX = player.x - cy * 0.20 + sy * 0.32;
    const normalZ = player.z + sy * 0.20 + cy * 0.32;
    const normalY = 0.74 - player.recoil * 0.03;
    const cp = MODELS.carryPose(0.5);
    /* 枪根在胸前，并跟随身体的左右摆动；留出枪身厚度，避免 W/S 时插进背心 */
    const carryX = player.x + sy * 0.29 + cy * sw.shift;
    const carryZ = player.z + cy * 0.29 - sy * sw.shift;
    const carryY = 0.72 + cp.y;
    const x = normalX + (carryX - normalX) * mix;
    const z = normalZ + (carryZ - normalZ) * mix;
    let y = normalY + (carryY - normalY) * mix;
    let yawOffset = cp.yawOffset * mix;
    let pitch = cp.pitch * mix;
    let reloading = false, magY = 0, magScale = 1;
    if (player.reload > 0) {
      reloading = true;
      const dur = player.reloadDur || 1;
      const phase = 1 - player.reload / dur;
      const rp = MODELS.reloadPose(phase);
      y += rp.y;
      yawOffset += rp.yaw;
      pitch += rp.pitch;
      magY = rp.magY;
      magScale = rp.magScale;
    }
    /* 奔跑时武器随步伐上下颠动，并带一点俯仰 / 横向晃动 */
    if (player.sprinting) {
      const run = MODELS.gunRunMotion(player.animT);
      const amp = mix * player.sprintBlend;
      y += run.bob * amp;
      yawOffset += run.yaw * amp;
      pitch += run.pitch * amp;
    }
    return {
      x: x, y: y, z: z, yaw: bodyYaw, yawOffset: yawOffset,
      pitch: pitch, scale: 1.15, reloading: reloading,
      magY: magY, magScale: magScale
    };
  }

  function enemyGunPose(e, sway) {
    const sw = sway || { yaw: 0, shift: 0 };
    const mix = e.gunner ? Math.max(0, Math.min(1, e.sprintBlend || 0)) : 0;
    const bodyYaw = e.yaw + sw.yaw * mix;
    const cy = Math.cos(bodyYaw), sy = Math.sin(bodyYaw);
    const normalX = e.x + sy * 0.42 - cy * 0.15;
    const normalZ = e.z + cy * 0.42 + sy * 0.15;
    const cp = MODELS.carryPose(0.5);
    const carryX = e.x + sy * 0.29 + cy * sw.shift;
    const carryZ = e.z + cy * 0.29 - sy * sw.shift;
    let x = normalX + (carryX - normalX) * mix;
    let z = normalZ + (carryZ - normalZ) * mix;
    let y = 1.0 + ((0.78 + cp.y) - 1.0) * mix;
    let yawOffset = cp.yawOffset * mix;
    let pitch = cp.pitch * mix;
    let reloading = false, magY = 0, magScale = 1;
    if (e.gunner && e.reloadT > 0) {
      reloading = true;
      const dur = e.reloadDur || CFG.GUNNER.reload || 1;
      const phase = 1 - e.reloadT / dur;
      const rp = MODELS.reloadPose(phase);
      y += rp.y;
      yawOffset += rp.yaw;
      pitch += rp.pitch;
      magY = rp.magY;
      magScale = rp.magScale;
    }
    if (e.gunner && e.carry) {
      const run = MODELS.gunRunMotion(e.animT);
      y += run.bob * mix;
      yawOffset += run.yaw * mix;
      pitch += run.pitch * mix;
    }
    return {
      x: x, y: y, z: z, yaw: bodyYaw, yawOffset: yawOffset,
      pitch: pitch, scale: 0.92, reloading: reloading,
      magY: magY, magScale: magScale
    };
  }

  function drawPlayerGun(geo, sway) {
    const pose = playerGunPose(sway);
    if (!pose) return;
    MODELS.drawGun(geo, player.weapon, pose);
    if (pose.reloading) MODELS.drawGunMag(geo, player.weapon, pose);
  }

  function drawEnemyGun(geo, e, sway) {
    if (!e.gunner) return;
    const wi = (e.weaponId === undefined) ? CFG.GUNNER.weaponId : e.weaponId;
    const pose = enemyGunPose(e, sway);
    MODELS.drawGun(geo, wi, pose);
    if (pose.reloading) MODELS.drawGunMag(geo, wi, pose);
  }

  /* ---------- 战术道具 ---------- */
  function gadgetDef(slot) {
    const id = player.gadgets[slot];
    return id ? GADGET_BY_ID[id] : null;
  }

  function startGadgetAim(slot) {
    if (mode !== 'mission' || ended || paused || player.dead) return;
    if (Inventory.isOpen() || trainingOpen) return;
    if (player.sprinting) {
      HUD.toast('奔跑中无法使用战术道具 · 先停下', 'warn');
      return;
    }
    const g = gadgetDef(slot);
    if (!g) {
      HUD.toast('未配置' + (slot === 0 ? 'Q' : 'E') + '槽道具 · 在机库配置', 'warn');
      return;
    }
    if (player.gadgetCd[slot] > 0) {
      HUD.toast(g.name + ' 冷却中 · ' + player.gadgetCd[slot].toFixed(1) + 's', 'warn');
      return;
    }
    if (player.data < g.cost) {
      HUD.toast('数据不足 · ' + g.name + ' 需要 ' + g.cost + ' NB', 'warn');
      return;
    }
    if (player.gadgetAim === slot) return;
    cancelGadgetAim();
    player.gadgetAim = slot;
    /* 手榴弹初始落点为自身中心；之后累加鼠标相对位移 */
    player.gadgetAimOffset = { x: 0, z: 0 };
    player.gadgetTarget = { x: player.x, z: player.z };
    HUD.updateGadgets(player);
  }

  function cancelGadgetAim() {
    if (player.gadgetAim < 0) return;
    player.gadgetAim = -1;
    player.gadgetAimOffset = { x: 0, z: 0 };
    player.gadgetTarget = { x: player.x, z: player.z };
    HUD.updateGadgets(player);
  }

  /* 手榴弹瞄准：直接累加鼠标 movementX / movementY，
     不依赖虚拟指针在屏幕上的绝对位置，因此指针被锁在屏幕边缘或中心都不会丢位移。 */
  function addGrenadeAimDelta(dx, dy) {
    if (player.gadgetAim < 0 || !dx && !dy) return;
    const g = gadgetDef(player.gadgetAim);
    if (!g || g.id !== 'grenade') return;
    const scale = 0.045 * (CAM.dist / CFG.CAM.DIST);
    let ox = player.gadgetAimOffset.x + (dx || 0) * scale;
    let oz = player.gadgetAimOffset.z + (dy || 0) * scale;
    const d = Math.hypot(ox, oz);
    if (d > g.range) {
      ox = ox / d * g.range;
      oz = oz / d * g.range;
    }
    player.gadgetAimOffset = { x: ox, z: oz };
  }

  function houseLocalPoint(h, x, z) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    const dx = x - h.x, dz = z - h.z;
    return { x: c * dx - s * dz, z: s * dx + c * dz };
  }

  /* 手榴弹落点：不能落进有屋顶的房屋内部。
     从玩家到鼠标落点做线段求交，落点夹在屋顶外沿（沿投掷方向），
     而不是简单推到最近的墙边。玩家本人在屋内时允许落在该房屋内。 */
  function clampOutOfRoof(x, z) {
    const houses = World.houses || [];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const pl = houseLocalPoint(h, player.x, player.z);
      const playerInside = Math.abs(pl.x) <= h.halfW && Math.abs(pl.z) <= h.halfD;
      if (playerInside) continue;
      const l = houseLocalPoint(h, x, z);
      const mx = h.halfW + 0.30, mz = h.halfD + 0.30;
      if (Math.abs(l.x) >= mx || Math.abs(l.z) >= mz) continue;

      const dx = l.x - pl.x, dz = l.z - pl.z;
      let entry = 0;
      let ok = true;
      if (Math.abs(dx) < 1e-9) {
        if (pl.x < -mx || pl.x > mx) ok = false;
      } else {
        let t1 = (-mx - pl.x) / dx, t2 = (mx - pl.x) / dx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        entry = Math.max(entry, t1);
      }
      if (ok) {
        if (Math.abs(dz) < 1e-9) {
          if (pl.z < -mz || pl.z > mz) ok = false;
        } else {
          let t1 = (-mz - pl.z) / dz, t2 = (mz - pl.z) / dz;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          entry = Math.max(entry, t1);
        }
      }
      let lx, lz;
      if (ok && entry < 1) {
        const t = Math.max(0, Math.min(0.999, entry - 0.03));
        lx = pl.x + dx * t;
        lz = pl.z + dz * t;
      } else {
        /* 兜底：沿最近的轴推出屋顶 */
        lx = l.x; lz = l.z;
        const px = mx - Math.abs(l.x);
        const pz = mz - Math.abs(l.z);
        if (px < pz) lx = (l.x >= 0 ? 1 : -1) * mx;
        else lz = (l.z >= 0 ? 1 : -1) * mz;
      }
      const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
      x = h.x + c * lx + s * lz;
      z = h.z - s * lx + c * lz;
    }
    return { x: x, z: z };
  }

  function clampGrenadeTarget(x, z, range) {
    let dx = x - player.x, dz = z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > range && d > 0.0001) {
      dx = dx / d * range;
      dz = dz / d * range;
      x = player.x + dx;
      z = player.z + dz;
    }
    return clampOutOfRoof(x, z);
  }

  function updateGadgetAim() {
    if (player.gadgetAim < 0) return;
    if (paused || ended || player.dead || Inventory.isOpen() || trainingOpen) {
      cancelGadgetAim();
      return;
    }
    const g = gadgetDef(player.gadgetAim);
    if (!g) { cancelGadgetAim(); return; }
    if (g.id === 'grenade') {
      player.gadgetTarget = clampGrenadeTarget(
        player.x + player.gadgetAimOffset.x,
        player.z + player.gadgetAimOffset.z,
        g.range
      );
    } else {
      player.gadgetTarget = { x: player.x, z: player.z };
    }
  }

  function throwKnife(g) {
    const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
    const sx = player.x + dx * 0.45, sz = player.z + dz * 0.45;
    let len = g.range;
    const hit = World.rayWallHit(sx, sz, dx, dz, g.range);
    if (hit && hit.axis && hit.d < len) len = Math.max(0.4, hit.d - 0.10);
    knives.push({
      x: sx, z: sz, dx: dx, dz: dz, dist: 0, len: len,
      speed: g.speed, dmg: g.damage, c: g.rgb,
      hit: [], seed: Math.random() * 10
    });
    noise(player.x, player.z, 10);
  }

  function throwGrenade(g) {
    const t = clampGrenadeTarget(player.gadgetTarget.x, player.gadgetTarget.z, g.range);
    const d = Math.hypot(t.x - player.x, t.z - player.z);
    grenades.push({
      x: player.x, z: player.z, sx: player.x, sz: player.z,
      tx: t.x, tz: t.z, t: 0, dur: Math.max(0.32, g.flight + d * 0.012),
      g: g, c: g.rgb, seed: Math.random() * 10
    });
    noise(player.x, player.z, 12);
  }

  function explodeGrenade(gr) {
    const g = gr.g;
    blasts.push({
      x: gr.tx, z: gr.tz, r: g.radius, t: 0.55, life: 0.55,
      c: g.rgb, seed: Math.random() * 10
    });
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      const d = Math.hypot(e.x - gr.tx, e.z - gr.tz);
      if (d > g.radius) continue;
      const mul = 1 - 0.45 * (d / g.radius);
      damageEnemy(e, g.damage * mul, Math.atan2(e.x - gr.tx, e.z - gr.tz),
        g.rgb, false, true, gr.tx, gr.tz);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * g.radius * 0.85;
      sparks.push({
        x: gr.tx + Math.sin(a) * rr, y: 0.25 + Math.random() * 1.0,
        z: gr.tz + Math.cos(a) * rr, t: 0.25 + Math.random() * 0.25,
        c: i % 3 === 0 ? [1, 0.95, 0.8] : g.rgb, s: 0.28 + Math.random() * 0.35
      });
    }
    noise(gr.tx, gr.tz, 24);
  }

  function placeRadiation(g) {
    radFields.push({
      x: player.x, z: player.z, r: g.radius,
      life: g.duration, maxLife: g.duration, tick: 0,
      dps: g.dps, c: g.rgb, seed: Math.random() * 10
    });
    noise(player.x, player.z, 8);
  }

  function useGadget(slot) {
    if (player.gadgetAim !== slot) return false;
    player.gadgetAim = -1;
    player.gadgetAimOffset = { x: 0, z: 0 };
    if (mode !== 'mission' || ended || paused || player.dead) {
      HUD.updateGadgets(player);
      return false;
    }
    const g = gadgetDef(slot);
    if (!g) { HUD.updateGadgets(player); return false; }
    if (player.gadgetCd[slot] > 0) {
      HUD.toast(g.name + ' 冷却中 · ' + player.gadgetCd[slot].toFixed(1) + 's', 'warn');
      HUD.updateGadgets(player);
      return false;
    }
    if (player.data < g.cost) {
      HUD.toast('数据不足 · ' + g.name + ' 需要 ' + g.cost + ' NB', 'warn');
      HUD.updateGadgets(player);
      return false;
    }

    player.data -= g.cost;
    /* 训练场不进入冷却 */
    player.gadgetCd[slot] = testMap ? 0 : g.cooldown;
    if (g.id === 'knife') throwKnife(g);
    else if (g.id === 'grenade') throwGrenade(g);
    else if (g.id === 'radiation') placeRadiation(g);

    HUD.data(player.data);
    HUD.updateGadgets(player);
    HUD.toast(g.name + ' 已使用' + (player.infiniteData ? ' · 数据无限' : ' · -' + g.cost + ' NB'), 'good');
    return true;
  }

  function updateGadgetState(dt) {
    for (let i = 0; i < 2; i++) {
      if (player.gadgetCd[i] > 0) player.gadgetCd[i] = Math.max(0, player.gadgetCd[i] - dt);
    }
    updateGadgetAim();

    for (let i = 0; i < knives.length; i++) {
      const k = knives[i];
      if (k.done) continue;
      let step = Math.min(k.speed * dt, k.len - k.dist);
      if (step <= 0) { k.done = true; continue; }
      const n = Math.max(1, Math.ceil(step / 0.35));
      const sx = k.dx * step / n, sz = k.dz * step / n;
      for (let s = 0; s < n; s++) {
        k.x += sx; k.z += sz; k.dist += step / n;
        for (let e = 0; e < enemies.length; e++) {
          const en = enemies[e];
          if (en.dead || k.hit.indexOf(en) >= 0) continue;
          if (Math.hypot(en.x - k.x, en.z - k.z) > en.r + 0.30) continue;
          k.hit.push(en);
          damageEnemy(en, k.dmg, Math.atan2(k.dx, k.dz), k.c);
          HUD.hit();
          sparks.push({ x: en.x, y: 1.0, z: en.z, t: 0.18, c: [1, 1, 1], s: 0.22 });
        }
      }
      if (k.dist >= k.len - 1e-4) k.done = true;
    }
    knives = knives.filter(function (k) { return !k.done; });

    for (let i = 0; i < grenades.length; i++) {
      const gr = grenades[i];
      gr.t += dt;
      const p = Math.min(1, gr.t / gr.dur);
      gr.x = lerp(gr.sx, gr.tx, p);
      gr.z = lerp(gr.sz, gr.tz, p);
      if (p >= 1) {
        explodeGrenade(gr);
        gr.done = true;
      }
    }
    grenades = grenades.filter(function (g) { return !g.done; });

    for (let i = 0; i < radFields.length; i++) {
      const f = radFields[i];
      f.life -= dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        /* 每 0.5s 结算一次并显示伤害跳字；总 DPS 不变，避免 0.25s 跳字刷屏 */
        f.tick = 0.5;
        for (let e = 0; e < enemies.length; e++) {
          const en = enemies[e];
          if (en.dead) continue;
          if (Math.hypot(en.x - f.x, en.z - f.z) <= f.r) {
            damageEnemy(en, f.dps * 0.5, Math.atan2(en.x - f.x, en.z - f.z), f.c, false, true);
          }
        }
      }
    }
    radFields = radFields.filter(function (f) { return f.life > 0; });

    for (let i = 0; i < blasts.length; i++) blasts[i].t -= dt;
    blasts = blasts.filter(function (b) { return b.t > 0; });
  }

  function fire() {
    if (player.weapon < 0 || player.slot < 0) return;
    if (player.sprinting) {
      if (time - lastSprintFireT > 1.6) {
        lastSprintFireT = time;
        HUD.toast('奔跑中无法射击 · 松开 Shift 或停下', 'warn');
      }
      return;
    }
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
    const mods = modsOf(slot);
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
    const mods = modsOf(player.slot);
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
    const mods = modsOf(player.slot);
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
      let ox, oz;
      if (hit.axis === 'house') {
        /* 安全屋墙面是旋转矩形，按命中法线做镜面反射 */
        const dn = dx * hit.nx + dz * hit.nz;
        nx = dx - 2 * dn * hit.nx;
        nz = dz - 2 * dn * hit.nz;
        ox = ex + hit.nx * 0.022;
        oz = ez + hit.nz * 0.022;
      } else {
        if (hit.axis === 'x' || hit.axis === 'both') nx = -nx;
        if (hit.axis === 'z' || hit.axis === 'both') nz = -nz;
        ox = ex; oz = ez;
        if (hit.axis === 'x' || hit.axis === 'both') ox = ex - Math.sign(dx) * 0.012;
        if (hit.axis === 'z' || hit.axis === 'both') oz = ez - Math.sign(dz) * 0.012;
      }
      if (!World.isFloorAt(ox, oz)) {
        const back = Math.min(0.06, d);
        ox = ex - dx * back;
        oz = ez - dz * back;
      }
      if (!World.isFloorAt(ox, oz)) break;
      a = Math.atan2(nx, nz);
      px = ox;
      pz = oz;
      const fyaw = hit.axis === 'house' ? Math.atan2(hit.nx, hit.nz) :
        (hit.axis === 'x' ? 0 : (hit.axis === 'z' ? Math.PI / 2 : Math.atan2(dx, dz)));
      flashes.push({ x: ex, y: 1.05, z: ez, yaw: fyaw, t: 0.3, s: 0.66, c: w.rgb2 });
      flashes.push({ x: ex, y: 1.05, z: ez, yaw: fyaw, t: 0.14, s: 0.3, c: [1, 1, 1] });
    }
    beams.push({ pts: pts, t: 0.24, c: w.rgb2 });
  }

  /* ---------- 热学 / 力学 / 电学：实体弹 ---------- */
  function fireBullet(w, m, dmgMul) {
    const mul = dmgMul || 1;
    const mods = modsOf(player.slot);
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
      seed: Math.random() * 10,
      faction: 'player', hostile: false, ignorePlayer: true
    });
  }

  function spawnHostileZone(x, z, w, e) {
    zones.push({
      x: x, z: z, r: w.zoneR || 3.1, life: w.zoneLife || 3.2,
      tick: 0, dps: (w.tickDmg || 3.5) * 4, c: w.rgb2,
      seed: Math.random() * 10,
      faction: e.faction || 'squad', hostile: true,
      ignorePlayer: !enemyHostileToPlayer(e)
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
    /* 玩家来源的伤害用玩家真实位置，而不是手雷 / 燃烧区中心；
       这样清剿小队只会在“玩家确实从屋内攻击”时获得屋内情报。 */
    const playerCredit = credit !== false;
    const sx = playerCredit ? player.x : (fromX === undefined ? player.x : fromX);
    const sz = playerCredit ? player.z : (fromZ === undefined ? player.z : fromZ);
    /* 玩家对清剿小队造成伤害：整队立刻敌对，并且本局不再恢复中立 */
    if (e.squadRef && playerCredit) makeSquadHostile(e, sx, sz);
    /* 被其他阵营从屋内攻击：同样允许整队追进房屋，不再站在门口抗拒进入。 */
    if (e.squadRef && !playerCredit) {
      e.squadRef.combatT = time;
      squadMarkHouseIntel(e.squadRef, sx, sz);
    }
    /* 清剿小队有能量护盾：先扣护盾，破盾后再扣生命 */
    let incoming = dmg;
    if (e.shield > 0 && incoming > 0) {
      const absorbed = Math.min(e.shield, incoming);
      e.shield -= absorbed;
      incoming -= absorbed;
      e.shieldTimer = CFG.SQUAD.shieldDelay;
      if (absorbed > 0 && !silent) {
        HUD.damageNumber(e.x, 1.22, e.z, absorbed, [0.42, 0.78, 1.0]);
        sparks.push({ x: e.x, y: 1.05, z: e.z, t: 0.22, c: [0.45, 0.8, 1.0], s: 0.4 });
      }
    }
    if (incoming > 0) e.hp -= incoming;
    /* 破盾后继续受击也要刷新护盾充能延迟，避免边挨打边回盾。 */
    if (e.maxShield > 0) e.shieldTimer = CFG.SQUAD.shieldDelay;
    e.hitFlash = 0.12;
    if (credit !== false) e.playerHit = true;
    if (e.gunner) e.underFire = 1.6;
    if (!silent && incoming > 0) HUD.damageNumber(e.x, 1.22, e.z, incoming, col);
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

  function nearestChest(visionOnly) {
    let best = null, bd = CFG.CHEST_INTERACT_R || 1.8;
    for (let i = 0; i < World.chests.length; i++) {
      const c = World.chests[i];
      if (c.corpse && (!c.inv || !c.inv.length) &&
          !(c.weapons && (c.weapons[0] || c.weapons[1]))) continue;
      /* 先算距离：交互半径外的箱子没必要再做视线检测。 */
      const d = Math.hypot(c.x - player.x, c.z - player.z) - (c.cr || 0);
      if (d >= bd) continue;
      if (visionOnly) {
        if (!visionVisible(c.x, c.z, c.cr || 0.5)) continue;
      } else if (World.sightBlocked(player.x, player.z, c.x, c.z)) {
        /* 手动 F 也不能隔墙交互；视野锥外但同处一室仍然可以 */
        continue;
      }
      bd = d;
      best = c;
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
    if (nearTrainingPad()) {
      openTrainingLoadout();
      return;
    }
    const chest = nearestChest();
    const door = World.nearestDoor(player.x, player.z);
    if (door) {
      const dd = Math.hypot(door.x - player.x, door.z - player.z);
      const cd = chest ? Math.hypot(chest.x - player.x, chest.z - player.z) : Infinity;
      if (dd <= cd) {
        if (door.open && World.doorOccupied(door, player.x, player.z, 0.50)) {
          HUD.toast('先离开门口再关门', 'warn');
          return;
        }
        const opened = World.toggleDoor(door);
        HUD.toast(opened ? '安全屋门已打开' : '安全屋门已关闭', 'good');
        return;
      }
    }
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

  /* 单位相对玩家的关系：目前所有敌人都是敌对；预留中立 / 友好。
     描边颜色由 gl.js 的 mask G 通道解码：敌对红、中立黄、友好绿。 */
  function relationOf(e) {
    if (!e) return 'hostile';
    if (e.relation === 'friendly' || e.faction === 'friendly') return 'friendly';
    if (e.relation === 'neutral' || e.faction === 'neutral') return 'neutral';
    return 'hostile';
  }

  function enemyMaskGeo(e) {
    const rel = relationOf(e);
    if (rel === 'friendly' && R.unitMaskFriendly) return R.unitMaskFriendly;
    if (rel === 'neutral' && R.unitMaskNeutral) return R.unitMaskNeutral;
    if (R.unitMaskHostile) return R.unitMaskHostile;
    return R.unitMask;
  }

  /* 敌人开门：靠近关着的安全屋门时，拾荒者和丧尸都会主动打开。
     优先处理朝门移动 / 已经贴着门的情况，避免路过时乱开身后的门。
     只调用 openDoor（幂等、只开不关），不用 toggle：
     否则两名队员在门还没转到位的那几十毫秒里先后点同一扇门会互相抵消。 */
  function updateEnemyDoor(e, dt) {
    const door = World.nearestDoor(e.x, e.z);
    /* 本帧的最近门缓存：后面的过门引导 / 战斗走位直接复用，
       避免每帧对每个 AI 重复扫描全部门。 */
    e.ndDoor = door;
    /* 记录“是否正在门口”：门被关上时要靠它决定是否把单位推出去。 */
    e.nearDoor = !!(door && Math.hypot(door.x - e.x, door.z - e.z) < 1.15);
    if (e.doorCd > 0) { e.doorCd -= dt; return; }
    /* door.open 是“目标状态”，比门的动画进度更早生效：
       已经开着的门（哪怕还在转）一律不再碰。 */
    if (!door || door.open || !World.isDoorClosed(door)) return;
    /* 清剿小队不会为了游荡去开没观测到敌人的房屋门；
       但如果它已经在这栋房子里面，允许开门离开，避免情报过期后被困死。 */
    const inside = !!door.house && World.houseAt(e.x, e.z, 0.05) === door.house;
    if (e.squadRef && door.house && !inside &&
        !squadHouseAllowed(e.squadRef, door.house)) return;
    const dx = door.x - e.x, dz = door.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.4 || d < 1e-4) return;
    const facing = (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d;
    /* 已经卡在门框里时无条件开门，不论朝向和上一帧是否在移动。 */
    const inDoor = World.doorOccupied(door, e.x, e.z, e.r + 0.04);
    if (!e.moving && !inDoor && facing < 0.35) return;
    if (World.openDoor(door)) e.doorCd = 0.5 + Math.random() * 0.3;
  }

  function canSeePoint(e, tx, tz, maxD) {
    const dx = tx - e.x, dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d > (maxD || e.viewR)) return false;
    /* 先做便宜的视野锥判断，再跑贵的墙体视线；否则扫一遍敌人时
       会为大量背对 / 侧面的目标白算 sightBlocked。 */
    if (d >= 3.0) {
      const ang = Math.atan2(dx, dz);
      if (Math.abs(angDiff(e.yaw, ang)) >= e.viewHalf) return false;
    }
    return !World.sightBlocked(e.x, e.z, tx, tz);
  }

  /* 选择当前可见目标：玩家或敌对阵营的敌人，取最近者 */
  function pickEnemyTarget(e) {
    let best = null, bd = Infinity;
    if ((!e.squadRef || relationOf(e) === 'hostile') &&
        !player.dead && !player.extracted) {
      const d = Math.hypot(player.x - e.x, player.z - e.z);
      if (d <= e.viewR && canSeePoint(e, player.x, player.z, e.viewR)) {
        best = { kind: 'player', x: player.x, z: player.z, d: d };
        bd = d;
      }
    }
    const my = factionOf(e);
    /* 小队共享目标：优先继续集火队友已经发现的目标 */
    let sharedLock = false;
    if (e.squadRef && e.squadRef.target) {
      const st = e.squadRef.target;
      if (st.kind === 'player') {
        if (relationOf(e) === 'hostile' && !player.dead) {
          const d = Math.hypot(player.x - e.x, player.z - e.z);
          if (d <= e.viewR && canSeePoint(e, player.x, player.z, e.viewR)) {
            best = { kind: 'player', x: player.x, z: player.z, d: d };
            bd = d;
            sharedLock = true;
          }
        }
      } else if (st.ref && !st.ref.dead && factionOf(st.ref) !== my) {
        const d = Math.hypot(st.ref.x - e.x, st.ref.z - e.z);
        if (d <= e.viewR && canSeePoint(e, st.ref.x, st.ref.z, e.viewR)) {
          best = { kind: 'enemy', ref: st.ref, x: st.ref.x, z: st.ref.z, d: d };
          bd = d;
          sharedLock = true;
        }
      }
    }
    /* 已经锁定共享目标时不再被自己更近的目标覆盖，保证集火。 */
    if (!sharedLock) {
      for (const o of enemyAlive) {
        if (o === e || o.dead) continue;
        if (factionOf(o) === my) continue;
        const d = Math.hypot(o.x - e.x, o.z - e.z);
        if (d >= bd || d > e.viewR) continue;
        if (!canSeePoint(e, o.x, o.z, e.viewR)) continue;
        bd = d;
        best = { kind: 'enemy', ref: o, x: o.x, z: o.z, d: d };
      }
    }
    if (best && e.squadRef) shareSquadTarget(e, best);
    return best;
  }

  function pickPatrol(e) {
    if (e.squadRef) {
      if (e.isLeader) return pickSquadRoamPoint(e);
      const lead = e.squadRef.leader;
      if (lead && !lead.dead) return { x: lead.x, z: lead.z };
      return pickSquadRoamPoint(e);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.283;
      const r = 2.5 + Math.random() * 7;
      const x = e.home.x + Math.cos(a) * r;
      const z = e.home.z + Math.sin(a) * r;
      if (!World.blocked(x, z, e.r)) return { x: x, z: z };
    }
    return { x: e.home.x, z: e.home.z };
  }

  /* 所有非枪手单位（丧尸 / 喷吐者 / 干尸）共用的移动入口。
     先尝试 A* 路径，只有近距离或视线直达时才直接朝目标走。 */
  function stepTo(e, tx, tz, speed, dt) {
    const remain = Math.hypot(tx - e.x, tz - e.z);
    if (remain < 0.35) return true;
    aiMoveTo(e, tx, tz, speed, dt);
    /* 只有真的走到了才算到达；“被墙挡住原地等”不能当成到达，
       否则队长会以为目标已完成，换下一个不可达目标，整队一直站着。 */
    return Math.hypot(tx - e.x, tz - e.z) < 0.35;
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

  function makeSquadLootBag() {
    const bag = [];
    const add = function (it) {
      if (!it) return false;
      if (Grid.autoPlace(bag, it, CFG.GUNNER.bagCols, CFG.GUNNER.bagRows)) {
        bag.push(it);
        return true;
      }
      return false;
    };
    /* 至少一件史诗 + 稀有物资；再补一块芯片，有机会多带一把武器 */
    add(ITEMS.roll('epic', Math.random, 0));
    add(ITEMS.roll(Math.random() < 0.5 ? 'rare' : 'epic', Math.random, 0));
    add(ITEMS.rollChip(Math.random, 0.9));
    if (Math.random() < 0.35) {
      const wi = Math.floor(Math.random() * WEAPONS.length) % WEAPONS.length;
      add(ITEMS.makeWeaponItem(wi, { found: true }));
    }
    for (let guard = 0; guard < 20 && bag.length < 3; guard++) {
      add(ITEMS.roll('rare', Math.random, 0));
    }
    return bag;
  }

  function makeGunner(type, x, z, weaponId) {
    const c = CFG.ENEMY[type] || CFG.ENEMY.scav;
    const wi = (weaponId === undefined) ? CFG.GUNNER.weaponId : weaponId;
    const w = WEAPONS[wi] || WEAPONS[CFG.GUNNER.weaponId];
    return {
      x: x, z: z, home: { x: x, z: z }, type: type, gunner: true, faction: 'scav',
      weaponId: wi,
      hp: c.hp, maxHp: c.hp, r: c.r, speed: c.speed, dmg: c.dmg,
      cd: 0, cdMax: c.cd, yaw: Math.random() * 6.28, animT: 0,
      moving: false, dead: false, fade: 1.9, hitFlash: 0, lunge: 0,
      /* 出生后直接进入巡逻 / 搜刮，不再原地“搜索”6 秒 */
      state: 'idle', alertT: 0, lostT: 6, waitT: 0, patrol: null,
      lastSeenX: x, lastSeenZ: z, seen: false, seenLast: false,
      seed: Math.random() * 10,
      swayT: Math.random() * 10, moveBlend: 0, sprintBlend: 0,
      viewR: CFG.GUNNER.viewR, viewHalf: CFG.GUNNER.viewHalf,
      aimT: 0, ammo: w.mag, reloadT: 0, reloadDur: CFG.GUNNER.reload,
      carry: false,
      burstLeft: 0, burstT: 0, burstCool: 0.4 + Math.random() * 0.7,
      strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 0.6 + Math.random() * 0.9,
      coverTarget: null, coverHold: 0, coverCd: 2 + Math.random() * 3,
      underFire: 0, corpse: false, corpseContainer: null,
      lootBag: makeGunnerBag(), lootTarget: null, lootT: 0, pryingChest: null,
      lootFull: false, lootIgnored: null, lootIgnoredLoot: null,
      lootWaitT: 0, lootStuckT: 0, lootLastDist: Infinity,
      lootVisitT: 0, lootAbsorbT: 0, lootAbsorbed: 0,
      lootIgnoreRef: null, lootIgnoreT: 0,
      lootCooldown: 0, lootSessionT: 0,
      moveStuckT: 0, wanderT: 0, wanderYaw: 0,
      path: null, pathGoal: null, pathTime: 0
    };
  }

  /* 丧尸 / 喷吐者 / 干尸：与程序化地图共用同一套字段 */
  function makeUndead(type, x, z) {
    const ecfg = CFG.ENEMY[type] || CFG.ENEMY.zombie;
    return {
      x: x, z: z, home: { x: x, z: z }, type: type, faction: 'undead',
      hp: ecfg.hp, maxHp: ecfg.hp, r: ecfg.r, speed: ecfg.speed, dmg: ecfg.dmg,
      cd: 0, cdMax: ecfg.cd, yaw: Math.random() * 6.28, animT: 0,
      moving: false, dead: false, fade: 1.9, hitFlash: 0, lunge: 0,
      state: 'idle', alertT: 0, lostT: 6, waitT: 0, patrol: null,
      lastSeenX: x, lastSeenZ: z, seen: false, seed: Math.random() * 10,
      swayT: Math.random() * 10, moveBlend: 0, sprintBlend: 0,
      viewR: type === 'spitter' ? 20 : (type === 'gaunt' ? 15 : 16),
      viewHalf: type === 'spitter' ? 1.15 : 0.95,
      path: null, pathGoal: null, pathTime: 0
    };
  }

  /* ---------- 清剿小队 ----------
     4 人一组：队长战术干员，其余随机分配 3 种不同武器；
     初始对玩家中立，玩家造成伤害后整队敌对并保持到本局结束。 */
  function squadSpawnClear(x, z) {
    if (World.blocked(x, z, CFG.SQUAD.r + 0.06)) return false;
    if (World.houseAt && World.houseAt(x, z, 0.05)) return false;
    return true;
  }

  function safeSquadSpawn(cx, cz) {
    if (squadSpawnClear(cx, cz)) return { x: cx, z: cz };
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 2 + Math.random() * 14;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (squadSpawnClear(x, z)) return { x: x, z: z };
    }
    return { x: cx, z: cz };
  }

  function spawnSquad(cx, cz, radius) {
    const spawn = safeSquadSpawn(cx, cz);
    cx = spawn.x;
    cz = spawn.z;
    const id = 'squad_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e5).toString(36);
    const squad = {
      id: id, members: [], leader: null,
      target: null, lastSeenX: cx, lastSeenZ: cz, hostile: false,
      houseIntel: {}, roamTarget: null,
      /* 最近一次交战 / 目击时间：交战中允许进入任何房屋，不再被“未侦察”规则挡在门外。 */
      combatT: 0
    };
    const defs = CFG.SQUAD.members;
    const pool = [0, 1, 2, 4];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    let pi = 0;
    defs.forEach(function (def, i) {
      let x = cx, z = cz;
      if (i > 0) {
        let placed = false;
        for (let t = 0; t < 20; t++) {
          const a = Math.random() * Math.PI * 2;
          const d = (radius || CFG.SQUAD.spawnRadius) * Math.sqrt(Math.random());
          const tx = cx + Math.cos(a) * d;
          const tz = cz + Math.sin(a) * d;
          if (squadSpawnClear(tx, tz)) { x = tx; z = tz; placed = true; break; }
        }
        /* 找不到安全的屋内 / 障碍点就退回队长位置，至少不违反不进屋规则。 */
        if (!placed) { x = cx; z = cz; }
      }
      const wi = def.leader ? CFG.SQUAD.leaderWeapon : pool[pi++ % pool.length];
      const e = makeSquadMember(def, x, z, squad, wi);
      e.squadSlot = i;
      squad.members.push(e);
      if (def.leader) squad.leader = e;
      enemies.push(e);
    });
    squads.push(squad);
    return squad;
  }

  function makeSquadMember(def, x, z, squad, weaponId) {
    const e = makeGunner(def.key, x, z, weaponId);
    const w = WEAPONS[weaponId] || WEAPONS[CFG.GUNNER.weaponId];
    e.type = def.key;
    e.displayName = '清剿小队 · ' + def.name;
    e.faction = 'squad';
    e.relation = 'neutral';
    e.squadRef = squad;
    e.isLeader = !!def.leader;
    e.squadRole = def.leader ? 'leader' : 'member';
    e.squadThinkT = 0;
    e.squadHolding = false;
    e.hp = e.maxHp = def.leader ? CFG.SQUAD.leaderHp : CFG.SQUAD.hp;
    e.shield = e.maxShield = def.leader ? CFG.SQUAD.leaderShield : CFG.SQUAD.shield;
    e.shieldTimer = 0;
    e.speed = CFG.SQUAD.speed;
    e.viewR = CFG.SQUAD.viewR;
    e.viewHalf = CFG.SQUAD.viewHalf;
    e.weaponId = weaponId;
    e.ammo = w.mag;
    e.burstMin = w.auto ? 3 : 1;
    e.burstMax = w.auto ? 5 : 2;
    e.burstCool = w.auto ? 0.45 + Math.random() * 0.5 : 0.9 + Math.random() * 0.7;
    e.reloadDur = w.reload || CFG.GUNNER.reload;
    e.home = { x: x, z: z };
    e.lastSeenX = x; e.lastSeenZ = z;
    e.lootBag = makeSquadLootBag();
    e.lootFull = false;
    return e;
  }

  function shareSquadTarget(e, target) {
    const sq = e.squadRef;
    if (!sq || !target) return;
    if (target.kind === 'player' && relationOf(e) !== 'hostile') return;
    sq.target = target.kind === 'player'
      ? { kind: 'player', x: target.x, z: target.z }
      : { kind: 'enemy', ref: target.ref, x: target.x, z: target.z };
    sq.lastSeenX = target.x;
    sq.lastSeenZ = target.z;
    sq.combatT = time;
    squadMarkHouseIntel(sq, target.x, target.z);
    for (const m of sq.members) {
      if (m.dead) continue;
      m.lastSeenX = target.x;
      m.lastSeenZ = target.z;
      /* 队友刚看到目标：重置丢失计时，否则 lostT 已过 6s 的成员
         会收到共享目标却直接回去巡逻。 */
      m.lostT = 0;
      if (m.state === 'idle' || m.state === 'patrol') {
        m.state = 'alert';
        m.alertT = Math.max(m.alertT || 0, 0.45);
      }
    }
  }

  function makeSquadHostile(e, sx, sz) {
    const sq = e.squadRef;
    if (!sq || sq.hostile) return;
    sq.hostile = true;
    sq.combatT = time;
    sq.target = { kind: 'player', x: sx, z: sz };
    sq.lastSeenX = sx; sq.lastSeenZ = sz;
    squadMarkHouseIntel(sq, sx, sz);
    for (const m of sq.members) {
      if (m.dead) continue;
      m.relation = 'hostile';
      m.lastSeenX = sx;
      m.lastSeenZ = sz;
      m.lostT = 0;
      m.state = 'alert';
      m.alertT = Math.max(m.alertT || 0, 0.5);
      m.squadAlert = true;
    }
  }

  function squadMarkHouseIntel(squad, x, z) {
    if (!squad || typeof World.houseAt !== 'function') return;
    const h = World.houseAt(x, z, 0.05);
    if (h) squad.houseIntel[h.id || 'house'] = time + 30;
  }

  function squadHasHouseIntel(squad, h) {
    if (!squad || !h) return false;
    const until = squad.houseIntel[h.id || 'house'];
    return !!until && until > time;
  }

  /* 只要有一名存活队员已经在这栋房子里，就视为“已进入”，
     允许其他队员跟进汇合；否则情报过期后会把小队永久劈成门内 / 门外两半。 */
  function squadMemberInHouse(squad, h) {
    if (!squad || !h || typeof World.houseAt !== 'function') return false;
    for (let i = 0; i < squad.members.length; i++) {
      const m = squad.members[i];
      if (!m.dead && World.houseAt(m.x, m.z, 0.05) === h) return true;
    }
    return false;
  }

  function squadHouseAllowed(squad, h) {
    if (!squad || !h) return true;
    if (squadHasHouseIntel(squad, h)) return true;
    if (squadMemberInHouse(squad, h)) return true;
    /* 交战中（看到目标 / 追击最后目击点 / 被攻击）直接允许进屋。
       游荡时才避开没侦察过的房屋，这样发现敌人后不会再站在门口抗拒进入。 */
    if (squad.combatT && time - squad.combatT < 20) return true;
    return false;
  }

  /* 小队的寻路禁入房屋选项：和平游荡时避开未侦察房屋，
     交战中 / 情报有效 / 已有队员在屋内时允许进入。 */
  function squadPathOpts(e) {
    if (!e.squadRef) return null;
    const blocked = {};
    const houses = World.houses || [];
    const curHouse = World.houseAt ? World.houseAt(e.x, e.z, 0.05) : null;
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (h !== curHouse && !squadHouseAllowed(e.squadRef, h)) {
        blocked[h.id || 'house'] = true;
      }
    }
    return { blockHouseIds: blocked };
  }

  /* 小队游荡目标：在 6–20m 内选点，并确认当前能真正走到。
     之前这里会选到 10m 以外的任意地板点（可能隔着整张地图的墙），
     队长走到一半发现不可达就会原地“等到达”，整队站着不动。 */
  function pickSquadRoamPoint(e) {
    const opts = squadPathOpts(e);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * 14;
      const x = e.x + Math.cos(a) * d;
      const z = e.z + Math.sin(a) * d;
      if (World.blocked(x, z, e.r + 0.08)) continue;
      const h = World.houseAt(x, z, 0.05);
      if (h && !squadHasHouseIntel(e.squadRef, h)) continue;
      if (typeof World.findPath === 'function') {
        const path = World.findPath(e.x, e.z, x, z, opts || undefined);
        if (!path || !path.length) continue;
        const last = path[path.length - 1];
        if (Math.hypot(last.x - x, last.z - z) > 2.2) continue;
      }
      e.squadRef.roamTarget = { x: x, z: z };
      return { x: x, z: z };
    }
    /* 实在找不到可达点就原地等下一次判断；不要挑一个不可达远景目标。 */
    return { x: e.x, z: e.z };
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

  /* 用实际物品尺寸判断背包是否能放下，避免反复跑向放不下的物资 */
  function gunnerCanFit(e, item) {
    if (!item) return false;
    const dummy = Grid.cloneItem(item);
    dummy.gx = 0; dummy.gy = 0; dummy.rot = 0;
    return Grid.autoPlace(e.lootBag, dummy, CFG.GUNNER.bagCols, CFG.GUNNER.bagRows);
  }

  function gunnerCancelPry(e) {
    const c = e.pryingChest;
    if (c && c.pryBy === e) cancelPry(c);
    e.pryingChest = null;
  }

  /* 放弃当前搜刮目标：临时冷却后重新选目标，避免对着不可达物品长时间发呆 */
  function ignoreGunnerLoot(e, t) {
    if (!t) return;
    if (e.pryingChest && t.kind === 'chest' && e.pryingChest === t.ref) gunnerCancelPry(e);
    if (t.kind === 'loot') e.lootIgnoredLoot = t.ref;
    else e.lootIgnored = t.ref;
    e.lootTarget = null;
    e.lootT = Math.max(e.lootT || 0, 0.45);
    e.lootWaitT = 0;
    e.lootStuckT = 0;
    e.lootLastDist = Infinity;
    e.lootVisitT = 0;
    e.lootAbsorbT = 0;
    e.lootAbsorbed = 0;
    e.lootSessionT = 0;
    e.lootCooldown = Math.max(e.lootCooldown || 0, 7 + Math.random() * 5);
  }

  function resetGunnerLootSeek(e, t) {
    e.lootWaitT = 0;
    e.lootStuckT = 0;
    e.lootLastDist = t ? Math.hypot(t.x - e.x, t.z - e.z) : Infinity;
    e.lootVisitT = 0;
    e.lootAbsorbT = 0;
    e.lootAbsorbed = 0;
    e.lootSessionT = 0;
  }

  /* 一次物资点待机结束后离开；随后进入数秒搜刮冷却，
     避免拾荒者在同一片物资点之间无限往返、长时间逗留。 */
  function finishGunnerLootVisit(e, t, noFit) {
    e.lootTarget = null;
    e.lootT = 0.6;
    e.lootVisitT = 0;
    e.lootAbsorbT = 0;
    e.lootAbsorbed = 0;
    e.lootStuckT = 0;
    e.lootLastDist = Infinity;
    e.lootWaitT = 0;
    e.lootSessionT = 0;
    e.lootCooldown = Math.max(e.lootCooldown || 0, 5 + Math.random() * 6);
    if (t && t.kind === 'chest') {
      const c = t.ref;
      if (noFit) {
        e.lootIgnored = c;
        if (!gunnerHasSpace(e)) e.lootFull = true;
      } else if (c.inv && c.inv.length) {
        e.lootIgnoreRef = c;
        e.lootIgnoreT = 6 + Math.random() * 4;
      }
    }
  }

  function gunnerChestHasFit(e, c) {
    if (!c || !c.inv) return false;
    for (let i = 0; i < c.inv.length; i++) {
      if (gunnerCanFit(e, c.inv[i])) return true;
    }
    return false;
  }

  function pickGunnerLoot(e) {
    if (e.lootFull) return null;
    let best = null, bd = 16;
    for (const l of World.loot) {
      if (l.taken || l === e.lootIgnoredLoot) continue;
      if (!gunnerCanFit(e, l.item)) continue;
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
      /* 拾荒者不撬箱：未撬开的箱子不进入搜刮目标。 */
      if (c.corpse || !c.pried || c === e.lootIgnored || !c.inv || !c.inv.length) continue;
      if (e.lootIgnoreRef === c && e.lootIgnoreT > 0) continue;
      if (Inventory.currentChest && Inventory.currentChest() === c) continue;
      let hasFit = false;
      for (let i = 0; i < c.inv.length; i++) {
        if (gunnerCanFit(e, c.inv[i])) { hasFit = true; break; }
      }
      if (!hasFit) continue;
      const d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d >= bd) continue;
      if (World.sightBlocked(e.x, e.z, c.x, c.z, c)) continue;
      bd = d;
      best = { kind: 'chest', ref: c, x: c.x, z: c.z };
    }
    if (!best && !gunnerHasSpace(e)) e.lootFull = true;
    return best;
  }

  /* 返回 true 表示正在搜刮，不再执行巡逻。
     拾荒者不撬箱、不逐件交互：到达物资点后待机，再按间隔“吸取”少量物资。 */
  function gunnerLoot(e, dt) {
    /* 清剿小队不参与搜刮；他们的高价值物资出生即携带，死亡后掉落 */
    if (e.squadRef) return false;
    if (e.lootT > 0) e.lootT -= dt;
    if (e.lootIgnoreT > 0) {
      e.lootIgnoreT -= dt;
      if (e.lootIgnoreT <= 0) e.lootIgnoreRef = null;
    }
    if (e.lootCooldown > 0) {
      e.lootCooldown = Math.max(0, e.lootCooldown - dt);
      e.lootTarget = null;
      e.moving = false;
      return false;
    }
    let t = e.lootTarget;
    if (t) {
      if (t.kind === 'loot') {
        if (t.ref.taken) {
          t = e.lootTarget = null;
          resetGunnerLootSeek(e, null);
        }
      } else if (t.kind === 'chest') {
        if (!t.ref.inv || !t.ref.inv.length || t.ref.corpse) {
          t = e.lootTarget = null;
          resetGunnerLootSeek(e, null);
        }
      }
    }
    if (!t) {
      t = e.lootTarget = pickGunnerLoot(e);
      if (!t) return false;
      resetGunnerLootSeek(e, t);
    }
    /* 单次搜刮会话有上限：到点后直接离开并进入冷却，避免一直围着一个物资点转 */
    e.lootSessionT = (e.lootSessionT || 0) + dt;
    if (e.lootSessionT > 18) {
      finishGunnerLootVisit(e, t, false);
      return true;
    }
    /* 玩家正在查看这个箱子时，敌人不要从界面里偷东西，也不要站着一直等 */
    if (t.kind === 'chest' && Inventory.isChestOpen() && Inventory.currentChest() === t.ref) {
      e.moving = false;
      ignoreGunnerLoot(e, t);
      return true;
    }
    const td = Math.hypot(t.x - e.x, t.z - e.z);
    if (td > CFG.GUNNER.lootR) {
      /* 卡住检测：距离一段时间没有缩短就放弃目标，避免顶着墙不动 */
      if (!isFinite(e.lootLastDist)) e.lootLastDist = td;
      if (td < e.lootLastDist - 0.03) {
        e.lootLastDist = td;
        e.lootStuckT = 0;
      } else {
        e.lootStuckT = (e.lootStuckT || 0) + dt;
      }
      if (e.lootStuckT > 1.5) {
        ignoreGunnerLoot(e, t);
        return true;
      }
      aiMoveTo(e, t.x, t.z, e.speed * 0.72, dt, Math.atan2(t.x - e.x, t.z - e.z));
      return true;
    }
    e.lootStuckT = 0;
    e.lootLastDist = td;
    e.moving = false;
    /* 到达后再做一次视线校验：门在途中关上或贴墙时不会隔墙吸取。 */
    if (World.sightBlocked(e.x, e.z, t.x, t.z)) {
      ignoreGunnerLoot(e, t);
      return true;
    }
    e.yaw = angLerp(e.yaw, Math.atan2(t.x - e.x, t.z - e.z), 1 - Math.exp(-10 * dt));
    if (e.lootT > 0) return true;

    /* 到达物资点后先待机一段时间，再逐步吸取 */
    e.lootVisitT = (e.lootVisitT || 0) + dt;
    if (e.lootVisitT < CFG.GUNNER.lootFirstDelay) return true;
    if (e.lootAbsorbT > 0) {
      e.lootAbsorbT -= dt;
      return true;
    }

    if (t.kind === 'loot') {
      if (t.ref.taken) {
        e.lootTarget = null;
        resetGunnerLootSeek(e, null);
        return true;
      }
      if (gunnerAddLoot(e, t.ref.item)) {
        t.ref.taken = true;
        finishGunnerLootVisit(e, t, false);
      } else {
        ignoreGunnerLoot(e, t);
        if (!gunnerHasSpace(e)) e.lootFull = true;
      }
      return true;
    }

    /* 物资箱：每 0.45s 吸取一件，单次最多 3 件，剩下的留给其他单位 / 玩家 */
    const c = t.ref;
    let took = false;
    for (let i = 0; i < c.inv.length; i++) {
      if (gunnerAddLoot(e, c.inv[i])) {
        c.inv.splice(i, 1);
        took = true;
        break;
      }
    }
    if (!took) {
      finishGunnerLootVisit(e, t, true);
      return true;
    }
    e.lootAbsorbed = (e.lootAbsorbed || 0) + 1;
    e.lootAbsorbT = CFG.GUNNER.lootInterval;
    if (e.lootAbsorbed >= CFG.GUNNER.lootMaxItems || !c.inv.length || !gunnerChestHasFit(e, c)) {
      finishGunnerLootVisit(e, t, !c.inv.length || !gunnerChestHasFit(e, c));
    }
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

  function squadBlockedByHouse(e, x, z) {
    if (!e.squadRef || typeof World.houseAt !== 'function') return false;
    const cur = World.houseAt(e.x, e.z, 0.05);
    const next = World.houseAt(x, z, 0.05);
    if (!next || next === cur) return false;
    return !squadHouseAllowed(e.squadRef, next);
  }

  /* 通用 AI 寻路：
     - 所有单位共用同一套路径缓存和每帧预算
     - 目标较近或视线直达时不浪费 A*
     - 清剿小队额外禁止进入没有屋内脏情报的房屋 */
  function aiPathFor(e, tx, tz) {
    if (typeof World.findPath !== 'function') return null;
    const goal = e.pathGoal;
    const same = goal && Math.hypot(goal.x - tx, goal.z - tz) < 2.0;
    const age = time - (e.pathTime || 0);
    if (same && age < (e.path && e.path.length ? 1.2 : 0.8)) return e.path;

    const dist = Math.hypot(tx - e.x, tz - e.z);
    /* 近距离但中间有墙 / 门框时仍需寻路，否则单位会顶着墙原地推。 */
    if (dist < 2.4 &&
        (!World.los || World.los(e.x, e.z, tx, tz))) return null;

    /* 普通单位：直线无墙时直接走，避免全场单位频繁跑 A*。
       清剿小队始终走寻路，保证不会误入未侦察建筑。 */
    if (!e.squadRef && World.los && World.los(e.x, e.z, tx, tz)) {
      e.path = null;
      e.pathGoal = { x: tx, z: tz };
      e.pathTime = time;
      return null;
    }

    if (e.squadRef && !e.isLeader) {
      /* 队员跟随轨迹需要更稳定的寻路预算；预算用完时继续沿用旧路径，
         不要退回“无路径”状态导致原地等待。 */
      if (squadPathBudget <= 0) return (e.path && e.path.length) ? e.path : null;
      squadPathBudget--;
    } else {
      if (aiPathBudget <= 0) {
        return (e.path && same && age < 3.0) ? e.path : null;
      }
      aiPathBudget--;
    }
    const opts = squadPathOpts(e);
    const path = World.findPath(e.x, e.z, tx, tz, opts || undefined);
    e.path = path;
    e.pathGoal = { x: tx, z: tz };
    e.pathTime = time;
    return path;
  }

  /* 本帧最近的门（updateEnemyDoor 里缓存；没有缓存时自己查一次）。 */
  function enemyDoor(e) {
    return e.ndDoor !== undefined ? e.ndDoor : World.nearestDoor(e.x, e.z);
  }

  /* 过门引导：只有“下一步真的要穿过这扇门”时才返回一个临时路点，
     让单位先站到门前中线、再从正中穿过去。
     旧版只按距离取最近的开着的门，于是站在门边、目标却根本不在门另一侧时
     也会被硬拽到门中心 —— 四个人围着同一扇门打转，看起来就像卡在门里。 */
  function doorCrossGuide(e, wx, wz) {
    if (typeof World.nearestDoor !== 'function') return null;
    const door = enemyDoor(e);
    if (!door || !door.open) return null;
    const yaw = door.rect ? door.rect.yaw : 0;
    const nx = -Math.sin(yaw), nz = Math.cos(yaw);
    const sd = (e.x - door.x) * nx + (e.z - door.z) * nz;
    const td = (wx - door.x) * nx + (wz - door.z) * nz;
    /* 同侧：不穿门，完全交给寻路 */
    if (sd * td >= -0.04) return null;
    const du = Math.hypot(door.x - e.x, door.z - e.z);
    if (du > 2.6) return null;
    /* 穿越点必须落在门洞宽度内，否则说明是从墙那边过去的，A* 会自己绕 */
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const t = sd / (sd - td);
    const cx = e.x + (wx - e.x) * t, cz = e.z + (wz - e.z) * t;
    if (Math.abs((cx - door.x) * lx + (cz - door.z) * lz) > 0.9) return null;
    /* 离得远：先走到门前 1m 的中线点；已经很近：直接对准门中心 */
    if (du > 1.05) {
      const side = sd > 0 ? 1 : -1;
      return { x: door.x + nx * side * 1.0, z: door.z + nz * side * 1.0 };
    }
    return { x: door.x, z: door.z };
  }

  function aiMoveTo(e, tx, tz, speed, dt, faceYaw) {
    const path = aiPathFor(e, tx, tz);
    let wx = tx, wz = tz;
    let onPath = false;
    if (path && path.length) {
      while (path.length && Math.hypot(path[0].x - e.x, path[0].z - e.z) < 0.55) path.shift();
      if (path.length) { wx = path[0].x; wz = path[0].z; onPath = true; }
      else e.path = null;
    }
    /* 门口对齐：只在前方这段路真的跨过门洞时，才插一个门前中线点，
       保证单位是从门中间垂直穿过，而不是斜着切门框被挡在门口。 */
    const guide = doorCrossGuide(e, wx, wz);
    if (guide) { wx = guide.x; wz = guide.z; onPath = true; }
    /* 没有可用路径、而目标又被墙体挡住时，不要继续朝墙硬推。
       A* 下一条 / 下一帧会重新算路，单位先原地等待。 */
    if (!onPath && Math.hypot(tx - e.x, tz - e.z) > 0.35 &&
        typeof World.los === 'function' && !World.los(e.x, e.z, tx, tz)) {
      e.moving = false;
      return false;
    }
    const dx = wx - e.x, dz = wz - e.z;
    if (Math.hypot(dx, dz) < 0.001) { e.moving = false; return false; }
    const yaw = faceYaw === undefined ? Math.atan2(dx, dz) : faceYaw;
    return gunnerMove(e, dx, dz, speed, dt, yaw);
  }

  function squadStepTo(e, tx, tz, speed, dt) {
    return stepTo(e, tx, tz, speed, dt);
  }

  function gunnerMove(e, dirX, dirZ, speed, dt, faceYaw) {
    let len = Math.hypot(dirX, dirZ);
    if (len < 0.001) { e.moving = false; return false; }
    /* 卡在墙角 / 门框时短暂强制侧移，避免持续顶着墙原地打转 */
    if (e.wanderT > 0) {
      dirX = Math.sin(e.wanderYaw);
      dirZ = Math.cos(e.wanderYaw);
      len = 1;
    }
    const want = speed * dt;
    let mv = World.moveCircle(e.x, e.z, dirX / len * speed * dt, dirZ / len * speed * dt, e.r, true);
    if (Math.hypot(mv.x - e.x, mv.z - e.z) < 0.0005) {
      /* 正面被挡住时尝试垂直侧移 */
      const px = -dirZ / len, pz = dirX / len;
      for (const s of [1, -1]) {
        const m2 = World.moveCircle(e.x, e.z, px * s * speed * dt, pz * s * speed * dt, e.r, true);
        if (Math.hypot(m2.x - e.x, m2.z - e.z) > 0.0005) { mv = m2; break; }
      }
    }
    /* 没有观测到内部敌人的房屋：不主动跨进门口。
       如果这一帧的移动被这条规则整个吃掉，记一次“门禁拒绝”，
       由 gunnerMove 的卡住检测负责放弃这个目标，而不是原地顶着门板推。 */
    if (squadBlockedByHouse(e, mv.x, mv.z)) {
      const wanted = Math.hypot(mv.x - e.x, mv.z - e.z);
      mv.x = e.x;
      mv.z = e.z;
      if (wanted > 0.002) e.houseDeniedT = (e.houseDeniedT || 0) + dt;
      else e.houseDeniedT = 0;
    } else {
      e.houseDeniedT = 0;
    }
    const movedDist = Math.hypot(mv.x - e.x, mv.z - e.z);
    const moved = movedDist > 0.0005;
    e.x = mv.x;
    e.z = mv.z;
    if (speed > 0.05 && e.wanderT <= 0) {
      if (movedDist < want * 0.22) e.moveStuckT = (e.moveStuckT || 0) + dt;
      else e.moveStuckT = Math.max(0, (e.moveStuckT || 0) - dt * 2);
      if (e.moveStuckT > 1.0) {
        e.moveStuckT = 0;
        e.wanderT = 0.55;
        /* 卡住多半是“这条路径已经走不通了”（别人挡路 / 贴着墙角）。
           清掉路径缓存，下一帧重新 A*，比盲目侧移有效得多。 */
        e.path = null;
        e.pathGoal = null;
        let wa = (faceYaw !== undefined ? faceYaw : e.yaw) +
          (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 0.5 + Math.random() * 0.35);
        /* 侧移方向要能走：依次尝试 ±45° / ±90° / 斜后方 / 正后方 */
        const offs = [0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.142];
        for (let oi = 0; oi < offs.length; oi++) {
          const a = wa + offs[oi];
          if (!World.blocked(e.x + Math.sin(a) * 1.1, e.z + Math.cos(a) * 1.1, e.r)) {
            wa = a;
            break;
          }
        }
        e.wanderYaw = wa;
        e.patrol = null;
        e.coverTarget = null;
        /* 被“不许进屋”挡在门口的，直接放弃这个目标：
           否则它会一秒一秒地重算同一条进屋路径，永远顶在门槛上。
           （houseDeniedT 与这里的 1 秒卡住计时同速累计，0.4 秒的门槛用于
           区分“被门禁挡住”和“被别的东西挡住”。） */
        if ((e.houseDeniedT || 0) > 0.4) {
          e.houseDeniedT = 0;
          e.lastSeenX = e.x;
          e.lastSeenZ = e.z;
          e.lostT = 6;
          e.squadHolding = false;
          if (e.squadRef && e.isLeader) e.squadThinkT = 0;
        }
        if (e.state === 'search') {
          /* 追最后目击点时撞墙：立即结束搜索，避免盯着墙角走满 6 秒 */
          e.lastSeenX = e.x;
          e.lastSeenZ = e.z;
          e.lostT = 6;
        }
        if (e.lootTarget) {
          e.lootTarget = null;
          e.lootCooldown = Math.max(e.lootCooldown || 0, 4 + Math.random() * 4);
        }
      }
    }
    if (speed > 0.01) e.moving = true;
    if (moved) e.animT += dt;
    if (faceYaw !== undefined) e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-10 * dt));
    return moved;
  }

  function enemyWeapon(e) {
    const wi = (e.weaponId === undefined) ? CFG.GUNNER.weaponId : e.weaponId;
    return WEAPONS[wi] || WEAPONS[CFG.GUNNER.weaponId];
  }

  /* 清剿小队在未敌对时不把玩家当作目标 / 不误伤玩家 */
  function enemyHostileToPlayer(e) {
    return !e.squadRef || relationOf(e) === 'hostile';
  }

  function damageTargetFromEnemy(e, target, dmg, col) {
    if (!target) return;
    const tx = target.kind === 'player' ? player.x : (target.ref ? target.ref.x : target.x);
    const tz = target.kind === 'player' ? player.z : (target.ref ? target.ref.z : target.z);
    /* 最后一次视线校验：直接伤害型武器不能在走位 / 失去视野后隔墙命中。 */
    if (World.sightBlocked(e.x, e.z, tx, tz)) return;
    if (target.kind === 'player') {
      if (enemyHostileToPlayer(e) && !player.dead) damagePlayer(dmg);
      return;
    }
    const o = target.ref;
    if (!o || o.dead || factionOf(o) === factionOf(e)) return;
    damageEnemy(o, dmg, Math.atan2(o.x - e.x, o.z - e.z), col, true, false, e.x, e.z);
  }

  function fireEnemyBullet(e, tx, tz, d) {
    const w = enemyWeapon(e);
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
      kind: 'kinetic', wi: e.weaponId === undefined ? CFG.GUNNER.weaponId : e.weaponId,
      hostile: true, faction: e.faction || 'scav',
      ignorePlayer: !enemyHostileToPlayer(e),
      ox: e.x, oz: e.z,
      x: mx, z: mz, y: 1.02,
      vx: Math.sin(a) * speed, vz: Math.cos(a) * speed,
      dmg: w.dmg, dmgFar: w.dmgFar, range: w.range,
      travelled: 0, r: 0.2, c: w.rgb2, dead: false
    });
    flashes.push({ x: mx, y: 1.04, z: mz, yaw: a, t: 0.06, s: 0.34, c: w.rgb2 });
    flashes.push({ x: mx, y: 1.04, z: mz, yaw: a, t: 0.1, s: 0.16, c: [1.0, 0.95, 0.82] });
  }

  /* 敌人的其它武器模态：保持与玩家版本相近的视觉 / 伤害反馈 */
  function fireEnemyLaser(e, target, tx, tz, d) {
    const w = enemyWeapon(e);
    const fx = e.x + Math.sin(e.yaw) * 0.7;
    const fz = e.z + Math.cos(e.yaw) * 0.7;
    beams.push({ pts: [{ x: fx, z: fz }, { x: tx, z: tz }], t: 0.18, c: w.rgb2 });
    flashes.push({ x: fx, y: 1.03, z: fz, yaw: e.yaw, t: 0.08, s: 0.28, c: w.rgb2 });
    damageTargetFromEnemy(e, target, w.dmg, w.rgb2);
    sparks.push({ x: tx, y: 1.04, z: tz, t: 0.2, c: w.rgb2, s: 0.28 });
  }

  function fireEnemySonic(e, target, tx, tz, d) {
    const w = enemyWeapon(e);
    const half = (w.halfAngle || 33) * Math.PI / 180;
    sonicWaves.push({
      x: e.x + Math.sin(e.yaw) * 0.5, z: e.z + Math.cos(e.yaw) * 0.5,
      ang: e.yaw, half: half, range: w.range,
      t: 0, life: 0.72, c: w.rgb2, seed: Math.random() * 10
    });
    damageTargetFromEnemy(e, target, w.dmg, w.rgb2);
    sparks.push({ x: e.x, y: 1.0, z: e.z, t: 0.2, c: w.rgb2, s: 0.4 });
  }

  function fireEnemyThermal(e, target, tx, tz, d) {
    const w = enemyWeapon(e);
    const mx = e.x + Math.sin(e.yaw) * 0.7;
    const mz = e.z + Math.cos(e.yaw) * 0.7;
    tracers.push({ x0: mx, z0: mz, x1: tx, z1: tz, c: w.rgb2, t: 0.12 });
    damageTargetFromEnemy(e, target, w.dmg, w.rgb2);
    for (let i = 0; i < 4; i++) {
      sparks.push({
        x: tx + (Math.random() - 0.5) * 0.6, y: 0.65 + Math.random() * 0.9,
        z: tz + (Math.random() - 0.5) * 0.6, t: 0.2 + Math.random() * 0.12,
        c: i % 2 ? [1, 0.48, 0.18] : w.rgb2, s: 0.2 + Math.random() * 0.14
      });
    }
    spawnHostileZone(tx, tz, w, e);
  }

  function fireEnemyVoltaic(e, target, tx, tz, d) {
    const w = enemyWeapon(e);
    const mx = e.x + Math.sin(e.yaw) * 0.7;
    const mz = e.z + Math.cos(e.yaw) * 0.7;
    bolts.push({
      x0: mx, z0: mz, x1: tx, z1: tz,
      t: 0.18, c: w.rgb2, seed: Math.random() * 10
    });
    damageTargetFromEnemy(e, target, w.dmg, w.rgb2);
    const used = [];
    if (target && target.ref) used.push(target.ref);
    let src = { x: tx, z: tz };
    const maxN = w.chainMax || 3;
    for (let i = 0; i < maxN; i++) {
      let best = null, bd = w.chainR || 6;
      for (const o of enemies) {
        if (o.dead || o === e || factionOf(o) === factionOf(e) || used.indexOf(o) >= 0) continue;
        const od = Math.hypot(o.x - src.x, o.z - src.z);
        if (od >= bd) continue;
        if (World.sightBlocked(src.x, src.z, o.x, o.z)) continue;
        bd = od; best = o;
      }
      if (!best) break;
      bolts.push({
        x0: src.x, z0: src.z, x1: best.x, z1: best.z,
        t: 0.18, c: w.rgb2, seed: Math.random() * 10
      });
      const mul = i < (w.chainMul || []).length ? w.chainMul[i] : 0.25;
      damageEnemy(best, w.dmg * mul, Math.atan2(best.x - src.x, best.z - src.z), w.rgb2, true, false, e.x, e.z);
      used.push(best);
      src = { x: best.x, z: best.z };
    }
  }

  function fireEnemyWeapon(e, target, tx, tz, d) {
    const w = enemyWeapon(e);
    /* 走位后可能已经绕到墙角后面；不再产生光束 / 燃烧区 / 电弧。 */
    if (World.sightBlocked(e.x, e.z, tx, tz)) return;
    const mx = e.x + Math.sin(e.yaw) * 0.7;
    const mz = e.z + Math.cos(e.yaw) * 0.7;
    flashes.push({ x: mx, y: 1.03, z: mz, yaw: e.yaw, t: 0.06, s: 0.3, c: w.rgb2 });
    if (w.id === 'laser') fireEnemyLaser(e, target, tx, tz, d);
    else if (w.id === 'sonic') fireEnemySonic(e, target, tx, tz, d);
    else if (w.id === 'thermal') fireEnemyThermal(e, target, tx, tz, d);
    else if (w.id === 'voltaic') fireEnemyVoltaic(e, target, tx, tz, d);
    else fireEnemyBullet(e, tx, tz, d);
    e.ammo = Math.max(0, e.ammo - 1);
  }

  function updateGunnerAI(e, dt, d, sees, dx, dz, target) {
    const w = WEAPONS[e.weaponId === undefined ? CFG.GUNNER.weaponId : e.weaponId];
    const faceYaw = Math.atan2(dx, dz);
    const threatX = (sees && target) ? target.x : e.lastSeenX;
    const threatZ = (sees && target) ? target.z : e.lastSeenZ;
    if (e.coverCd > 0) e.coverCd -= dt;
    if (e.underFire > 0) e.underFire -= dt;
    if (e.wanderT > 0) e.wanderT = Math.max(0, e.wanderT - dt);
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
          aiMoveTo(e, e.coverTarget.x, e.coverTarget.z, e.speed, dt, faceYaw);
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

      const doorHere = enemyDoor(e);
      if (doorHere && doorHere.open &&
          Math.hypot(doorHere.x - e.x, doorHere.z - e.z) < 1.15) {
        /* 不要站在门洞里对枪堵路：沿门法线走到自己这一侧，
           而不是朝“目标那一侧”硬挤 —— 目标也在门洞里时会变成贴着门框蹭。 */
        const yaw = doorHere.rect ? doorHere.rect.yaw : 0;
        const nx = -Math.sin(yaw), nz = Math.cos(yaw);
        const sd = (e.x - doorHere.x) * nx + (e.z - doorHere.z) * nz;
        if (Math.abs(sd) < 0.6) {
          const s = sd >= 0 ? 1 : -1;
          gunnerMove(e, nx * s, nz * s, e.speed * 0.85, dt, faceYaw);
        } else if (d > CFG.GUNNER.rangeMax) {
          aiMoveTo(e, target.x, target.z, e.speed, dt, faceYaw);
        } else if (d < CFG.GUNNER.rangeMin) {
          gunnerMove(e, -dx, -dz, e.speed, dt, faceYaw);
        } else {
          e.moving = false;
          e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-12 * dt));
        }
      } else if (d > CFG.GUNNER.rangeMax) {
        aiMoveTo(e, target.x, target.z, e.speed, dt, faceYaw);
      } else if (d < CFG.GUNNER.rangeMin) {
        gunnerMove(e, -dx, -dz, e.speed, dt, faceYaw);
      } else {
        e.strafeT -= dt;
        if (e.strafeT <= 0) {
          e.strafeDir *= -1;
          e.strafeT = 0.7 + Math.random() * 0.9;
        }
        /* 两侧都贴墙时不要继续沿墙滑；但也不要站着不动装卡住：
           走廊里没法走位时压上到稍近的距离开火。 */
        const ax = -dz / d, az = dx / d;
        const canA = !World.blocked(e.x + ax * 0.7, e.z + az * 0.7, e.r, true);
        const canB = !World.blocked(e.x - ax * 0.7, e.z - az * 0.7, e.r, true);
        if (!canA && !canB) {
          e.moving = false;
          e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-12 * dt));
          if (d > CFG.GUNNER.rangeMax * 0.8) {
            aiMoveTo(e, target.x, target.z, e.speed * 0.9, dt, faceYaw);
          }
        } else {
          if (e.strafeDir > 0 && !canA) e.strafeDir = -1;
          else if (e.strafeDir < 0 && !canB) e.strafeDir = 1;
          const sx = ax * e.strafeDir, sz = az * e.strafeDir;
          if (!gunnerMove(e, sx, sz, e.speed * 0.62, dt, faceYaw)) {
            e.strafeDir *= -1;
            e.strafeT = 0.45;
          }
        }
      }
      e.yaw = angLerp(e.yaw, faceYaw, 1 - Math.exp(-12 * dt));

      if (e.aimT > 0) { e.aimT -= dt; return; }
      if (e.reloadT > 0) return;
      if (e.burstLeft > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          if (e.ammo <= 0) {
            const reload = w.reload || CFG.GUNNER.reload;
            e.reloadT = reload;
            e.reloadDur = reload;
            e.burstLeft = 0;
            e.burstCool = 0.45;
          } else {
            fireEnemyWeapon(e, target, threatX, threatZ, d);
            e.burstLeft--;
            e.burstT = w.rate;
            if (e.burstLeft <= 0) e.burstCool = 0.45 + Math.random() * 0.55;
          }
        }
      } else if (e.burstCool <= 0) {
        const bmin = e.burstMin === undefined ? CFG.GUNNER.burstMin : e.burstMin;
        const bmax = e.burstMax === undefined ? CFG.GUNNER.burstMax : e.burstMax;
        e.burstLeft = bmin + Math.floor(Math.random() * (bmax - bmin + 1));
        e.burstT = 0;
      }
      return;
    }

    /* 失去视野：先前往最后目击点，再开始搜刮 / 巡逻。
       目击点在任何房屋里都直接记为已侦察，允许小队追进去搜索；
       不再因为“这栋房屋没情报”而放弃追击、站在门口不进门。 */
    e.burstLeft = 0;
    e.coverTarget = null;
    if (e.squadRef) {
      e.squadRef.combatT = time;
      squadMarkHouseIntel(e.squadRef, e.lastSeenX, e.lastSeenZ);
    }
    if (e.lostT < 6) {
      e.state = 'search';
      const td = Math.hypot(e.lastSeenX - e.x, e.lastSeenZ - e.z);
      if (td > 0.8) {
        aiMoveTo(e, e.lastSeenX, e.lastSeenZ, e.speed * 0.9, dt,
          Math.atan2(e.lastSeenX - e.x, e.lastSeenZ - e.z));
      } else {
        e.moving = false;
        e.yaw += Math.sin(time * 1.4 + e.seed) * dt * 0.7;
      }
      return;
    }

    e.state = 'patrol';
    /* 队员直接跟随队长当前位置，各自用 A* 绕墙 / 走门；
       保留“跟随距离 + 迟滞”，避免贴太近互相挤门、也避免停一下又追一下。 */
    if (e.squadRef && !e.isLeader) {
      const sq = e.squadRef;
      const lead = sq.leader;
      if (lead && !lead.dead && lead !== e) {
        const ld = Math.hypot(lead.x - e.x, lead.z - e.z);
        const leadH = World.houseAt ? World.houseAt(lead.x, lead.z, 0.05) : null;
        const myH = World.houseAt ? World.houseAt(e.x, e.z, 0.05) : null;
        const slot = e.squadSlot || 0;
        /* 后面的队员停得稍远，队伍自然拉开，不在门口叠成一团。 */
        const stop = 1.9 + slot * 0.8;
        if (e.squadHolding) {
          if (ld > stop + 1.0 || leadH !== myH) e.squadHolding = false;
        } else if (ld <= stop && leadH === myH) {
          e.squadHolding = true;
        }
        if (e.squadHolding) {
          /* 不要停在门洞里：如果正好压在门洞中间，沿自己这一侧的法线迈出去再待命。
             不能按“队长那一侧”推 —— 队长也在门洞里时方向会横着，正好顶住门框。 */
          const door = enemyDoor(e);
          if (door && door.open && Math.hypot(door.x - e.x, door.z - e.z) < 1.25) {
            const yaw = door.rect ? door.rect.yaw : 0;
            const nx = -Math.sin(yaw), nz = Math.cos(yaw);
            const sd = (e.x - door.x) * nx + (e.z - door.z) * nz;
            if (Math.abs(sd) < 0.62) {
              const s = sd >= 0 ? 1 : -1;
              gunnerMove(e, nx * s, nz * s, e.speed * 0.85, dt);
              e.squadHolding = false;
              return;
            }
          }
          e.moving = false;
          e.patrol = null;
          e.yaw = angLerp(e.yaw, Math.atan2(lead.x - e.x, lead.z - e.z), 1 - Math.exp(-8 * dt));
          return;
        }
        e.patrol = { x: lead.x, z: lead.z };
        e.waitT = 0;
        e.lootTarget = null;
      } else {
        e.patrol = null;
        e.squadHolding = false;
      }
    }
    if (e.squadRef && e.isLeader) {
      /* 队长只按自己的节奏选择下一个目标，不看队员位置。
         到达后等冷却结束再选下一个，降低寻路 / 游荡点判断频率。 */
      e.squadThinkT = Math.max(0, (e.squadThinkT || 0) - dt);
      if (!e.patrol) {
        if (e.squadThinkT > 0) {
          e.moving = false;
          e.yaw += Math.sin(time * 1.1 + e.seed) * dt * 0.5;
          return;
        }
        e.patrol = pickSquadRoamPoint(e);
        e.squadThinkT = 2.2 + Math.random() * 1.8;
        e.waitT = 0;
      }
    }
    if (gunnerLoot(e, dt)) return;
    if (!e.patrol) { e.patrol = pickPatrol(e); e.waitT = 0.6 + Math.random() * 1.4; }
    if (e.waitT > 0) {
      e.waitT -= dt;
      e.yaw += Math.sin(time * 1.1 + e.seed) * dt * 0.5;
      return;
    }
    if (e.squadRef && !e.isLeader) {
      /* 队员直接追队长当前所在位置；无路可走且被墙挡住时 aiMoveTo 会停下等下一帧重算 */
      aiMoveTo(e, e.patrol.x, e.patrol.z, e.speed * 1.05, dt);
      return;
    }
    const arrived = e.squadRef
      ? squadStepTo(e, e.patrol.x, e.patrol.z, e.speed * 0.62, dt)
      : stepTo(e, e.patrol.x, e.patrol.z, e.speed * 0.42, dt);
    if (arrived) {
      e.patrolStallT = 0;
      e.patrol = null;
      if (e.squadRef) {
        if (e.isLeader) e.squadThinkT = Math.max(e.squadThinkT, 0.6);
      } else {
        e.waitT = 1.2 + Math.random() * 2.2;
        e.patrol = pickPatrol(e);
      }
      e.lootTarget = null;
      e.path = null;
    } else if (!e.moving) {
      /* 目标不可达 / 被挡住：1.2 秒没有进展就放弃，换下一个目标。
         没有这个兜底时，一次选到隔着墙的目标就会永远站着等。 */
      e.patrolStallT = (e.patrolStallT || 0) + dt;
      if (e.patrolStallT > 1.2) {
        e.patrolStallT = 0;
        e.patrol = null;
        e.path = null;
        e.pathGoal = null;
        if (e.squadRef) e.squadThinkT = Math.max(e.squadThinkT || 0, 0.35);
        else e.waitT = 0.2 + Math.random() * 0.4;
      }
    } else {
      e.patrolStallT = 0;
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
    const wi = (e.weaponId === undefined) ? CFG.GUNNER.weaponId : e.weaponId;
    let held = ITEMS.makeWeaponItem(wi, { found: true });
    if (held) {
      held.found = true;
      held.foundAt = 0;
      /* 敌人当前弹夹里剩多少发，尸体上的枪就带多少发；不凭空补满 */
      held.mag = Math.max(0, Math.min(WEAPONS[wi].mag, e.ammo | 0));
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
    const label = e.displayName || (CFG.ENEMY[e.type] && CFG.ENEMY[e.type].name) || '拾荒者';
    const container = {
      type: 'corpse', corpse: true, x: e.x, z: e.z, yaw: e.yaw,
      name: label + ' 尸体', cols: cols, rows: rows, inv: inv,
      weapons: weapons,
      cr: 0.5, pried: true, opened: false, search: null,
      emptyText: '尸体已被搜空'
    };
    container.linkedEnemy = e;
    World.chests.push(container);
    e.corpseContainer = container;
  }

  function corpseHasItems(c) {
    if (!c || !c.corpse) return false;
    if (c.inv && c.inv.length) return true;
    if (c.weapons && (c.weapons[0] || c.weapons[1])) return true;
    return !!c.weapon;
  }

  /* 尸体被搜空后：关闭仍在查看的界面，尸体视觉和普通僵尸一样下沉消失 */
  function updateCorpseContainers(dt) {
    for (let i = World.chests.length - 1; i >= 0; i--) {
      const c = World.chests[i];
      if (!c || !c.corpse) continue;
      if (!c.emptyT) {
        if (corpseHasItems(c)) continue;
        c.emptyT = 0.0001;
        if (Inventory.currentChest() === c) Inventory.closeChest();
        const e = c.linkedEnemy;
        if (e) {
          e.corpse = false;
          e.corpseContainer = null;
          e.deadT = 0;
          e.fade = 1.9;
        }
      } else {
        c.emptyT += dt;
        if (c.emptyT >= 1.6) {
          World.chests.splice(i, 1);
        }
      }
    }
  }

  /* 队伍顺位：队长最优先，其余按号码。推挤时只让顺位靠后的让路。 */
  function squadRank(e) {
    if (!e.squadRef) return 99;
    return e.isLeader ? -1 : (e.squadSlot || 0);
  }

  function updateEnemies(dt) {
    aiPathBudget = 3;
    squadPathBudget = 6;
    enemyAlive.length = 0;
    for (const e of enemies) if (!e.dead) enemyAlive.push(e);
    /* 队长阵亡后由第一个存活成员接替，避免小队直接散架。 */
    for (let si = 0; si < squads.length; si++) {
      const sq = squads[si];
      if (sq.leader && !sq.leader.dead) continue;
      let next = null;
      for (let mi = 0; mi < sq.members.length; mi++) {
        if (!sq.members[mi].dead) { next = sq.members[mi]; break; }
      }
      sq.leader = next;
      if (next) {
        next.isLeader = true;
        next.squadRole = 'leader';
        next.squadThinkT = 0;
        next.patrol = null;
        next.squadHolding = false;
      }
    }
    for (const e of enemies) {
      if (e.dead) {
        if (!e.corpse) e.fade -= dt;
        else e.deadT = (e.deadT || 0) + dt;
        continue;
      }

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      /* 清剿小队护盾：脱战一段时间后自动充能 */
      if (e.maxShield > 0) {
        e.shieldTimer = Math.max(0, (e.shieldTimer || 0) - dt);
        if (e.shieldTimer <= 0 && e.shield < e.maxShield) {
          e.shield = Math.min(e.maxShield, e.shield + CFG.SQUAD.shieldRate * dt);
        }
      }
      e.cd = Math.max(0, e.cd - dt);
      e.swayT = (e.swayT || 0) + dt;
      updateEnemyDoor(e, dt);
      /* 门被关上时把站在门里的单位推出去（和玩家同一套处理）。
         以前只推玩家，敌人被关门夹住就要自己靠逃逸搜索慢慢蹭出来。 */
      if (e.nearDoor) {
        const doorPush = World.resolveDoorTrap(e.x, e.z, e.r);
        if (doorPush) {
          e.x = doorPush.x;
          e.z = doorPush.z;
          e.path = null;
          e.pathGoal = null;
        }
      }

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
              faction: e.faction || 'undead', srcX: e.x, srcZ: e.z
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

      /* 逐帧位移可能被门框 / 墙体回弹抵消，单帧检测会漏掉“原地抖动”。
         用 0.7s 窗口判断真实前进距离，没前进就强制侧移脱困。 */
      e.progT = (e.progT || 0) + dt;
      if (e.progT >= 0.7) {
        const px = (e.progX === undefined) ? e.x : e.progX;
        const pz = (e.progZ === undefined) ? e.z : e.progZ;
        if (e.moving && Math.hypot(e.x - px, e.z - pz) < 0.14) {
          e.moveStuckT = 0;
          e.wanderT = Math.max(e.wanderT || 0, 0.55);
          /* 路径失效：先清缓存让下一帧重新寻路，再考虑侧移 */
          e.path = null;
          e.pathGoal = null;
          /* 侧移方向必须是能走的方向，否则会继续贴着墙滑。 */
          let wa = e.yaw + (Math.random() < 0.5 ? -1 : 1) *
            (Math.PI * 0.5 + Math.random() * 0.3);
          const offs = [0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.142];
          for (let oi = 0; oi < offs.length; oi++) {
            const a = wa + offs[oi];
            if (!World.blocked(e.x + Math.sin(a) * 1.1, e.z + Math.cos(a) * 1.1, e.r, true)) {
              wa = a;
              break;
            }
          }
          e.wanderYaw = wa;
          e.patrol = null;
          if (e.gunner) e.lootTarget = null;
        }
        e.progX = e.x; e.progZ = e.z; e.progT = 0;
      }

      /* 拾荒者在非交战状态快速移动时把枪横在胸前（与玩家奔跑姿势一致） */
      e.carry = !!e.gunner && e.moving && e.reloadT <= 0 &&
        (e.state === 'cover' || e.state === 'search' || e.state === 'patrol');
      e.moveBlend = (e.moveBlend || 0) + ((e.moving ? 1 : 0) - (e.moveBlend || 0)) * (1 - Math.exp(-6 * dt));
      e.sprintBlend = (e.sprintBlend || 0) + ((e.carry ? 1 : 0) - (e.sprintBlend || 0)) * (1 - Math.exp(-14 * dt));

      /* 队伍内部推挤：
         门口 / 走廊不再需要“禁止互推”的老办法（那会让两个人完全重叠、
         看起来像穿模卡住）。改成单向让路：每一对只推顺位靠后的那个，
         净位移永远有方向，不会出现两人对称互顶、原地抖的死锁。 */
      for (const o of enemyAlive) {
        if (o === e || o.dead) continue;
        const mates = e.squadRef && o.squadRef === e.squadRef;
        if (mates && squadRank(e) < squadRank(o)) continue;
        const ox = e.x - o.x, oz = e.z - o.z;
        const od = Math.hypot(ox, oz);
        const mn = e.r + o.r;
        if (od <= 0.0001 || od >= mn) continue;
        const push = (mn - od) * 0.5;
        const nx = e.x + ox / od * push;
        const nz = e.z + oz / od * push;
        if (!World.blocked(nx, nz, e.r)) { e.x = nx; e.z = nz; }
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

    if (trainingOpen) {
      HUD.prompt(null);
      return;
    }

    if (nearTrainingPad()) {
      HUD.objective('训练配装 · 切换武器 / 道具', true);
      HUD.prompt((TOUCH_MODE ? '' : '[F] ') + '打开训练配装台');
      return;
    }

    const nearChest = nearestChest();
    const nearDoor = World.nearestDoor(player.x, player.z);
    if (nearDoor) {
      const dd = Math.hypot(nearDoor.x - player.x, nearDoor.z - player.z);
      const cd = nearChest ? Math.hypot(nearChest.x - player.x, nearChest.z - player.z) : Infinity;
      if (dd <= cd) {
        HUD.prompt((TOUCH_MODE ? '' : '[F] ') + (nearDoor.open ? '关闭安全屋门' : '打开安全屋门'));
        return;
      }
    }

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

    const nearPad = nearestPad(player.x, player.z);
    const dp = Math.hypot(player.x - nearPad.x, player.z - nearPad.z);
    if (dp < nearPad.r) HUD.objective('撤离台 · 保持站位', true);
    else if (dp < nearPad.r + 5) HUD.objective('撤离台 · 已到达', true);
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
    if (dp < nearPad.r) HUD.prompt('保持站位 · 撤离同步中');
    else if (dp < nearPad.r + 5) HUD.prompt('撤离台就在附近');
    else HUD.prompt(null);
  }

  /* ---------- 更新 ---------- */
  /* 视野：120° 视锥、24m 内，且没有被墙/木箱遮挡 */
  function inVisionCone(x, z, r) {
    const dx = x - player.x, dz = z - player.z;
    const d2 = dx * dx + dz * dz;
    const range = CFG.VISION.RANGE;
    if (d2 > range * range) return false;
    const half = CFG.VISION.HALF_DEG * Math.PI / 180;
    if (half >= Math.PI - 1e-4) return true;
    const face = (player.headWorldYaw === undefined) ? player.yaw : player.headWorldYaw;
    const ang = Math.atan2(dx, dz);
    const tol = r ? Math.atan2(r, Math.max(0.25, Math.sqrt(d2))) : 0;
    return Math.abs(angDiff(ang, face)) <= half + tol;
  }

  function visionVisible(x, z, r) {
    if (!inVisionCone(x, z, r)) return false;
    return !World.sightBlocked(player.x, player.z, x, z);
  }

  function updateVision(dt) {
    visionClock += dt;
    if (visionClock < 0.07) return;
    visionClock = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) {
        /* 尸体也要做视野判断：否则尸体会和战利品标记一起穿墙显示。
           搜空后 e.corpse=false 但仍在淡出下沉，需要继续允许渲染。 */
        e.inVision = (!!e.corpse || e.fade > 0) && visionVisible(e.x, e.z, 0.35);
        continue;
      }
      e.inVision = visionVisible(e.x, e.z, e.r);
    }
  }

  /* 硬边地面阴影：按玩家视线方向直接生成遮挡物的阴影多边形（直线边缘） */
  function buildShadowGeo() {
    const sg = R.shadow;
    if (!sg) return;
    const px = player.x, pz = player.z;
    const RANGE = CFG.VISION.RANGE;
    /* 阴影射线要远到让“远端连线”落在视野半径之外：
       贴墙时两面墙的夹角可能接近 166°，连线若只用 24m+10 会切进视野内，
       墙外会出现一块本应被遮挡的亮区。 */
    const FAR = RANGE + 600;

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

    /* 线段阴影：用于安全屋外墙。相邻墙段共用端点，阴影在墙角严丝合缝；
       门洞处不补线段，开着的门会自然漏出一道光楔。 */
    function addWallShadow(ax, az, bx, bz) {
      const aa = Math.atan2(ax - px, az - pz);
      const ba = Math.atan2(bx - px, bz - pz);
      let d = Math.abs(aa - ba);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.02) return;
      const al = Math.hypot(ax - px, az - pz) || 1;
      const bl = Math.hypot(bx - px, bz - pz) || 1;
      const A2x = ax + (ax - px) / al * FAR;
      const A2z = az + (az - pz) / al * FAR;
      const B2x = bx + (bx - px) / bl * FAR;
      const B2z = bz + (bz - pz) / bl * FAR;
      const Y = 0.045;
      sg.tri(ax, az, bx, bz, B2x, B2z, Y, [1, 1, 1]);
      sg.tri(ax, az, B2x, B2z, A2x, A2z, Y, [1, 1, 1]);
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

    /* 模块化安全屋：按每格外墙的外沿线段投射视野阴影。
       相邻模块共用外沿端点，门洞只在门开着时留空。 */
    const HOUSES = World.houses || [];
    const MH = CFG.HOUSE;
    for (let hi = 0; hi < HOUSES.length; hi++) {
      const h = HOUSES[hi];
      /* 只处理视野附近的房屋；大房子的中心可能很远，用轮廓距离判断 */
      const hd = World.houseDistance ? World.houseDistance(h, px, pz) : Math.hypot(h.x - px, h.z - pz);
      if (hd > RANGE + 8) continue;
      for (let mi = 0; mi < h.modules.length; mi++) {
        const m = h.modules[mi];
        const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
        const oz = MH.WALL_T * 0.5;
        function seg(x0, x1) {
          const ax = m.cx + c * x0 + s * oz;
          const az = m.cz - s * x0 + c * oz;
          const bx = m.cx + c * x1 + s * oz;
          const bz = m.cz - s * x1 + c * oz;
          addWallShadow(ax, az, bx, bz);
        }
        if (m.type === 'door') {
          seg(-MH.MODULE * 0.5, -MH.DOOR_W * 0.5);
          seg( MH.DOOR_W * 0.5,  MH.MODULE * 0.5);
          if (m.door && m.door.t < 0.35) seg(-MH.DOOR_W * 0.5, MH.DOOR_W * 0.5);
        } else {
          seg(-MH.MODULE * 0.5, MH.MODULE * 0.5);
        }
      }

      /* 室内隔断也要挡视野：沿墙中心线投射，门洞只在门开着时留空 */
      for (let mi = 0; mi < h.interiorModules.length; mi++) {
        const m = h.interiorModules[mi];
        const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
        function iseg(x0, x1) {
          addWallShadow(
            m.cx + c * x0, m.cz - s * x0,
            m.cx + c * x1, m.cz - s * x1
          );
        }
        if (m.type === 'door') {
          iseg(-MH.MODULE * 0.5, -MH.DOOR_W * 0.5);
          iseg( MH.DOOR_W * 0.5,  MH.MODULE * 0.5);
          if (m.door && m.door.t < 0.35) iseg(-MH.DOOR_W * 0.5, MH.DOOR_W * 0.5);
        } else {
          iseg(-MH.MODULE * 0.5, MH.MODULE * 0.5);
        }
      }
    }
  }

  function update(dt) {
    if (mode !== 'mission' || ended) return;
    if (paused) return;
    time += dt;
    /* 训练场数据无限：每帧回填，所有消耗都可以正常扣除但不会耗尽 */
    if (player.infiniteData) player.data = 999999;
    const houseAimYaw = (player.headWorldYaw === undefined) ? player.yaw : player.headWorldYaw;
    World.updateHouses(dt, player.x, player.z,
      Math.sin(houseAimYaw), Math.cos(houseAimYaw), CFG.VISION.RANGE);
    /* 门关上时如果玩家正在门洞里，把玩家推出去，避免卡死 */
    const doorPush = World.resolveDoorTrap(player.x, player.z, CFG.PLAYER.r);
    if (doorPush) {
      player.x = doorPush.x;
      player.z = doorPush.z;
    }

    /* 靠近物资箱自动开始撬箱；箱盖撬飞后由 F 主动搜索。
       自动撬箱要求箱子在当前视野内（120° 视锥 + 24m + 无墙体遮挡），
       避免隔着墙或背对箱子时凭空撬开。 */
    const autoChest = nearestChest(true);
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
          } else if (!visionVisible(c.x, c.z, c.cr || 0.5)) {
            cancelPry(c, '失去视野 · 撬箱中断');
          } else {
            c.pryT += dt / CFG.CHEST_PRY_TIME;
            if (c.pryT >= 1) finishPry(c);
          }
        }
      }
      if (c.pryBurst > 0) c.pryBurst = Math.max(0, c.pryBurst - dt);
      if (c.openDelay > 0) c.openDelay = Math.max(0, c.openDelay - dt);
      /* 撬开后自动进入搜索；若当时不在附近或正在查看其它箱子，等条件满足时再自动打开 */
      if (c.autoSearch && c.openDelay <= 0 && !Inventory.isOpen() && !trainingOpen) {
        const d = Math.hypot(c.x - player.x, c.z - player.z) - (c.cr || 0);
        if (d <= (CFG.CHEST_INTERACT_R || 1.8) + 0.9) {
          c.autoSearch = false;
          Inventory.openChest(c);
        }
      }
    }
    updateLidDebris(dt);
    updateCorpseContainers(dt);

    const invOpen = Inventory.isOpen();
    const uiLock = invOpen || trainingOpen;
    if (mouse.locked && uiLock) setMouseLock(false);
    if (!TOUCH_MODE) HUD.setCursorVisible(uiLock);
    /* UI 关闭后，下一次点击画面先重新锁定系统指针 */
    if (mouse.lastUiLock && !uiLock && !TOUCH_MODE && !player.dead && !ended) {
      mouse.autoLockPending = true;
    }
    mouse.lastUiLock = uiLock;
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

    /* 鼠标位置 → 地面瞄准点：站定时身体跟随瞄准；奔跑时身体朝移动方向，瞄准只转头 */
    let aimYaw = player.aimYaw;
    if (TOUCH_MODE) {
      const tr = TOUCH.right;
      if (tr.active && tr.aimActive) {
        aimYaw = tr.aimYaw;
        player.aimActive = true;
      }
    } else if (!uiLock) {
      const gp = screenToGround(mouse.x, mouse.y, 0.9);
      if (gp) aim = gp;
      const adx = aim.x - player.x, adz = aim.z - player.z;
      if (Math.hypot(adx, adz) > 0.3) aimYaw = Math.atan2(adx, adz);
    }
    /* 界面打开期间锁定当前朝向，鼠标移动只操作界面 */
    if (!uiLock) player.aimYaw = aimYaw;

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
    if (uiLock) { ix = 0; iz = 0; touchRun = false; }
    const mag = Math.hypot(ix, iz);
    player.moving = (mag > 0 || WALK) && !player.dead;
    const targetMoveYaw = (mag > 0) ? Math.atan2(ix, iz) : player.moveYaw;
    const wantSprint = touchActive
      ? touchRun
      : ((TOUCH_MODE && tl.autoMove) ? true : !!(keys.ShiftLeft || keys.ShiftRight));
    player.sprinting = wantSprint && player.stam > 1 && player.moving && player.reload <= 0;
    /* 跑动转向缓动：腿和身体都使用这里的 moveYaw，不会瞬间拧到新方向 */
    if (mag > 0 && !player.dead) {
      const turnRate = player.sprinting ? 7.0 : 22.0;
      player.moveYaw = angLerp(player.moveYaw, targetMoveYaw, 1 - Math.exp(-turnRate * dt));
    }
    if (!isNaN(MV)) player.moveYaw = player.yaw + MV * Math.PI / 180;

    let speed = player.sprinting ? CFG.PLAYER.run : CFG.PLAYER.walk;
    if (player.dead) speed = 0;
    if (mag > 0) { ix /= mag; iz /= mag; }

    /* 奔跑：身体转向移动方向，头部可以 360° 自由看向鼠标/右摇杆；
       站定：身体重新追回瞄准方向，头部回到身体正前方。 */
    if (player.dead) {
      /* 死亡时保持当前朝向 */
    } else if (player.sprinting) {
      if (player.gadgetAim >= 0) cancelGadgetAim();
      player.yaw = angLerp(player.yaw, player.moveYaw, 1 - Math.exp(-12 * dt));
      /* 奔跑时头部不锁定：可以随鼠标 / 右摇杆自由转向；
         只加角速度上限 + 缓动，避免快速甩鼠标时头部瞬移。 */
      const dHead = angDiff(player.headWorldYaw, player.aimYaw);
      const desired = dHead * (1 - Math.exp(-CFG.PLAYER.headTurnLerp * dt));
      const maxStep = CFG.PLAYER.headTurnSpeed * dt;
      player.headWorldYaw = normAngle(player.headWorldYaw + clamp(desired, -maxStep, maxStep));
      player.headYaw = angDiff(player.yaw, player.headWorldYaw);
    } else {
      player.yaw = angLerp(player.yaw, player.aimYaw, 1 - Math.exp(-18 * dt));
      player.headWorldYaw = angLerp(player.headWorldYaw, player.aimYaw, 1 - Math.exp(-28 * dt));
      player.headYaw = angDiff(player.yaw, player.headWorldYaw);
    }
    /* 还没有任何鼠标 / 右摇杆输入时，头保持朝前，避免一开跑就回头 */
    if (!player.aimActive) {
      player.aimYaw = player.yaw;
      player.headWorldYaw = player.yaw;
      player.headYaw = 0;
    }
    player.yaw = normAngle(player.yaw);
    player.headWorldYaw = normAngle(player.headWorldYaw);
    player.aimYaw = normAngle(player.aimYaw);

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
    player.swayT += dt;
    const moveTarget = player.moving ? 1 : 0;
    player.moveBlend += (moveTarget - player.moveBlend) * (1 - Math.exp(-6 * dt));
    /* 进入 / 离开奔跑、开始 / 结束换弹时，枪横胸 / 正常持枪之间快速缓动 */
    const carryTarget = (player.sprinting || player.reload > 0) ? 1 : 0;
    player.gunCarryMix += (carryTarget - player.gunCarryMix) * (1 - Math.exp(-14 * dt));
    player.sprintBlend += ((player.sprinting ? 1 : 0) - player.sprintBlend) * (1 - Math.exp(-14 * dt));

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
      if (!uiLock) {
        if (curW.auto) {
          if (TOUCH.right.firing) fire();
        } else if (TOUCH.takeSemiShot()) {
          if (!player.sprinting) {
            const tr = TOUCH.right;
            if (tr.aimActive) player.yaw = tr.aimYaw;
            fire();
          }
        }
      }
    } else if ((mouse.down || AUTO) && !uiLock) {
      fire();
    }

    updateEnemies(dt);
    updateVision(dt);
    updateDroppedLoot(dt);
    updateLootVision(dt);
    compactLoot(dt);

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
          if (!b.ignorePlayer && !player.dead && !player.extracted) {
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
        if (z.hostile && !z.ignorePlayer && !player.dead &&
            Math.hypot(player.x - z.x, player.z - z.z) < z.r &&
            !World.sightBlocked(z.x, z.z, player.x, player.z)) {
          damagePlayer(z.dps * 0.25);
        }
        for (const e of enemies) {
          if (e.dead) continue;
          if (z.faction && factionOf(e) === z.faction) continue;
          if (Math.hypot(e.x - z.x, e.z - z.z) < z.r &&
              !World.sightBlocked(z.x, z.z, e.x, e.z)) {
            damageEnemy(e, z.dps * 0.25, Math.atan2(e.x - z.x, e.z - z.z), z.c,
              true, z.hostile ? false : true, z.x, z.z);
          }
        }
      }
    }
    zones = zones.filter(function (z) { return z.life > 0; });

    updateGadgetState(dt);

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

    /* 撤离：支持多个撤离台，站进任意一个都会独立计量 */
    const activePad = nearestPad(player.x, player.z);
    const exHold = (testMap && World.test && World.test.extractHold)
      ? World.test.extractHold
      : (activePad.hold || CFG.EXTRACT_HOLD);
    const dp = Math.hypot(player.x - activePad.x, player.z - activePad.z);
    if (dp < activePad.r && !player.dead) {
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
  /* 视野亮区：120° 视锥、24m 内且没有被墙 / 木箱等挡住（与地面阴影使用同一套视线） */
  function isVisionLit(x, z) {
    if (!inVisionCone(x, z, 0)) return false;
    return !World.sightBlocked(player.x, player.z, x, z);
  }

  /* 只有“部分可见、且部分被墙挡住”的可互动物品才加纯色填充。
     完全在阴影里 / 完全可见的物品都不加。 */
  /* 地面收集物是否至少有一部分处于视野亮区（24m + 墙体/木箱视线） */
  function lootVisible(l) {
    const s = 0.24;
    const pts = [
      { x: l.x, z: l.z },
      { x: l.x + s, z: l.z }, { x: l.x - s, z: l.z },
      { x: l.x, z: l.z + s }, { x: l.x, z: l.z - s }
    ];
    for (let i = 0; i < pts.length; i++) {
      if (isVisionLit(pts[i].x, pts[i].z)) return true;
    }
    return false;
  }

  /* 丢出物品的短抛物线：只改显示位置，落地后保持静止 */
  function updateDroppedLoot(dt) {
    if (!World.loot || !World.loot.length) return;
    for (let i = 0; i < World.loot.length; i++) {
      const l = World.loot[i];
      if (!(l.throwDur > 0)) continue;
      l.throwT += dt;
      const t = Math.min(1, l.throwT / l.throwDur);
      l.x = l.fromX + (l.toX - l.fromX) * t;
      l.z = l.fromZ + (l.toZ - l.fromZ) * t;
      l.dropH = Math.sin(Math.PI * t) * l.throwArc;
      if (t >= 1) {
        l.x = l.toX;
        l.z = l.toZ;
        l.dropH = 0;
        l.throwDur = 0;
      }
    }
  }

  function updateLootVision(dt) {
    lootVisionClock += dt;
    if (lootVisionClock < 0.1) return;
    lootVisionClock = 0;
    for (let i = 0; i < World.loot.length; i++) {
      const l = World.loot[i];
      l.inVision = !l.taken && lootVisible(l);
    }
  }

  /* 定期清理已拾取的收集物，避免长局中 World.loot 无限增长导致
     视野、拾取、AI 搜刮和小地图每帧扫描越来越多。 */
  function compactLoot(dt) {
    lootCompactT += dt;
    if (lootCompactT < 4) return;
    lootCompactT = 0;
    for (let i = World.loot.length - 1; i >= 0; i--) {
      if (World.loot[i].taken) World.loot.splice(i, 1);
    }
  }

  function needsObjectSilhouette(cx, cz, samples) {
    const dx = cx - player.x, dz = cz - player.z;
    if (dx * dx + dz * dz > CFG.VISION.RANGE * CFG.VISION.RANGE) return false;
    let visible = false, wallBlocked = false;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (isVisionLit(s.x, s.z)) visible = true;
      if (!World.los(player.x, player.z, s.x, s.z)) wallBlocked = true;
      if (visible && wallBlocked) return true;
    }
    return false;
  }

  function drawLoot(geo) {
    const mask = R.mask;
    const ov = R.overlay;
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
      /* 不在视野亮区的地面收集物不绘制 3D，也不进入遮挡 / 描边遮罩 */
      if (l.inVision === undefined) l.inVision = lootVisible(l);
      if (!l.inVision) continue;
      const col = tierRgb(l.item ? l.item.tierId : 'common');
      const bob = Math.sin(time + l.x * 0.7) * 0.03;
      const lift = l.dropH || 0;
      const yaw = l.yaw === undefined ? (l.kind === 'canister' ? 0.2 : 0.4) : l.yaw;
      if (l.kind === 'weapon' && l.item && l.item.weaponId !== undefined) {
        /* 武器丢出后直接使用实际枪械建模躺在地上 */
        if (typeof MODELS !== 'undefined' && MODELS.drawGun) {
          MODELS.drawGun(geo, l.item.weaponId, {
            x: l.x, y: 0.12 + lift, z: l.z, yaw: yaw, pitch: 0.04, scale: 0.92
          });
        }
        put({ x: l.x, y: 0.035 + lift, z: l.z, sx: 0.22, sy: 0.025, sz: 1.08, yaw: yaw, color: col, outline: 0, emis: true, shadow: false });
        put({ x: l.x, y: 0.78 + bob + lift, z: l.z, sx: 0.13, sy: 0.13, sz: 0.13, yaw: 0.6, color: col, outline: 0, emis: true, shadow: false });
        if (mask) {
          mask.box({
            x: l.x, y: 0.16 + lift, z: l.z, sx: 0.34, sy: 0.28, sz: 1.25,
            yaw: yaw, color: [1, 1, 1], outline: 0
          });
        }
      } else if (l.kind === 'case') {
        put({ x: l.x, y: 0.24 + bob + lift, z: l.z, sx: 0.62, sy: 0.46, sz: 0.5, yaw: yaw, color: PAL.teal, outline: 0.016, shadow: true });
        put({ x: l.x, y: 0.50 + bob + lift, z: l.z, sx: 0.44, sy: 0.05, sz: 0.3, yaw: yaw, color: col, outline: 0, emis: true });
      } else {
        put({ x: l.x, y: 0.3 + bob + lift, z: l.z, sx: 0.36, sy: 0.6, sz: 0.36, yaw: yaw, color: PAL.gunL, outline: 0.014, shadow: true });
        put({ x: l.x, y: 0.62 + bob + lift, z: l.z, sx: 0.30, sy: 0.06, sz: 0.30, yaw: yaw, color: col, outline: 0, emis: true });
      }
      if (!ov) continue;
      const s = 0.24;
      const samples = [
        { x: l.x, z: l.z },
        { x: l.x + s, z: l.z }, { x: l.x - s, z: l.z },
        { x: l.x, z: l.z + s }, { x: l.x, z: l.z - s }
      ];
      if (!needsObjectSilhouette(l.x, l.z, samples)) continue;
      /* 单个外包盒：保证不会出现物体自己遮挡自己的橙色补片 */
      if (l.kind === 'weapon') {
        ov.box({
          x: l.x, y: 0.16 + lift, z: l.z, sx: 0.36, sy: 0.30, sz: 1.28,
          yaw: yaw, color: [1, 1, 1], outline: 0
        });
      } else if (l.kind === 'case') {
        ov.box({
          x: l.x, y: 0.27 + bob + lift, z: l.z, sx: 0.66, sy: 0.56, sz: 0.54,
          yaw: yaw, color: [1, 1, 1], outline: 0
        });
      } else {
        ov.box({
          x: l.x, y: 0.33 + bob + lift, z: l.z, sx: 0.40, sy: 0.70, sz: 0.40,
          yaw: yaw, color: [1, 1, 1], outline: 0
        });
      }
    }
  }

  function drawChests(geo) {
    const list = World.chests;
    if (!list || !list.length) return;
    const mask = R.mask;
    const ov = R.overlay;
    function maskBox(o) {
      if (!mask) return;
      const m = {};
      for (const k in o) m[k] = o[k];
      m.shadow = false;
      m.castOnly = false;
      mask.box(m);
    }
    const px = player.x, pz = player.z;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.corpse) continue;
      const isW = c.type === 'weapon';
      const bx = c.x, bz = c.z;
      const cdx = bx - px, cdz = bz - pz;
      const cd2 = cdx * cdx + cdz * cdz;
      /* 远处物资箱不画高面数 OBJ：箱体 10m 内 / 武器箱 18m 内用完整模型，
         更远用低模盒子，30m 外直接剔除。箱体网格很大，这一条能省下大量顶点变换。 */
      const fullDist = isW ? 18 : 10;
      if (cd2 > 30 * 30) continue;
      if (cd2 > fullDist * fullDist) {
        if (isW) {
          geo.box({ x: bx, y: 0.16, z: bz, sx: 1.50, sy: 0.28, sz: 0.90, yaw: c.yaw, color: [0.16, 0.18, 0.21], outline: 0.02, shadow: false });
          if (!c.pried) geo.box({ x: bx, y: 0.31, z: bz, sx: 1.52, sy: 0.04, sz: 0.90, yaw: c.yaw, color: [0.43, 0.85, 0.94], outline: 0, emis: true });
        } else {
          geo.box({ x: bx, y: 0.32, z: bz, sx: 1.12, sy: 0.56, sz: 0.78, yaw: c.yaw, color: [0.31, 0.24, 0.16], outline: 0.02, shadow: false });
          if (!c.pried) geo.box({ x: bx, y: 0.60, z: bz, sx: 1.14, sy: 0.06, sz: 0.80, yaw: c.yaw, color: [0.94, 0.69, 0.30], outline: 0, emis: true });
        }
        continue;
      }
      let near = false;
      if (ov) {
        const hx = isW ? 0.78 : 0.60;
        const hz = isW ? 0.46 : 0.38;
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const offs = [[0, 0], [hx, 0], [-hx, 0], [0, hz], [0, -hz]];
        const samples = [];
        for (let k = 0; k < offs.length; k++) {
          samples.push({
            x: bx + cs * offs[k][0] + sn * offs[k][1],
            z: bz - sn * offs[k][0] + cs * offs[k][1]
          });
        }
        near = needsObjectSilhouette(bx, bz, samples);
        if (near) {
          /* 单个外包盒：避免箱盖 / 箱体互相遮挡造成自身纯色补片 */
          ov.box(isW
            ? { x: bx, y: 0.34, z: bz, sx: 1.70, sy: 0.68, sz: 1.04, yaw: c.yaw, color: [1, 1, 1], outline: 0 }
            : { x: bx, y: 0.44, z: bz, sx: 1.28, sy: 0.88, sz: 0.90, yaw: c.yaw, color: [1, 1, 1], outline: 0 });
        }
      }
      const A = (typeof ASSETS !== 'undefined') ? (c.type === 'weapon' ? ASSETS.weaponcrate : ASSETS.chest) : null;
      /* 简易落地阴影 */
      geo.box({
        x: bx, y: 0.03, z: bz, sx: isW ? 1.58 : 1.24, sy: 0.05, sz: isW ? 0.99 : 0.90, yaw: c.yaw,
        color: [0.335, 0.295, 0.285], outline: 0, castOnly: true, shadow: true
      });
      if (A && A.ready) {
        geo.mesh(A.body, { x: bx, y: 0, z: bz, yaw: c.yaw });
        if (!c.pried) {
          /* 箱盖网格同样很重，只有 6m 内才用完整箱盖，远处用一块薄盒代替。 */
          if (cd2 <= 6 * 6) {
            geo.mesh(A.lid, { x: bx, y: 0, z: bz, yaw: c.yaw });
          } else {
            geo.box(isW
              ? { x: bx, y: 0.303, z: bz, sx: 1.52, sy: 0.054, sz: 0.90, yaw: c.yaw, color: [0.135, 0.155, 0.180], outline: 0.012 }
              : { x: bx, y: 0.70, z: bz, sx: 1.16, sy: 0.17, sz: 0.80, yaw: c.yaw, color: [0.16, 0.20, 0.23], outline: 0.014 });
          }
        }
        /* 白描边只用一个外包盒做遮罩：箱体和箱盖是两块相交网格，
           分别写 mask 会在内部接缝处产生不断闪动的白边。 */
        if (mask) {
          maskBox({
            x: bx,
            y: c.pried ? (isW ? 0.125 : 0.31) : (isW ? 0.17 : 0.43),
            z: bz,
            sx: isW ? 1.60 : 1.22,
            sy: c.pried ? (isW ? 0.25 : 0.62) : (isW ? 0.34 : 0.86),
            sz: isW ? 1.85 : 0.87,
            yaw: c.yaw,
            color: [1, 1, 1], outline: 0
          });
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
            /* 武器剪影保留，但按普通受光材质绘制，不再使用发光纯色 */
            putLid(0.17, 0.346, -0.10, 0.64, 0.014, 0.040, [0.56, 0.59, 0.63]);
            putLid(-0.04, 0.346, -0.10, 0.30, 0.016, 0.115, [0.56, 0.59, 0.63]);
            putLid(-0.33, 0.346, -0.10, 0.24, 0.014, 0.095, [0.56, 0.59, 0.63]);
            putLid(-0.17, 0.346, -0.015, 0.065, 0.016, 0.115, [0.44, 0.47, 0.51]);
            putLid(-0.03, 0.346, 0.020, 0.10, 0.018, 0.135, [0.44, 0.47, 0.51]);
            putLid(0.10, 0.346, -0.035, 0.16, 0.014, 0.045, [0.44, 0.47, 0.51]);
            putLid(0, 0.334, -0.34, 1.24, 0.008, 0.045, [0.44, 0.47, 0.51]);
            putLid(0.22, 0.348, -0.155, 0.10, 0.016, 0.030, [1.0, 0.72, 0.26], true);
            putLid(-0.06, 0.350, -0.175, 0.14, 0.020, 0.050, [1.0, 0.72, 0.26], true);
            putLid(0.50, 0.348, -0.10, 0.05, 0.018, 0.060, [1.0, 0.72, 0.26], true);
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

  /* 道具瞄准预览：飞刀直线 / 手榴弹落点圆 / 辐射场范围圆 */
  function drawGadgetAim(geo) {
    if (mode !== 'mission' || player.gadgetAim < 0 || player.dead) return;
    const g = gadgetDef(player.gadgetAim);
    if (!g) return;
    const c = g.rgb;
    const pulse = 0.65 + Math.sin(time * 9) * 0.35;

    if (g.id === 'knife') {
      const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
      let len = g.range;
      const hit = World.rayWallHit(player.x, player.z, dx, dz, g.range);
      if (hit && hit.axis && hit.d < len) len = Math.max(0.4, hit.d - 0.10);
      /* 虚线固定长度：距离越远虚线数量越多，不拉伸单段 */
      const dash = 0.62, gap = 0.34, pitch = dash + gap;
      for (let d = 0; d < len; d += pitch) {
        const dl = Math.min(dash, len - d);
        if (dl < 0.05) break;
        const mid = d + dl * 0.5;
        geo.box({
          x: player.x + dx * mid, y: 0.055, z: player.z + dz * mid,
          sx: 0.30, sy: 0.012, sz: dl,
          yaw: player.yaw, color: c, outline: 0, emis: true
        });
      }
      geo.box({
        x: player.x + dx * len, y: 0.07, z: player.z + dz * len,
        sx: 0.12 + pulse * 0.08, sy: 0.02, sz: 0.55,
        yaw: player.yaw + Math.PI / 2, color: [1, 1, 1], outline: 0, emis: true
      });
    } else if (g.id === 'grenade') {
      const t = player.gadgetTarget;
      /* 最远投掷范围：虚线细环，避免和落点伤害圈混淆 */
      for (let i = 0; i < 48; i += 2) {
        const a0 = i / 48 * Math.PI * 2;
        const a1 = (i + 1) / 48 * Math.PI * 2;
        geo.arc(player.x, player.z, g.range - 0.035, g.range, a0, a1, 0.04,
          [0.46, 0.35, 0.19], 3);
      }
      /* 落点伤害范围 */
      geo.arc(t.x, t.z, g.radius - 0.10, g.radius, 0, Math.PI * 2, 0.07, c, 64);
      geo.arc(t.x, t.z, g.radius * 0.55, g.radius * 0.55 + 0.055, 0, Math.PI * 2, 0.045,
        [0.60, 0.42, 0.20], 48);
      geo.box({
        x: t.x, y: 0.08, z: t.z, sx: 0.22 + pulse * 0.10, sy: 0.02, sz: 0.22 + pulse * 0.10,
        yaw: Math.PI / 4, color: [1, 0.92, 0.70], outline: 0, emis: true
      });
    } else if (g.id === 'radiation') {
      const t = player.gadgetTarget;
      geo.arc(t.x, t.z, g.radius - 0.10, g.radius, 0, Math.PI * 2, 0.07, c, 64);
      geo.arc(t.x, t.z, g.radius * 0.55, g.radius * 0.55 + 0.05, 0, Math.PI * 2, 0.045,
        [0.55, 0.32, 0.20], 48);
    }
  }

  function drawGadgetEffects(geo) {
    for (let i = 0; i < knives.length; i++) {
      const k = knives[i];
      const yaw = Math.atan2(k.dx, k.dz);
      geo.box({
        x: k.x, y: 0.92, z: k.z, sx: 0.055, sy: 0.055, sz: 0.52,
        yaw: yaw, color: k.c, outline: 0, emis: true
      });
      geo.box({
        x: k.x, y: 0.92, z: k.z, sx: 0.16, sy: 0.16, sz: 0.13,
        yaw: yaw, color: [1, 1, 1], outline: 0, emis: true
      });
      geo.box({
        x: k.x - k.dx * 0.45, y: 0.92, z: k.z - k.dz * 0.45,
        sx: 0.035, sy: 0.035, sz: 0.45, yaw: yaw, color: k.c, outline: 0, emis: true
      });
    }

    for (let i = 0; i < grenades.length; i++) {
      const gr = grenades[i];
      const p = Math.min(1, gr.t / gr.dur);
      const y = 0.72 + Math.sin(p * Math.PI) * 1.7;
      geo.box({
        x: gr.x, y: y, z: gr.z, sx: 0.20, sy: 0.24, sz: 0.20,
        yaw: p * 7 + gr.seed, color: [0.26, 0.29, 0.22], outline: 0.012, emis: false
      });
      geo.box({
        x: gr.x, y: y + 0.14, z: gr.z, sx: 0.09, sy: 0.09, sz: 0.09,
        yaw: p * 9, color: gr.c, outline: 0, emis: true
      });
      geo.box({
        x: gr.x - (gr.tx - gr.sx) * 0.04, y: y - 0.08, z: gr.z - (gr.tz - gr.sz) * 0.04,
        sx: 0.10, sy: 0.10, sz: 0.10, yaw: p * 9 + 0.4,
        color: [1, 0.80, 0.38], outline: 0, emis: true
      });
    }

    for (let i = 0; i < blasts.length; i++) {
      const b = blasts[i];
      const fade = Math.max(0, b.t / b.life);
      const burst = 1 - fade;
      const col = [
        b.c[0] * (0.30 + fade * 0.70),
        b.c[1] * (0.30 + fade * 0.70),
        b.c[2] * (0.30 + fade * 0.70)
      ];

      /* 中心爆闪：只做一次短促的方块闪光，不扩散成圆环 */
      const flash = Math.max(0, 1 - burst * 2.8);
      if (flash > 0) {
        const s = 0.35 + flash * 0.85;
        geo.box({
          x: b.x, y: 0.55, z: b.z, sx: s, sy: s * 0.85, sz: s,
          yaw: b.seed, color: [1, 0.94, 0.74], outline: 0, emis: true
        });
      }

      /* 整体外圆：固定半径完整一圈，只淡出，不扩张 */
      geo.arc(b.x, b.z, b.r - 0.10, b.r, 0, Math.PI * 2, 0.065, col, 64);

      /* 火舌 / 碎片柱：位置固定在爆炸范围内，只改变高度和亮度 */
      for (let k = 0; k < 12; k++) {
        const a = b.seed + k * 2.399;
        const rr = b.r * (0.28 + 0.68 * ((k * 0.41) % 1));
        const flick = 0.78 + 0.22 * Math.sin(time * 21 + k * 1.7 + b.seed);
        const h = (0.22 + 1.05 * fade * ((k * 0.23) % 1)) * flick;
        if (h < 0.06) continue;
        geo.box({
          x: b.x + Math.sin(a) * rr, y: 0.05 + h * 0.5, z: b.z + Math.cos(a) * rr,
          sx: 0.18 + (k % 2) * 0.05, sy: h, sz: 0.18 + (k % 2) * 0.05,
          yaw: a, color: k % 2 ? [1, 0.52, 0.20] : b.c, outline: 0, emis: true
        });
      }

      /* 边缘碎屑，固定落点 */
      for (let k = 0; k < 8; k++) {
        const a = b.seed + 0.8 + k * 1.71;
        const rr = b.r * (0.72 + 0.22 * ((k * 0.53) % 1));
        geo.box({
          x: b.x + Math.sin(a) * rr, y: 0.12 + fade * 0.22, z: b.z + Math.cos(a) * rr,
          sx: 0.13, sy: 0.13, sz: 0.13, yaw: a,
          color: k % 2 ? [1, 0.45, 0.16] : [0.95, 0.72, 0.32], outline: 0, emis: true
        });
      }
    }

    for (let i = 0; i < radFields.length; i++) {
      const f = radFields[i];
      const k = Math.max(0.12, Math.min(1, f.life / f.maxLife));
      const pulse = 0.5 + 0.5 * Math.sin(time * 7 + f.seed);
      /* 装置本体 */
      geo.box({
        x: f.x, y: 0.16, z: f.z, sx: 0.30, sy: 0.26, sz: 0.30,
        yaw: f.seed, color: [0.22, 0.25, 0.24], outline: 0.014, emis: false
      });
      geo.box({
        x: f.x, y: 0.34, z: f.z, sx: 0.20, sy: 0.16, sz: 0.20,
        yaw: f.seed, color: f.c, outline: 0, emis: true
      });
      geo.box({
        x: f.x, y: 0.44 + pulse * 0.10, z: f.z, sx: 0.10, sy: 0.10, sz: 0.10,
        yaw: f.seed * 2, color: [1, 0.85, 0.55], outline: 0, emis: true
      });
      /* 范围环 + 上升的辐射粒子 */
      geo.arc(f.x, f.z, f.r - 0.07, f.r, 0, Math.PI * 2, 0.055,
        [f.c[0] * k, f.c[1] * k, f.c[2] * k], 64);
      for (let j = 0; j < 10; j++) {
        const a = f.seed + j * 2.399;
        const rr = f.r * (0.25 + 0.7 * ((j * 0.37 + f.seed * 0.1) % 1));
        const h = (0.20 + 0.65 * ((j * 0.29 + pulse) % 1)) * k;
        geo.box({
          x: f.x + Math.sin(a) * rr, y: 0.05 + h * 0.5, z: f.z + Math.cos(a) * rr,
          sx: 0.13, sy: h, sz: 0.13, yaw: a,
          color: j % 2 ? [0.55, 1.0, 0.52] : f.c, outline: 0, emis: true
        });
      }
    }
  }

  function render() {
    R.setVision({
      x: player.x, z: player.z, yaw: player.headWorldYaw,
      half: CFG.VISION.HALF_DEG * Math.PI / 180,
      range: CFG.VISION.RANGE,
      shade: CFG.VISION.SHADE
    });
    R.begin();
    buildShadowGeo();
    const geo = R.dyn;
    const scene = R.scene || R.dyn;
    const xray = R.xray;
    const ov = R.overlay;
    const um = R.unitMask;

    drawGadgetAim(geo);

    const pStance = MODELS.bodyStance(player.animT, player.sprinting, player.moving, player.sprintBlend);
    pStance.yaw *= player.moveBlend;
    pStance.shift *= player.moveBlend;
    const playerUnit = {
      x: player.x, y: 0, z: player.z, yaw: player.yaw,
      moving: player.moving, animT: player.animT,
      moveYaw: player.moveYaw,
      sprint: player.sprinting,
      headYaw: player.headYaw,
      swayT: player.swayT, moveBlend: player.moveBlend, swayPhase: 0,
      sprintMix: player.sprintBlend,
      bodySway: pStance.yaw, bodyShift: pStance.shift,
      deadT: player.dead ? player.deadT : 0
    };
    MODELS.drawUnit(geo, player.charKey, playerUnit);
    drawPlayerGun(geo, pStance);
    if (um) {
      MODELS.drawUnit(um, player.charKey, playerUnit);
      drawPlayerGun(um, pStance);
    }
    if (ov) {
      const ovUnit = {
        x: player.x, y: 0, z: player.z, yaw: player.yaw,
        moving: player.moving, animT: player.animT, moveYaw: player.moveYaw,
        sprint: player.sprinting, headYaw: player.headYaw,
        swayT: player.swayT, moveBlend: player.moveBlend, swayPhase: 0,
        sprintMix: player.sprintBlend,
        bodySway: pStance.yaw, bodyShift: pStance.shift,
        deadT: player.dead ? player.deadT : 0,
        overlay: true
      };
      MODELS.drawUnit(ov, player.charKey, ovUnit);
      drawPlayerGun(ov, pStance);
    }

    for (const e of enemies) {
      if (e.dead) {
        /* 远处 / 视野外的尸体不画：长局里尸体数量会累积，避免每帧全图渲染。 */
        const cdx = e.x - player.x, cdz = e.z - player.z;
        if (cdx * cdx + cdz * cdz > 34 * 34 || e.inVision !== true) continue;
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
      const eStance = MODELS.bodyStance(e.animT, !!e.carry, e.moving, e.sprintBlend || 0);
      eStance.yaw *= (e.moveBlend || 0);
      eStance.shift *= (e.moveBlend || 0);
      const enemyUnit = {
        x: e.x, y: 0, z: e.z, yaw: e.yaw,
        moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw,
        sprint: !!e.carry,
        swayT: e.swayT || 0, moveBlend: e.moveBlend || 0, swayPhase: e.seed || 0,
        sprintMix: e.sprintBlend || 0,
        bodySway: eStance.yaw, bodyShift: eStance.shift
      };
      MODELS.drawUnit(geo, e.type, enemyUnit);
      drawEnemyGun(geo, e, eStance);
      const eMask = enemyMaskGeo(e);
      if (eMask) {
        MODELS.drawUnit(eMask, e.type, enemyUnit);
        drawEnemyGun(eMask, e, eStance);
      }
      if (ov) {
        const ovUnit = {
          x: e.x, y: 0, z: e.z, yaw: e.yaw,
          moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw,
          sprint: !!e.carry, overlay: true,
          swayT: e.swayT || 0, moveBlend: e.moveBlend || 0, swayPhase: e.seed || 0,
          sprintMix: e.sprintBlend || 0,
          bodySway: eStance.yaw, bodyShift: eStance.shift
        };
        MODELS.drawUnit(ov, e.type, ovUnit);
        drawEnemyGun(ov, e, eStance);
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

    drawLoot(scene);
    drawChests(scene);
    drawGadgetEffects(geo);
    World.drawHouseScene(scene, player.x, player.z);

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

  /* ---------- 训练场配装台 ---------- */
  function trainingPad() {
    return (testMap && World.test && World.test.loadout) ? World.test.loadout : null;
  }

  function nearTrainingPad() {
    const p = trainingPad();
    if (!p) return null;
    const d = Math.hypot(player.x - p.x, player.z - p.z);
    return d <= p.r + 0.7 ? p : null;
  }

  function openTrainingLoadout() {
    if (mode !== 'mission' || ended || !testMap) return;
    Inventory.close();
    cancelGadgetAim();
    setMouseLock(false);
    HUD.setCursorVisible(!TOUCH_MODE);
    trainingOpen = true;
    trainingWeapons = [];
    for (let i = 0; i < player.carried.length && trainingWeapons.length < 2; i++) {
      const wi = player.carried[i].weaponId;
      if (trainingWeapons.indexOf(wi) < 0) trainingWeapons.push(wi);
    }
    trainingGadgets = player.gadgets.filter(Boolean).slice(0, 2);
    player.moving = false;
    mouse.down = false;
    renderTrainingLoadout();
    const box = $('trainingLoadout');
    if (box) box.classList.remove('hidden');
  }

  function closeTrainingLoadout() {
    trainingOpen = false;
    const box = $('trainingLoadout');
    if (box) box.classList.add('hidden');
    HUD.setCursorVisible(false);
  }

  function toggleTrainingWeapon(wi) {
    const at = trainingWeapons.indexOf(wi);
    if (at >= 0) trainingWeapons.splice(at, 1);
    else {
      if (trainingWeapons.length >= 2) trainingWeapons.shift();
      trainingWeapons.push(wi);
    }
    applyTrainingLoadout();
    renderTrainingLoadout();
  }

  function toggleTrainingGadget(id) {
    const at = trainingGadgets.indexOf(id);
    if (at >= 0) trainingGadgets.splice(at, 1);
    else {
      if (trainingGadgets.length >= 2) trainingGadgets.shift();
      trainingGadgets.push(id);
    }
    applyTrainingLoadout();
    renderTrainingLoadout();
  }

  function applyTrainingLoadout() {
    player.carried = trainingWeapons.map(function (wi) {
      return ITEMS.makeWeaponItem(wi);
    }).filter(Boolean);
    player.mags = [];
    player.spares = [];
    for (let i = 0; i < player.carried.length; i++) {
      const w = WEAPONS[player.carried[i].weaponId];
      player.mags.push(w.mag);
      player.spares.push(9);
    }
    player.slot = player.carried.length ? 0 : -1;
    player.weapon = player.carried.length ? player.carried[0].weaponId : -1;
    recalcWeaponMods();
    player.cool = 0;
    player.reload = 0;
    player.gadgets = [trainingGadgets[0] || null, trainingGadgets[1] || null];
    player.gadgetCd = [0, 0];
    player.gadgetAim = -1;
    player.gadgetAimOffset = { x: 0, z: 0 };
    player.gadgetTarget = { x: player.x, z: player.z };
    HUD.buildSlots(player);
    HUD.buildGadgets(player);
    if (player.weapon >= 0) HUD.mag(player.weapon);
    if (TOUCH_MODE && player.weapon >= 0) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
  }

  function renderTrainingLoadout() {
    const wbox = $('trainWeapons');
    const gbox = $('trainGadgets');
    if (wbox) {
      wbox.innerHTML = '';
      WEAPONS.forEach(function (w, wi) {
        const on = trainingWeapons.indexOf(wi) >= 0;
        const b = UI.el('button', 'train-card' + (on ? ' on' : ''));
        b.type = 'button';
        b.style.setProperty('--tc', w.color);
        b.innerHTML =
          '<span class="tc-tag">' + w.tag + '</span>' +
          '<span class="tc-name">' + w.name + '</span>' +
          '<span class="tc-meta">' + w.mag + ' 发 · ' + w.desc + '</span>' +
          '<span class="tc-state">' + (on ? '已装备' : '装备') + '</span>';
        b.addEventListener('click', function () { toggleTrainingWeapon(wi); });
        wbox.appendChild(b);
      });
    }
    if (gbox) {
      gbox.innerHTML = '';
      GADGETS.forEach(function (g) {
        const on = trainingGadgets.indexOf(g.id) >= 0;
        const b = UI.el('button', 'train-card' + (on ? ' on' : ''));
        b.type = 'button';
        b.style.setProperty('--tc', g.color);
        b.innerHTML =
          '<span class="tc-tag">' + g.tag + '</span>' +
          '<span class="tc-name">' + g.name + '</span>' +
          '<span class="tc-meta">训练场无冷却 · ' + g.desc + '</span>' +
          '<span class="tc-state">' + (on ? '已装备' : '装备') + '</span>';
        b.addEventListener('click', function () { toggleTrainingGadget(g.id); });
        gbox.appendChild(b);
      });
    }
  }

  /* 多撤离点：返回离指定位置最近的撤离台 */
  function nearestPad(x, z) {
    const list = (World.pads && World.pads.length) ? World.pads : [World.pad];
    let best = list[0] || { x: x, z: z, r: CFG.EXTRACT_R, hold: CFG.EXTRACT_HOLD };
    let bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
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
      /* 训练场初始空手、无道具；通过配装台选择 */
      entries = [];
    } else if (cfg.weapons !== undefined) {
      const list = Array.isArray(cfg.weapons) ? cfg.weapons : [];
      const mags = Array.isArray(cfg.mags) ? cfg.mags : [];
      entries = list.slice(0, 2).map(function (x, i) {
        if (x === null || x === undefined) return null;
        const item = (typeof x === 'number') ? ITEMS.makeWeaponItem(x) : Grid.cloneItem(x);
        return { item: item, mags: clamp(mags[i] | 0, 0, CFG.CARRY_MAX_MAGS) };
      }).filter(function (e) { return e && e.item && e.item.kind === 'weapon'; });
    } else {
      const lo = Store.loadout();
      entries = [];
      for (let i = 0; i < 2; i++) {
        if (!lo.weapons[i]) continue;
        entries.push({ item: Grid.cloneItem(lo.weapons[i]), mags: lo.mags[i] | 0 });
      }
    }

    seed = (Math.random() * 1e9) | 0;
    const mapId = (!isTest && cfg.mapId) ? cfg.mapId : '';
    const customMap = (mapId && typeof MAPSTORE !== 'undefined') ? MAPSTORE.get(mapId) : null;
    if (isTest) World.genTest(seed);
    else if (customMap) World.loadMap(customMap, seed);
    else World.gen(seed);
    R.buildStatic(function (geo) { World.buildStatic(geo); });
    if (typeof MINIMAP !== 'undefined') MINIMAP.build();

    /* 房屋资产如果晚于场景静态几何加载完成，补一次静态重建 */
    if (typeof ASSETS !== 'undefined' && ASSETS.house && !ASSETS.house.ready) {
      ASSETS.load().then(function () {
        if (mode === 'mission' && World.houses && World.houses.length) {
          R.buildStatic(function (geo) { World.buildStatic(geo); });
          if (typeof MINIMAP !== 'undefined') MINIMAP.build();
        }
      });
    }

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
    player.infiniteData = isTest;
    player.data = isTest ? 999999 : (cfg.data || 0);
    player.inv = [];
    player.sel = null;
    player.looted = 0;
    player.dismantledValue = 0;

    /* 道具只在局外配置；训练场初始不携带，通过配装台选择 */
    const gadgetSrc = isTest
      ? []
      : (Array.isArray(cfg.gadgets) ? cfg.gadgets : Store.loadout().gadgets);
    player.gadgets = [null, null];
    for (let i = 0; i < 2 && i < (gadgetSrc || []).length; i++) {
      const id = gadgetSrc[i];
      if (GADGET_BY_ID[id] && player.gadgets.indexOf(id) < 0) player.gadgets[i] = id;
    }
    player.gadgetCd = [0, 0];
    player.gadgetAim = -1;
    player.gadgetAimOffset = { x: 0, z: 0 };
    trainingWeapons = [];
    trainingGadgets = [];
    closeTrainingLoadout();

    player.x = World.spawn.x;
    player.z = World.spawn.z;
    player.gadgetTarget = { x: player.x, z: player.z };
    player.yaw = World.customMap ? (World.spawnYaw || 0) : (TOUCH_MODE ? Math.PI : 0);
    player.moveYaw = player.yaw;
    player.aimYaw = player.yaw;
    player.headWorldYaw = player.yaw;
    player.headYaw = 0;
    player.aimActive = false;
    player.swayT = 0;
    player.moveBlend = 0;
    player.gunCarryMix = 0;
    player.sprintBlend = 0;
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
    visionClock = 0.08;
    lootVisionClock = 0.1;
    lootCompactT = 0;
    tracers = []; flashes = []; sparks = []; projectiles = [];
    bullets = []; zones = []; beams = []; bolts = []; sonicWaves = []; rings = [];
    knives = []; grenades = []; blasts = []; radFields = [];
    lidDebris = [];
    CAM.pitch = (Q_PITCH >= 30 && Q_PITCH <= 90)
      ? Q_PITCH
      : clamp(Store.raw().settings.pitch || CFG.CAM.PITCH, 30, 90);
    CAM.focus = [player.x, CFG.CAM.HEIGHT_OFF, player.z];
    CAM.eye = [player.x, player.maxShield + 12, player.z + 12];

    enemies = [];
    squads = [];
    if (isTest) {
      spawnTestEnemies();
    } else if (World.customMap) {
      spawnMapEnemies();
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
          state: 'idle', alertT: 0, lostT: 6, waitT: 0, patrol: null,
          lastSeenX: c.x, lastSeenZ: c.z, seen: false, seed: Math.random() * 10,
          swayT: Math.random() * 10, moveBlend: 0, sprintBlend: 0,
          viewR: t === 'spitter' ? 20 : (t === 'gaunt' ? 15 : 16),
          viewHalf: t === 'spitter' ? 1.15 : 0.95,
          path: null, pathGoal: null, pathTime: 0
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

      /* 随机设施里也放一支清剿小队，作为中立第三方 */
      let squadPoint = null;
      for (let k = 0; k < 40; k++) {
        const p = World.randomFloorPoint({ x: player.x, z: player.z }, 24);
        if (World.blocked(p.x, p.z, 0.7)) continue;
        squadPoint = p;
        break;
      }
      if (squadPoint) spawnSquad(squadPoint.x, squadPoint.z, CFG.SQUAD.spawnRadius);
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
    HUD.setCursorVisible(false);
    HUD.hideEnd();
    HUD.data(player.data);
    HUD.prompt(null);
    const pad0 = nearestPad(World.spawn.x, World.spawn.z);
    const d0 = Math.hypot(World.spawn.x - pad0.x, World.spawn.z - pad0.z);
    HUD.objective('撤离点 · ' + Math.round(d0) + ' m', false);
    if (isTest) {
      HUD.objective('测试场 · 靠近配装台按 F 选择装备', false);
      HUD.toast('训练场 · 初始空手 · 配装台按 F 切换武器 / 道具', 'good');
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
    mouse.lastUiLock = false;
    mouse.autoLockPending = !TOUCH_MODE;
    armMouseLock();
    if (QS.get('die') === '1') { player.dead = true; player.deadT = 0.5; }
    flash(380);
  }

  function finishRun(win, reason) {
    if (ended || mode !== 'mission') return;
    closeTrainingLoadout();
    setMouseLock(false);
    mouse.autoLockPending = false;
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
    HUD.setCursorVisible(!TOUCH_MODE);

    const haul = player.inv.reduce(function (s, it) { return s + (it.value || 0); }, 0);
    const itemCount = player.inv.length;
    const t = time;
    let stored = 0, overflow = 0, overflowValue = 0, overflowElements = {};

    if (win) {
      /* 芯片直接存放在每把武器物品上，撤离时随武器一起写回仓库 / 配装 */
      const oldLo = Store.loadout();
      Store.setLoadout({ weapons: player.carried, mags: oldLo.mags, carry: oldLo.carry });
      const r = Store.stashAddMany(player.inv);
      stored = r.stored;
      overflow = r.overflowCount;
      overflowValue = r.overflowValue;
      overflowElements = r.overflowElements || {};
      Store.addBank(player.data);
    } else {
      Store.clearLoadoutWeapons();
    }
    cancelGadgetAim();

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
      overflowElements: overflowElements,
      dismantled: player.dismantledValue,
      contracts: done,
      best: Store.best()
    });
  }

  function toLobby() {
    if (mode === 'lobby') return;
    closeTrainingLoadout();
    setMouseLock(false);
    mouse.autoLockPending = false;
    mouse.lastUiLock = false;
    cancelGadgetAim();
    knives = []; grenades = []; blasts = []; radFields = [];
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
    HUD.setCursorVisible(false);
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

  /* 自定义地图刷怪：按设计点生成，半径内随机散开，避免重叠在墙里 */
  function spawnMapEnemies() {
    enemies = [];
    squads = [];
    const list = World.enemySpawns || [];
    const gunners = { scav: 1, raider: 1, veteran: 1 };
    const scavSkins = ['scav', 'raider', 'veteran'];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s) continue;
      const count = Math.max(1, Math.min(40, s.count | 0));
      const radius = Math.max(0, s.radius || 0);
      if (s.type === 'squad') {
        for (let k = 0; k < count; k++) spawnSquad(s.x, s.z, radius || CFG.SQUAD.spawnRadius);
        continue;
      }
      for (let k = 0; k < count; k++) {
        let px = s.x, pz = s.z;
        for (let t = 0; t < 16; t++) {
          const a = Math.random() * Math.PI * 2;
          const d = radius * Math.sqrt(Math.random());
          const tx = s.x + Math.cos(a) * d;
          const tz = s.z + Math.sin(a) * d;
          if (!World.blocked(tx, tz, 0.5)) { px = tx; pz = tz; break; }
        }
        let e;
        if (gunners[s.type]) {
          /* 地图编辑器里只保留「拾荒者」一个类别；每次生成随机挑一个皮肤 */
          const skin = scavSkins[Math.floor(Math.random() * scavSkins.length)];
          e = makeGunner(skin, px, pz);
          if (s.faction === 'undead') e.faction = 'undead';
        } else {
          e = makeUndead(s.type, px, pz);
          if (s.faction) e.faction = s.faction;
        }
        enemies.push(e);
      }
    }
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
    $('resumeBtn').addEventListener('click', function () {
      setPause(false);
      armMouseLock();
    });
    $('abandonBtn').addEventListener('click', function () { finishRun(false, 'abandon'); });
    const trainClose = $('trainClose');
    if (trainClose) trainClose.addEventListener('click', function () {
      closeTrainingLoadout();
      armMouseLock();
    });

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
      data: 500, character: Store.char(),
      mapId: QS.get('map') || undefined
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
    throwBackpackItem: throwBackpackItem,
    throwEquippedWeapon: throwEquippedWeapon,
    weaponChips: weaponChipList,
    weaponMods: modsOf,
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
    offscreenEnemyMarkers: offscreenEnemyMarkers,
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
      finishReload: finishReload,
      aimGadget: startGadgetAim,
      useGadget: function (slot) {
        if (player.gadgetAim !== slot) startGadgetAim(slot);
        return player.gadgetAim === slot ? useGadget(slot) : false;
      },
      screenGround: function (x, y) { return screenToGround(x, y, 0); },
      clampGrenade: function (x, z) {
        return clampGrenadeTarget(x, z, GADGET_BY_ID.grenade.range);
      }
    },
    state: {
      player: player,
      cam: CAM,
      get enemies() { return enemies; },
      get beams() { return beams; },
      get knives() { return knives; },
      get grenades() { return grenades; },
      get radFields() { return radFields; },
      get blasts() { return blasts; },
      get lidDebris() { return lidDebris; },
      get time() { return time; },
      get kills() { return kills; },
      get looted() { return looted; }
    }
  };
})();
