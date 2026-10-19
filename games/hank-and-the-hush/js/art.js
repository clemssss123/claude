'use strict';
/* Everything that gets drawn: world palettes, tiles, parallax backdrops and the cast.
   No image files; it is all canvas paths. */

const THEMES = {
  hills: {
    sky: ['#3f9fd8', '#c4ecf0'], ground: '#7a4b32', groundDark: '#5c3624', edge: '#3a2015',
    top: '#78d35c', topDark: '#3f9a3c', plank: '#b67a48', plankDark: '#74462a', ladder: '#c58b55',
    spike: '#eef1f7', pattern: 'dirt', cap: 'grass', far: '#93d2b2', mid: '#5aae7d', near: '#3f8e60', mover: '#b67a48',
  },
  harbor: {
    sky: ['#f2875e', '#ffdca4'], ground: '#6f7f91', groundDark: '#55636f', edge: '#323c47',
    top: '#aebccb', topDark: '#7f8d9b', plank: '#a06d44', plankDark: '#64401f', ladder: '#b98a5a',
    spike: '#eef1f7', pattern: 'stone', cap: 'stone', far: '#c97a74', mid: '#2f6f9f', near: '#215b86', water: '#2c80bd', mover: '#a06d44',
  },
  haunted: {
    sky: ['#1a1026', '#3b2452'], ground: '#4a3762', groundDark: '#36274b', edge: '#1b112d',
    top: '#77629c', topDark: '#4e3c6c', plank: '#7a5038', plankDark: '#43291b', ladder: '#8f6748',
    spike: '#d8d1f0', pattern: 'brick', cap: 'trim', far: '#2a1c3c', mid: '#3a2852', near: '#24183a', interior: true, mover: '#7a5038',
  },
  hive: {
    sky: ['#f39a1f', '#ffd96a'], ground: '#cf7d16', groundDark: '#a65b0c', edge: '#6a3604',
    top: '#ffd257', topDark: '#e8a222', plank: '#8a5418', plankDark: '#5b3410', ladder: '#9a6020',
    spike: '#3a2a10', pattern: 'hex', cap: 'honey', far: '#f7b53b', mid: '#e8952a', near: '#c97418', mover: '#e8a222',
  },
  heights: {
    sky: ['#142a57', '#86addf'], ground: '#5c6c8a', groundDark: '#435069', edge: '#262e43',
    top: '#f2f8ff', topDark: '#bcd6ef', plank: '#7b5a3f', plankDark: '#4e3826', ladder: '#9b7553',
    spike: '#dceeff', pattern: 'rock', cap: 'snow', far: '#5674a6', mid: '#3a527e', near: '#2b3d60', ice: true, snow: true, mover: '#cfe6fb',
  },
  hush: {
    sky: ['#0f0f15', '#2b2a35'], ground: '#3b3a46', groundDark: '#2b2a34', edge: '#141319',
    top: '#5b5a68', topDark: '#44434f', plank: '#55546a', plankDark: '#33323c', ladder: '#5b5a68',
    spike: '#9a99a8', pattern: 'stone', cap: 'stone', far: '#1d1d26', mid: '#26252f', near: '#1a1a22', mover: '#55546a',
  },
};

const INK = '#1b1626';
const GOLD = '#ffc83d', GOLD_DARK = '#c47f00', GOLD_LIGHT = '#fff1b8';
const HANK = '#ff5b3a', HANK_DARK = '#9e2a14';

function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}

