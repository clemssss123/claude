'use strict';
/* Screens, menus and the main loop. */

function wrapLines(c, str, maxW) {
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(c, str, x, y, maxW, size, color, lineH = size * 1.45, align = 'left') {
  c.font = `${size}px ${BODY}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  const lines = wrapLines(c, str, maxW);
  lines.forEach((l, i) => c.fillText(l, x, y + i * lineH));
  return lines.length * lineH;
}

function panel(c, x, y, w, h, fill = 'rgba(18,16,31,0.86)') {
  c.fillStyle = '#00000040';
  rrect(c, x + 4, y + 6, w, h, 16); c.fill();
  c.fillStyle = fill;
  rrect(c, x, y, w, h, 16); c.fill();
  c.strokeStyle = '#3d3760'; c.lineWidth = 2; c.stroke();
}

function drawGroundStrip(c, th, y, sx) {
  const fake = { h: 99, tileAt: (tx, ty) => (ty >= 0 ? '#' : ' ') };
  const base = Math.floor(sx / T), off = sx - base * T;
  c.save();
  c.translate(-off - base * T, y);
  for (let i = 0; i <= VW / T + 1; i++) for (let j = 0; j < 3; j++) drawSolid(c, fake, base + i, j, th);
  c.restore();
}

function totals() {
  let gold = 0, signs = 0, done = 0;
  LEVELS.forEach(l => {
    const r = Save.level(l.id);
    gold += bits(r.h); signs += bits(r.s);
    if (r.done) done++;
  });
  return { gold, signs, done };
}

function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

/* ---------- Menu ---------- */

class Menu {
  constructor(items, o = {}) {
    this.items = items;
    this.i = 0;
    this.x = o.x != null ? o.x : VW / 2;
    this.y = o.y != null ? o.y : 300;
    this.gap = o.gap || 48;
    this.size = o.size || 24;
    this.rects = [];
  }
  label(it) { return typeof it.label === 'function' ? it.label() : it.label; }
  update() {
    const n = this.items.length;
    if (Input.pressed('down')) { this.i = (this.i + 1) % n; Sound.play('select'); }
    if (Input.pressed('up')) { this.i = (this.i + n - 1) % n; Sound.play('select'); }
    const it = this.items[this.i];
    if (it.adjust) {
      if (Input.pressed('left')) { it.adjust(-1); Sound.play('select'); }
      if (Input.pressed('right')) { it.adjust(1); Sound.play('select'); }
    }
    const ptr = Input.pointer;
    if (ptr.hover || ptr.click) {
      this.rects.forEach((r, k) => {
        if (!inRect(ptr, r)) return;
        if (ptr.hover && this.i !== k) { this.i = k; Sound.play('select'); }
        if (ptr.click) { this.i = k; this.activate(ptr.x < r.x + r.w / 2 ? -1 : 1); }
      });
    }
    if (Input.confirm()) this.activate(1);
  }
  activate(dir) {
    const it = this.items[this.i];
    if (it.adjust && !it.act) { it.adjust(dir, true); Sound.play('select'); return; }
    Sound.play('confirm');
    if (it.act) it.act();
  }
  draw(c, t) {
    this.rects = [];
    this.items.forEach((it, k) => {
      const y = this.y + k * this.gap;
      const sel = k === this.i;
      const str = this.label(it);
      c.font = `${this.size}px ${FONT}`;
      const w = c.measureText(str).width;
      this.rects.push({ x: this.x - w / 2 - 30, y: y - this.size - 6, w: w + 60, h: this.size + 18 });
      if (sel) {
        c.fillStyle = 'rgba(255,200,61,0.14)';
        rrect(c, this.x - w / 2 - 26, y - this.size - 4, w + 52, this.size + 14, 10); c.fill();
        drawHank(c, this.x - w / 2 - 14, y + 2, { face: 1, t: (t || 0) * 0.6, run: 0, sqx: 0.62, sqy: 0.62 });
      }
      outlined(c, str, this.x, y, this.size, sel ? GOLD : '#fbf6ea', INK, 6);
    });
  }
}

/* ---------- Title ---------- */

class TitleScene {
  constructor() {
    this.t = 0;
    this.bg = getBackdrop('hills');
    this.menu = new Menu([
      { label: () => (Save.data.seenIntro ? 'PLAY' : 'NEW GAME'), act: () => Game.go(Save.data.seenIntro ? new MapScene() : new StoryScene(false)) },
      { label: 'HOW TO PLAY', act: () => Game.go(new HowToScene(() => new TitleScene())) },
      { label: 'SETTINGS', act: () => Game.go(new SettingsScene(() => new TitleScene())) },
      { label: 'STORY', act: () => Game.go(new StoryScene(true)) },
    ], { y: 322, gap: 46, size: 24 });
  }
  enter() { Music.play('title'); }
  update(dt) { this.t += dt; this.menu.update(); }
  draw(c) {
    const t = this.t;
    this.bg.draw(c, t * 40, 0, t, VH);
    drawGroundStrip(c, THEMES.hills, VH - 64, t * 40);
    const hx = ((t * 80) % (VW + 160)) - 80;
    const hop = Math.abs(Math.sin(t * 4.5)) * 16;
    drawHank(c, hx, VH - 63 - hop, { face: 1, t, run: 1, air: hop > 3 });
    const sx = ((t * 80 + 260) % (VW + 160)) - 80;
    drawShush(c, sx, VH - 64, 26, 22, t, 1, false);

    c.fillStyle = 'rgba(18,16,31,0.35)';
    rrect(c, VW / 2 - 300, 40, 600, 196, 24); c.fill();
    const word = 'HANK';
    c.font = '118px ' + FONT;
    const widths = [...word].map(ch => c.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + 12 * (word.length - 1);
    let x = VW / 2 - total / 2;
    for (let i = 0; i < word.length; i++) {
      const bob = reducedMotion ? 0 : Math.sin(t * 3 + i * 0.7) * 6;
      const cx = x + widths[i] / 2;
      outlined(c, word[i], cx + 5, 172 + bob + 6, 118, '#00000055', '#00000055', 14);
      outlined(c, word[i], cx, 172 + bob, 118, i === 0 ? GOLD : '#fbf6ea', INK, 14);
      x += widths[i] + 12;
    }
    if ('letterSpacing' in c) c.letterSpacing = '6px';
    outlined(c, 'AND THE HUSH', VW / 2, 218, 26, '#d7d0ff', INK, 7);
    if ('letterSpacing' in c) c.letterSpacing = '0px';

    panel(c, VW / 2 - 170, 280, 340, 200, 'rgba(18,16,31,0.78)');
    this.menu.draw(c, t);

    const tt = totals();
    if (tt.done || tt.gold) text(c, `Golden H's ${tt.gold}/${TOTAL_GOLD}  ·  Signs ${tt.signs}/${TOTAL_SIGNS}`, 24, VH - 20, 14, '#fbf6ea', 'left', BODY);
    text(c, Input.usingTouch ? 'Tap to choose' : '↑ ↓ choose  ·  ENTER select  ·  M mute', VW - 24, VH - 20, 14, '#fbf6ea', 'right', BODY);
  }
}

