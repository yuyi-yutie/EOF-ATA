'use strict';

const Input = {
  keys: new Set(),
  mouse: { x: CFG.VW / 2, y: CFG.VH / 2, down: false },
  canvas: null,
  onKey: null,

  init(canvas) {
    this.canvas = canvas;

    window.addEventListener('keydown', e => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code);
    });

    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });

    canvas.addEventListener('mousemove', e => this.trackMouse(e));
    canvas.addEventListener('mousedown', e => {
      this.trackMouse(e);
      if (e.button === 0) this.mouse.down = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.mouse.down = false;
      }
    });
  },

  trackMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.mouse.x = ((e.clientX - r.left) / r.width) * CFG.VW;
    this.mouse.y = ((e.clientY - r.top) / r.height) * CFG.VH;
  },

  down(code) {
    return this.keys.has(code);
  },

  releaseAll() {
    this.keys.clear();
    this.mouse.down = false;
  }
};
