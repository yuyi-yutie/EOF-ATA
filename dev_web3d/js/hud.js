'use strict';

/* ============================================================
   HUD：DOM 覆盖层
   ============================================================ */

const HUD = (function () {
  let el = {};
  let fpsT = 0, fpsN = 0, fps = 0;
  let toastT = 0;
  let hitT = 0;

  function $(id) { return document.getElementById(id); }

  function boot() {
    el = {
      hpFill: $('hpFill'), hpNum: $('hpNum'),
      shdFill: $('shdFill'), shdNum: $('shdNum'),
      staFill: $('staFill'),
      wName: $('wName'), wTag: $('wTag'), wMag: $('wMag'), wRes: $('wRes'),
      kills: $('kills'), loot: $('loot'), timer: $('timer'),
      camInfo: $('camInfo'),
      exWrap: $('extractWrap'), exFill: $('exFill'),
      toast: $('toast'), dmg: $('dmgFlash'),
      end: $('endScreen'), endTitle: $('endTitle'), endBody: $('endBody'),
      reload: $('reloadWrap'), reloadFill: $('reloadFill')
    };
  }

  function pct(v, m) { return Math.max(0, Math.min(1, v / m)) * 100; }

  function vitals() {
    const p = G.state.player;
    if (!el.hpFill) return;
    el.hpFill.style.width = pct(p.hp, CFG.PLAYER.hp) + '%';
    el.shdFill.style.width = pct(p.shield, CFG.PLAYER.shield) + '%';
    el.staFill.style.width = pct(p.stam, CFG.PLAYER.stam) + '%';
    el.hpNum.textContent = Math.ceil(p.hp);
    el.shdNum.textContent = Math.ceil(p.shield);
  }

  function mag(i) {
    const p = G.state.player;
    const w = WEAPONS[i];
    el.wName.textContent = w.name;
    el.wTag.textContent = w.tag;
    el.wMag.textContent = p.mags[i];
    el.wRes.textContent = p.spares[i];
  }

  function reset() {
    vitals();
    mag(G.state.player.weapon);
    el.kills.textContent = '0';
    el.loot.textContent = '0';
    el.end.classList.add('hidden');
    el.exWrap.classList.remove('on');
    el.exFill.style.width = '0%';
    el.reload.classList.add('hidden');
  }

  function kills(n) { el.kills.textContent = n; }
  function loot(n) { el.loot.textContent = n; }

  function extract(p) {
    if (p <= 0.001) {
      el.exWrap.classList.remove('on');
      el.exFill.style.width = '0%';
      return;
    }
    el.exWrap.classList.add('on');
    el.exFill.style.width = (p * 100) + '%';
  }

  function damage() {
    el.dmg.classList.remove('hit');
    void el.dmg.offsetWidth;
    el.dmg.classList.add('hit');
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    toastT = 1.6;
  }

  /* 命中反馈：准星变红 + 命中标记 */
  function hit(kill) {
    const c = document.getElementById('cross');
    if (c) c.classList.add('hit');
    const hm = document.getElementById('hitmark');
    if (hm && c) {
      hm.style.left = c.style.left;
      hm.style.top = c.style.top;
      hm.classList.toggle('kill', !!kill);
      hm.classList.add('on');
    }
    hitT = kill ? 0.2 : 0.12;
  }

  function end(win, st) {
    el.end.classList.remove('hidden');
    el.endTitle.textContent = win ? '撤离成功' : '信号中断';
    el.endTitle.className = win ? 'win' : 'lose';
    const t = Math.floor(st.time);
    el.endBody.innerHTML =
      '<div><span>击杀</span><b>' + st.kills + '</b></div>' +
      '<div><span>拾取</span><b>' + st.loot + '</b></div>' +
      '<div><span>用时</span><b>' + String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + '</b></div>';
  }

  function hideEnd() { el.end.classList.add('hidden'); }

  function tick(dt) {
    fpsT += dt; fpsN++;
    if (fpsT > 0.4) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
    const p = G.state.player;
    el.camInfo.textContent = Math.round(G.state.cam.pitch) + '° · ' + fps + 'fps';
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0) el.toast.classList.remove('show');
    }
    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) {
        const c = document.getElementById('cross');
        if (c) c.classList.remove('hit');
        const hm = document.getElementById('hitmark');
        if (hm) hm.classList.remove('on');
      }
    }
    const t = Math.floor(G.state.time);
    if (el.timer) el.timer.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    if (p.reload > 0) {
      const w = WEAPONS[p.weapon];
      el.reload.classList.remove('hidden');
      el.reloadFill.style.width = (100 - (p.reload / w.reload) * 100) + '%';
    } else if (el.reload) {
      el.reload.classList.add('hidden');
    }
  }

  window.addEventListener('DOMContentLoaded', boot);

  return {
    vitals: vitals, mag: mag, reset: reset, kills: kills, loot: loot,
    extract: extract, damage: damage, toast: toast, hit: hit, end: end, hideEnd: hideEnd, tick: tick
  };
})();
