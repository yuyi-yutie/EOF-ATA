'use strict';

/* ============================================================
   机库：大厅的 3D 背景场景
   - 只使用方块 / 平面，和任务场景共用同一套渲染器
   - 中间是出击平台，玩家模型站在平台上做待机动作
   - 局外 UI 覆盖在画面上，机库只负责氛围
   ============================================================ */

const Hangar = (function () {
  const RAD = 3.6;          // 中央平台半径
  const ROOM_X = 13;        // 半宽
  const ROOM_Z = 13;        // 半深
  const WALL_H = 4.4;

  function buildStatic(geo) {
    const P = PAL;
    const CE = CFG.CELL;

    /* 1. 勾缝底 + 地砖 */
    geo.plane({
      x: 0, y: 0, z: 0,
      sx: ROOM_X * 2 + 4, sz: ROOM_Z * 2 + 4,
      color: [0.16, 0.15, 0.14]
    });

    for (let cz = -ROOM_Z; cz < ROOM_Z; cz += CE) {
      for (let cx = -ROOM_X; cx < ROOM_X; cx += CE) {
        const h = ((Math.round(cx) * 73856093) ^ (Math.round(cz) * 19349663)) >>> 0;
        const v = 0.90 + ((h % 100) / 100) * 0.14;
        geo.plane({
          x: cx + CE / 2, y: 0.02, z: cz + CE / 2,
          sx: CE - 0.07, sz: CE - 0.07,
          color: [P.floor[0] * v * 0.86, P.floor[1] * v * 0.86, P.floor[2] * v * 0.86]
        });
      }
    }

    /* 2. 四面墙（留出顶部，相机在高处俯视） */
    function wall(x, z, sx, sz) {
      geo.box({
        x: x, y: WALL_H / 2, z: z, sx: sx, sy: WALL_H, sz: sz,
        color: P.wall, outline: 0.02, shadow: true
      });
    }
    wall(0, -ROOM_Z - 0.5, ROOM_X * 2 + 2, 1);
    wall(0, ROOM_Z + 0.5, ROOM_X * 2 + 2, 1);
    wall(-ROOM_X - 0.5, 0, 1, ROOM_Z * 2 + 2);
    wall(ROOM_X + 0.5, 0, 1, ROOM_Z * 2 + 2);

    /* 墙脚暗色踢脚线 */
    const skirt = [0.17, 0.17, 0.18];
    geo.box({ x: 0, y: 0.13, z: -ROOM_Z + 0.01, sx: ROOM_X * 2, sy: 0.26, sz: 0.10, color: skirt, outline: 0 });
    geo.box({ x: 0, y: 0.13, z: ROOM_Z - 0.01, sx: ROOM_X * 2, sy: 0.26, sz: 0.10, color: skirt, outline: 0 });
    geo.box({ x: -ROOM_X + 0.01, y: 0.13, z: 0, sx: 0.10, sy: 0.26, sz: ROOM_Z * 2, color: skirt, outline: 0 });
    geo.box({ x: ROOM_X - 0.01, y: 0.13, z: 0, sx: 0.10, sy: 0.26, sz: ROOM_Z * 2, color: skirt, outline: 0 });

    /* 3. 后墙：卷帘门 + 数据屏 + 灯带 */
    geo.box({ x: 0, y: 1.75, z: -ROOM_Z + 0.06, sx: 7.4, sy: 3.5, sz: 0.14, color: [0.20, 0.21, 0.23], outline: 0.02 });
    for (let i = 0; i < 9; i++) {
      geo.box({
        x: 0, y: 0.12 + i * 0.38, z: -ROOM_Z + 0.15,
        sx: 7.1, sy: 0.22, sz: 0.03,
        color: [0.28, 0.29, 0.31], outline: 0
      });
    }
    geo.box({ x: 0, y: 3.58, z: -ROOM_Z + 0.12, sx: 7.6, sy: 0.12, sz: 0.10, color: P.amber, outline: 0, emis: true });

    /* 数据屏：后墙两侧的长条灯 + 跳动方块 */
    for (let s = -1; s <= 1; s += 2) {
      const bx = s * 9.4;
      geo.box({ x: bx, y: 2.1, z: -ROOM_Z + 0.10, sx: 3.6, sy: 1.5, sz: 0.10, color: [0.10, 0.12, 0.14], outline: 0.02 });
      geo.box({ x: bx, y: 2.72, z: -ROOM_Z + 0.17, sx: 3.2, sy: 0.05, sz: 0.02, color: P.visor, outline: 0, emis: true });
      for (let i = 0; i < 6; i++) {
        geo.box({
          x: bx - 1.35 + i * 0.54, y: 2.0 + Math.sin(i * 1.7) * 0.28, z: -ROOM_Z + 0.17,
          sx: 0.16, sy: 0.5 + Math.cos(i * 2.1) * 0.3, sz: 0.02,
          color: [0.35, 0.72, 0.78], outline: 0, emis: true
        });
      }
    }

    /* 4. 侧面：储物架 + 补给箱 */
    for (let s = -1; s <= 1; s += 2) {
      const sx = s * 10.4;
      geo.box({ x: sx, y: 1.5, z: 4.4, sx: 2.4, sy: 3.0, sz: 1.0, color: [0.24, 0.26, 0.28], outline: 0.02, shadow: true });
      for (let lv = 0; lv < 3; lv++) {
        geo.box({
          x: sx, y: 0.55 + lv * 0.95, z: 4.4,
          sx: 2.2, sy: 0.10, sz: 1.05,
          color: [0.36, 0.37, 0.39], outline: 0.01
        });
        for (let k = -1; k <= 1; k++) {
          geo.box({
            x: sx + k * 0.66, y: 0.82 + lv * 0.95, z: 4.4,
            sx: 0.5, sy: 0.44, sz: 0.7,
            color: k === 0 ? PAL.teal : PAL.wood, outline: 0.014, shadow: true
          });
        }
      }
    }

    /* 5. 中央出击平台 */
    geo.arc(0, 0, 0, RAD, 0, Math.PI * 2, 0.05, [0.25, 0.24, 0.22], 40);
    geo.arc(0, 0, RAD - 0.22, RAD, 0, Math.PI * 2, 0.06, [0.20, 0.21, 0.23], 40);
    geo.arc(0, 0, RAD - 0.36, RAD - 0.22, 0, Math.PI * 2, 0.065, P.amber, 40);

    /* 平台上的危险条纹 */
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      geo.box({
        x: Math.cos(a) * (RAD - 1.05), y: 0.075, z: Math.sin(a) * (RAD - 1.05),
        sx: 0.62, sy: 0.02, sz: 0.22, yaw: -a + Math.PI / 2,
        color: i % 2 ? [0.80, 0.56, 0.20] : [0.16, 0.15, 0.14], outline: 0, emis: i % 2 === 1
      });
    }

    /* 6. 两根平台立柱（只放在背侧，避免挡住镜头和 UI） */
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * (1.32 + i * 0.36);
      const px = Math.cos(a) * (RAD + 0.9);
      const pz = Math.sin(a) * (RAD + 0.9);
      geo.box({ x: px, y: 0.9, z: pz, sx: 0.20, sy: 1.8, sz: 0.20, color: PAL.steel, outline: 0.018, shadow: true });
      geo.box({ x: px, y: 1.84, z: pz, sx: 0.30, sy: 0.10, sz: 0.30, color: PAL.amber, outline: 0, emis: true });
      geo.box({ x: px, y: 0.08, z: pz, sx: 0.44, sy: 0.16, sz: 0.44, color: [0.22, 0.22, 0.24], outline: 0.012 });
    }
    /* 两侧落地灯柱 */
    for (let s = -1; s <= 1; s += 2) {
      geo.box({ x: s * 8.6, y: 1.6, z: -4.2, sx: 0.16, sy: 3.2, sz: 0.16, color: PAL.steel, outline: 0.014, shadow: true });
      geo.box({ x: s * 8.6, y: 3.18, z: -4.2, sx: 0.42, sy: 0.10, sz: 0.42, color: PAL.amber, outline: 0, emis: true });
    }

    /* 7. 前方控制台（背对玩家 / 面向镜头） */
    geo.box({ x: 0, y: 0.55, z: -4.55, sx: 2.6, sy: 1.0, sz: 0.7, color: [0.26, 0.27, 0.29], outline: 0.02, shadow: true });
    geo.box({ x: 0, y: 1.08, z: -4.62, sx: 2.4, sy: 0.08, sz: 0.62, color: [0.10, 0.12, 0.14], outline: 0.016 });
    geo.box({ x: 0, y: 1.10, z: -4.70, sx: 2.1, sy: 0.03, sz: 0.42, color: PAL.visor, outline: 0, emis: true });
    geo.box({ x: -1.05, y: 0.72, z: -4.90, sx: 0.34, sy: 0.5, sz: 0.1, color: PAL.amber, outline: 0, emis: true });
    geo.box({ x: 1.05, y: 0.72, z: -4.90, sx: 0.34, sy: 0.5, sz: 0.1, color: PAL.amber, outline: 0, emis: true });

    /* 8. 地面货箱与零件 */
    const crates = [
      { x: -7.2, z: -1.4, s: 1.3, c: PAL.wood, r: 0.3 },
      { x: -6.0, z: 0.6, s: 1.0, c: PAL.woodD, r: -0.2 },
      { x: 7.4, z: 0.2, s: 1.5, c: PAL.teal, r: 0.15 },
      { x: 6.3, z: 2.0, s: 1.1, c: PAL.wood, r: -0.4 },
      { x: -9.0, z: 6.0, s: 1.2, c: PAL.teal, r: 0.5 },
      { x: 8.8, z: -4.6, s: 1.4, c: PAL.woodD, r: 0.2 }
    ];
    for (let i = 0; i < crates.length; i++) {
      const c = crates[i];
      geo.box({ x: c.x, y: c.s * 0.5, z: c.z, sx: c.s, sy: c.s, sz: c.s, yaw: c.r, color: c.c, outline: 0.02, shadow: true });
      geo.box({ x: c.x, y: c.s * 0.86, z: c.z, sx: c.s * 0.94, sy: 0.09, sz: c.s * 0.94, yaw: c.r, color: PAL.steel, outline: 0.012 });
      geo.box({ x: c.x, y: c.s * 0.5, z: c.z, sx: c.s * 0.3, sy: c.s * 0.32, sz: c.s * 1.01, yaw: c.r, color: [0.18, 0.19, 0.20], outline: 0 });
    }

    /* 9. 顶部灯梁（高于相机时不影响视线） */
    for (let i = -1; i <= 1; i++) {
      geo.box({ x: 0, y: 4.05, z: i * 6.4, sx: 10.5, sy: 0.16, sz: 0.16, color: [0.30, 0.31, 0.33], outline: 0.012 });
      for (let k = -4; k <= 4; k++) {
        geo.box({ x: k * 1.15, y: 4.02, z: i * 6.4, sx: 0.7, sy: 0.05, sz: 0.1, color: [0.98, 0.82, 0.52], outline: 0, emis: true });
      }
    }

    /* 10. 地面标线 */
    for (let i = -2; i <= 2; i++) {
      geo.box({
        x: i * 4.2, y: 0.035, z: -7.6,
        sx: 0.16, sy: 0.01, sz: 4.2,
        color: [0.55, 0.47, 0.30], outline: 0
      });
    }
  }

  /* 动态部分：悬浮环 / 轨道方块 / 呼吸灯 */
  function drawDynamic(geo, t) {
    const amber = [0.94, 0.69, 0.30];
    const ice = [0.53, 0.91, 0.95];

    /* 旋转全息环 */
    const rot = t * 0.35;
    for (let i = 0; i < 3; i++) {
      const a0 = rot + i * Math.PI * 2 / 3;
      const a1 = a0 + 0.75;
      geo.arc(0, 0, 2.55 + i * 0.16, 2.62 + i * 0.16, a0, a1, 0.10 + i * 0.02,
        i === 1 ? ice : amber, 10);
    }

    /* 平台边缘的悬浮方块 */
    for (let i = 0; i < 6; i++) {
      const a = t * 0.22 + i * Math.PI / 3;
      const r = 2.95;
      const y = 0.55 + Math.sin(t * 1.1 + i * 1.3) * 0.22;
      geo.box({
        x: Math.cos(a) * r, y: y, z: Math.sin(a) * r,
        sx: 0.16, sy: 0.16, sz: 0.16, yaw: a + t,
        color: i % 2 ? ice : amber, outline: 0, emis: true
      });
    }

    /* 立柱灯珠脉冲 */
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * (1.32 + i * 0.36);
      const k = 0.5 + Math.sin(t * 2.4 + i * 1.6) * 0.5;
      geo.box({
        x: Math.cos(a) * (RAD + 0.9), y: 1.84, z: Math.sin(a) * (RAD + 0.9),
        sx: 0.10 + k * 0.10, sy: 0.10 + k * 0.10, sz: 0.10 + k * 0.10,
        color: amber, outline: 0, emis: true
      });
    }

    /* 控制台上的扫描线 */
    const scan = (t * 0.9) % 1;
    geo.box({
      x: -1.05 + scan * 2.1, y: 1.13, z: -4.70,
      sx: 0.06, sy: 0.01, sz: 0.40,
      color: [0.85, 0.98, 1.0], outline: 0, emis: true
    });
  }

  /* 大厅相机：绕平台缓慢环绕 */
  function camera(t) {
    const a = 0.62 + t * 0.055;
    const pitch = 24 * Math.PI / 180;
    const r = 6.8;
    const focus = [0, 0.98, 0];
    const eye = [
      focus[0] + Math.sin(a) * Math.cos(pitch) * r,
      focus[1] + Math.sin(pitch) * r,
      focus[2] + Math.cos(a) * Math.cos(pitch) * r
    ];
    return { eye: eye, focus: focus, fov: 40 };
  }

  return {
    buildStatic: buildStatic,
    drawDynamic: drawDynamic,
    camera: camera,
    RAD: RAD
  };
})();
