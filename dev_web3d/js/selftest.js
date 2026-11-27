'use strict';

/* ============================================================
   自测：只在 ?selftest=1 时运行
   直接调用各模块的公开 API，把结果写到页面与 document.title
   ============================================================ */

(function () {
  if (!(typeof location !== 'undefined' && location.search.indexOf('selftest=1') >= 0)) return;

  const results = [];

  function check(name, ok, extra) {
    results.push({ name: name, ok: !!ok, extra: extra || '' });
  }
  function eq(name, a, b) {
    check(name, a === b, 'got ' + a + ' / want ' + b);
  }
  function near(name, a, b, eps) {
    check(name, Math.abs(a - b) <= (eps || 1e-6), 'got ' + a + ' / want ' + b);
  }

  function report() {
    const pass = results.filter(function (r) { return r.ok; }).length;
    const box = document.createElement('pre');
    box.id = 'selftest';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#07120a;color:#8ef29a;' +
      'font:11px/1.45 monospace;padding:8px 10px;max-height:100vh;overflow:auto;pointer-events:none;' +
      'white-space:pre-wrap;margin:0;';
    box.textContent = results.map(function (r) {
      return (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? ' :: ' + r.extra : '');
    }).join('\n') + '\nTOTAL ' + pass + '/' + results.length;
    document.body.appendChild(box);
    document.title = 'SELFTEST ' + pass + '/' + results.length;
    if (window.console) console.log(box.textContent);
  }

  /* ============================================================
     AI 卡门 / 卡墙压测
     用固定步长直接驱动 update()，统计清剿小队成员：
       frozen   想走但没有位移（卡住）
       illegal  站在连 AI 碰撞空间都不允许的位置（真卡进几何体）
       inDoor   站在门洞里；closed 被关上的门夹住；clip 压在门框墙体里
       doorFlip 门被反复开关（多个队员同时开门互相抵消）
     页面入口：?selftest=1&aistress=1（只跑压测）
     ============================================================ */
  const STRESS_ONLY = location.search.indexOf('aistress=1') >= 0;

  function stressDoors() {
    const out = [];
    const hs = World.houses || [];
    for (let i = 0; i < hs.length; i++) {
      for (let j = 0; j < hs[i].doors.length; j++) out.push(hs[i].doors[j]);
    }
    return out;
  }

  /* 选一个真正在屋内、且能站立的点（拿 door 的屋内一侧，最容易复现卡门） */
  function stressInsidePoint(h) {
    const pts = [];
    for (let i = 0; i < h.doors.length; i++) {
      const d = h.doors[i];
      const yaw = d.rect ? d.rect.yaw : 0;
      const nx = -Math.sin(yaw), nz = Math.cos(yaw);
      for (let k = 0; k < 4; k++) {
        const dist = 1.0 + k * 0.5;
        pts.push({ x: d.x + nx * dist, z: d.z + nz * dist });
        pts.push({ x: d.x - nx * dist, z: d.z - nz * dist });
      }
    }
    if (h.samples) for (let i = 0; i < h.samples.length; i++) pts.push(h.samples[i]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (World.houseAt(p.x, p.z, 0.05) !== h) continue;
      if (World.blocked(p.x, p.z, 0.5)) continue;
      return p;
    }
    return null;
  }

  /* 离小队最近、带门的房子 */
  function stressNearestHouse(members) {
    const hs = World.houses || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (!h.doors || !h.doors.length) continue;
      const p = stressInsidePoint(h);
      if (!p) continue;
      for (let m = 0; m < members.length; m++) {
        const d = Math.hypot(p.x - members[m].x, p.z - members[m].z);
        if (d < bd) { bd = d; best = { house: h, x: p.x, z: p.z }; }
      }
    }
    return best;
  }

  /* 找一栋有内门的房子：玩家在两间房之间来回跑，小队要反复穿过外门和内门 */
  function stressKiteHouse() {
    const hs = World.houses || [];
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      let inner = null, outer = null;
      for (let k = 0; k < h.doors.length; k++) {
        const d = h.doors[k];
        const interior = !!(d.module && d.module.interior);
        if (interior && !inner) inner = d;
        if (!interior && !outer) outer = d;
      }
      if (!inner || !outer) continue;
      const yaw = inner.rect ? inner.rect.yaw : 0;
      const nx = -Math.sin(yaw), nz = Math.cos(yaw);
      const a = { x: inner.x + nx * 1.5, z: inner.z + nz * 1.5 };
      const b = { x: inner.x - nx * 1.5, z: inner.z - nz * 1.5 };
      const ok = function (q) {
        return World.houseAt(q.x, q.z, 0.05) === h && !World.blocked(q.x, q.z, 0.5);
      };
      if (!ok(a) || !ok(b)) continue;
      const oy = outer.rect ? outer.rect.yaw : 0;
      let ox = -Math.sin(oy), oz = Math.cos(oy);
      const toCenter = (h.x - outer.x) * ox + (h.z - outer.z) * oz;
      if (toCenter > 0) { ox = -ox; oz = -oz; }
      const out = { x: outer.x + ox * 4.0, z: outer.z + oz * 4.0 };
      return { house: h, a: a, b: b, out: out };
    }
    return null;
  }

  function stressPhase(members, doors, ticks, dt, tag, agg, hooks) {
    const alive = members.filter(function (m) { return !m.dead; });
    const run = alive.map(function () { return 0; });
    const prog = alive.map(function () { return { best: Infinity, t: 0 }; });
    const before = alive.map(function (m) { return { x: m.x, z: m.z }; });
    const doorWas = doors.map(function (d) { return d.open; });
    const p = G.state.player;
    if (hooks && hooks.start) hooks.start(alive);
    const ph = agg.phases[tag] = {
      ticks: 0, memberTicks: 0, wantTicks: 0, frozen: 0, illegal: 0,
      inDoor: 0, clip: 0, closed: 0, travel: 0, worstRun: 0, worstAt: '',
      nearDoor: 0, minDist: Infinity, doorToggles: 0, doubleToggle: 0, reachT: -1
    };
    const info = agg.debug[tag] = {
      start: { px: +p.x.toFixed(1), pz: +p.z.toFixed(1) },
      houses: World.houses.length, doors: doors.length
    };
    /* 盯住“同一帧里同一扇门被开 / 关多次”：两名队员同帧 toggle 会互相抵消，
       门反而关上，于是整队顶着门板推 —— 实战里最像“卡在门里”的成因。 */
    const origToggle = World.toggleDoor;
    let tickToggles = {};
    World.toggleDoor = function (door) {
      const k = door.x.toFixed(2) + ',' + door.z.toFixed(2);
      tickToggles[k] = (tickToggles[k] || 0) + 1;
      ph.doorToggles++;
      return origToggle(door);
    };
    try {
      for (let t = 0; t < ticks; t++) {
        if (hooks && hooks.tick) hooks.tick(alive, t);
        /* 玩家打不死，小队也不会被打死：只测移动，不测战斗结算 */
        p.hp = p.maxHp = 1e9;
        p.shield = p.maxShield = 1e9;
        for (let i = 0; i < alive.length; i++) before[i].x = alive[i].x, before[i].z = alive[i].z;
        G.debug.tick(dt);
        ph.ticks++;
        for (let i = 0; i < alive.length; i++) {
          const m = alive[i];
          if (m.dead) { run[i] = 0; continue; }
          m.hp = m.maxHp = 1e9;
          m.shield = m.maxShield;
          ph.memberTicks++;
          const pd = Math.hypot(m.x - p.x, m.z - p.z);
          if (pd < ph.minDist) ph.minDist = pd;
          if (ph.reachT < 0 && pd < 3.5) ph.reachT = +(t / 60).toFixed(1);
          /* “没有进展”比“完全不动”更接近玩家看到的卡住：
             来回蹭墙 / 原地抖动也算卡住。1.5s 内离玩家没更近就采样。 */
          if (m.moving && m.state !== 'engage' && pd < prog[i].best - 0.2) { prog[i].best = pd; prog[i].t = 0; }
          else if (m.moving && m.state !== 'engage') {
            prog[i].t += dt;
            if (prog[i].t > 1.5 && agg.stuckSamples.length < 12) {
              prog[i].t = 0;
              const dirs = [0, 1, 2, 3].map(function (k) {
                const a = k * Math.PI / 2;
                return World.blocked(m.x + Math.cos(a) * 0.9, m.z + Math.sin(a) * 0.9, m.r) ? 1 : 0;
              });
              let mate = 99;
              for (let j = 0; j < alive.length; j++) {
                if (j === i || alive[j].dead) continue;
                const dd = Math.hypot(m.x - alive[j].x, m.z - alive[j].z);
                if (dd < mate) mate = dd;
              }
              const nd = World.nearestDoor(m.x, m.z);
              agg.stuckSamples.push({
                phase: tag, sec: +(t / 60).toFixed(1), state: m.state,
                hold: !!m.squadHolding, path: m.path ? m.path.length : -1,
                patrol: m.patrol ? [+m.patrol.x.toFixed(1), +m.patrol.z.toFixed(1)] : null,
                seen: [+(m.lastSeenX || 0).toFixed(1), +(m.lastSeenZ || 0).toFixed(1)],
                pos: [+m.x.toFixed(1), +m.z.toFixed(1)],
                dist: +pd.toFixed(1), wall: dirs, mate: +mate.toFixed(2),
                cramped: m.cramped ? 1 : 0, door: nd ? (nd.open ? 2 : 1) : 0,
                denied: +(m.houseDeniedT || 0).toFixed(2),
                wander: +(m.wanderT || 0).toFixed(2),
                pathGoal: m.pathGoal ? [+m.pathGoal.x.toFixed(1), +m.pathGoal.z.toFixed(1)] : null
              });
            }
          }
          const disp = Math.hypot(m.x - before[i].x, m.z - before[i].z);
          ph.travel += disp;
          if (m.moving) {
            ph.wantTicks++;
            if (disp < 0.004) {
              ph.frozen++;
              run[i]++;
              if (run[i] > ph.worstRun) { ph.worstRun = run[i]; ph.worstAt = tag + '#' + i; }
              if (run[i] === 30 && agg.freezeSamples.length < 10) {
                /* 冻住 0.5 秒：抓一份现场，判断是撞墙 / 被队友堵 / 没路径 */
                const dirs = [0, 1, 2, 3].map(function (k) {
                  const a = k * Math.PI / 2;
                  return World.blocked(m.x + Math.cos(a) * 0.9, m.z + Math.sin(a) * 0.9, m.r) ? 1 : 0;
                });
                let mate = 99;
                for (let j = 0; j < alive.length; j++) {
                  if (j === i || alive[j].dead) continue;
                  const dd = Math.hypot(m.x - alive[j].x, m.z - alive[j].z);
                  if (dd < mate) mate = dd;
                }
                const goal = m.patrol || (m.squadRef && m.squadRef.target) || null;
                const nd = World.nearestDoor(m.x, m.z);
                agg.freezeSamples.push({
                  phase: tag, t: +(t / 60).toFixed(1),
                  state: m.state, hold: !!m.squadHolding,
                  path: m.path ? m.path.length : -1,
                  goal: goal ? [+goal.x.toFixed(1), +goal.z.toFixed(1)] : null,
                  seen: [+(m.lastSeenX || 0).toFixed(1), +(m.lastSeenZ || 0).toFixed(1)],
                  pos: [+m.x.toFixed(1), +m.z.toFixed(1)],
                  wall: dirs, mate: +mate.toFixed(2),
                  door: nd ? 1 : 0, doorOpen: nd ? (nd.open ? 1 : 0) : -1,
                  house: World.houseAt(m.x, m.z, 0.05) ? 1 : 0,
                  denied: +(m.houseDeniedT || 0).toFixed(2)
                });
              }
            } else run[i] = 0;
          } else run[i] = 0;
          if (World.blocked(m.x, m.z, m.r, true)) ph.illegal++;
          const d = World.nearestDoor(m.x, m.z);
          if (d) {
            ph.nearDoor++;
            if (World.doorOccupied(d, m.x, m.z, m.r)) {
              ph.inDoor++;
              if (World.isDoorClosed(d)) ph.closed++;
              else if (World.blocked(m.x, m.z, m.r, false)) ph.clip += 0.5;
            }
          }
        }
        for (let i = 0; i < doors.length; i++) {
          if (doors[i].open !== doorWas[i]) { agg.doorFlips++; doorWas[i] = doors[i].open; }
        }
        for (const k in tickToggles) if (tickToggles[k] > 1) ph.doubleToggle++;
        tickToggles = {};
      }
    } finally {
      World.toggleDoor = origToggle;
    }
    /* 汇总到全局 */
    const keys = ['ticks', 'memberTicks', 'wantTicks', 'frozen', 'illegal', 'inDoor',
      'clip', 'closed', 'travel', 'doorToggles', 'doubleToggle'];
    for (let i = 0; i < keys.length; i++) agg[keys[i]] += ph[keys[i]];
    if (ph.worstRun > agg.worstRun) { agg.worstRun = ph.worstRun; agg.worstTag = ph.worstAt; }
    ph.minDist = +ph.minDist.toFixed(1);
    ph.end = { px: +p.x.toFixed(1), pz: +p.z.toFixed(1),
      m0: [+alive[0].x.toFixed(1), +alive[0].z.toFixed(1)] };
    /* 阶段末每名队员的状态快照：看清“不走”到底是因为什么 */
    ph.snap = alive.map(function (m) {
      return {
        pos: [+m.x.toFixed(1), +m.z.toFixed(1)], st: m.state,
        moving: m.moving ? 1 : 0, hold: m.squadHolding ? 1 : 0,
        lostT: +(m.lostT || 0).toFixed(1), path: m.path ? m.path.length : -1,
        patrol: m.patrol ? [+m.patrol.x.toFixed(1), +m.patrol.z.toFixed(1)] : null,
        seen: [+(m.lastSeenX || 0).toFixed(1), +(m.lastSeenZ || 0).toFixed(1)],
        tgt: (m.squadRef && m.squadRef.target) ? m.squadRef.target.kind : null,
        denied: +(m.houseDeniedT || 0).toFixed(2),
        wall: [0, 1, 2, 3].map(function (k) {
          const a = k * Math.PI / 2;
          return World.blocked(m.x + Math.cos(a) * 0.9, m.z + Math.sin(a) * 0.9, m.r) ? 1 : 0;
        })
      };
    });
  }

  /* 压测专用地图：全地板 + 3 栋带内门的房子 + 一条 2m 窄走廊 */
  function stressMapSpec() {
    const n = 44;
    const rows = [];
    for (let z = 0; z < n; z++) {
      let row = '';
      for (let x = 0; x < n; x++) row += '1';
      rows.push(row.split(''));
    }
    function solid(x0, x1, z0, z1) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) rows[z][x] = '0';
      }
    }
    function floorCell(x0, x1, z0, z1) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) rows[z][x] = '1';
      }
    }
    /* 窄走廊：两侧实心，只有中间一格（2m）能过 */
    solid(26, 34, 18, 24);
    floorCell(26, 34, 21, 21);
    /* 死胡同：进去以后必须原路退出来 */
    solid(6, 10, 28, 34);
    floorCell(8, 10, 31, 31);
    floorCell(8, 8, 31, 33);

    return {
      name: 'aistress',
      cols: n, rows: n,
      floor: rows.map(function (r) { return r.join(''); }),
      houses: [
        { id: 'A', cells: [[4, 4], [5, 4], [6, 4], [7, 4], [4, 5], [5, 5], [6, 5], [7, 5], [4, 6], [5, 6], [6, 6], [7, 6]],
          doors: [{ cx: 5, cz: 6, dir: 'front' }, { cx: 4, cz: 4, dir: 'back' }],
          partitions: [{ cx: 6, cz: 4, dir: 'right', door: true }, { cx: 6, cz: 5, dir: 'right', door: false }] },
        { id: 'B', cells: [[12, 4], [13, 4], [14, 4], [15, 4], [12, 5], [13, 5], [14, 5], [15, 5], [12, 6], [13, 6], [14, 6], [15, 6]],
          doors: [{ cx: 13, cz: 4, dir: 'back' }, { cx: 14, cz: 6, dir: 'front' }, { cx: 15, cz: 5, dir: 'right' }],
          partitions: [{ cx: 14, cz: 5, dir: 'right', door: true }] },
        { id: 'C', cells: [[20, 8], [21, 8], [22, 8], [23, 8], [20, 9], [21, 9], [22, 9], [23, 9], [20, 10], [21, 10], [22, 10], [23, 10], [20, 11], [21, 11], [22, 11], [23, 11]],
          doors: [{ cx: 21, cz: 8, dir: 'back' }, { cx: 23, cz: 9, dir: 'right' }],
          partitions: [{ cx: 21, cz: 9, dir: 'right', door: true }, { cx: 21, cz: 10, dir: 'right', door: false }] }
      ],
      props: [],
      chests: [],
      loot: [],
      enemies: [
        { x: 22, z: 40, type: 'squad', count: 2, radius: 3 },
        { x: 52, z: 54, type: 'squad', count: 1, radius: 3 }
      ],
      playerSpawns: [{ x: 8, z: 76 }],
      extractions: [{ x: 80, z: 80 }]
    };
  }

  function stressEnsureMap() {
    const id = 'selftest_aistress';
    if (typeof MAPSTORE === 'undefined') return null;
    MAPSTORE.save(Object.assign(stressMapSpec(), { id: id }));
    return id;
  }

  function runSquadStress(opts) {
    opts = opts || {};
    const rounds = opts.rounds || 1;
    const roamT = opts.roamT || 10;
    const fightT = opts.fightT || 10;
    const corridorT = opts.corridorT === undefined ? 10 : opts.corridorT;
    const kiteT = opts.kiteT === undefined ? 12 : opts.kiteT;
    const dt = 1 / 60;
    const mapId = stressEnsureMap();
    const agg = {
      rounds: 0, samples: 0, ticks: 0, memberTicks: 0, wantTicks: 0,
      frozen: 0, illegal: 0, inDoor: 0, closed: 0, clip: 0,
      travel: 0, doorFlips: 0, doorToggles: 0, doubleToggle: 0,
      worstRun: 0, worstTag: '', ms: 0, debug: {}, phases: {}, freezeSamples: [], stuckSamples: [],
      houses: 0, doors: 0
    };
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (let r = 0; r < rounds; r++) {
      G.toLobby();
      Store.reset();
      G.beginMission({ weapons: [3], mags: [1], data: 0, character: 0, mapId: mapId || undefined });
      G.setPaused(false);
      const p = G.state.player;
      const members = G.state.enemies.filter(function (e) { return !!e.squadRef; });
      if (members.length < 4) continue;
      agg.rounds++;
      agg.samples += members.length;
      const doors = stressDoors();
      /* AI 开门必须是幂等的“只开不关”：两名队员先后点同一扇门不能互相抵消。 */
      if (doors.length && !agg.openDoorTest) {
        const dtest = doors[0];
        const wasOpen = dtest.open;
        dtest.open = false;
        agg.openDoorTest = {
          open: World.openDoor(dtest) === true && dtest.open === true,
          again: World.openDoor(dtest) === false && dtest.open === true
        };
        dtest.open = wasOpen;
      }
      agg.houses = World.houses.length;
      agg.doors = doors.length;
      if (!doors.length) continue;

      /* A. 中立巡逻：玩家放在地图另一头，只看走路 / 绕墙 / 窄走廊 */
      p.x = 8; p.z = 76;
      stressPhase(members, doors, Math.round(roamT * 60), dt, 'roam', agg);

      /* B. 敌对追击：玩家躲在屋里，只让“离这栋房子最近的那支小队”在门口被激怒。
         这是实战里最容易“卡门”的一幕：队里四个人一起挤门口。 */
      const target = stressNearestHouse(members);
      let active = members;
      if (target) {
        /* 按 squadRef 分组，挑离目标房子最近的一支 */
        const groups = {};
        for (let i = 0; i < members.length; i++) {
          const k = members[i].squadRef ? members[i].squadRef.id : 'x' + i;
          (groups[k] = groups[k] || []).push(members[i]);
        }
        let bestD = Infinity;
        for (const k in groups) {
          const g = groups[k];
          for (let i = 0; i < g.length; i++) {
            const d = Math.hypot(g[i].x - target.x, g[i].z - target.z);
            if (d < bestD) { bestD = d; active = g; }
          }
        }
        const door = target.house.doors[0];
        p.x = target.x; p.z = target.z;
        p.yaw = Math.atan2(door.x - p.x, door.z - p.z);
        /* 门法线，取指向屋外的一侧 */
        const yaw = door.rect ? door.rect.yaw : 0;
        let nx = -Math.sin(yaw), nz = Math.cos(yaw);
        const toCenter = (target.house.x - door.x) * nx + (target.house.z - door.z) * nz;
        if (toCenter > 0) { nx = -nx; nz = -nz; }
        const lx = Math.cos(yaw), lz = -Math.sin(yaw);
        for (let i = 0; i < active.length; i++) {
          const lat = (i - (active.length - 1) / 2) * 1.5;
          for (let k = 0; k < 12; k++) {
            const back = 5.0 + k * 1.2;
            const mx = door.x + nx * back + lx * lat;
            const mz = door.z + nz * back + lz * lat;
            if (World.blocked(mx, mz, active[i].r)) continue;
            active[i].x = mx; active[i].z = mz;
            active[i].path = null; active[i].pathGoal = null;
            break;
          }
        }
      }
      const vi = G.state.enemies.indexOf(active[0]);
      if (vi >= 0) G.debug.hurtEnemy(vi, 1);
      stressPhase(active, doors, Math.round(fightT * 60), dt, 'fight', agg, {
        /* 模拟玩家在屋里持续暴露位置：否则 6 秒丢失目击就会放弃搜索 */
        tick: function (alive, t) {
          if (t % 90 !== 0) return;
          for (let i = 0; i < alive.length; i++) {
            const m = alive[i];
            if (m.dead) continue;
            m.lostT = 0;
            m.lastSeenX = p.x;
            m.lastSeenZ = p.z;
          }
        }
      });
      /* C. 窄走廊：四人必须在 2m 宽的通道里排队前进。
         玩家放在走廊另一头、视野外（26m），逼他们真的走完这条通道。 */
      p.x = 76; p.z = 43;
      for (let i = 0; i < active.length; i++) {
        const mx = 47 + (i % 4) * 1.3;
        const mz = 41.4 + Math.floor(i / 4) * 2.4;
        if (!World.blocked(mx, mz, active[i].r)) { active[i].x = mx; active[i].z = mz; }
        active[i].path = null; active[i].pathGoal = null;
      }
      stressPhase(active, doors, Math.round(corridorT * 60), dt, 'corridor', agg, {
        tick: function (alive, t) {
          if (t % 120 !== 0) return;
          for (let i = 0; i < alive.length; i++) {
            const m = alive[i];
            if (m.dead) continue;
            m.lostT = 0;
            m.lastSeenX = p.x;
            m.lastSeenZ = p.z;
          }
        }
      });
      /* D. 隔门追人：玩家在两间房里来回换位，小队必须反复穿外门 + 内门。
         这是玩家最常看到的“卡在门里”的一刻。 */
      const kite = stressKiteHouse();
      if (kite && active.length) {
        for (let i = 0; i < active.length; i++) {
          const mx = kite.out.x + (i - (active.length - 1) / 2) * 1.4;
          const mz = kite.out.z + ((i % 2) ? 1.6 : -1.6);
          if (!World.blocked(mx, mz, active[i].r)) { active[i].x = mx; active[i].z = mz; }
          active[i].path = null; active[i].pathGoal = null;
        }
        p.x = kite.a.x; p.z = kite.a.z;
        /* 重新“激怒”一次：makeSquadHostile 会把这栋房子的情报打上，
           等价于玩家在这栋屋里开了枪。否则小队按规则根本不会进未侦察的房子。 */
        if (active[0].squadRef) active[0].squadRef.hostile = false;
        for (let i = 0; i < active.length; i++) active[i].relation = 'neutral';
        const ki = G.state.enemies.indexOf(active[0]);
        if (ki >= 0) G.debug.hurtEnemy(ki, 1);
        stressPhase(active, doors, Math.round(kiteT * 60), dt, 'kite', agg, {
          tick: function (alive, t) {
            /* 每 4 秒玩家换房间，逼小队反复过门 */
            if (t > 0 && t % 240 === 0) {
              const to = (Math.floor(t / 240) % 2) ? kite.b : kite.a;
              p.x = to.x; p.z = to.z;
            }
            if (t % 30 !== 0) return;
            for (let i = 0; i < alive.length; i++) {
              const m = alive[i];
              if (m.dead) continue;
              m.lostT = 0;
              m.lastSeenX = p.x;
              m.lastSeenZ = p.z;
            }
          }
        });
      }
    }
    agg.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    if (typeof MAPSTORE !== 'undefined' && mapId) MAPSTORE.remove(mapId);
    return agg;
  }

  function reportStress(agg, prefix) {
    const frozenPct = agg.wantTicks ? (agg.frozen / agg.wantTicks * 100) : 0;
    const illegalPct = agg.memberTicks ? (agg.illegal / agg.memberTicks * 100) : 0;
    const doorPct = agg.memberTicks ? (agg.inDoor / agg.memberTicks * 100) : 0;
    const summary = prefix + ' ' + JSON.stringify({
      rounds: agg.rounds, sec: +(agg.ticks / 60).toFixed(1), ms: agg.ms,
      houses: agg.houses, doors: agg.doors,
      frozenPct: +frozenPct.toFixed(2), illegalPct: +illegalPct.toFixed(2),
      doorPct: +doorPct.toFixed(2), closedDoor: agg.closed,
      frameClipTicks: Math.round(agg.clip), doorFlips: agg.doorFlips,
      doorToggles: agg.doorToggles, doubleToggle: agg.doubleToggle,
      travel: Math.round(agg.travel), worstFrozenSec: +(agg.worstRun / 60).toFixed(2),
      worstAt: agg.worstTag
    });
    if (window.console) {
      console.log(summary);
      const phOut = {};
      for (const k in agg.phases) {
        const ph = agg.phases[k];
        phOut[k] = {
          sec: +(ph.ticks / 60).toFixed(1),
          frozenPct: ph.wantTicks ? +(ph.frozen / ph.wantTicks * 100).toFixed(2) : 0,
          doorPct: ph.memberTicks ? +(ph.inDoor / ph.memberTicks * 100).toFixed(2) : 0,
          doorTicks: ph.inDoor, clip: Math.round(ph.clip), closed: ph.closed,
          toggles: ph.doorToggles, dbl: ph.doubleToggle,
          worst: +(ph.worstRun / 60).toFixed(2), minDist: ph.minDist, reach: ph.reachT,
          travel: Math.round(ph.travel), end: ph.end, snap: ph.snap
        };
      }
      console.log(prefix + '_PHASE ' + JSON.stringify(phOut));
      if (agg.debug) console.log(prefix + '_DBG ' + JSON.stringify(agg.debug));
      if (agg.freezeSamples && agg.freezeSamples.length) {
        console.log(prefix + '_FREEZE ' + JSON.stringify(agg.freezeSamples));
      }
      if (agg.stuckSamples && agg.stuckSamples.length) {
        console.log(prefix + '_STUCK ' + JSON.stringify(agg.stuckSamples));
      }
    }
    return {
      frozenPct: frozenPct, illegalPct: illegalPct, doorPct: doorPct, closedDoor: agg.closed,
      clipTicks: Math.round(agg.clip), doorFlips: agg.doorFlips,
      doorToggles: agg.doorToggles, doubleToggle: agg.doubleToggle,
      worstFrozenSec: agg.worstRun / 60
    };
  }

  function stressNum(name, def) {
    const m = new RegExp('[?&]' + name + '=([0-9.]+)').exec(location.search);
    return m ? parseFloat(m[1]) : def;
  }

  function run() {
    try {
      if (STRESS_ONLY) {
        const agg = runSquadStress({
          rounds: Math.max(1, Math.round(stressNum('rounds', 1))),
          roamT: stressNum('roamT', 12),
          fightT: stressNum('fightT', 12),
          corridorT: stressNum('corridorT', 10),
          kiteT: stressNum('kiteT', 12)
        });
        reportStress(agg, 'AISTRESS');
        check('stress ran', agg.rounds > 0 && agg.memberTicks > 0, JSON.stringify(agg));
        report();
        return;
      }
      /* ---------- 0. 新档 ---------- */
      Store.reset();
      eq('bank default', Store.bank(), CFG.START_BANK);
      eq('stash empty', Store.stashCount(), 0);
      eq('gadget starter', Store.loadout().gadgets.join(','), 'knife,grenade');
      eq('gadget slots', Store.loadout().gadgets.length, 2);
      eq('augment zero', Store.aug('armor'), 0);
      eq('invRows default', Store.invRows(), 4);
      eq('maxHp default', Store.maxHp(), CFG.PLAYER.hp);

      /* ---------- 1. 网格 ---------- */
      const probe = { name: 'probe', tierId: 'rare', w: 2, h: 3, value: 80, time: 2.8, rot: 0 };
      const items = [];
      const placed = Grid.cloneItem(probe);
      check('autoPlace 2x3', Grid.autoPlace(items, placed, 6, 4));
      items.push(placed);
      eq('placed x', items[0].gx, 0);
      eq('dims rotated', Grid.dims(items[0], 1).w, 3);
      eq('used cells', Grid.usedCells(items), 6);
      check('no overlap fit', !Grid.fits(items, probe, 1, 0, 0, 6, 4, null));

      /* ---------- 2. 品质与物资 ---------- */
      const epic = ITEMS.roll('epic', function () { return 0.5; });
      eq('epic tier', epic.tierId, 'epic');
      check('epic size', epic.w * epic.h >= 4, epic.w + 'x' + epic.h);
      check('epic value range', epic.value >= 160 && epic.value <= 220, epic.value);
      check('epic has elements', ITEMS.elementTotal(epic.elements) > 0, ITEMS.elementSummary(epic.elements));
      eq('tier color', ITEMS.tier('rare').color, '#4d8bff');
      eq('element count', ELEMENTS.length, 5);
      eq('default element each', Store.element('acoustic'), CFG.START_ELEMENTS);
      eq('default element pool total', ITEMS.elementTotal(Store.elements()), CFG.START_ELEMENTS * ELEMENTS.length);
      check('found weapon has elements', ITEMS.elementTotal(ITEMS.makeWeaponItem(3, { found: true }).elements) > 0);
      check('crafted weapon has no elements', ITEMS.elementTotal(ITEMS.makeWeaponItem(3).elements) === 0);
      check('found series chip has elements', ITEMS.elementTotal(ITEMS.makeChipItem({
        chipId: 'laser_prism', tierId: 'rare', value: 220
      }, { found: true }).elements) > 0);

      /* ---------- 3. 仓库 ---------- */
      const mats = [ITEMS.roll('common'), ITEMS.roll('fine'), ITEMS.roll('rare')];
      let added = 0;
      mats.forEach(function (m) { if (Store.stashAdd(m)) added++; });
      eq('stash add 3', added, 3);
      eq('stash count', Store.stashCount(), 3);
      const stashValue = Store.stashValue();
      const bank0 = Store.bank();
      const first = Store.stash()[0];
      const firstEl = ITEMS.elementTotal(first.elements);
      const elBefore = ITEMS.elementTotal(Store.elements());
      const got = Store.stashDismantle(first);
      eq('dismantle returns value', got, first.value);
      eq('bank after dismantle', Store.bank(), bank0 + first.value);
      eq('stash dismantle grants elements', ITEMS.elementTotal(Store.elements()), elBefore + firstEl);
      eq('stash count after', Store.stashCount(), 2);
      eq('stash value after', Store.stashValue(), stashValue - first.value);
      Store.stashRepack();
      eq('repack keeps items', Store.stashCount(), 2);
      const allElBefore = ITEMS.elementTotal(Store.elements());
      const allElSum = Store.stash().reduce(function (n, it) { return n + ITEMS.elementTotal(it.elements); }, 0);
      const allR = Store.stashDismantleAll();
      eq('dismantle all count', allR.count, 2);
      eq('dismantle all grants elements', ITEMS.elementTotal(Store.elements()), allElBefore + allElSum);
      eq('stash empty after all', Store.stashCount(), 0);

      /* ---------- 4. 大厅 DOM ---------- */
      eq('tabs built', document.querySelectorAll('#lobbyTabs .tab').length, 6);
      ['paneStash', 'paneCraft', 'paneShop', 'paneContracts', 'paneArchive'].forEach(function (id) {
        check('pane ' + id, !!document.getElementById(id));
      });
      check('lobby visible', !document.getElementById('lobby').classList.contains('hidden'));
      eq('char cards', document.querySelectorAll('#lobbyChars .char-card').length, 12);
      check('tactical unit exists', !!MODELS.UNITS.tactical);
      check('scav units exist', !!MODELS.UNITS.scav && !!MODELS.UNITS.raider && !!MODELS.UNITS.veteran);
      check('sci-fi squad units exist', !!MODELS.UNITS.specter && !!MODELS.UNITS.ranger && !!MODELS.UNITS.breacher);
      check('power armour units exist', !!MODELS.UNITS.juggernaut && !!MODELS.UNITS.vanguard && !!MODELS.UNITS.sentinel);
      check('blender character models loaded', !!(MODELS.UNITS.specter && MODELS.UNITS.specter.squashed));
      const allUnits = Object.keys(MODELS.UNITS).map(function (k) { return MODELS.UNITS[k]; });
      check('all parts have bone group', allUnits.every(function (u) {
        return u.parts.every(function (p) { return p.grp !== undefined; });
      }));
      check('no chest panel bound to head', allUnits.every(function (u) {
        return u.parts.every(function (p) {
          return !(p.grp === 'head' && p.y < 0.9 && p.sy < 0.08 && p.sx > 0.25 && p.z > 0.15);
        });
      }));
      check('no backpack bound to head', allUnits.every(function (u) {
        return u.parts.every(function (p) { return !(p.grp === 'head' && p.z < -0.2); });
      }));
      check('boots follow legs', ['tactical', 'scav', 'raider', 'veteran', 'specter', 'ranger',
        'breacher', 'juggernaut', 'vanguard', 'sentinel'].every(function (k) {
        return MODELS.UNITS[k].parts.filter(function (p) {
          return p.y < 0.12 && Math.abs(p.x) > 0.05 && p.sy > 0.03;
        }).every(function (p) { return !!p.leg; });
      }));
      check('weapon crate model ready', ASSETS.weaponcrate.ready);
      Store.setChar(2);
      eq('tactical char selectable', Store.char(), 2);
      Store.setChar(5);
      eq('veteran char selectable', Store.char(), 5);
      Store.setChar(11);
      eq('sentinel char selectable', Store.char(), 11);
      Store.setChar(99);
      eq('char index clamps to last', Store.char(), 11);
      Store.setChar(0);

      /* ---------- 5. 出击 ---------- */
      G.beginMission({ weapons: [3, 0], mags: [2, 1], data: 300, character: 1 });
      G.setPaused(false);   // 竖屏触屏环境会自动暂停，自测里显式恢复
      const p = G.state.player;
      eq('mode mission', G.mode, 'mission');
      eq('carried 2', p.carried.length, 2);
      eq('weapon slot 0', p.weapon, 3);
      eq('kinetic loaded', p.mags[0], WEAPONS[3].mag);
      eq('kinetic spare 1', p.spares[0], 1);
      eq('sonic loaded', p.mags[1], WEAPONS[0].mag);
      eq('sonic spare 0', p.spares[1], 0);
      eq('carry data', p.data, 300);
      eq('character assault', p.charKey, 'assault');
      eq('hud slots', document.querySelectorAll('#slots .slot').length, 2);
      check('hud visible', !document.getElementById('hud').classList.contains('hidden'));
      check('world has loot', World.loot.length >= 20, World.loot.length);
      check('loot near count', World.loot.length <= CFG.LOOT_COUNT + 8, World.loot.length);
      check('loot has item', !!(World.loot[0] && World.loot[0].item));
      const gunners = G.state.enemies.filter(function (e) { return e.gunner && !e.squadRef; });
      eq('gunner count', gunners.length, CFG.GUNNER_COUNT);
      check('gunner armed', gunners.length > 0 && gunners[0].ammo === WEAPONS[CFG.GUNNER.weaponId].mag);
      check('gunner has loot bag', gunners.length > 0 && Array.isArray(gunners[0].lootBag) && gunners[0].lootBag.length > 0);
      const squadMembers = G.state.enemies.filter(function (e) { return !!e.squadRef; });
      eq('squad size', squadMembers.length, 4);
      check('squad leader', squadMembers.some(function (e) { return e.isLeader && e.type === 'tactical'; }));
      check('squad neutral', squadMembers.length > 0 && squadMembers.every(function (e) { return e.relation === 'neutral'; }));
      check('squad has shields', squadMembers.length > 0 &&
        squadMembers.every(function (e) { return e.maxShield > 0 && e.shield === e.maxShield; }));
      const squadLeader = squadMembers.filter(function (e) { return e.isLeader; })[0];
      check('squad leader shield stronger', !!squadLeader &&
        squadLeader.maxShield > (squadMembers.filter(function (e) { return !e.isLeader; })[0] || { maxShield: 0 }).maxShield);
      const undead = G.state.enemies.filter(function (e) { return !e.gunner && !e.dead; });
      check('enemy factions', gunners.length > 0 && undead.length > 0 &&
        gunners[0].faction === 'scav' && undead[0].faction === 'undead');

      /* 视野：120° 视锥 + 24m + 墙体/木箱遮挡 */
      check('vision cone front', G.vision(p.x, p.z + 0.4));
      check('vision cone behind', !G.vision(p.x, p.z - 0.4));
      check('vision self', G.vision(p.x, p.z));
      check('vision range', !G.vision(p.x, p.z + 25));

      /* 光学反射：任意方向撞墙后，反射起点必须仍在地板上（贴墙/墙角不丢反射） */
      let reflFail = 0, reflHits = 0;
      for (let cz = 1; cz < World.H - 1 && reflFail === 0; cz += 3) {
        for (let cx = 1; cx < World.W - 1 && reflFail === 0; cx += 3) {
          if (!World.isFloor(cx, cz)) continue;
          const cc = World.cellCenter(cx, cz);
          for (let k = 0; k < 12 && reflFail === 0; k++) {
            let ox = cc.x, oz = cc.z, a = k / 12 * Math.PI * 2, remain = 60;
            for (let b = 0; b <= 3; b++) {
              const dx = Math.sin(a), dz = Math.cos(a);
              const hit = World.rayWallHit(ox, oz, dx, dz, remain);
              if (!hit.axis) break;
              remain -= hit.d;
              if (remain <= 0.05) break;
              let nx = dx, nz = dz;
              if (hit.axis === 'x' || hit.axis === 'both') nx = -nx;
              if (hit.axis === 'z' || hit.axis === 'both') nz = -nz;
              let hx = ox + dx * hit.d, hz = oz + dz * hit.d;
              if (hit.axis === 'x' || hit.axis === 'both') hx -= Math.sign(dx) * 0.012;
              if (hit.axis === 'z' || hit.axis === 'both') hz -= Math.sign(dz) * 0.012;
              if (!World.isFloorAt(hx, hz)) {
                const back = Math.min(0.06, hit.d);
                hx -= dx * back;
                hz -= dz * back;
              }
              ox = hx; oz = hz;
              reflHits++;
              if (!World.isFloorAt(ox, oz)) { reflFail++; break; }
              a = Math.atan2(nx, nz);
            }
          }
        }
      }
      check('laser reflection stays on floor', reflFail === 0, reflFail + ' / ' + reflHits);

      /* 通用 AI 寻路：选一对被墙隔开的可站立点，A* 必须能绕过去 */
      let aiFrom = null, aiTo = null;
      for (let cz = 2; cz < World.H - 2 && !aiFrom; cz += 2) {
        for (let cx = 2; cx < World.W - 2 && !aiFrom; cx += 2) {
          if (!World.isFloor(cx, cz)) continue;
          const a = World.cellCenter(cx, cz);
          if (World.blocked(a.x, a.z, 0.5)) continue;
          for (let dz = -5; dz <= 5 && !aiFrom; dz++) {
            for (let dx = -5; dx <= 5 && !aiFrom; dx++) {
              if (!dx && !dz) continue;
              const d = Math.hypot(dx, dz) * 2;
              if (d < 5 || d > 10) continue;
              if (!World.isFloor(cx + dx, cz + dz)) continue;
              const b = World.cellCenter(cx + dx, cz + dz);
              if (World.blocked(b.x, b.z, 0.5)) continue;
              if (World.los(a.x, a.z, b.x, b.z)) continue;
              aiFrom = a;
              aiTo = b;
            }
          }
        }
      }
      const aiPath = aiFrom ? World.findPath(aiFrom.x, aiFrom.z, aiTo.x, aiTo.z) : null;
      check('all-unit AI path detours around walls', !!aiPath && aiPath.length > 1);

      /* ---------- 6. 背包 / 拖拽 / 旋转 / 右键分解 ---------- */
      Inventory.open();
      check('inventory open', Inventory.isOpen());
      const mat = ITEMS.roll('rare', function () { return 0.2; });
      check('inventory add', Inventory.addItem(mat));
      eq('inventory count', p.inv.length, 1);
      Inventory.close();
      Inventory.open();
      check('inventory auto-selected', !!p.sel);
      p.sel = null;
      Inventory.refresh();

      /* 拖拽一格：mousedown → mousemove → mouseup */
      const node0 = document.querySelector('#invItems .inv-item');
      check('item rendered', !!node0);
      const rect0 = node0.getBoundingClientRect();
      const gridEl = document.getElementById('invGrid');
      const cellW = parseFloat(getComputedStyle(gridEl).gridTemplateColumns) || 72;
      const gapW = parseFloat(getComputedStyle(gridEl).columnGap) || 8;
      const pitchW = cellW + gapW;
      node0.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse',
        clientX: rect0.left + 8, clientY: rect0.top + 8
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, buttons: 1, pointerId: 1, pointerType: 'mouse',
        clientX: rect0.left + 8 + pitchW, clientY: rect0.top + 8
      }));
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse'
      }));
      eq('drag moves item', p.inv[0].gx, 1);
      eq('drag keeps row', p.inv[0].gy, 0);

      /* 旋转：空间足够时应切换朝向 */
      p.sel = p.inv[0];
      const rot0 = p.inv[0].rot;
      const rotated = Inventory.rotate();
      check('rotate toggles', rotated && p.inv[0].rot !== rot0, p.inv[0].rot);

      /* 右键分解：contextmenu 应开始读条 */
      const node1 = document.querySelector('#invItems .inv-item');
      const dataBefore = p.data;
      const raidElBefore = ITEMS.elementTotal(Store.elements());
      node1.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2
      }));
      eq('right click starts dismantle', Inventory.actionType(), 'dismantle');
      /* 分解中的物品锁定在当前容器：不能被移除或旋转 */
      const locking = p.inv[0];
      Inventory.removeItem(locking);
      check('dismantling item stays in bag', p.inv.indexOf(locking) >= 0);
      check('dismantling item cannot rotate', !Inventory.rotate());
      Inventory.debugComplete();
      eq('dismantle added data', p.data, dataBefore + mat.value);
      eq('raid dismantle grants no elements', ITEMS.elementTotal(Store.elements()), raidElBefore);
      eq('inventory empty', p.inv.length, 0);
      eq('dismantled tracked', p.dismantledValue, mat.value);

      /* 丢出：非武器 → 收集物；武器 → 武器建模数据，保留弹夹 / 备弹 / 芯片 */
      const lootBeforeDrop = World.loot.length;
      Inventory.addItem(ITEMS.roll('rare', function () { return 0.2; }));
      const dropMat = p.inv[p.inv.length - 1];
      check('throw backpack material', G.throwBackpackItem(dropMat));
      const dropMatLoot = World.loot[World.loot.length - 1];
      check('material thrown as collectible', dropMatLoot && dropMatLoot.kind !== 'weapon');
      check('throw starts with arc', !!dropMatLoot && dropMatLoot.throwDur > 0);

      const dropWeapon = ITEMS.makeWeaponItem(1, { found: true });
      dropWeapon.mag = 4;
      dropWeapon.spares = 2;
      dropWeapon.chips = [{ chipId: 'power', tierId: 'rare', value: 120, elements: {} }];
      Inventory.addItem(dropWeapon);
      const dropWeaponInv = p.inv[p.inv.length - 1];
      check('throw backpack weapon', G.throwBackpackItem(dropWeaponInv));
      const dropWeaponLoot = World.loot[World.loot.length - 1];
      check('weapon thrown as 3d weapon', !!dropWeaponLoot && dropWeaponLoot.kind === 'weapon' &&
        dropWeaponLoot.item.weaponId === 1 &&
        dropWeaponLoot.item.mag === 4 &&
        dropWeaponLoot.item.spares === 2 &&
        dropWeaponLoot.item.chips.length === 1);
      World.loot.length = lootBeforeDrop;

      /* ---------- 7. 压装 / 治疗 ---------- */
      p.data = 200;
      p.spares[0] = 0;
      Inventory.debugCraft(3);
      Inventory.debugComplete();
      eq('craft spare', p.spares[0], 1);
      eq('craft cost', p.data, 200 - WEAPONS[3].cost);
      p.mags[0] = 3;
      G.debug.reload();
      G.debug.finishReload();
      eq('reload fills whole mag', p.mags[0], WEAPONS[3].mag);
      eq('reload consumes one spare', p.spares[0], 0);
      p.hp = 40;
      p.data = 200;
      Inventory.debugHeal();
      Inventory.debugComplete();
      eq('heal full', p.hp, p.maxHp);
      eq('heal cost', p.data, 200 - CFG.HEAL_COST);

      /* ---------- 8. 拾取 + 站入撤离台（真实 update 循环） ---------- */
      Inventory.close();
      Inventory.addItem(ITEMS.roll('epic'));
      const node = World.loot.filter(function (l) {
        if (l.taken) return false;
        for (let ci = 0; ci < World.chests.length; ci++) {
          const c = World.chests[ci];
          if (Math.hypot(c.x - l.x, c.z - l.z) < CFG.INTERACT_R + 1.2) return false;
        }
        return true;
      })[0];
      check('found loot node', !!node);
      G.debug.teleport(node.x, node.z);
      const invBefore = p.inv.length;
      G.debug.pickup();
      eq('pickup adds item', p.inv.length, invBefore + 1);
      check('loot node consumed', node.taken, node.item && node.item.name);

      const haul = p.inv.reduce(function (s, it) { return s + it.value; }, 0);
      const storedCount = p.inv.length;
      const stashBefore = Store.stashCount();
      const bankBefore = Store.bank();
      const runData = p.data;
      p.hp = p.maxHp;
      G.debug.teleport(World.pad.x, World.pad.z);
      G.debug.clearEnemies();
      for (let i = 0; i < 170 && !G.ended; i++) G.debug.tick(0.05);
      check('stand on pad extracts', G.ended);
      eq('stash after extract', Store.stashCount(), stashBefore + storedCount);
      eq('bank after extract', Store.bank(), bankBefore + runData);
      eq('stats extracts', Store.stats().extracts, 1);
      eq('history length', Store.history().length, 1);
      eq('best haul', Store.stats().bestHaul, Math.max(haul, 0));
      check('end screen visible', !document.getElementById('endScreen').classList.contains('hidden'));
      check('end title', document.getElementById('endTitle').textContent.indexOf('撤离') >= 0,
        document.getElementById('endTitle').textContent);
      document.getElementById('againBtn').click();
      eq('again button returns', G.mode, 'lobby');

      /* ---------- 9. 阵亡丢失 ---------- */
      const bankDeath = Store.bank();
      const stashDeath = Store.stashCount();
      const gadgetsDeath = Store.loadout().gadgets.join(',');
      G.beginMission({ weapons: [3, 0], mags: [1, 1], data: 300, character: 0 });
      Inventory.addItem(ITEMS.roll('epic'));
      G.finishRun(false, 'death');
      eq('bank unchanged on death', Store.bank(), bankDeath);
      eq('stash unchanged on death', Store.stashCount(), stashDeath);
      eq('gadgets persist on death', Store.loadout().gadgets.join(','), gadgetsDeath);
      eq('stats deaths', Store.stats().deaths, 1);
      document.getElementById('againBtn').click();
      eq('back to lobby after death', G.mode, 'lobby');

      /* ---------- 10. 合约 ---------- */
      Contracts.ensure();
      eq('contracts 3', Store.contracts().length, 3);
      Contracts.applyRun({
        win: true, kills: 99, loot: 99, data: 999, haul: 999,
        spitters: 99, dismantled: 9999
      });
      const doneCount = Store.contracts().filter(function (c) { return c.progress >= c.target; }).length;
      eq('contracts completed', doneCount, 3);
      const reward = Store.contracts()[0].reward;
      check('contract reward positive', reward > 0, reward);
      const beforeClaim = Store.bank();
      Store.addBank(reward);
      eq('bank claim math', Store.bank(), beforeClaim + reward);

      /* ---------- 11. 存档往返 ---------- */
      Store.setLoadout({ weapons: [1, 4], mags: [2, 3], carry: 200, gadgets: ['radiation', 'knife'] });
      Store.setChar(1);
      Store.addBank(77);
      const bankSave = Store.bank();
      const stashSave = Store.stashCount();
      Store.save();
      Store.load();
      eq('bank persisted', Store.bank(), bankSave);
      eq('stash persisted', Store.stashCount(), stashSave);
      eq('loadout persisted', Store.loadout().weapons.map(function (it) { return it ? it.weaponId : -1; }).join(','), '1,4');
      eq('loadout mags', Store.loadout().mags.join(','), '2,3');
      eq('loadout gadgets', Store.loadout().gadgets.join(','), 'radiation,knife');
      eq('char persisted', Store.char(), 1);
      eq('contracts persisted', Store.contracts().length, 3);

      /* ---------- 12. 强化数值 ---------- */
      Store.raw().augments.armor = 2;
      Store.raw().augments.vitality = 1;
      Store.raw().augments.pack = 1;
      Store.raw().augments.loader = 2;
      eq('maxShield augment', Store.maxShield(), CFG.PLAYER.shield + 24);
      eq('maxHp augment', Store.maxHp(), CFG.PLAYER.hp + 12);
      eq('invRows augment', Store.invRows(), CFG.INV_ROWS + 1);
      near('reload mul', Store.reloadMul(), 1 - 2 * 0.08, 1e-9);

      /* ---------- 12b. 大厅 UI 交互 ---------- */
      document.querySelector('#lobbyTabs .tab[data-tab="stash"]').click();
      check('stash tab click', document.getElementById('paneStash').classList.contains('on'));
      if (Store.stashCount() > 0) {
        check('stash item rendered', !!document.querySelector('#stashItems .stash-item'));
        const sEl = document.querySelector('#stashItems .stash-item');
        const bankS = Store.bank();
        const countS = Store.stashCount();
        sEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        eq('stash right click dismantles', Store.stashCount(), countS - 1);
        check('stash right click pays', Store.bank() > bankS);
      }
      document.querySelector('#lobbyTabs .tab[data-tab="home"]').click();
      check('home tab click', !document.getElementById('paneStash').classList.contains('on'));

      /* 仓库内嵌配装槽：弹夹 + / − */
      const plus = document.querySelector('#lobbyLoad [data-a="+"]');
      check('stash loadout rendered', !!plus);
      if (plus) {
        const n0 = parseInt(plus.closest('.load-row').querySelector('.lr-num').textContent, 10);
        plus.click();
        const plusN = parseInt(document.querySelector('#lobbyLoad .lr-num').textContent, 10);
        eq('mag plus increments', plusN, n0 + 1);
        document.querySelector('#lobbyLoad [data-a="-"]').click();
        const minusN = parseInt(document.querySelector('#lobbyLoad .lr-num').textContent, 10);
        eq('mag minus restores', minusN, n0);
      }

      /* ---------- 13. 道具配置 ---------- */
      Store.reset();
      Lobby.reloadFromSave();
      G.toLobby();
      Lobby.refresh();
      Lobby.setTab('stash');
      check('stash tab active', document.getElementById('paneStash').classList.contains('on'));
      Lobby.setTab('home');
      const gadgetSet = Store.setGadgets(['grenade', 'radiation']);
      eq('gadgets set', gadgetSet.join(','), 'grenade,radiation');
      const dedupe = Store.setGadgets(['knife', 'knife']);
      eq('gadgets unique', dedupe.join(','), 'knife,');
      Store.setGadgets(['knife', 'grenade']);
      Lobby.refresh();
      eq('gadget cards rendered', document.querySelectorAll('#lobbyGadgets .gadget-config').length, 2);
      check('gadget config persists', Store.loadout().gadgets.join(',') === 'knife,grenade');

      /* ---------- 14. 大厅出击按钮 ---------- */
      const wLaunch = ITEMS.makeWeaponItem(3);
      Store.stashAdd(wLaunch);
      const launchItem = Store.stash().filter(function (it) { return it.kind === 'weapon'; })[0];
      Store.equipWeapon(0, launchItem);
      Store.setLoadout({ weapons: Store.loadout().weapons, mags: [1, 0], carry: 100 });
      Lobby.reloadFromSave();
      Lobby.refresh();
      Lobby.setTab('home');
      const bankLaunch = Store.bank();
      document.getElementById('lobbyStart').click();
      eq('launch button starts run', G.mode, 'mission');
      eq('launch carries gadgets', G.state.player.gadgets.join(','), 'knife,grenade');
      eq('launch deducts loadout cost', Store.bank(), bankLaunch - (WEAPONS[3].cost + 100));
      check('lobby hidden on launch', document.getElementById('lobby').classList.contains('hidden'));
      G.toLobby();
      G.beginMission({ weapons: [], mags: [], data: 0, character: 0 });
      check('zero weapon entry', G.state.player.carried.length === 0 && G.state.player.weapon === -1);
      check('zero weapon hud empty', !!document.querySelector('#slots .slot-empty'));
      G.toLobby();

      G.beginMission({ weapons: [3], mags: [1], data: 0, character: 0 });
      const dp = G.state.player;
      const dupWeapon = ITEMS.makeWeaponItem(3);
      dp.inv.push(dupWeapon);
      const dupOk = G.equipWeaponItem(dupWeapon);
      check('duplicate weapon equip', dupOk && dp.carried.length === 2 &&
        dp.carried[0].weaponId === 3 && dp.carried[1].weaponId === 3);
      dp.mags[0] = 5;
      dp.mags[1] = 9;
      G.switchSlot(1);
      eq('per-slot mag slot 1', dp.mags[1], 9);
      G.switchSlot(0);
      eq('per-slot mag slot 0', dp.mags[0], 5);

      /* 卸下/重新装备必须保留弹夹和备弹 */
      dp.mags[0] = 4;
      dp.spares[0] = 1;
      const unequipped = G.unequipWeaponSlot(0);
      const savedWeapon = dp.inv.filter(function (it) {
        return it.kind === 'weapon' && it.mag === 4;
      })[0];
      check('unequip keeps mag', !!unequipped && !!savedWeapon &&
        savedWeapon.spares === 1);
      if (savedWeapon) G.equipWeaponItem(savedWeapon);
      check('reequip keeps ammo', dp.mags[dp.slot] === 4 && dp.spares[dp.slot] === 1);
      G.toLobby();

      /* 容器物品直接装备：物品不必在玩家背包里 */
      G.beginMission({ weapons: [], mags: [], data: 0, character: 0 });
      const ep = G.state.player;
      const externalWeapon = ITEMS.makeWeaponItem(0, { found: true });
      check('external weapon equip', G.equipWeaponItem(externalWeapon, { external: true }) &&
        ep.carried.length === 1 && ep.carried[0].weaponId === 0);
      check('external weapon keeps elements', ep.carried.length === 1 && ITEMS.hasElements(ep.carried[0].elements));
      G.toLobby();

      /* ---------- 14b. 道具使用 ---------- */
      G.beginMission({ weapons: [3], mags: [1], data: 500, character: 0, gadgets: ['knife', 'grenade'] });
      G.setPaused(false);
      const gp = G.state.player;
      const okKnife = G.debug.useGadget(0);
      check('knife used', okKnife);
      eq('gadget data cost', gp.data, 500 - GADGET_BY_ID.knife.cost);
      eq('gadget cooldown value', gp.gadgetCd[0], GADGET_BY_ID.knife.cooldown);
      check('knife projectile spawned', G.state.knives.length === 1, G.state.knives.length);
      gp.gadgetCd[0] = 0;
      gp.data = 0;
      check('gadget blocked without data', !G.debug.useGadget(0));
      G.toLobby();

      /* ---------- 15. 武器芯片 ---------- */
      Store.reset();
      const wChip = ITEMS.makeWeaponItem(0);
      Store.stashAdd(wChip);
      Store.equipWeapon(0, Store.stash().filter(function (it) { return it.kind === 'weapon'; })[0]);
      const chip = ITEMS.rollChip(function () { return 0.2; }, 0.8);
      eq('chip kind', chip.kind, 'chip');
      eq('chip fixed size', chip.w + 'x' + chip.h, '1x1');
      check('chip def valid', !!CHIP_BY_ID[chip.chipId]);
      const qchip = ITEMS.makeChipItem({ chipId: 'power', tierId: 'epic', value: 200 });
      eq('chip color uses quality', ITEMS.colorOf(qchip), TIER_BY_ID.epic.color);
      const foundSeriesChip = ITEMS.makeChipItem({
        chipId: 'laser_prism', tierId: 'rare', value: 220
      }, { found: true });
      const foundSeriesEntry = ITEMS.chipEntry(foundSeriesChip);
      check('found series chip entry keeps elements', ITEMS.hasElements(foundSeriesEntry.elements));
      const rolledChip = ITEMS.rollChip(function () { return 0.1; }, 0);
      eq('chip type has one fixed quality', rolledChip.tierId, CHIP_BY_ID[rolledChip.chipId].tierId);
      check('chip stash add', Store.stashAdd(chip));
      const storedChip = Store.stash().filter(function (it) { return it.kind === 'chip'; })[0];
      const chipInstall = Store.installChip(0, storedChip);
      check('chip install', chipInstall.ok);
      eq('weapon chip count', Store.weaponChips(0).length, 1);
      const chipDef = CHIP_BY_ID[Store.weaponChips(0)[0].chipId];
      near('chip mod applied', Store.weaponMods(0)[chipDef.stat], chipDef.pct, 1e-9);
      const chipUninstall = Store.uninstallChip(0, 0);
      check('chip uninstall', chipUninstall.ok);
      eq('weapon chip count after', Store.weaponChips(0).length, 0);
      eq('chip back in stash', Store.stash().filter(function (it) { return it.kind === 'chip'; }).length, 1);

      /* 系列专属芯片：限定武器 + 独特加成 */
      const series = [
        { id: 'sonic_amp', wi: 0, field: 'coneRange', want: 0.30, other: 1 },
        { id: 'laser_prism', wi: 1, field: 'bounce', want: 1, other: 0 },
        { id: 'thermal_spread', wi: 2, field: 'zoneR', want: 0.25, other: 3 },
        { id: 'kinetic_pierce', wi: 3, field: 'pierce', want: 1, other: 4 },
        { id: 'voltaic_relay', wi: 4, field: 'chain', want: 1, other: 0 }
      ];
      for (let si = 0; si < series.length; si++) {
        const sdef = series[si];
        Store.clearLoadoutWeapons();
        const seriesWeapon = ITEMS.makeWeaponItem(sdef.wi);
        Store.stashAdd(seriesWeapon);
        const equippedSeries = Store.stash().filter(function (it) {
          return it.kind === 'weapon' && it.weaponId === sdef.wi;
        })[0];
        check('series weapon equipped ' + sdef.id, Store.equipWeapon(0, equippedSeries).ok);
        /* 另一把不同类型武器放在配装槽 2，用来验证错误武器会被拒绝 */
        const otherWeapon = ITEMS.makeWeaponItem(sdef.other);
        Store.stashAdd(otherWeapon);
        const equippedOther = Store.stash().filter(function (it) {
          return it.kind === 'weapon' && it.weaponId === sdef.other;
        })[0];
        check('series other weapon equipped ' + sdef.id, Store.equipWeapon(1, equippedOther).ok);
        const sitem = ITEMS.makeChipItem({ chipId: sdef.id, tierId: 'fine', value: 40 });
        check('series def ' + sdef.id, !!sitem);
        check('series fits own ' + sdef.id, ITEMS.chipFitsWeapon(sitem, sdef.wi));
        check('series rejects other ' + sdef.id, !ITEMS.chipFitsWeapon(sitem, sdef.other));
        Store.stashAdd(sitem);
        const stored = Store.stash().filter(function (it) { return it.chipId === sdef.id; })[0];
        check('series wrong weapon blocked ' + sdef.id, !Store.installChip(1, stored).ok);
        check('series install ' + sdef.id, Store.installChip(0, stored).ok);
        near('series mod ' + sdef.id, Store.weaponMods(0)[sdef.field], sdef.want, 1e-9);
        Store.uninstallChip(0, 0);
      }

      /* 同型号双武器：芯片 / 改修必须按配装槽独立 */
      Store.reset();
      Store.stashAdd(ITEMS.makeWeaponItem(3, { found: true }));
      Store.stashAdd(ITEMS.makeWeaponItem(3, { found: true }));
      const twinWeapons = Store.stash().filter(function (it) { return it.kind === 'weapon'; });
      Store.equipWeapon(0, twinWeapons[0]);
      Store.equipWeapon(1, twinWeapons[1]);
      const twinPower = ITEMS.makeChipItem({ chipId: 'power', tierId: 'fine', value: 90 }, { found: true });
      const twinCycle = ITEMS.makeChipItem({ chipId: 'cycle', tierId: 'fine', value: 80 }, { found: true });
      Store.stashAdd(twinPower);
      Store.stashAdd(twinCycle);
      const twinChips = Store.stash().filter(function (it) { return it.kind === 'chip'; });
      check('twin weapon chip slot0 install', Store.installChip(0, twinChips.filter(function (it) { return it.chipId === 'power'; })[0]).ok);
      eq('twin weapon slot0 chips', Store.weaponChips(0).length, 1);
      eq('twin weapon slot1 chips untouched', Store.weaponChips(1).length, 0);
      near('twin weapon slot0 dmg mod', Store.weaponMods(0).dmg, 0.10, 1e-9);
      eq('twin weapon slot1 dmg mod', Store.weaponMods(1).dmg, 0);
      check('twin weapon chip slot1 install', Store.installChip(1, twinChips.filter(function (it) { return it.chipId === 'cycle'; })[0]).ok);
      eq('twin weapon slot0 chips still one', Store.weaponChips(0).length, 1);
      eq('twin weapon slot1 chips one', Store.weaponChips(1).length, 1);
      near('twin weapon slot1 rate mod', Store.weaponMods(1).rate, 0.10, 1e-9);
      eq('twin weapon slot0 rate mod', Store.weaponMods(0).rate, 0);
      Store.uninstallChip(0, 0);
      eq('twin weapon slot1 chip survives slot0 uninstall', Store.weaponChips(1).length, 1);

      /* 局内同型号双武器同样按槽位独立 */
      G.beginMission({ weapons: [3, 3], mags: [0, 0], data: 0, character: 0 });
      const twinPlayer = G.state.player;
      const raidTwinChip = ITEMS.makeChipItem({ chipId: 'power', tierId: 'fine', value: 90 }, { found: true });
      check('raid twin chip install slot0', G.installChip(0, raidTwinChip));
      eq('raid twin slot0 chips', G.weaponChips(0).length, 1);
      eq('raid twin slot1 chips untouched', G.weaponChips(1).length, 0);
      near('raid twin slot0 dmg mod', G.weaponMods(0).dmg, 0.10, 1e-9);
      eq('raid twin slot1 dmg mod', G.weaponMods(1).dmg, 0);
      G.toLobby();

      /* ---------- 16. 芯片工坊 ---------- */
      Store.reset();
      let allValued = true;
      CHIP_TYPES.forEach(function (def) {
        if (!(def.value > 0 && def.price > def.value)) allValued = false;
      });
      check('all chips have data value', allValued);
      const craftBank = Store.bank();
      const crafted = Store.craftChip('power');
      check('craft chip ok', crafted.ok);
      eq('craft chip cost', Store.bank(), craftBank - CHIP_BY_ID.power.price);
      const craftedItem = Store.stash().filter(function (it) { return it.chipId === 'power'; })[0];
      check('crafted chip in stash', !!craftedItem);
      eq('crafted chip data value', craftedItem.value, CHIP_BY_ID.power.value);
      eq('crafted chip tier', craftedItem.tierId, CHIP_BY_ID.power.tierId);
      const elBeforeChipDismantle = ITEMS.elementTotal(Store.elements());
      const dismantleValue = Store.stashDismantle(craftedItem);
      eq('chip dismantle returns data value', dismantleValue, CHIP_BY_ID.power.value);
      eq('generic chip dismantle gives no elements', ITEMS.elementTotal(Store.elements()), elBeforeChipDismantle);
      Store.addElements({ acoustic: 500, optical: 500, thermal: 500, kinetic: 500, voltaic: 500 });
      const weaponBank = Store.bank();
      const kineticBefore = Store.element('kinetic');
      const craftedWeapon = Store.craftWeapon(3);
      check('craft weapon ok', craftedWeapon.ok);
      eq('craft weapon cost', Store.bank(), weaponBank - WEAPONS[3].craft);
      eq('craft weapon element cost', Store.element('kinetic'), kineticBefore - 50);
      const craftedWeaponItem = Store.stash().filter(function (it) { return it.kind === 'weapon'; })[0];
      check('crafted weapon in stash', !!craftedWeaponItem);
      eq('crafted weapon size', craftedWeaponItem.w + 'x' + craftedWeaponItem.h, '3x1');
      check('crafted weapon has no elements', !ITEMS.hasElements(craftedWeaponItem.elements));
      const opticalBefore = Store.element('optical');
      const craftedSeries = Store.craftChip('laser_prism');
      check('craft series chip ok', craftedSeries.ok);
      eq('craft series chip element cost', Store.element('optical'), opticalBefore - 22);
      const craftedSeriesItem = Store.stash().filter(function (it) { return it.chipId === 'laser_prism'; })[0];
      check('crafted series chip has no elements', !!craftedSeriesItem && !ITEMS.hasElements(craftedSeriesItem.elements));
      for (const id in Store.elements()) Store.elements()[id] = 0;
      Store.addBank(5000);
      check('craft weapon blocked without elements', !Store.craftWeapon(3).ok);
      Store.addBank(-Store.bank());
      check('craft chip blocked when poor', !Store.craftChip('laser_prism').ok);

      /* 武器箱：3×2，只出武器 / 芯片 */
      World.gen(20261126);
      const wcs = World.chests.filter(function (c) { return c.type === 'weapon'; });
      check('weapon crates generated', wcs.length === (CFG.WEAPON_CHEST_COUNT || 2), wcs.length);
      let wcValid = true;
      wcs.forEach(function (c) {
        if (c.cols !== 3 || c.rows !== 2) wcValid = false;
        c.inv.forEach(function (it) {
          if (it.kind !== 'weapon' && it.kind !== 'chip') wcValid = false;
        });
      });
      check('weapon crate contents valid', wcValid);

      /* ---------- 17. 训练场配装台 ---------- */
      G.beginTestMap();
      G.setPaused(false);
      const tp = G.state.player;
      eq('training starts empty weapons', tp.carried.length, 0);
      eq('training starts empty gadgets', tp.gadgets.join(','), ',');
      const lp = World.test.loadout;
      G.debug.teleport(lp.x, lp.z);
      G.tryLoot();
      check('training loadout opens', !document.getElementById('trainingLoadout').classList.contains('hidden'));
      document.querySelectorAll('#trainWeapons .train-card')[3].click();
      document.querySelectorAll('#trainGadgets .train-card')[0].click();
      check('training weapon equipped', tp.carried.length === 1 && tp.carried[0].weaponId === 3);
      check('training gadget equipped', tp.gadgets[0] === 'knife');
      document.getElementById('trainClose').click();
      check('training loadout closes', document.getElementById('trainingLoadout').classList.contains('hidden'));
      G.debug.useGadget(0);
      eq('training gadget no cooldown', tp.gadgetCd[0], 0);
      G.toLobby();

      /* ---------- 18. 清剿小队卡门 / 卡墙压测 ---------- */
      const stressAgg = runSquadStress({ rounds: 1, roamT: 4, fightT: 8, corridorT: 6, kiteT: 12 });
      check('stress ran', stressAgg.memberTicks > 0, stressAgg.rounds + ' rounds');
      check('openDoor opens', !!(stressAgg.openDoorTest && stressAgg.openDoorTest.open));
      check('openDoor is idempotent', !!(stressAgg.openDoorTest && stressAgg.openDoorTest.again));
      const stressStat = reportStress(stressAgg, 'AISTRESS');
      const ph = stressAgg.phases;
      check('squad not frozen while moving', stressStat.frozenPct < 1.5,
        'frozen ' + stressStat.frozenPct.toFixed(2) + '%');
      check('squad never stuck inside geometry', stressStat.illegalPct < 0.5,
        'illegal ' + stressStat.illegalPct.toFixed(2) + '%');
      check('squad does not camp in doorways', stressStat.doorPct < 6,
        'in door ' + stressStat.doorPct.toFixed(2) + '%');
      check('squad not trapped in closed doors', stressStat.closedDoor < 6, 'closed ' + stressStat.closedDoor);
      check('squad never clipped into door frame', stressStat.clipTicks < 30, 'clip ' + stressStat.clipTicks);
      check('AI never toggles the same door twice in a frame', stressStat.doubleToggle === 0,
        'dbl ' + stressStat.doubleToggle);
      check('no long freeze', stressStat.worstFrozenSec < 0.8,
        'worst ' + stressStat.worstFrozenSec.toFixed(2) + 's');
      check('squad breaches a house through its door', ph.fight && ph.fight.reachT >= 0 && ph.fight.reachT < 8,
        ph.fight ? 'reach ' + ph.fight.reachT + 's' : 'no fight phase');
      check('squad traverses a 2m corridor', ph.corridor && ph.corridor.minDist < 12,
        ph.corridor ? 'minDist ' + ph.corridor.minDist : 'no corridor phase');
      check('squad chases through inner doors', ph.kite && ph.kite.minDist < 5.5,
        ph.kite ? 'minDist ' + ph.kite.minDist + ' / reach ' + ph.kite.reachT + 's' : 'no kite phase');

      /* ---------- 收尾：恢复新档 ---------- */
      Store.reset();
      if (typeof Lobby !== 'undefined') Lobby.reloadFromSave();
      G.toLobby();
      if (typeof Lobby !== 'undefined') Lobby.refresh();
    } catch (err) {
      check('no exception', false, (err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : String(err)));
    }
    report();
  }

  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(run, 700);
  });
})();