/* ---------- Story ---------- */

const STORY = [
  { art: 'whole', text: 'In Hamlet Hollow, every word was whole. Houses had their H. Hills had their H. Everybody said HELLO.' },
  { art: 'hush', text: 'Then the Hush arrived. It cannot stand a sound, so it snatched every H in the Hollow and carried them off to its hall.' },
  { art: 'hank', text: 'It missed one. Hank is a small h, and small things are easy to miss. Now he is off to bring every H back home.' },
];

class StoryScene {
  constructor(replay) { this.replay = replay; this.page = 0; this.t = 0; this.chars = 0; }
  enter() { Music.play('map'); }
  update(dt) {
    this.t += dt;
    this.chars += dt * 45;
    const full = STORY[this.page].text.length;
    if (Input.back()) return this.finish();
    if (Input.confirm() || Input.pointer.click) {
      if (this.chars < full) { this.chars = full; return; }
      Sound.play('confirm');
      if (this.page < STORY.length - 1) { this.page++; this.chars = 0; this.t = 0; }
      else this.finish();
    }
  }
  finish() {
    if (this.done) return;
    this.done = true;
    Save.data.seenIntro = true;
    Save.write();
    Game.go(this.replay ? new TitleScene() : new MapScene(0));
  }
  draw(c) {
    const t = this.t, pg = STORY[this.page];
    const bgName = pg.art === 'hush' ? 'hush' : 'hills';
    getBackdrop(bgName).draw(c, t * 12, 0, t, VH);
    c.fillStyle = 'rgba(18,16,31,0.35)'; c.fillRect(0, 0, VW, VH);
    const ax = VW / 2, ay = 250;
    if (pg.art === 'whole') {
      ['HOUSE', 'HILL', 'HELLO'].forEach((w, i) => drawSignBoard(c, ax - 220 + i * 220, ay + 40, w.replace('H', '_'), -100, t, 0));
      drawHank(c, ax, ay + 110, { face: 1, t, run: 0, sqx: 1.6, sqy: 1.6 + Math.sin(t * 5) * 0.05 });
      for (let i = 0; i < 3; i++) drawGlyphH(c, ax - 220 + i * 220, ay - 60 + Math.sin(t * 2 + i) * 6, 26, GOLD, GOLD_DARK);
    } else if (pg.art === 'hush') {
      drawHush(c, { x: ax + 150, y: 40, w: 104, h: 104, hp: 6, state: 'hover', flash: 0 }, t);
      ['_OUSE', '_ILL', '_ELLO'].forEach((w, i) => drawSignBoard(c, ax - 260 + i * 170, ay + 110, w, null, t, 0));
      for (let i = 0; i < 6; i++) {
        const k = (t * 0.35 + i / 6) % 1;
        const x = lerp(ax - 260 + (i % 3) * 170, ax + 202, easeInOut(k));
        const y = lerp(ay + 30, 100, easeInOut(k)) - Math.sin(k * Math.PI) * 60;
        c.globalAlpha = 1 - k * 0.6;
        drawGlyphH(c, x, y, 22 - k * 8, GOLD, GOLD_DARK);
        c.globalAlpha = 1;
      }
    } else {
      drawGroundStrip(c, THEMES.hills, ay + 70, t * 60);
      drawHank(c, ax - 40, ay + 71 - Math.abs(Math.sin(t * 6)) * 10, { face: 1, t, run: 1, sqx: 2.2, sqy: 2.2 });
      for (let i = 0; i < 5; i++) {
        const x = ((i * 140 - t * 60) % 700 + 700) % 700 + ax + 40;
        if (x < VW - 20) drawGoldH(c, x, ay - 30 + Math.sin(t * 2 + i) * 8, 26, t + i, false);
      }
    }
    panel(c, 120, 360, VW - 240, 140, 'rgba(18,16,31,0.88)');
    const shown = pg.text.slice(0, Math.floor(this.chars));
    paragraph(c, shown, 150, 402, VW - 300, 21, '#fbf6ea', 30);
    const dots = STORY.map((_, i) => (i === this.page ? '●' : '○')).join(' ');
    text(c, dots, 150, 482, 14, '#9a94bd', 'left', BODY);
    if (this.chars >= pg.text.length && Math.sin(this.t * 5) > -0.3) {
      text(c, Input.usingTouch ? 'Tap to continue' : 'SPACE to continue  ·  ESC to skip', VW - 150, 482, 14, GOLD, 'right', BODY);
    }
  }
}

/* ---------- World map: Hamlet Hollow is shaped like an H ---------- */

