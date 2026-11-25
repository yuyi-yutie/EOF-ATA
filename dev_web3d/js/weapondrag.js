'use strict';

/* ============================================================
   武器拖拽：仓库 ↔ 配装槽
   - 从仓库武器拖到配装槽：装备
   - 从配装槽拖到仓库网格：卸下
   - 拖动超过阈值才生成虚影，不影响普通点击
   ============================================================ */

const WeaponDrag = (function () {
  let drag = null;
  let ghost = null;

  function ensureGhost(opts) {
    if (ghost) return ghost;
    ghost = document.createElement('div');
    ghost.className = 'weapon-drag-ghost';
    ghost.innerHTML =
      '<span class="weapon-thumb">' +
        (typeof WeaponView !== 'undefined' && opts.weaponId !== undefined ? WeaponView.svg(opts.weaponId) : '') +
      '</span>' +
      '<span class="wd-name"></span>';
    ghost.style.setProperty('--wc', opts.color || '#888');
    ghost.querySelector('.wd-name').textContent = opts.name || '武器';
    document.body.appendChild(ghost);
    return ghost;
  }

  function place(x, y) {
    if (!ghost) return;
    ghost.style.left = (x - 60) + 'px';
    ghost.style.top = (y - 22) + 'px';
  }

  function hide() {
    if (ghost) ghost.remove();
    ghost = null;
  }

  function start(e, opts) {
    if (!opts) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    hide();
    drag = {
      id: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      x: e.clientX, y: e.clientY,
      moved: false,
      opts: opts
    };
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) {
      drag.moved = true;
      ensureGhost(drag.opts);
      document.body.classList.add('weapon-dragging');
    }
    if (drag.moved) {
      e.preventDefault();
      place(e.clientX, e.clientY);
    }
  }

  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    hide();
    document.body.classList.remove('weapon-dragging');
    if (d.moved && d.opts.onDrop) d.opts.onDrop(e.clientX, e.clientY, e);
  }

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', function (e) {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      hide();
      document.body.classList.remove('weapon-dragging');
    }
  });

  return { start: start };
})();
