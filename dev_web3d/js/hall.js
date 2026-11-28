'use strict';

/* ============================================================
   实体大厅
   - 一间封闭的方形房间，中央留空的圆形区域
   - 六个独立建模的设备环绕中央区域
   - 目前只提供靠近高亮与 F 互动占位反馈
   ============================================================ */

const Hall = (function () {
  const HALF = 10;              // 房间半宽 / 半深
  const WALL_T = 0.6;
  const WALL_H = 3.2;
  const INNER = HALF - WALL_T * 0.5;
  const CENTER_R = 3.2;
  const DEVICE_R = 6.2;
  const SPAWN = { x: -2.6, z: 5.2, yaw: Math.atan2(2.6, -5.2) };


  const C = {
    floor: [0.19, 0.20, 0.21],
    floor2: [0.16, 0.17, 0.18],
    wall: [0.24, 0.25, 0.27],
    wallDark: [0.14, 0.15, 0.16],
    panel: [0.20, 0.22, 0.24],
    steel: [0.37, 0.39, 0.41],
    steelDark: [0.20, 0.22, 0.24],
    dark: [0.095, 0.105, 0.115],
    ink: [0.055, 0.06, 0.065],
    amber: [0.94, 0.69, 0.30],
    amberDim: [0.48, 0.35, 0.16],
    ice: [0.42, 0.84, 0.94],
    iceDim: [0.20, 0.42, 0.48],
    green: [0.48, 0.90, 0.52],
    red: [0.88, 0.31, 0.25],
    wood: [0.42, 0.32, 0.20],
    gun: [0.58, 0.61, 0.64]
  };

  let deviceList = [];
  let colliders = [];

  /* ---------- 局部坐标工具 ---------- */
  function localToWorld(d, lx, lz) {
    const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
    return { x: d.x + c * lx + s * lz, z: d.z - s * lx + c * lz };
  }

  function add(geo, d, lx, ly, lz, sx, sy, sz, color, opt) {
    opt = opt || {};
    const p = localToWorld(d, lx, lz);
    geo.box({
      x: p.x, y: ly, z: p.z,
      sx: sx, sy: sy, sz: sz,
      yaw: d.yaw + (opt.yaw || 0),
      rotX: opt.rotX || 0,
      color: color,
      outline: opt.outline === undefined ? 0.018 : opt.outline,
      emis: !!opt.emis,
      shadow: opt.shadow !== false
    });
  }

  function statusLight(geo, d, y, color, k) {
    const s = 0.12 + k * 0.06;
    add(geo, d, 0, y, 0.30, s, s * 0.6, s, color, { outline: 0, emis: true, shadow: false });
  }

  /* ---------- 房间 ---------- */
  function buildRoom(geo) {
    geo.plane({ x: 0, y: -0.02, z: 0, sx: HALF * 2 + 3, sz: HALF * 2 + 3, color: [0.075, 0.08, 0.085] });

    /* 垫一层完整地板底色，确保砖缝 / 墙边不会露出外侧底板 */
    geo.plane({
      x: 0, y: 0.004, z: 0,
      sx: HALF * 2 - 0.05, sz: HALF * 2 - 0.05,
      color: [0.165, 0.175, 0.185]
    });

    const step = 2;
    for (let x = -HALF; x < HALF; x += step) {
      for (let z = -HALF; z < HALF; z += step) {
        const h = ((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663)) >>> 0;
        const v = 0.90 + ((h % 100) / 100) * 0.16;
        geo.plane({
          x: x + step * 0.5, y: 0.01, z: z + step * 0.5,
          sx: step - 0.06, sz: step - 0.06,
          color: [C.floor[0] * v, C.floor[1] * v, C.floor[2] * v]
        });
      }
    }

    /* 房间四周踢脚 / 地面警戒线 */
    const line = [0.54, 0.42, 0.20];
    geo.box({ x: 0, y: 0.035, z: -INNER + 0.16, sx: HALF * 2 - 0.4, sy: 0.02, sz: 0.12, color: line, outline: 0, emis: true });
    geo.box({ x: 0, y: 0.035, z: INNER - 0.16, sx: HALF * 2 - 0.4, sy: 0.02, sz: 0.12, color: line, outline: 0, emis: true });
    geo.box({ x: -INNER + 0.16, y: 0.035, z: 0, sx: 0.12, sy: 0.02, sz: HALF * 2 - 0.4, color: line, outline: 0, emis: true });
    geo.box({ x: INNER - 0.16, y: 0.035, z: 0, sx: 0.12, sy: 0.02, sz: HALF * 2 - 0.4, color: line, outline: 0, emis: true });

    /* 中央圆形区域：只做地面环，不放任何物体 */
    geo.arc(0, 0, 0, CENTER_R, 0, Math.PI * 2, 0.045, [0.145, 0.16, 0.17], 52);
    geo.arc(0, 0, CENTER_R - 0.16, CENTER_R, 0, Math.PI * 2, 0.052, [0.55, 0.40, 0.19], 52);
    geo.arc(0, 0, CENTER_R - 0.24, CENTER_R - 0.16, 0, Math.PI * 2, 0.054, [0.08, 0.09, 0.10], 52);
    geo.arc(0, 0, 1.16, 1.21, 0, Math.PI * 2, 0.052, [0.28, 0.23, 0.14], 40);

    /* 圆形区域外的四条导向线 */
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5 + Math.PI * 0.25;
      geo.box({
        x: Math.cos(a) * (CENTER_R + 0.9), y: 0.04, z: Math.sin(a) * (CENTER_R + 0.9),
        sx: 0.10, sy: 0.015, sz: 1.2, yaw: -a + Math.PI * 0.5,
        color: [0.30, 0.27, 0.20], outline: 0, emis: true
      });
    }

    /* 四面墙 */
    /* 墙体投影由后处理乘暗地面纹理，不会再形成纯色“没铺满”的深色带 */
    geo.box({ x: 0, y: WALL_H * 0.5, z: -HALF, sx: HALF * 2 + WALL_T, sy: WALL_H, sz: WALL_T, color: C.wall, outline: 0.024, shadow: true });
    geo.box({ x: 0, y: WALL_H * 0.5, z: HALF, sx: HALF * 2 + WALL_T, sy: WALL_H, sz: WALL_T, color: C.wall, outline: 0.024, shadow: true });
    geo.box({ x: -HALF, y: WALL_H * 0.5, z: 0, sx: WALL_T, sy: WALL_H, sz: HALF * 2 + WALL_T, color: C.wall, outline: 0.024, shadow: true });
    geo.box({ x: HALF, y: WALL_H * 0.5, z: 0, sx: WALL_T, sy: WALL_H, sz: HALF * 2 + WALL_T, color: C.wall, outline: 0.024, shadow: true });

    /* 墙面分块 + 灯带 */
    for (let i = -4; i <= 4; i++) {
      const ox = i * 2;
      const v = 0.92 + ((i + 4) % 2) * 0.08;
      const col = [C.panel[0] * v, C.panel[1] * v, C.panel[2] * v];
      geo.box({ x: ox, y: 1.34, z: -INNER + 0.05, sx: 1.82, sy: 2.35, sz: 0.10, color: col, outline: 0.012 });
      geo.box({ x: ox, y: 1.34, z: INNER - 0.05, sx: 1.82, sy: 2.35, sz: 0.10, color: col, outline: 0.012 });
      geo.box({ x: -INNER + 0.05, y: 1.34, z: ox, sx: 0.10, sy: 2.35, sz: 1.82, color: col, outline: 0.012 });
      geo.box({ x: INNER - 0.05, y: 1.34, z: ox, sx: 0.10, sy: 2.35, sz: 1.82, color: col, outline: 0.012 });
    }
    const stripY = 2.82;
    geo.box({ x: 0, y: stripY, z: -INNER + 0.12, sx: HALF * 2 - 0.7, sy: 0.055, sz: 0.05, color: C.amber, outline: 0, emis: true });
    geo.box({ x: 0, y: stripY, z: INNER - 0.12, sx: HALF * 2 - 0.7, sy: 0.055, sz: 0.05, color: C.amber, outline: 0, emis: true });
    geo.box({ x: -INNER + 0.12, y: stripY, z: 0, sx: 0.05, sy: 0.055, sz: HALF * 2 - 0.7, color: C.amber, outline: 0, emis: true });
    geo.box({ x: INNER - 0.12, y: stripY, z: 0, sx: 0.05, sy: 0.055, sz: HALF * 2 - 0.7, color: C.amber, outline: 0, emis: true });

    /* 角落立柱 */
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        geo.box({ x: sx * (HALF - 0.35), y: WALL_H * 0.5, z: sz * (HALF - 0.35), sx: 0.52, sy: WALL_H, sz: 0.52, color: C.steelDark, outline: 0.018, shadow: true });
        geo.box({ x: sx * (HALF - 0.35), y: 2.94, z: sz * (HALF - 0.35), sx: 0.62, sy: 0.14, sz: 0.62, color: C.amberDim, outline: 0.012 });
      }
    }

    /* 南墙封闭闸门（纯装饰，出口使用 ESC） */
    geo.box({ x: 0, y: 1.52, z: INNER - 0.10, sx: 5.2, sy: 2.95, sz: 0.22, color: C.steelDark, outline: 0.024, shadow: true });
    for (let i = 0; i < 7; i++) {
      geo.box({ x: 0, y: 0.28 + i * 0.40, z: INNER - 0.22, sx: 4.8, sy: 0.18, sz: 0.05, color: [0.26, 0.28, 0.30], outline: 0 });
    }
    geo.box({ x: -2.72, y: 1.52, z: INNER - 0.08, sx: 0.18, sy: 3.0, sz: 0.30, color: C.amberDim, outline: 0.012 });
    geo.box({ x: 2.72, y: 1.52, z: INNER - 0.08, sx: 0.18, sy: 3.0, sz: 0.30, color: C.amberDim, outline: 0.012 });
    geo.box({ x: 0, y: 3.02, z: INNER - 0.08, sx: 5.6, sy: 0.10, sz: 0.30, color: C.amber, outline: 0, emis: true });
    geo.box({ x: -1.0, y: 2.10, z: INNER - 0.24, sx: 0.52, sy: 0.10, sz: 0.04, color: C.red, outline: 0, emis: true });
    geo.box({ x: 1.0, y: 2.10, z: INNER - 0.24, sx: 0.52, sy: 0.10, sz: 0.04, color: C.green, outline: 0, emis: true });

    /* 左右墙的通风口 */
    for (let s = -1; s <= 1; s += 2) {
      for (let i = -1; i <= 1; i++) {
        geo.box({ x: s * (INNER - 0.14), y: 1.55 + i * 0.24, z: -3.1, sx: 0.06, sy: 0.10, sz: 1.1, color: C.ink, outline: 0.008 });
        geo.box({ x: s * (INNER - 0.14), y: 1.55 + i * 0.24, z: 3.1, sx: 0.06, sy: 0.10, sz: 1.1, color: C.ink, outline: 0.008 });
      }
    }

    /* 墙顶压边 */
    geo.box({ x: 0, y: WALL_H - 0.10, z: -HALF, sx: HALF * 2 + 0.9, sy: 0.16, sz: WALL_T + 0.18, color: C.steelDark, outline: 0.014 });
    geo.box({ x: 0, y: WALL_H - 0.10, z: HALF, sx: HALF * 2 + 0.9, sy: 0.16, sz: WALL_T + 0.18, color: C.steelDark, outline: 0.014 });
    geo.box({ x: -HALF, y: WALL_H - 0.10, z: 0, sx: WALL_T + 0.18, sy: 0.16, sz: HALF * 2 + 0.9, color: C.steelDark, outline: 0.014 });
    geo.box({ x: HALF, y: WALL_H - 0.10, z: 0, sx: WALL_T + 0.18, sy: 0.16, sz: HALF * 2 + 0.9, color: C.steelDark, outline: 0.014 });
  }

  /* ---------- 六个设备 ---------- */
  function buildArmory(geo, d) {
    add(geo, d, 0, 0.07, 0, 3.0, 0.14, 1.65, C.dark, { outline: 0.012 });
    add(geo, d, 0, 1.28, -0.48, 2.9, 2.28, 0.70, C.steelDark, { outline: 0.022 });
    add(geo, d, -1.36, 1.30, -0.05, 0.22, 2.5, 1.55, C.dark, { outline: 0.014 });
    add(geo, d, 1.36, 1.30, -0.05, 0.22, 2.5, 1.55, C.dark, { outline: 0.014 });
    add(geo, d, 0, 2.48, -0.18, 3.02, 0.18, 0.92, C.amberDim, { outline: 0.012 });
    add(geo, d, 0, 2.60, 0.10, 2.55, 0.05, 0.05, C.amber, { outline: 0, emis: true });

    for (let i = -1; i <= 1; i++) {
      const x = i * 0.92;
      add(geo, d, x, 1.24, 0.17, 0.82, 1.86, 0.10, C.dark, { outline: 0.014 });
      for (let k = 0; k < 3; k++) {
        add(geo, d, x, 0.58 + k * 0.47, 0.235, 0.56, 0.045, 0.025, C.amberDim, { outline: 0, emis: true });
      }
      add(geo, d, x + 0.28, 1.04, 0.245, 0.055, 0.28, 0.035, C.amber, { outline: 0, emis: true });
    }

    /* 柜顶两支武器剪影 */
    add(geo, d, -0.58, 2.06, 0.23, 1.05, 0.085, 0.13, C.gun, { outline: 0.010, yaw: 0.28 });
    add(geo, d, 0.58, 2.06, 0.23, 1.05, 0.085, 0.13, C.gun, { outline: 0.010, yaw: -0.28 });
    add(geo, d, -0.58, 2.13, 0.23, 0.28, 0.06, 0.09, C.iceDim, { outline: 0, emis: true, yaw: 0.28 });
    add(geo, d, 0.58, 2.13, 0.23, 0.28, 0.06, 0.09, C.amberDim, { outline: 0, emis: true, yaw: -0.28 });

    /* 两侧弹药箱 */
    add(geo, d, -1.44, 0.30, 0.62, 0.50, 0.46, 0.42, C.wood, { outline: 0.014 });
    add(geo, d, -1.44, 0.56, 0.62, 0.42, 0.04, 0.34, C.amber, { outline: 0, emis: true });
    add(geo, d, 1.44, 0.30, 0.62, 0.50, 0.46, 0.42, C.steel, { outline: 0.014 });
    add(geo, d, 1.44, 0.56, 0.62, 0.42, 0.04, 0.34, C.ice, { outline: 0, emis: true });
  }

  function buildPrinter(geo, d) {
    add(geo, d, 0, 0.09, 0, 2.45, 0.18, 1.95, C.dark, { outline: 0.012 });
    add(geo, d, 0, 1.27, -0.02, 1.92, 2.22, 1.45, C.steelDark, { outline: 0.024 });
    add(geo, d, 0, 2.42, -0.02, 1.70, 0.20, 1.18, C.steel, { outline: 0.016 });
    add(geo, d, 0, 1.30, 0.72, 1.42, 1.50, 0.06, [0.10, 0.18, 0.22], { outline: 0.012 });
    add(geo, d, -0.70, 1.30, 0.755, 0.06, 1.42, 0.03, C.iceDim, { outline: 0, emis: true });
    add(geo, d, 0.70, 1.30, 0.755, 0.06, 1.42, 0.03, C.iceDim, { outline: 0, emis: true });
    add(geo, d, 0, 0.70, 0.74, 1.24, 0.08, 0.05, C.iceDim, { outline: 0, emis: true });
    add(geo, d, 0, 0.80, 0.15, 1.26, 0.10, 0.92, C.dark, { outline: 0.010 });
    add(geo, d, 0, 1.83, 0.66, 1.34, 0.09, 0.08, C.steel, { outline: 0.010 });

    /* 打印头 / 龙门架 */
    add(geo, d, -0.58, 1.55, 0.55, 0.05, 0.75, 0.05, C.steel, { outline: 0 });
    add(geo, d, 0.58, 1.55, 0.55, 0.05, 0.75, 0.05, C.steel, { outline: 0 });
    add(geo, d, 0, 1.16, 0.55, 0.18, 0.30, 0.16, C.amberDim, { outline: 0.010 });

    /* 侧边料盘 */
    add(geo, d, 1.18, 1.60, 0.10, 0.24, 0.76, 0.76, C.iceDim, { outline: 0.014 });
    add(geo, d, 1.18, 1.60, 0.10, 0.30, 0.52, 0.52, C.ice, { outline: 0.010 });
    add(geo, d, 1.18, 1.60, 0.30, 0.16, 0.18, 0.03, C.ink, { outline: 0 });

    /* 顶部排气管 */
    add(geo, d, -0.62, 2.72, -0.18, 0.18, 0.48, 0.18, C.steel, { outline: 0.010 });
    add(geo, d, -0.62, 2.98, -0.18, 0.34, 0.08, 0.34, C.steelDark, { outline: 0.008 });
    add(geo, d, 0.62, 2.55, 0.50, 0.55, 0.20, 0.08, C.dark, { outline: 0.008 });
    add(geo, d, 0.62, 2.55, 0.55, 0.42, 0.05, 0.03, C.green, { outline: 0, emis: true });
  }

  function buildStorage(geo, d) {
    add(geo, d, 0, 0.07, 0, 3.1, 0.14, 1.75, C.dark, { outline: 0.012 });
    add(geo, d, 0, 1.32, -0.38, 3.0, 2.42, 0.62, C.steelDark, { outline: 0.022 });
    add(geo, d, -1.5, 1.30, -0.02, 0.20, 2.55, 1.55, C.dark, { outline: 0.014 });
    add(geo, d, 1.5, 1.30, -0.02, 0.20, 2.55, 1.55, C.dark, { outline: 0.014 });

    for (let i = 0; i < 3; i++) {
      add(geo, d, 0, 0.34 + i * 0.72, 0.03, 2.82, 0.09, 0.76, C.steel, { outline: 0.010 });
    }
    /* 每一层的货箱 */
    const boxes = [
      [-1.02, 0.62, 0.02, 0.62, 0.48, 0.56, C.wood],
      [-0.35, 0.60, 0.02, 0.54, 0.42, 0.50, C.iceDim],
      [0.35, 0.64, 0.02, 0.60, 0.50, 0.58, C.wood],
      [1.02, 0.62, 0.02, 0.56, 0.46, 0.52, C.steel],
      [-1.02, 1.34, 0.02, 0.58, 0.44, 0.52, C.steel],
      [-0.35, 1.30, 0.02, 0.62, 0.38, 0.56, C.wood],
      [0.38, 1.34, 0.02, 0.52, 0.44, 0.48, C.iceDim],
      [1.02, 1.30, 0.02, 0.60, 0.40, 0.54, C.wood],
      [-0.78, 2.02, 0.02, 0.88, 0.50, 0.64, C.wood],
      [0.42, 2.02, 0.02, 0.70, 0.48, 0.58, C.steel]
    ];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      add(geo, d, b[0], b[1], b[2], b[3], b[4], b[5], b[6], { outline: 0.012 });
      add(geo, d, b[0], b[1] + b[4] * 0.5 + 0.02, b[2], b[3] * 0.62, 0.035, b[5] * 0.62, C.amberDim, { outline: 0, emis: true });
    }
    /* 顶部投影底座 */
    add(geo, d, 0.92, 2.72, -0.16, 0.42, 0.12, 0.42, C.steel, { outline: 0.010 });
    add(geo, d, 0.92, 2.64, -0.16, 0.18, 0.06, 0.18, C.amber, { outline: 0, emis: true });
  }

  function buildFabricator(geo, d) {
    add(geo, d, 0, 0.08, 0, 3.0, 0.16, 1.8, C.dark, { outline: 0.012 });
    add(geo, d, 0, 0.98, 0, 2.82, 0.18, 1.42, C.steelDark, { outline: 0.018 });
    add(geo, d, -1.22, 0.50, 0.48, 0.18, 0.84, 0.18, C.steel, { outline: 0.012 });
    add(geo, d, 1.22, 0.50, 0.48, 0.18, 0.84, 0.18, C.steel, { outline: 0.012 });
    add(geo, d, -1.22, 0.50, -0.48, 0.18, 0.84, 0.18, C.steel, { outline: 0.012 });
    add(geo, d, 1.22, 0.50, -0.48, 0.18, 0.84, 0.18, C.steel, { outline: 0.012 });

    add(geo, d, 0, 1.72, -0.46, 2.64, 1.50, 0.12, C.steelDark, { outline: 0.018 });
    add(geo, d, 0, 1.78, -0.38, 1.55, 0.82, 0.05, [0.09, 0.13, 0.15], { outline: 0.010 });
    for (let i = 0; i < 4; i++) {
      add(geo, d, -0.60 + i * 0.40, 1.50 + (i % 2) * 0.18, -0.345, 0.30, 0.035, 0.02, C.iceDim, { outline: 0, emis: true });
    }
    add(geo, d, 0, 2.40, -0.42, 2.70, 0.12, 0.20, C.amberDim, { outline: 0.010 });
    add(geo, d, 0, 2.33, -0.34, 2.40, 0.04, 0.04, C.amber, { outline: 0, emis: true });

    /* 台钳 / 零件盘 */
    add(geo, d, 0.78, 1.16, 0.26, 0.52, 0.32, 0.42, C.steel, { outline: 0.012 });
    add(geo, d, 0.78, 1.34, 0.26, 0.22, 0.08, 0.28, C.amberDim, { outline: 0.008 });
    add(geo, d, -0.72, 1.12, 0.40, 0.62, 0.10, 0.48, C.dark, { outline: 0.010 });
    add(geo, d, -0.72, 1.20, 0.40, 0.20, 0.12, 0.22, C.iceDim, { outline: 0.008 });

    /* 背后管线 */
    for (let i = -1; i <= 1; i++) {
      add(geo, d, -0.95 + i * 0.18, 2.55, -0.55, 0.07, 0.70, 0.07, C.steel, { outline: 0 });
    }
    add(geo, d, -1.05, 2.82, -0.55, 0.34, 0.08, 0.10, C.steelDark, { outline: 0.008 });
  }

  function buildComms(geo, d) {
    add(geo, d, 0, 0.07, 0, 3.0, 0.14, 1.85, C.dark, { outline: 0.012 });
    add(geo, d, 0, 0.58, 0, 2.62, 1.08, 1.08, C.steelDark, { outline: 0.020 });
    add(geo, d, 0, 1.16, 0.28, 2.42, 0.14, 0.92, C.steel, { outline: 0.014 });
    add(geo, d, 0, 1.38, 0.50, 1.58, 0.06, 0.58, [0.09, 0.13, 0.16], { outline: 0.010, rotX: -0.35 });
    for (let i = 0; i < 5; i++) {
      add(geo, d, -0.48 + (i % 3) * 0.32, 1.43 + Math.floor(i / 3) * 0.11, 0.66, 0.20, 0.025, 0.02, C.ice, { outline: 0, emis: true });
    }
    add(geo, d, -0.72, 1.30, 0.82, 0.46, 0.055, 0.26, [0.08, 0.10, 0.11], { outline: 0.008 });
    for (let i = 0; i < 4; i++) {
      add(geo, d, -0.91 + i * 0.12, 1.33, 0.82, 0.07, 0.012, 0.18, C.steel, { outline: 0 });
    }

    /* 天线杆 */
    add(geo, d, 0.92, 1.72, -0.42, 0.14, 3.16, 0.14, C.steel, { outline: 0.012 });
    add(geo, d, 0.92, 0.48, -0.42, 0.34, 0.82, 0.34, C.dark, { outline: 0.010 });
    add(geo, d, 0.92, 2.30, -0.42, 0.90, 0.08, 0.08, C.steel, { outline: 0 });
    add(geo, d, 0.92, 2.88, -0.42, 0.08, 0.08, 0.08, C.ice, { outline: 0, emis: true });
    add(geo, d, 0.92, 3.22, -0.42, 0.06, 0.34, 0.06, C.steel, { outline: 0 });
    add(geo, d, 0.92, 3.42, -0.42, 0.10, 0.10, 0.10, C.red, { outline: 0, emis: true });

    /* 侧边设备柜 */
    add(geo, d, -1.18, 0.76, -0.30, 0.42, 1.48, 0.58, C.steelDark, { outline: 0.012 });
    add(geo, d, -1.18, 1.20, -0.005, 0.30, 0.38, 0.03, C.iceDim, { outline: 0, emis: true });
    add(geo, d, -1.18, 0.92, -0.005, 0.30, 0.10, 0.03, C.amberDim, { outline: 0, emis: true });
  }

  function buildTeleporter(geo, d) {
    geo.arc(d.x, d.z, 0, 1.62, 0, Math.PI * 2, 0.05, [0.115, 0.13, 0.14], 36);
    geo.arc(d.x, d.z, 1.40, 1.62, 0, Math.PI * 2, 0.06, C.iceDim, 36);
    geo.arc(d.x, d.z, 1.20, 1.30, 0, Math.PI * 2, 0.062, [0.10, 0.14, 0.16], 36);

    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        add(geo, d, sx * 1.34, 1.12, sz * 1.34, 0.22, 2.12, 0.22, C.steel, { outline: 0.012 });
        add(geo, d, sx * 1.34, 2.22, sz * 1.34, 0.32, 0.12, 0.32, C.ice, { outline: 0, emis: true });
        add(geo, d, sx * 1.34, 0.24, sz * 1.34, 0.36, 0.18, 0.36, C.dark, { outline: 0.010 });
        add(geo, d, sx * 1.20, 1.15, sz * 1.20, 0.05, 1.45, 0.05, C.iceDim, { outline: 0, emis: true });
      }
    }
    /* 顶部方形门框，中间留空 */
    add(geo, d, 0, 2.34, -1.34, 2.86, 0.14, 0.20, C.steelDark, { outline: 0.012 });
    add(geo, d, 0, 2.34, 1.34, 2.86, 0.14, 0.20, C.steelDark, { outline: 0.012 });
    add(geo, d, -1.34, 2.34, 0, 0.20, 0.14, 2.86, C.steelDark, { outline: 0.012 });
    add(geo, d, 1.34, 2.34, 0, 0.20, 0.14, 2.86, C.steelDark, { outline: 0.012 });
    add(geo, d, 0, 2.27, -1.34, 2.40, 0.04, 0.04, C.ice, { outline: 0, emis: true });
    add(geo, d, 0, 2.27, 1.34, 2.40, 0.04, 0.04, C.ice, { outline: 0, emis: true });

    /* 底座环灯 */
    add(geo, d, 0, 0.10, 0.98, 0.42, 0.07, 0.42, C.amberDim, { outline: 0, emis: true });
    add(geo, d, 0, 0.10, -0.98, 0.42, 0.07, 0.42, C.amberDim, { outline: 0, emis: true });
  }

  const DEVICE_DEFS = [
    { id: 'armory', name: '军械库', angle: -Math.PI * 0.5, color: C.amber, build: buildArmory, collider: 1.38, range: 2.65 },
    { id: 'printer', name: '打印机', angle: -Math.PI / 6, color: C.ice, build: buildPrinter, collider: 1.18, range: 2.55 },
    { id: 'storage', name: '仓库', angle: Math.PI / 6, color: C.amber, build: buildStorage, collider: 1.45, range: 2.75 },
    { id: 'fabricator', name: '制造台', angle: Math.PI * 0.5, color: [0.95, 0.48, 0.24], build: buildFabricator, collider: 1.28, range: 2.65 },
    { id: 'comms', name: '联络台', angle: Math.PI * 5 / 6, color: C.ice, build: buildComms, collider: 1.18, range: 2.60 },
    { id: 'teleporter', name: '传送台', angle: Math.PI * 7 / 6, color: C.ice, build: buildTeleporter, collider: 0, range: 2.85 }
  ];

  function initDevices() {
    deviceList = [];
    colliders = [];
    for (let i = 0; i < DEVICE_DEFS.length; i++) {
      const src = DEVICE_DEFS[i];
      const x = Math.cos(src.angle) * DEVICE_R;
      const z = Math.sin(src.angle) * DEVICE_R;
      const d = {
        id: src.id,
        name: src.name,
        x: x, z: z,
        angle: src.angle,
        yaw: Math.atan2(-x, -z),
        color: src.color,
        build: src.build,
        collider: src.collider,
        range: src.range
      };
      deviceList.push(d);
      if (d.collider > 0) colliders.push({ x: d.x, z: d.z, r: d.collider });
    }
  }

  function buildStatic(geo) {
    initDevices();
    buildRoom(geo);
    for (let i = 0; i < deviceList.length; i++) {
      deviceList[i].build(geo, deviceList[i]);
    }
  }

  /* ---------- 动态部分 ---------- */
  function drawDynamic(geo, t, nearId, flashId, flashK) {
    /* 中央圆形区域的旋转地面光弧，不放置任何实体 */
    for (let i = 0; i < 3; i++) {
      const a0 = t * (i % 2 ? -0.22 : 0.18) + i * Math.PI * 2 / 3;
      geo.arc(0, 0, CENTER_R - 0.62, CENTER_R - 0.47, a0, a0 + 0.62, 0.058,
        i === 1 ? C.ice : C.amber, 12);
    }

    for (let i = 0; i < deviceList.length; i++) {
      const d = deviceList[i];
      const near = d.id === nearId;
      const flash = d.id === flashId ? Math.max(0, Math.min(1, flashK)) : 0;
      const k = 0.5 + Math.sin(t * 2.2 + i * 1.7) * 0.5;

      if (d.id === 'armory') {
        const sx = Math.sin(t * 0.9) * 0.95;
        add(geo, d, sx, 2.02, 0.265, 0.16, 0.56, 0.025, C.amber, { outline: 0, emis: true, shadow: false });
      } else if (d.id === 'printer') {
        const sy = 0.86 + (Math.sin(t * 1.2) * 0.5 + 0.5) * 0.95;
        add(geo, d, 0, sy, 0.76, 1.24, 0.035, 0.02, C.ice, { outline: 0, emis: true, shadow: false });
        add(geo, d, 0, sy + 0.05, 0.40, 0.18, 0.05, 0.30, C.green, { outline: 0, emis: true, shadow: false });
      } else if (d.id === 'storage') {
        const bob = 2.92 + Math.sin(t * 1.7) * 0.06;
        add(geo, d, 0.92, bob, -0.16, 0.22, 0.22, 0.22, C.amber, { outline: 0, emis: true, yaw: t * 1.4, shadow: false });
        add(geo, d, 0.92, bob, -0.16, 0.34, 0.06, 0.06, C.amberDim, { outline: 0, emis: true, yaw: -t * 1.1, shadow: false });
      } else if (d.id === 'fabricator') {
        const a1 = Math.sin(t * 0.75) * 0.95;
        const a2 = a1 + Math.sin(t * 1.35 + 1.2) * 0.65;
        const bx = -0.62, bz = 0.10, l1 = 0.62;
        /* 局部 x 轴在额外 yaw 下的方向是 (cos, -sin)，与 geo.box 的旋转保持一致 */
        const x1 = bx + Math.cos(a1) * l1 * 0.5;
        const z1 = bz - Math.sin(a1) * l1 * 0.5;
        const ex = bx + Math.cos(a1) * l1;
        const ez = bz - Math.sin(a1) * l1;
        add(geo, d, x1, 1.28, z1, l1, 0.13, 0.13, C.steel, { outline: 0.010, yaw: a1 });
        add(geo, d, ex + Math.cos(a2) * 0.32, 1.28, ez - Math.sin(a2) * 0.32, 0.64, 0.11, 0.11, C.steel, { outline: 0.010, yaw: a2 });
        add(geo, d, ex + Math.cos(a2) * 0.64, 1.24, ez - Math.sin(a2) * 0.64, 0.12, 0.24, 0.12, C.amberDim, { outline: 0.008 });
        add(geo, d, ex + Math.cos(a2) * 0.64, 1.10, ez - Math.sin(a2) * 0.64, 0.05, 0.12, 0.05, C.amber, { outline: 0, emis: true, shadow: false });
      } else if (d.id === 'comms') {
        const a = t * 0.45;
        const mx = 0.92, mz = -0.42;
        add(geo, d, mx + Math.cos(a) * 0.35, 2.48, mz - Math.sin(a) * 0.35, 0.62, 0.06, 0.10, C.steel, { outline: 0.008, yaw: a });
        add(geo, d, mx + Math.cos(a) * 0.72, 2.58, mz - Math.sin(a) * 0.72, 0.72, 0.06, 0.52, C.iceDim, { outline: 0.010, yaw: a, rotX: -0.45 });
        add(geo, d, mx + Math.cos(a) * 0.86, 2.63, mz - Math.sin(a) * 0.86, 0.38, 0.04, 0.30, C.ice, { outline: 0, emis: true, yaw: a, rotX: -0.45 });
      } else if (d.id === 'teleporter') {
        const pulse = 0.45 + Math.sin(t * 2.6) * 0.18 + flash * 0.5;
        for (let kk = 0; kk < 3; kk++) {
          const a = t * (0.8 + kk * 0.18) + kk * Math.PI * 2 / 3;
          add(geo, d, Math.cos(a) * 0.38, 0.95, Math.sin(a) * 0.38, 0.045, 1.70, 0.045, C.ice, { outline: 0, emis: true, shadow: false });
        }
        geo.arc(d.x, d.z, 0.22, 0.48, t * 1.6, t * 1.6 + 1.15, 0.075, C.ice, 14);
        geo.arc(d.x, d.z, 0.58, 0.76, -t * 1.1, -t * 1.1 + 1.5, 0.073, C.amber, 14);
        add(geo, d, 0, 0.62, 0, 0.80 + pulse * 0.12, 0.05, 0.80 + pulse * 0.12, C.ice, { outline: 0, emis: true, yaw: t * 0.8, shadow: false });
      }

      statusLight(geo, d, d.id === 'comms' ? 1.52 : 2.05, d.color, k);

      if (near || flash > 0) {
        const ring = 1.62 + (flash > 0 ? flash * 0.24 : 0);
        geo.arc(d.x, d.z, ring, ring + 0.12, 0, Math.PI * 2, 0.062,
          flash > 0 ? [0.95, 0.92, 0.78] : d.color, 26);
        const my = 3.12 + Math.sin(t * 3.2) * 0.07;
        add(geo, d, 0, my, 0, 0.17, 0.17, 0.17, d.color, {
          outline: 0, emis: true, yaw: t * 1.8, shadow: false
        });
        add(geo, d, 0, my, 0, 0.34, 0.055, 0.055, d.color, {
          outline: 0, emis: true, yaw: -t * 1.4, shadow: false
        });
      }
    }
  }

  /* ---------- 碰撞 / 互动 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function resolve(x, z, r) {
    const lim = INNER - r;
    x = clamp(x, -lim, lim);
    z = clamp(z, -lim, lim);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const dx = x - c.x, dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const need = c.r + r;
        if (d < need) {
          if (d < 1e-5) { x = c.x + need; }
          else {
            x = c.x + dx / d * need;
            z = c.z + dz / d * need;
          }
          x = clamp(x, -lim, lim);
          z = clamp(z, -lim, lim);
        }
      }
    }
    return { x: x, z: z };
  }

  function moveCircle(x, z, dx, dz, r) {
    return resolve(x + dx, z + dz, r);
  }

  function nearest(x, z) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < deviceList.length; i++) {
      const d = deviceList[i];
      const dist = Math.hypot(x - d.x, z - d.z);
      if (dist <= d.range && dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  function deviceName(id) {
    for (let i = 0; i < deviceList.length; i++) {
      if (deviceList[i].id === id) return deviceList[i].name;
    }
    return '';
  }

  return {
    SPAWN: SPAWN,
    CENTER_R: CENTER_R,
    HALF: HALF,
    buildStatic: buildStatic,
    drawDynamic: drawDynamic,
    moveCircle: moveCircle,
    nearest: nearest,
    deviceName: deviceName,
    get devices() { return deviceList; }
  };
})();