function text(c, str, x, y, size, color, align = 'left', font = FONT, base = 'alphabetic') {
  c.font = `${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillStyle = color;
  c.fillText(str, x, y);
}

function outlined(c, str, x, y, size, color, stroke, lw = 6, align = 'center', font = FONT) {
  c.font = `${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  c.lineWidth = lw;
  c.strokeStyle = stroke;
  c.strokeText(str, x, y);
  c.fillStyle = color;
  c.fillText(str, x, y);
}

/* ---------- Tiles ---------- */

const isSolidCh = ch => ch === '#';

function drawSolid(c, st, tx, ty, th) {
  const x = tx * T, y = ty * T;
  const at = (dx, dy) => st.tileAt(tx + dx, ty + dy);
  c.fillStyle = th.ground;
  c.fillRect(x, y, T, T);
  c.fillStyle = th.groundDark;
  const r1 = hash2(tx, ty), r2 = hash2(ty + 31, tx + 7), r3 = hash2(tx * 3 + 1, ty * 5 + 2);
  switch (th.pattern) {
    case 'dirt':
      rrect(c, x + 4 + r1 * 18, y + 6 + r2 * 18, 5, 3, 1.5); c.fill();
      rrect(c, x + 18 - r2 * 10, y + 20 - r3 * 10, 4, 3, 1.5); c.fill();
      if (r3 > 0.6) { c.fillStyle = th.topDark; c.globalAlpha = 0.25; rrect(c, x + 8 + r3 * 12, y + 12, 6, 4, 2); c.fill(); c.globalAlpha = 1; }
      break;
    case 'stone': {
      c.fillRect(x, y + 15, T, 2);
      const off = ty % 2 ? 6 : 22;
      c.fillRect(x + off, y, 2, 15);
      c.fillRect(x + ((off + 16) % 32), y + 17, 2, 15);
      c.globalAlpha = 0.18; c.fillStyle = '#fff';
      c.fillRect(x + 2, y + 1, 10 + r1 * 12, 2);
      c.globalAlpha = 1;
      break;
    }
    case 'brick':
      for (let row = 0; row < 3; row++) {
        const by = y + row * 11;
        c.fillRect(x, by + 9, T, 2);
        const o = (row + ty) % 2 ? 0 : 10;
        c.fillRect(x + o, by, 2, 9);
        c.fillRect(x + o + 20, by, 2, 9);
      }
      break;
    case 'hex': {
      const cx = x + 16, cy = y + 16, rad = 12;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      c.closePath();
      c.lineWidth = 3; c.strokeStyle = th.groundDark; c.stroke();
      if (r1 > 0.55) { c.fillStyle = th.top; c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1; }
      break;
    }
    case 'rock':
      c.lineWidth = 2; c.strokeStyle = th.groundDark;
      c.beginPath();
      c.moveTo(x + r1 * 20, y + 4); c.lineTo(x + 8 + r1 * 20, y + 14); c.lineTo(x + 4 + r2 * 20, y + 26);
      c.stroke();
      if (r3 > 0.5) { c.fillStyle = '#ffffff22'; c.fillRect(x + 20, y + 8, 6, 4); }
      break;
  }
  const solidish = ch => ch === '#' || ch === 'B' || ch === 'D';
  c.fillStyle = th.edge;
  if (!solidish(at(-1, 0))) c.fillRect(x, y, 2, T);
  if (!solidish(at(1, 0))) c.fillRect(x + T - 2, y, 2, T);
  if (!solidish(at(0, 1)) && ty < st.h - 1) c.fillRect(x, y + T - 2, T, 2);
  if (at(0, -1) !== '#' && ty > 0) drawCap(c, x, y, th, tx, ty, !solidish(at(-1, 0)), !solidish(at(1, 0)));
}

function drawCap(c, x, y, th, tx, ty, openL, openR) {
  const r = hash2(tx * 7, ty * 13);
  switch (th.cap) {
    case 'grass':
      c.fillStyle = th.topDark;
      c.fillRect(x, y, T, 10);
      c.fillStyle = th.top;
      c.fillRect(x, y, T, 7);
      for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(x + 4 + i * 8, y + 7, 4, 0, Math.PI); c.fill(); }
      if (r > 0.7) { c.fillStyle = '#ffe36b'; c.beginPath(); c.arc(x + 8 + r * 14, y - 2, 2.5, 0, 7); c.fill(); }
      if (openL) { c.fillStyle = th.top; c.beginPath(); c.arc(x + 1, y + 5, 5, 0, 7); c.fill(); }
      if (openR) { c.fillStyle = th.top; c.beginPath(); c.arc(x + T - 1, y + 5, 5, 0, 7); c.fill(); }
      break;
    case 'stone':
      c.fillStyle = th.top; c.fillRect(x, y, T, 6);
      c.fillStyle = '#ffffff30'; c.fillRect(x, y, T, 2);
      break;
    case 'trim':
      c.fillStyle = th.top; c.fillRect(x, y, T, 6);
      c.fillStyle = th.topDark; c.fillRect(x, y + 6, T, 2);
      c.fillStyle = '#ffffff22'; c.fillRect(x + 6, y + 2, 4, 2); c.fillRect(x + 22, y + 2, 4, 2);
      break;
    case 'honey':
      c.fillStyle = th.top; c.fillRect(x, y, T, 6);
      if (r > 0.45) { rrect(c, x + 6 + r * 16, y + 4, 6, 8 + r * 8, 3); c.fill(); }
      c.fillStyle = '#ffffff40'; c.fillRect(x + 2, y + 1, 12, 2);
      break;
    case 'snow':
      c.fillStyle = th.topDark; c.fillRect(x, y + 4, T, 6);
      c.fillStyle = th.top; c.fillRect(x, y, T, 7);
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x + 6 + i * 10, y + 6, 4 + ((r * 10 + i) % 2), 0, Math.PI); c.fill(); }
      if (r > 0.6) { c.fillStyle = '#dff1ff'; c.beginPath(); c.moveTo(x + 10, y + 9); c.lineTo(x + 13, y + 17); c.lineTo(x + 16, y + 9); c.fill(); }
      break;
  }
}

function drawStaticTile(c, st, tx, ty, ch, th) {
  const x = tx * T, y = ty * T;
  switch (ch) {
    case '#': drawSolid(c, st, tx, ty, th); break;
    case '=':
      c.fillStyle = th.plankDark; c.fillRect(x, y + 6, T, 5);
      c.fillStyle = th.plank; c.fillRect(x, y, T, 8);
      c.fillStyle = '#ffffff28'; c.fillRect(x, y, T, 2);
      c.fillStyle = th.plankDark; c.fillRect(x + T - 1, y, 1, 10);
      c.fillRect(x + 4, y + 3, 2, 2); c.fillRect(x + T - 7, y + 3, 2, 2);
      if (st.tileAt(tx - 1, ty) !== '=') { c.fillRect(x + 3, y + 11, 4, 6); }
      if (st.tileAt(tx + 1, ty) !== '=') { c.fillRect(x + T - 7, y + 11, 4, 6); }
      break;
    case 'L': {
      // a ladder is a stack of capital H's
      c.fillStyle = th.ladder;
      c.fillRect(x + 6, y, 5, T);
      c.fillRect(x + T - 11, y, 5, T);
      c.fillRect(x + 6, y + 13, T - 12, 5);
      c.fillStyle = '#00000033';
      c.fillRect(x + 9, y, 2, T);
      c.fillRect(x + T - 8, y, 2, T);
      c.fillRect(x + 6, y + 16, T - 12, 2);
      break;
    }
    case '^':
      c.fillStyle = th.spike; c.strokeStyle = th.edge; c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        c.moveTo(x + i * 8, y + T);
        c.lineTo(x + i * 8 + 4, y + T - 17);
        c.lineTo(x + i * 8 + 8, y + T);
      }
      c.fill(); c.stroke();
      break;
  }
}

