'use strict';
/* A level in play: tile physics, collisions, effects, camera and the HUD. */

const CHUNK = 16; // tiles per side of a cached tile chunk

class Stage {
  constructor(index, carry = {}) {
    this.index = index;
    this.def = LEVELS[index];
    this.world = WORLDS[this.def.world];
    this.themeName = this.world.theme;
    this.theme = THEMES[this.themeName];
    this.w = this.def.w; this.h = this.def.h;
    this.tiles = this.def.grid.map(r => r.split(''));
    this.abilities = abilitiesFor(Save.data.unlocked);
    this.items = []; this.enemies = []; this.movers = []; this.shots = []; this.parts = [];
    this.hints = []; this.signs = []; this.checks = []; this.goal = null; this.boss = null;
    this.crumbles = new Map(); this.springs = new Map(); this.chunks = new Map();
    this.time = carry.time || 0; this.deaths = carry.deaths || 0;
    this.clock = 0; this.mode = 'play'; this.modeT = 0;
    this.banner = carry.time ? 0 : 3.2; this.shake = 0; this.hitstop = 0;
    this.honey = 0; this.honeyHeal = 0;

    const rec = Save.level(this.def.id);
    this.prevGold = rec.h; this.prevSigns = rec.s;
    this.goldGot = 0; this.signGot = 0;
    let gi = 0, si = 0;
    for (const e of this.def.ents) {
      switch (e.type) {
        case 'P': this.spawn = { x: e.x * T + (T - 20) / 2, y: (e.y + 1) * T - 30 }; break;
        case 'h': this.items.push(new Gold(e.x, e.y, gi, !!(rec.h & (1 << gi)))); gi++; break;
        case 'o': this.items.push(new Honey(e.x, e.y)); break;
        case '+': this.items.push(new Heart(e.x, e.y)); break;
        case 'S': this.signs.push(new Sign(e.x, e.y, e.text, si, !!(rec.s & (1 << si)))); si++; break;
        case 'C': this.checks.push(new Checkpoint(e.x, e.y)); break;
        case 'G': this.goal = new Goal(e.x, e.y); break;
        case 'M': this.movers.push(new Mover(e.x, e.y, e.n, e.dx, e.dy, e.speed)); break;
        case 'hint': this.hints.push(new Hint(e.x, e.y, e.text, e.touch)); break;
        case 'g': this.enemies.push(new Shush(e.x, e.y)); break;
        case 'z': this.enemies.push(new Hornet(e.x, e.y, e.range)); break;
        case 'k': this.enemies.push(new Hedgehog(e.x, e.y)); break;
        case 'd': this.enemies.push(new Hound(e.x, e.y)); break;
        case 'q': this.enemies.push(new Ghost(e.x, e.y)); break;
        case 't': this.enemies.push(new Shusher(e.x, e.y, e.dir)); break;
        case 'W': this.boss = new Hush(this); this.enemies.push(this.boss); break;
      }
    }
    this.goldTotal = gi; this.signTotal = si;
    this.checkpoint = Object.assign({}, this.spawn);
    this.safe = Object.assign({}, this.spawn);
    this.player = new Player(this.spawn.x, this.spawn.y);
    this.backdrop = getBackdrop(this.themeName);
    this.cam = { x: 0, y: 0 };
    this.updateCam(1, true);
  }

  /* ---------- tile queries ---------- */

  tileAt(tx, ty) {
    if (ty < 0 || ty >= this.h) return ' ';
    if (tx < 0 || tx >= this.w) return '#';
    return this.tiles[ty][tx];
  }
  solidAt(tx, ty) {
    if (tx < 0 || tx >= this.w) return true;
    if (ty < 0 || ty >= this.h) return false;
    const c = this.tiles[ty][tx];
    return c === '#' || c === 'B' || c === 'D' || c === 'J';
  }
  oneWayAt(tx, ty) {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return false;
    const c = this.tiles[ty][tx];
    if (c === '=') return true;
    if (c === 'X') return !this.crumbleState(tx, ty).gone;
    if (c === 'L') return ty === 0 || this.tiles[ty - 1][tx] !== 'L';
    return false;
  }
  ladderAt(px, py) {
    return this.tileAt(Math.floor(px / T), Math.floor(py / T)) === 'L';
  }
  onOneWay(b) {
    if (b.rider) return true;
    const ty = Math.floor((b.y + b.h + 1) / T);
    let any = false;
    for (let tx = Math.floor(b.x / T); tx <= Math.floor((b.x + b.w - 0.01) / T); tx++) {
      if (this.solidAt(tx, ty)) return false;
      if (this.oneWayAt(tx, ty)) any = true;
    }
    return any;
  }

