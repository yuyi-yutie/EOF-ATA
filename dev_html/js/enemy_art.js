'use strict';

/* ============================================================
   敌人动画
   - walk：巡逻 / 一般移动
   - run ：已激活追击（仅近战僵尸有）
   - 走/跑按实际位移推进（stride = 一圈前进的像素），攻击按时长推进
   - attack：整套动作期间不移动，帧率与出伤帧由 CFG.ENEMY 配置
   素材单朝向（朝右），面向左时水平镜像；原点在脚底
   ============================================================ */
const EnemyArt = (() => {
  function state(e) {
    const A = Sprites.enemy(e.type);
    if (!A) return null;
    let anim = e.atk ? 'attack' : (e.anim || 'walk');
    if (!A.anims[anim]) anim = 'walk';
    const d = A.anims[anim];

    let f;
    if (anim === 'attack') {
      /* 攻击按时间播，播完停在最后一帧 */
      f = Math.floor((e.animT || 0) * CFG.ENEMY[e.type].atkFps);
      if (f < 0) f = 0;
      if (f >= d.frames) f = d.frames - 1;
    } else {
      /* 走/跑按走过的距离推进（e.animPhase 是一圈 0..1），循环播放 */
      f = Math.floor((e.animPhase || 0) * d.frames) % d.frames;
      if (f < 0) f += d.frames;
    }
    return { A, d, f };
  }

  function blit(ctx, A, d, f, s) {
    ctx.drawImage(
      d.img,
      (f % d.cols) * A.cellW, ((f / d.cols) | 0) * A.cellH, A.cellW, A.cellH,
      -A.ax * s, -A.ay * s, A.cellW * s, A.cellH * s
    );
  }

  function draw(ctx, e, flash) {
    const st = state(e);
    if (!st || !st.d.ready) return;
    const A = st.A;
    const s = A.drawH / A.cellH;

    ctx.save();
    ctx.translate(e.x, e.y);
    if (Math.cos(e.face) < 0) ctx.scale(-1, 1);
    blit(ctx, A, st.d, st.f, s);

    /* 受击闪白：同一张图叠加一次，用 lighter 提亮 */
    if (flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.75, flash);
      blit(ctx, A, st.d, st.f, s);
    }
    ctx.restore();
  }

  return { draw };
})();
