'use strict';

/* ============================================================
   手机全屏 / 添加到主屏幕
   - Android Chrome：requestFullscreen + 横屏锁定，去掉地址栏
   - iOS Safari：不支持网页全屏，提示“分享 → 添加到主屏幕”
   - standalone / fullscreen 模式下自动隐藏全屏按钮
   ============================================================ */

const MOBILE = (function () {
  const IS_TOUCH = !!window.__touchMode;
  const UA = navigator.userAgent || '';
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = (window.matchMedia &&
      (window.matchMedia('(display-mode: standalone)').matches ||
       window.matchMedia('(display-mode: fullscreen)').matches)) ||
    window.navigator.standalone === true;

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function supported() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  function request() {
    const el = document.documentElement;
    try {
      let p;
      if (el.requestFullscreen) p = el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
      else return Promise.resolve(false);
      if (p && p.then) return p.then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function exit() {
    try {
      const p = document.exitFullscreen ? document.exitFullscreen() :
        (document.webkitExitFullscreen ? document.webkitExitFullscreen() : null);
      if (p && p.then) return p.then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(!!p);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function lockLandscape() {
    if (!(screen.orientation && screen.orientation.lock)) return Promise.resolve(false);
    try {
      const p = screen.orientation.lock('landscape');
      if (p && p.then) return p.then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* 出击 / 旋转按钮用：进全屏后尝试锁横屏 */
  function enterGame() {
    if (!IS_TOUCH) return Promise.resolve(false);
    if (IS_STANDALONE) {
      lockLandscape();
      return Promise.resolve(true);
    }
    if (fsElement()) {
      lockLandscape();
      return Promise.resolve(true);
    }
    if (!supported()) {
      try {
        if (!sessionStorage.getItem('eofata.fsHint')) {
          sessionStorage.setItem('eofata.fsHint', '1');
          window.setTimeout(function () {
            UI.toast(IS_IOS
              ? 'iPhone 全屏：Safari 分享 → 添加到主屏幕'
              : '当前浏览器不支持网页全屏，请用 Chrome / Edge', 'warn');
          }, 600);
        }
      } catch (e) { /* ignore */ }
      return Promise.resolve(false);
    }
    return request().then(function (ok) {
      if (ok) lockLandscape();
      return ok;
    });
  }

  function toggle() {
    if (IS_STANDALONE) return Promise.resolve(true);
    if (fsElement()) return exit();
    return request().then(function (ok) {
      if (ok) lockLandscape();
      return ok;
    });
  }

  function showHelp() {
    const modal = document.getElementById('fsHelp');
    const text = document.getElementById('fsHelpText');
    if (!modal) {
      UI.toast(IS_IOS ? 'Safari 分享 → 添加到主屏幕' : '当前浏览器不支持网页全屏', 'warn');
      return;
    }
    if (text) {
      text.innerHTML = IS_IOS
        ? 'Safari 不支持网页全屏。<br>点底部分享按钮 <b>↑</b> → <b>添加到主屏幕</b>，再从主屏幕启动 EOFATA，浏览器页眉就不会再挤占画面。'
        : '当前浏览器没有开放网页全屏。<br>请使用 Chrome / Edge，或把页面添加到主屏幕后启动。';
    }
    modal.classList.remove('hidden');
  }

  function init() {
    if (!IS_TOUCH) return;
    if (IS_STANDALONE) document.documentElement.classList.add('standalone');

    const buttons = document.querySelectorAll('[data-fullscreen]');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        if (IS_STANDALONE) {
          UI.toast('当前已经是全屏启动模式');
          return;
        }
        if (!supported()) {
          showHelp();
          return;
        }
        toggle().then(function (ok) {
          if (!ok) showHelp();
        });
      });
    }

    const close = document.getElementById('fsHelpClose');
    if (close) {
      close.addEventListener('click', function () {
        const modal = document.getElementById('fsHelp');
        if (modal) modal.classList.add('hidden');
      });
    }
    const modal = document.getElementById('fsHelp');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }

    /* 只有 HTTPS / localhost 才能注册 Service Worker；局域网 HTTP 会静默跳过 */
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* ignore */ });
    }
  }

  return {
    init: init,
    enterGame: enterGame,
    toggle: toggle,
    lockLandscape: lockLandscape,
    supported: supported,
    showHelp: showHelp,
    get isTouch() { return IS_TOUCH; },
    get isIOS() { return IS_IOS; },
    get isStandalone() { return IS_STANDALONE; },
    get isFullscreen() { return !!fsElement(); }
  };
})();
