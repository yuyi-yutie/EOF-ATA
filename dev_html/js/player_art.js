'use strict';

/* ============================================================
   玩家角色
   - 移动时：该角色的行走帧表（单朝向，行优先）
   - 站立时：该角色的站立图（不移动时直接用这张）
   - 武器绕胸口握把位置旋转，压在人物前面
   - 坐标：原点在脚底，y 轴向上为负
   ============================================================ */
const PlayerArt = (() => {
  /* 站立图：按脚底对齐，宽度按原图比例 */
  function drawIdle(ctx, o, C) {
    const img = C.idleImg;
    const h = C.idle.drawH;
    const w = h * (img.naturalWidth / img.naturalHeight);

    ctx.save();
    ctx.translate(o.x, o.y + (o.bob || 0));
    if (o.flip < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  function draw(ctx, o) {
    const C = Sprites.char(o.character);
    if (!o.moving && C.idleReady) {
      drawIdle(ctx, o, C);
      return;
    }
    if (!C.walkReady) return;

    const W = C.walk;
    const s = W.drawH / W.cellH;
    const n = W.frames;
    let f = o.frame | 0;
    f = ((f % n) + n) % n;

    ctx.save();
    ctx.translate(o.x, o.y + (o.bob || 0));
    if (o.flip < 0) ctx.scale(-1, 1);
    ctx.drawImage(
      C.walkImg,
      (f % W.cols) * W.cellW, ((f / W.cols) | 0) * W.cellH, W.cellW, W.cellH,
      -W.ax * s, -W.ay * s, W.cellW * s, W.cellH * s
    );
    ctx.restore();
  }

  /* 武器挂点（世界坐标）：胸口稍前，枪托会藏到方头后面 */
  function pivot(o) {
    const a = o.aim || 0;
    return {
      x: o.x + Math.cos(a) * 5.0,
      y: o.y + (o.bob || 0) - 17.0 + Math.sin(a) * 5.0
    };
  }

  /* 行走循环：走路 14 帧/秒，奔跑 19 帧/秒 */
  function advance(p, dt) {
    const W = Sprites.char(p.character).walk;
    if (!p.moving) {
      p.animT = 0;
      p.animFrame = W.idleFrame;
      return;
    }
    p.animT += dt * (p.sprinting ? 19 : 14);
    p.animFrame = (p.animT | 0) % W.frames;
  }

  return { draw, pivot, advance };
})();