  /* ---------- movement against tiles and moving planks ---------- */

  moveBody(b, dt, o = {}) {
    const dx = b.vx * dt + (b.carryX || 0);
    b.hitWall = 0;
    if (dx) {
      b.x += dx;
      const y0 = Math.floor(b.y / T), y1 = Math.floor((b.y + b.h - 0.01) / T);
      const tx = dx > 0 ? Math.floor((b.x + b.w - 0.01) / T) : Math.floor(b.x / T);
      for (let ty = y0; ty <= y1; ty++) {
        if (!this.solidAt(tx, ty)) continue;
        if (o.dash && this.tileAt(tx, ty) === 'D') { this.breakTile(tx, ty); continue; }
        if (dx > 0) { b.x = tx * T - b.w; b.hitWall = 1; }
        else { b.x = (tx + 1) * T; b.hitWall = -1; }
        b.vx = 0;
        break;
      }
    }

    const prevBottom = b.y + b.h;
    const dy = b.vy * dt + (b.carryY || 0);
    b.y += dy;
    b.onGround = false; b.rider = null; b.groundCh = null;
    const x0 = Math.floor(b.x / T), x1 = Math.floor((b.x + b.w - 0.01) / T);
    if (dy > 0) {
      const ty = Math.floor((b.y + b.h) / T);
      let best = null;
      for (let tx = x0; tx <= x1; tx++) {
        const solid = this.solidAt(tx, ty);
        const plank = !solid && !b.dropT && !o.ignoreOneWay && prevBottom <= ty * T + 0.5 && this.oneWayAt(tx, ty);
        if (solid || plank) {
          const ch = this.tileAt(tx, ty);
          if (!best || ch === 'J') best = { tx, ch };
        }
      }
      if (best) {
        b.y = ty * T - b.h; b.vy = 0; b.onGround = true;
        b.groundCh = best.ch; b.groundTx = best.tx; b.groundTy = ty;
      }
    } else if (dy < 0) {
      const ty = Math.floor(b.y / T);
      for (let tx = x0; tx <= x1; tx++) {
        if (this.solidAt(tx, ty)) { b.y = (ty + 1) * T; b.vy = Math.max(0, b.vy); break; }
      }
    }

    if (o.canRide && !b.onGround && b.vy >= 0 && !b.dropT) {
      for (const m of this.movers) {
        if (b.x + b.w > m.x + 2 && b.x < m.x + m.w - 2 && prevBottom <= m.y + 3 && b.y + b.h >= m.y) {
          b.y = m.y - b.h; b.vy = 0; b.onGround = true; b.rider = m; b.groundCh = 'M';
          break;
        }
      }
    }
  }

