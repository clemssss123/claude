'use strict';
/* Sound effects and music, all synthesized with Web Audio. No audio files. */

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const Sound = {
  ctx: null, master: null, sfx: null, music: null, noiseBuf: null, muted: false,

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      const c = this.ctx;
      const comp = c.createDynamicsCompressor();
      comp.connect(c.destination);
      this.master = c.createGain(); this.master.connect(comp);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.apply();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    Music.resume();
  },

  apply() {
    if (!this.ctx) return;
    this.sfx.gain.value = Save.data.sfx;
    this.music.gain.value = Save.data.music * 0.5;
    this.master.gain.value = this.muted ? 0 : 0.9;
  },

  tone(f, dur, o = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = o.when != null ? o.when : c.currentTime + (o.at || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const vol = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(o.bus || this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  },

  noise(dur, o = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = o.when != null ? o.when : c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = c.createBiquadFilter();
    filt.type = o.type || 'bandpass';
    filt.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    filt.Q.value = o.q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(o.bus || this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  },

  play(name, arg) {
    if (!this.ctx || this.muted) return;
    const fn = SFX[name];
    if (fn) fn(this, arg);
  },

  toggleMute() {
    this.muted = !this.muted;
    this.apply();
    return this.muted;
  },
};

const arp = (s, notes, gap, o) => notes.forEach((m, i) => s.tone(mtof(m), o.dur || 0.12, Object.assign({}, o, { at: i * gap })));

const SFX = {
  jump: s => s.tone(320, 0.13, { f2: 640, vol: 0.08 }),
  land: s => s.noise(0.06, { freq: 400, vol: 0.06, type: 'lowpass' }),
  stomp: s => { s.tone(520, 0.12, { f2: 140, vol: 0.13 }); s.noise(0.08, { freq: 900, vol: 0.12 }); },
  hammer: s => s.noise(0.14, { freq: 900, f2: 260, q: 2, vol: 0.16 }),
  whack: s => { s.tone(220, 0.14, { f2: 60, vol: 0.18 }); s.noise(0.1, { freq: 600, vol: 0.2, type: 'lowpass' }); },
  brk: s => { s.noise(0.3, { freq: 1600, f2: 200, type: 'lowpass', vol: 0.34 }); s.tone(140, 0.2, { f2: 50, vol: 0.14, type: 'triangle' }); },
  clang: s => { s.tone(880, 0.25, { type: 'triangle', vol: 0.12 }); s.tone(1320, 0.2, { type: 'triangle', vol: 0.08 }); },
  gold: s => arp(s, [72, 76, 79, 84, 88], 0.055, { vol: 0.09 }),
  goldOld: s => arp(s, [72, 79], 0.06, { vol: 0.06, type: 'triangle' }),
  honey: (s, n = 0) => s.tone(mtof(84 + (n % 5) * 2), 0.07, { type: 'triangle', vol: 0.09 }),
  heart: s => arp(s, [67, 71, 74, 79], 0.06, { type: 'triangle', vol: 0.13, dur: 0.14 }),
  sign: s => {
    [60, 64, 67, 72].forEach(m => s.tone(mtof(m), 0.7, { type: 'triangle', vol: 0.06 }));
    arp(s, [84, 88, 91, 96], 0.05, { vol: 0.05, dur: 0.1 });
  },
  hurt: s => s.tone(420, 0.28, { f2: 110, vol: 0.15 }),
  splash: s => s.noise(0.45, { freq: 2200, f2: 300, type: 'lowpass', vol: 0.3 }),
  fall: s => s.tone(600, 0.4, { f2: 120, vol: 0.1, type: 'triangle' }),
  die: s => arp(s, [67, 63, 60, 55, 48], 0.11, { vol: 0.11, dur: 0.16 }),
  check: s => arp(s, [72, 79, 84], 0.07, { type: 'triangle', vol: 0.13, dur: 0.15 }),
  dash: s => s.noise(0.2, { freq: 3500, f2: 700, q: 1.5, vol: 0.18 }),
  spring: s => s.tone(180, 0.3, { f2: 900, type: 'triangle', vol: 0.17 }),
  goal: s => [60, 64, 67, 72, 67, 72, 76, 79, 84].forEach((m, i) => s.tone(mtof(m), i === 8 ? 0.7 : 0.13, { at: i * 0.09, vol: 0.09 })),
  select: s => s.tone(880, 0.04, { vol: 0.05 }),
  confirm: s => { s.tone(660, 0.06, { vol: 0.07 }); s.tone(990, 0.08, { at: 0.06, vol: 0.07 }); },
  back: s => s.tone(500, 0.08, { f2: 330, vol: 0.06 }),
  shh: s => s.noise(0.5, { freq: 5200, type: 'highpass', vol: 0.08 }),
  slam: s => { s.noise(0.6, { freq: 500, f2: 80, type: 'lowpass', vol: 0.5 }); s.tone(90, 0.5, { f2: 30, type: 'sine', vol: 0.38 }); },
  bossHit: s => { s.tone(300, 0.3, { f2: 60, vol: 0.2 }); s.noise(0.25, { freq: 1200, vol: 0.24 }); },
  unlock: s => arp(s, [60, 67, 72, 76, 79, 84, 88], 0.08, { type: 'triangle', vol: 0.11, dur: 0.22 }),
  crumble: s => s.noise(0.25, { freq: 700, vol: 0.12 }),
  pause: s => s.tone(520, 0.06, { type: 'triangle', vol: 0.07 }),
  bark: s => { s.tone(300, 0.08, { f2: 200, vol: 0.1, type: 'sawtooth' }); s.tone(280, 0.08, { f2: 180, at: 0.1, vol: 0.1, type: 'sawtooth' }); },
};

/* ---------- Music: each song is a chord loop with a seeded melody ---------- */

const CHORDS = {
  I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16],
  i: [0, 3, 7], iv: [5, 8, 12], v: [7, 10, 14], VI: [8, 12, 15], VII: [10, 14, 17], III: [3, 7, 10],
};

const SONGS = {
  title:   { bpm: 108, root: 60, prog: ['I', 'vi', 'IV', 'V'], seed: 11, lead: 'square', drums: 1 },
  map:     { bpm: 96, root: 65, prog: ['I', 'IV', 'vi', 'V'], seed: 17, lead: 'triangle', drums: 1 },
  hills:   { bpm: 126, root: 62, prog: ['I', 'V', 'vi', 'IV'], seed: 4, lead: 'square', drums: 2 },
  harbor:  { bpm: 100, root: 57, prog: ['I', 'IV', 'I', 'V'], seed: 7, lead: 'triangle', drums: 1 },
  haunted: { bpm: 92, root: 57, prog: ['i', 'VI', 'iv', 'v'], seed: 13, lead: 'triangle', drums: 1 },
  hive:    { bpm: 140, root: 64, prog: ['I', 'IV', 'V', 'IV'], seed: 21, lead: 'square', drums: 2 },
  heights: { bpm: 116, root: 59, prog: ['I', 'iii', 'IV', 'V'], seed: 9, lead: 'triangle', drums: 2 },
  boss:    { bpm: 152, root: 52, prog: ['i', 'VI', 'VII', 'i'], seed: 31, lead: 'sawtooth', drums: 3 },
  ending:  { bpm: 92, root: 60, prog: ['IV', 'V', 'iii', 'vi', 'ii', 'V', 'I', 'I'], seed: 5, lead: 'triangle', drums: 1 },
};

function buildSong(def) {
  const r = rng(def.seed * 7919);
  const rhythm = () => {
    const a = [];
    for (let s = 0; s < 16; s++) a.push(r() < (s % 4 === 0 ? 0.82 : s % 2 === 0 ? 0.42 : 0.1));
    a[0] = true;
    return a;
  };
  const rA = rhythm(), rB = rhythm(), rC = rhythm();
  const mel = [];
  let idx = 3;
  for (let b = 0; b < 8; b++) {
    const ch = CHORDS[def.prog[b % def.prog.length]];
    const pool = [];
    for (const o of [12, 24]) for (const t of ch) pool.push(def.root + o + t);
    pool.sort((x, y) => x - y);
    const rh = b === 7 ? rC : b % 2 === 0 ? rA : rB;
    const notes = new Array(16).fill(0);
    for (let s = 0; s < 16; s++) {
      if (!rh[s]) continue;
      idx = clamp(idx + Math.round((r() - 0.5) * 3.2), 0, pool.length - 1);
      notes[s] = pool[idx];
    }
    // Bars 5-6 echo bars 1-2 so the loop has a shape you can hum.
    mel.push(b === 4 || b === 5 ? mel[b - 4].slice() : notes);
  }
  return Object.assign({}, def, { mel });
}

const Music = {
  want: null, cur: null, song: null, step: 0, next: 0, timer: null, cache: {},

  play(name) {
    this.want = name;
    if (this.cur === name) return;
    this.halt();
    this.resume();
  },
  stop() {
    this.want = null;
    this.halt();
  },
  halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cur = null;
  },
  resume() {
    if (!Sound.ctx || !this.want || this.cur === this.want) return;
    this.cur = this.want;
    this.song = this.cache[this.want] || (this.cache[this.want] = buildSong(SONGS[this.want]));
    this.step = 0;
    this.next = Sound.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 30);
  },
  tick() {
    const c = Sound.ctx;
    if (!c || !this.song) return;
    const sd = 60 / this.song.bpm / 4;
    if (this.next < c.currentTime - 0.05) this.next = c.currentTime + 0.05;
    while (this.next < c.currentTime + 0.15) {
      this.schedule(this.step, this.next, sd);
      this.next += sd;
      this.step++;
    }
  },
  schedule(step, t, sd) {
    const s = this.song, bus = Sound.music;
    const bar = Math.floor(step / 16) % 8, i = step % 16;
    const ch = CHORDS[s.prog[bar % s.prog.length]];
    const root = s.root + ch[0];
    // bass
    if (i % 4 === 0 || (s.drums >= 2 && i % 4 === 3 && i !== 15)) {
      const n = root - 24 + (i === 8 ? 12 : 0);
      Sound.tone(mtof(n), sd * (i % 4 === 3 ? 0.9 : 2.6), { type: 'triangle', vol: 0.2, when: t, bus });
    }
    // soft chord stab on the off-beats
    if (i === 2 || i === 10) {
      for (const o of ch) Sound.tone(mtof(s.root + 12 + o), sd * 1.5, { type: 'triangle', vol: 0.025, when: t, bus });
    }
    // melody
    const m = s.mel[bar][i];
    if (m) {
      let len = 1;
      while (len < 4 && i + len < 16 && !s.mel[bar][i + len]) len++;
      Sound.tone(mtof(m), sd * len * 0.92, { type: s.lead, vol: s.lead === 'triangle' ? 0.09 : 0.045, when: t, bus });
    }
    // drums
    if (s.drums) {
      if (i % 2 === 0) Sound.noise(0.03, { freq: 8000, type: 'highpass', vol: i % 4 === 2 ? 0.035 : 0.018, when: t, bus });
      if (i === 0 || (s.drums >= 2 && i === 8) || (s.drums >= 3 && (i === 6 || i === 11))) {
        Sound.tone(130, 0.14, { f2: 40, type: 'sine', vol: 0.32, when: t, bus });
      }
      if (s.drums >= 2 && (i === 4 || i === 12)) Sound.noise(0.1, { freq: 1800, vol: 0.06, when: t, bus });
    }
  },
};
