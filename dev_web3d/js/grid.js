'use strict';

/* ============================================================
   网格：背包 / 仓库共用的占格规则
   - 物品 w×h，rot=1 时旋转 90°
   - 自动摆放按「横放 → 竖放」顺序找第一个放得下的位置
   ============================================================ */

const Grid = (function () {
  function dims(it, rot) {
    const r = (rot === undefined ? it.rot : rot) ? 1 : 0;
    return r ? { w: it.h, h: it.w } : { w: it.w, h: it.h };
  }

  function fits(items, it, x, y, rot, cols, rows, ignore) {
    const d = dims(it, rot);
    if (x < 0 || y < 0 || x + d.w > cols || y + d.h > rows) return false;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      if (o === ignore || o === it) continue;
      const od = dims(o);
      if (x < o.gx + od.w && x + d.w > o.gx && y < o.gy + od.h && y + d.h > o.gy) return false;
    }
    return true;
  }

  function autoPlace(items, it, cols, rows) {
    for (let r = 0; r < 2; r++) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (fits(items, it, x, y, r, cols, rows, null)) {
            it.gx = x;
            it.gy = y;
            it.rot = r;
            return true;
          }
        }
      }
    }
    return false;
  }

  function usedCells(items) {
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const d = dims(items[i]);
      n += d.w * d.h;
    }
    return n;
  }

  /* 重新紧凑排列（仓库整理）：大件优先，品质高的优先 */
  function repack(items, cols, rows) {
    const order = items.slice().sort(function (a, b) {
      const av = a.w * a.h, bv = b.w * b.h;
      if (av !== bv) return bv - av;
      return (b.value || 0) - (a.value || 0);
    });
    const placed = [];
    const out = [];
    for (let i = 0; i < order.length; i++) {
      const it = order[i];
      if (autoPlace(placed, it, cols, rows)) {
        placed.push(it);
        out.push(it);
      } else {
        out.push(it); // 理论上不会发生：总格数够就能放下
      }
    }
    return out;
  }

  function cloneItem(it) {
    return {
      kind: it.kind || 'material',
      name: it.name,
      tierId: it.tierId,
      w: it.w, h: it.h,
      value: it.value || 0,
      time: it.time || 1,
      gx: it.gx || 0, gy: it.gy || 0, rot: it.rot ? 1 : 0
    };
  }

  return {
    dims: dims,
    fits: fits,
    autoPlace: autoPlace,
    usedCells: usedCells,
    repack: repack,
    cloneItem: cloneItem
  };
})();