  breakTile(tx, ty) {
    // breaks the whole connected cluster of the same block
    const ch = this.tiles[ty][tx];
    const todo = [[tx, ty]];
    while (todo.length) {
      const [x, y] = todo.pop();
      if (this.tileAt(x, y) !== ch || x < 0 || x >= this.w) continue;
      this.shatter(x, y, ch);
      todo.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    Sound.play('brk');
    this.shakeIt(5);
  }

  shatter(tx, ty, ch) {
    this.tiles[ty][tx] = ' ';
    const color = ch === 'D' ? '#7f9ab8' : '#b8643c';
    for (let i = 0; i < 6; i++) {
      this.part({ x: tx * T + rand(4, 28), y: ty * T + rand(4, 28), vx: rand(-160, 160), vy: rand(-320, -60), g: 1200,
        life: rand(0.5, 0.9), size: rand(4, 8), color, kind: 'sq', vr: rand(-10, 10) });
    }
    for (let j = ty - 1; j <= ty + 1; j++) for (let i = tx - 1; i <= tx + 1; i++) {
      this.chunks.delete(Math.floor(i / CHUNK) + ',' + Math.floor(j / CHUNK));
    }
  }

  crumbleState(tx, ty) {
    const k = ty * this.w + tx;
    let s = this.crumbles.get(k);
    if (!s) { s = { shake: 0, gone: false, timer: 0 }; this.crumbles.set(k, s); }
    return s;
  }
  crumbleTouch(tx, ty) {
    const s = this.crumbleState(tx, ty);
    if (!s.gone && s.shake <= 0) { s.shake = 0.5; Sound.play('crumble'); }
  }
  springHit(tx, ty) { this.springs.set(ty * this.w + tx, 1); }
  springSquash(tx, ty) {
    const v = this.springs.get(ty * this.w + tx) || 0;
    return Math.sin(v * Math.PI * 2.5) * v * 0.9;
  }
  updateTiles(dt) {
    for (const [k, s] of this.crumbles) {
      const tx = k % this.w, ty = Math.floor(k / this.w);
      if (s.shake > 0) {
        s.shake -= dt;
        if (s.shake <= 0) {
          s.shake = 0; s.gone = true; s.timer = 3;
          for (let i = 0; i < 5; i++) {
            this.part({ x: tx * T + rand(2, 30), y: ty * T + 4, vx: rand(-40, 40), vy: rand(-60, 20), g: 900,
              life: 0.8, size: rand(4, 7), color: this.theme.plank, kind: 'sq', vr: rand(-6, 6) });
          }
        }
      } else if (s.gone) {
        s.timer -= dt;
        if (s.timer <= 0 && !overlap({ x: tx * T, y: ty * T - 4, w: T, h: T }, this.player)) s.gone = false;
      }
    }
    for (const [k, v] of this.springs) {
      const nv = v - dt * 3;
      if (nv <= 0) this.springs.delete(k); else this.springs.set(k, nv);
    }
  }

  /* ---------- the step ---------- */

  update(dt) {
    this.clock += dt;
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    this.modeT += dt;
    this.banner = Math.max(0, this.banner - dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    for (const m of this.movers) m.update(dt);
    this.updateTiles(dt);
    const p = this.player;

    if (this.mode === 'play') {
      this.time += dt;
      p.carryX = p.rider ? p.rider.dx : 0;
      p.carryY = p.rider ? p.rider.dy : 0;
      p.update(dt, this);
      this.hammerTiles();
      if (this.mode === 'play') this.checkHazards();
    } else if (this.mode === 'dying') {
      if (this.modeT > 1.3) this.respawn();
    } else if (this.mode === 'complete' || this.mode === 'won') {
      p.t += dt;
      p.carryX = p.rider ? p.rider.dx : 0;
      p.carryY = p.rider ? p.rider.dy : 0;
      p.vx = approach(p.vx, 0, 900 * dt);
      p.vy = Math.min(p.vy + PHYS.grav * dt, PHYS.maxFall);
      p.hovering = false; p.dashT = 0;
      this.moveBody(p, dt, { canRide: true });
      if (p.onGround && this.modeT > 0.4) { p.vy = -430; p.sqx = 0.8; p.sqy = 1.2; }
      if (this.modeT % 0.25 < dt) this.confetti(p.cx + rand(-200, 200), this.cam.y - 10);
    }

    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.enemies = this.enemies.filter(e => !e.dead);
    for (const s of this.shots) s.update(dt, this);
    this.shots = this.shots.filter(s => !s.dead);
    if (this.mode === 'play') this.collide();
    this.updateParts(dt);
    this.updateCam(dt);
  }

  collide() {
    const p = this.player;
    const hb = p.hammerBox();
    for (const e of this.enemies) {
      if (e.dead || this.mode !== 'play') continue;
      if (e.isBoss) { this.collideBoss(e, p, hb); continue; }
      if (hb && e.hammerable && !p.hammerHits.has(e) && overlap(hb, e)) {
        p.hammerHits.add(e);
        e.hit(this, 'hammer');
        this.hitstop = 0.04;
        this.shakeIt(3);
        continue;
      }
      if (!overlap(p, e)) continue;
      const fromAbove = p.vy > 0 && p.prevBottom <= e.y + 10;
      if (fromAbove && (e.stompable || e.bouncy)) {
        if (e.stompable) e.hit(this, 'stomp'); else Sound.play('stomp');
        p.vy = Input.held('jump') || Input.held('up') ? -PHYS.stompBounceHeld : -PHYS.stompBounce;
        p.y = e.y - p.h;
        p.jumping = false; p.airDash = true; p.hoverFuel = PHYS.hoverTime;
        p.sqx = 0.8; p.sqy = 1.25;
        continue;
      }
      p.hurt(this, e.cx);
    }
    for (const s of this.shots) {
      if (s.dead || this.mode !== 'play') continue;
      if (hb && s.kind === 'shh' && overlap(hb, s)) {
        s.dead = true;
        Sound.play('whack');
        this.poof(s.x + s.w / 2, s.y + s.h / 2, '#d7d0ff');
        continue;
      }
      if (overlap(p, s)) {
        p.hurt(this, s.x + s.w / 2);
        if (s.kind === 'shh') s.dead = true;
      }
    }
    if (this.mode !== 'play') return;
    for (const it of this.items) if (!it.taken && overlap(p, it)) it.collect(this);
    for (const s of this.signs) if (!s.restored && overlap(p, s)) s.restore(this);
    for (const c of this.checks) if (!c.active && overlap(p, c)) c.activate(this);
    if (this.goal && p.cx > this.goal.x + T * 1.5 && p.y + p.h > this.goal.y) this.complete();
  }

  hammerTiles() {
    const p = this.player, hb = p.hammerBox();
    if (!hb || p.hammerTilesDone) return;
    p.hammerTilesDone = true;
    let broke = false, steel = null;
    for (let ty = Math.floor(hb.y / T); ty <= Math.floor((hb.y + hb.h - 1) / T); ty++) {
      for (let tx = Math.floor(hb.x / T); tx <= Math.floor((hb.x + hb.w - 1) / T); tx++) {
        const ch = this.tileAt(tx, ty);
        if (ch === 'B') { this.breakTile(tx, ty); broke = true; }
        else if (ch === 'D' && !steel) steel = [tx, ty];
      }
    }
    if (steel && !broke) {
      Sound.play('clang');
      this.sparkle(steel[0] * T + T / 2, steel[1] * T + T / 2, '#ffffff', 6);
      this.popText(steel[0] * T + T / 2, steel[1] * T - 4, this.abilities.haste ? 'DASH IT!' : 'TOO TOUGH', '#cfe0f2', 14);
    }
  }

  collideBoss(b, p, hb) {
    if (b.state === 'dead' || b.state === 'intro') return;
    const box = b.hitbox();
    if (hb && !p.hammerHits.has(b) && overlap(hb, box)) {
      p.hammerHits.add(b);
      if (!b.bossHit(this)) { Sound.play('clang'); this.sparkle(hb.x + hb.w / 2, hb.y + hb.h / 2, '#ffffff', 5); }
      return;
    }
    if (!overlap(p, box)) return;
    if (b.state === 'stunned' && p.vy > 0 && p.prevBottom <= box.y + 30) {
      b.bossHit(this);
      p.vy = -PHYS.stompBounceHeld;
      p.y = box.y - p.h;
      p.airDash = true; p.hoverFuel = PHYS.hoverTime;
      return;
    }
    if (b.state === 'stunned' || b.state === 'hurt') return;
    p.hurt(this, b.cx);
  }

  checkHazards() {
    const p = this.player;
    if (p.y > this.h * T + 40) { this.fall(false); return; }
    if (this.tileAt(Math.floor(p.cx / T), Math.floor((p.y + p.h - 8) / T)) === '~') { this.fall(true); return; }
    const x0 = Math.floor((p.x + 4) / T), x1 = Math.floor((p.x + p.w - 4) / T);
    const y0 = Math.floor((p.y + 4) / T), y1 = Math.floor((p.y + p.h - 1) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.tileAt(tx, ty) === '^' && p.y + p.h > ty * T + 16) {
          if (p.hurt(this, p.cx + p.face * 10)) p.vy = -540;
          return;
        }
      }
    }
    if (p.onGround && p.groundCh === '#') {
      const row = Math.floor((p.y + p.h - 1) / T);
      let ok = true;
      for (let tx = Math.floor(p.x / T) - 1; tx <= Math.floor((p.x + p.w) / T) + 1; tx++) {
        const below = this.tileAt(tx, row + 1);
        if (this.tileAt(tx, row) === '^' || (!this.solidAt(tx, row + 1) && below !== '=')) ok = false;
      }
      if (ok) this.safe = { x: p.x, y: p.y };
    }
  }

