'use strict';

/* ============================================================
   模型：全部由方块组成，和 artbible 的比例/配色一致
   约定：角色朝向 +Z，原点在脚底；枪朝 +Z，握把在原点
   ============================================================ */

const MODELS = (function () {
  const P = PAL;

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
    return { parts: parts, height: 1.71, eye: 1.42 };
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
    return { parts: parts, height: 1.73, eye: 1.41 };
  }

  /* ---------------- 僵尸 ---------------- */
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
    return { parts: parts, height: 1.70, eye: 1.46 };
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
    return { parts: parts, height: 1.80, eye: 1.62 };
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
    return { parts: parts, height: 1.79, eye: 1.60 };
  }

  const UNITS = {
    scout: scout(),
    assault: assault(),
    zombie: zombie(),
    spitter: spitter(),
    gaunt: gaunt()
  };

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

  /* ---------------- 绘制 ---------------- */
  function drawUnit(geo, key, o) {
    const model = UNITS[key];
    if (!model) return;
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const sc = o.scale || 1;
    const moving = o.moving ? 1 : 0;
    const t = o.animT || 0;
    for (let i = 0; i < model.parts.length; i++) {
      const p = model.parts[i];
      let lx = p.x * sc, ly = p.y * sc, lz = p.z * sc;
      let dy = 0;
      if (p.leg && moving) {
        const ph = t * 9.5 + (p.leg === 'L' ? 0 : Math.PI);
        lz += Math.sin(ph) * 0.16;
        dy = Math.max(0, Math.sin(ph)) * 0.05;
      }
      const wx = o.x + cy * lx + sy * lz;
      const wz = o.z - sy * lx + cy * lz;
      const wy = o.y + ly + dy;
      geo.box({
        x: wx, y: wy, z: wz,
        sx: p.sx * sc, sy: p.sy * sc, sz: p.sz * sc,
        yaw: o.yaw,
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
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const sc = o.scale || 1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const lx = p.x * sc, ly = p.y * sc, lz = p.z * sc;
      const wx = o.x + cy * lx + sy * lz;
      const wz = o.z - sy * lx + cy * lz;
      geo.box({
        x: wx, y: o.y + ly, z: wz,
        sx: p.sx * sc, sy: p.sy * sc, sz: p.sz * sc,
        yaw: o.yaw,
        color: p.color,
        outline: p.outline === undefined ? 0.016 : p.outline,
        emis: p.emis
      });
    }
  }

  return {
    UNITS: UNITS,
    GUNS: GUNS,
    drawUnit: drawUnit,
    drawGun: drawGun,
    height: function (k) { return UNITS[k] ? UNITS[k].height : 1.7; }
  };
})();