function drawDynamicTile(c, st, tx, ty, ch, th, t) {
  const x = tx * T, y = ty * T;
  switch (ch) {
    case 'B': {
      c.fillStyle = '#b8643c'; c.fillRect(x, y, T, T);
      c.fillStyle = '#8a4426';
      c.fillRect(x, y + 10, T, 2); c.fillRect(x, y + 21, T, 2);
      c.fillRect(x + 14, y, 2, 10); c.fillRect(x + 6, y + 12, 2, 9); c.fillRect(x + 24, y + 12, 2, 9); c.fillRect(x + 16, y + 23, 2, 9);
      c.strokeStyle = '#5a2614'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x + 20, y + 3); c.lineTo(x + 17, y + 9); c.lineTo(x + 22, y + 15); c.lineTo(x + 19, y + 20); c.stroke();
      c.fillStyle = '#ffffff30'; c.fillRect(x, y, T, 2);
      c.strokeStyle = '#4a1f10'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, T - 2, T - 2);
      break;
    }
    case 'D': {
      c.fillStyle = '#5d7896'; c.fillRect(x, y, T, T);
      c.fillStyle = '#7f9ab8'; c.fillRect(x, y, T, 3); c.fillRect(x, y, 3, T);
      c.fillStyle = '#3e536b'; c.fillRect(x, y + T - 3, T, 3); c.fillRect(x + T - 3, y, 3, T);
      c.fillStyle = '#c9d8ea';
      for (const [px, py] of [[6, 6], [T - 8, 6], [6, T - 8], [T - 8, T - 8]]) c.fillRect(x + px, y + py, 2, 2);
      c.strokeStyle = '#e8f1fb'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x + 10, y + 10); c.lineTo(x + 15, y + 16); c.lineTo(x + 10, y + 22);
      c.moveTo(x + 17, y + 10); c.lineTo(x + 22, y + 16); c.lineTo(x + 17, y + 22);
      c.stroke(); c.lineCap = 'butt';
      break;
    }
    case 'X': {
      const s = st.crumbleState(tx, ty);
      if (s.gone) {
        c.globalAlpha = 0.25; c.strokeStyle = th.plank; c.setLineDash([4, 4]); c.lineWidth = 2;
        c.strokeRect(x + 1, y + 1, T - 2, 8); c.setLineDash([]); c.globalAlpha = 1;
        break;
      }
      const jx = s.shake > 0 ? Math.sin(t * 90 + tx) * 1.6 : 0;
      c.fillStyle = th.plankDark; c.fillRect(x + jx, y + 6, T, 5);
      c.fillStyle = '#8b7a62'; c.fillRect(x + jx, y, T, 8);
      c.strokeStyle = '#4b3a28'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x + jx + 8, y); c.lineTo(x + jx + 12, y + 5); c.lineTo(x + jx + 9, y + 9);
      c.moveTo(x + jx + 23, y + 1); c.lineTo(x + jx + 20, y + 7); c.stroke();
      break;
    }
    case 'J': {
      const sq = st.springSquash(tx, ty);
      const top = y + 10 + sq * 8;
      c.fillStyle = '#4a4a5a'; c.fillRect(x + 3, y + T - 6, T - 6, 6);
      c.strokeStyle = '#c8ccd8'; c.lineWidth = 3;
      c.beginPath();
      const n = 4, h = y + T - 6 - top;
      c.moveTo(x + 9, y + T - 6);
      for (let i = 1; i <= n; i++) c.lineTo(x + (i % 2 ? 23 : 9), y + T - 6 - (h * i) / n);
      c.stroke();
      c.fillStyle = HANK; rrect(c, x + 1, top - 6, T - 2, 8, 3); c.fill();
      c.fillStyle = '#ffffff55'; c.fillRect(x + 4, top - 5, T - 8, 2);
      break;
    }
  }
}

function drawWaterTile(c, st, tx, ty, th, t) {
  const x = tx * T, y = ty * T;
  const surface = st.tileAt(tx, ty - 1) !== '~';
  c.fillStyle = th.water || '#2c80bd';
  c.globalAlpha = 0.78;
  if (surface) {
    c.beginPath();
    c.moveTo(x, y + T);
    for (let i = 0; i <= 8; i++) {
      const px = x + i * 4;
      c.lineTo(px, y + 6 + Math.sin(px * 0.09 + t * 3) * 2.5);
    }
    c.lineTo(x + T, y + T);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.9;
    c.fillStyle = '#bfe6ff';
    c.fillRect(x + ((t * 20 + tx * 11) % T), y + 6 + Math.sin(t * 3 + tx) * 2, 6, 2);
  } else {
    c.fillRect(x, y, T, T);
  }
  c.globalAlpha = 1;
}

/* ---------- Backdrops: pre-rendered parallax strips that wrap every 1024px ---------- */

const BACKDROPS = {};
function getBackdrop(name) {
  return BACKDROPS[name] || (BACKDROPS[name] = makeBackdrop(name));
}