  fall(water) {
    const p = this.player;
    Sound.play(water ? 'splash' : 'fall');
    if (water) {
      for (let i = 0; i < 14; i++) {
        this.part({ x: p.cx + rand(-10, 10), y: p.y + p.h - 4, vx: rand(-120, 120), vy: rand(-380, -120), g: 1100,
          life: rand(0.4, 0.8), size: rand(3, 6), color: '#bfe6ff', kind: 'dot' });
      }
    }
    p.hp--;
    if (p.hp <= 0) { this.die(); return; }
    p.x = this.safe.x; p.y = this.safe.y; p.vx = 0; p.vy = 0;
    p.inv = 1.5; p.dashT = 0; p.climbing = false; p.rider = null; p.knock = 0;
    this.hitstop = 0.18;
    this.poof(p.cx, p.cy, '#ffffff');
    this.updateCam(1, true);
  }

  die() {
    if (this.mode !== 'play') return;
    this.mode = 'dying';
    this.modeT = 0;
    this.deaths++;
    Save.data.deaths++;
    Sound.play('die');
    this.shakeIt(8);
    const p = this.player;
    for (let i = 0; i < 16; i++) {
      this.part({ x: p.cx, y: p.cy, vx: rand(-260, 260), vy: rand(-460, -80), g: 1200, life: rand(0.7, 1.2),
        size: rand(4, 8), color: i % 3 ? HANK : HANK_DARK, kind: 'sq', vr: rand(-12, 12) });
    }
    this.part({ x: p.cx, y: p.y, vy: -60, life: 1.2, kind: 'text', text: 'h…', color: '#ffffff', size: 22 });
  }

