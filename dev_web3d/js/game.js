'use strict';

/* ============================================================
   主循环：输入 / 镜头 / 战斗 / 敌人 AI / 特效 / 渲染
   ============================================================ */

const G = (function () {
  let canvas;
  let running = false, last = 0;
  let time = 0;
  let paused = false;
  let ended = false;

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
    x: 0, z: 0, yaw: 0, hp: CFG.PLAYER.hp, shield: CFG.PLAYER.shield,
    stam: CFG.PLAYER.stam, moving: false, animT: 0, sprinting: false,
    weapon: 0, cool: 0, reload: 0, recoil: 0,
    shieldTimer: 0, stamTimer: 0, dead: false, deadT: 0,
    mags: [], spares: [], extractT: 0, extracted: false
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
  let kills = 0, looted = 0;
  let seed = 20261123;
  const AUTO = QS.get('auto') === '1';

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

  /* ---------- 输入 ---------- */
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      if (e.code === 'BracketLeft') { setPitch(-1); e.preventDefault(); }
      if (e.code === 'BracketRight') { setPitch(1); e.preventDefault(); }
      if (e.code === 'KeyR') startReload();
      if (e.code === 'KeyF') tryLoot();
      if (e.code === 'Digit1') switchWeapon(0);
      if (e.code === 'Digit2') switchWeapon(1);
      if (e.code === 'Digit3') switchWeapon(2);
      if (e.code === 'Digit4') switchWeapon(3);
      if (e.code === 'Digit5') switchWeapon(4);
      if (e.code === 'KeyP') { paused = !paused; HUD.toast(paused ? '已暂停' : '继续'); }
      if (e.code === 'F3') {
        const d = $('dbg');
        if (d) d.classList.toggle('on');
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    canvas.addEventListener('mousemove', function (e) {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      const ch = $('cross');
      if (ch) { ch.style.left = mouse.x + 'px'; ch.style.top = mouse.y + 'px'; }
    });
    canvas.addEventListener('mousedown', function (e) { if (e.button === 0) mouse.down = true; });
    window.addEventListener('mouseup', function (e) { if (e.button === 0) mouse.down = false; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      CAM.dist = clamp(CAM.dist + Math.sign(e.deltaY) * 1.2, 7, 30);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('resize', function () { R.resize(canvas); });
  }

  function setPitch(dir) {
    const i = CAM.presets.indexOf(CAM.pitch);
    CAM.pitch = CAM.presets[clamp(i < 0 ? 2 : i + dir, 0, CAM.presets.length - 1)];
    HUD.toast('镜头俯角 ' + CAM.pitch + '°');
  }

  /* ---------- 战斗 ---------- */
  function switchWeapon(i) {
    if (i === player.weapon || i < 0 || i >= WEAPONS.length) return;
    player.weapon = i;
    player.cool = Math.max(player.cool, 0.25);
    player.reload = 0;
    HUD.mag(i);
  }

  function startReload() {
    const w = WEAPONS[player.weapon];
    if (player.reload > 0) return;
    if (player.mags[player.weapon] >= w.mag) return;
    if (player.spares[player.weapon] <= 0) return;
    player.reload = w.reload;
  }

  function finishReload() {
    const w = WEAPONS[player.weapon];
    const need = w.mag - player.mags[player.weapon];
    const take = Math.min(need, player.spares[player.weapon]);
    player.mags[player.weapon] += take;
    player.spares[player.weapon] -= take;
  }

  /* 枪口位置：和右手持枪的位置对齐，子弹从这里出去 */
  function muzzle() {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    return {
      x: player.x + fx * 0.92 + rx * 0.20,
      y: 0.95,
      z: player.z + fz * 0.92 + rz * 0.20
    };
  }

  function fire() {
    const wi = player.weapon;
    const w = WEAPONS[wi];
    if (player.cool > 0 || player.reload > 0 || player.dead) return;
    if (player.mags[wi] <= 0) { startReload(); return; }

    player.mags[wi]--;
    player.cool = w.rate;
    player.recoil = 1;
    shake = Math.min(2.2, shake + (w.kick || 0.6) * 0.85);
    fovPunch = Math.min(3.2, fovPunch + (w.kick || 0.6) * 1.5);
    noise(player.x, player.z, w.id === 'sonic' ? 18 : 12);

    const m = muzzle();
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.06, s: 0.34 + w.recoil * 0.16, c: w.rgb2 });
    flashes.push({ x: m.x, y: m.y, z: m.z, yaw: player.yaw, t: 0.1, s: 0.18, c: [1, 0.97, 0.88] });
    if (w.id !== 'sonic') {
    }

    if (w.id === 'sonic') fireCone(w, m);
    else if (w.id === 'laser') fireLaser(w, m);
    else fireBullet(w, m);

    HUD.mag(wi);
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

  /* ---------- 光学：折线激光，最多弹射 ----------------
     返回折线顶点；同时按段判定命中 */
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

      /* 回退到墙外侧一点，再分别探 x / z 两个方向，判断撞的是哪面 */
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

  /* 子弹销毁：撞墙 / 打中敌人 / 射程耗尽都走这里 */
  function bulletImpact(b) {
    sparks.push({ x: b.x, y: 1.0, z: b.z, t: 0.2, c: b.c, s: 0.24 });
    if (b.kind === 'thermal') spawnZone(b.x, b.z, b.c);
  }

  /* 热学燃烧区 */
  function spawnZone(x, z, c) {
    const w = WEAPONS[2];
    zones.push({
      x: x, z: z, r: w.zoneR || 3.1, life: w.zoneLife || 3.2,
      tick: 0, dps: (w.tickDmg || 3.5) * 4, c: c || w.rgb2
    });
  }

  /* 实体弹命中：热学留燃烧区，电学链式传导 */
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
    /* 被打一定进入追击 */
    if (e.state !== 'chase' && e.state !== 'attack') {
      e.state = 'alert'; e.alertT = 0.35;
      e.lastSeenX = player.x; e.lastSeenZ = player.z;
    }
    const nx = e.x, nz = e.z;
    if (false) { e.x = nx; e.z = nz; }
    if (e.hp <= 0) {
      e.dead = true;
      kills++;
      HUD.kills(kills);
      HUD.hit(true);
      sparks.push({ x: e.x, y: 1.0, z: e.z, t: 0.3, c: [0.85, 0.35, 0.25], s: 0.5 });
    }
  }

  function damagePlayer(dmg) {
    if (player.dead || player.extracted) return;
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
      showEnd(false);
    }
    HUD.vitals();
  }

  function tryLoot() {
    let best = null, bd = CFG.INTERACT_R;
    for (const l of World.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - player.x, l.z - player.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (best) {
      best.taken = true;
      looted++;
      HUD.toast('拾取 ' + (best.tier === 'rare' ? '稀有物资' : best.tier === 'fine' ? '优良物资' : '常见物资'));
      HUD.loot(looted);
    }
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

      /* 察觉：先愣一下再扑上来 */
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
        /* 追到最后看到的位置；看不见超过 5 秒就回巡逻 */
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
        /* 巡逻 */
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

      /* 互相分开 */
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

  /* ---------- 更新 ---------- */
  function update(dt) {
    time += dt;
    if (paused) return;

    const gp = screenToGround(mouse.x, mouse.y, 0.9);
    if (gp) aim = gp;

    const adx = aim.x - player.x, adz = aim.z - player.z;
    if (Math.hypot(adx, adz) > 0.3) {
      player.yaw = angLerp(player.yaw, Math.atan2(adx, adz), 1 - Math.exp(-18 * dt));
    }

    let ix = 0, iz = 0;
    if (keys.KeyW) iz -= 1;
    if (keys.KeyS) iz += 1;
    if (keys.KeyA) ix -= 1;
    if (keys.KeyD) ix += 1;
    const mag = Math.hypot(ix, iz);
    player.moving = mag > 0 && !player.dead;
    player.sprinting = !!(keys.ShiftLeft || keys.ShiftRight) && player.stam > 1 && player.moving;

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

    const nx = player.x + ix * speed * dt;
    const nz = player.z + iz * speed * dt;
    if (!World.blocked(nx, player.z, CFG.PLAYER.r)) player.x = nx;
    if (!World.blocked(player.x, nz, CFG.PLAYER.r)) player.z = nz;

    player.animT += dt * (player.sprinting ? 1.35 : 1);
    if (!player.moving) player.animT = 0;

    player.shieldTimer = Math.max(0, player.shieldTimer - dt);
    if (player.shieldTimer <= 0 && player.shield < CFG.PLAYER.shield && !player.dead) {
      player.shield = Math.min(CFG.PLAYER.shield, player.shield + CFG.PLAYER.shieldRate * dt);
    }

    player.cool = Math.max(0, player.cool - dt);
    player.recoil = Math.max(0, player.recoil - dt * 6);
    if (player.reload > 0) {
      player.reload -= dt;
      if (player.reload <= 0) { player.reload = 0; finishReload(); HUD.mag(player.weapon); }
    }
    if (mouse.down || AUTO) fire();

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

    /* 玩家子弹：小步推进，避免穿墙 */
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

    /* 燃烧区 */
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

    /* 特效 */
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
        showEnd(true);
      }
    } else if (player.extractT > 0) {
      player.extractT = Math.max(0, player.extractT - dt * 2);
      HUD.extract(player.extractT / CFG.EXTRACT_HOLD);
    }

    if (player.dead) player.deadT += dt;
    HUD.vitals();
  }

  /* ---------- 渲染 ---------- */
  function render() {
    R.begin();
    const geo = R.dyn;

    MODELS.drawUnit(geo, 'scout', {
      x: player.x, y: 0, z: player.z, yaw: player.yaw,
      moving: player.moving, animT: player.animT
    });

    const gy = 0.92 - player.recoil * 0.03;
    const gx = player.x + Math.sin(player.yaw + Math.PI / 2) * 0.20;
    const gz = player.z + Math.cos(player.yaw + Math.PI / 2) * 0.20;
    MODELS.drawGun(geo, player.weapon, {
      x: gx + Math.sin(player.yaw) * 0.32,
      y: gy,
      z: gz + Math.cos(player.yaw) * 0.32,
      yaw: player.yaw, scale: 1.15
    });

    /* 敌人 + 状态指示 */
    for (const e of enemies) {
      if (e.dead) continue;
      MODELS.drawUnit(geo, e.type, {
        x: e.x, y: 0, z: e.z, yaw: e.yaw,
        moving: e.moving, animT: e.animT
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

    /* 战利品 */
    for (const l of World.loot) {
      if (l.taken) continue;
      const col = l.tier === 'rare' ? [0.73, 0.42, 1.0] : (l.tier === 'fine' ? [0.36, 0.83, 0.42] : [0.62, 0.66, 0.70]);
      if (l.kind === 'case') {
        geo.box({ x: l.x, y: 0.24, z: l.z, sx: 0.62, sy: 0.46, sz: 0.5, yaw: 0.4, color: PAL.teal, outline: 0.016, shadow: true });
        geo.box({ x: l.x, y: 0.50, z: l.z, sx: 0.44, sy: 0.05, sz: 0.3, yaw: 0.4, color: col, outline: 0, emis: true });
      } else {
        geo.box({ x: l.x, y: 0.3, z: l.z, sx: 0.36, sy: 0.6, sz: 0.36, yaw: 0.2, color: PAL.gunL, outline: 0.014, shadow: true });
        geo.box({ x: l.x, y: 0.62, z: l.z, sx: 0.30, sy: 0.06, sz: 0.30, yaw: 0.2, color: col, outline: 0, emis: true });
      }
    }

    /* 弹体 */
    for (const p of projectiles) {
      geo.box({ x: p.x, y: p.y, z: p.z, sx: 0.16, sy: 0.16, sz: 0.16, color: [0.73, 0.55, 1.0], outline: 0, emis: true });
    }

    /* 曳光 */
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

    /* 枪口火光：十字 + 亮芯 + 地面冲击环 */
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

    /* 玩家子弹：亮芯 + 拖尾 */
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

    /* 激光折线 */
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

    /* 电弧链 */
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

    /* 声学冲击：整片扇形（面判定，不是线） */
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
      /* 外层亮边：一圈薄扇形，标出实际范围 */
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

    /* 燃烧区：方框边界 + 中心火种 */
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

    /* 火花 */
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

  /* ---------- 结束 / 重开 ---------- */
  function showEnd(win) {
    if (ended) return;
    ended = true;
    HUD.end(win, { kills: kills, loot: looted, time: time });
  }

  function restart() {
    ended = false;
    paused = false;
    seed = (Math.random() * 1e9) | 0;
    start(seed);
    HUD.hideEnd();
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

  function start(s) {
    World.gen(s);
    R.buildStatic(function (geo) { World.buildStatic(geo); });

    player.x = World.spawn.x;
    player.z = World.spawn.z;
    player.yaw = 0;
    player.hp = CFG.PLAYER.hp;
    player.shield = CFG.PLAYER.shield;
    player.stam = CFG.PLAYER.stam;
    player.dead = false;
    player.extracted = false;
    player.extractT = 0;
    player.mags = WEAPONS.map(function (w) { return w.mag; });
    player.spares = WEAPONS.map(function (w) { return w.maxSpare; });
    player.weapon = clamp(parseInt(QS.get('w'), 10) || 0, 0, WEAPONS.length - 1);
    player.reload = 0;
    player.cool = 0;

    kills = 0; looted = 0; time = 0;
    tracers = []; flashes = []; sparks = []; projectiles = [];
    bullets = []; zones = []; beams = []; bolts = []; cones = []; rings = [];
    CAM.focus = [player.x, CFG.CAM.HEIGHT_OFF, player.z];

    enemies = [];
    const types = ['zombie', 'zombie', 'zombie', 'gaunt', 'spitter'];
    for (let i = 0; i < CFG.ENEMY_COUNT; i++) {
      const c = i < CFG.NEAR_SPAWN ? spawnNear(player.x, player.z, 7, 15)
        : World.randomFloorPoint({ x: player.x, z: player.z }, CFG.SPAWN_MIN);
      const t = types[i % types.length];
      const cfg = CFG.ENEMY[t];
      enemies.push({
        x: c.x, z: c.z, home: { x: c.x, z: c.z }, type: t,
        hp: cfg.hp, maxHp: cfg.hp, r: cfg.r, speed: cfg.speed, dmg: cfg.dmg,
        cd: 0, cdMax: cfg.cd, yaw: Math.random() * 6.28, animT: 0,
        moving: false, dead: false, fade: 0.6, hitFlash: 0, lunge: 0,
        state: 'idle', alertT: 0, lostT: 0, waitT: 0, patrol: null,
        lastSeenX: c.x, lastSeenZ: c.z, seen: false, seed: Math.random() * 10,
        viewR: t === 'spitter' ? 20 : (t === 'gaunt' ? 15 : 16),
        viewHalf: t === 'spitter' ? 1.15 : 0.95
      });
    }
    HUD.reset();
  }

  function frame(ts) {
    if (!running) return;
    try {
      const now = ts / 1000;
      const dt = Math.min(0.05, now - last);
      last = now;
      if (!ended) update(dt);
      updateCamera(dt);
      render();
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

  function boot() {
    canvas = $('gl');
    try {
      R.init(canvas);
      R.resize(canvas);
      R.setFog(30, 78);
      R.setSky([0.26, 0.29, 0.33]);
      bindInput();
      $('againBtn').addEventListener('click', restart);
      start(seed);
      running = true;
      last = performance.now() / 1000;
      requestAnimationFrame(frame);
      $('loading').classList.add('hidden');
    } catch (err) {
      const el = $('loading');
      if (el) {
        el.classList.remove('hidden');
        el.textContent = '启动失败: ' + (err && err.message ? err.message : err);
      }
      console.error(err);
    }
  }

  window.addEventListener('DOMContentLoaded', boot);

  return {
    restart: restart,
    setPaused: function (v) { paused = v; },
    state: { player: player, cam: CAM, get enemies() { return enemies; }, get time() { return time; } }
  };
})();
