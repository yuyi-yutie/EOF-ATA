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
  let paused = false;
  let ended = false;
  let mode = 'lobby';           // 'lobby' | 'mission'
  let endReason = '';

  const CAM = {
    pitch: CFG.CAM.PITCH,
    dist: CFG.CAM.DIST,
    presets: [45, 55, 62, 70],
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
    shieldTimer: 0, stamTimer: 0, dead: false, deadT: 0,
    mags: [], spares: [],
    data: 0, inv: [], sel: null, invRows: CFG.INV_ROWS,
    kit: { medkit: 0, battery: 0 },
    looted: 0, dismantledValue: 0,
    extractT: 0, extracted: false, reloadMul: 1,
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
  let bolts = [];         // 电弧链
  let cones = [];         // 声学冲击锥
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

    const p = CAM.pitch * Math.PI / 180;
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

  /* ---------- 战斗 ---------- */
  function switchSlot(s) {
    if (s < 0 || s >= player.carried.length || s === player.slot) return;
    player.slot = s;
    player.weapon = player.carried[s];
    player.cool = Math.max(player.cool, 0.25);
    player.reload = 0;
    HUD.mag(player.weapon);
    HUD.updateSlots(player);
    if (TOUCH_MODE) TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
  }

  let lastDryT = -9;
  function startReload() {
    const w = WEAPONS[player.weapon];
    if (player.reload > 0) return;
    if (player.mags[player.weapon] >= w.mag) return;
    if (player.spares[player.weapon] <= 0) {
      if (time - lastDryT > 1.2) {
        lastDryT = time;
        HUD.toast('没有备弹 · 打开背包压装弹夹', 'warn');
      }
      return;
    }
    player.reload = w.reload * player.reloadMul;
  }

  function finishReload() {
    const wi = player.weapon;
    const w = WEAPONS[wi];
    if (player.spares[wi] <= 0) return;
    /* 备弹按「整夹」计算：换弹丢掉当前弹夹余弹，装入一整个满夹 */
    player.spares[wi]--;
    player.mags[wi] = w.mag;
    HUD.updateSlots(player);
  }

  /* 枪口位置：和右手持枪的位置对齐，子弹从这里出去 */
  function muzzle() {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    return {
      x: player.x + fx * 0.80 + rx * 0.18,
      y: 0.78,
      z: player.z + fz * 0.80 + rz * 0.18
    };
  }

  function fire() {
    const wi = player.weapon;
    const w = WEAPONS[wi];
    if (player.cool > 0 || player.reload > 0 || player.dead) return;
    if (player.mags[wi] <= 0) {
      if (player.spares[wi] <= 0) {
        if (time - lastDryT > 1.4) {
          lastDryT = time;
          HUD.toast('弹夹已空 · 打开背包压装弹夹', 'warn');
        }
      } else {
        startReload();
      }
      return;
    }

    player.mags[wi]--;
    player.cool = w.rate;
    player.recoil = 1;
    shake = Math.min(2.2, shake + (w.kick || 0.6) * 0.85);
    fovPunch = Math.min(3.2, fovPunch + (w.kick || 0.6) * 1.5);
    noise(player.x, player.z, w.id === 'sonic' ? 18 : 12);

    const m = muzzle();
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.06, s: 0.34 + w.recoil * 0.16, c: w.rgb2 });
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.1, s: 0.18, c: [1, 0.97, 0.88] });

    if (w.id === 'sonic') fireCone(w, m);
    else if (w.id === 'laser') fireLaser(w, m);
    else fireBullet(w, m);

    HUD.mag(wi);
    HUD.updateSlots(player);
  }

  /* ---------- 声学：瞬时锥形冲击 ---------- */
  function fireCone(w, m) {
    const half = (w.halfAngle || 33) * Math.PI / 180;
    cones.push({ x: m.x, z: m.z, ang: player.yaw, half: half, range: w.range, t: 0.26, c: w.rgb2 });
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - m.x, dz = e.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + e.r) continue;
      const a = Math.atan2(dx, dz);
      if (Math.abs(angDiff(a, player.yaw)) > half + Math.atan2(e.r, Math.max(d, 1))) continue;
      if (!World.los(m.x, m.z, e.x, e.z)) continue;
      const t = clamp(d / w.range, 0, 1);
      damageEnemy(e, lerp(w.dmg, w.dmgFar, t), a);
      HUD.hit();
    }
    sparks.push({ x: m.x, y: m.y, z: m.z, t: 0.2, c: w.rgb2, s: 0.32 });
  }

  /* ---------- 光学：折线激光，最多弹射 ---------------- */
  function fireLaser(w, m) {
    const maxB = w.bounce === undefined ? 3 : w.bounce;
    const falloff = w.falloff || 0.85;
    const pts = [{ x: m.x, z: m.z }];
    let px = m.x, pz = m.z, a = player.yaw;
    let remain = w.range;

    for (let b = 0; b <= maxB; b++) {
      let dx = Math.sin(a), dz = Math.cos(a);
      const d = Math.min(remain, World.rayWall(px, pz, dx, dz, remain, 0.1));
      const ex = px + dx * d, ez = pz + dz * d;
      pts.push({ x: ex, z: ez });

      let hitAny = false;
      for (const e of enemies) {
        if (e.dead) continue;
        if (segDist(e.x, e.z, px, pz, ex, ez) > e.r + 0.16) continue;
        damageEnemy(e, w.dmg * Math.pow(falloff, b), Math.atan2(e.x - px, e.z - pz));
        HUD.hit();
        sparks.push({ x: e.x, y: 1.05, z: e.z, t: 0.16, c: w.rgb2, s: 0.22 });
        hitAny = true;
      }
      if (hitAny) break;

      remain -= d;
      if (remain <= 0.5 || d < 0.15) break;

      const bx = ex - dx * 0.3, bz = ez - dz * 0.3;
      const hitX = !World.isFloorAt(bx + dx * 0.45, bz);
      const hitZ = !World.isFloorAt(bx, bz + dz * 0.45);
      if (!hitX && !hitZ) break;
      if (hitX) dx = -dx;
      if (hitZ) dz = -dz;
      a = Math.atan2(dx, dz);
      px = bx + dx * 0.12;
      pz = bz + dz * 0.12;
      sparks.push({ x: ex, y: 1.0, z: ez, t: 0.16, c: w.rgb2, s: 0.26 });
    }
    beams.push({ pts: pts, t: 0.24, c: w.rgb2 });
  }

  /* ---------- 热学 / 力学 / 电学：实体弹 ---------- */
  function fireBullet(w, m) {
    const speed = w.speed || 46;
    bullets.push({
      kind: w.id, x: m.x, z: m.z, y: 1.0,
      vx: Math.sin(player.yaw) * speed,
      vz: Math.cos(player.yaw) * speed,
      dmg: w.dmg, dmgFar: w.dmgFar, range: w.range,
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
    sparks.push({ x: b.x, y: 1.0, z: b.z, t: 0.2, c: b.c, s: 0.24 });
    if (b.kind === 'thermal') spawnZone(b.x, b.z, b.c);
  }

  function spawnZone(x, z, c) {
    const w = WEAPONS[2];
    zones.push({
      x: x, z: z, r: w.zoneR || 3.1, life: w.zoneLife || 3.2,
      tick: 0, dps: (w.tickDmg || 3.5) * 4, c: c || w.rgb2
    });
  }

  function hitBullet(b, e) {
    const w = WEAPONS[player.weapon];
    const t = clamp(b.travelled / b.range, 0, 1);
    const dmg = lerp(b.dmg, b.dmgFar, t);
    const a = Math.atan2(e.x - b.x, e.z - b.z);
    damageEnemy(e, dmg, a);
    HUD.hit();
    b.dead = true;
    sparks.push({ x: b.x, y: 1.02, z: b.z, t: 0.2, c: b.c, s: 0.26 });

    if (b.kind === 'thermal') {
      spawnZone(e.x, e.z, b.c);
    } else if (b.kind === 'voltaic') {
      const mul = w.chainMul || [0.6, 0.4, 0.25];
      const maxN = w.chainMax || 3;
      const used = [e];
      let src = e;
      for (let i = 0; i < maxN && i < mul.length; i++) {
        let best = null, bd = w.chainR || 6;
        for (const o of enemies) {
          if (o.dead || used.indexOf(o) >= 0) continue;
          const d = Math.hypot(o.x - src.x, o.z - src.z);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best) break;
        bolts.push({ x0: src.x, z0: src.z, x1: best.x, z1: best.z, t: 0.16, c: b.c });
        damageEnemy(best, dmg * mul[i], Math.atan2(best.x - src.x, best.z - src.z));
        used.push(best);
        src = best;
      }
    }
  }

  /* 枪声惊动附近的敌人 */
  function noise(x, z, radius) {
    for (const e of enemies) {
      if (e.dead || e.state === 'chase' || e.state === 'attack') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < radius) {
        e.state = 'alert';
        e.alertT = 0.55;
        e.lastSeenX = x; e.lastSeenZ = z;
      }
    }
  }

  function damageEnemy(e, dmg, ang) {
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (e.state !== 'chase' && e.state !== 'attack') {
      e.state = 'alert'; e.alertT = 0.35;
      e.lastSeenX = player.x; e.lastSeenZ = player.z;
    }
    if (e.hp <= 0) {
      e.dead = true;
      kills++;
      if (e.type === 'spitter') spittersKilled++;
      HUD.kills(kills);
      HUD.hit(true);
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

  function tryLoot() {
    if (mode !== 'mission' || ended || paused) return;
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
  function canSee(e, d) {
    if (d > e.viewR) return false;
    if (!World.los(e.x, e.z, player.x, player.z)) return false;
    if (d < 3.0) return true;
    const ang = Math.atan2(player.x - e.x, player.z - e.z);
    return Math.abs(angDiff(e.yaw, ang)) < e.viewHalf;
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
    const nx = e.x + ux * speed * dt;
    const nz = e.z + uz * speed * dt;
    if (!World.blocked(nx, e.z, e.r)) e.x = nx;
    if (!World.blocked(e.x, nz, e.r)) e.z = nz;
    e.yaw = angLerp(e.yaw, Math.atan2(ux, uz), 1 - Math.exp(-9 * dt));
    e.moving = true;
    e.animT += dt;
    return false;
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead) { e.fade -= dt; continue; }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.cd = Math.max(0, e.cd - dt);

      const dx = player.x - e.x, dz = player.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const sees = !player.dead && canSee(e, d);

      if (sees) {
        e.lastSeenX = player.x;
        e.lastSeenZ = player.z;
        e.lostT = 0;
        e.seen = true;
      } else {
        e.lostT += dt;
        e.seen = false;
      }

      if (sees && (e.state === 'idle' || e.state === 'patrol')) {
        e.state = 'alert';
        e.alertT = 0.4;
      }

      e.moving = false;

      if (e.state === 'alert') {
        e.alertT -= dt;
        e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-14 * dt));
        if (e.alertT <= 0) e.state = 'chase';
      } else if (e.state === 'chase' || e.state === 'attack') {
        const tx = sees ? player.x : e.lastSeenX;
        const tz = sees ? player.z : e.lastSeenZ;
        const td = Math.hypot(tx - e.x, tz - e.z);
        const reach = e.type === 'spitter' ? 8.5 : (e.r + CFG.PLAYER.r + 0.35);

        if (e.type === 'spitter') {
          if (td > 9) stepTo(e, tx, tz, e.speed, dt);
          else if (td < 5) stepTo(e, e.x - ux * 2, e.z - uz * 2, e.speed * 0.8, dt);
          else { e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt)); }
          if (sees && e.cd <= 0 && td < 17) {
            e.cd = CFG.ENEMY.spitter.cd;
            projectiles.push({
              x: e.x + ux * 0.6, y: 1.15, z: e.z + uz * 0.6,
              vx: ux * 12, vz: uz * 12, life: 3, dmg: CFG.ENEMY.spitter.dmg
            });
            flashes.push({ x: e.x + ux * 0.7, y: 1.3, z: e.z + uz * 0.7, yaw: Math.atan2(ux, uz), t: 0.08, s: 0.22 });
          }
        } else {
          if (td > reach) stepTo(e, tx, tz, e.speed, dt);
          else {
            e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
            if (sees && e.cd <= 0 && d < reach + 0.5) {
              e.cd = e.cdMax;
              damagePlayer(e.dmg);
              e.lunge = 0.18;
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

      if (e.lunge) e.lunge = Math.max(0, e.lunge - dt);

      for (const o of enemies) {
        if (o === e || o.dead) continue;
        const ox = e.x - o.x, oz = e.z - o.z;
        const od = Math.hypot(ox, oz);
        const mn = e.r + o.r;
        if (od > 0.0001 && od < mn) {
          const push = (mn - od) * 0.5;
          e.x += ox / od * push; e.z += oz / od * push;
        }
      }
    }
    enemies = enemies.filter(function (e) { return !(e.dead && e.fade <= 0); });
  }

  /* ---------- 交互提示 ---------- */
  let promptT = 0;
  function updatePrompt(dt) {
    promptT -= dt;
    if (promptT > 0) return;
    promptT = 0.12;

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
  function update(dt) {
    if (mode !== 'mission' || ended) return;
    if (paused) return;
    time += dt;

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

    let ix = 0, iz = 0, touchRun = false;
    const tl = TOUCH.left;
    if (TOUCH_MODE && tl.active && tl.mag > TOUCH_DEAD) {
      ix = tl.x;
      iz = tl.y;
      touchRun = tl.zone !== 'inner';
    } else {
      if (keys.KeyW) iz -= 1;
      if (keys.KeyS) iz += 1;
      if (keys.KeyA) ix -= 1;
      if (keys.KeyD) ix += 1;
    }
    const mag = Math.hypot(ix, iz);
    player.moving = (mag > 0 || WALK) && !player.dead;
    if (mag > 0) player.moveYaw = Math.atan2(ix, iz);
    if (!isNaN(MV)) player.moveYaw = player.yaw + MV * Math.PI / 180;
    const wantSprint = (TOUCH_MODE && tl.active && tl.mag > TOUCH_DEAD)
      ? touchRun
      : !!(keys.ShiftLeft || keys.ShiftRight);
    player.sprinting = wantSprint && player.stam > 1 && player.moving;

    let speed = player.sprinting ? CFG.PLAYER.run : CFG.PLAYER.walk;
    if (player.dead) speed = 0;
    if (invOpen) speed *= 0.55;
    if (mag > 0) { ix /= mag; iz /= mag; }

    if (player.sprinting) {
      player.stam = Math.max(0, player.stam - CFG.PLAYER.stamDrain * dt);
      player.stamTimer = CFG.PLAYER.stamDelay;
    } else {
      player.stamTimer = Math.max(0, player.stamTimer - dt);
      if (player.stamTimer <= 0) player.stam = Math.min(CFG.PLAYER.stam, player.stam + CFG.PLAYER.stamRegen * dt);
    }

    const nx = player.x + ix * speed * dt;
    const nz = player.z + iz * speed * dt;
    if (!World.blocked(nx, player.z, CFG.PLAYER.r)) player.x = nx;
    if (!World.blocked(player.x, nz, CFG.PLAYER.r)) player.z = nz;

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
    const curW = WEAPONS[player.weapon];
    if (TOUCH_MODE) {
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
    }
    projectiles = projectiles.filter(function (p) { return p.life > 0; });

    for (const b of bullets) {
      if (b.dead) continue;
      const dist = Math.hypot(b.vx, b.vz) * dt;
      const n = Math.max(1, Math.ceil(dist / 0.22));
      const sx = b.vx * dt / n, sz = b.vz * dt / n;
      for (let i = 0; i < n && !b.dead; i++) {
        b.x += sx; b.z += sz;
        b.travelled += Math.hypot(sx, sz);
        if (!World.isFloorAt(b.x, b.z)) {
          b.dead = true;
          bulletImpact(b);
          break;
        }
        for (const e of enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - b.x, e.z - b.z) < e.r + b.r) { hitBullet(b, e); break; }
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
            damageEnemy(e, z.dps * 0.25, Math.atan2(e.x - z.x, e.z - z.z));
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
    for (const c of cones) c.t -= dt;
    cones = cones.filter(function (c) { return c.t > 0; });
    for (const r of rings) r.t -= dt;
    rings = rings.filter(function (r) { return r.t > 0; });

    /* 撤离 */
    const dp = Math.hypot(player.x - World.pad.x, player.z - World.pad.z);
    if (dp < World.pad.r && !player.dead) {
      player.extractT += dt;
      HUD.extract(player.extractT / CFG.EXTRACT_HOLD);
      if (player.extractT >= CFG.EXTRACT_HOLD) {
        player.extracted = true;
        finishRun(true, 'extract');
      }
    } else if (player.extractT > 0) {
      player.extractT = Math.max(0, player.extractT - dt * 2);
      HUD.extract(player.extractT / CFG.EXTRACT_HOLD);
    }

    if (player.dead) player.deadT += dt;
    updatePrompt(dt);
    HUD.vitals();
    HUD.data(player.data);
  }

  /* ---------- 渲染 ---------- */
  function drawLoot(geo) {
    for (const l of World.loot) {
      if (l.taken) continue;
      const col = tierRgb(l.item ? l.item.tierId : 'common');
      const bob = Math.sin(time + l.x * 0.7) * 0.03;
      if (l.kind === 'case') {
        geo.box({ x: l.x, y: 0.24 + bob, z: l.z, sx: 0.62, sy: 0.46, sz: 0.5, yaw: 0.4, color: PAL.teal, outline: 0.016, shadow: true });
        geo.box({ x: l.x, y: 0.50 + bob, z: l.z, sx: 0.44, sy: 0.05, sz: 0.3, yaw: 0.4, color: col, outline: 0, emis: true });
      } else {
        geo.box({ x: l.x, y: 0.3 + bob, z: l.z, sx: 0.36, sy: 0.6, sz: 0.36, yaw: 0.2, color: PAL.gunL, outline: 0.014, shadow: true });
        geo.box({ x: l.x, y: 0.62 + bob, z: l.z, sx: 0.30, sy: 0.06, sz: 0.30, yaw: 0.2, color: col, outline: 0, emis: true });
      }
    }
  }

  function render() {
    R.begin();
    const geo = R.dyn;

    MODELS.drawUnit(geo, player.charKey, {
      x: player.x, y: 0, z: player.z, yaw: player.yaw,
      moving: player.moving, animT: player.animT,
      moveYaw: player.moveYaw,
      deadT: player.dead ? player.deadT : 0
    });

    const gy = 0.74 - player.recoil * 0.03;
    const gx = player.x + Math.sin(player.yaw + Math.PI / 2) * 0.20;
    const gz = player.z + Math.cos(player.yaw + Math.PI / 2) * 0.20;
    if (!player.dead) {
      MODELS.drawGun(geo, player.weapon, {
        x: gx + Math.sin(player.yaw) * 0.32,
        y: gy,
        z: gz + Math.cos(player.yaw) * 0.32,
        yaw: player.yaw, scale: 1.15
      });
    }

    for (const e of enemies) {
      if (e.dead) {
        MODELS.drawUnit(geo, e.type, {
          x: e.x, y: 0, z: e.z, yaw: e.yaw,
          animT: e.animT, deadT: Math.max(0, 1.1 - e.fade)
        });
        continue;
      }
      MODELS.drawUnit(geo, e.type, {
        x: e.x, y: 0, z: e.z, yaw: e.yaw,
        moving: e.moving, animT: e.animT, lunge: e.lunge, moveYaw: e.yaw
      });
      if (e.hitFlash > 0) {
        const hf = e.hitFlash / 0.12;
        geo.box({
          x: e.x, y: MODELS.height(e.type) * 0.45, z: e.z,
          sx: 0.52 * hf, sy: MODELS.height(e.type) * 0.9 * hf, sz: 0.52 * hf,
          yaw: e.yaw, color: [1, 0.95, 0.9], outline: 0, emis: true
        });
      }
      if (e.state === 'alert' || e.state === 'chase' || e.state === 'attack') {
        const c = e.state === 'alert' ? [1.0, 0.82, 0.25] : [1.0, 0.26, 0.20];
        const bob = Math.sin(time * 7 + e.seed) * 0.05;
        geo.box({
          x: e.x, y: MODELS.height(e.type) + 0.30 + bob, z: e.z,
          sx: 0.13, sy: 0.13, sz: 0.13, yaw: time * 3,
          color: c, outline: 0, emis: true
        });
      }
    }

    drawLoot(geo);

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
      geo.box({ x: b.x, y: b.y, z: b.z, sx: 0.14, sy: 0.14, sz: 0.26, yaw: yaw, color: b.c, outline: 0, emis: true });
      const sp = Math.hypot(b.vx, b.vz);
      const tl = b.kind === 'kinetic' ? 1.5 : 0.9;
      geo.box({
        x: b.x - b.vx / sp * tl * 0.5, y: b.y, z: b.z - b.vz / sp * tl * 0.5,
        sx: b.kind === 'thermal' ? 0.22 : 0.09, sy: b.kind === 'thermal' ? 0.22 : 0.09, sz: tl,
        yaw: yaw, color: b.c, outline: 0, emis: true
      });
    }

    for (const bm of beams) {
      for (let i = 1; i < bm.pts.length; i++) {
        const p0 = bm.pts[i - 1], p1 = bm.pts[i];
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        geo.box({
          x: (p0.x + p1.x) / 2, y: 1.02, z: (p0.z + p1.z) / 2,
          sx: 0.16, sy: 0.16, sz: len, yaw: Math.atan2(dx, dz),
          color: bm.c, outline: 0, emis: true
        });
        geo.box({
          x: (p0.x + p1.x) / 2, y: 1.02, z: (p0.z + p1.z) / 2,
          sx: 0.05, sy: 0.05, sz: len, yaw: Math.atan2(dx, dz),
          color: [1, 1, 1], outline: 0, emis: true
        });
      }
    }

    for (const bo of bolts) {
      const dx = bo.x1 - bo.x0, dz = bo.z1 - bo.z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const yaw = Math.atan2(dx, dz);
      for (let k = 0; k < 3; k++) {
        const f = k / 3;
        const jx = (Math.random() - 0.5) * 0.28, jz = (Math.random() - 0.5) * 0.28;
        geo.box({
          x: bo.x0 + dx * f + dx * 0.16 + jx, y: 1.04 + (Math.random() - 0.5) * 0.2, z: bo.z0 + dz * f + dz * 0.16 + jz,
          sx: 0.055, sy: 0.055, sz: len / 3,
          yaw: yaw, color: bo.c, outline: 0, emis: true
        });
      }
    }

    for (const c of cones) {
      const k = clamp(c.t / 0.26, 0, 1);
      const a0 = c.ang - c.half, a1 = c.ang + c.half;
      const seg = 20;
      const R = c.range * (0.5 + 0.5 * (1 - k));
      for (let i = 0; i < seg; i++) {
        const t0 = a0 + (a1 - a0) * (i / seg);
        const t1 = a0 + (a1 - a0) * ((i + 1) / seg);
        const x0 = c.x + Math.sin(t0) * R, z0 = c.z + Math.cos(t0) * R;
        const x1 = c.x + Math.sin(t1) * R, z1 = c.z + Math.cos(t1) * R;
        geo.tri(c.x, c.z, x0, z0, x1, z1, 0.05, c.c, true);
        geo.tri(c.x, c.z, x1, z1, x0, z0, 0.05, c.c, true);
      }
      const R2 = Math.min(c.range, R + 1.2);
      for (let i = 0; i < seg; i++) {
        const t0 = a0 + (a1 - a0) * (i / seg);
        const t1 = a0 + (a1 - a0) * ((i + 1) / seg);
        const ax = c.x + Math.sin(t0) * R, az = c.z + Math.cos(t0) * R;
        const bx = c.x + Math.sin(t1) * R, bz = c.z + Math.cos(t1) * R;
        const cx2 = c.x + Math.sin(t1) * R2, cz2 = c.z + Math.cos(t1) * R2;
        const dx2 = c.x + Math.sin(t0) * R2, dz2 = c.z + Math.cos(t0) * R2;
        geo.tri(ax, az, bx, bz, cx2, cz2, 0.055, [1, 0.95, 0.8], true);
        geo.tri(ax, az, cx2, cz2, dx2, dz2, 0.055, [1, 0.95, 0.8], true);
      }
      const core = 0.5 * (1 - k) + 0.2;
      geo.box({ x: c.x, y: 0.18, z: c.z, sx: core, sy: 0.36, sz: core, yaw: c.ang, color: c.c, outline: 0, emis: true });
    }

    for (const z of zones) {
      const k = clamp(z.life / 0.6, 0, 1);
      const r2 = z.r * 2;
      const th = 0.16;
      geo.box({ x: z.x, y: 0.05, z: z.z - z.r, sx: r2, sy: 0.02, sz: th, color: z.c, outline: 0, emis: true });
      geo.box({ x: z.x, y: 0.05, z: z.z + z.r, sx: r2, sy: 0.02, sz: th, color: z.c, outline: 0, emis: true });
      geo.box({ x: z.x - z.r, y: 0.05, z: z.z, sx: th, sy: 0.02, sz: r2, color: z.c, outline: 0, emis: true });
      geo.box({ x: z.x + z.r, y: 0.05, z: z.z, sx: th, sy: 0.02, sz: r2, color: z.c, outline: 0, emis: true });
      const pulse = 0.35 + Math.sin(time * 9) * 0.12;
      geo.box({ x: z.x, y: 0.12, z: z.z, sx: pulse * k, sy: 0.3, sz: pulse * k, yaw: time * 2, color: z.c, outline: 0, emis: true });
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
    R.begin();
    const geo = R.dyn;
    const sway = Math.sin(lobbyT * 0.45) * 0.28;
    const charKey = Store.char() === 1 ? 'assault' : 'scout';
    MODELS.drawUnit(geo, charKey, {
      x: 0, y: 0.06, z: 0, yaw: 0.35 + sway,
      moving: false, animT: lobbyT, moveYaw: 0
    });
    Hangar.drawDynamic(geo, lobbyT);
    R.end();
  }

  /* ---------- 出击 / 结算 / 回大厅 ---------- */
  function beginMission(cfg) {
    if (mode === 'mission') return;
    cfg = cfg || {};
    const weapons = (cfg.weapons && cfg.weapons.length === 2) ? cfg.weapons.slice() : Store.loadout().weapons.slice();
    const magCfg = cfg.mags || Store.loadout().mags;

    seed = (Math.random() * 1e9) | 0;
    World.gen(seed);
    R.buildStatic(function (geo) { World.buildStatic(geo); });

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
    player.reloadMul = Store.reloadMul();
    player.invRows = Store.invRows();
    player.charKey = (cfg.character !== undefined ? cfg.character : Store.char()) === 1 ? 'assault' : 'scout';

    player.carried = weapons.slice();
    player.slot = 0;
    player.weapon = player.carried[0];
    player.mags = WEAPONS.map(function () { return 0; });
    player.spares = WEAPONS.map(function () { return 0; });
    for (let s = 0; s < 2; s++) {
      const wi = player.carried[s];
      const w = WEAPONS[wi];
      const n = clamp(magCfg[s] | 0, 0, CFG.CARRY_MAX_MAGS);
      if (n > 0) {
        player.mags[wi] = w.mag;
        player.spares[wi] = Math.min(w.maxSpare, n - 1);
      }
    }
    player.data = cfg.data || 0;
    player.inv = [];
    player.sel = null;
    player.looted = 0;
    player.dismantledValue = 0;
    player.kit = { medkit: Store.kit().medkit, battery: Store.kit().battery };

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
    bullets = []; zones = []; beams = []; bolts = []; cones = []; rings = [];
    CAM.pitch = (Q_PITCH >= 30 && Q_PITCH <= 85)
      ? Q_PITCH
      : clamp(Store.raw().settings.pitch || CFG.CAM.PITCH, 30, 85);
    CAM.focus = [player.x, CFG.CAM.HEIGHT_OFF, player.z];
    CAM.eye = [player.x, player.maxShield + 12, player.z + 12];

    enemies = [];
    const types = ['zombie', 'zombie', 'zombie', 'gaunt', 'spitter'];
    for (let i = 0; i < CFG.ENEMY_COUNT; i++) {
      const c = i < CFG.NEAR_SPAWN ? spawnNear(player.x, player.z, 7, 15)
        : World.randomFloorPoint({ x: player.x, z: player.z }, CFG.SPAWN_MIN);
      const t = types[i % types.length];
      const ecfg = CFG.ENEMY[t];
      enemies.push({
        x: c.x, z: c.z, home: { x: c.x, z: c.z }, type: t,
        hp: ecfg.hp, maxHp: ecfg.hp, r: ecfg.r, speed: ecfg.speed, dmg: ecfg.dmg,
        cd: 0, cdMax: ecfg.cd, yaw: Math.random() * 6.28, animT: 0,
        moving: false, dead: false, fade: 1.1, hitFlash: 0, lunge: 0,
        state: 'idle', alertT: 0, lostT: 0, waitT: 0, patrol: null,
        lastSeenX: c.x, lastSeenZ: c.z, seen: false, seed: Math.random() * 10,
        viewR: t === 'spitter' ? 20 : (t === 'gaunt' ? 15 : 16),
        viewHalf: t === 'spitter' ? 1.15 : 0.95
      });
    }

    mode = 'mission';
    ended = false;
    endReason = '';
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
    HUD.toast('进入设施 · 搜刮物资并寻找撤离台', 'good');
    setPause(false);
    if (TOUCH_MODE) {
      touchInvSuspended = false;
      TOUCH.reset();
      TOUCH.setAuto(!!WEAPONS[player.weapon].auto);
      if (!SELFTEST && isPortrait()) setPause(true);
    }
    if (QS.get('die') === '1') { player.dead = true; player.deadT = 0.5; }
    flash(380);
  }

  function finishRun(win, reason) {
    if (ended || mode !== 'mission') return;
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
      const r = Store.stashAddMany(player.inv);
      stored = r.stored;
      overflow = r.overflowCount;
      overflowValue = r.overflowValue;
      Store.addBank(player.data);
      Store.setKit(player.kit);
    } else {
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
    if (TOUCH_MODE) TOUCH.setEnabled(false);
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
        const root = document.documentElement;
        const status = $('rotateStatus');
        const note = function (s) { if (status) status.textContent = s; };
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        const lock = (screen.orientation && screen.orientation.lock)
          ? function () { return screen.orientation.lock('landscape'); }
          : null;

        try {
          const fs = req ? req.call(root) : null;
          if (fs && fs.then) {
            fs.then(function () {
              if (lock) return lock();
            }).catch(function () {});
          } else if (lock) {
            const p = lock();
            if (p && p.catch) p.catch(function () {});
          }
        } catch (e) { /* ignore */ }

        setTimeout(function () {
          if (window.innerWidth < window.innerHeight) {
            note('浏览器未自动旋转，请手动把手机横过来');
          } else {
            note('已进入横屏');
          }
        }, 800);
      });
    }
  }

  function boot() {
    canvas = $('gl');
    Store.load();
    try {
      R.init(canvas);
      R.resize(canvas);
      R.setFog(34, 92);
      R.setSky([0.11, 0.13, 0.15]);

      Inventory.init();
      Stash.init();
      Shop.init();
      Contracts.init();
      Lobby.init();
      HUD.setCombatMode(false);
      TOUCH.init();

      bindInput();
      bindUi();

      R.buildStatic(function (geo) { Hangar.buildStatic(geo); });
      player.charKey = Store.char() === 1 ? 'assault' : 'scout';
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
    finishRun: finishRun,
    toLobby: toLobby,
    switchSlot: switchSlot,
    setPaused: setPause,
    togglePause: function () { setPause(!paused); },
    startReload: startReload,
    tryLoot: tryLoot,
    toggleInventory: function () { Inventory.toggle(); },
    devGo: devGo,
    debug: {
      tick: function (dt) { if (mode === 'mission' && !paused) update(dt); },
      pickup: tryLoot,
      teleport: function (x, z) { player.x = x; player.z = z; },
      clearEnemies: function () { enemies.length = 0; },
      reload: startReload,
      finishReload: finishReload
    },
    state: {
      player: player,
      cam: CAM,
      get enemies() { return enemies; },
      get time() { return time; },
      get kills() { return kills; },
      get looted() { return looted; }
    }
  };
})();