  respawn() {
    if (this.boss) { this.mode = 'rebuild'; return; }
    const p = this.player, cp = this.checkpoint;
    p.x = cp.x; p.y = cp.y; p.vx = 0; p.vy = 0;
    p.hp = p.maxHp; p.inv = 1.2; p.dashT = 0; p.climbing = false; p.rider = null; p.hammerT = 0; p.knock = 0;
    this.mode = 'play';
    this.modeT = 0;
    this.shots = [];
    this.updateCam(1, true);
  }

  complete() {
    if (this.mode !== 'play') return;
    this.mode = 'complete';
    this.modeT = 0;
    Music.stop();
    Sound.play('goal');
    for (let i = 0; i < 6; i++) this.confetti(this.goal.x + T * 1.5 + rand(-40, 40), this.goal.y);
    this.result = this.saveResult();
  }

  bossDefeated() {
    this.mode = 'won';
    this.modeT = 0;
    Music.stop();
    Sound.play('goal');
    this.shots = [];
    for (const e of this.enemies) if (!e.isBoss) { e.dead = true; this.poof(e.cx, e.cy, '#a49cc4'); }
    this.result = this.saveResult();
    Save.data.beaten = true;
    Save.write();
  }

  persist() {
    // golden H's and signs count the moment you get them, finished level or not
    const rec = Save.level(this.def.id);
    Save.setLevel(this.def.id, Object.assign({}, rec, { h: rec.h | this.goldGot, s: rec.s | this.signGot }));
    Save.write();
  }

  saveResult() {
    const id = this.def.id;
    const rec = Save.level(id);
    const newBest = !rec.best || this.time < rec.best;
    const out = { done: true, h: rec.h | this.goldGot, s: rec.s | this.signGot, best: newBest ? this.time : rec.best };
    Save.setLevel(id, out);
    const before = Save.data.unlocked;
    Save.data.unlocked = Math.max(before, Math.min(this.index + 1, LEVELS.length - 1));
    let gift = null;
    const next = LEVELS[this.index + 1];
    if (next && next.world !== this.def.world) {
      const g = WORLDS[next.world].gift;
      if (g && !Save.data.gifts[g]) { gift = g; Save.data.gifts[g] = true; }
    }
    Save.write();
    const gScore = this.goldTotal ? bits(out.h) / this.goldTotal : 1;
    const sScore = this.signTotal ? bits(out.s) / this.signTotal : 1;
    const score = (gScore + sScore) / 2;
    const rank = score >= 1 ? (this.deaths === 0 ? 'HISTORIC' : 'HEROIC') : score >= 0.7 ? 'HANDY' : score >= 0.4 ? 'HOPEFUL' : 'HUMBLE';
    return {
      gold: out.h, newGold: this.goldGot & ~this.prevGold, signs: out.s, newSigns: this.signGot & ~this.prevSigns,
      time: this.time, best: out.best, newBest, deaths: this.deaths, honey: this.honey, gift, rank,
    };
  }

  /* ---------- effects ---------- */

