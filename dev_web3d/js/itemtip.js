'use strict';

/* ============================================================
   物品详情浮层
   - 桌面：鼠标悬停显示
   - 触屏：手指长按 450ms 显示
   - 只读，不拦截点击/拖拽；长按后本次抬手会被 Inventory 消费掉
   ============================================================ */

const ItemTip = (function () {
  let el = null;
  let press = null;
  let suppress = { id: -1, t: 0 };
  let lastPointerType = 'mouse';
  let currentItem = null;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'item-tip';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  function hide() {
    if (el) el.style.display = 'none';
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function chipHtml(item, tier, def) {
    const typeColor = def ? def.color : '#9aa4ad';
    const typeLabel = def && def.forTag ? def.forTag + '专属芯片' : '通用芯片';
    return '' +
      '<div class="it-line"><span>芯片效果</span><b style="color:' + typeColor + '">' +
        (def ? def.desc : '未知芯片') + '</b></div>' +
      '<div class="it-line"><span>类型 / 限制</span><b>' +
        typeLabel + (def && def.forTag ? ' · 仅限 ' + def.forTag + ' 武器' : ' · 任意武器') + '</b></div>';
  }

  function materialHtml(item, tier) {
    return '' +
      '<div class="it-line"><span>物品类型</span><b>' + tier.name + ' · 数据载体</b></div>';
  }

  function weaponHtml(item) {
    const w = WEAPONS[item.weaponId] || { name: item.name, tag: '武器', mag: 0, dmg: 0, rate: 0, color: '#9aa4ad' };
    const chips = (item.chips || []).length;
    return '' +
      '<div class="it-line"><span>武器类型</span><b style="color:' + w.color + '">' + w.tag + ' · ' + w.name + '</b></div>' +
      '<div class="it-line"><span>弹夹 / 射速</span><b>' + w.mag + ' 发 · ' + (w.rate || 0).toFixed(2) + 's</b></div>' +
      '<div class="it-line"><span>基础伤害</span><b>' + w.dmg + '</b></div>' +
      '<div class="it-line"><span>已装芯片</span><b>' + chips + ' / 3</b></div>';
  }

  function elementsHtml(item) {
    const tags = UI.elementTags(item && item.elements);
    if (!tags) return '<div class="it-line it-elements"><span>元素属性</span><b class="dim">无元素</b></div>';
    return '<div class="it-line it-elements"><span>元素属性</span><b>' + tags + '</b></div>';
  }

  function position(x, y) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x + 16;
    let top = y + 16;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 16;
    el.style.left = clamp(left, 8, window.innerWidth - r.width - 8) + 'px';
    el.style.top = clamp(top, 8, window.innerHeight - r.height - 8) + 'px';
  }

  function show(item, x, y, showElements) {
    if (!item) { hide(); return; }
    const node = ensure();
    currentItem = item;
    const tier = ITEMS.tier(item.tierId);
    const chip = item.kind === 'chip';
    const weapon = item.kind === 'weapon';
    const def = chip ? CHIP_BY_ID[item.chipId] : null;
    const wdef = weapon ? WEAPONS[item.weaponId] : null;
    const typeColor = weapon ? (wdef ? wdef.color : tier.color) : (def ? def.color : tier.color);
    const d = Grid.dims(item);
    const hasEl = (typeof ITEMS !== 'undefined' && ITEMS.hasElements(item.elements));
    const inRaid = (typeof G !== 'undefined' && G.mode === 'mission');
    const dismantleGain = (showElements && hasEl && !inRaid) ? '数据 + 元素' : '数据';
    const elementRaidNote = (showElements && hasEl && inRaid) ? ' · 元素需在仓库分解' : '';

    node.style.setProperty('--qc', tier.color);
    node.style.setProperty('--cc', typeColor);
    node.innerHTML =
      '<div class="it-name">' + UI.esc(item.name) + '</div>' +
      '<div class="it-tags"><i></i><span>' + tier.name + '</span><em>' +
        (weapon ? (wdef ? wdef.tag + ' · 武器' : '武器') : (chip ? (def && def.forTag ? def.forTag + '专属' : '通用芯片') : '物资')) + '</em></div>' +
      (chip ? chipHtml(item, tier, def) : (weapon ? weaponHtml(item) : materialHtml(item, tier))) +
      (showElements ? elementsHtml(item) : '') +
      '<div class="it-line"><span>数据价值</span><b>' + (item.value || 0) + ' NB</b></div>' +
      '<div class="it-grid">' +
        '<div><span>尺寸</span><b>' + d.w + '×' + d.h + '</b></div>' +
        '<div><span>分解耗时</span><b>' + (item.time || 1).toFixed(1) + 's</b></div>' +
      '</div>' +
      (weapon ? '<div class="it-foot">可在仓库装备 · 分解获得' + dismantleGain + elementRaidNote + '</div>'
        : (chip ? '<div class="it-foot">可装入武器芯片槽 · 分解获得' + dismantleGain + elementRaidNote + '</div>'
                : '<div class="it-foot">右键 / 分解按钮可提取' + dismantleGain + elementRaidNote + '</div>'));

    node.style.display = 'block';
    node.style.left = '0px';
    node.style.top = '0px';
    position(x, y);
  }

  function cancelPress() {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
  }

  function bind(node, item, opts) {
    if (!node) return;
    const touchEnabled = !opts || opts.touch !== false;
    const showElements = !!(opts && opts.showElements);

    node.addEventListener('mouseenter', function (e) {
      if (lastPointerType === 'touch') return;
      if (e.buttons) return;
      show(item, e.clientX, e.clientY, showElements);
    });
    node.addEventListener('mousemove', function (e) {
      if (lastPointerType === 'touch' || e.buttons) return;
      if (el && el.style.display !== 'none' && currentItem === item) position(e.clientX, e.clientY);
    });
    node.addEventListener('mouseleave', hide);

    node.addEventListener('pointerdown', function (e) {
      lastPointerType = e.pointerType || 'mouse';
      hide();
      if (e.pointerType === 'mouse' || !touchEnabled) return;
      cancelPress();
      press = {
        id: e.pointerId, item: item, x: e.clientX, y: e.clientY, timer: 0
      };
      press.timer = setTimeout(function () {
        if (!press || press.id !== e.pointerId) return;
        suppress = { id: e.pointerId, t: Date.now() };
        show(press.item, press.x, press.y, showElements);
      }, 450);
    });
  }

  /* 长按结束后，由 Inventory 在 pointerup 时消费一次，避免误触转移/放置 */
  function consume(pointerId) {
    if (suppress.id === pointerId && Date.now() - suppress.t < 1500) {
      suppress = { id: -1, t: 0 };
      return true;
    }
    return false;
  }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') lastPointerType = 'mouse';
    if (!press || e.pointerId !== press.id) return;
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 8) {
      cancelPress();
      hide();
    }
  });
  window.addEventListener('pointerup', function (e) {
    if (press && press.id === e.pointerId) {
      cancelPress();
      if (e.pointerType !== 'mouse') hide();
    }
  });
  window.addEventListener('pointercancel', function () {
    cancelPress();
    hide();
  });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);

  return { bind: bind, show: show, hide: hide, consume: consume };
})();