const MAP_NODES = [[170, 470], [170, 390], [170, 310], [260, 310], [350, 310], [440, 310], [530, 310], [620, 310], [620, 232], [620, 156], [620, 80]];
const MAP_LABELS = [
  [140, 436, 'right'], [215, 272, 'center'], [395, 356, 'center'], [575, 356, 'center'], [590, 200, 'right'], [590, 86, 'right'],
];

class MapScene {
  constructor(sel) {
    const max = Math.min(Save.data.unlocked, LEVELS.length - 1);
    this.sel = clamp(sel != null ? sel : max, 0, max);
    this.from = this.sel; this.anim = 1; this.t = 0;
  }
  enter() { Music.play('map'); }
  update(dt) {
    this.t += dt;
    this.anim = Math.min(1, this.anim + dt * 5);
    for (const [a, dx, dy] of [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]]) if (Input.pressed(a)) this.step(dx, dy);
    const ptr = Input.pointer;
    if (ptr.click) {
      MAP_NODES.forEach(([x, y], i) => {
        if (Math.hypot(ptr.x - x, ptr.y - y) > 30) return;
        if (i > Save.data.unlocked) { Sound.play('back'); return; }
        if (i === this.sel) this.play();
        else { this.from = this.sel; this.sel = i; this.anim = 0; Sound.play('select'); }
      });
      if (this.playRect && inRect(ptr, this.playRect)) this.play();
      if (this.backRect && inRect(ptr, this.backRect)) Game.go(new TitleScene());
    }
    if (Input.confirm()) this.play();
    if (Input.back()) { Sound.play('back'); Game.go(new TitleScene()); }
  }
  step(dx, dy) {
    const cur = MAP_NODES[this.sel];
    for (const n of [this.sel + 1, this.sel - 1]) {
      if (n < 0 || n >= LEVELS.length) continue;
      const v = MAP_NODES[n];
      if (Math.sign(v[0] - cur[0]) !== dx || Math.sign(v[1] - cur[1]) !== dy) continue;
      if (n > Save.data.unlocked) { Sound.play('back'); return; }
      this.from = this.sel; this.sel = n; this.anim = 0;
      Sound.play('select');
      return;
    }
  }
  play() {
    if (this.leaving) return;
    this.leaving = true;
    Sound.play('confirm');
    Game.go(new PlayScene(this.sel));
  }
  draw(c) {
    const t = this.t;
    c.fillStyle = '#17142b'; c.fillRect(0, 0, VW, VH);
    c.globalAlpha = 0.06;
    for (let y = 0; y < VH; y += 40) for (let x = (y / 40) % 2 ? 20 : 0; x < VW; x += 40) drawGlyphH(c, x, y, 10, '#fbf6ea', null);
    c.globalAlpha = 1;

    // the H itself
    c.lineCap = 'round';
    c.strokeStyle = '#2a2548'; c.lineWidth = 64;
    c.beginPath();
    c.moveTo(170, 70); c.lineTo(170, 490);
    c.moveTo(620, 70); c.lineTo(620, 490);
    c.moveTo(170, 310); c.lineTo(620, 310);
    c.stroke();
    // the route, coloured by world once reached
    for (let i = 0; i < MAP_NODES.length - 1; i++) {
      const [x1, y1] = MAP_NODES[i], [x2, y2] = MAP_NODES[i + 1];
      const open = i + 1 <= Save.data.unlocked;
      c.strokeStyle = open ? WORLDS[LEVELS[i + 1].world].color : '#3d3760';
      c.lineWidth = 8;
      c.setLineDash(open ? [] : [2, 12]);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    }
    c.setLineDash([]);
    c.lineCap = 'butt';

    WORLDS.forEach((w, i) => {
      const [x, y, al] = MAP_LABELS[i];
      const open = firstOfWorld(i) <= Save.data.unlocked;
      text(c, w.name.toUpperCase(), x, y, 13, open ? w.color : '#4a4470', al, FONT);
    });

    MAP_NODES.forEach(([x, y], i) => {
      const lv = LEVELS[i], rec = Save.level(lv.id), open = i <= Save.data.unlocked;
      const r = lv.boss ? 26 : 21;
      c.fillStyle = '#0f0d1c'; c.beginPath(); c.arc(x, y + 3, r + 3, 0, 7); c.fill();
      c.fillStyle = !open ? '#3d3760' : rec.done ? WORLDS[lv.world].color : '#fbf6ea';
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      if (rec.done && bits(rec.h) === LEVEL_TOTALS[i].gold && bits(rec.s) === LEVEL_TOTALS[i].signs) {
        c.strokeStyle = GOLD; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.stroke();
      }
      if (!open) {
        c.fillStyle = '#6a6390'; rrect(c, x - 7, y - 3, 14, 11, 2); c.fill();
        c.strokeStyle = '#6a6390'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y - 4, 5, Math.PI, 0); c.stroke();
      } else if (lv.boss) {
        c.save(); c.translate(x, y); c.scale(0.36, 0.36);
        drawHush(c, { x: -52, y: -52, w: 104, h: 104, hp: 6, state: rec.done ? 'stunned' : 'hover', flash: 0 }, t);
        c.restore();
      } else {
        text(c, lv.id, x, y + 5, 13, INK, 'center', FONT);
      }
    });

    const a = easeOut(this.anim);
    const [fx, fy] = MAP_NODES[this.from], [tx, ty] = MAP_NODES[this.sel];
    const hx = lerp(fx, tx, a), hy = lerp(fy, ty, a) - 22 - Math.abs(Math.sin(t * 4)) * 5 - Math.sin(a * Math.PI) * 20;
    drawHank(c, hx, hy, { face: tx >= fx ? 1 : -1, t, run: this.anim < 1 ? 1 : 0, air: this.anim < 1 });

    // header
    outlined(c, 'HAMLET HOLLOW', 32, 44, 22, '#fbf6ea', INK, 6, 'left');
    const tt = totals();
    drawGlyphH(c, 300, 36, 18, GOLD, GOLD_DARK);
    text(c, `${tt.gold}/${TOTAL_GOLD}`, 316, 43, 16, '#fbf6ea', 'left', FONT);
    c.fillStyle = '#e7cf9d'; rrect(c, 400, 27, 22, 15, 3); c.fill();
    text(c, 'H', 411, 40, 11, '#5a3a22', 'center', FONT);
    text(c, `${tt.signs}/${TOTAL_SIGNS}`, 430, 43, 16, '#fbf6ea', 'left', FONT);

    // info card
    const lv = LEVELS[this.sel], rec = Save.level(lv.id), w = WORLDS[lv.world], tot = LEVEL_TOTALS[this.sel];
    const px = 690, py = 70, pw = 246, ph = 420;
    panel(c, px, py, pw, ph);
    text(c, w.name.toUpperCase(), px + 20, py + 34, 13, w.color, 'left', FONT);
    text(c, lv.boss ? 'FINALE' : 'LEVEL ' + lv.id, px + 20, py + 62, 13, '#9a94bd', 'left', FONT);
    c.font = '24px ' + FONT;
    const nameLines = wrapLines(c, lv.name.toUpperCase(), pw - 40);
    nameLines.forEach((l, i) => text(c, l, px + 20, py + 96 + i * 30, 24, '#fbf6ea', 'left', FONT));
    let y = py + 110 + nameLines.length * 30;
    if (!lv.boss) {
      text(c, "GOLDEN H'S", px + 20, y, 12, '#9a94bd', 'left', FONT);
      for (let i = 0; i < tot.gold; i++) {
        const got = rec.h & (1 << i);
        c.globalAlpha = got ? 1 : 0.3;
        drawGlyphH(c, px + 32 + i * 30, y + 26, 22, got ? GOLD : '#5d5677', got ? GOLD_DARK : null);
      }
      c.globalAlpha = 1;
      y += 66;
      text(c, 'SIGNS RESTORED', px + 20, y, 12, '#9a94bd', 'left', FONT);
      text(c, `${bits(rec.s)} / ${tot.signs}`, px + 20, y + 28, 20, bits(rec.s) === tot.signs ? GOLD : '#fbf6ea', 'left', FONT);
      y += 58;
    } else {
      y = paragraph(c, 'The Hush waits in its hall with every stolen H. Bonk it when it slams down and gets dizzy.', px + 20, y, pw - 40, 15, '#d7d0ff', 22) + y + 10;
    }
    text(c, 'BEST TIME', px + 20, y, 12, '#9a94bd', 'left', FONT);
    text(c, rec.best ? fmtTime(rec.best) : '--:--', px + 20, y + 28, 20, '#fbf6ea', 'left', FONT);

    const by = py + ph - 64;
    this.playRect = { x: px + 20, y: by, w: pw - 40, h: 46 };
    c.fillStyle = HANK; rrect(c, px + 20, by, pw - 40, 46, 12); c.fill();
    c.fillStyle = HANK_DARK; rrect(c, px + 20, by + 40, pw - 40, 6, [0, 0, 12, 12]); c.fill();
    outlined(c, rec.done ? 'PLAY AGAIN' : 'PLAY', px + pw / 2, by + 31, 20, '#fbf6ea', HANK_DARK, 5);

    this.backRect = { x: 24, y: VH - 44, w: 120, h: 32 };
    text(c, Input.usingTouch ? '◀ TITLE' : 'ARROWS move  ·  ENTER play  ·  ESC title', 32, VH - 22, 13, '#9a94bd', 'left', BODY);
  }
}

