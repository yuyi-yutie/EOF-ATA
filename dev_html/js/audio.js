'use strict';

/* ============================================================
   程序化音效（WebAudio，无音频文件）
   ============================================================ */
const SFX = (() => {
  let ac = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 10;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master = ac.createGain();
      master.gain.value = 0.42;
      master.connect(comp);
      comp.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ac.sampleRate * 0.6);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function tone(o) {
    if (muted) return;
    if (!ensure()) return;
    const { f = 440, f2 = null, dur = 0.1, type = 'square', vol = 0.2, delay = 0 } = o;
    try {
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t0);
      if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* ignore */ }
  }

  function noise(o) {
    if (muted) return;
    if (!ensure()) return;
    const { dur = 0.1, vol = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0 } = o;
    try {
      const t0 = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = getNoise();
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t0);
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  return {
    unlock() { ensure(); },
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.42;
      return muted;
    },

    shoot(id) {
      ensure();
      if (id === 'sonic') {
        noise({ dur: 0.24, vol: 0.34, freq: 420, q: 0.8, type: 'lowpass' });
        tone({ f: 150, f2: 42, dur: 0.26, type: 'sawtooth', vol: 0.24 });
        tone({ f: 88, f2: 30, dur: 0.3, type: 'sine', vol: 0.2 });
      } else if (id === 'laser') {
        tone({ f: 2400, f2: 420, dur: 0.22, type: 'sawtooth', vol: 0.11 });
        tone({ f: 1200, f2: 260, dur: 0.18, type: 'square', vol: 0.07 });
        noise({ dur: 0.08, vol: 0.12, freq: 4200, q: 2.5 });
      } else if (id === 'thermal') {
        tone({ f: 210, f2: 78, dur: 0.2, type: 'sawtooth', vol: 0.16 });
        noise({ dur: 0.22, vol: 0.16, freq: 700, q: 0.9, type: 'lowpass' });
      } else if (id === 'kinetic') {
        noise({ dur: 0.09, vol: 0.24, freq: 1500, q: 0.7, type: 'highpass' });
        tone({ f: 620, f2: 180, dur: 0.07, type: 'square', vol: 0.16 });
      } else if (id === 'voltaic') {
        tone({ f: 900, f2: 220, dur: 0.12, type: 'sawtooth', vol: 0.12 });
        noise({ dur: 0.1, vol: 0.12, freq: 4200, q: 3 });
      }
    },

    hit() {
      noise({ dur: 0.055, vol: 0.14, freq: 2200, q: 1.4 });
    },
    kill() {
      noise({ dur: 0.18, vol: 0.16, freq: 300, q: 0.7, type: 'lowpass' });
      tone({ f: 240, f2: 50, dur: 0.2, type: 'square', vol: 0.1 });
    },
    pickup() {
      tone({ f: 660, dur: 0.06, type: 'triangle', vol: 0.12 });
      tone({ f: 990, dur: 0.09, type: 'triangle', vol: 0.1, delay: 0.05 });
    },
    ui() {
      tone({ f: 1200, dur: 0.03, type: 'square', vol: 0.05 });
    },
    dry() {
      tone({ f: 240, dur: 0.04, type: 'square', vol: 0.08 });
      noise({ dur: 0.04, vol: 0.06, freq: 900, q: 2 });
    },
    reloadStart() {
      noise({ dur: 0.04, vol: 0.1, freq: 1400, q: 2 });
    },
    reloadDone() {
      noise({ dur: 0.04, vol: 0.12, freq: 1100, q: 2 });
      noise({ dur: 0.05, vol: 0.12, freq: 720, q: 2, delay: 0.09 });
    },
    hurt() {
      tone({ f: 140, f2: 60, dur: 0.16, type: 'sine', vol: 0.26 });
      noise({ dur: 0.12, vol: 0.14, freq: 480, q: 0.8, type: 'lowpass' });
    },
    die() {
      tone({ f: 300, f2: 30, dur: 0.9, type: 'sawtooth', vol: 0.22 });
      noise({ dur: 0.7, vol: 0.16, freq: 260, q: 0.6, type: 'lowpass' });
    },
    extract() {
      tone({ f: 220, f2: 660, dur: 0.5, type: 'sine', vol: 0.14 });
      tone({ f: 330, f2: 990, dur: 0.6, type: 'triangle', vol: 0.08, delay: 0.12 });
    },
    heal() {
      tone({ f: 420, f2: 840, dur: 0.32, type: 'sine', vol: 0.13 });
      tone({ f: 620, dur: 0.2, type: 'triangle', vol: 0.07, delay: 0.16 });
    },
    data() {
      tone({ f: 880, dur: 0.05, type: 'sine', vol: 0.08 });
      tone({ f: 1320, dur: 0.07, type: 'sine', vol: 0.06, delay: 0.04 });
    },
    laserHit() {
      tone({ f: 1700, dur: 0.03, type: 'square', vol: 0.05 });
    },
    boom() {
      noise({ dur: 0.4, vol: 0.24, freq: 220, q: 0.6, type: 'lowpass' });
      tone({ f: 90, f2: 34, dur: 0.45, type: 'sine', vol: 0.24 });
    }
  };
})();