function makeBackdrop(name) {
  const th = THEMES[name];
  const LW = 1024;
  const r = rng(name.length * 977 + name.charCodeAt(0));
  const layers = [];
  const layer = (h, f, y, paint) => {
    const cv = document.createElement('canvas');
    cv.width = LW; cv.height = h;
    const g = cv.getContext('2d');
    paint(g, h);
    layers.push({ cv, f, y });
  };
  const wave = (g, h, base, amp, k, color, phase = 0) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= LW; x += 8) {
      const a = (x / LW) * Math.PI * 2;
      g.lineTo(x, base - amp * Math.sin(a * k + phase) - amp * 0.4 * Math.sin(a * (k * 2 + 1) + phase * 2));
    }
    g.lineTo(LW, h);
    g.closePath();
    g.fill();
  };
  const wrapDraw = (x, w, fn) => { fn(x); if (x + w > LW) fn(x - LW); if (x < 0) fn(x + LW); };

  if (name === 'hills') {
    layer(260, 0.12, VH - 300, (g, h) => {
      wave(g, h, 140, 34, 2, th.far, 0.5);
      for (let i = 0; i < 7; i++) {
        const hx = (i / 7) * LW + r() * 60;
        const hy = 140 - 34 * Math.sin((hx / LW) * Math.PI * 4 + 0.5) - 8;
        wrapDraw(hx, 30, x => {
          g.fillStyle = '#e9f5ee'; g.fillRect(x, hy - 14, 18, 14);
          g.fillStyle = '#d06a4a'; g.beginPath(); g.moveTo(x - 3, hy - 13); g.lineTo(x + 9, hy - 23); g.lineTo(x + 21, hy - 13); g.fill();
          g.fillStyle = '#6aa58a'; g.fillRect(x + 7, hy - 8, 4, 8);
        });
      }
    });
    layer(220, 0.32, VH - 200, (g, h) => {
      wave(g, h, 120, 40, 3, th.mid, 2);
      for (let i = 0; i < 16; i++) {
        const tx = r() * LW;
        const ty = 120 - 40 * Math.sin((tx / LW) * Math.PI * 6 + 2) - 4;
        wrapDraw(tx, 30, x => {
          g.fillStyle = '#5b3a29'; g.fillRect(x - 2, ty - 16, 4, 16);
          g.fillStyle = th.near; g.beginPath(); g.arc(x, ty - 22, 12 + (i % 3) * 3, 0, 7); g.fill();
        });
      }
    });
  } else if (name === 'harbor') {
    layer(200, 0.08, VH - 290, (g, h) => {
      wave(g, h, 150, 18, 2, th.far, 1);
      wrapDraw(700, 40, x => {
        g.fillStyle = '#f6efe1'; g.fillRect(x, 40, 16, 100);
        g.fillStyle = '#d64c3a'; for (let i = 0; i < 4; i++) g.fillRect(x, 50 + i * 24, 16, 10);
        g.fillStyle = '#3b3b46'; g.fillRect(x - 3, 30, 22, 12);
      });
    });
    layer(240, 0.25, VH - 240, (g, h) => {
      g.fillStyle = th.mid; g.fillRect(0, 60, LW, h);
      g.fillStyle = '#ffffff35';
      for (let i = 0; i < 60; i++) { const x = r() * LW, y = 70 + r() * 160; g.fillRect(x, y, 10 + r() * 30, 2); }
      for (let i = 0; i < 3; i++) {
        const bx = 150 + i * 330 + r() * 60;
        wrapDraw(bx, 70, x => {
          g.fillStyle = '#5a3b26'; g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 60, 64); g.lineTo(x + 50, 76); g.lineTo(x + 10, 76); g.fill();
          g.fillStyle = '#f7f0e3'; g.beginPath(); g.moveTo(x + 30, 10); g.lineTo(x + 30, 60); g.lineTo(x + 56, 60); g.fill();
          g.fillStyle = '#e8d9bf'; g.beginPath(); g.moveTo(x + 28, 20); g.lineTo(x + 28, 60); g.lineTo(x + 8, 60); g.fill();
        });
      }
    });
  } else if (name === 'haunted') {
    layer(VH, 0.3, 0, (g, h) => {
      g.fillStyle = th.sky[1]; g.fillRect(0, 0, LW, h);
      for (let x = 0; x < LW; x += 64) { g.fillStyle = '#ffffff08'; g.fillRect(x, 0, 32, h); }
      g.fillStyle = '#00000022';
      for (let y = 20; y < h; y += 48) for (let x = 0; x < LW; x += 64) {
        g.beginPath(); g.moveTo(x + 32, y); g.lineTo(x + 40, y + 10); g.lineTo(x + 32, y + 20); g.lineTo(x + 24, y + 10); g.fill();
      }
      for (let i = 0; i < 4; i++) {
        const wx = 60 + i * 256;
        g.fillStyle = '#120a1c'; rrect(g, wx - 6, 96, 92, 156, [46, 46, 4, 4]); g.fill();
        g.fillStyle = '#2c4a7a'; rrect(g, wx, 102, 80, 144, [40, 40, 2, 2]); g.fill();
        g.fillStyle = '#f2ecc8'; g.beginPath(); g.arc(wx + 52, 140, 16, 0, 7); g.fill();
        g.fillStyle = '#120a1c'; g.fillRect(wx + 38, 102, 4, 144); g.fillRect(wx, 170, 80, 4);
        const px = wx + 150;
        g.fillStyle = '#8a6a2a'; g.fillRect(px - 6, 130, 64, 80);
        g.fillStyle = '#2a1f33'; g.fillRect(px, 136, 52, 68);
        g.fillStyle = '#6b5a7a'; g.fillRect(px + 10, 150, 9, 40); g.fillRect(px + 33, 150, 9, 40); g.fillRect(px + 10, 166, 32, 8);
      }
    });
  } else if (name === 'hive') {
    layer(VH, 0.22, 0, (g, h) => {
      g.lineWidth = 4;
      const R = 34, dx = R * Math.sqrt(3), dy = R * 1.5;
      const cols = Math.round(LW / dx);
      const step = LW / cols;
      for (let row = -1; row < h / dy + 1; row++) {
        for (let col = -1; col <= cols; col++) {
          const cx = col * step + (row % 2 ? step / 2 : 0), cy = row * dy;
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (i * Math.PI) / 3;
            g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3));
          }
          g.closePath();
          const v = hash2(col + 50, row + 50);
          g.fillStyle = v > 0.72 ? '#ffd45e' : v > 0.4 ? th.far : '#f0a83a';
          g.fill();
          g.strokeStyle = th.mid; g.stroke();
        }
      }
    });
  } else if (name === 'heights') {
    layer(300, 0.08, VH - 330, (g, h) => {
      for (let i = 0; i < 9; i++) {
        const px = (i / 9) * LW + r() * 40, ph = 120 + r() * 130, pw = 120 + r() * 80;
        wrapDraw(px - pw, pw * 2, x0 => {
          const x = x0 + pw;
          g.fillStyle = th.far; g.beginPath(); g.moveTo(x - pw, h); g.lineTo(x, h - ph); g.lineTo(x + pw, h); g.fill();
          g.fillStyle = '#e9f3ff'; g.beginPath(); g.moveTo(x - pw * 0.28, h - ph * 0.72); g.lineTo(x, h - ph); g.lineTo(x + pw * 0.28, h - ph * 0.72);
          g.lineTo(x + pw * 0.1, h - ph * 0.66); g.lineTo(x, h - ph * 0.74); g.lineTo(x - pw * 0.12, h - ph * 0.65); g.fill();
        });
      }
    });
    layer(220, 0.25, VH - 210, (g, h) => wave(g, h, 110, 50, 3, th.mid, 1.3));
  } else if (name === 'hush') {
    layer(VH, 0.15, 0, (g, h) => {
      g.font = '160px ' + FONT;
      g.fillStyle = '#ffffff07';
      g.textBaseline = 'middle';
      for (let i = 0; i < 4; i++) g.fillText('shh', i * 280 - 40, 140 + (i % 2) * 220);
    });
  }

  let grad = null, gradCtx = null;
  return {
    th,
    draw(c, camx, camy, t, levelPxH) {
      if (!grad || gradCtx !== c) {
        grad = c.createLinearGradient(0, 0, 0, VH);
        grad.addColorStop(0, th.sky[0]);
        grad.addColorStop(1, th.sky[1]);
        gradCtx = c;
      }
      c.fillStyle = grad;
      c.fillRect(0, 0, VW, VH);
      const lift = Math.max(0, levelPxH - VH - camy);
      if (name === 'hills') {
        c.fillStyle = '#fff4c4'; c.globalAlpha = 0.9; c.beginPath(); c.arc(780, 90, 38, 0, 7); c.fill(); c.globalAlpha = 1;
        drawClouds(c, camx, t, '#ffffff', 0.85);
      } else if (name === 'harbor') {
        c.fillStyle = '#fff0c2'; c.beginPath(); c.arc(640, 250, 70, 0, 7); c.fill();
        drawClouds(c, camx, t, '#ffe6cc', 0.6);
      } else if (name === 'heights') {
        for (let i = 0; i < 70; i++) {
          const sx = ((hash2(i, 3) * 1400 - camx * 0.02) % 1400 + 1400) % 1400 - 200;
          const sy = hash2(i, 9) * 420 + lift * 0.05 - 40;
          c.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i));
          c.fillStyle = '#fff'; c.fillRect(sx, sy, 2, 2);
        }
        c.globalAlpha = 1;
      }
      for (const L of layers) {
        const off = -(((camx * L.f) % LW) + LW) % LW;
        const yo = Math.round(L.y + lift * L.f * 0.7);
        if (yo > VH) continue;
        for (let x = off; x < VW; x += LW) c.drawImage(L.cv, Math.round(x), yo);
      }
      if (name === 'harbor') {
        c.fillStyle = '#fff6a8';
        c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2);
        const lx = 700 - ((camx * 0.08) % 1024) + 8;
        c.beginPath(); c.arc(lx, VH - 290 + 36, 6, 0, 7); c.fill(); c.globalAlpha = 1;
      }
    },
  };
}

