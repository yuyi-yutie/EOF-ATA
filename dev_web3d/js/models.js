'use strict';

/* ============================================================
   模型：全部由方块组成，和 artbible 的比例/配色一致
   约定：角色朝向 +Z，原点在脚底；枪朝 +Z，握把在原点
   ============================================================ */

const MODELS = (function () {
  const P = PAL;

  /* Blender 导出的动作曲线（js/animdata.js）。没有加载时全部回退到旧动作。 */
  const AD = (typeof ANIMDATA !== 'undefined') ? ANIMDATA : null;
  function animValue(clip, channel, u, fallback) {
    const c = AD && AD.clips ? AD.clips[clip] : null;
    const keys = c && c[channel];
    if (!keys || keys.length < 2) return fallback;
    let x = c.loop ? (u - Math.floor(u)) : (u < 0 ? 0 : (u > 1 ? 1 : u));
    if (x <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (x <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i];
        const span = b[0] - a[0];
        const k = span > 1e-6 ? (x - a[0]) / span : 0;
        return a[1] + (b[1] - a[1]) * k;
      }
    }
    return keys[keys.length - 1][1];
  }

  /* 奔跑时身体 / 枪械同步的左右摆动（同一个相位，保证枪不脱节） */
  function runSway(t) {
    const p = t * 5.5;
    return { yaw: Math.sin(p) * 0.085, shift: Math.sin(p) * 0.026 };
  }

  /* 奔跑时枪械随步伐的上下颠动 + 轻微俯仰 / 横向晃动 */
  function gunRunMotion(t) {
    const p = t * 9.8;
    return {
      bob: Math.abs(Math.cos(p)) * 0.030,
      pitch: Math.sin(p + 0.5) * 0.050,
      yaw: Math.sin(p * 0.5 + 1.0) * 0.030
    };
  }

  /* 走路时更轻、更慢的身体左右反应 */
  function walkSway(t) {
    const p = t * 3.2;
    return { yaw: Math.sin(p) * 0.05, shift: Math.sin(p) * 0.016 };
  }

  /* 走路 / 奔跑 / 停下的身体摆动；sprintMix 用于跑走切换的快速缓动 */
  function bodyStance(t, sprint, moving, sprintMix) {
    if (!moving) return { yaw: 0, shift: 0 };
    const run = runSway(t);
    const walk = walkSway(t);
    const k = sprint ? 1 : ((sprintMix === undefined) ? 0 : sprintMix);
    return {
      yaw: run.yaw * k + walk.yaw * (1 - k),
      shift: run.shift * k + walk.shift * (1 - k)
    };
  }

  function part(x, y, z, sx, sy, sz, color, opt) {
    const o = { x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, color: color };
    if (opt) for (const k in opt) o[k] = opt[k];
    return o;
  }

  /* ---------------- 人类：潜行者 ---------------- */
  function scout() {
    const parts = [];
    const OUT = 0.019;
    parts.push(part(-0.105, 0.30, 0, 0.17, 0.60, 0.20, P.scoutPants, { leg: 'L' }));
    parts.push(part(0.105, 0.30, 0, 0.17, 0.60, 0.20, P.scoutPants, { leg: 'R' }));
    parts.push(part(0, 0.62, 0, 0.46, 0.06, 0.32, P.ink));
    parts.push(part(0, 0.85, 0, 0.44, 0.46, 0.30, P.scout));
    parts.push(part(0, 0.88, 0.155, 0.30, 0.24, 0.02, P.scoutVest, { outline: 0 }));
    parts.push(part(0, 0.92, -0.215, 0.30, 0.28, 0.15, P.ink));
    parts.push(part(0, 1.10, 0, 0.16, 0.08, 0.16, P.skin, { outline: 0 }));
    parts.push(part(0, 1.38, 0, 0.56, 0.56, 0.48, P.skin));
    parts.push(part(0, 1.66, 0, 0.58, 0.10, 0.50, P.hair));
    parts.push(part(-0.10, 1.42, 0.245, 0.07, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.10, 1.42, 0.245, 0.07, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 1.30, 0.245, 0.10, 0.022, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.52, 0.60, 0.52, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.71, eye: 1.42, style: { cadence: 9.8, swing: 0.58, bob: 0.042, lean: 0.05 } };
  }

  /* ---------------- 人类：突击手 ---------------- */
  function assault() {
    const parts = [];
    parts.push(part(-0.12, 0.29, 0, 0.19, 0.58, 0.21, P.scoutPants, { leg: 'L' }));
    parts.push(part(0.12, 0.29, 0, 0.19, 0.58, 0.21, P.scoutPants, { leg: 'R' }));
    parts.push(part(0, 0.60, 0, 0.52, 0.06, 0.36, P.ink));
    parts.push(part(0, 0.84, 0, 0.50, 0.48, 0.34, [0.54, 0.50, 0.33]));
    parts.push(part(0, 0.87, 0.175, 0.36, 0.26, 0.03, [0.66, 0.61, 0.43], { outline: 0 }));
    parts.push(part(-0.13, 0.68, 0.185, 0.10, 0.10, 0.05, P.ink, { outline: 0 }));
    parts.push(part(0.13, 0.68, 0.185, 0.10, 0.10, 0.05, P.ink, { outline: 0 }));
    parts.push(part(0, 1.10, 0, 0.18, 0.08, 0.18, P.skin, { outline: 0 }));
    parts.push(part(0, 1.38, 0, 0.52, 0.52, 0.46, P.skin));
    parts.push(part(0, 1.63, 0, 0.58, 0.20, 0.50, P.helmet));
    parts.push(part(0, 1.545, 0.255, 0.54, 0.05, 0.10, P.helmet));
    parts.push(part(-0.105, 1.41, 0.235, 0.08, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.105, 1.41, 0.235, 0.08, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 1.29, 0.235, 0.11, 0.022, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.58, 0.60, 0.58, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.73, eye: 1.41, style: { cadence: 9.0, swing: 0.52, bob: 0.05, lean: 0.07 } };
  }

  /* ---------------- 人类：战术干员 ---------------- */
  function tactical() {
    const parts = [];
    const T = P.tactical, TL = P.tacticalL, TD = P.tacticalD;
    const V = P.tacticalVest, TAN = P.tacticalTan, CY = P.tacticalCyan;

    /* 腿 / 护膝 / 战术靴 */
    parts.push(part(-0.115, 0.29, 0, 0.18, 0.58, 0.21, TD, { leg: 'L' }));
    parts.push(part(0.115, 0.29, 0, 0.18, 0.58, 0.21, TD, { leg: 'R' }));
    parts.push(part(-0.115, 0.42, 0.115, 0.19, 0.16, 0.05, TL));
    parts.push(part(0.115, 0.42, 0.115, 0.19, 0.16, 0.05, TL));
    parts.push(part(-0.115, 0.055, 0.015, 0.20, 0.11, 0.28, TD));
    parts.push(part(0.115, 0.055, 0.015, 0.20, 0.11, 0.28, TD));
    parts.push(part(-0.115, 0.012, 0.02, 0.21, 0.025, 0.30, P.ink, { outline: 0 }));
    parts.push(part(0.115, 0.012, 0.02, 0.21, 0.025, 0.30, P.ink, { outline: 0 }));

    /* 腰带 / 腰包 */
    parts.push(part(0, 0.61, 0, 0.52, 0.08, 0.36, P.ink));
    parts.push(part(0, 0.61, 0.19, 0.07, 0.06, 0.03, P.steel, { outline: 0 }));
    parts.push(part(-0.245, 0.61, 0.11, 0.10, 0.14, 0.09, TAN));
    parts.push(part(0.245, 0.61, 0.11, 0.10, 0.14, 0.09, TAN));

    /* 躯干 / 防弹背心 */
    parts.push(part(0, 0.86, 0, 0.48, 0.48, 0.34, T));
    parts.push(part(0, 0.86, 0.18, 0.38, 0.34, 0.035, V));
    parts.push(part(0, 0.86, -0.18, 0.38, 0.32, 0.035, V));
    parts.push(part(-0.30, 0.97, 0, 0.12, 0.20, 0.28, TD));
    parts.push(part(0.30, 0.97, 0, 0.12, 0.20, 0.28, TD));
    parts.push(part(-0.315, 0.82, 0, 0.11, 0.30, 0.17, T));
    parts.push(part(0.315, 0.82, 0, 0.11, 0.30, 0.17, T));

    /* 胸前弹匣包 / 织带 / 电台 */
    for (let i = -1; i <= 1; i++) {
      parts.push(part(i * 0.11, 0.765, 0.205, 0.09, 0.105, 0.055, TAN));
      parts.push(part(i * 0.11, 0.812, 0.235, 0.075, 0.025, 0.02, P.ink, { outline: 0 }));
    }
    parts.push(part(-0.13, 0.96, 0.205, 0.035, 0.24, 0.02, TD));
    parts.push(part(0.13, 0.96, 0.205, 0.035, 0.24, 0.02, TD));
    parts.push(part(0, 0.965, 0.207, 0.22, 0.028, 0.02, TD));
    parts.push(part(0.19, 0.93, 0.19, 0.10, 0.14, 0.04, TD));
    parts.push(part(0.225, 1.04, 0.185, 0.018, 0.20, 0.018, TD));
    parts.push(part(-0.19, 0.94, 0.208, 0.08, 0.055, 0.016, TAN));
    parts.push(part(0.22, 0.705, 0.205, 0.032, 0.075, 0.025, P.amber, { outline: 0, emis: true }));

    /* 背包 */
    parts.push(part(0, 0.88, -0.235, 0.36, 0.34, 0.14, TD));
    parts.push(part(0, 0.98, -0.31, 0.26, 0.06, 0.02, TAN));
    parts.push(part(0, 0.79, -0.31, 0.26, 0.06, 0.02, TAN));

    /* 颈 / 头 / 面罩 */
    parts.push(part(0, 1.10, 0, 0.16, 0.08, 0.16, TD, { outline: 0 }));
    parts.push(part(0, 1.38, 0, 0.50, 0.50, 0.44, TD));
    parts.push(part(0, 1.36, 0.225, 0.34, 0.22, 0.02, T, { outline: 0 }));
    parts.push(part(0, 1.42, 0.236, 0.25, 0.10, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.10, 1.45, 0.248, 0.11, 0.065, 0.015, P.ink, { outline: 0, emis: true }));
    parts.push(part(0.10, 1.45, 0.248, 0.11, 0.065, 0.015, P.ink, { outline: 0, emis: true }));
    parts.push(part(-0.10, 1.45, 0.257, 0.075, 0.025, 0.008, CY, { outline: 0, emis: true }));
    parts.push(part(0.10, 1.45, 0.257, 0.075, 0.025, 0.008, CY, { outline: 0, emis: true }));
    parts.push(part(0, 1.29, 0.236, 0.11, 0.025, 0.02, P.ink, { outline: 0 }));

    /* 头盔 / 耳机 / NOD / 天线 */
    parts.push(part(0, 1.63, 0, 0.58, 0.17, 0.50, TD));
    parts.push(part(0, 1.72, 0, 0.48, 0.055, 0.38, T));
    parts.push(part(0, 1.555, 0.245, 0.52, 0.06, 0.10, TL));
    parts.push(part(-0.28, 1.50, 0, 0.08, 0.13, 0.18, TD));
    parts.push(part(0.28, 1.50, 0, 0.08, 0.13, 0.18, TD));
    parts.push(part(0, 1.685, 0.265, 0.12, 0.09, 0.08, TD));
    parts.push(part(0, 1.685, 0.31, 0.07, 0.055, 0.02, CY, { outline: 0, emis: true }));
    parts.push(part(0, 1.73, 0.10, 0.10, 0.025, 0.05, P.amber, { outline: 0, emis: true }));

    parts.push(part(0, 0.30, 0, 0.60, 0.60, 0.58, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.78, eye: 1.45, style: { cadence: 8.6, swing: 0.46, bob: 0.055, lean: 0.08 } };
  }

  /* ---------------- 人类：拾荒者 · 灰鼠 ---------------- */
  function scav() {
    const parts = [];
    const B = P.ragBrown, BL = P.ragBrownL, G = P.ragGrey, O = P.ragOlive;
    const R = P.ragRust, SK = P.ragSkin, H = P.ragHair, L = P.ragLeather;
    parts.push(part(-0.105, 0.28, 0, 0.17, 0.56, 0.20, G, { leg: 'L' }));
    parts.push(part(0.105, 0.28, 0, 0.17, 0.56, 0.20, O, { leg: 'R' }));
    parts.push(part(0.105, 0.32, 0.105, 0.15, 0.10, 0.015, BL, { outline: 0 }));
    parts.push(part(-0.105, 0.055, 0.01, 0.19, 0.11, 0.27, L));
    parts.push(part(0.105, 0.055, 0.01, 0.19, 0.11, 0.27, G));
    parts.push(part(0, 0.60, 0, 0.47, 0.07, 0.32, L));
    parts.push(part(0, 0.60, 0.17, 0.10, 0.035, 0.03, P.steel, { outline: 0 }));

    parts.push(part(0, 0.84, 0, 0.44, 0.48, 0.30, B));
    parts.push(part(-0.08, 0.80, 0.16, 0.20, 0.22, 0.025, BL));
    parts.push(part(0.12, 0.92, 0.16, 0.13, 0.13, 0.02, R));
    parts.push(part(0.04, 0.70, 0.16, 0.15, 0.10, 0.02, G));
    parts.push(part(-0.29, 0.83, 0, 0.10, 0.30, 0.15, B));
    parts.push(part(0.29, 0.83, 0, 0.10, 0.28, 0.15, SK));
    parts.push(part(0, 0.86, -0.22, 0.36, 0.32, 0.12, G));
    parts.push(part(0, 1.02, -0.27, 0.28, 0.10, 0.10, BL));
    parts.push(part(0.19, 0.72, 0.15, 0.08, 0.12, 0.07, O));

    /* 破烂下摆、破袖与蓬乱头发 */
    parts.push(part(-0.16, 0.585, 0.13, 0.09, 0.13, 0.025, BL, { outline: 0 }));
    parts.push(part(0.02, 0.565, 0.14, 0.07, 0.17, 0.025, O, { outline: 0 }));
    parts.push(part(0.18, 0.595, 0.12, 0.06, 0.10, 0.02, R, { outline: 0 }));
    parts.push(part(-0.05, 0.56, -0.15, 0.10, 0.16, 0.02, G, { outline: 0 }));
    parts.push(part(-0.20, 0.62, 0.055, 0.035, 0.10, 0.035, R, { outline: 0 }));
    parts.push(part(-0.07, 1.65, 0.12, 0.09, 0.08, 0.06, H, { outline: 0 }));
    parts.push(part(0.03, 1.66, 0.02, 0.08, 0.10, 0.08, H, { outline: 0 }));
    parts.push(part(-0.20, 1.58, 0.05, 0.07, 0.14, 0.07, H, { outline: 0 }));
    parts.push(part(0, 1.24, 0.222, 0.26, 0.10, 0.015, H, { outline: 0 }));

    parts.push(part(0, 1.10, 0, 0.15, 0.08, 0.15, SK, { outline: 0 }));
    parts.push(part(0, 1.36, 0, 0.48, 0.48, 0.44, SK));
    parts.push(part(0, 1.34, -0.16, 0.58, 0.54, 0.22, G));
    parts.push(part(0, 1.60, -0.02, 0.56, 0.12, 0.46, G));
    parts.push(part(0, 1.28, 0.225, 0.38, 0.14, 0.02, O, { outline: 0 }));
    parts.push(part(0, 1.125, 0.21, 0.40, 0.16, 0.03, G, { outline: 0 }));
    parts.push(part(-0.10, 1.42, 0.235, 0.075, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.10, 1.42, 0.235, 0.075, 0.05, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.11, 1.42, 0.248, 0.075, 0.055, 0.015, P.ink, { outline: 0, emis: true }));
    parts.push(part(0, 1.30, 0.236, 0.12, 0.025, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.14, 1.62, 0.03, 0.10, 0.10, 0.10, H, { outline: 0 }));
    parts.push(part(0.10, 1.63, -0.04, 0.12, 0.12, 0.10, H, { outline: 0 }));
    parts.push(part(0.18, 1.56, -0.08, 0.08, 0.16, 0.08, H, { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.56, 0.60, 0.56, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.72, eye: 1.42, style: { cadence: 8.8, swing: 0.50, bob: 0.055, lean: 0.12 } };
  }

  /* ---------------- 人类：拾荒者 · 暴徒 ---------------- */
  function raider() {
    const parts = [];
    const B = P.ragBrown, BL = P.ragBrownL, G = P.ragGrey, O = P.ragOlive;
    const R = P.ragRust, SK = P.ragSkin, H = P.ragHair, L = P.ragLeather;
    parts.push(part(-0.13, 0.29, 0, 0.20, 0.58, 0.23, G, { leg: 'L' }));
    parts.push(part(0.13, 0.29, 0, 0.20, 0.58, 0.23, B, { leg: 'R' }));
    parts.push(part(-0.13, 0.42, 0.12, 0.21, 0.15, 0.04, R));
    parts.push(part(-0.13, 0.055, 0.01, 0.22, 0.11, 0.30, L));
    parts.push(part(0.13, 0.055, 0.01, 0.22, 0.11, 0.30, G));
    parts.push(part(0, 0.61, 0, 0.56, 0.08, 0.38, L));
    parts.push(part(0, 0.61, 0.20, 0.10, 0.07, 0.03, P.steel, { outline: 0 }));

    parts.push(part(0, 0.86, 0, 0.56, 0.50, 0.34, O));
    parts.push(part(0, 0.88, 0.19, 0.40, 0.30, 0.03, L));
    parts.push(part(0, 0.86, 0.21, 0.34, 0.045, 0.02, R));
    parts.push(part(-0.34, 0.84, 0, 0.13, 0.34, 0.17, SK));
    parts.push(part(0.34, 0.84, 0, 0.13, 0.34, 0.17, SK));
    parts.push(part(-0.36, 0.99, 0, 0.18, 0.16, 0.32, L));
    parts.push(part(-0.36, 1.00, 0.02, 0.15, 0.10, 0.26, R, { outline: 0 }));
    parts.push(part(0.34, 0.98, 0, 0.16, 0.12, 0.28, L));
    parts.push(part(0, 0.86, -0.22, 0.42, 0.30, 0.13, G));
    parts.push(part(0.20, 0.72, 0.16, 0.10, 0.13, 0.08, B));

    /* 破裤脚、下摆与围巾 */
    parts.push(part(-0.13, 0.14, 0.095, 0.21, 0.10, 0.03, BL, { outline: 0 }));
    parts.push(part(0.13, 0.18, 0.10, 0.20, 0.08, 0.03, R, { outline: 0 }));
    parts.push(part(-0.15, 0.585, 0.155, 0.10, 0.14, 0.025, G, { outline: 0 }));
    parts.push(part(0.12, 0.595, 0.155, 0.08, 0.10, 0.02, B, { outline: 0 }));
    parts.push(part(0, 1.17, 0.20, 0.34, 0.10, 0.06, R));
    parts.push(part(-0.08, 1.10, 0.235, 0.10, 0.12, 0.03, R, { outline: 0 }));
    parts.push(part(-0.06, 1.67, 0.03, 0.09, 0.06, 0.12, H, { outline: 0 }));
    parts.push(part(0.05, 1.67, -0.05, 0.08, 0.08, 0.10, H, { outline: 0 }));
    parts.push(part(0.16, 1.61, 0.04, 0.06, 0.10, 0.06, H, { outline: 0 }));

    parts.push(part(0, 1.11, 0, 0.17, 0.08, 0.17, SK, { outline: 0 }));
    parts.push(part(0, 1.38, 0, 0.52, 0.52, 0.46, SK));
    parts.push(part(0, 1.29, 0.235, 0.40, 0.16, 0.02, G, { outline: 0 }));
    parts.push(part(-0.12, 1.44, 0.235, 0.10, 0.06, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.12, 1.44, 0.235, 0.10, 0.06, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.12, 1.44, 0.248, 0.08, 0.04, 0.015, R, { outline: 0, emis: true }));
    parts.push(part(0, 1.30, 0.236, 0.14, 0.025, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 1.66, 0, 0.10, 0.14, 0.38, H));
    parts.push(part(-0.11, 1.64, -0.01, 0.06, 0.12, 0.26, H));
    parts.push(part(0.12, 1.64, -0.02, 0.06, 0.10, 0.24, H));
    parts.push(part(-0.18, 1.57, -0.10, 0.07, 0.16, 0.07, H, { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.62, 0.60, 0.60, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.80, eye: 1.44, style: { cadence: 8.2, swing: 0.56, bob: 0.06, lean: 0.14 } };
  }

  /* ---------------- 人类：拾荒者 · 老油条 ---------------- */
  function veteran() {
    const parts = [];
    const B = P.ragBrown, BL = P.ragBrownL, G = P.ragGrey, O = P.ragOlive;
    const R = P.ragRust, SK = P.ragSkin, H = P.ragHair, L = P.ragLeather;
    parts.push(part(-0.11, 0.28, 0, 0.18, 0.56, 0.21, G, { leg: 'L' }));
    parts.push(part(0.11, 0.28, 0, 0.18, 0.56, 0.21, O, { leg: 'R' }));
    parts.push(part(0, 0.56, -0.14, 0.52, 0.22, 0.12, BL));
    parts.push(part(-0.105, 0.055, 0.01, 0.20, 0.11, 0.28, L));
    parts.push(part(0.105, 0.055, 0.01, 0.20, 0.11, 0.28, L));
    parts.push(part(0, 0.62, 0, 0.52, 0.08, 0.36, L));
    parts.push(part(0, 0.86, 0, 0.48, 0.48, 0.32, BL));
    parts.push(part(0, 0.86, 0.18, 0.36, 0.26, 0.025, B));
    parts.push(part(-0.10, 0.77, 0.19, 0.16, 0.10, 0.02, G));
    parts.push(part(0.13, 0.93, 0.19, 0.12, 0.12, 0.02, R));
    parts.push(part(-0.29, 0.84, 0, 0.11, 0.32, 0.16, B));
    parts.push(part(0.29, 0.84, 0, 0.11, 0.32, 0.16, B));
    parts.push(part(0, 0.88, -0.23, 0.40, 0.38, 0.15, G));
    parts.push(part(0, 1.08, -0.30, 0.30, 0.12, 0.10, L));
    parts.push(part(-0.23, 0.72, 0.15, 0.10, 0.14, 0.08, O));

    /* 风衣破下摆、袖口补丁与乱发 */
    parts.push(part(-0.18, 0.47, -0.17, 0.10, 0.18, 0.025, BL, { outline: 0 }));
    parts.push(part(0.03, 0.45, -0.18, 0.08, 0.22, 0.025, BL, { outline: 0 }));
    parts.push(part(0.20, 0.49, -0.16, 0.07, 0.14, 0.02, G, { outline: 0 }));
    parts.push(part(0.28, 0.75, 0.10, 0.04, 0.08, 0.05, R, { outline: 0 }));
    parts.push(part(-0.20, 1.66, 0.06, 0.07, 0.10, 0.07, H, { outline: 0 }));
    parts.push(part(0.18, 1.63, -0.02, 0.07, 0.12, 0.08, H, { outline: 0 }));

    /* 叼着的烟：烟身 + 燃烧的烟头 */
    parts.push(part(0.062, 1.287, 0.315, 0.018, 0.018, 0.150, [0.86, 0.84, 0.78], { outline: 0 }));
    parts.push(part(0.062, 1.287, 0.392, 0.021, 0.021, 0.018, P.amber, { outline: 0, emis: true }));

    parts.push(part(0, 1.10, 0, 0.16, 0.08, 0.16, SK, { outline: 0 }));
    parts.push(part(0, 1.37, 0, 0.50, 0.50, 0.45, SK));
    parts.push(part(0, 1.26, 0.23, 0.36, 0.17, 0.02, G, { outline: 0 }));
    parts.push(part(0, 1.31, 0.24, 0.30, 0.10, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.11, 1.47, 0.24, 0.10, 0.06, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.11, 1.47, 0.24, 0.10, 0.06, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0, 1.58, 0.20, 0.52, 0.08, 0.08, G));
    parts.push(part(-0.15, 1.59, 0.22, 0.10, 0.07, 0.03, P.ink, { outline: 0, emis: true }));
    parts.push(part(0.15, 1.59, 0.22, 0.10, 0.07, 0.03, P.ink, { outline: 0, emis: true }));
    parts.push(part(0, 1.68, -0.05, 0.46, 0.10, 0.34, G));
    parts.push(part(0, 1.21, 0.235, 0.20, 0.08, 0.02, H, { outline: 0 }));
    parts.push(part(-0.13, 1.62, -0.08, 0.12, 0.12, 0.12, H, { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.58, 0.60, 0.58, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.76, eye: 1.47, style: { cadence: 8.0, swing: 0.48, bob: 0.05, lean: 0.10 } };
  }

  /* 僵尸 */
  function zombie() {
    const parts = [];
    parts.push(part(-0.13, 0.27, 0, 0.19, 0.54, 0.22, P.oliveD, { leg: 'L' }));
    parts.push(part(0.13, 0.27, 0, 0.19, 0.54, 0.22, P.oliveD, { leg: 'R' }));
    parts.push(part(0, 0.81, 0, 0.50, 0.50, 0.36, P.oliveM));
    parts.push(part(0, 0.81, 0.19, 0.26, 0.26, 0.02, P.olive, { outline: 0 }));
    parts.push(part(0, 1.40, 0, 0.64, 0.60, 0.52, P.olive));
    parts.push(part(-0.135, 1.46, 0.27, 0.12, 0.085, 0.02, P.amber, { outline: 0, emis: true }));
    parts.push(part(0.135, 1.46, 0.27, 0.12, 0.085, 0.02, P.amber, { outline: 0, emis: true }));
    parts.push(part(0.01, 1.26, 0.27, 0.28, 0.09, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.075, 1.295, 0.278, 0.045, 0.055, 0.02, [0.89, 0.86, 0.76], { outline: 0 }));
    parts.push(part(0.005, 1.295, 0.278, 0.045, 0.055, 0.02, [0.89, 0.86, 0.76], { outline: 0 }));
    parts.push(part(0.085, 1.295, 0.278, 0.045, 0.055, 0.02, [0.89, 0.86, 0.76], { outline: 0 }));
    parts.push(part(0, 0.30, 0, 0.56, 0.60, 0.46, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.70, eye: 1.46, style: { cadence: 6.4, swing: 0.44, bob: 0.055, lean: 0.16 } };
  }

  /* ---------------- 喷吐僵尸 ---------------- */
  function spitter() {
    const parts = [];
    parts.push(part(-0.115, 0.31, 0, 0.15, 0.62, 0.18, P.blueD, { leg: 'L' }));
    parts.push(part(0.115, 0.31, 0, 0.15, 0.62, 0.18, P.blueD, { leg: 'R' }));
    parts.push(part(0, 0.92, 0, 0.42, 0.52, 0.30, P.blueM));
    parts.push(part(0, 0.96, 0.155, 0.26, 0.16, 0.02, P.blueD, { outline: 0 }));
    parts.push(part(0, 1.50, 0, 0.48, 0.60, 0.46, P.blue));
    parts.push(part(0, 1.35, 0.235, 0.30, 0.17, 0.02, P.violet, { outline: 0, emis: true }));
    parts.push(part(-0.105, 1.62, 0.235, 0.085, 0.06, 0.02, P.violet, { outline: 0, emis: true }));
    parts.push(part(0.105, 1.62, 0.235, 0.085, 0.06, 0.02, P.violet, { outline: 0, emis: true }));
    parts.push(part(0, 0.32, 0, 0.48, 0.62, 0.40, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.80, eye: 1.62, style: { cadence: 5.6, swing: 0.34, bob: 0.038, lean: 0.1 } };
  }

  /* ---------------- 干尸 ---------------- */
  function gaunt() {
    const parts = [];
    parts.push(part(-0.10, 0.30, 0, 0.14, 0.60, 0.17, P.gauntD, { leg: 'L' }));
    parts.push(part(0.10, 0.30, 0, 0.14, 0.60, 0.17, P.gauntD, { leg: 'R' }));
    parts.push(part(0, 0.87, 0, 0.40, 0.54, 0.30, P.gauntM));
    parts.push(part(0, 0.92, 0.155, 0.26, 0.28, 0.02, P.gaunt, { outline: 0 }));
    parts.push(part(0, 0.96, 0.162, 0.22, 0.035, 0.02, P.gauntD, { outline: 0 }));
    parts.push(part(0, 1.48, 0, 0.50, 0.62, 0.44, P.gaunt));
    parts.push(part(-0.115, 1.60, 0.225, 0.14, 0.12, 0.02, P.ink, { outline: 0 }));
    parts.push(part(0.115, 1.60, 0.225, 0.14, 0.12, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.115, 1.595, 0.232, 0.05, 0.045, 0.02, P.amber, { outline: 0, emis: true }));
    parts.push(part(0.115, 1.595, 0.232, 0.05, 0.045, 0.02, P.amber, { outline: 0, emis: true }));
    parts.push(part(0, 1.28, 0.225, 0.28, 0.14, 0.02, P.ink, { outline: 0 }));
    parts.push(part(-0.085, 1.325, 0.232, 0.042, 0.06, 0.02, [0.87, 0.84, 0.75], { outline: 0 }));
    parts.push(part(-0.005, 1.325, 0.232, 0.042, 0.06, 0.02, [0.87, 0.84, 0.75], { outline: 0 }));
    parts.push(part(0.075, 1.325, 0.232, 0.042, 0.06, 0.02, [0.87, 0.84, 0.75], { outline: 0 }));
    parts.push(part(0, 0.31, 0, 0.44, 0.62, 0.40, P.ink, { castOnly: true }));
    return { parts: parts, height: 1.79, eye: 1.60, style: { cadence: 12.5, swing: 0.72, bob: 0.062, lean: 0.22 } };
  }

  /* 动作风格：cadence 步频、swing 摆腿幅度、bob 起伏、lean 前倾 */
  const DEF_STYLE = { cadence: 9.5, swing: 0.55, bob: 0.045, lean: 0.06 };

  /* 死亡散落：头 / 身 / 左腿 / 右腿 的方向与距离（相对角色朝向） */
  const GI_ANG = [0.35, -2.6, 2.5, -0.5];
  const GI_DIST = [0.62, 0.18, 0.55, 0.55];

  /* 整体压矮：只压 Y，保持方块头的分量 -> 矮壮版 */
  const YS = 0.78;

  function squash(model) {
    for (let i = 0; i < model.parts.length; i++) {
      const p = model.parts[i];
      /* 死亡散落按 4 块分组：头 / 身 / 左腿 / 右腿 */
      if (p.castOnly) p.grp = null;
      else if (p.leg) p.grp = p.leg === 'L' ? 'legL' : 'legR';
      else p.grp = p.y > 1.05 ? 'head' : 'body';
      p.hips = (!p.leg && !p.castOnly && p.y > 0.55 && p.y < 0.68);
      p.y *= YS;
      p.sy *= YS;
    }
    model.height *= YS;
    model.eye *= YS;
    model.hips = 0.60 * YS;
    return model;
  }

  const UNITS = {
    scout: squash(scout()),
    assault: squash(assault()),
    tactical: squash(tactical()),
    scav: squash(scav()),
    raider: squash(raider()),
    veteran: squash(veteran()),
    zombie: squash(zombie()),
    spitter: squash(spitter()),
    gaunt: squash(gaunt())
  };

  /* Blender 导出的角色几何（assets/chars/build_characters.py -> js/charmodels.js）：
     坐标已包含 0.78 压矮，直接覆盖同名内置定义，并加入新角色。 */
  if (typeof CHARMODELS !== 'undefined' && CHARMODELS) {
    for (const k in CHARMODELS) {
      if (Object.prototype.hasOwnProperty.call(CHARMODELS, k)) UNITS[k] = CHARMODELS[k];
    }
  }

  /* ---------------- 武器 ---------------- */
  function gunBase(accent) {
    const G = [0.20, 0.22, 0.25], GL = [0.29, 0.32, 0.36], D = [0.13, 0.14, 0.16];
    const p = [];
    p.push(part(0, 0.03, 0.06, 0.10, 0.13, 0.34, G));
    p.push(part(0, 0.105, 0.07, 0.05, 0.03, 0.30, GL, { outline: 0 }));
    p.push(part(0, 0.02, -0.18, 0.09, 0.11, 0.20, G));
    p.push(part(0, 0.02, -0.285, 0.095, 0.12, 0.03, D, { outline: 0 }));
    p.push(part(0, -0.085, -0.01, 0.08, 0.16, 0.07, D));
    p.push(part(0, -0.09, 0.10, 0.07, 0.14, 0.075, GL, { outline: 0 }));
    p.push(part(0, -0.045, 0.035, 0.045, 0.05, 0.03, D, { outline: 0 }));
    p.push(part(0, 0.075, 0.03, 0.10, 0.022, 0.09, accent, { outline: 0 }));
    return p;
  }

  function sonic() {
    const p = gunBase([1.0, 0.69, 0.30]);
    p.push(part(0, 0.035, 0.30, 0.075, 0.075, 0.16, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.035, 0.47, 0.20, 0.21, 0.20, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.035, 0.575, 0.23, 0.24, 0.035, [1.0, 0.69, 0.30]));
    p.push(part(0, 0.035, 0.595, 0.17, 0.18, 0.02, [1.0, 0.86, 0.55], { outline: 0, emis: true }));
    return p;
  }
  function laser() {
    const p = gunBase([0.56, 0.89, 0.95]);
    p.push(part(0, 0.04, 0.42, 0.048, 0.048, 0.44, [0.73, 0.76, 0.80]));
    p.push(part(0, 0.055, 0.36, 0.10, 0.09, 0.10, [0.56, 0.89, 0.95]));
    p.push(part(0, 0.04, 0.68, 0.045, 0.045, 0.09, [0.13, 0.14, 0.16]));
    p.push(part(0, 0.04, 0.725, 0.028, 0.028, 0.02, [0.56, 0.89, 0.95], { outline: 0, emis: true }));
    p.push(part(0, 0.165, 0.12, 0.055, 0.055, 0.16, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.165, 0.205, 0.045, 0.045, 0.02, [0.56, 0.89, 0.95], { outline: 0, emis: true }));
    return p;
  }
  function thermal() {
    const p = gunBase([0.94, 0.44, 0.24]);
    p.push(part(0, 0.175, 0.02, 0.15, 0.15, 0.28, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.175, -0.07, 0.16, 0.16, 0.028, [0.94, 0.44, 0.24], { outline: 0 }));
    p.push(part(0, 0.175, 0.11, 0.16, 0.16, 0.028, [0.94, 0.44, 0.24], { outline: 0 }));
    p.push(part(0, 0.045, 0.35, 0.09, 0.09, 0.26, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.045, 0.53, 0.10, 0.10, 0.13, [0.13, 0.14, 0.16]));
    p.push(part(0, 0.045, 0.60, 0.15, 0.15, 0.02, [0.94, 0.44, 0.24], { outline: 0, emis: true }));
    return p;
  }
  function kinetic() {
    const p = gunBase([0.87, 0.89, 0.92]);
    p.push(part(-0.035, 0.055, 0.40, 0.028, 0.03, 0.44, [0.73, 0.76, 0.80]));
    p.push(part(0.035, 0.055, 0.40, 0.028, 0.03, 0.44, [0.73, 0.76, 0.80]));
    p.push(part(0, 0.045, 0.24, 0.10, 0.075, 0.18, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.045, 0.62, 0.105, 0.085, 0.11, [0.20, 0.22, 0.25]));
    p.push(part(0, 0.045, 0.595, 0.115, 0.06, 0.018, [0.13, 0.14, 0.16], { outline: 0 }));
    p.push(part(0, 0.045, 0.645, 0.115, 0.06, 0.018, [0.13, 0.14, 0.16], { outline: 0 }));
    p.push(part(0, 0.045, 0.70, 0.064, 0.064, 0.05, [0.87, 0.89, 0.92]));
    return p;
  }
  function voltaic() {
    const p = gunBase([0.70, 0.57, 0.94]);
    p.push(part(0, 0.045, 0.41, 0.06, 0.06, 0.40, [0.29, 0.32, 0.36]));
    p.push(part(0, 0.045, 0.30, 0.144, 0.144, 0.045, [0.70, 0.57, 0.94]));
    p.push(part(0, 0.045, 0.40, 0.144, 0.144, 0.045, [0.70, 0.57, 0.94]));
    p.push(part(0, 0.045, 0.50, 0.144, 0.144, 0.045, [0.70, 0.57, 0.94]));
    p.push(part(-0.055, 0.045, 0.66, 0.028, 0.028, 0.15, [0.73, 0.76, 0.80]));
    p.push(part(0.055, 0.045, 0.66, 0.028, 0.028, 0.15, [0.73, 0.76, 0.80]));
    p.push(part(0, 0.045, 0.61, 0.035, 0.035, 0.03, [0.70, 0.57, 0.94], { outline: 0, emis: true }));
    return p;
  }

  const GUNS = [sonic(), laser(), thermal(), kinetic(), voltaic()];

  /* ---------------- 绘制 ----------------
     o: { x,y,z, yaw, moving, animT, scale, deadT, lunge }
     - 腿绕髋关节前后摆（不是平移）
     - 躯干/头随步伐上下起伏，并按 lean 前倾
     - deadT > 0 时整体绕脚底翻倒
  */
  function drawUnit(geo, key, o) {
    const model = UNITS[key];
    if (!model) return;
    const st = model.style || DEF_STYLE;
    const sc = o.scale || 1;
    const t = o.animT || 0;
    const moving = o.moving ? 1 : 0;
    const ph = t * st.cadence;
    const lunge = o.lunge || 0;
    const deadT = o.deadT || 0;
    const hipsY = (model.hips || 0.6) * sc;

    /* 下半身（腿 + 腰带）完全按移动方向计算朝向，与身体朝向无关 */
    const legYaw = (moving && o.moveYaw !== undefined && o.moveYaw !== null) ? o.moveYaw : o.yaw;

    const bob = (moving ? Math.abs(Math.cos(ph)) * st.bob : Math.sin(t * 1.7) * 0.007) * sc;
    /* Blender 导出的走路 / 奔跑曲线：
       步态相位放慢到「一个完整左右周期约两步」，停下后平滑过渡到轻微待机摇晃。 */
    const cycle = (t * st.cadence / (Math.PI * 4)) % 1;
    const swayT = (o.swayT !== undefined) ? o.swayT : t;
    const moveMix = (o.moveBlend === undefined) ? (moving ? 1 : 0) : Math.max(0, Math.min(1, o.moveBlend));
    const phaseOff = o.swayPhase || 0;
    const sprintMix = (o.sprintMix === undefined)
      ? (o.sprint ? 1 : 0)
      : Math.max(0, Math.min(1, o.sprintMix));
    const idleYaw = Math.sin(swayT * 2.4 + phaseOff) * 0.08;
    const idleNod = Math.sin(swayT * 2.4 + phaseOff + 1.1) * 0.018;
    const walkYaw = animValue('walk', 'headYaw', cycle, 0);
    const runYaw = animValue('sprint', 'headYaw', cycle, 0);
    const walkNod = animValue('walk', 'headPitch', cycle, 0);
    const runNod = animValue('sprint', 'headPitch', cycle, 0);
    const walkShift = animValue('walk', 'headX', cycle, 0);
    const runShift = animValue('sprint', 'headX', cycle, 0);
    const walkLift = animValue('walk', 'headY', cycle, 0);
    const runLift = animValue('sprint', 'headY', cycle, 0);
    const headSway = (walkYaw * (1 - sprintMix) + runYaw * sprintMix) * moveMix + idleYaw * (1 - moveMix);
    const headNod = (walkNod * (1 - sprintMix) + runNod * sprintMix) * moveMix + idleNod * (1 - moveMix);
    const headShift = (walkShift * (1 - sprintMix) + runShift * sprintMix) * moveMix * sc;
    const headLift = (walkLift * (1 - sprintMix) + runLift * sprintMix) * moveMix * sc;
    const sprintLean = animValue('sprint', 'lean', cycle, 0) * sprintMix;
    const lean = (st.lean + sprintLean) * moveMix + lunge * 0.42;
    /* 走路 / 奔跑的身体左右反应；game 会传入带缓动的数值 */
    const stance = bodyStance(t, !!o.sprint, !!moving, o.sprintMix);
    const bodySway = (o.bodySway !== undefined) ? o.bodySway : stance.yaw;
    const bodyShift = (o.bodyShift !== undefined) ? o.bodyShift : stance.shift;

    for (let i = 0; i < model.parts.length; i++) {
      const p = model.parts[i];
      let lx = p.x * sc;
      let ly = p.y * sc;
      /* 面部细节（眼/嘴/面罩）稍微前移，避免和头部正面相交产生闪烁 */
      const faceOut = (!p.castOnly && p.y > 0.86 && p.z > 0.18 && p.sz < 0.13) ? 0.014 : 0;
      let lz = (p.z + faceOut) * sc;
      let rotX = 0, pvx = 0, pvy = 0, pvz = 0;
      let yaw = o.yaw;
      let deadX = 0, deadZ = 0;

      if (p.castOnly) {
        /* 影子代理：不参与动作 */
      } else if (deadT > 0) {
        /* 死亡：四个部分当砖块直接散开、落地，不做旋转 */
        const gi = p.grp === 'head' ? 0 : p.grp === 'body' ? 1 : p.grp === 'legL' ? 2 : 3;
        const ang = o.yaw + GI_ANG[gi];
        const dist = GI_DIST[gi];
        const k = Math.min(1, deadT / 0.32);
        const e = 1 - (1 - k) * (1 - k);
        deadX = Math.cos(ang) * dist * e;
        deadZ = Math.sin(ang) * dist * e;
        const restY = p.sy * sc * 0.5 + 0.015;
        ly = ly * (1 - e) + restY * e;
      } else if (p.leg) {
        const ph2 = ph + (p.leg === 'L' ? 0 : Math.PI);
        rotX = Math.sin(ph2) * st.swing * (moving ? 1 : 0);
        /* 所有腿部零件共用髋关节作为转轴，靴子 / 膝甲 / 护胫不会脱节 */
        pvy = hipsY - ly;
        ly += Math.max(0, Math.sin(ph2)) * 0.028 * sc * moving;
        yaw = legYaw;
      } else {
        const isHead = p.grp === 'head';
        /* 髋部仍按移动方向，躯干 / 头 / 枪随奔跑左右摆 */
        const baseYaw = p.hips ? legYaw : o.yaw;
        yaw = baseYaw + bodySway;
        lx += bodyShift;
        if (isHead) {
          /* 头绕颈部（模型局部 x/z = 0 的竖轴）转动：走路摇摆 + 跑动时自由观察 */
          const look = o.headYaw || 0;
          yaw = o.yaw + bodySway + look + headSway;
          lx += headShift;
          ly += bob + headLift;
          rotX = lean * 0.55 + headNod;
          pvy = hipsY + 0.25 * sc - ly;
        } else {
          ly += bob * 0.75;
          rotX = lean;
          pvy = hipsY - ly;
        }
      }

      const wx = o.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz + deadX;
      const wz = o.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz + deadZ;
      const wy = o.y + ly;
      geo.box({
        x: wx, y: wy, z: wz,
        sx: p.sx * sc, sy: p.sy * sc, sz: p.sz * sc,
        yaw: yaw,
        rotX: rotX,
        px: pvx, py: pvy, pz: pvz,
        color: p.color,
        outline: p.outline === undefined ? 0.032 : p.outline,
        emis: p.emis,
        shadow: false,
        castOnly: p.castOnly
      });
    }
  }

  function drawGun(geo, idx, o) {
    const parts = GUNS[idx];
    if (!parts) return;
    const yaw = o.yaw + (o.yawOffset || 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const sc = o.scale || 1;
    const pitch = o.pitch || 0;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const lx = p.x * sc, ly = p.y * sc, lz = p.z * sc;
      /* 整把枪用同一个 Ry(yaw) * Rx(pitch) 刚体变换：
         每个零件的中心和朝向一起转，任何奔跑方向都不会散架。 */
      const wx = o.x + cy * lx + sy * (sp * ly + cp * lz);
      const wy = o.y + cp * ly - sp * lz;
      const wz = o.z - sy * lx + cy * (sp * ly + cp * lz);
      geo.box({
        x: wx, y: wy, z: wz,
        sx: p.sx * sc, sy: p.sy * sc, sz: p.sz * sc,
        yaw: yaw,
        rotX: pitch,
        color: p.color,
        outline: p.outline === undefined ? 0.016 : p.outline,
        emis: p.emis
      });
    }
  }

  /* 换弹时从枪身上掉下 / 重新装上的弹夹 */
  function drawGunMag(geo, idx, o) {
    const sc = o.scale || 1;
    const msc = (o.magScale === undefined ? 1 : o.magScale) * sc;
    if (msc < 0.02) return;
    const yaw = o.yaw + (o.yawOffset || 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const pitch = o.pitch || 0;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ly0 = -0.17 * sc;
    const lz0 = 0.02 * sc;
    /* 弹夹在枪身上的位置跟随枪的旋转；掉落量直接加在世界 Y 上 */
    const wx = o.x + sy * (sp * ly0 + cp * lz0);
    const wy = Math.max(0.06, o.y + cp * ly0 - sp * lz0 + (o.magY || 0));
    const wz = o.z + cy * (sp * ly0 + cp * lz0);
    geo.box({
      x: wx, y: wy, z: wz,
      sx: 0.075 * msc, sy: 0.18 * msc, sz: 0.065 * msc,
      yaw: yaw, rotX: pitch,
      color: [0.18, 0.20, 0.23], outline: 0.012
    });
    geo.box({
      x: wx, y: wy - 0.095 * msc, z: wz,
      sx: 0.09 * msc, sy: 0.028 * msc, sz: 0.075 * msc,
      yaw: yaw, rotX: pitch,
      color: [0.58, 0.62, 0.67], outline: 0.01
    });
  }

  /* ---------------- 屏幕外敌人头像 ----------------
     用现有方块模型的 head 分组做正面正交投影：
     只取 head 组零件，按 z 从前到后绘制，保留模型本身的配色、发光件和墨线。
     返回 dataURL，供 HUD 的边缘头像直接使用。 */
  const PORTRAIT_CACHE = {};
  function headPortrait(key, px) {
    px = Math.max(24, Math.round(px || 128));
    const cacheKey = key + ':' + px;
    if (PORTRAIT_CACHE[cacheKey]) return PORTRAIT_CACHE[cacheKey];
    const model = UNITS[key];
    if (!model || typeof document === 'undefined') return '';

    const parts = [];
    for (let i = 0; i < model.parts.length; i++) {
      const p = model.parts[i];
      if (p.grp === 'head' && !p.castOnly) parts.push(p);
    }
    if (!parts.length) return '';

    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      minX = Math.min(minX, p.x - p.sx * 0.5);
      maxX = Math.max(maxX, p.x + p.sx * 0.5);
      minY = Math.min(minY, p.y - p.sy * 0.5);
      maxY = Math.max(maxY, p.y + p.sy * 0.5);
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const span = Math.max(maxX - minX, maxY - minY);
    const scale = px * 0.92 / (span || 1);

    const cv = document.createElement('canvas');
    cv.width = px;
    cv.height = px;
    const g = cv.getContext('2d');
    if (!g) return '';

    /* 模型朝 +Z；观察者在 +Z 正面。按每个零件前表面的 z 排序，
       近的零件覆盖远的零件。 */
    const list = parts.slice().sort(function (a, b) {
      return (a.z + a.sz * 0.5) - (b.z + b.sz * 0.5);
    });
    const ink = '#14171a';
    const lw = Math.max(1, px * 0.014);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const x0 = (p.x - p.sx * 0.5 - cx) * scale + px * 0.5;
      const x1 = (p.x + p.sx * 0.5 - cx) * scale + px * 0.5;
      const y0 = -(p.y + p.sy * 0.5 - cy) * scale + px * 0.5;
      const y1 = -(p.y - p.sy * 0.5 - cy) * scale + px * 0.5;
      const c = p.color || [0.5, 0.5, 0.5];
      const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
      const gg = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
      const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
      g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (p.outline !== 0) {
        g.strokeStyle = ink;
        g.lineWidth = lw;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    /* 统一的三渲二光感：左上受光、右下压暗，只作用于头像像素 */
    const grd = g.createLinearGradient(0, 0, px, px);
    grd.addColorStop(0, 'rgba(255,255,255,.16)');
    grd.addColorStop(0.42, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(0,0,0,.22)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = grd;
    g.fillRect(0, 0, px, px);
    g.globalCompositeOperation = 'source-over';

    PORTRAIT_CACHE[cacheKey] = cv.toDataURL('image/png');
    return PORTRAIT_CACHE[cacheKey];
  }

  function carryPose(u) {
    return {
      yawOffset: animValue('sprint', 'gunYaw', u, 1.52),
      y: animValue('sprint', 'gunY', u, -0.02),
      pitch: animValue('sprint', 'gunPitch', u, 0.10)
    };
  }

  function reloadPose(u) {
    return {
      yaw: animValue('reload', 'gunYaw', u, 0),
      y: animValue('reload', 'gunY', u, 0),
      x: animValue('reload', 'gunX', u, 0),
      z: animValue('reload', 'gunZ', u, 0),
      pitch: animValue('reload', 'gunPitch', u, 0),
      magY: animValue('reload', 'magY', u, 0),
      magScale: animValue('reload', 'magScale', u, 1)
    };
  }

  return {
    UNITS: UNITS,
    GUNS: GUNS,
    drawUnit: drawUnit,
    drawGun: drawGun,
    drawGunMag: drawGunMag,
    headPortrait: headPortrait,
    carryPose: carryPose,
    reloadPose: reloadPose,
    runSway: runSway,
    bodyStance: bodyStance,
    gunRunMotion: gunRunMotion,
    height: function (k) { return UNITS[k] ? UNITS[k].height : 1.7; }
  };
})();
