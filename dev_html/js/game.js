'use strict';

/* ============================================================
   主循环 / 状态机 / 实体 / 渲染
   ============================================================ */

const G = {
  state: 'title',
  time: 0,
  seed: 0,
  map: null,
  player: null,
  carried: [],
  enemies: [],
  packs: [],
  bullets: [],
  eShots: [],
  zones: [],
  particles: [],
  numbers: [],
  effects: [],
  loot: [],
  data: 0,
  kills: 0,
  picked: 0,
  cam: { x: 0, y: 0, shake: 0 },
  inv: { items: [], selected: null },
  inventoryOpen: false,
  action: null,
  extraction: { progress: 0, nearPad: null },
  nearLoot: null,
  hitStop: 0,
  endTimer: 0,
  pendingShot: false,
  result: null,
  alertAt: null
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let dpr = 1;
let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

/* 视野缩放：世界视图 = 画布 / ZOOM */
const ZOOM = CFG.ZOOM;
const VIEW_W = CFG.VW / ZOOM;
const VIEW_H = CFG.VH / ZOOM;

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ============================================================
   Game
   ============================================================ */
const Game = {

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    Input.init(canvas);
    Input.onKey = code => this.onKey(code);

    HUD.init();
    Inventory.init();
    Stash.init();
    Lobby.init();
    Sprites.init();
    MapTiles.init();

    canvas.addEventListener('mousedown', e => {
      SFX.unlock();
      if (e.button === 0) G.pendingShot = true;
    });
    window.addEventListener('keydown', () => SFX.unlock());

    document.getElementById('againBtn').addEventListener('click', () => this.toLobby());
    document.getElementById('resumeBtn').addEventListener('click', () => this.togglePause());
    document.getElementById('restartBtn2').addEventListener('click', () => this.toLobby());
    document.getElementById('muteBtn').addEventListener('click', () => {
      SFX.toggle();
      HUD.setMuteLabel();
    });

    HUD.show(false);
    HUD.setMuteLabel();
    G.state = 'lobby';
    Lobby.show(true);

    const qs = new URLSearchParams(location.search);
    if (qs.get('autostart') === '1') {
      const s = parseInt(qs.get('seed') || '0', 10);
      this.startRun(s || null, { weapons: [3, 1], mags: [1, 1] });
    }
    if (qs.get('bag') === '1') this.fillDebugBag();
    if (qs.get('stash') === '1') this.fillDebugStash();
    if (qs.get('fight') === '1') this.debugFight();
    if (qs.get('stam')) {
      const st = parseFloat(qs.get('stam'));
      if (isFinite(st) && G.player) {
        G.player.stamina = clamp(st, 0, G.player.maxStamina);
      }
    }

    requestAnimationFrame(this.frame.bind(this));
  },

  resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(CFG.VW * dpr);
    canvas.height = Math.round(CFG.VH * dpr);
  },

  /* ---------------- 流程 ---------------- */
  startRun(seed, loadout) {
    if (!seed) seed = (Math.random() * 0x7fffffff) | 0;
    loadout = loadout || { weapons: [3, 1], mags: [0, 0] };
    const carried = (loadout.weapons || [3, 1]).slice(0, 2);
    if (carried.length < 2) carried.push(3);

    G.seed = seed;
    G.map = MapGen.generate(seed);
    G.carried = carried;
    G.player = this.makePlayer(G.map.spawn.x, G.map.spawn.y, loadout);
    G.packs = [];
    G.enemies = this.spawnEnemies();
    G.loot = this.spawnLoot();
    G.bullets = [];
    G.eShots = [];
    G.zones = [];
    G.particles = [];
    G.numbers = [];
    G.effects = [];
    G.data = loadout.data || 0;
    G.kills = 0;
    G.picked = 0;
    G.time = 0;
    G.hitStop = 0;
    G.endTimer = 0;
    G.pendingShot = false;
    G.extraction = { progress: 0, nearPad: null };
    G.inv.items = [];
    G.inv.selected = null;
    G.action = null;
    G.nearLoot = null;
    G.result = null;
    G.alertAt = (x, y, r) => this.alertAt(x, y, r);
    Lobby.reset();

    G.cam.x = clamp(G.player.x - VIEW_W / 2, 0, CFG.MAP_W * CFG.TILE - VIEW_W);
    G.cam.y = clamp(G.player.y - VIEW_H / 2, 0, CFG.MAP_H * CFG.TILE - VIEW_H);
    G.cam.shake = 0;

    G.state = 'playing';
    if (G.inventoryOpen) Inventory.close();
    Lobby.show(false);
    HUD.setLoadout(carried);
    HUD.show(true);
    HUD.hideResults();
    HUD.showPause(false);
    HUD.setMuteLabel();
    Inventory.refresh();

    const intro = document.getElementById('intro');
    intro.style.display = 'block';
    intro.style.opacity = '0';
    void intro.offsetWidth;
    intro.style.opacity = '1';
    clearTimeout(this._introTimer);
    clearTimeout(this._introHideTimer);
    this._introTimer = setTimeout(() => { intro.style.opacity = '0'; }, 3400);
    this._introHideTimer = setTimeout(() => { intro.style.display = 'none'; }, 4400);
  },

  toLobby() {
    G.state = 'lobby';
    HUD.show(false);
    HUD.hideResults();
    HUD.showPause(false);
    if (G.inventoryOpen) Inventory.close();
    Lobby.show(true);
  },

  endRun(success) {
    if (G.state !== 'playing') return;
    G.state = 'results';
    if (G.inventoryOpen) Inventory.close();

    let lost = 0;
    for (const it of G.inv.items) lost += it.value;

    const best0 = this.getBest();
    let best = best0;
    if (success && G.data > best0) {
      best = G.data;
      try { localStorage.setItem('eofata.best', String(best)); } catch (e) { /* ignore */ }
    }

    let banked = 0;
    let stashed = 0;
    if (success) {
      banked = Math.round(G.data);
      Bank.set(Bank.get() + banked);
      stashed = Stash.addMany(G.inv.items.map(it => ({
        name: it.name,
        tierId: it.tier.id,
        w: it.w, h: it.h,
        value: it.value,
        time: it.time
      })));
    }

    G.result = {
      success,
      kills: G.kills,
      looted: G.picked,
      data: G.data,
      time: G.time,
      lost,
      best,
      banked,
      stashed,
      itemsLost: success ? 0 : G.inv.items.length
    };
    HUD.show(false);
    HUD.showResults(G.result);
  },

  getBest() {
    try { return parseInt(localStorage.getItem('eofata.best') || '0', 10) || 0; }
    catch (e) { return 0; }
  },

  /* 调试用：?bag=1 往背包塞入各尺寸样品 */
  fillDebugBag() {
    if (!G.player) return;
    const samples = [];
    TIERS.forEach(t => {
      t.items.forEach(def => {
        samples.push({
          tier: t, name: def.name, w: def.w, h: def.h,
          value: rndInt(t.min, t.max), time: t.time
        });
      });
    });
    for (const it of samples) Inventory.addItem(it);
    Inventory.refresh();
  },

  /* 调试用：?stash=1 往仓库塞一套样品（仅当仓库为空） */
  fillDebugStash() {
    if (Stash.count() > 0) return;
    const samples = [];
    TIERS.forEach(t => {
      t.items.forEach(def => {
        samples.push({
          name: def.name, tierId: t.id, w: def.w, h: def.h,
          value: rndInt(t.min, t.max), time: t.time
        });
      });
    });
    Stash.addMany(samples);
    if (typeof Lobby !== 'undefined') Lobby.refresh();
  },

  /* 调试用：?fight=1 传送到精英巢穴附近并惊动它们 */
  debugFight() {
    if (!G.player || !G.packs.length) return;
    const pack = G.packs.find(pk => pk.heavy) || G.packs[0];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU;
      const x = pack.x + Math.cos(a) * 330;
      const y = pack.y + Math.sin(a) * 330;
      if (MapGen.circleHitsWall(G.map, x, y, 18)) continue;
      G.player.x = x;
      G.player.y = y;
      break;
    }
    G.cam.x = clamp(G.player.x - VIEW_W / 2, 0, CFG.MAP_W * CFG.TILE - VIEW_W);
    G.cam.y = clamp(G.player.y - VIEW_H / 2, 0, CFG.MAP_H * CFG.TILE - VIEW_H);
    for (const m of pack.members) m.alert = true;
  },

  togglePause() {
    G.pendingShot = false;
    if (G.state === 'playing') {
      G.state = 'paused';
      HUD.showPause(true);
      Input.releaseAll();
    } else if (G.state === 'paused') {
      G.state = 'playing';
      HUD.showPause(false);
      Input.releaseAll();
    }
  },

  openInventory() { Inventory.open(); },
  closeInventory() { Inventory.close(); },

  onKey(code) {
    if (code === 'KeyM') {
      SFX.toggle();
      HUD.setMuteLabel();
      return;
    }

    if (G.state === 'lobby') {
      if (code === 'Escape' && Stash.isOpen()) { Stash.show(false); return; }
      if ((code === 'Enter' || code === 'Space') && !Stash.isOpen()) Lobby.start();
      return;
    }

    if (G.state === 'results') {
      if (code === 'KeyR' || code === 'Escape') this.toLobby();
      return;
    }

    if (G.state === 'paused') {
      if (code === 'Escape') this.togglePause();
      return;
    }

    if (G.state !== 'playing') return;

    if (code === 'Escape') {
      if (G.inventoryOpen) Inventory.close();
      else this.togglePause();
    } else if (code === 'Tab') {
      Inventory.toggle();
    } else if (code === 'KeyR') {
      if (G.inventoryOpen) Inventory.rotate();
      else this.startReload();
    } else if (code === 'KeyF') {
      this.pickup();
    } else if (code.startsWith('Digit')) {
      const n = parseInt(code.slice(5), 10);
      if (n >= 1 && n <= 2) this.selectWeapon(n - 1);
    }
  },

  /* ---------------- 玩家 ---------------- */
  makePlayer(x, y, loadout) {
    const weapons = (loadout && loadout.weapons ? loadout.weapons : [3, 1]).slice(0, 2);
    const ammo = WEAPONS.map(() => ({ mag: 0, spare: 0 }));
    weapons.forEach((wIdx, i) => {
      const n = clamp((loadout && loadout.mags ? loadout.mags[i] : 0) || 0, 0, 3);
      /* 配给 ≥1 个：枪内直接上弹，其余作为备弹（上限 2） */
      ammo[wIdx] = n > 0
        ? { mag: WEAPONS[wIdx].mag, spare: Math.min(2, n - 1) }
        : { mag: 0, spare: 0 };
    });

    return {
      x, y, vx: 0, vy: 0, r: CFG.PLAYER.r,
      hp: CFG.PLAYER.hp, maxHp: CFG.PLAYER.hp,
      shield: CFG.PLAYER.shield, maxShield: CFG.PLAYER.shield,
      lastHurt: -99,
      stamina: CFG.PLAYER.stamina, maxStamina: CFG.PLAYER.stamina,
      staminaIdle: 99, exhausted: false, sprinting: false,
      aim: 0, weapon: weapons[0],
      ammo,
      fireCd: 0, reloadT: 0, reloadTotal: 0, reloadWeapon: -1,
      switchT: 0, spread: 0, kick: 0, muzzleT: 0,
      animT: 0, animFrame: 0,
      character: (loadout && loadout.character) || 0,
      moving: false, dead: false
    };
  },

  selectWeapon(i) {
    if (G.state !== 'playing') return;
    const p = G.player;
    if (!p) return;
    const wIdx = G.carried[i];
    if (wIdx === undefined || wIdx === p.weapon) return;
    if (p.reloadT > 0) { p.reloadT = 0; p.reloadTotal = 0; }
    p.weapon = wIdx;
    p.switchT = 0.22;
    p.spread = Math.min(0.2, p.spread + 0.06);
    SFX.ui();
  },

  startReload() {
    const p = G.player;
    if (!p || p.dead) return;
    if (p.reloadT > 0) return;
    const w = WEAPONS[p.weapon];
    const st = p.ammo[p.weapon];
    if (st.mag >= w.mag) { HUD.toast('弹夹已满', 'warn'); return; }
    if (st.spare <= 0) { HUD.toast('没有备用弹夹 · TAB 背包制造', 'warn'); return; }
    p.reloadT = w.reload;
    p.reloadTotal = w.reload;
    p.reloadWeapon = p.weapon;
    SFX.reloadStart();
  },

  finishReload() {
    const p = G.player;
    const idx = p.reloadWeapon;
    if (idx < 0) return;
    const st = p.ammo[idx];
    if (st.spare > 0) {
      st.spare--;
      st.mag = WEAPONS[idx].mag;
      SFX.reloadDone();
    }
    p.reloadT = 0;
    p.reloadTotal = 0;
    p.reloadWeapon = -1;
  },

  pickup() {
    const it = G.nearLoot;
    if (!it || it.taken) return;
    if (Inventory.addItem(it)) {
      it.taken = true;
      G.loot = G.loot.filter(l => !l.taken);
      G.nearLoot = null;
      SFX.pickup();
      HUD.toast('拾取 ' + it.tier.name + ' · ' + it.name + '（' + it.value + ' NB）', 'good');
    } else {
      HUD.toast('背包已满 · 先分解一些数据', 'warn');
    }
  },

  hurtPlayer(dmg) {
    const p = G.player;
    if (!p || p.dead || G.state !== 'playing') return;

    if (p.shield > 0) {
      p.shield = Math.max(0, p.shield - dmg);
    } else {
      p.hp -= dmg;
    }
    p.lastHurt = G.time;
    G.cam.shake = Math.min(18, G.cam.shake + 5);
    HUD.flashHurt();
    SFX.hurt();

    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      G.endTimer = 1.3;
      SFX.die();
      for (let i = 0; i < 26; i++) {
        G.particles.push({
          x: p.x, y: p.y,
          vx: rnd(-220, 220), vy: rnd(-220, 220),
          life: rnd(0.3, 1.0), max: 1.0, size: rnd(1.5, 3.5),
          color: i % 3 === 0 ? '#fff' : '#ff5a4d'
        });
      }
      if (G.inventoryOpen) Inventory.close();
    }
  },

  /* ---------------- 生成 ---------------- */
  makeEnemy(def, x, y) {
    return {
      x, y, kx: 0, ky: 0, r: def.r,
      hp: def.hp, maxHp: def.hp,
      type: def.key, color: def.color, dark: def.dark,
      behavior: def.behavior || 'melee',
      speed: def.speed * rnd(0.9, 1.08),
      dmg: def.dmg,
      cd: def.cd,
      atkCd: rnd(0.3, 1.2),
      /* 攻击动作：整套期间不移动，出伤帧见 CFG.ENEMY[type].hitFrame */
      atk: null,
      anim: 'walk',
      animT: 0,
      animPhase: rnd(0, 1),
      hitFlash: 0,
      dead: false,
      alert: false,
      loseT: 0,
      face: rnd(0, TAU),
      stun: 0,
      pack: null,
      idlePhase: rnd(0, TAU),
      idleR: rnd(16, 62),
      /* 远程 */
      keepMin: def.keepMin || 0,
      keepMax: def.keepMax || 0,
      shotSpeed: def.shotSpeed || 0,
      shotDmg: def.shotDmg || 0,
      shotLife: def.shotLife || 3,
      strafe: Math.random() < 0.5 ? 1 : -1
    };
  },

  wakePack(e) {
    if (!e || !e.pack) return;
    for (const m of e.pack.members) {
      if (!m.dead) m.alert = true;
    }
  },

  /* 普通群以近战僵尸为主，精英群远程僵尸占比更高 */
  pickEnemyDef(elite) {
    const ranged = elite ? 0.5 : 0.16;
    return Math.random() < ranged ? CFG.ENEMY.zombie_y : CFG.ENEMY.zombie;
  },

  /* 敌人按群落生成：普通巢穴 + 少量精英巢穴 */
  spawnEnemies() {
    const map = G.map;
    const T = CFG.TILE;
    const list = [];
    const packs = [];
    let guard = 0;

    while (packs.length < CFG.PACK_COUNT && guard++ < 1600) {
      let pt = null;
      for (let t = 0; t < 60 && !pt; t++) {
        const x = rnd(5 * T, (map.W - 5) * T);
        const y = rnd(5 * T, (map.H - 5) * T);
        if (MapGen.circleHitsWall(map, x, y, 30)) continue;
        if (dist(x, y, map.spawn.x, map.spawn.y) < 620) continue;
        if (map.extracts.some(e => dist(x, y, e.x, e.y) < e.r + 100)) continue;
        if (packs.some(pk => dist(pk.x, pk.y, x, y) < 340)) continue;
        pt = { x, y };
      }
      if (!pt) continue;

      const heavy = packs.length % 5 === 4;
      const pack = { x: pt.x, y: pt.y, members: [], heavy };
      const n = heavy ? 2 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n && list.length < CFG.ENEMY_COUNT; i++) {
        const a = rnd(0, TAU);
        const r = rnd(0, 64);
        const ex = pt.x + Math.cos(a) * r;
        const ey = pt.y + Math.sin(a) * r;
        if (MapGen.circleHitsWall(map, ex, ey, 16)) continue;
        const e = this.makeEnemy(this.pickEnemyDef(heavy), ex, ey);
        e.pack = pack;
        pack.members.push(e);
        list.push(e);
      }
      if (pack.members.length) packs.push(pack);
    }

    /* 数量不足时补些散兵 */
    let g2 = 0;
    while (list.length < CFG.ENEMY_COUNT && g2++ < 800) {
      const x = rnd(5 * T, (map.W - 5) * T);
      const y = rnd(5 * T, (map.H - 5) * T);
      if (MapGen.circleHitsWall(map, x, y, 16)) continue;
      if (dist(x, y, map.spawn.x, map.spawn.y) < 620) continue;
      if (map.extracts.some(e => dist(x, y, e.x, e.y) < e.r + 60)) continue;
      list.push(this.makeEnemy(this.pickEnemyDef(Math.random() < 0.15), x, y));
    }

    G.packs = packs;
    return list;
  },

  /* 空地上的散点战利品，越远离出生点品质越好 */
  spawnLoot() {
    const map = G.map;
    const T = CFG.TILE;
    const items = [];
    const maxD = Math.max(1, map.maxSpawnDist || 1);
    let guard = 0;

    while (items.length < CFG.LOOT_COUNT && guard++ < 9000) {
      const x = rnd(4 * T, (map.W - 4) * T);
      const y = rnd(4 * T, (map.H - 4) * T);
      if (MapGen.circleHitsWall(map, x, y, 16)) continue;
      if (dist(x, y, map.spawn.x, map.spawn.y) < 150) continue;
      if (map.extracts.some(e => dist(x, y, e.x, e.y) < e.r + 30)) continue;

      let bad = false;
      for (const o of items) {
        if (dist2(o.x, o.y, x, y) < 30 * 30) { bad = true; break; }
      }
      if (bad) continue;

      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      const d = map.spawnDist[ty * map.W + tx];
      const depth = d > 0 ? clamp(d / maxD, 0, 1) : 0;
      const tier = this.rollTier(depth);
      const def = pick(tier.items);

      items.push({
        x, y, tier,
        name: def.name,
        w: def.w,
        h: def.h,
        value: rndInt(tier.min, tier.max),
        time: tier.time,
        phase: rnd(0, TAU),
        taken: false
      });
    }
    return items;
  },

  rollTier(depth) {
    const weights = TIERS.map(t => {
      if (t.id === 'common') return Math.max(10, t.weight * (1 - depth * 0.55));
      if (t.id === 'fine') return t.weight;
      if (t.id === 'rare') return t.weight * (1 + depth * 1.8);
      return t.weight * (1 + depth * 2.6);
    });
    return weightedPick(TIERS, weights, Math.random);
  },

  /* ---------------- 战斗回调 ---------------- */
  alertAt(x, y, r) {
    const r2 = r * r;
    for (const e of G.enemies) {
      if (e.dead || e.alert) continue;
      if (dist2(e.x, e.y, x, y) < r2) {
        e.alert = true;
        this.wakePack(e);
      }
    }
  },

  damageEnemy(e, dmg, sx, sy, color, silent) {
    if (!e || e.dead) return;
    e.hp -= dmg;
    e.hitFlash = 0.1;
    e.alert = true;
    this.wakePack(e);

    if (!silent) {
      G.numbers.push({
        x: e.x + rnd(-7, 7), y: e.y - e.r - 3,
        vy: -52, life: 0.6, max: 0.6,
        text: String(Math.round(dmg)), color: color || '#ffffff'
      });
      for (let i = 0; i < 3; i++) {
        G.particles.push({
          x: e.x + rnd(-4, 4), y: e.y + rnd(-4, 4),
          vx: rnd(-110, 110), vy: rnd(-110, 110),
          life: rnd(0.1, 0.32), max: 0.32, size: rnd(1, 2.6),
          color: color || '#ffffff'
        });
      }
    }

    if (e.hp <= 0) this.killEnemy(e, color);
  },

  killEnemy(e, color) {
    if (e.dead) return;
    e.dead = true;
    G.kills++;
    G.hitStop = Math.max(G.hitStop, 0.03);
    G.cam.shake = Math.min(16, G.cam.shake + 3);
    SFX.kill();
    for (let i = 0; i < 16; i++) {
      G.particles.push({
        x: e.x, y: e.y,
        vx: rnd(-190, 190), vy: rnd(-190, 190),
        life: rnd(0.18, 0.55), max: 0.55, size: rnd(1.2, 3),
        color: i % 4 === 0 ? '#ffffff' : (color || e.color)
      });
    }
  },

  addZone(x, y) {
    const w = WEAPONS[2];
    const near = G.zones.filter(z => dist2(z.x, z.y, x, y) < 34 * 34);
    if (near.length >= 2 && near[0]) near[0].life = 0;
    G.zones.push({
      x, y, r: w.zoneR, life: w.zoneLife, max: w.zoneLife, tickT: 0.06, phase: rnd(0, TAU)
    });
    G.zones = G.zones.filter(z => z.life > 0);
  },

  /* ---------------- 更新 ---------------- */
  frame(now) {
    requestAnimationFrame(this.frame.bind(this));
    let dt = (now - last) / 1000;
    last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 5) {
      this.update(STEP);
      acc -= STEP;
    }
    this.render();
  },

  update(dt) {
    if (G.state !== 'playing') return;

    if (G.hitStop > 0) {
      G.hitStop -= dt;
      dt *= 0.25;
    }

    G.time += dt;
    const p = G.player;
    if (!p) return;

    /* 玩家计时器 */
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.switchT = Math.max(0, p.switchT - dt);
    p.spread = Math.max(0, p.spread - dt * 0.55);
    p.kick = Math.max(0, p.kick - dt * 9);
    p.muzzleT = Math.max(0, p.muzzleT - dt);

    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) this.finishReload();
    }

    /* 护盾回充 */
    if (!p.dead && G.time - p.lastHurt > CFG.PLAYER.shieldDelay && p.shield < p.maxShield) {
      p.shield = Math.min(p.maxShield, p.shield + CFG.PLAYER.shieldRate * dt);
    }

    /* 移动与瞄准 */
    if (!p.dead) {
      let dx = (Input.down('KeyD') ? 1 : 0) - (Input.down('KeyA') ? 1 : 0);
      let dy = (Input.down('KeyS') ? 1 : 0) - (Input.down('KeyW') ? 1 : 0);
      const l = Math.hypot(dx, dy);
      if (l > 0) { dx /= l; dy /= l; }
      p.moving = l > 0;

      /* 耐力：按住 Shift 奔跑，消耗耐力；松开后延迟回复 */
      const wantRun = (Input.down('ShiftLeft') || Input.down('ShiftRight')) &&
        !G.inventoryOpen && p.moving;
      let sprint = false;
      if (wantRun && !p.exhausted && p.stamina > 0) {
        sprint = true;
        p.stamina = Math.max(0, p.stamina - CFG.PLAYER.staminaDrain * dt);
        p.staminaIdle = 0;
        if (p.stamina <= 0) {
          p.exhausted = true;
          sprint = false;
          HUD.toast('耐力耗尽', 'warn');
        }
      } else {
        p.staminaIdle += dt;
        if (p.staminaIdle > CFG.PLAYER.staminaDelay) {
          p.stamina = Math.min(p.maxStamina, p.stamina + CFG.PLAYER.staminaRegen * dt);
        }
        if (p.exhausted && p.stamina >= CFG.PLAYER.staminaRecover) p.exhausted = false;
      }
      p.sprinting = sprint;
      PlayerArt.advance(p, dt);

      const speed = (sprint ? CFG.PLAYER.speed : CFG.PLAYER.walkSpeed) *
        (G.inventoryOpen ? 0.55 : 1);
      const k = 1 - Math.exp(-dt * 15);
      p.vx = lerp(p.vx, dx * speed, k);
      p.vy = lerp(p.vy, dy * speed, k);
      MapGen.moveCircle(G.map, p, p.vx * dt, p.vy * dt);

      p.aim = Math.atan2(
        G.cam.y + Input.mouse.y / ZOOM - p.y,
        G.cam.x + Input.mouse.x / ZOOM - p.x
      );

      if (Input.mouse.down || G.pendingShot) {
        WeaponSystem.fire(G, p.weapon);
        G.pendingShot = false;
      }
    }

    /* 背包动作 */
    Inventory.update(dt);

    /* 弹道 */
    WeaponSystem.updateBullets(G, dt);

    /* 辐射场 */
    for (const z of G.zones) {
      z.life -= dt;
      z.tickT -= dt;
      if (z.tickT <= 0) {
        z.tickT += 0.25;
        const rr = z.r;
        for (const e of G.enemies) {
          if (e.dead) continue;
          if (dist2(z.x, z.y, e.x, e.y) < (rr + e.r) * (rr + e.r)) {
            this.damageEnemy(e, 3.5, z.x, z.y, '#ff7043', true);
          }
        }
      }
    }
    G.zones = G.zones.filter(z => z.life > 0);

    /* 敌人 */
    this.updateEnemies(dt);
    this.updateEnemyShots(dt);

    /* 粒子 / 数字 / 特效 */
    for (const pt of G.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= Math.exp(-dt * 3.2);
      pt.vy *= Math.exp(-dt * 3.2);
    }
    if (G.particles.length) G.particles = G.particles.filter(pt => pt.life > 0);

    for (const n of G.numbers) {
      n.life -= dt;
      n.y += n.vy * dt;
      n.vy += 70 * dt;
    }
    if (G.numbers.length) G.numbers = G.numbers.filter(n => n.life > 0);

    for (const fx of G.effects) fx.life -= dt;
    if (G.effects.length) G.effects = G.effects.filter(fx => fx.life > 0);

    /* 拾取目标 */
    G.nearLoot = null;
    if (!p.dead) {
      let bd = CFG.INTERACT_RANGE * CFG.INTERACT_RANGE;
      for (const it of G.loot) {
        if (it.taken) continue;
        const d2 = dist2(p.x, p.y, it.x, it.y);
        if (d2 < bd) { bd = d2; G.nearLoot = it; }
      }
    }

    /* 相机 */
    const lookX = clamp((Input.mouse.x - CFG.VW / 2) / ZOOM * 0.22, -150, 150);
    const lookY = clamp((Input.mouse.y - CFG.VH / 2) / ZOOM * 0.22, -110, 110);
    const maxX = CFG.MAP_W * CFG.TILE - VIEW_W;
    const maxY = CFG.MAP_H * CFG.TILE - VIEW_H;
    const tx = clamp(p.x + lookX - VIEW_W / 2, 0, maxX);
    const ty = clamp(p.y + lookY - VIEW_H / 2, 0, maxY);
    const ck = 1 - Math.exp(-dt * 8);
    G.cam.x = lerp(G.cam.x, tx, ck);
    G.cam.y = lerp(G.cam.y, ty, ck);
    G.cam.shake = Math.max(0, G.cam.shake - dt * 34);

    /* 流场 */
    G.map.flowTimer += dt;
    if (G.map.flowTimer > 0.22) {
      G.map.flowTimer = 0;
      MapGen.computeFlow(G.map, p.x, p.y);
    }

    /* 撤离 */
    this.updateExtraction(dt);

    /* 死亡等待 */
    if (p.dead && G.endTimer > 0) {
      G.endTimer -= dt;
      if (G.endTimer <= 0) this.endRun(false);
    }

    HUD.update(G);
  },

  updateEnemies(dt) {
    const p = G.player;
    const map = G.map;
    const list = G.enemies;

    for (const e of list) {
      if (e.dead) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);

      if (Math.abs(e.kx) > 2 || Math.abs(e.ky) > 2) {
        MapGen.moveCircle(map, e, e.kx * dt, e.ky * dt);
        e.kx *= Math.exp(-dt * 7);
        e.ky *= Math.exp(-dt * 7);
      }

      const d = dist(e.x, e.y, p.x, p.y);
      const los = MapGen.hasLOS(map, e.x, e.y, p.x, p.y);

      if (!e.alert && d < 460 && los) {
        e.alert = true;
        this.wakePack(e);
      }
      if (e.alert && d > 1150) {
        e.loseT += dt;
        if (e.loseT > 4) { e.alert = false; e.loseT = 0; }
      } else {
        e.loseT = 0;
      }

      if (e.alert && !e.stun && !p.dead) {
        if (e.behavior === 'ranged') this.updateSpitter(e, dt, d, los);
        else this.updateMelee(e, dt, d, los);
      } else if (!e.alert && e.pack && !e.stun) {
        /* 未警觉时围着巢穴缓慢游荡 */
        const pk = e.pack;
        const a = e.idlePhase + G.time * 0.22;
        const tx = pk.x + Math.cos(a) * e.idleR;
        const ty = pk.y + Math.sin(a) * e.idleR;
        const ddx = tx - e.x, ddy = ty - e.y;
        const dd2 = Math.hypot(ddx, ddy);
        if (dd2 > 6) {
          const sp = Math.min(e.speed * 0.3, dd2 * 1.6);
          const px = e.x, py = e.y;
          MapGen.moveCircle(map, e, (ddx / dd2) * sp * dt, (ddy / dd2) * sp * dt);
          e.face = Math.atan2(ddy, ddx);
          e.anim = 'walk';
          this.syncGait(e, px, py);
        }
      }
    }

    if (list.some(e => e.dead)) {
      G.enemies = list.filter(e => !e.dead);
    }
  },

  /* 朝玩家（或流场）的移动方向 */
  chaseDir(e, d, los) {
    if (los && d < 880) return { x: G.player.x - e.x, y: G.player.y - e.y };
    const f = MapGen.flowDir(G.map, e.x, e.y);
    if (f) return { x: f.x - e.x, y: f.y - e.y };
    return { x: 0, y: 0 };
  },

  moveEnemy(e, dx, dy, dt, speed) {
    let sx = 0, sy = 0;
    for (const o of G.enemies) {
      if (o === e || o.dead) continue;
      const dd = dist2(e.x, e.y, o.x, o.y);
      const rr = e.r + o.r + 3;
      if (dd < rr * rr && dd > 0.01) {
        const dl = Math.sqrt(dd);
        sx += (e.x - o.x) / dl;
        sy += (e.y - o.y) / dl;
      }
    }
    let mvx = dx + sx * 0.55;
    let mvy = dy + sy * 0.55;
    const l = Math.hypot(mvx, mvy) || 1;
    mvx /= l; mvy /= l;
    const px = e.x, py = e.y;
    MapGen.moveCircle(G.map, e, mvx * speed * dt, mvy * speed * dt);
    e.face = Math.atan2(mvy, mvx);
    this.syncGait(e, px, py);
  },

  /* 走/跑动画按实际走过的距离推进，速度变了也不会滑步 */
  syncGait(e, x0, y0) {
    const d = Math.hypot(e.x - x0, e.y - y0);
    if (d < 0.0001) return;
    const A = Sprites.enemy(e.type);
    const stride = (A && A.stride && A.stride[e.anim]) || 52;
    e.animPhase = ((e.animPhase || 0) + d / stride) % 1;
  },

  /* 开始一套攻击：锁定移动，面向玩家 */
  startAttack(e) {
    const p = G.player;
    const def = CFG.ENEMY[e.type];
    e.atk = { t: 0, dur: def.atkFrames / def.atkFps, hit: false };
    e.anim = 'attack';
    e.animT = 0;
    e.face = Math.atan2(p.y - e.y, p.x - e.x);
  },

  /* 推进攻击动作：出伤帧结算一次，播完进入冷却 */
  stepAttack(e, dt) {
    const p = G.player;
    const def = CFG.ENEMY[e.type];
    const a = e.atk;
    a.t += dt;
    e.animT = a.t;

    if (!a.hit && a.t >= (def.hitFrame - 1) / def.atkFps) {
      a.hit = true;
      if (def.behavior === 'ranged') {
        if (!p.dead && MapGen.hasLOS(G.map, e.x, e.y, p.x, p.y)) this.spit(e);
      } else if (!p.dead && dist(e.x, e.y, p.x, p.y) < e.r + p.r + 16) {
        this.hurtPlayer(e.dmg);
      }
    }

    if (a.t >= a.dur) {
      e.atk = null;
      e.animT = 0;
      e.anim = 'walk';
      e.atkCd = e.cd;
    }
  },

  /* 攻击期间不能移动，所以起手前先避让：旁边已经有同类在攻击就先绕一步，避免叠在一起 */
  attackSlotFree(e) {
    for (const o of G.enemies) {
      if (o === e || o.dead || !o.atk) continue;
      if (dist(o.x, o.y, e.x, e.y) < e.r + o.r + 6) return false;
    }
    return true;
  },

  updateMelee(e, dt, d, los) {
    const p = G.player;
    if (e.atk) { this.stepAttack(e, dt); return; }

    const dd = dist(e.x, e.y, p.x, p.y);
    if (!p.dead && dd < e.r + p.r + 14 && e.atkCd <= 0 && this.attackSlotFree(e)) {
      this.startAttack(e);
      return;
    }

    const dir = this.chaseDir(e, d, los);
    e.anim = 'run';
    this.moveEnemy(e, dir.x, dir.y, dt, e.speed);
  },

  updateSpitter(e, dt, d, los) {
    const p = G.player;
    if (e.atk) { this.stepAttack(e, dt); return; }

    if (!p.dead && los && d < 620 && e.atkCd <= 0 && this.attackSlotFree(e)) {
      this.startAttack(e);
      return;
    }

    let dx = 0, dy = 0;
    if (d < e.keepMin) {
      dx = e.x - p.x;
      dy = e.y - p.y;
    } else if (d > e.keepMax || !los) {
      const dir = this.chaseDir(e, d, los);
      dx = dir.x; dy = dir.y;
    } else {
      const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI * 0.5 * e.strafe;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    e.anim = 'walk';
    this.moveEnemy(e, dx, dy, dt, e.speed);
  },

  spit(e) {
    const p = G.player;
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    const sx = e.x + Math.cos(a) * (e.r + 10);
    const sy = e.y + Math.sin(a) * (e.r + 10);
    G.eShots.push({
      x: sx, y: sy,
      vx: Math.cos(a) * e.shotSpeed,
      vy: Math.sin(a) * e.shotSpeed,
      r: 6, dmg: e.shotDmg, life: e.shotLife, color: e.color, dead: false
    });
    for (let i = 0; i < 4; i++) {
      G.particles.push({
        x: sx, y: sy,
        vx: Math.cos(a) * rnd(40, 130) + rnd(-30, 30),
        vy: Math.sin(a) * rnd(40, 130) + rnd(-30, 30),
        life: rnd(0.12, 0.3), max: 0.3, size: rnd(1, 2.2), color: e.color
      });
    }
  },

  updateEnemyShots(dt) {
    const p = G.player;
    const map = G.map;
    for (const b of G.eShots) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      if (MapGen.isWall(map, nx, ny)) {
        b.dead = true;
        for (let i = 0; i < 5; i++) {
          G.particles.push({
            x: b.x, y: b.y,
            vx: rnd(-120, 120), vy: rnd(-120, 120),
            life: rnd(0.12, 0.3), max: 0.3, size: rnd(1, 2.4), color: b.color
          });
        }
        continue;
      }
      b.x = nx; b.y = ny;
      if (!p.dead && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) * (b.r + p.r)) {
        this.hurtPlayer(b.dmg);
        b.dead = true;
      }
    }
    if (G.eShots.some(b => b.dead)) G.eShots = G.eShots.filter(b => !b.dead);
  },

  updateExtraction(dt) {
    const p = G.player;
    let near = null;
    if (!p.dead) {
      for (const pad of G.map.extracts) {
        if (dist(p.x, p.y, pad.x, pad.y) < pad.r) { near = pad; break; }
      }
    }
    G.extraction.nearPad = near;
    if (near) {
      G.extraction.progress += dt;
      /* 撤离时的收尾压力：逐步惊动附近敌人 */
      G.extraction.alertT = (G.extraction.alertT || 0) + dt;
      if (G.extraction.alertT > 0.7) {
        G.extraction.alertT = 0;
        this.alertAt(near.x, near.y, 470);
      }
      if (G.extraction.progress >= CFG.EXTRACT_HOLD) this.endRun(true);
    } else {
      G.extraction.progress = Math.max(0, G.extraction.progress - dt * 2.4);
      G.extraction.alertT = 0;
    }
  },

  /* ---------------- 渲染 ---------------- */
  render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CFG.VW, CFG.VH);

    if (G.state === 'title' || !G.map) {
      this.drawTitleBG();
      return;
    }

    const shake = G.cam.shake;
    const ox = shake > 0.2 ? rnd(-shake, shake) : 0;
    const oy = shake > 0.2 ? rnd(-shake, shake) : 0;
    const camX = Math.round(G.cam.x + ox);
    const camY = Math.round(G.cam.y + oy);

    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.drawImage(G.map.canvas, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    ctx.translate(-camX, -camY);

    this.drawPads();
    this.drawLoot();
    this.drawZones();
    this.drawEnemies();
    this.drawEnemyShots();
    this.drawPlayer();
    this.drawBullets();
    this.drawEffects();
    this.drawParticles();
    this.drawNumbers();

    ctx.restore();

    this.drawLighting(camX, camY);
    if (!G.inventoryOpen && G.state === 'playing') this.drawCrosshair();
  },

  drawTitleBG() {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, CFG.VW, CFG.VH);

    const t = performance.now() / 1000;
    const step = 64;
    const off = (t * 12) % step;

    ctx.strokeStyle = 'rgba(255,182,72,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -step + off; x < CFG.VW + step; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CFG.VH);
    }
    for (let y = -step + off; y < CFG.VH + step; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(CFG.VW, y);
    }
    ctx.stroke();

    const g = ctx.createRadialGradient(CFG.VW / 2, CFG.VH / 2, 40, CFG.VW / 2, CFG.VH / 2, 520);
    g.addColorStop(0, 'rgba(255,182,72,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.VW, CFG.VH);
  },

  drawPads() {
    const t = performance.now() / 1000;
    for (const pad of G.map.extracts) {
      const active = G.extraction.nearPad === pad;
      ctx.save();
      ctx.translate(pad.x, pad.y);

      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, pad.r);
      g.addColorStop(0, active ? 'rgba(10,110,145,0.20)' : 'rgba(10,110,145,0.10)');
      g.addColorStop(1, 'rgba(10,110,145,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, pad.r, 0, TAU);
      ctx.fill();

      ctx.rotate(t * 0.6);
      ctx.strokeStyle = 'rgba(10,110,145,0.75)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, pad.r - 6, (i / 4) * TAU + 0.16, (i / 4) * TAU + 0.62);
        ctx.stroke();
      }
      ctx.rotate(-t * 1.4);
      ctx.strokeStyle = 'rgba(10,110,145,0.38)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, pad.r - 16, 0, TAU);
      ctx.stroke();

      ctx.fillStyle = 'rgba(10,110,145,' + (active ? 0.95 : 0.65) + ')';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(7, 5);
      ctx.lineTo(-7, 5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  },

  drawLoot() {
    const t = performance.now() / 1000;
    const cx = G.cam.x, cy = G.cam.y;
    for (const it of G.loot) {
      if (it.taken) continue;
      if (it.x < cx - 60 || it.x > cx + VIEW_W + 60 || it.y < cy - 80 || it.y > cy + VIEW_H + 80) continue;
      const bob = Math.sin(t * 2 + it.phase) * 3;
      const col = it.tier.color;
      const y = it.y + bob;

      const g = ctx.createLinearGradient(0, y - 46, 0, y + 6);
      g.addColorStop(0, hexA(col, 0));
      g.addColorStop(1, hexA(col, 0.16));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(it.x - 7, y + 6);
      ctx.lineTo(it.x - 2, y - 46);
      ctx.lineTo(it.x + 2, y - 46);
      ctx.lineTo(it.x + 7, y + 6);
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.translate(it.x, y);
      ctx.rotate(Math.PI / 4 + Math.sin(t * 1.4 + it.phase) * 0.25);
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
  },

  drawZones() {
    const t = performance.now() / 1000;
    for (const z of G.zones) {
      const a = clamp(z.life / z.max, 0, 1);
      const pulse = 0.9 + Math.sin(t * 6 + z.phase) * 0.08;
      const g = ctx.createRadialGradient(z.x, z.y, 3, z.x, z.y, z.r * pulse);
      g.addColorStop(0, 'rgba(255,112,67,' + (0.30 * a).toFixed(3) + ')');
      g.addColorStop(0.65, 'rgba(255,80,40,' + (0.14 * a).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,60,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * pulse, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,130,70,' + (0.5 * a).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -t * 30;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * pulse, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  drawEnemies() {
    for (const e of G.enemies) {
      if (e.dead) continue;

      /* 地面影子 */
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 1, e.r * 1.3, e.r * 0.58, 0, 0, TAU);
      ctx.fill();

      /* 前摇提示：出伤前红环收紧 */
      if (e.atk && !e.atk.hit) {
        const def = CFG.ENEMY[e.type];
        const hitT = (def.hitFrame - 1) / def.atkFps;
        const k = clamp(e.atk.t / hitT, 0, 1);
        ctx.strokeStyle = 'rgba(255,70,60,' + (0.30 + 0.45 * k).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y - 6, e.r + 16 - 10 * k, 0, TAU);
        ctx.stroke();
      }

      EnemyArt.draw(ctx, e, e.hitFlash > 0 ? Math.min(0.6, e.hitFlash * 6) : 0);
    }
  },

  drawEnemyShots() {
    if (!G.eShots.length) return;
    for (const b of G.eShots) {
      if (b.dead) continue;
      ctx.save();
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(248,232,255,0.95)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  },

  drawPlayer() {
    const p = G.player;
    if (!p || p.dead) return;

    const moving = p.moving;
    const bob = moving ? Math.sin(G.time * 12) * 0.9 : Math.sin(G.time * 2.0) * 0.4;
    const pose = {
      x: p.x,
      y: p.y + 15,
      aim: p.aim,
      t: G.time,
      moving,
      /* 素材默认朝右：准星在左时水平镜像 */
      flip: Math.cos(p.aim) < 0 ? -1 : 1,
      frame: p.animFrame,
      character: p.character,
      bob,
      kick: p.kick
    };

    /* 分层：人物 → 武器；枪横在身前，压住方头下部 */
    PlayerArt.draw(ctx, pose);
    this.drawPlayerGun(p, pose);

    if (p.muzzleT > 0) {
      const pv = PlayerArt.pivot(pose);
      const mz = this.gunMuzzle(p.weapon);
      const a = Math.min(1, p.muzzleT / 0.055) * 0.8;
      ctx.fillStyle = 'rgba(255,240,200,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(pv.x + Math.cos(p.aim) * mz, pv.y + Math.sin(p.aim) * mz, 5, 0, TAU);
      ctx.fill();
    }
  },

  /* 枪口到握把的距离（像素），用于枪口火光位置 */
  gunMuzzle(w) {
    const g = Sprites.GUNS[w];
    return g.w * (1 - g.gx) + 3;
  },

  /* 武器：新侧视贴图，以握把为原点全向旋转；朝左时上下翻转，避免倒置 */
  drawPlayerGun(p, pose) {
    if (!Sprites.gunReady(p.weapon)) return;
    const g = Sprites.GUNS[p.weapon];
    const img = Sprites.guns[p.weapon];
    const gw = g.w;
    const gh = gw * (img.naturalHeight / img.naturalWidth);
    const pv = PlayerArt.pivot(pose);

    ctx.save();
    ctx.translate(pv.x, pv.y);
    ctx.rotate(p.aim);
    if (Math.cos(p.aim) < 0) ctx.scale(1, -1);
    ctx.shadowColor = WEAPONS[p.weapon].color;
    ctx.shadowBlur = 7;
    ctx.drawImage(img, -g.gx * gw, -g.gy * gh, gw, gh);
    ctx.restore();
  },

  drawBullets() {
    for (const b of G.bullets) {
      if (b.dead) continue;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      /* 白底衬边 */
      ctx.strokeStyle = 'rgba(8,24,38,0.42)';
      ctx.lineWidth = 4.8;
      ctx.stroke();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.7, 0, TAU);
      ctx.fill();
    }
  },

  drawEffects() {
    for (const fx of G.effects) {
      const t = clamp(fx.life / fx.max, 0, 1);
      if (fx.type === 'cone') {
        ctx.save();
        ctx.globalAlpha = t * 0.55;
        const g = ctx.createRadialGradient(fx.x, fx.y, 8, fx.x, fx.y, fx.range);
        g.addColorStop(0, hexA(fx.color, 0.5));
        g.addColorStop(0.7, hexA(fx.color, 0.12));
        g.addColorStop(1, hexA(fx.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.arc(fx.x, fx.y, fx.range, fx.ang - fx.half, fx.ang + fx.half);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = t;
        ctx.strokeStyle = hexA(fx.color, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.range * (1.05 - t * 0.15), fx.ang - fx.half, fx.ang + fx.half);
        ctx.stroke();
        ctx.restore();
      } else if (fx.type === 'laser') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 1.8);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(fx.pts[0].x, fx.pts[0].y);
        for (let i = 1; i < fx.pts.length; i++) {
          ctx.lineTo(fx.pts[i].x, fx.pts[i].y);
        }
        ctx.shadowColor = fx.color;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(8,24,38,0.38)';
        ctx.lineWidth = 9.5 * t + 3.5;
        ctx.stroke();
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 7 * t + 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * t).toFixed(2) + ')';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        for (let i = 1; i < fx.pts.length - 1; i++) {
          const p = fx.pts[i];
          ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * t).toFixed(2) + ')';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 * t + 1, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      } else if (fx.type === 'muzzle') {
        ctx.save();
        ctx.globalAlpha = t;
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.ang);
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(fx.size, -fx.size * 0.42);
        ctx.lineTo(fx.size * 0.6, 0);
        ctx.lineTo(fx.size, fx.size * 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(8,24,38,0.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      } else if (fx.type === 'spark') {
        ctx.save();
        ctx.globalAlpha = t;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.r * (1.4 - t), 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else if (fx.type === 'bolt') {
        ctx.save();
        ctx.globalAlpha = t;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = fx.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        const segs = 5;
        for (let i = 1; i < segs; i++) {
          const k = i / segs;
          const mx = lerp(fx.x1, fx.x2, k);
          const my = lerp(fx.y1, fx.y2, k);
          const nx = -(fx.y2 - fx.y1);
          const ny = fx.x2 - fx.x1;
          const nl = Math.hypot(nx, ny) || 1;
          const amp = rnd(-9, 9);
          ctx.lineTo(mx + (nx / nl) * amp, my + (ny / nl) * amp);
        }
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();
        ctx.restore();
      }
    }
  },

  drawParticles() {
    for (const p of G.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      /* 白底衬边，浅色火花才不至于消失 */
      ctx.fillStyle = 'rgba(8,22,36,0.35)';
      ctx.fillRect(p.x - p.size / 2 - 0.6, p.y - p.size / 2 - 0.6, p.size + 1.2, p.size + 1.2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  },

  drawNumbers() {
    ctx.textAlign = 'center';
    ctx.font = '700 13px Consolas, monospace';
    for (const n of G.numbers) {
      const a = clamp(n.life / n.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = n.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillText(n.text, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  },

  drawLighting(camX, camY) {
    const p = G.player;
    if (!p) return;
    const sx = (p.x - camX) * ZOOM;
    const sy = (p.y - camY) * ZOOM;

    const g = ctx.createRadialGradient(sx, sy, 90, sx, sy, 760);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.VW, CFG.VH);

    if (p.hp < p.maxHp * 0.35) {
      const pulse = 0.08 + Math.sin(performance.now() / 220) * 0.04;
      ctx.fillStyle = 'rgba(255,40,30,' + Math.max(0, pulse).toFixed(3) + ')';
      ctx.fillRect(0, 0, CFG.VW, CFG.VH);
    }
  },

  drawCrosshair() {
    const p = G.player;
    if (!p) return;
    const x = Input.mouse.x;
    const y = Input.mouse.y;
    const gap = 7 + p.spread * 190;
    const len = 7;

    /* 白底：先描一层深色衬边，琥珀色才看得清 */
    ctx.strokeStyle = 'rgba(12,22,32,0.55)';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,182,72,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,182,72,0.95)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
};

window.addEventListener('load', () => Game.init());
