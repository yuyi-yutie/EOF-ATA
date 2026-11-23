'use strict';

/* ============================================================
   贴图资源（art_draft/ 素材处理后在 assets/）
   - 角色：每人一张站立图 + 一张行走帧表
   - 武器：五把共用一张侧视图
   几何数值由 _tools/build_sprite_assets.py 打印
   ============================================================ */
const Sprites = (() => {
  const CHARS = [
    {
      id: 'c1',
      name: '潜行者',
      role: '标准',
      idle: { src: 'assets/person.png', drawH: 53 },
      walk: {
        src: 'assets/player_walk.png',
        cols: 6, rows: 2, frames: 12,
        cellW: 112, cellH: 237, ax: 56.2, ay: 231.3,
        drawH: 55, idleFrame: 0
      }
    },
    {
      id: 'c2',
      name: '突击手',
      role: '突击',
      idle: { src: 'assets/person_2.png', drawH: 53 },
      walk: {
        src: 'assets/player_walk_2.png',
        cols: 6, rows: 2, frames: 12,
        cellW: 136, cellH: 227, ax: 68.2, ay: 221.8,
        drawH: 55, idleFrame: 0
      }
    }
  ];

  /* 武器：s 声学 / g 光学 / r 热学 / l 力学 / d 电学
     原图 s、r 枪口朝左，导出时已镜像成朝右；w = 绘制长度(px)，
     gx/gy = 握把在图内的比例位置（旋转锚点） */
  const GUNS = [
    { src: 'assets/w0.png', w: 40, gx: 0.344, gy: 0.586 },
    { src: 'assets/w1.png', w: 40, gx: 0.283, gy: 0.504 },
    { src: 'assets/w2.png', w: 40, gx: 0.323, gy: 0.561 },
    { src: 'assets/w3.png', w: 40, gx: 0.289, gy: 0.431 },
    { src: 'assets/w4.png', w: 40, gx: 0.332, gy: 0.517 }
  ];

  const chars = CHARS.map(function (c) {
    const o = Object.assign({}, c);
    o.idleImg = new Image();
    o.walkImg = new Image();
    o.idleReady = false;
    o.walkReady = false;
    return o;
  });

  /* 敌人：每个敌人若干动画，所有动画共用一个裁切框与锚点
     ax/ay = 锚点在图内的像素（缩放前的 cell 坐标系），drawH = 绘制高度 */
  const ENEMY_ART = {
    zombie: {
      name: '僵尸', drawH: 64,
      cellW: 168, cellH: 246, ax: 88.0, ay: 239.4,
      /* stride：走完一个完整循环前进的世界像素，用来让动画跟着实际位移走 */
      stride: { walk: 50, run: 50 },
      anims: {
        walk: { src: 'assets/zombie_walk.png', frames: 14, cols: 7 },
        run: { src: 'assets/zombie_run.png', frames: 10, cols: 5 },
        attack: { src: 'assets/zombie_attack.png', frames: 36, cols: 6 }
      }
    },
    zombie_y: {
      name: '喷吐僵尸', drawH: 64,
      cellW: 154, cellH: 246, ax: 75.6, ay: 239.4,
      stride: { walk: 58 },
      anims: {
        walk: { src: 'assets/zombie_y_walk.png', frames: 18, cols: 6 },
        attack: { src: 'assets/zombie_y_attack.png', frames: 12, cols: 6 }
      }
    }
  };
  const enemies = {};
  for (const key in ENEMY_ART) {
    const a = ENEMY_ART[key];
    enemies[key] = a;
    for (const anim in a.anims) {
      a.anims[anim].img = new Image();
      a.anims[anim].ready = false;
    }
  }

  const guns = GUNS.map(g => new Image());

  function load(img, src, onload) {
    img.onerror = () => { img.broken = true; };
    if (onload) img.onload = onload;
    img.src = src;
  }

  function init() {
    chars.forEach(c => {
      load(c.idleImg, c.idle.src, () => { c.idleReady = true; });
      load(c.walkImg, c.walk.src, () => { c.walkReady = true; });
    });
    GUNS.forEach((g, i) => load(guns[i], g.src, null));
    for (const key in enemies) {
      const a = enemies[key];
      for (const anim in a.anims) {
        const d = a.anims[anim];
        load(d.img, d.src, () => { d.ready = true; });
      }
    }
  }

  function ready(img) {
    return !!img && !img.broken && img.complete && img.naturalWidth > 0;
  }

  function char(i) {
    const n = chars.length;
    return chars[((i | 0) % n + n) % n];
  }

  function enemy(key) {
    return enemies[key] || null;
  }

  return {
    init,
    ready,
    char,
    chars,
    enemy,
    enemies,
    GUNS,
    guns,
    gunReady: i => ready(guns[i])
  };
})();