/* ---------- Playing a level ---------- */

class PlayScene {
  constructor(index, carry) {
    this.index = index;
    this.stage = new Stage(index, carry);
    this.paused = false;
    this.results = null;
    this.sub = null;
  }
  enter() { Music.play(WORLDS[LEVELS[this.index].world].music); }
  autoPause() { if (!this.paused && this.stage.mode === 'play' && !this.sub) this.pause(); }
  pause() {
    this.paused = true;
    Sound.play('pause');
    this.pauseMenu = new Menu([
      { label: 'RESUME', act: () => this.resume() },
      { label: 'RESTART LEVEL', act: () => Game.go(new PlayScene(this.index)) },
      { label: 'SETTINGS', act: () => { this.sub = new SettingsScene(null, () => { this.sub = null; }); } },
      { label: 'LEVEL MAP', act: () => Game.go(new MapScene(this.index)) },
      { label: 'QUIT TO TITLE', act: () => Game.go(new TitleScene()) },
    ], { y: 210, gap: 46, size: 22 });
  }
  resume() { this.paused = false; Sound.play('pause'); }
  update(dt) {
    if (this.sub) { this.sub.update(dt); return; }
    const st = this.stage;
    if (this.paused) {
      this.pauseMenu.update();
      if (this.paused && (Input.pressed('pause') || Input.pressed('back'))) this.resume();
      return;
    }
    if (st.mode === 'play' && Input.pressed('pause')) { this.pause(); return; }
    st.update(dt);
    if (st.mode === 'rebuild') {
      this.stage = new Stage(this.index, { time: st.time, deaths: st.deaths });
      return;
    }
    if (st.mode === 'complete' && st.modeT > 1.6 && !this.results) this.openResults();
    if (this.results) this.results.update();
    if (st.mode === 'won' && st.modeT > 5 && !this.leaving) { this.leaving = true; Game.go(new EndingScene()); }
  }
  openResults() {
    const r = this.stage.result;
    const next = Math.min(this.index + 1, LEVELS.length - 1);
    const go = () => {
      const toMap = () => new MapScene(next);
      Game.go(r.gift ? new UnlockScene(r.gift, toMap) : toMap());
    };
    this.results = new Menu([
      { label: 'CONTINUE', act: go },
      { label: 'PLAY AGAIN', act: () => Game.go(new PlayScene(this.index)) },
    ], { y: 440, gap: 42, size: 20 });
    this.resultsT = 0;
  }
  touchVisible() { return !this.paused && !this.sub && !this.results && this.stage.mode !== 'won'; }
  draw(c) {
    const st = this.stage;
    st.draw(c);
    if (st.mode === 'dying') {
      c.fillStyle = `rgba(18,16,31,${clamp((st.modeT - 0.6) / 0.6, 0, 0.8)})`;
      c.fillRect(0, 0, VW, VH);
    }
    if (this.results) this.drawResults(c);
    if (this.paused) this.drawPause(c);
    if (this.sub) this.sub.draw(c);
  }
  drawPause(c) {
    c.fillStyle = 'rgba(12,10,22,0.7)'; c.fillRect(0, 0, VW, VH);
    panel(c, VW / 2 - 200, 90, 400, 380);
    outlined(c, 'PAUSED', VW / 2, 150, 34, GOLD, INK, 7);
    this.pauseMenu.draw(c, this.stage.clock);
    const ab = this.stage.abilities;
    const have = [['HOP', true], ['HOVER', ab.hover], ['HAMMER', ab.hammer], ['HASTE', ab.haste]];
    let x = VW / 2 - 165;
    for (const [n, on] of have) {
      c.font = '12px ' + FONT;
      const w = c.measureText(n).width + 18;
      c.fillStyle = on ? 'rgba(255,200,61,0.2)' : 'rgba(255,255,255,0.05)';
      rrect(c, x, 438, w, 22, 11); c.fill();
      text(c, n, x + w / 2, 454, 12, on ? GOLD : '#5d5677', 'center', FONT);
      x += w + 8;
    }
  }
  drawResults(c) {
    const st = this.stage, r = st.result;
    const k = easeOut(clamp((st.modeT - 1.6) / 0.4, 0, 1));
    c.fillStyle = `rgba(12,10,22,${0.6 * k})`; c.fillRect(0, 0, VW, VH);
    const pw = 520, ph = 456, px = VW / 2 - pw / 2, py = 42 + (1 - k) * 40;
    c.globalAlpha = k;
    panel(c, px, py, pw, ph);
    outlined(c, 'LEVEL CLEAR!', VW / 2, py + 58, 36, GOLD, INK, 8);
    text(c, st.def.name.toUpperCase(), VW / 2, py + 86, 14, '#9a94bd', 'center', FONT);
    const n = st.goldTotal;
    for (let i = 0; i < n; i++) {
      const x = VW / 2 - ((n - 1) * 48) / 2 + i * 48, y = py + 134;
      const got = r.gold & (1 << i), isNew = r.newGold & (1 << i);
      const pop = isNew ? 1 + Math.max(0, Math.sin((st.modeT - 2 - i * 0.15) * 6)) * 0.25 * clamp(3 - st.modeT, 0, 1) : 1;
      c.globalAlpha = k * (got ? 1 : 0.25);
      drawGlyphH(c, x, y, 34 * pop, got ? GOLD : '#5d5677', got ? GOLD_DARK : null);
      if (isNew) text(c, 'NEW', x, y + 34, 10, GOLD_LIGHT, 'center', FONT);
    }
    c.globalAlpha = k;
    const rows = [
      ['SIGNS', `${bits(r.signs)} / ${st.signTotal}`],
      ['HONEY', String(r.honey)],
      ['TIME', fmtTime(r.time) + (r.newBest ? '  NEW BEST' : `  (best ${fmtTime(r.best)})`)],
      ['FALLS', String(r.deaths)],
    ];
    rows.forEach(([a, b], i) => {
      const y = py + 206 + i * 30;
      text(c, a, px + 70, y, 14, '#9a94bd', 'left', FONT);
      text(c, b, px + pw - 70, y, 16, i === 2 && r.newBest ? GOLD : '#fbf6ea', 'right', FONT);
    });
    outlined(c, 'RANK: ' + r.rank, VW / 2, py + 342, 22, '#fbf6ea', INK, 6);
    if (this.results) { this.results.y = py + 390; this.results.draw(c, st.clock); }
    c.globalAlpha = 1;
  }
}

