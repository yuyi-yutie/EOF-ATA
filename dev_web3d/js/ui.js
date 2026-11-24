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

  let toastTimer = 0;
  function toast(text, type) {
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 1900);
  }

  return { $: $, el: el, esc: esc, fmt: fmt, time: time, toast: toast };
})();