function drawClouds(c, camx, t, color, alpha) {
  c.fillStyle = color;
  c.globalAlpha = alpha;
  for (let i = 0; i < 6; i++) {
    const w = 1400;
    const x = ((hash2(i, 1) * w - camx * 0.05 - t * (6 + i * 2)) % w + w) % w - 200;
    const y = 40 + hash2(i, 2) * 140;
    const s = 0.7 + hash2(i, 4) * 0.7;
    c.beginPath();
    c.arc(x, y, 22 * s, 0, 7); c.arc(x + 24 * s, y - 10 * s, 26 * s, 0, 7); c.arc(x + 52 * s, y, 20 * s, 0, 7);
    c.rect(x, y, 52 * s, 20 * s);
    c.fill();
  }
  c.globalAlpha = 1;
}

/* ---------- Hank: a lowercase h with legs ---------- */

function hankPath(c) {
  c.beginPath();
  c.moveTo(-12, -2);
  c.lineTo(-12, -33);
  c.quadraticCurveTo(-12, -37, -8, -37);
  c.lineTo(-6, -37);
  c.quadraticCurveTo(-2, -37, -2, -33);
  c.lineTo(-2, -21);
  c.bezierCurveTo(0, -24, 4, -25, 6, -25);
  c.bezierCurveTo(10, -25, 12, -21, 12, -16);
  c.lineTo(12, -2);
  c.lineTo(4, -2);
  c.lineTo(4, -15);
  c.bezierCurveTo(4, -17, 2, -18, 0.5, -17);
  c.bezierCurveTo(-1, -16.5, -2, -15, -2, -13);
  c.lineTo(-2, -2);
  c.closePath();
}