/* ---------- New ability ---------- */

class UnlockScene {
  constructor(gift, next) { this.gift = gift; this.next = next; this.t = 0; Sound.play('unlock'); }
  enter() { Music.play('map'); }
  update(dt) {
    this.t += dt;
    if (this.t > 0.8 && (Input.confirm() || Input.pointer.click) && !this.left) { this.left = true; Sound.play('confirm'); Game.go(this.next()); }
  }
  draw(c) {
    const t = this.t, ab = ABILITIES[this.gift];
    c.fillStyle = '#17142b'; c.fillRect(0, 0, VW, VH);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + t * 0.3;
      c.fillStyle = i % 2 ? '#1f1a36' : '#241f40';
      c.beginPath(); c.moveTo(VW / 2, 200); c.arc(VW / 2, 200, 700, a, a + Math.PI / 8); c.fill();
    }
    outlined(c, 'NEW ABILITY!', VW / 2, 70, 22, '#d7d0ff', INK, 6);
    outlined(c, ab.name, VW / 2, 330, 64, GOLD, INK, 12);
    const cx = VW / 2;
    if (this.gift === 'hover') {
      drawHank(c, cx, 230 + Math.sin(t * 2) * 12, { face: 1, t, rotor: true, air: true, sqx: 2.4, sqy: 2.4 });
    } else if (this.gift === 'hammer') {
      const p = (t % 0.9) / 0.6;
      drawHank(c, cx - 30, 250, { face: 1, t, hammer: p <= 1 ? p : null, sqx: 2.4, sqy: 2.4 });
      c.save(); c.translate(cx + 50, 186); drawDynamicTile(c, null, 0, 0, 'B', THEMES.hills, t); drawDynamicTile(c, null, 0, 1, 'B', THEMES.hills, t); c.restore();
    } else {
      const k = (t % 1.6) / 1.6;
      const x = cx - 140 + easeInOut(k) * 280;
      for (let i = 1; i < 5; i++) { c.globalAlpha = 0.4 - i * 0.08; drawHank(c, x - i * 26, 250, { face: 1, t, sqx: 2.4, sqy: 2.4, color: '#ffb4a3', edge: '#ffb4a3' }); }
      c.globalAlpha = 1;
      drawHank(c, x, 250, { face: 1, t, run: 1, sqx: 2.6, sqy: 2.2 });
    }
    text(c, Input.usingTouch ? ab.touch : ab.keys, VW / 2, 382, 20, '#fbf6ea', 'center', FONT);
    paragraph(c, ab.text, VW / 2, 420, 560, 18, '#d7d0ff', 26, 'center');
    if (this.t > 0.8 && Math.sin(t * 5) > -0.3) text(c, Input.usingTouch ? 'Tap to continue' : 'SPACE to continue', VW / 2, 506, 15, GOLD, 'center', BODY);
  }
}

