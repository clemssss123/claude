'use strict';
/* Hank and the Hush: shared constants, helpers, input and save data. */

const T = 32;                // tile size, in logical pixels
const VW = 960, VH = 540;    // logical screen size
const STEP = 1 / 120;        // fixed simulation step

const PHYS = {
  grav: 2000, maxFall: 900,
  run: 240, accelGround: 2600, accelAir: 1700, friction: 2800, airDrag: 500,
  iceAccel: 750, iceFriction: 380,
  jump: 660, jumpCut: 0.45,
  coyote: 0.1, buffer: 0.13,
  hoverFall: 70, hoverTime: 1.25,
  dashSpeed: 640, dashTime: 0.16, dashCooldown: 0.42,
  spring: 1150, stompBounce: 430, stompBounceHeld: 650,
  climb: 150,
};

const FONT = 'Bungee, "Arial Black", Impact, sans-serif';
const BODY = '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, target, d) => (v < target ? Math.min(v + d, target) : Math.max(v - d, target));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function hash2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}

function bits(n) {
  let c = 0;
  for (; n; n &= n - 1) c++;
  return c;
}

const reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------- Input: keyboard, gamepad, touch buttons and pointer ---------- */

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  KeyX: 'hammer', KeyJ: 'hammer',
  ShiftLeft: 'dash', ShiftRight: 'dash', KeyC: 'dash', KeyL: 'dash',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm', NumpadEnter: 'confirm',
  Backspace: 'back', KeyM: 'mute',
};
const ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'hammer', 'dash', 'pause', 'confirm', 'back', 'mute'];

const Input = {
  keys: new Set(),
  tapped: {},
  touch: {},
  cur: {},
  edge: {},
  padPrev: {},
  pointer: { x: 0, y: 0, tapped: false, click: false, moved: false, hover: false },
  usingTouch: false,

  init(canvas, touchEl) {
    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const a = KEYMAP[e.code];
      if (a) {
        e.preventDefault();
        if (!this.keys.has(e.code)) this.tapped[a] = true;
      }
      this.keys.add(e.code);
      if (this.usingTouch) this.setTouch(false);
      Sound.unlock();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touch = {}; });

    const toLogical = e => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * VW, y: ((e.clientY - r.top) / r.height) * VH };
    };
    canvas.addEventListener('pointerdown', e => {
      const p = toLogical(e);
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.tapped = true;
      this.setTouch(e.pointerType === 'touch');
      Sound.unlock();
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const p = toLogical(e);
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.moved = true;
    });

    for (const b of touchEl.querySelectorAll('button')) {
      const act = b.dataset.act;
      const on = e => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
        if (!this.touch[act]) this.tapped[act] = true;
        this.touch[act] = true;
        b.classList.add('on');
        Sound.unlock();
      };
      const off = e => {
        e.preventDefault();
        this.touch[act] = false;
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
  },

  setTouch(on) {
    this.usingTouch = on;
  },

  pollPad(cur) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = i => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (ax < -0.45 || b(14)) cur.left = true;
      if (ax > 0.45 || b(15)) cur.right = true;
      if (ay < -0.55 || b(12)) cur.up = true;
      if (ay > 0.55 || b(13)) cur.down = true;
      if (b(0)) cur.jump = true;
      if (b(2) || b(3)) cur.hammer = true;
      if (b(1) || b(5) || b(7)) cur.dash = true;
      if (b(9)) cur.pause = true;
      if (b(8)) cur.back = true;
    }
  },

  poll() {
    const cur = {};
    for (const code of this.keys) {
      const a = KEYMAP[code];
      if (a) cur[a] = true;
    }
    for (const a in this.touch) if (this.touch[a]) cur[a] = true;
    this.pollPad(cur);
    const edge = {};
    for (const a of ACTIONS) edge[a] = !!((cur[a] && !this.cur[a]) || this.tapped[a]);
    this.cur = cur;
    this.edge = edge;
    this.tapped = {};
    this.pointer.click = this.pointer.tapped;
    this.pointer.tapped = false;
    this.pointer.hover = this.pointer.moved;
    this.pointer.moved = false;
  },

  held(a) { return !!this.cur[a]; },
  pressed(a) { return !!this.edge[a]; },
  confirm() { return this.pressed('confirm') || this.pressed('jump'); },
  back() { return this.pressed('pause') || this.pressed('back'); },
};

/* ---------- Save data (per browser; the game works without it) ---------- */

const SAVE_KEY = 'hank-and-the-hush/v1';

const Save = {
  data: null,
  fresh() {
    return {
      unlocked: 0, levels: {}, music: 0.6, sfx: 0.8, touch: 'auto', shake: true,
      seenIntro: false, deaths: 0, beaten: false, playTime: 0, gifts: {},
    };
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { d = null; }
    this.data = Object.assign(this.fresh(), d && typeof d === 'object' ? d : {});
  },
  write() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* storage blocked: progress lasts this session */ }
  },
  reset() {
    const keep = { music: this.data.music, sfx: this.data.sfx, touch: this.data.touch, shake: this.data.shake };
    this.data = Object.assign(this.fresh(), keep);
    this.write();
  },
  level(id) {
    return this.data.levels[id] || { done: false, h: 0, s: 0, best: 0 };
  },
  setLevel(id, rec) {
    this.data.levels[id] = rec;
  },
};