function drawHank(c, x, y, o = {}) {
  c.save();
  c.translate(x, y);
  const face = o.face < 0 ? -1 : 1;
  c.scale(face * (o.sqx || 1), o.sqy || 1);
  const t = o.t || 0;
  const run = o.run || 0;
  const ph = t * 16;
  let f1 = 0, f2 = 0;
  if (o.climb) { f1 = Math.sin(t * 12) * 3; f2 = -f1; }
  else if (o.air) { f1 = -3; f2 = 1; }
  else { f1 = Math.sin(ph) * 3 * run; f2 = -Math.sin(ph) * 3 * run; }
  // hammer drawn behind the body while winding up
  if (o.hammer != null && o.hammer < 0.35) drawHammer(c, o.hammer);
  // feet
  c.fillStyle = '#2b1810';
  c.beginPath(); c.ellipse(-7 + f1, -2 + Math.min(0, f1) * 0.5, 6, 3.2, 0, 0, 7); c.fill();
  c.beginPath(); c.ellipse(8 + f2, -2 + Math.min(0, f2) * 0.5, 6, 3.2, 0, 0, 7); c.fill();
  // body
  c.translate(0, -2);
  hankPath(c);
  c.fillStyle = o.color || HANK;
  c.fill();
  c.lineWidth = 2.5;
  c.lineJoin = 'round';
  c.strokeStyle = o.edge || HANK_DARK;
  c.stroke();
  // highlight
  c.fillStyle = '#ffffff40';
  rrect(c, -10, -33, 2.5, 18, 1.2); c.fill();
  // face on the stem
  const blink = Math.sin(t * 0.9) > 0.985 || o.blink;
  c.fillStyle = '#fff';
  if (blink) {
    c.fillRect(-11, -27, 4, 1.5); c.fillRect(-6, -27, 4, 1.5);
  } else {
    c.beginPath(); c.ellipse(-9, -27, 2.3, 3, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(-4.5, -27, 2.3, 3, 0, 0, 7); c.fill();
    c.fillStyle = INK;
    const look = o.lookUp ? -1 : 0;
    c.beginPath(); c.arc(-8.2, -26.6 + look, 1.3, 0, 7); c.fill();
    c.beginPath(); c.arc(-3.7, -26.6 + look, 1.3, 0, 7); c.fill();
  }
  c.strokeStyle = INK; c.lineWidth = 1.3;
  c.beginPath();
  if (o.hurt) c.arc(-6.5, -20, 1.8, Math.PI, 0);
  else c.arc(-6.5, -22.5, 2, 0.2, Math.PI - 0.2);
  c.stroke();
  // rotor for HOVER
  if (o.rotor) {
    c.fillStyle = '#3a3a48'; c.fillRect(-7.5, -43, 2, 6);
    const w = Math.abs(Math.cos(t * 40)) * 13 + 3;
    c.fillStyle = '#d9dbe6';
    c.beginPath(); c.ellipse(-6.5, -43, w, 2, 0, 0, 7); c.fill();
  }
  c.translate(0, 2);
  if (o.hammer != null && o.hammer >= 0.35) drawHammer(c, o.hammer);
  c.restore();
}

function drawHammer(c, p) {
  // p runs 0..1 over the swing; the hammer pivots at Hank's shoulder
  const a = lerp(-2.4, 1.2, easeOut(p * 1.4));
  c.save();
  c.translate(6, -18);
  c.rotate(a);
  c.fillStyle = '#8a5a34'; c.fillRect(-2, -22, 4, 22);
  c.fillStyle = '#4a4e5e'; rrect(c, -9, -30, 18, 10, 2); c.fill();
  c.fillStyle = GOLD; c.fillRect(-4, -28, 2, 6); c.fillRect(2, -28, 2, 6); c.fillRect(-4, -26, 8, 2);
  c.restore();
}

/* ---------- Collectibles and props ---------- */

function drawGlyphH(c, cx, cy, size, fill, edge, squeeze = 1) {
  const h = size, w = size * 0.82 * squeeze, bar = size * 0.27 * Math.max(0.35, squeeze);
  const x = cx - w / 2, y = cy - h / 2;
  const shape = (ox, oy) => {
    c.beginPath();
    c.rect(x + ox, y + oy, bar, h);
    c.rect(x + w - bar + ox, y + oy, bar, h);
    c.rect(x + ox, cy - bar / 2 + oy, w, bar);
  };
  if (edge) { c.fillStyle = edge; shape(2, 2); c.fill(); }
  c.fillStyle = fill; shape(0, 0); c.fill();
}

function drawGoldH(c, cx, cy, size, t, dim) {
  const sq = Math.max(0.2, Math.abs(Math.cos(t * 2.2)));
  if (!dim) {
    const g = c.createRadialGradient(cx, cy, 2, cx, cy, size);
    g.addColorStop(0, 'rgba(255,220,120,0.55)');
    g.addColorStop(1, 'rgba(255,220,120,0)');
    c.fillStyle = g;
    c.fillRect(cx - size, cy - size, size * 2, size * 2);
  }
  c.globalAlpha = dim ? 0.45 : 1;
  drawGlyphH(c, cx, cy, size, dim ? '#d8d2ff' : GOLD, dim ? '#6e66a8' : GOLD_DARK, sq);
  if (!dim && sq > 0.6) { c.fillStyle = GOLD_LIGHT; c.fillRect(cx - size * 0.41 * sq + 2, cy - size / 2 + 2, 2, size * 0.4); }
  c.globalAlpha = 1;
}

function drawHoney(c, cx, cy, t) {
  const b = Math.sin(t * 3 + cx * 0.1) * 2;
  c.save();
  c.translate(cx, cy + b);
  c.fillStyle = '#e8941a';
  c.beginPath();
  c.moveTo(0, -9);
  c.bezierCurveTo(6, -2, 7, 2, 7, 4);
  c.arc(0, 4, 7, 0, Math.PI);
  c.bezierCurveTo(-7, 2, -6, -2, 0, -9);
  c.fill();
  c.fillStyle = '#ffd36b';
  c.beginPath(); c.ellipse(-2.5, 3, 2, 3, -0.4, 0, 7); c.fill();
  c.restore();
}

function drawHeart(c, cx, cy, s, fill, edge = '#7a1630') {
  c.save();
  c.translate(cx, cy);
  c.scale(s / 16, s / 16);
  c.beginPath();
  c.moveTo(0, 6);
  c.bezierCurveTo(-10, -1, -9, -10, -4, -10);
  c.bezierCurveTo(-1, -10, 0, -7, 0, -6);
  c.bezierCurveTo(0, -7, 1, -10, 4, -10);
  c.bezierCurveTo(9, -10, 10, -1, 0, 6);
  c.closePath();
  c.lineWidth = 2.5;
  c.strokeStyle = edge;
  c.stroke();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (fill && fill !== 'transparent') { c.fillStyle = '#ffffff70'; c.beginPath(); c.ellipse(-4, -5, 2, 1.4, -0.5, 0, 7); c.fill(); }
  c.restore();
}

function drawSignBoard(c, x, y, word, restoredAt, t, now) {
  // x,y: bottom-center of the post
  c.font = '15px ' + FONT;
  const lw = 15;
  const w = word.length * lw + 16, h = 26;
  c.fillStyle = '#5a3a22'; c.fillRect(x - 3, y - 26, 6, 26);
  const bx = x - w / 2, by = y - 26 - h;
  c.fillStyle = '#3a2414'; rrect(c, bx - 2, by - 2, w + 4, h + 4, 5); c.fill();
  c.fillStyle = '#e7cf9d'; rrect(c, bx, by, w, h, 4); c.fill();
  c.fillStyle = '#d4b77f'; c.fillRect(bx + 3, by + h - 6, w - 6, 2);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i < word.length; i++) {
    const lx = bx + 8 + lw * i + lw / 2, ly = by + h / 2 + 1;
    const ch = word[i];
    if (ch === '_') {
      if (restoredAt != null) {
        const k = clamp((now - restoredAt) / 0.35, 0, 1);
        const s = 1 + Math.sin(k * Math.PI) * 0.7;
        c.save(); c.translate(lx, ly); c.scale(s, s);
        c.fillStyle = GOLD_DARK; c.fillText('H', 1, 1);
        c.fillStyle = GOLD; c.fillText('H', 0, 0);
        c.restore();
      } else {
        c.strokeStyle = '#9b7b4c'; c.setLineDash([3, 3]); c.lineWidth = 1.5;
        c.strokeRect(lx - 6, ly - 8, 12, 16);
        c.setLineDash([]);
      }
    } else {
      c.fillStyle = '#3a2414';
      c.fillText(ch, lx, ly);
    }
  }
}