/* ---------- How to play ---------- */

class HowToScene {
  constructor(back) { this.back = back; this.page = 0; this.t = 0; }
  enter() {}
  update(dt) {
    this.t += dt;
    const n = 3;
    if (Input.pressed('right') || Input.confirm()) {
      if (Input.confirm() && this.page === n - 1) { Sound.play('back'); Game.go(this.back()); return; }
      this.page = Math.min(n - 1, this.page + 1); Sound.play('select');
    }
    if (Input.pressed('left')) { this.page = Math.max(0, this.page - 1); Sound.play('select'); }
    if (Input.pointer.click) {
      if (Input.pointer.x > VW / 2) { if (this.page === n - 1) Game.go(this.back()); else this.page++; }
      else this.page = Math.max(0, this.page - 1);
      Sound.play('select');
    }
    if (Input.back()) { Sound.play('back'); Game.go(this.back()); }
  }
  draw(c) {
    const t = this.t;
    c.fillStyle = '#17142b'; c.fillRect(0, 0, VW, VH);
    panel(c, 40, 24, VW - 80, VH - 48);
    const titles = ['CONTROLS', "WHO'S WHO", 'WHAT TO FIND'];
    outlined(c, titles[this.page], VW / 2, 78, 30, GOLD, INK, 7);
    if (this.page === 0) {
      const rows = [
        ['WALK', '← →  or  A D', 'D-pad / stick'],
        ['HOP', 'SPACE, Z, ↑ or W  (hold to hop higher)', 'A'],
        ['CLIMB', '↑ ↓ on a ladder', 'D-pad'],
        ['DROP DOWN', '↓ + SPACE on a plank', ''],
        ['HOVER', 'Hold SPACE in the air  ·  from Harbor', 'hold A'],
        ['HAMMER', 'X or J  ·  from Haunted House', 'X'],
        ['HASTE', 'SHIFT or C  ·  from Honey Hive', 'B / RB'],
        ['PAUSE · MUTE', 'ESC or P  ·  M', 'START'],
      ];
      text(c, 'KEYBOARD', 330, 124, 12, '#9a94bd', 'left', FONT);
      text(c, 'GAMEPAD', 790, 124, 12, '#9a94bd', 'left', FONT);
      rows.forEach(([a, b, g], i) => {
        const y = 158 + i * 36;
        text(c, a, 100, y, 15, GOLD, 'left', FONT);
        text(c, b, 330, y, 17, '#fbf6ea', 'left', BODY);
        text(c, g, 790, y, 15, '#d7d0ff', 'left', BODY);
      });
      text(c, 'On a phone or tablet, on-screen buttons appear while you play.', VW / 2, 446, 15, '#9a94bd', 'center', BODY);
    } else if (this.page === 1) {
      const cast = [
        ['SHUSH', 'Hop on it.', (x, y) => drawShush(c, x, y, 26, 22, t, 1, false)],
        ['HORNET', 'Hop on it, or let it buzz past.', (x, y) => drawHornet(c, x, y - 12, t, 1, false)],
        ['HEDGEHOG', 'Prickly on top. Hammer it.', (x, y) => drawHedgehog(c, x, y, t, 1, false)],
        ['HOUND', 'Spots you, barks, then charges. Hop on it.', (x, y) => drawHound(c, x, y, t, 1, 'patrol', false)],
        ['GHOST', 'Creeps closer while you look away. Face it, then hammer it.', (x, y) => drawGhost(c, x, y, t, Math.sin(t) > 0, false)],
        ['SHUSHER', 'Spits shh-waves. Bounce off its head, or hammer it twice.', (x, y) => drawShusher(c, x, y, t, 1, Math.sin(t * 3) > 0.6, false)],
      ];
      cast.forEach(([n, d, art], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = 90 + col * 420, y = 168 + row * 100;
        art(x + 20, y + 26);
        text(c, n, x + 70, y, 16, GOLD, 'left', FONT);
        paragraph(c, d, x + 70, y + 24, 300, 15, '#fbf6ea', 20);
      });
    } else {
      const items = [
        ['GOLDEN H', "Five in every level. Each one counts the moment you grab it, even if you fall later. Some sit behind walls you can't break yet, so come back with new abilities.", (x, y) => drawGoldH(c, x, y, 30, t, false)],
        ['SIGNS', 'Words around the Hollow have lost their H. Walk up to a sign to give it back.', (x, y) => drawSignBoard(c, x, y + 30, '_I', -100, t, 0)],
        ['HONEY', 'Every 25 drops you collect in a level heals a heart.', (x, y) => drawHoney(c, x, y, t)],
        ['CHECKPOINTS', 'Touch the H flag. If you run out of hearts, you start again from there with full hearts.', (x, y) => {
          const cp = new Checkpoint(0, 0); cp.active = true;
          c.save(); c.translate(x - 12, y + 30 - T); cp.draw(c, t); c.restore();
        }],
        ['HOME POSTS', 'Run between the big H-shaped posts to finish the level.', (x, y) => {
          c.save(); c.translate(x, y + 30); c.scale(0.45, 0.45); c.translate(-48, -32); new Goal(0, 0).draw(c, t); c.restore();
        }],
      ];
      items.forEach(([n, d, art], i) => {
        const y = 120 + i * 70;
        art(120, y + 14);
        text(c, n, 190, y + 4, 16, GOLD, 'left', FONT);
        paragraph(c, d, 190, y + 28, 640, 15, '#fbf6ea', 20);
      });
    }
    const dots = [0, 1, 2].map(i => (i === this.page ? '●' : '○')).join(' ');
    text(c, dots, VW / 2, VH - 62, 14, '#9a94bd', 'center', BODY);
    text(c, Input.usingTouch ? 'Tap the right side for more, left to go back' : '← → pages  ·  ESC back', VW / 2, VH - 38, 13, '#9a94bd', 'center', BODY);
  }
}

