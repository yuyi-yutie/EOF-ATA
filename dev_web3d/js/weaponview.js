'use strict';

/* ============================================================
   武器预览：把 MODELS.GUNS 的方块模型投影成侧视 SVG
   - 背包 / 物资箱的武器栏共用
   - 无外部图片，跟随武器配色与轮廓
   ============================================================ */

const WeaponView = (function () {
  const cache = {};

  function rgb(c) {
    return 'rgb(' + Math.round(c[0] * 255) + ',' +
      Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
  }

  function dark(c, k) {
    return rgb([c[0] * k, c[1] * k, c[2] * k]);
  }

  function build(wi) {
    const parts = (MODELS.GUNS && MODELS.GUNS[wi]) || [];
    if (!parts.length) return '';
    let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      minZ = Math.min(minZ, p.z - p.sz * 0.5);
      maxZ = Math.max(maxZ, p.z + p.sz * 0.5);
      minY = Math.min(minY, p.y - p.sy * 0.5);
      maxY = Math.max(maxY, p.y + p.sy * 0.5);
    }
    const pad = 0.055;
    const w = (maxZ - minZ) + pad * 2;
    const h = (maxY - minY) + pad * 2;

    let body = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.castOnly) continue;
      const x = (p.z - p.sz * 0.5 - minZ) + pad;
      const y = (maxY - (p.y + p.sy * 0.5)) + pad;
      const col = rgb(p.color);
      const outline = p.outline === undefined ? 0.008 : p.outline;
      const stroke = outline > 0 ? dark(p.color, 0.42) : 'none';
      const sw = outline > 0 ? Math.max(0.005, outline * 0.55) : 0;
      body += '<rect x="' + x.toFixed(3) + '" y="' + y.toFixed(3) + '"' +
        ' width="' + Math.max(0.004, p.sz).toFixed(3) + '"' +
        ' height="' + Math.max(0.004, p.sy).toFixed(3) + '"' +
        ' fill="' + col + '" stroke="' + stroke + '" stroke-width="' + sw.toFixed(3) + '"' +
        (p.emis ? ' class="wv-emis"' : '') + '/>';
    }

    return '<svg class="weapon-svg" viewBox="0 0 ' + w.toFixed(3) + ' ' + h.toFixed(3) + '"' +
      ' preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + body + '</svg>';
  }

  function svg(wi) {
    if (!cache[wi]) cache[wi] = build(wi);
    return cache[wi];
  }

  return { svg: svg };
})();