/* ---------- The cast of enemies ---------- */

function drawShush(c, x, y, w, h, t, face, flash) {
  // x,y bottom-center
  c.save();
  c.translate(x, y);
  const sq = 1 + Math.sin(t * 10) * 0.06;
  c.scale(face, 1 / sq);
  c.fillStyle = flash ? '#fff' : '#a49cc4';
  c.strokeStyle = '#5d5677'; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-14, 0);
  c.bezierCurveTo(-15, -18, -8, -24, 0, -24);
  c.bezierCurveTo(8, -24, 15, -18, 14, 0);
  c.closePath();
  c.fill(); c.stroke();
  // sleepy eyes
  c.strokeStyle = INK; c.lineWidth = 1.6;
  c.beginPath(); c.arc(-1, -15, 2.6, 0.1, Math.PI - 0.1); c.stroke();
  c.beginPath(); c.arc(7, -15, 2.6, 0.1, Math.PI - 0.1); c.stroke();
  // finger to the lips
  c.fillStyle = '#f2b7b0'; c.strokeStyle = '#a8706a'; c.lineWidth = 1.2;
  rrect(c, 1.5, -12, 4, 11, 2); c.fill(); c.stroke();
  c.restore();
}

function drawHornet(c, x, y, t, face, flash) {
  c.save();
  c.translate(x, y);
  c.scale(face, 1);
  const wing = Math.abs(Math.sin(t * 40));
  c.fillStyle = 'rgba(235,245,255,0.75)';
  c.beginPath(); c.ellipse(-2, -10, 6, 9 * wing + 1, -0.3, 0, 7); c.fill();
  c.beginPath(); c.ellipse(4, -10, 5, 8 * wing + 1, 0.3, 0, 7); c.fill();
  c.fillStyle = flash ? '#fff' : '#ffcc33';
  c.strokeStyle = '#3a2a10'; c.lineWidth = 1.5;
  c.beginPath(); c.ellipse(0, 0, 13, 8, 0, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#2a2018';
  c.fillRect(-6, -7.5, 3, 15); c.fillRect(-1, -8, 3, 16);
  c.beginPath(); c.arc(11, -2, 5, 0, 7); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(12.5, -3, 1.8, 0, 7); c.fill();
  c.fillStyle = '#2a2018'; c.beginPath(); c.moveTo(-13, -2); c.lineTo(-19, 0); c.lineTo(-13, 2); c.fill();
  c.restore();
}

function drawHedgehog(c, x, y, t, face, flash) {
  c.save();
  c.translate(x, y);
  c.scale(face, 1);
  const step = Math.sin(t * 12) * 1.5;
  c.fillStyle = '#3c271a';
  c.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + 0.25 + (i / 6) * (Math.PI - 0.7);
    const bx = Math.cos(a) * 13 - 2, by = Math.sin(a) * 13 - 6;
    c.moveTo(bx - 3, by + 3);
    c.lineTo(Math.cos(a) * 21 - 2, Math.sin(a) * 21 - 6);
    c.lineTo(bx + 3, by + 3);
  }
  c.fill();
  c.fillStyle = flash ? '#fff' : '#8a5a3c';
  c.beginPath(); c.ellipse(-2, -7, 14, 9, 0, Math.PI, 0); c.lineTo(12, -2); c.lineTo(-16, -2); c.fill();
  c.fillStyle = '#e3b88a';
  c.beginPath(); c.ellipse(9, -6, 7, 5, 0.2, 0, 7); c.fill();
  c.fillStyle = INK;
  c.beginPath(); c.arc(15.5, -7, 2, 0, 7); c.fill();
  c.beginPath(); c.arc(9, -9, 1.5, 0, 7); c.fill();
  c.fillStyle = '#3c271a';
  c.fillRect(-8 + step, -2, 4, 3); c.fillRect(3 - step, -2, 4, 3);
  c.restore();
}

function drawHound(c, x, y, t, face, mode, flash) {
  c.save();
  c.translate(x, y);
  c.scale(face, 1);
  const fast = mode === 'charge';
  const ph = t * (fast ? 22 : 10);
  const l = Math.sin(ph) * (fast ? 4 : 2.5);
  c.fillStyle = '#2f2f3d';
  c.fillRect(-12 + l, -8, 4, 8); c.fillRect(-6 - l, -8, 4, 8); c.fillRect(6 + l, -8, 4, 8); c.fillRect(11 - l, -8, 4, 8);
  c.fillStyle = flash ? '#fff' : '#545468';
  rrect(c, -15, -20, 30, 14, 6); c.fill();
  c.strokeStyle = '#545468'; c.lineWidth = 4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-14, -16); c.lineTo(-21, -24 + Math.sin(t * 15) * 3); c.stroke(); c.lineCap = 'butt';
  c.fillStyle = flash ? '#fff' : '#62627a';
  rrect(c, 8, -30, 16, 14, 5); c.fill();
  c.fillStyle = '#2f2f3d';
  c.beginPath(); c.moveTo(10, -28); c.lineTo(9, -36); c.lineTo(15, -29); c.fill();
  c.fillRect(20, -23, 6, 6);
  c.fillStyle = fast ? '#ff4b3a' : '#ffd36b';
  c.beginPath(); c.arc(17, -25, 2.2, 0, 7); c.fill();
  if (fast) { c.fillStyle = '#fff'; c.fillRect(18, -18, 2, 3); c.fillRect(22, -18, 2, 3); }
  c.restore();
  if (mode === 'alert') outlined(c, '!', x, y - 42, 20, '#ff4b3a', INK, 4);
}