  shakeIt(a) { if (Save.data.shake && !reducedMotion) this.shake = Math.max(this.shake, a); }
  addShot(s) { this.shots.push(s); }
  part(o) {
    const p = Object.assign({ vx: 0, vy: 0, g: 0, life: 0.6, size: 4, color: '#fff', kind: 'dot', rot: 0, vr: 0 }, o);
    p.max = p.life;
    this.parts.push(p);
  }
  dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.part({ x: x + rand(-8, 8), y: y - 2, vx: rand(-70, 70), vy: rand(-90, -20), g: 150, life: rand(0.25, 0.45),
        size: rand(2.5, 5), color: 'rgba(255,255,255,0.75)', kind: 'dot' });
    }
  }
  poof(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.part({ x, y, vx: Math.cos(a) * rand(80, 160), vy: Math.sin(a) * rand(80, 160), life: 0.4, size: rand(4, 7), color, kind: 'dot' });
    }
  }
  sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(60, 220);
      this.part({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 200, life: rand(0.4, 0.8), size: rand(3, 6), color, kind: 'star', vr: rand(-6, 6) });
    }
  }
  popText(x, y, text, color, size = 16) {
    this.part({ x, y, vy: -55, life: 1.1, kind: 'text', text, color, size });
  }
  afterimage(p) {
    this.part({ x: p.cx, y: p.y + p.h + 1, life: 0.22, kind: 'ghost', face: p.face });
  }
  confetti(x, y) {
    const colors = [GOLD, HANK, '#7fd36b', '#6cb7ff', '#f7f0e3'];
    for (let i = 0; i < 6; i++) {
      this.part({ x: x + rand(-30, 30), y, vx: rand(-80, 80), vy: rand(20, 120), g: 160, life: rand(1.6, 2.6),
        size: rand(4, 7), color: pick(colors), kind: 'sq', vr: rand(-8, 8) });
    }
  }
  burstH(x, y, n) {
    for (let i = 0; i < n; i++) {
      this.part({ x, y, vx: rand(-220, 220), vy: rand(-380, -120), g: 500, life: rand(0.9, 1.5), size: rand(14, 22), kind: 'H', vr: rand(-4, 4) });
    }
  }
  addHoney(x, y) {
    this.honey++;
    this.honeyHeal++;
    Sound.play('honey', this.honey);
    this.sparkle(x, y, '#ffcf5a', 4);
    const p = this.player;
    if (this.honeyHeal >= 25) {
      this.honeyHeal = 0;
      if (p.hp < p.maxHp) { p.hp++; Sound.play('heart'); this.popText(p.cx, p.y - 10, '+1', '#ff8fa4', 18); }
    }
  }

  updateParts(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter(p => p.life > 0);
  }

  updateCam(dt, snap) {
    const p = this.player;
    const maxX = Math.max(0, this.w * T - VW), maxY = Math.max(0, this.h * T - VH);
    const tx = this.def.boss ? 0 : clamp(p.cx + p.face * 60 - VW / 2, 0, maxX);
    const ty = this.def.boss ? maxY : clamp(p.y + p.h / 2 - VH * 0.56, 0, maxY);
    if (snap) { this.cam.x = tx; this.cam.y = ty; return; }
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 5);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);
  }

  /* ---------- drawing ---------- */

  chunk(i, j) {
    const key = i + ',' + j;
    const s = Game.cacheScale;
    const e = this.chunks.get(key);
    if (e && e.s === s) return e.cv;
    const S = CHUNK * T, P = T;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil((S + P * 2) * s);
    cv.height = Math.ceil((S + P * 2) * s);
    const g = cv.getContext('2d');
    g.scale(s, s);
    g.translate(-i * S + P, -j * S + P);
    for (let ty = j * CHUNK - 1; ty <= (j + 1) * CHUNK; ty++) {
      if (ty < 0 || ty >= this.h) continue;
      for (let tx = i * CHUNK - 1; tx <= (i + 1) * CHUNK; tx++) {
        if (tx < 0 || tx >= this.w) continue;
        const ch = this.tiles[ty][tx];
        if (ch === '#' || ch === '=' || ch === 'L' || ch === '^') drawStaticTile(g, this, tx, ty, ch, this.theme);
      }
    }
    this.chunks.set(key, { cv, s });
    return cv;
  }

  drawTiles(c, cx, cy, t) {
    const S = CHUNK * T, s = Game.cacheScale;
    const i0 = Math.max(0, Math.floor(cx / S)), i1 = Math.min(Math.ceil(this.w / CHUNK) - 1, Math.floor((cx + VW) / S));
    const j0 = Math.max(0, Math.floor(cy / S)), j1 = Math.min(Math.ceil(this.h / CHUNK) - 1, Math.floor((cy + VH) / S));
    const pad = 1 / Game.scale;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        c.drawImage(this.chunk(i, j), T * s, T * s, S * s, S * s, i * S, j * S, S + pad, S + pad);
      }
    }
    const tx0 = Math.max(0, Math.floor(cx / T)), tx1 = Math.min(this.w - 1, Math.floor((cx + VW) / T));
    const ty0 = Math.max(0, Math.floor(cy / T)), ty1 = Math.min(this.h - 1, Math.floor((cy + VH) / T));
    for (let ty = ty0; ty <= ty1; ty++) {
      const row = this.tiles[ty];
      for (let tx = tx0; tx <= tx1; tx++) {
        const ch = row[tx];
        if (ch === 'B' || ch === 'D' || ch === 'X' || ch === 'J') drawDynamicTile(c, this, tx, ty, ch, this.theme, t);
      }
    }
  }

  drawWater(c, cx, cy, t) {
    const tx0 = Math.max(0, Math.floor(cx / T)), tx1 = Math.min(this.w - 1, Math.floor((cx + VW) / T));
    const ty0 = Math.max(0, Math.floor(cy / T)), ty1 = Math.min(this.h - 1, Math.floor((cy + VH) / T));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) if (this.tiles[ty][tx] === '~') drawWaterTile(c, this, tx, ty, this.theme, t);
    }
  }

  drawParts(c) {
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      c.globalAlpha = p.kind === 'text' ? Math.min(1, a * 2) : a;
      switch (p.kind) {
        case 'dot':
          c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, 7); c.fill();
          break;
        case 'sq':
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color;
          c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); c.restore();
          break;
        case 'star': {
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color;
          const s = p.size;
          c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.3, -s * 0.3); c.lineTo(s, 0); c.lineTo(s * 0.3, s * 0.3);
          c.lineTo(0, s); c.lineTo(-s * 0.3, s * 0.3); c.lineTo(-s, 0); c.lineTo(-s * 0.3, -s * 0.3); c.fill();
          c.restore();
          break;
        }
        case 'text':
          outlined(c, p.text, p.x, p.y, p.size, p.color, INK, 4);
          break;
        case 'H':
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
          drawGlyphH(c, 0, 0, p.size, GOLD, GOLD_DARK);
          c.restore();
          break;
        case 'ghost':
          drawHank(c, p.x, p.y, { face: p.face, color: '#ffb4a3', edge: '#ffb4a3', blink: true });
          break;
      }
    }
    c.globalAlpha = 1;
  }

  drawAmbient(c, t) {
    if (this.theme.snow) {
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 70; i++) {
        const sp = 30 + hash2(i, 5) * 50;
        const x = (((hash2(i, 1) * VW * 1.2 + Math.sin(t * 0.8 + i) * 24 - this.cam.x * 0.6) % (VW + 40)) + VW + 40) % (VW + 40) - 20;
        const y = (((hash2(i, 2) * VH + t * sp - this.cam.y * 0.6) % (VH + 20)) + VH + 20) % (VH + 20) - 10;
        c.globalAlpha = 0.5 + hash2(i, 3) * 0.5;
        c.beginPath(); c.arc(x, y, 1.2 + hash2(i, 4) * 2, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    } else if (this.themeName === 'haunted' || this.themeName === 'hush') {
      c.fillStyle = '#d7d0ff';
      for (let i = 0; i < 26; i++) {
        const x = ((hash2(i, 1) * VW + Math.sin(t * 0.3 + i) * 40 - this.cam.x * 0.2) % VW + VW) % VW;
        const y = ((hash2(i, 2) * VH - t * (6 + hash2(i, 3) * 10)) % VH + VH) % VH;
        c.globalAlpha = 0.15 + 0.25 * Math.abs(Math.sin(t + i));
        c.beginPath(); c.arc(x, y, 1.5, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  draw(c) {
    const t = this.clock;
    let cx = this.cam.x, cy = this.cam.y;
    if (this.shake > 0) { cx += rand(-1, 1) * this.shake; cy += rand(-1, 1) * this.shake; }
    this.backdrop.draw(c, cx, cy, t, this.h * T);
    if (this.boss && this.mode === 'won') {
      const a = clamp(this.modeT / 3, 0, 1);
      const g = c.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, '#ff9e6b'); g.addColorStop(0.6, '#ffd89a'); g.addColorStop(1, '#bfe8f0');
      c.globalAlpha = a; c.fillStyle = g; c.fillRect(0, 0, VW, VH); c.globalAlpha = 1;
    }
    const k = Game.scale;
    const rx = Math.round(cx * k) / k, ry = Math.round(cy * k) / k;
    c.save();
    c.translate(-rx, -ry);
    this.drawTiles(c, rx, ry, t);
    for (const h of this.hints) h.draw(c, this, t);
    for (const s of this.signs) s.draw(c, this, t);
    for (const ch of this.checks) ch.draw(c, t);
    if (this.goal) this.goal.draw(c, t, this);
    for (const it of this.items) if (!it.taken) it.draw(c, t);
    for (const m of this.movers) m.draw(c, this.theme);
    for (const e of this.enemies) e.draw(c, t);
    if (this.mode !== 'dying') this.player.draw(c, this, t);
    for (const s of this.shots) s.draw(c, t);
    this.drawWater(c, rx, ry, t);
    this.drawParts(c);
    c.restore();
    this.drawAmbient(c, t);
    this.drawHUD(c, t);
  }

  drawHUD(c, t) {
    const p = this.player;
    c.fillStyle = 'rgba(18,16,31,0.62)';
    rrect(c, 12, 10, 252, this.goldTotal ? 70 : 42, 12); c.fill();
    for (let i = 0; i < p.maxHp; i++) {
      const full = i < p.hp;
      const beat = full && i === p.hp - 1 && p.hp === 1 ? 1 + Math.abs(Math.sin(t * 6)) * 0.15 : 1;
      drawHeart(c, 34 + i * 30, 30, 22 * beat, full ? '#ff4d6d' : null, full ? '#7a1630' : '#8a84a8');
    }
    drawHoney(c, 136, 29, 0);
    text(c, String(this.honey), 150, 37, 18, '#fbf6ea', 'left', FONT);
    if (this.signTotal) {
      const n = bits(this.prevSigns | this.signGot);
      c.fillStyle = '#e7cf9d'; rrect(c, 196, 20, 22, 15, 3); c.fill();
      c.fillStyle = '#5a3a22'; c.fillRect(205, 35, 4, 8);
      text(c, 'H', 207, 33, 11, '#5a3a22', 'center', FONT);
      text(c, n + '/' + this.signTotal, 224, 37, 15, n === this.signTotal ? GOLD : '#fbf6ea', 'left', FONT);
    }
    for (let i = 0; i < this.goldTotal; i++) {
      const x = 32 + i * 26, y = 60;
      const now = this.goldGot & (1 << i), before = this.prevGold & (1 << i);
      if (now) drawGlyphH(c, x, y, 18, GOLD, GOLD_DARK);
      else if (before) { c.globalAlpha = 0.5; drawGlyphH(c, x, y, 18, '#d8d2ff', '#6e66a8'); c.globalAlpha = 1; }
      else { c.globalAlpha = 0.35; drawGlyphH(c, x, y, 18, '#5d5677', null); c.globalAlpha = 1; }
    }
    const label = this.def.id + '  ' + this.def.name.toUpperCase();
    c.font = '13px ' + FONT;
    const lw = Math.max(c.measureText(label).width, 90) + 28;
    c.fillStyle = 'rgba(18,16,31,0.62)';
    rrect(c, VW - 12 - lw, 10, lw, 56, 12); c.fill();
    text(c, label, VW - 26, 30, 13, this.world.color, 'right', FONT);
    text(c, fmtTime(this.time), VW - 26, 56, 22, '#fbf6ea', 'right', FONT);

    if (this.boss) {
      const b = this.boss;
      const bw = 300, bx = VW / 2 - bw / 2;
      c.fillStyle = 'rgba(18,16,31,0.7)'; rrect(c, bx - 12, 14, bw + 24, 44, 10); c.fill();
      text(c, 'THE HUSH', VW / 2, 31, 13, '#d7d0ff', 'center', FONT);
      for (let i = 0; i < b.maxHp; i++) {
        const sw = (bw - (b.maxHp - 1) * 6) / b.maxHp;
        c.fillStyle = i < b.hp ? '#9a8fe0' : '#3a3550';
        rrect(c, bx + i * (sw + 6), 38, sw, 10, 4); c.fill();
      }
      if (b.state === 'stunned' && Math.sin(t * 10) > 0) outlined(c, 'BONK IT NOW!', VW / 2, 96, 22, GOLD, INK, 5);
    }

    if (this.banner > 0) {
      const a = Math.min(1, (3.2 - this.banner) * 4, this.banner * 2);
      c.globalAlpha = a;
      const y = 150 - (1 - a) * 20;
      outlined(c, this.world.name.toUpperCase(), VW / 2, y, 18, this.world.color, INK, 5);
      outlined(c, this.def.name.toUpperCase(), VW / 2, y + 44, 40, '#fbf6ea', INK, 8);
      c.globalAlpha = 1;
    }
  }
}
