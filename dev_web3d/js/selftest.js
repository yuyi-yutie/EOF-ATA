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
      eq('kit starter medkit', Store.kit().medkit, 1);
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
      eq('tabs built', document.querySelectorAll('#lobbyTabs .tab').length, 5);
      ['paneStash', 'paneShop', 'paneContracts', 'paneArchive'].forEach(function (id) {
        check('pane ' + id, !!document.getElementById(id));
      });
      check('lobby visible', !document.getElementById('lobby').classList.contains('hidden'));

      /* ---------- 5. 出击 ---------- */
      G.beginMission({ weapons: [3, 0], mags: [2, 1], data: 300, character: 1 });
      const p = G.state.player;
      eq('mode mission', G.mode, 'mission');
      eq('carried 2', p.carried.length, 2);
      eq('weapon slot 0', p.weapon, 3);
      eq('kinetic loaded', p.mags[3], WEAPONS[3].mag);
      eq('kinetic spare 1', p.spares[3], 1);
      eq('sonic loaded', p.mags[0], WEAPONS[0].mag);
      eq('sonic spare 0', p.spares[0], 0);
      eq('carry data', p.data, 300);
      eq('character assault', p.charKey, 'assault');
      eq('hud slots', document.querySelectorAll('#slots .slot').length, 2);
      check('hud visible', !document.getElementById('hud').classList.contains('hidden'));
      check('world has loot', World.loot.length >= 20, World.loot.length);
      check('loot near count', World.loot.length <= CFG.LOOT_COUNT + 8, World.loot.length);
      check('loot has item', !!(World.loot[0] && World.loot[0].item));

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
      node0.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse',
        clientX: rect0.left + 8, clientY: rect0.top + 8
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, buttons: 1, pointerId: 1, pointerType: 'mouse',
        clientX: rect0.left + 8 + 80, clientY: rect0.top + 8
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
      p.spares[3] = 0;
      Inventory.debugCraft(3);
      Inventory.debugComplete();
      eq('craft spare', p.spares[3], 1);
      eq('craft cost', p.data, 200 - WEAPONS[3].cost);
      p.mags[3] = 3;
      G.debug.reload();
      G.debug.finishReload();
      eq('reload fills whole mag', p.mags[3], WEAPONS[3].mag);
      eq('reload consumes one spare', p.spares[3], 0);
      p.hp = 40;
      p.data = 200;
      Inventory.debugHeal();
      Inventory.debugComplete();
      eq('heal full', p.hp, p.maxHp);
      eq('heal cost', p.data, 200 - CFG.HEAL_COST);

      /* ---------- 8. 拾取 + 站入撤离台（真实 update 循环） ---------- */
      Inventory.close();
      Inventory.addItem(ITEMS.roll('epic'));
      const node = World.loot.filter(function (l) { return !l.taken; })[0];
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
      Store.setKit({ medkit: 3, battery: 2 });
      G.beginMission({ weapons: [3, 0], mags: [1, 1], data: 300, character: 0 });
      Inventory.addItem(ITEMS.roll('epic'));
      G.finishRun(false, 'death');
      eq('bank unchanged on death', Store.bank(), bankDeath);
      eq('stash unchanged on death', Store.stashCount(), stashDeath);
      eq('kit lost on death', Store.kit().medkit, 0);
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
      Store.setLoadout({ weapons: [1, 4], mags: [2, 3], carry: 200 });
      Store.setChar(1);
      Store.addBank(77);
      const bankSave = Store.bank();
      const stashSave = Store.stashCount();
      Store.save();
      Store.load();
      eq('bank persisted', Store.bank(), bankSave);
      eq('stash persisted', Store.stashCount(), stashSave);
      eq('loadout persisted', Store.loadout().weapons.join(','), '1,4');
      eq('loadout mags', Store.loadout().mags.join(','), '2,3');
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
      document.querySelector('#lobbyTabs .tab[data-tab="loadout"]').click();
      check('loadout tab click', !document.getElementById('paneStash').classList.contains('on'));

      /* 武器卡：取消再选回（选共振霰弹，避免打乱弹夹槽位） */
      const cardSonic = document.querySelectorAll('#lobbyWeapons .wc')[0];
      const onBefore = document.querySelectorAll('#lobbyWeapons .wc.on').length;
      cardSonic.click();
      eq('weapon deselect', document.querySelectorAll('#lobbyWeapons .wc.on').length, onBefore - 1);
      cardSonic.click();
      eq('weapon reselect', document.querySelectorAll('#lobbyWeapons .wc.on').length, onBefore);

      /* 弹夹 + / − */
      const plus = document.querySelector('#lobbyLoad [data-a="+"]');
      const n0 = parseInt(plus.closest('.load-row').querySelector('.lr-num').textContent, 10);
      plus.click();
      const plusN = parseInt(document.querySelector('#lobbyLoad .lr-num').textContent, 10);
      eq('mag plus increments', plusN, n0 + 1);
      document.querySelector('#lobbyLoad [data-a="-"]').click();
      const minusN = parseInt(document.querySelector('#lobbyLoad .lr-num').textContent, 10);
      eq('mag minus restores', minusN, n0);

      /* ---------- 13. 补给购买 ---------- */
      Store.reset();
      Lobby.reloadFromSave();
      G.toLobby();
      Lobby.refresh();
      Lobby.setTab('stash');
      check('stash tab active', document.getElementById('paneStash').classList.contains('on'));
      Lobby.setTab('loadout');
      const bankBuy = Store.bank();
      const medBefore = Store.kit().medkit;
      const buy = Store.buySupply('medkit');
      check('buy supply ok', buy.ok);
      eq('supply kit +1', Store.kit().medkit, medBefore + 1);
      eq('supply bank -90', Store.bank(), bankBuy - 90);

      /* ---------- 14. 大厅出击按钮 ---------- */
      const bankLaunch = Store.bank();
      document.getElementById('lobbyStart').click();
      eq('launch button starts run', G.mode, 'mission');
      eq('launch deducts loadout cost', Store.bank(), bankLaunch - (WEAPONS[3].cost + 100));
      check('lobby hidden on launch', document.getElementById('lobby').classList.contains('hidden'));
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