function drawGhost(c, x, y, t, shy, flash) {
  c.save();
  c.translate(x, y + Math.sin(t * 3) * 3);
  c.globalAlpha = shy ? 0.55 : 0.88;
  c.fillStyle = flash ? '#fff' : '#efeafc';
  c.beginPath();
  c.moveTo(-14, 0);
  c.lineTo(-14, -16);
  c.arc(0, -16, 14, Math.PI, 0);
  c.lineTo(14, 0);
  for (let i = 0; i < 4; i++) {
    const wx = 14 - (i + 1) * 7;
    c.quadraticCurveTo(wx + 3.5, 6 * (i % 2 ? -1 : 1) + Math.sin(t * 8 + i) * 2, wx, 0);
  }
  c.closePath();
  c.fill();
  c.globalAlpha = 1;
  if (shy) {
    c.fillStyle = '#d3cbef';
    c.beginPath(); c.ellipse(-6, -17, 5, 4, 0.3, 0, 7); c.fill();
    c.beginPath(); c.ellipse(6, -17, 5, 4, -0.3, 0, 7); c.fill();
    c.fillStyle = '#f2a9c4'; c.beginPath(); c.arc(-9, -11, 2.5, 0, 7); c.arc(9, -11, 2.5, 0, 7); c.fill();
  } else {
    c.fillStyle = '#2a1c3c';
    c.beginPath(); c.ellipse(-5, -18, 3, 4.5, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(5, -18, 3, 4.5, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(0, -9, 3, 3.5 + Math.sin(t * 6), 0, 0, 7); c.fill();
  }
  c.restore();
}

function drawShusher(c, x, y, t, face, firing, flash) {
  c.save();
  c.translate(x, y);
  c.scale(face, 1);
  c.fillStyle = '#5a566e'; rrect(c, -14, -10, 28, 10, 2); c.fill();
  c.fillStyle = flash ? '#fff' : '#8c88a4';
  c.beginPath(); c.moveTo(-10, -10); c.lineTo(-12, -26); c.quadraticCurveTo(0, -42, 12, -26); c.lineTo(10, -10); c.fill();
  c.strokeStyle = '#4a465e'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = INK;
  c.fillRect(-1, -27, 5, 2); c.fillRect(6, -27, 4, 2);
  c.beginPath();
  if (firing) c.arc(7, -18, 4, 0, 7); else c.ellipse(7, -18, 2.5, 2, 0, 0, 7);
  c.fill();
  if (!firing) { c.fillStyle = '#d7b7b0'; rrect(c, 9, -26, 4, 12, 2); c.fill(); }
  c.restore();
}

function drawShh(c, x, y, t, dir) {
  c.save();
  c.translate(x, y);
  c.globalAlpha = 0.9;
  c.strokeStyle = '#d7d0ff'; c.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(-dir * (4 + i * 6), 0, 6 + i * 3, dir > 0 ? -0.9 : Math.PI - 0.9, dir > 0 ? 0.9 : Math.PI + 0.9);
    c.globalAlpha = 0.9 - i * 0.25;
    c.stroke();
  }
  c.globalAlpha = 1;
  c.font = 'italic 13px ' + FONT;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#efeaff';
  c.fillText('shh', dir * 4, Math.sin(t * 12) * 1.5);
  c.restore();
}

function drawHush(c, b, t) {
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  c.save();
  c.translate(x, y);
  const shakeX = b.state === 'windup' ? Math.sin(t * 70) * 3 : 0;
  c.translate(shakeX, 0);
  // wisps of shadow
  c.fillStyle = 'rgba(20,18,30,0.5)';
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.ellipse(Math.sin(t * 2 + i) * 30, 46 + i * 8, 34 - i * 5, 10, 0, 0, 7);
    c.fill();
  }
  const R = 52;
  const flash = b.flash > 0 && Math.floor(b.flash * 30) % 2 === 0;
  c.fillStyle = flash ? '#fff' : b.hp <= 2 ? '#7c7890' : '#9693ab';
  c.strokeStyle = '#3e3b52'; c.lineWidth = 4;
  c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill(); c.stroke();
  c.fillStyle = '#ffffff18'; c.beginPath(); c.arc(-14, -18, 26, 0, 7); c.fill();
  if (b.hp <= 4) {
    c.strokeStyle = '#3e3b52'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-30, -38); c.lineTo(-22, -24); c.lineTo(-28, -12); c.stroke();
  }
  if (b.hp <= 2) {
    c.beginPath(); c.moveTo(34, -30); c.lineTo(24, -20); c.lineTo(30, -6); c.lineTo(22, 4); c.stroke();
  }
  c.strokeStyle = INK; c.lineWidth = 4; c.lineCap = 'round';
  if (b.state === 'stunned' || b.state === 'hurt' || b.state === 'dead') {
    for (const ex of [-18, 18]) {
      c.beginPath(); c.moveTo(ex - 7, -18); c.lineTo(ex + 7, -6); c.moveTo(ex + 7, -18); c.lineTo(ex - 7, -6); c.stroke();
    }
    c.fillStyle = INK; c.beginPath(); c.ellipse(0, 22, 10, 7, 0, 0, 7); c.fill();
    for (let i = 0; i < 3; i++) {
      const a = t * 4 + (i * Math.PI * 2) / 3;
      drawGlyphH(c, Math.cos(a) * 46, -58 + Math.sin(a) * 8, 14, GOLD, GOLD_DARK);
    }
  } else {
    const angry = b.state === 'windup' || b.state === 'slam';
    for (const ex of [-18, 18]) {
      c.beginPath();
      if (angry) { c.moveTo(ex - 9, -16 + (ex < 0 ? -4 : 4) * -1); c.lineTo(ex + 9, -16 + (ex < 0 ? 4 : -4) * -1); }
      else c.arc(ex, -14, 9, 0.2, Math.PI - 0.2);
      c.stroke();
    }
    // the shushing finger
    c.fillStyle = '#c9a7a7'; c.strokeStyle = '#7a5656'; c.lineWidth = 2.5;
    rrect(c, -8, 2, 16, 52, 8); c.fill(); c.stroke();
    c.fillStyle = '#ead0cc'; rrect(c, -5, 5, 10, 10, 4); c.fill();
    c.fillStyle = '#7a5656'; c.fillRect(-12, 18, 6, 4); c.fillRect(6, 18, 6, 4);
  }
  c.lineCap = 'butt';
  c.restore();
}
