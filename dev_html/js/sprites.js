'use strict';

/* ============================================================
   贴图资源（Blender 渲染）：人物 + 武器俯视 / 侧视
   ============================================================ */
const Sprites = (() => {
  const player = new Image();
  const top = [];
  const side = [];
  let loaded = 0;
  let total = 11;

  function init() {
    const track = img => {
      img.onload = () => { loaded++; };
      img.onerror = () => { img.broken = true; };
    };
    track(player);
    player.src = 'assets/player.png';
    for (let i = 0; i < 5; i++) {
      const a = new Image();
      const b = new Image();
      track(a);
      track(b);
      a.src = 'assets/w' + i + '_top.png';
      b.src = 'assets/w' + i + '_side.png';
      top.push(a);
      side.push(b);
    }
  }

  function ready(img) {
    return !!img && !img.broken && img.complete && img.naturalWidth > 0;
  }

  return {
    init,
    player,
    top,
    side,
    ready,
    playerReady: () => ready(player),
    topReady: i => ready(top[i]),
    sideReady: i => ready(side[i])
  };
})();
