'use strict';

/* ============================================================
   HUD：DOM 覆盖层（局内）
   ============================================================ */

const HUD = (function () {
  let el = {};
  let fpsT = 0, fpsN = 0, fps = 0;
  let hitT = 0;

  function $(id) { return document.getElementById(id); }

  function boot() {
    el = {
      hud: $('hud'),
      hpFill: $('hpFill'), hpNum: $('hpNum'),
      shdFill: $('shdFill'), shdNum: $('shdNum'),
      staFill: $('staFill'),
      wName: $('wName'), wTag: $('wTag'), wMag: $('wMag'), wRes: $('wRes'),
      kills: $('kills'), loot: $('loot'), timer: $('timer'),
      data: $('dataNum'),
      camInfo: $('camInfo'),
      objective: $('objective'), objText: $('objText'),
      slots: $('slots'),
      prompt: $('prompt'),
      exWrap: $('extractWrap'), exFill: $('exFill'),
      dmg: $('dmgFlash'),
      end: $('endScreen'), endTag: $('endTag'), endTitle: $('endTitle'),
      endBody: $('endBody'), endNote: $('endNote'), endContracts: $('endContracts'),
      reload: $('reloadWrap'), reloadFill: $('reloadFill'),
      hitmark: $('hitmark'),
      reloadBtn: document.querySelector('[data-touch-act="reload"]')
    };
  }

  function pct(v, m) { return Math.max(0, Math.min(1, v / m)) * 100; }

  function vitals() {
    const p = G.state.player;
    if (!el.hpFill) return;
    el.hpFill.style.width = pct(p.hp, p.maxHp) + '%';
    el.shdFill.style.width = pct(p.shield, p.maxShield) + '%';
    el.staFill.style.width = pct(p.stam, CFG.PLAYER.stam) + '%';
    el.hpNum.textContent = Math.ceil(p.hp);
    el.shdNum.textContent = Math.ceil(p.shield);
  }

  function data(n) {
    if (el.data) el.data.textContent = UI.fmt(n);
  }

  function mag(i) {
    const p = G.state.player;
    const w = WEAPONS[i];
    if (!w) return;
    el.wName.textContent = w.name;
    el.wTag.textContent = w.tag;
    el.wMag.textContent = p.mags[i];
    el.wRes.textContent = p.spares[i];
  }

  /* 左下两个武器槽 */
  function buildSlots(p) {
    if (!el.slots) return;
    el.slots.innerHTML = '';
    for (let s = 0; s < p.carried.length; s++) {
      const wi = p.carried[s];
      const w = WEAPONS[wi];
      const d = UI.el('div', 'slot');
      d.dataset.slot = s;
      d.style.setProperty('--wc', w.color);
      d.innerHTML =
        '<div class="s-top"><span class="s-key">' + (s + 1) + '</span>' +
        '<span class="s-tag">' + w.tag + '</span></div>' +
        '<div class="s-name">' + w.name + '</div>' +
        '<div class="s-ammo"><b data-mag>0</b> / <span data-spare>0</span> 夹</div>';
      d.addEventListener('click', function () { G.switchSlot(s); });
      el.slots.appendChild(d);
    }
    updateSlots(p);
  }

  function updateSlots(p) {
    if (!el.slots) return;
    p = p || G.state.player;
    const list = el.slots.children;
    for (let s = 0; s < list.length; s++) {
      const wi = p.carried[s];
      if (wi === undefined) continue;
      const node = list[s];
      node.classList.toggle('on', s === p.slot);
      const m = node.querySelector('[data-mag]');
      const sp = node.querySelector('[data-spare]');
      if (m) m.textContent = p.mags[wi];
      if (sp) sp.textContent = p.spares[wi];
    }
  }

  function reset() {
    const p = G.state.player;
    vitals();
    mag(p.weapon);
    el.kills.textContent = '0';
    el.loot.textContent = '0';
    el.data.textContent = '0';
    el.end.classList.add('hidden');
    el.dmg.classList.remove('hit');
    el.exWrap.classList.remove('on');
    el.exFill.style.width = '0%';
    el.reload.classList.add('hidden');
    prompt(null);
    objective('撤离点', false);
    el.hpNum.textContent = Math.ceil(p.maxHp);
    el.shdNum.textContent = Math.ceil(p.maxShield);
    updateSlots(p);
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

  function toast(msg, type) { UI.toast(msg, type); }

  function prompt(html) {
    if (!el.prompt) return;
    if (!html) {
      el.prompt.classList.add('hidden');
      el.prompt.innerHTML = '';
      return;
    }
    el.prompt.classList.remove('hidden');
    el.prompt.innerHTML = html;
  }

  function objective(text, near) {
    if (!el.objective) return;
    el.objective.classList.toggle('on', !!near);
    el.objText.textContent = text;
  }

  function setCombatMode(on) {
    if (el.hud) el.hud.classList.toggle('hidden', !on);
    if (el.hitmark) el.hitmark.classList.toggle('hidden', !on);
    if (el.dmg) el.dmg.style.display = on ? '' : 'none';
    document.body.classList.toggle('combat', !!on);
  }

  function setAimVisible(on) {
    if (el.hitmark) el.hitmark.classList.toggle('hidden', !on);
  }

  /* 命中标记跟随鼠标位置 */
  function aimAt(x, y) {
    if (!el.hitmark) return;
    el.hitmark.style.left = x + 'px';
    el.hitmark.style.top = y + 'px';
  }

  /* 命中反馈：命中标记 */
  function hit(kill) {
    if (!el.hitmark) return;
    el.hitmark.classList.toggle('kill', !!kill);
    el.hitmark.classList.remove('on');
    void el.hitmark.offsetWidth;
    el.hitmark.classList.add('on');
    hitT = kill ? 0.2 : 0.12;
  }

  function end(win, info) {
    el.end.classList.remove('hidden');
    const abandon = info.reason === 'abandon';
    el.endTag.textContent = abandon ? '// ABORTED' : (win ? '// EXTRACTION' : '// SIGNAL LOST');
    el.endTag.className = 'end-tag' + (win ? '' : ' lose');

    let title = win ? '撤离成功' : (abandon ? '行动中止' : '信号中断');
    el.endTitle.textContent = title;
    el.endTitle.className = 'end-title ' + (win ? 'win' : 'lose');

    const time = UI.time(info.time);
    el.endBody.innerHTML =
      '<div><span>击杀</span><b>' + info.kills + '</b></div>' +
      '<div><span>拾取</span><b>' + info.loot + '</b></div>' +
      '<div><span>用时</span><b>' + time + '</b></div>' +
      '<div><span>数据</span><b class="' + (win ? 'amber' : '') + '">' +
        (win ? '+' + UI.fmt(info.data) + ' NB' : '0 NB') + '</b></div>' +
      '<div><span>物资价值</span><b>' + (win ? UI.fmt(info.haul) + ' NB' : '0 NB') + '</b></div>' +
      '<div><span>入库</span><b class="' + (win ? 'green' : '') + '">' +
        (win ? info.stored + ' 件' : '0 件') + '</b></div>';

    let note;
    if (win) {
      note = '数据 <b>+' + UI.fmt(info.data) + ' NB</b> 已入账 · ' +
        info.stored + ' 件物资已入库';
      if (info.overflow > 0) {
        note += ' · 仓库已满，' + info.overflow + ' 件自动分解为 ' + UI.fmt(info.overflowValue) + ' NB';
      }
    } else {
      const cause = info.reason === 'death' ? '生命体征归零。' : '你主动放弃了本次行动。';
      note = cause + '本局物资与未花完的数据全部丢失；账户、仓库和强化不受影响。';
    }
    if (info.dismantled > 0) note += '<br>局内分解 ' + UI.fmt(info.dismantled) + ' NB';
    el.endNote.innerHTML = note;

    if (info.contracts && info.contracts.length) {
      el.endContracts.textContent = '合约已完成待领取：' + info.contracts.join(' / ');
    } else {
      el.endContracts.textContent = '最佳带出记录 ' + UI.fmt(info.best) + ' NB';
    }
  }

  function hideEnd() { el.end.classList.add('hidden'); }

  function tick(dt) {
    if (!G.state || !G.state.player) return;
    fpsT += dt; fpsN++;
    if (fpsT > 0.4) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
    const p = G.state.player;
    if (G.mode !== 'mission') return;
    el.camInfo.textContent = Math.round(G.state.cam.pitch) + '° · ' + fps + 'fps';
    el.data.textContent = UI.fmt(p.data);
    updateSlots(p);

    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) {
        if (el.hitmark) el.hitmark.classList.remove('on');
      }
    }
    const t = Math.floor(G.state.time);
    if (el.timer) el.timer.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    if (p.reload > 0) {
      const w = WEAPONS[p.weapon];
      el.reload.classList.remove('hidden');
      el.reloadFill.style.width = (100 - (p.reload / (w.reload * p.reloadMul)) * 100) + '%';
    } else if (el.reload) {
      el.reload.classList.add('hidden');
    }
    if (el.reloadBtn) {
      const busy = p.reload > 0;
      const flag = busy ? '1' : '0';
      if (el.reloadBtn.dataset.busy !== flag) {
        el.reloadBtn.dataset.busy = flag;
        el.reloadBtn.textContent = busy ? '换弹中' : '换弹';
      }
    }
  }

  window.addEventListener('DOMContentLoaded', boot);

  return {
    vitals: vitals, mag: mag, reset: reset, kills: kills, loot: loot,
    data: data, prompt: prompt, setCombatMode: setCombatMode, setAimVisible: setAimVisible,
    aimAt: aimAt,
    objective: objective,
    buildSlots: buildSlots, updateSlots: updateSlots,
    extract: extract, damage: damage, toast: toast, hit: hit,
    end: end, hideEnd: hideEnd, tick: tick
  };
})();
