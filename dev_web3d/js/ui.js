'use strict';

/* ============================================================
   UI 小工具：DOM 构建 / 数字格式
   ============================================================ */

const UI = (function () {
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, html) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function fmt(n) {
    n = Math.round(n || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function time(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /* 元素库存条：固定显示五系元素，数量为 0 也保留，便于看出资源缺口 */
  function elementStrip(pool) {
    let html = '';
    for (let i = 0; i < ELEMENTS.length; i++) {
      const e = ELEMENTS[i];
      const n = Math.max(0, Math.round((pool && pool[e.id]) || 0));
      html += '<span class="element-pill" style="--ec:' + e.color + '"><i></i>' +
        e.name + '<b>' + fmt(n) + '</b></span>';
    }
    return html;
  }

  /* 单件物品的元素标签 */
  function elementTags(elements) {
    if (typeof ITEMS === 'undefined' || !ITEMS.elementEntries) return '';
    return ITEMS.elementEntries(elements).map(function (e) {
      return '<span class="element-tag" style="--ec:' + e.color + '"><i></i>' +
        e.name + '<b>' + e.amount + '</b></span>';
    }).join('');
  }

  /* 1×1 芯片小方块（武器槽内展示） */
  function chipTile(entry) {
    const def = (typeof CHIP_BY_ID !== 'undefined' && entry) ? CHIP_BY_ID[entry.chipId] : null;
    if (!def) return '';
    const tier = (typeof ITEMS !== 'undefined') ? ITEMS.tier(entry.tierId) : { color: '#9aa4ad' };
    return '<span class="chip-tile" style="--qc:' + tier.color + ';--cc:' + def.color + '"><i></i></span>';
  }

  let toastTimer = 0;
  function toast(text, type) {
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 1900);
  }

  return {
    $: $, el: el, esc: esc, fmt: fmt, time: time,
    elementStrip: elementStrip, elementTags: elementTags,
    toast: toast, chipTile: chipTile
  };
})();
