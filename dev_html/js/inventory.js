'use strict';

/* ============================================================
   背包：多格物品 / 拖拽 / R 旋转 / 分解
   ============================================================ */
const Inventory = (() => {
  const COLS = CFG.INV_COLS;
  const ROWS = CFG.INV_ROWS;
  const CELL = 84;
  const GAP = 8;
  const PITCH = CELL + GAP;
  const GRID_W = COLS * CELL + (COLS - 1) * GAP;
  const GRID_H = ROWS * CELL + (ROWS - 1) * GAP;

  const el = {};
  let drag = null;
  let hoverItem = null;
  let ghost = null;
  let lastMouse = null;
  let builtCraft = false;

  /* ---------------- 初始化 ---------------- */
  function init() {
    el.panel = document.getElementById('inventory');
    el.grid = document.getElementById('invGrid');
    el.items = document.getElementById('invItems');
    el.drop = document.getElementById('invDrop');
    el.count = document.getElementById('invCount');
    el.detail = document.getElementById('invDetail');
    el.craft = document.getElementById('craftList');
    el.heal = document.getElementById('healBtn');
    el.close = document.getElementById('invClose');
    el.prog = document.getElementById('actionProg');
    el.progLabel = document.getElementById('apLabel');
    el.progFill = document.getElementById('apFill');

    /* 背景格 */
    for (let i = 0; i < CFG.INV_SIZE; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.addEventListener('click', () => {
        if (drag) return;
        G.inv.selected = null;
        refresh();
      });
      el.grid.insertBefore(d, el.items);
    }

    el.close.addEventListener('click', () => Game.closeInventory());
    el.heal.addEventListener('click', () => tryHeal());

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    buildCraftRows();
  }

  function buildCraftRows() {
    if (builtCraft) return;
    builtCraft = true;
    el.craft.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'craft-row';
      row.dataset.w = i;
      row.style.setProperty('--wc', w.color);
      row.innerHTML =
        '<span class="cw"></span>' +
        '<span class="cn">' + w.name + '</span>' +
        '<span class="cs" data-spare>0/2</span>' +
        '<span class="cc">' + w.cost + ' NB</span>';
      row.addEventListener('click', () => tryCraft(i));
      el.craft.appendChild(row);
    });
  }

  /* ---------------- 几何 ---------------- */
  function dims(item, rot) {
    const r = (rot === undefined ? item.rot : rot) ? 1 : 0;
    return r ? { w: item.h, h: item.w } : { w: item.w, h: item.h };
  }

  function overlaps(item, gx, gy, rot, ignore) {
    const d = dims(item, rot);
    if (gx < 0 || gy < 0 || gx + d.w > COLS || gy + d.h > ROWS) return true;
    for (const o of G.inv.items) {
      if (o === ignore) continue;
      const od = dims(o);
      if (gx < o.gx + od.w && gx + d.w > o.gx && gy < o.gy + od.h && gy + d.h > o.gy) return true;
    }
    return false;
  }

  function usedCells() {
    let n = 0;
    for (const it of G.inv.items) {
      const d = dims(it);
      n += d.w * d.h;
    }
    return n;
  }

  /* ---------------- 物品 ---------------- */
  function addItem(item) {
    item.rot = 0;
    for (const r of [0, 1]) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (!overlaps(item, x, y, r, null)) {
            item.gx = x;
            item.gy = y;
            item.rot = r;
            G.inv.items.push(item);
            G.picked++;
            refresh();
            return true;
          }
        }
      }
    }
    return false;
  }

  function removeItem(item) {
    const i = G.inv.items.indexOf(item);
    if (i >= 0) G.inv.items.splice(i, 1);
    if (G.inv.selected === item) G.inv.selected = null;
  }

  /* ---------------- 渲染 ---------------- */
  function renderGrid() {
    el.items.innerHTML = '';
    for (const item of G.inv.items) {
      if (drag && drag.item === item) continue;
      const d = dims(item);
      const div = document.createElement('div');
      div.className = 'inv-item' + (G.inv.selected === item ? ' sel' : '') + (d.w === 1 && d.h === 1 ? ' tiny' : '');
      div.style.left = (item.gx * PITCH) + 'px';
      div.style.top = (item.gy * PITCH) + 'px';
      div.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      div.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      div.style.setProperty('--qc', item.tier.color);
      div.innerHTML =
        '<span class="gem"></span>' +
        '<span class="nm">' + item.name + '</span>' +
        '<span class="val">' + item.value + '</span>' +
        '<span class="sz">' + d.w + '×' + d.h + '</span>';
      div.addEventListener('mousedown', e => onDown(e, item));
      div.addEventListener('mouseenter', () => { hoverItem = item; });
      div.addEventListener('mouseleave', () => { if (hoverItem === item) hoverItem = null; });
      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (drag) return;
        startDismantle(item);
      });
      el.items.appendChild(div);
    }
  }

  function renderDetail() {
    const item = G.inv.selected;
    if (!item || G.inv.items.indexOf(item) < 0) {
      el.detail.innerHTML = '<div class="dt-empty">左键拖动 · R 旋转 · 右键分解<br><span>物品尺寸固定，可自由摆放</span></div>';
      return;
    }
    const d = dims(item);
    el.detail.innerHTML =
      '<div class="dt-name">' + item.name + '</div>' +
      '<div class="dt-line"><span>' + item.tier.name + ' · 数据载体</span><b>' + item.value + ' NB</b></div>' +
      '<div class="dt-line"><span>占格 / 分解</span><b>' + d.w + '×' + d.h + ' · ' + item.time.toFixed(1) + 's</b></div>' +
      '<div class="dt-hint">[拖动] 移动 · [R] 旋转 · [右键] 分解</div>';
  }

  function renderCraft() {
    if (!el.craft) return;
    const rows = el.craft.children;
    for (let i = 0; i < WEAPONS.length; i++) {
      const row = rows[i];
      const carried = !G.carried || G.carried.length === 0 || G.carried.indexOf(i) >= 0;
      const spare = G.player ? G.player.ammo[i].spare : 0;
      row.querySelector('[data-spare]').textContent = carried ? (spare + '/2') : '未携带';
      row.classList.toggle('dis', !carried || spare >= 2);
    }
    const canHeal = G.player && G.player.hp < G.player.maxHp && G.data >= CFG.HEAL_COST;
    el.heal.classList.toggle('dis', !canHeal);
  }

  function refresh() {
    if (!el.grid) return;
    renderGrid();
    renderDetail();
    renderCraft();
    el.count.textContent = usedCells();
  }

  /* ---------------- 拖拽 ---------------- */
  function gridMetrics() {
    const r = el.grid.getBoundingClientRect();
    const scale = r.width / GRID_W || 1;
    return { rect: r, scale, pitch: PITCH * scale };
  }

  function onDown(e, item) {
    if (e.button !== 0) return;
    e.preventDefault();
    const { rect, pitch } = gridMetrics();
    const d = dims(item);
    const itemX = rect.left + item.gx * pitch;
    const itemY = rect.top + item.gy * pitch;
    const fx = clamp((e.clientX - itemX) / pitch, 0, d.w - 0.01);
    const fy = clamp((e.clientY - itemY) / pitch, 0, d.h - 0.01);

    drag = {
      item,
      ox: item.gx, oy: item.gy, orot: item.rot,
      fx, fy,
      moved: false,
      sx: e.clientX, sy: e.clientY,
      tx: item.gx, ty: item.gy, valid: true
    };
    G.inv.selected = item;
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    refresh();
    updateGhost(e);
  }

  function onMove(e) {
    if (!drag) return;
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    updateGhost(e);
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved && d.valid) {
      d.item.gx = d.tx;
      d.item.gy = d.ty;
    } else {
      d.item.gx = d.ox;
      d.item.gy = d.oy;
      /* 没移动但按过 R：原位能放下就保留旋转 */
      if (overlaps(d.item, d.ox, d.oy, d.item.rot, d.item)) {
        d.item.rot = d.orot;
      }
    }
    removeGhost();
    el.drop.style.display = 'none';
    refresh();
  }

  function updateGhost(e) {
    if (!drag || !e) return;
    const { rect, scale, pitch } = gridMetrics();
    const item = drag.item;
    const d = dims(item);

    const tx = Math.round((e.clientX - rect.left) / pitch - drag.fx);
    const ty = Math.round((e.clientY - rect.top) / pitch - drag.fy);
    const valid = !overlaps(item, tx, ty, item.rot, item);
    drag.tx = tx;
    drag.ty = ty;
    drag.valid = valid;

    if (drag.moved) {
      el.drop.style.display = 'block';
      el.drop.style.left = (tx * PITCH) + 'px';
      el.drop.style.top = (ty * PITCH) + 'px';
      el.drop.style.width = (d.w * CELL + (d.w - 1) * GAP) + 'px';
      el.drop.style.height = (d.h * CELL + (d.h - 1) * GAP) + 'px';
      el.drop.className = 'inv-drop ' + (valid ? 'ok' : 'bad');
    } else {
      el.drop.style.display = 'none';
    }

    const g = ensureGhost();
    const gw = (d.w * CELL + (d.w - 1) * GAP) * scale;
    const gh = (d.h * CELL + (d.h - 1) * GAP) * scale;
    g.style.width = gw + 'px';
    g.style.height = gh + 'px';
    g.style.left = (e.clientX - drag.fx * pitch) + 'px';
    g.style.top = (e.clientY - drag.fy * pitch) + 'px';
    g.style.setProperty('--qc', item.tier.color);
    g.querySelector('.nm').textContent = item.name;
    g.querySelector('.val').textContent = item.value;
    g.querySelector('.sz').textContent = d.w + '×' + d.h;
  }

  function ensureGhost() {
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'inv-item inv-ghost';
      ghost.innerHTML = '<span class="gem"></span><span class="nm"></span><span class="val"></span><span class="sz"></span>';
      document.body.appendChild(ghost);
    }
    return ghost;
  }

  function removeGhost() {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }

  function cancelDrag() {
    if (!drag) return;
    drag.item.gx = drag.ox;
    drag.item.gy = drag.oy;
    drag.item.rot = drag.orot;
    drag = null;
    removeGhost();
    if (el.drop) el.drop.style.display = 'none';
  }

  /* ---------------- 旋转 ---------------- */
  function rotate() {
    if (!G.inventoryOpen) return;
    if (drag) {
      drag.item.rot = drag.item.rot ? 0 : 1;
      if (lastMouse) updateGhost(lastMouse);
      SFX.ui();
      return;
    }
    const item = hoverItem && G.inv.items.indexOf(hoverItem) >= 0 ? hoverItem : G.inv.selected;
    if (!item) return;
    const nr = item.rot ? 0 : 1;
    if (!overlaps(item, item.gx, item.gy, nr, item)) {
      item.rot = nr;
      SFX.ui();
      refresh();
    } else {
      HUD.toast('空间不足，无法旋转', 'warn');
    }
  }

  /* ---------------- 开关 ---------------- */
  function open() {
    if (!G.player || G.player.dead) return;
    G.inventoryOpen = true;
    el.panel.classList.remove('hidden');
    if (!G.action) {
      el.prog.classList.add('hidden');
      el.progFill.style.width = '0%';
    }
    Input.mouse.down = false;
    Input.releaseAll();
    SFX.ui();
    refresh();
  }

  function close() {
    if (!G.inventoryOpen) return;
    cancelDrag();
    G.inventoryOpen = false;
    el.panel.classList.add('hidden');
    if (G.action) cancelAction('已取消');
    SFX.ui();
  }

  function toggle() {
    if (G.inventoryOpen) close();
    else open();
  }

  /* ---------------- 动作 ---------------- */
  function busy() {
    if (G.action) {
      HUD.toast('正在处理其他操作', 'warn');
      return true;
    }
    return false;
  }

  function startDismantle(item) {
    if (!item) return;
    if (busy()) return;
    G.inv.selected = item;
    G.action = {
      type: 'dismantle', item, t: 0, dur: item.time,
      label: '分解 ' + item.name
    };
    el.prog.classList.remove('hidden');
    refresh();
    SFX.ui();
  }

  function tryCraft(i) {
    const w = WEAPONS[i];
    const st = G.player.ammo[i];
    if (busy()) return;
    if (G.carried && G.carried.indexOf(i) < 0) { HUD.toast('未携带该武器', 'warn'); return; }
    if (st.spare >= w.maxSpare) { HUD.toast('备弹已满（2 夹）', 'warn'); return; }
    if (G.data < w.cost) { HUD.toast('数据不足 · 需要 ' + w.cost + ' NB', 'warn'); return; }
    G.action = {
      type: 'mag', weapon: i, t: 0, dur: CFG.MAG_TIME,
      label: '压制 ' + w.name + ' 弹夹'
    };
    el.prog.classList.remove('hidden');
    SFX.reloadStart();
  }

  function tryHeal() {
    const p = G.player;
    if (busy()) return;
    if (p.hp >= p.maxHp) { HUD.toast('生命值已满', 'warn'); return; }
    if (G.data < CFG.HEAL_COST) { HUD.toast('数据不足 · 需要 ' + CFG.HEAL_COST + ' NB', 'warn'); return; }
    G.action = { type: 'heal', t: 0, dur: CFG.HEAL_TIME, label: '再生治疗' };
    el.prog.classList.remove('hidden');
    SFX.heal();
  }

  function cancelAction(msg) {
    if (!G.action) return;
    G.action = null;
    el.prog.classList.add('hidden');
    el.progFill.style.width = '0%';
    if (msg) HUD.toast(msg, 'warn');
  }

  function complete() {
    const a = G.action;
    G.action = null;
    el.prog.classList.add('hidden');
    el.progFill.style.width = '0%';
    if (!a) return;

    if (a.type === 'dismantle') {
      const item = a.item;
      if (!item || G.inv.items.indexOf(item) < 0) return;
      removeItem(item);
      G.data += item.value;
      SFX.data();
      HUD.toast('+' + item.value + ' NB · 数据提取完成', 'good');
      refresh();
    } else if (a.type === 'mag') {
      const w = WEAPONS[a.weapon];
      const st = G.player.ammo[a.weapon];
      if (G.data < w.cost) { HUD.toast('数据不足', 'warn'); return; }
      G.data -= w.cost;
      st.spare = Math.min(w.maxSpare, st.spare + 1);
      SFX.reloadDone();
      HUD.toast('弹夹压装完成 · ' + w.name, 'good');
      refresh();
    } else if (a.type === 'heal') {
      if (G.data < CFG.HEAL_COST) { HUD.toast('数据不足', 'warn'); return; }
      G.data -= CFG.HEAL_COST;
      G.player.hp = G.player.maxHp;
      SFX.heal();
      HUD.toast('生命值已回复', 'good');
      refresh();
    }
  }

  function update(dt) {
    if (!G.action) return;
    if (!G.inventoryOpen) { cancelAction(); return; }
    if (G.player.moving || G.player.dead) { cancelAction('操作中断'); return; }

    G.action.t += dt;
    const pct = clamp(G.action.t / G.action.dur, 0, 1) * 100;
    el.progFill.style.width = pct.toFixed(1) + '%';
    el.progLabel.textContent = G.action.label + ' · ' + Math.floor(pct) + '%';

    if (G.action.t >= G.action.dur) complete();
  }

  return { init, addItem, refresh, open, close, toggle, update, rotate, cancelAction };
})();