/* ---------- Settings ---------- */

class SettingsScene {
  constructor(back, onClose) {
    this.back = back; this.onClose = onClose; this.t = 0; this.confirmReset = false;
    const bar = v => '■'.repeat(Math.round(v * 10)) + '□'.repeat(10 - Math.round(v * 10));
    const step = (k, d, wrap) => {
      let v = Math.round(Save.data[k] * 10) + d;
      if (wrap && v > 10) v = 0;
      Save.data[k] = clamp(v, 0, 10) / 10;
      Sound.apply(); Save.write();
    };
    const touchModes = ['auto', 'on', 'off'];
    this.menu = new Menu([
      { label: () => 'MUSIC  ' + bar(Save.data.music), adjust: (d, w) => step('music', d, w) },
      { label: () => 'SOUND  ' + bar(Save.data.sfx), adjust: (d, w) => { step('sfx', d, w); Sound.play('honey', 3); } },
      { label: () => 'SCREEN SHAKE  ' + (Save.data.shake ? 'ON' : 'OFF'), adjust: () => { Save.data.shake = !Save.data.shake; Save.write(); } },
      { label: () => 'TOUCH BUTTONS  ' + Save.data.touch.toUpperCase(), adjust: d => { Save.data.touch = touchModes[(touchModes.indexOf(Save.data.touch) + (d < 0 ? 2 : 1)) % 3]; Save.write(); } },
      { label: 'FULL SCREEN', act: () => toggleFullscreen() },
      { label: () => (this.confirmReset ? 'PRESS AGAIN TO ERASE' : 'ERASE PROGRESS'), act: () => {
        if (!this.confirmReset) { this.confirmReset = true; return; }
        Save.reset(); this.confirmReset = false; Game.toast('PROGRESS ERASED');
      } },
      { label: 'BACK', act: () => this.close() },
    ], { y: 150, gap: 48, size: 20 });
  }
  enter() {}
  close() {
    Sound.play('back');
    if (this.onClose) this.onClose(); else Game.go(this.back());
  }
  update(dt) {
    this.t += dt;
    const before = this.menu.i;
    this.menu.update();
    if (this.menu.i !== before) this.confirmReset = false;
    if (Input.back()) this.close();
  }
  draw(c) {
    if (this.onClose) { c.fillStyle = 'rgba(12,10,22,0.82)'; c.fillRect(0, 0, VW, VH); }
    else { c.fillStyle = '#17142b'; c.fillRect(0, 0, VW, VH); }
    panel(c, VW / 2 - 250, 50, 500, 440);
    outlined(c, 'SETTINGS', VW / 2, 104, 30, GOLD, INK, 7);
    this.menu.y = 160;
    this.menu.draw(c, this.t);
    text(c, Input.usingTouch ? 'Tap the left or right half of a setting to change it' : '← → change  ·  ESC back', VW / 2, 478, 13, '#9a94bd', 'center', BODY);
  }
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => Game.toast('FULL SCREEN NOT AVAILABLE HERE'));
    else Game.toast('FULL SCREEN NOT AVAILABLE HERE');
  } catch (e) { Game.toast('FULL SCREEN NOT AVAILABLE HERE'); }
}

/* ---------- Ending ---------- */

