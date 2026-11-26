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

  function run() {
    try {
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
      eq('tier color', ITEMS.tier('rare').color, '#4d8bff');

      /* ---------- 3. 仓库 ---------- */
      const mats = [ITEMS.roll('common'), ITEMS.roll('fine'), ITEMS.roll('rare')];
      let added = 0;
      mats.forEach(function (m) { if (Store.stashAdd(m)) added++; });
      eq('stash add 3', added, 3);
      eq('stash count', Store.stashCount(), 3);
      const stashValue = Store.stashValue();
      const bank0 = Store.bank();
      const first = Store.stash()[0];
      const got = Store.stashDismantle(first);
      eq('dismantle returns value', got, first.value);
      eq('bank after dismantle', Store.bank(), bank0 + first.value);
      eq('stash count after', Store.stashCount(), 2);
      eq('stash value after', Store.stashValue(), stashValue - first.value);
      Store.stashRepack();
      eq('repack keeps items', Store.stashCount(), 2);

      /* ---------- 4. 大厅 DOM ---------- */
      eq('tabs built', document.querySelectorAll('#lobbyTabs .tab').length, 6);
      ['paneStash', 'paneCraft', 'paneShop', 'paneContracts', 'paneArchive'].forEach(function (id) {
        check('pane ' + id, !!document.getElementById(id));
      });
      check('lobby visible', !document.getElementById('lobby').classList.contains('hidden'));
      eq('char cards', document.querySelectorAll('#lobbyChars .char-card').length, 6);
      check('tactical unit exists', !!MODELS.UNITS.tactical);
      check('scav units exist', !!MODELS.UNITS.scav && !!MODELS.UNITS.raider && !!MODELS.UNITS.veteran);
      check('weapon crate model ready', ASSETS.weaponcrate.ready);
      Store.setChar(2);
      eq('tactical char selectable', Store.char(), 2);
      Store.setChar(5);
      eq('veteran char selectable', Store.char(), 5);
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
      const gunners = G.state.enemies.filter(function (e) { return e.gunner; });
      eq('gunner count', gunners.length, CFG.GUNNER_COUNT);
      check('gunner armed', gunners.length > 0 && gunners[0].ammo === WEAPONS[CFG.GUNNER.weaponId].mag);
      check('gunner has loot bag', gunners.length > 0 && Array.isArray(gunners[0].lootBag) && gunners[0].lootBag.length > 0);
      const undead = G.state.enemies.filter(function (e) { return !e.gunner && !e.dead; });
      check('enemy factions', gunners.length > 0 && undead.length > 0 &&
        gunners[0].faction === 'scav' && undead[0].faction === 'undead');

      /* 视野：360° + 24m + 墙体/木箱遮挡 */
      check('vision all-round front', G.vision(p.x, p.z + 0.4));
      check('vision all-round behind', G.vision(p.x, p.z - 0.4));
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
      node1.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2
      }));
      eq('right click starts dismantle', Inventory.actionType(), 'dismantle');
      Inventory.debugComplete();
      eq('dismantle added data', p.data, dataBefore + mat.value);
      eq('inventory empty', p.inv.length, 0);
      eq('dismantled tracked', p.dismantledValue, mat.value);

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
        const sitem = ITEMS.makeChipItem({ chipId: sdef.id, tierId: 'fine', value: 40 });
        check('series def ' + sdef.id, !!sitem);
        check('series fits own ' + sdef.id, ITEMS.chipFitsWeapon(sitem, sdef.wi));
        check('series rejects other ' + sdef.id, !ITEMS.chipFitsWeapon(sitem, sdef.other));
        Store.stashAdd(sitem);
        const stored = Store.stash().filter(function (it) { return it.chipId === sdef.id; })[0];
        check('series wrong weapon blocked ' + sdef.id, !Store.installChip(sdef.other, stored).ok);
        check('series install ' + sdef.id, Store.installChip(sdef.wi, stored).ok);
        near('series mod ' + sdef.id, Store.weaponMods(sdef.wi)[sdef.field], sdef.want, 1e-9);
        Store.uninstallChip(sdef.wi, 0);
      }

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
      const dismantleValue = Store.stashDismantle(craftedItem);
      eq('chip dismantle returns data value', dismantleValue, CHIP_BY_ID.power.value);
      const weaponBank = Store.bank();
      const craftedWeapon = Store.craftWeapon(3);
      check('craft weapon ok', craftedWeapon.ok);
      eq('craft weapon cost', Store.bank(), weaponBank - WEAPONS[3].craft);
      const craftedWeaponItem = Store.stash().filter(function (it) { return it.kind === 'weapon'; })[0];
      check('crafted weapon in stash', !!craftedWeaponItem);
      eq('crafted weapon size', craftedWeaponItem.w + 'x' + craftedWeaponItem.h, '3x1');
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
