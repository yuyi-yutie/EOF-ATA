'use strict';

/* ============================================================
   开始菜单
   - 每次正常加载先显示独立黑屏标题页，点击 / Enter / Space 后淡出
   - ?skiptitle=1 可强制跳过；截图、自测等调试入口默认跳过
   ============================================================ */

const StartMenu = (function () {
  let root = null;
  let buttons = [];
  let button = null;
  let buildEl = null;
  let open = false;
  let closing = false;
  let focusIndex = 0;
  let onChoose = null;

  function init() {
    root = document.getElementById('startMenu');
    button = document.getElementById('startGameBtn');
    buildEl = document.getElementById('startBuild');
    if (!root) return;

    if (buildEl) buildEl.textContent = window.__build || 'dev';

    root.addEventListener('click', function () {
      start('hall');
    });
    buttons = Array.prototype.slice.call(root.querySelectorAll('[data-start-choice]'));
    button = buttons[0] || null;
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        e.stopPropagation();
        start(this.getAttribute('data-start-choice') || 'game');
      });
      buttons[i].addEventListener('focus', function () {
        focusIndex = buttons.indexOf(this);
      });
    }
    window.addEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!open || closing) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const active = document.activeElement;
      const choice = (active && root.contains(active) && active.getAttribute)
        ? active.getAttribute('data-start-choice') : null;
      start(choice || 'hall');
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!buttons.length) return;
      const dir = e.shiftKey ? -1 : 1;
      focusIndex = (focusIndex + dir + buttons.length) % buttons.length;
      try { buttons[focusIndex].focus(); } catch (err) { /* ignore */ }
    }
  }

  /* 调试入口不需要每次都停在标题页；?title=1 可强制显示 */
  function shouldSkip() {
    if (typeof QS === 'undefined') return false;
    if (QS.get('title') === '1') return false;
    return QS.get('skiptitle') === '1' ||
      QS.get('go') !== null ||
      QS.get('selftest') === '1' ||
      QS.get('auto') === '1' ||
      QS.get('demo') === '1';
  }

  function show(force) {
    if (!root) return;
    if (!force && shouldSkip()) {
      root.classList.add('hidden');
      return;
    }

    open = true;
    closing = false;
    focusIndex = 0;
    document.body.classList.add('menu-open');
    /* 直接以不透明黑屏出现，避免淡入时透出机库 */
    root.classList.remove('hidden', 'closing');

    window.setTimeout(function () {
      if (open && button) {
        try { button.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    }, 40);
  }

  function start(choice) {
    if (!open || closing) return;
    choice = choice || 'hall';
    open = false;
    closing = true;
    root.classList.add('closing');
    document.body.classList.remove('menu-open');
    if (document.activeElement && root.contains(document.activeElement) &&
        document.activeElement.blur) document.activeElement.blur();

    if (onChoose) {
      try { onChoose(choice); } catch (err) { console.error(err); }
    }

    window.setTimeout(function () {
      root.classList.add('hidden');
      root.classList.remove('closing');
      closing = false;
      try {
        window.dispatchEvent(new CustomEvent('startmenu:closed'));
      } catch (err) { /* ignore */ }
    }, 560);
  }

  return {
    init: init,
    show: show,
    start: start,
    setOnChoose: function (fn) { onChoose = (typeof fn === 'function') ? fn : null; },
    get isOpen() { return open; }
  };
})();
