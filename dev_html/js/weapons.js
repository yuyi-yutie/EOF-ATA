'use strict';

/* ============================================================
   武器：五种模态的开火与弹道
   ============================================================ */
const WeaponSystem = (() => {

  function spawnBullet(G, opts) {
    const b = {
      kind: opts.kind,
      x: opts.x, y: opts.y,
      px: opts.x, py: opts.y,
      vx: Math.cos(opts.ang) * opts.speed,
      vy: Math.sin(opts.ang) * opts.speed,
      r: opts.r || 4,
      dmg: opts.dmg,
      life: opts.life || 2.2,
      color: opts.color,
      dead: false,
      hits: 0,
      bounces: opts.bounces || 0,
      pierce: !!opts.pierce,
      hit: new Set()
    };
    G.bullets.push(b);
    return b;
  }

  function fire(G, idx) {
    const p = G.player;
    if (!p || p.dead) return;
    if (G.inventoryOpen) return;
    if (p.fireCd > 0 || p.reloadT > 0 || p.switchT > 0) return;

    const w = WEAPONS[idx];
    const st = p.ammo[idx];
    const ang = p.aim;

    if (st.mag <= 0) {
      p.fireCd = 0.28;
      SFX.dry();
      HUD.toast('弹夹已空 · 按 R 换弹', 'warn');
      return;
    }

    st.mag--;
    p.fireCd = w.rate;
    p.spread = Math.min(0.16, p.spread + (w.id === 'sonic' ? 0.075 : 0.022));
    p.kick = 1;
    p.muzzleT = 0.055;

    const mx = p.x + Math.cos(ang) * 18;
    const my = p.y + Math.sin(ang) * 18;

    G.effects.push({
      type: 'muzzle', x: mx, y: my, ang, life: 0.06, max: 0.06,
      color: w.color, size: w.id === 'sonic' ? 26 : 16
    });

    SFX.shoot(w.id);
    G.cam.shake = Math.min(14, G.cam.shake + (w.id === 'sonic' ? 7 : 2.2));

    if (G.alertAt) G.alertAt(mx, my, w.noise);

    switch (w.id) {
      case 'sonic': {
        const half = (w.halfAngle * Math.PI) / 180;
        for (const e of G.enemies) {
          if (e.dead) continue;
          const d = dist(mx, my, e.x, e.y);
          if (d > w.range + e.r) continue;
          const a = Math.atan2(e.y - my, e.x - mx);
          if (Math.abs(angDiff(a, ang)) > half + Math.atan2(e.r, Math.max(d, 1))) continue;
          if (!MapGen.hasLOS(G.map, mx, my, e.x, e.y)) continue;
          const t = clamp(d / w.range, 0, 1);
          const dmg = lerp(w.dmg, w.dmgFar, t);
          Game.damageEnemy(e, dmg, mx, my, w.color);
          const k = w.knock * (1 - t * 0.55);
          e.kx += Math.cos(a) * k;
          e.ky += Math.sin(a) * k;
        }
        G.effects.push({
          type: 'cone', x: mx, y: my, ang, half, range: w.range,
          life: 0.28, max: 0.28, color: w.color
        });
        break;
      }
      case 'laser': {
        fireLaser(G, w, mx, my, ang);
        break;
      }
      case 'thermal':
        spawnBullet(G, {
          kind: 'thermal', x: mx, y: my, ang, speed: w.speed,
          dmg: w.dmg, r: 7, color: w.color, life: 2.4
        });
        break;
      case 'kinetic':
        spawnBullet(G, {
          kind: 'kinetic', x: mx, y: my, ang, speed: w.speed,
          dmg: w.dmg, r: 3.5, color: w.color, life: 1.6
        });
        break;
      case 'voltaic':
        spawnBullet(G, {
          kind: 'voltaic', x: mx, y: my, ang, speed: w.speed,
          dmg: w.dmg, r: 5, color: w.color, life: 1.4
        });
        break;
    }
  }

  /* ---------- 光学：瞬时激光 ---------- */
  function pointSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  /* 发射瞬间算出完整反射折线（含最多 maxBounce 次弹墙） */
  function traceBeam(map, x, y, ang, maxLen, maxBounce) {
    const pts = [{ x, y }];
    let dx = Math.cos(ang), dy = Math.sin(ang);
    let left = maxLen;
    let bounces = 0;
    const step = 2;
    let guard = 0;

    while (left > 0 && guard++ < 6000) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (MapGen.isWall(map, nx, ny)) {
        pts.push({ x, y });
        const hx = MapGen.isWall(map, x + dx * step * 2.5, y);
        const hy = MapGen.isWall(map, x, y + dy * step * 2.5);
        if (hx) dx = -dx;
        if (hy) dy = -dy;
        if (!hx && !hy) { dx = -dx; dy = -dy; }
        bounces++;
        if (bounces > maxBounce) break;
        left -= 8;
        continue;
      }
      x = nx;
      y = ny;
      left -= step;
    }
    pts.push({ x, y });
    return pts;
  }

  function fireLaser(G, w, mx, my, ang) {
    const pts = traceBeam(G.map, mx, my, ang, w.beamLen, w.bounce);
    let hits = 0;

    for (const e of G.enemies) {
      if (e.dead) continue;
      let dmg = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointSegDist(e.x, e.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d <= e.r + w.width) {
          dmg = w.dmg * Math.pow(w.falloff, Math.min(i, w.bounce + 1));
          break;
        }
      }
      if (dmg > 0) {
        Game.damageEnemy(e, dmg, e.x, e.y, w.color);
        e.hitFlash = 0.12;
        e.kx += Math.cos(ang) * 24;
        e.ky += Math.sin(ang) * 24;
        hits++;
      }
    }

    G.effects.push({
      type: 'laser', pts, life: 0.26, max: 0.26,
      color: w.color, width: w.width, hits
    });

    const end = pts[pts.length - 1];
    G.particles.push({
      x: end.x, y: end.y, vx: 0, vy: 0,
      life: 0.14, max: 0.14, size: 5, color: w.color
    });
    G.cam.shake = Math.min(16, G.cam.shake + 4);
    SFX.laserHit();
  }

  function chainLightning(G, fromEnemy, baseDmg, hitSet) {
    const w = WEAPONS[4];
    let src = { x: fromEnemy.x, y: fromEnemy.y };
    const used = new Set(hitSet);
    for (let i = 0; i < w.chainMax; i++) {
      let best = null, bd = Infinity;
      for (const e of G.enemies) {
        if (e.dead || used.has(e)) continue;
        const d = dist(src.x, src.y, e.x, e.y);
        if (d < w.chainR && d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      used.add(best);
      const dmg = baseDmg * w.chainMul[i];
      Game.damageEnemy(best, dmg, src.x, src.y, w.color);
      G.effects.push({
        type: 'bolt', x1: src.x, y1: src.y, x2: best.x, y2: best.y,
        life: 0.16, max: 0.16, color: w.color
      });
      best.stun = Math.max(best.stun || 0, 0.14);
      src = best;
    }
  }

  function handleHit(G, b, e) {
    if (b.kind === 'thermal') {
      Game.damageEnemy(e, b.dmg, b.x, b.y, b.color);
      Game.addZone(b.x, b.y);
      b.dead = true;
    } else if (b.kind === 'voltaic') {
      Game.damageEnemy(e, b.dmg, b.x, b.y, b.color);
      chainLightning(G, e, b.dmg, new Set([e]));
      b.dead = true;
    } else {
      Game.damageEnemy(e, b.dmg, b.x, b.y, b.color);
      b.dead = true;
    }
  }

  function updateBullets(G, dt) {
    const map = G.map;
    for (const b of G.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }

      const speed = Math.hypot(b.vx, b.vy);
      const steps = Math.max(1, Math.min(14, Math.ceil((speed * dt) / 8)));
      const sdt = dt / steps;

      for (let s = 0; s < steps; s++) {
        b.px = b.x;
        b.py = b.y;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        if (MapGen.isWall(map, b.x, b.y)) {
          b.x = b.px;
          b.y = b.py;
          b.dead = true;
          for (let i = 0; i < 6; i++) {
            G.particles.push({
              x: b.x, y: b.y,
              vx: rnd(-110, 110), vy: rnd(-110, 110),
              life: rnd(0.1, 0.35), max: 0.35, size: rnd(1, 2.6),
              color: b.color
            });
          }
          break;
        }

        for (const e of G.enemies) {
          if (e.dead || b.hit.has(e)) continue;
          const rr = e.r + b.r;
          if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
            b.hit.add(e);
            handleHit(G, b, e);
            if (b.dead) break;
          }
        }
        if (b.dead) break;
      }
    }
    if (G.bullets.some(b => b.dead)) {
      G.bullets = G.bullets.filter(b => !b.dead);
    }
  }

  return { fire, updateBullets };
})();