class EndingScene {
  constructor() {
    this.t = 0;
    this.tt = totals();
    this.words = [];
    LEVELS.forEach(l => l.ents.filter(e => e.type === 'S').forEach(e => this.words.push(e.text.replace(/_/g, 'H'))));
  }
  enter() { Music.play('ending'); }
  update(dt) {
    this.t += dt;
    if (this.t > 3 && (Input.confirm() || Input.pointer.click) && !this.left) { this.left = true; Sound.play('confirm'); Game.go(new TitleScene()); }
  }
  draw(c) {
    const t = this.t;
    const g = c.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#ff9e6b'); g.addColorStop(0.55, '#ffd89a'); g.addColorStop(1, '#c4ecf0');
    c.fillStyle = g; c.fillRect(0, 0, VW, VH);
    c.fillStyle = '#fff4c4'; c.beginPath(); c.arc(VW / 2, 330 - Math.min(t, 6) * 12, 90, 0, 7); c.fill();
    drawClouds(c, t * 20, t, '#ffffff', 0.7);
    this.words.forEach((w, i) => {
      const k = ((t * 0.08 + i / this.words.length) % 1);
      const x = 60 + hash2(i, 7) * (VW - 120);
      const y = VH - k * (VH + 40);
      c.globalAlpha = Math.sin(k * Math.PI) * 0.7;
      outlined(c, w, x, y, 18, GOLD, '#8a5a12', 4);
    });
    c.globalAlpha = 1;
    drawGroundStrip(c, THEMES.hills, VH - 64, 0);
    const hop = Math.abs(Math.sin(t * 4)) * 26;
    drawHank(c, VW / 2, VH - 63 - hop, { face: Math.sin(t * 0.7) > 0 ? 1 : -1, t, air: hop > 3, sqx: 1.6, sqy: 1.6 });

    const k = easeOut(clamp(t / 1.2, 0, 1));
    c.globalAlpha = k;
    outlined(c, "THE H'S CAME HOME", VW / 2, 92, 40, '#fbf6ea', INK, 9);
    const all = this.tt.gold === TOTAL_GOLD && this.tt.signs === TOTAL_SIGNS;
    const msg = all
      ? 'Every H is home and every word is whole. Hamlet Hollow can finally shout HOORAY.'
      : 'The Hollow can speak again. A few H’s are still hiding out there, behind walls and across gaps you can now cross.';
    c.fillStyle = 'rgba(18,16,31,0.8)'; rrect(c, VW / 2 - 300, 116, 600, 172, 16); c.fill();
    paragraph(c, msg, VW / 2, 150, 540, 18, '#fbf6ea', 26, 'center');
    const stats = [
      [`${this.tt.gold}/${TOTAL_GOLD}`, "GOLDEN H'S"],
      [`${this.tt.signs}/${TOTAL_SIGNS}`, 'SIGNS'],
      [String(Save.data.deaths), 'FALLS'],
    ];
    stats.forEach(([v, l], i) => {
      const x = VW / 2 - 180 + i * 180;
      text(c, v, x, 238, 26, GOLD, 'center', FONT);
      text(c, l, x, 262, 12, '#d7d0ff', 'center', FONT);
    });
    c.globalAlpha = 1;
    if (t > 3 && Math.sin(t * 5) > -0.3) outlined(c, Input.usingTouch ? 'TAP TO FINISH' : 'PRESS SPACE', VW / 2, 340, 16, '#fbf6ea', INK, 5);
  }
}

/* ---------- Game shell and main loop ---------- */

const Game = {
  scene: null, pending: null, fade: 0, fading: 0, t: 0,
  scale: 1, cacheScale: 1, canvas: null, ctx: null, touchEl: null,
  toastMsg: '', toastT: 0,

  go(scene) {
    if (this.fading === 1) return;
    this.pending = scene;
    this.fading = 1;
  },
  toast(msg, dur = 1.8) { this.toastMsg = msg; this.toastT = dur; },

  update(dt) {
    this.t += dt;
    this.toastT = Math.max(0, this.toastT - dt);
    if (Input.pressed('mute')) this.toast(Sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
    if (this.fading === 1) {
      this.fade += dt * 5;
      if (this.fade >= 1) {
        this.fade = 1;
        this.scene = this.pending;
        this.pending = null;
        this.fading = -1;
        if (this.scene.enter) this.scene.enter();
      }
    } else {
      if (this.fading === -1) {
        this.fade -= dt * 5;
        if (this.fade <= 0) { this.fade = 0; this.fading = 0; }
      }
      this.scene.update(dt);
    }
    this.syncTouch();
  },

  syncTouch() {
    const mode = Save.data.touch;
    const play = this.scene instanceof PlayScene;
    const show = play && this.fading !== 1 && this.scene.touchVisible() && (mode === 'on' || (mode === 'auto' && Input.usingTouch));
    if (this.touchEl.hidden === show) {
      this.touchEl.hidden = !show;
      if (!show) {
        Input.touch = {};
        this.touchEl.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      }
    }
    if (show) {
      const ab = this.scene.stage.abilities;
      this.touchEl.querySelector('.t-hammer').hidden = !ab.hammer;
      this.touchEl.querySelector('.t-dash').hidden = !ab.haste;
    }
  },

  draw() {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = true;
    this.scene.draw(c);
    if (this.fade > 0) {
      c.fillStyle = `rgba(12,10,22,${this.fade})`;
      c.fillRect(0, 0, VW, VH);
    }
    if (this.toastT > 0) {
      c.globalAlpha = Math.min(1, this.toastT * 3);
      c.font = '14px ' + FONT;
      const w = c.measureText(this.toastMsg).width + 32;
      c.fillStyle = 'rgba(18,16,31,0.9)';
      rrect(c, VW / 2 - w / 2, VH - 70, w, 34, 17); c.fill();
      text(c, this.toastMsg, VW / 2, VH - 48, 14, GOLD, 'center', FONT);
      c.globalAlpha = 1;
    }
  },
};

function resize() {
  const stage = document.getElementById('stage');
  const cs = getComputedStyle(stage);
  const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const fit = Math.max(0.1, Math.min(aw / VW, ah / VH));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.floor(VW * fit), cssH = Math.floor(VH * fit);
  const cv = Game.canvas;
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  cv.width = Math.max(1, Math.round(cssW * dpr));
  cv.height = Math.max(1, Math.round(cssH * dpr));
  Game.scale = cv.width / VW;
  Game.cacheScale = Math.min(2, Math.max(1, Math.ceil(Game.scale * 2) / 2));
}

function boot() {
  Save.load();
  Game.canvas = document.getElementById('game');
  Game.ctx = Game.canvas.getContext('2d');
  Game.touchEl = document.getElementById('touch');
  Input.init(Game.canvas, Game.touchEl);
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) Input.setTouch(true);
  resize();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.scene instanceof PlayScene) Game.scene.autoPause();
  });
  Game.scene = new TitleScene();
  Game.scene.enter();
  if (Input.usingTouch && innerHeight > innerWidth) Game.toast('TURN SIDEWAYS FOR A BIGGER VIEW', 4);
  Game.canvas.focus({ preventScroll: true });
  let last = performance.now(), acc = 0;
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 14) { Input.poll(); Game.update(STEP); acc -= STEP; n++; }
    if (n === 14) acc = 0;
    Game.draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
