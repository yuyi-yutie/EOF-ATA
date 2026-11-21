'use strict';

/* ============================================================
   HUD / 小地图 / 提示 / 结算
   ============================================================ */
const HUD = (() => {
  const el = {};
  let lastToast = { text: '', t: 0 };
  let miniT = 0;
  let lastData = -1;
  let lastPrompt = '';

  function init() {
    el.hud = document.getElementById('hud');
    el.hpFill = document.getElementById('hpFill');
    el.hpNum = document.getElementById('hpNum');
    el.shieldFill = document.getElementById('shieldFill');
    el.shieldNum = document.getElementById('shieldNum');
    el.dataNum = document.getElementById('dataNum');
    el.slots = document.getElementById('slots');
    el.wTag = document.getElementById('wTag');
    el.wName = document.getElementById('wName');
    el.wMag = document.getElementById('wMag');
    el.wRes = document.getElementById('wRes');
    el.wResLabel = document.getElementById('wResLabel');
    el.wIcon = document.getElementById('wIcon');
    el.reloadFill = document.getElementById('reloadFill');
    el.prompt = document.getElementById('prompt');
    el.toastWrap = document.getElementById('toastWrap');
    el.exBanner = document.getElementById('extractBanner');
    el.exFill = document.getElementById('exFill');
    el.exPct = document.getElementById('exPct');
    el.minimap = document.getElementById('minimap');
    el.mini = el.minimap.getContext('2d');
    el.pause = document.getElementById('pause');
    el.results = document.getElementById('results');
  }

  /* 每局只显示携带的两把武器，键位重排为 1 / 2 */
  function setLoadout(carried) {
    el.slots.innerHTML = '';
    carried.forEach((wIdx, i) => {
      const w = WEAPONS[wIdx];
      const d = document.createElement('div');
      d.className = 'slot';
      d.style.setProperty('--wc', w.color);
      d.innerHTML =
        '<img class="icon" src="assets/w' + wIdx + '_side.png" alt="">' +
        '<span class="k">' + (i + 1) + '</span>' +
        '<span class="n">' + w.name + '</span>' +
        '<span class="a">0</span>' +
        '<span class="bar"></span>';
      d.addEventListener('click', () => Game.selectWeapon(i));
      el.slots.appendChild(d);
    });
  }

  function show(v) {
    el.hud.classList.toggle('hidden', !v);
  }

  function toast(text, kind) {
    const now = performance.now();
    if (text === lastToast.text && now - lastToast.t < 1200) return;
    lastToast = { text, t: now };

    const d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = text;
    el.toastWrap.appendChild(d);
    setTimeout(() => d.remove(), 2100);
  }

  function setPrompt(text) {
    if (text === lastPrompt) return;
    lastPrompt = text;
    if (!text) {
      el.prompt.classList.add('hidden');
      el.prompt.innerHTML = '';
    } else {
      el.prompt.classList.remove('hidden');
      el.prompt.innerHTML = text;
    }
  }

  function update(G) {
    const p = G.player;
    if (!p) return;

    el.hpFill.style.width = (p.hp / p.maxHp * 100).toFixed(1) + '%';
    el.hpNum.textContent = Math.ceil(p.hp);
    el.shieldFill.style.width = (p.shield / p.maxShield * 100).toFixed(1) + '%';
    el.shieldNum.textContent = Math.ceil(p.shield);

    if (G.data !== lastData) {
      lastData = G.data;
      el.dataNum.textContent = fmt(G.data);
    }

    const w = WEAPONS[p.weapon];
    const st = p.ammo[p.weapon];
    if (el.wIcon && el.wIcon.dataset.w !== String(p.weapon)) {
      el.wIcon.dataset.w = String(p.weapon);
      el.wIcon.src = 'assets/w' + p.weapon + '_side.png';
    }
    el.wTag.textContent = w.tag;
    el.wTag.style.color = w.color;
    el.wName.textContent = w.name;
    el.wMag.textContent = st.mag;
    el.wMag.style.color = st.mag === 0 ? '#ff5a4d' : '#fff';
    el.wRes.textContent = st.spare;
    el.wResLabel.textContent = '备弹 ' + st.spare + ' 夹';
    el.reloadFill.style.width = p.reloadTotal > 0 && p.reloadT > 0
      ? ((1 - p.reloadT / p.reloadTotal) * 100).toFixed(1) + '%'
      : '0%';

    for (let i = 0; i < G.carried.length; i++) {
      const s = el.slots.children[i];
      if (!s) continue;
      const wIdx = G.carried[i];
      const a = p.ammo[wIdx];
      s.classList.toggle('active', wIdx === p.weapon);
      s.classList.toggle('empty', a.mag === 0 && a.spare === 0);
      s.querySelector('.a').textContent = a.mag;
      s.querySelector('.bar').style.width = (a.mag / WEAPONS[wIdx].mag * 100) + '%';
    }

    /* 撤离进度 */
    if (G.extraction.progress > 0.05) {
      el.exBanner.classList.remove('hidden');
      const pct = clamp(G.extraction.progress / CFG.EXTRACT_HOLD, 0, 1);
      el.exFill.style.width = (pct * 100).toFixed(1) + '%';
      el.exPct.textContent = Math.floor(pct * 100) + '%';
    } else {
      el.exBanner.classList.add('hidden');
    }

    /* 情境提示 */
    let prompt = '';
    const near = G.nearLoot;
    if (near) {
      prompt = '<b>[F]</b> 拾取 ' + near.tier.name + ' · ' + near.name;
    } else if (p.reloadT > 0) {
      prompt = '换弹中…';
    } else if (st.mag === 0 && st.spare > 0) {
      prompt = '<b>[R]</b> 换弹（备弹 ' + st.spare + ' 夹）';
    } else if (st.mag === 0) {
      prompt = '弹夹耗尽 · TAB 背包制造弹夹';
    } else if (G.extraction.nearPad && G.extraction.progress <= 0.05) {
      prompt = '站入撤离台 · 保持 6 秒';
    }
    setPrompt(prompt);

    /* 小地图节流 */
    miniT += 1;
    if (miniT % 4 === 0) drawMinimap(G);
  }

  function drawMinimap(G) {
    const g = el.mini;
    const W = 192, H = 144;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(4,6,8,0.85)';
    g.fillRect(0, 0, W, H);
    if (!G.map) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(G.map.mini, 0, 0, W, H);

    const sx = W / (CFG.MAP_W * CFG.TILE);
    const sy = H / (CFG.MAP_H * CFG.TILE);

    // 撤离台
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
    for (const e of G.map.extracts) {
      g.fillStyle = 'rgba(159,230,255,' + pulse.toFixed(2) + ')';
      g.fillRect(e.x * sx - 2, e.y * sy - 2, 4, 4);
      g.strokeStyle = 'rgba(159,230,255,0.35)';
      g.strokeRect(e.x * sx - 5, e.y * sy - 5, 10, 10);
    }

    // 附近敌人
    if (G.player) {
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist2(G.player.x, G.player.y, e.x, e.y) > 430 * 430) continue;
        g.fillStyle = 'rgba(255,90,77,0.75)';
        g.fillRect(e.x * sx - 1, e.y * sy - 1, 2, 2);
      }
    }

    // 玩家
    if (G.player) {
      g.fillStyle = '#ffb648';
      g.fillRect(G.player.x * sx - 1.5, G.player.y * sy - 1.5, 3, 3);
      g.strokeStyle = 'rgba(255,182,72,0.5)';
      g.beginPath();
      g.moveTo(G.player.x * sx, G.player.y * sy);
      g.lineTo(G.player.x * sx + Math.cos(G.player.aim) * 6, G.player.y * sy + Math.sin(G.player.aim) * 6);
      g.stroke();
    }

    // 视口框
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.strokeRect(G.cam.x * sx, G.cam.y * sy, CFG.VW * sx, CFG.VH * sy);
  }

  function showPause(v) {
    el.pause.classList.toggle('hidden', !v);
  }

  function setMuteLabel() {
    const btn = document.getElementById('muteBtn');
    if (btn) btn.textContent = '音效：' + (SFX.isMuted() ? '关' : '开');
  }

  function showResults(r) {
    el.results.classList.remove('hidden');
    document.getElementById('resTag').textContent = r.success ? '// EXTRACTION COMPLETE' : '// SIGNAL LOST';
    document.getElementById('resTag').className = 'res-tag' + (r.success ? ' ok' : '');
    document.getElementById('resTitle').textContent = r.success ? '撤离成功' : '信号中断';
    document.getElementById('resKills').textContent = r.kills;
    document.getElementById('resLoot').textContent = r.looted;
    document.getElementById('resData').textContent = fmt(r.data) + ' NB';
    document.getElementById('resTime').textContent = fmtTime(r.time);
    const note = document.getElementById('resNote');
    if (r.success) {
      note.textContent = '数据 +' + fmt(r.banked || 0) + ' NB 已入账；' +
        (r.stashed || 0) + ' 件物资已存入仓库。';
    } else {
      note.textContent = '背包内 ' + (r.itemsLost || 0) + ' 件物资与未花完的携带数据已丢失（仓库不受影响）。';
    }
    const best = r.best;
    document.getElementById('resBest').textContent = best > 0
      ? ('最佳记录：' + fmt(best) + ' NB')
      : (r.success ? '本次成绩已记录' : '暂无撤离记录');
  }

  function hideResults() {
    el.results.classList.add('hidden');
  }

  function flashHurt() {
    const v = document.getElementById('vignette');
    v.classList.add('hurt');
    clearTimeout(flashHurt._t);
    flashHurt._t = setTimeout(() => v.classList.remove('hurt'), 140);
  }

  return {
    init, setLoadout, show, update, toast, showPause, showResults, hideResults,
    setMuteLabel, flashHurt
  };
})();
