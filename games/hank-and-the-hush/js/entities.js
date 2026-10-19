'use strict';
/* Hank, the enemies, the Hush, and every pickup and prop in a level. */

class Player {
  constructor(x, y) {
    this.w = 20; this.h = 30;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.face = 1; this.onGround = false; this.coyote = 0; this.buffer = 0;
    this.jumping = false; this.hoverFuel = PHYS.hoverTime; this.hovering = false;
    this.dashT = 0; this.dashCD = 0; this.airDash = true; this.ghostT = 0;
    this.hammerT = 0; this.hammerHits = new Set();
    this.inv = 0; this.hp = 3; this.maxHp = 3; this.knock = 0;
    this.climbing = false; this.dropT = 0; this.rider = null;
    this.carryX = 0; this.carryY = 0; this.prevBottom = y + this.h;
    this.sqx = 1; this.sqy = 1; this.t = 0;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(dt, st) {
    const ab = st.abilities;
    this.t += dt;
    this.prevBottom = this.y + this.h;
    const L = Input.held('left'), R = Input.held('right'), U = Input.held('up'), D = Input.held('down');
    const midCol = this.ladderCol(st, this.y + this.h * 0.5);
    const feetCol = this.ladderCol(st, this.y + this.h + 4);
    const ladderMid = midCol >= 0, ladderFeet = feetCol >= 0;
    const nearLadder = ladderMid || (this.onGround && ladderFeet);
    const jumpPressed = Input.pressed('jump') || (Input.pressed('up') && !nearLadder && !this.climbing);
    const jumpHeld = Input.held('jump') || (Input.held('up') && !this.climbing && !nearLadder);

    this.buffer = jumpPressed ? PHYS.buffer : Math.max(0, this.buffer - dt);
    this.inv = Math.max(0, this.inv - dt);
    this.knock = Math.max(0, this.knock - dt);
    this.dashCD = Math.max(0, this.dashCD - dt);
    this.dropT = Math.max(0, this.dropT - dt);
    this.hammerT = Math.max(0, this.hammerT - dt);
    this.sqx = approach(this.sqx, 1, dt * 3);
    this.sqy = approach(this.sqy, 1, dt * 3);

    // grab a ladder
    if (!this.climbing && this.dashT <= 0 && this.knock <= 0) {
      const grabUp = U && ladderMid;
      const grabDown = D && this.onGround && ladderFeet && !ladderMid;
      if (grabUp || grabDown) {
        this.climbing = true;
        this.vx = 0; this.vy = 0; this.jumping = false; this.rider = null;
        this.x = (grabUp ? midCol : feetCol) * T + T / 2 - this.w / 2;
        if (grabDown) this.y += 6;
      }
    }

    if (this.climbing) {
      const dir = (D ? 1 : 0) - (U ? 1 : 0);
      const sx = (R ? 1 : 0) - (L ? 1 : 0);
      if (sx) this.face = sx;
      if (Input.pressed('jump')) {
        this.climbing = false;
        this.vy = -PHYS.jump * 0.8; this.vx = sx * PHYS.run * 0.7;
        this.jumping = true; this.buffer = 0;
        Sound.play('jump');
        return;
      }
      this.vx = 0;
      this.vy = dir * PHYS.climb;
      this.carryX = this.carryY = 0;
      st.moveBody(this, dt, { ignoreOneWay: true });
      if (dir < 0 && !st.ladderAt(this.cx, this.y + this.h - 2)) {
        // topped out: stand on the top rung
        this.climbing = false; this.vy = 0; this.onGround = true;
        this.y = Math.floor((this.y + this.h) / T) * T - this.h;
      } else if (!st.ladderAt(this.cx, this.y + this.h - 2) && !ladderMid) {
        this.climbing = false;
      }
      if (this.onGround && dir > 0) this.climbing = false;
      return;
    }

    let ax = (R ? 1 : 0) - (L ? 1 : 0);
    if (this.knock > 0) ax = 0;
    const ice = st.theme.ice && this.onGround && this.groundCh === '#';

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.face * PHYS.dashSpeed;
      this.vy = 0;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.025; st.afterimage(this); }
      if (this.dashT <= 0) this.vx = this.face * PHYS.run;
    } else {
      if (ax) this.face = ax;
      let rate;
      if (this.onGround) rate = ax ? (ice ? PHYS.iceAccel : PHYS.accelGround) : ice ? PHYS.iceFriction : PHYS.friction;
      else rate = ax ? PHYS.accelAir : PHYS.airDrag;
      this.vx = approach(this.vx, ax * PHYS.run, rate * dt);
      this.vy = Math.min(this.vy + PHYS.grav * dt, PHYS.maxFall);
    }

    if (this.onGround) {
      this.coyote = PHYS.coyote; this.airDash = true; this.hoverFuel = PHYS.hoverTime;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
    }

    // drop through a plank: down + hop
    if (D && this.buffer > 0 && this.onGround && st.onOneWay(this)) {
      this.dropT = 0.22; this.buffer = 0; this.onGround = false; this.coyote = 0; this.rider = null;
      this.y += 3;
    }

    if (this.buffer > 0 && (this.onGround || this.coyote > 0) && this.dashT <= 0) {
      this.vy = -PHYS.jump;
      this.buffer = 0; this.coyote = 0; this.jumping = true; this.onGround = false; this.rider = null;
      this.sqx = 0.72; this.sqy = 1.32;
      Sound.play('jump');
      st.dust(this.cx, this.y + this.h, 4);
    }
    if (this.jumping && !jumpHeld && this.vy < 0) { this.vy *= PHYS.jumpCut; this.jumping = false; }
    if (this.vy >= 0) this.jumping = false;

    this.hovering = false;
    if (ab.hover && !this.onGround && jumpHeld && this.vy > 0 && this.hoverFuel > 0 && this.dashT <= 0 && this.knock <= 0) {
      this.vy = Math.min(this.vy, PHYS.hoverFall);
      this.hoverFuel -= dt;
      this.hovering = true;
    }

    if (ab.haste && Input.pressed('dash') && this.dashCD <= 0 && (this.onGround || this.airDash) && this.knock <= 0) {
      if (ax) this.face = ax;
      this.dashT = PHYS.dashTime; this.dashCD = PHYS.dashCooldown; this.ghostT = 0;
      if (!this.onGround) this.airDash = false;
      this.vy = 0; this.jumping = false;
      this.sqx = 1.35; this.sqy = 0.75;
      Sound.play('dash');
    }

    if (ab.hammer && Input.pressed('hammer') && this.hammerT <= 0) {
      this.hammerT = 0.3;
      this.hammerHits = new Set();
      this.hammerTilesDone = false;
      Sound.play('hammer');
    }

    const wasGround = this.onGround;
    const fallSpeed = this.vy;
    st.moveBody(this, dt, { dash: this.dashT > 0, canRide: true });

    if (this.onGround && !wasGround && fallSpeed > 250) {
      this.sqx = 1.25; this.sqy = 0.8;
      st.dust(this.cx, this.y + this.h, 3);
      if (fallSpeed > 600) Sound.play('land');
    }
    if (this.onGround && this.groundCh === 'J') {
      this.vy = -PHYS.spring; this.onGround = false; this.jumping = false;
      this.hoverFuel = PHYS.hoverTime; this.airDash = true;
      this.sqx = 0.7; this.sqy = 1.4;
      st.springHit(this.groundTx, this.groundTy);
      Sound.play('spring');
    }
    if (this.onGround && this.groundCh === 'X') {
      for (let tx = Math.floor(this.x / T); tx <= Math.floor((this.x + this.w - 1) / T); tx++) {
        if (st.tileAt(tx, this.groundTy) === 'X') st.crumbleTouch(tx, this.groundTy);
      }
    }
  }

  ladderCol(st, py) {
    // the ladder column under Hank's centre, or failing that under either foot
    for (const px of [this.cx, this.x + 3, this.x + this.w - 3]) if (st.ladderAt(px, py)) return Math.floor(px / T);
    return -1;
  }

  hammerBox() {
    if (this.hammerT <= 0) return null;
    const a = 1 - this.hammerT / 0.3;
    if (a < 0.15 || a > 0.8) return null;
    const w = 36;
    return { x: this.face > 0 ? this.x + this.w - 6 : this.x - w + 6, y: this.y - 8, w, h: this.h + 12 };
  }

  hurt(st, fromX) {
    if (this.inv > 0 || st.mode !== 'play') return false;
    this.hp--;
    this.inv = 1.4; this.knock = 0.28;
    this.vx = (this.cx < fromX ? -1 : 1) * 260;
    this.vy = -380;
    this.dashT = 0; this.climbing = false; this.jumping = false; this.rider = null;
    Sound.play('hurt');
    st.shakeIt(6);
    st.hitstop = 0.06;
    if (this.hp <= 0) st.die();
    return true;
  }

  draw(c, st, t) {
    if (this.inv > 0 && this.knock <= 0 && Math.floor(this.inv * 14) % 2 === 0) return;
    drawHank(c, this.cx, this.y + this.h + 1, {
      face: this.face, t: this.t, run: Math.min(1, Math.abs(this.vx) / PHYS.run),
      air: !this.onGround && !this.climbing, climb: this.climbing && this.vy !== 0,
      sqx: this.sqx, sqy: this.sqy, rotor: this.hovering,
      hammer: this.hammerT > 0 ? 1 - this.hammerT / 0.3 : null, hurt: this.knock > 0,
      lookUp: this.climbing,
    });
  }
}

/* ---------- Enemies ---------- */

class Enemy {
  constructor(tx, ty, w, h) {
    this.w = w; this.h = h;
    this.x = tx * T + (T - w) / 2;
    this.y = (ty + 1) * T - h;
    this.vx = 0; this.vy = 0;
    this.dead = false; this.hp = 1; this.flash = 0;
    this.t = Math.random() * 10; this.face = -1;
    this.stompable = true; this.hammerable = true; this.bouncy = false;
    this.onGround = false; this.puff = '#a49cc4';
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  tick(dt) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
  }
  hit(st, how) {
    this.hp--;
    this.flash = 0.14;
    if (this.hp <= 0) this.kill(st, how);
    else Sound.play('whack');
  }
  kill(st, how) {
    this.dead = true;
    Sound.play(how === 'stomp' ? 'stomp' : 'whack');
    st.poof(this.cx, this.cy, this.puff);
    st.popText(this.cx, this.y - 4, 'shh…', '#e4deff', 14);
  }
}

class Walker extends Enemy {
  walk(dt, st, speed) {
    this.vx = this.face * speed;
    this.vy = Math.min(this.vy + PHYS.grav * dt, PHYS.maxFall);
    st.moveBody(this, dt);
    let turned = false;
    if (this.hitWall) { this.face *= -1; turned = true; }
    else if (this.onGround) {
      const fx = this.face > 0 ? this.x + this.w + 1 : this.x - 1;
      const ftx = Math.floor(fx / T), fty = Math.floor((this.y + this.h + 2) / T);
      const bodyTile = st.tileAt(ftx, Math.floor((this.y + this.h - 4) / T));
      if ((!st.solidAt(ftx, fty) && !st.oneWayAt(ftx, fty)) || bodyTile === '^') { this.face *= -1; turned = true; }
    }
    if (this.y > st.h * T + 64) this.dead = true;
    return turned;
  }
}

class Shush extends Walker {
  constructor(tx, ty) { super(tx, ty, 26, 22); }
  update(dt, st) { this.tick(dt); this.walk(dt, st, 42); }
  draw(c, t) { drawShush(c, this.cx, this.y + this.h, this.w, this.h, this.t, this.face, this.flash > 0); }
}

class Hedgehog extends Walker {
  constructor(tx, ty) {
    super(tx, ty, 28, 18);
    this.stompable = false; this.spiky = true; this.puff = '#8a5a3c';
  }
  update(dt, st) { this.tick(dt); this.walk(dt, st, 30); }
  draw(c, t) { drawHedgehog(c, this.cx, this.y + this.h, this.t, this.face, this.flash > 0); }
}

class Hound extends Walker {
  constructor(tx, ty) {
    super(tx, ty, 30, 28);
    this.mode = 'patrol'; this.mt = 0; this.puff = '#545468';
  }
  update(dt, st) {
    this.tick(dt);
    this.mt += dt;
    const p = st.player;
    const still = () => { this.vx = 0; this.vy = Math.min(this.vy + PHYS.grav * dt, PHYS.maxFall); st.moveBody(this, dt); };
    switch (this.mode) {
      case 'patrol':
        this.walk(dt, st, 45);
        if (st.mode === 'play' && Math.abs(p.cy - this.cy) < 44 && Math.abs(p.cx - this.cx) < 7 * T && Math.sign(p.cx - this.cx) === this.face) {
          this.mode = 'alert'; this.mt = 0;
          Sound.play('bark');
        }
        break;
      case 'alert':
        still();
        if (this.mt > 0.45) { this.mode = 'charge'; this.mt = 0; }
        break;
      case 'charge':
        if (this.walk(dt, st, 270) || this.mt > 1.6) { this.mode = 'rest'; this.mt = 0; }
        else if (this.mt % 0.08 < dt) st.dust(this.cx - this.face * 12, this.y + this.h, 1);
        break;
      case 'rest':
        still();
        if (this.mt > 0.9) { this.mode = 'patrol'; this.mt = 0; }
        break;
    }
  }
  draw(c, t) { drawHound(c, this.cx, this.y + this.h, this.t, this.face, this.mode, this.flash > 0); }
}

class Hornet extends Enemy {
  constructor(tx, ty, range = 2) {
    super(tx, ty, 28, 18);
    this.x0 = this.x; this.y0 = this.y - 6;
    this.range = range * T;
    this.ph = Math.random() * 6;
    this.puff = '#ffcc33';
  }
  update(dt) {
    this.tick(dt);
    this.ph += dt * (80 / Math.max(this.range, 32));
    const nx = this.x0 + Math.sin(this.ph) * this.range;
    if (Math.abs(nx - this.x) > 0.01) this.face = nx > this.x ? 1 : -1;
    this.x = nx;
    this.y = this.y0 + Math.sin(this.t * 3) * 10;
  }
  draw(c, t) { drawHornet(c, this.cx, this.cy, this.t, this.face, this.flash > 0); }
}

class Ghost extends Enemy {
  constructor(tx, ty) {
    super(tx, ty, 26, 28);
    this.stompable = false; this.shy = true; this.puff = '#efeafc';
  }
  update(dt, st) {
    this.tick(dt);
    const p = st.player;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    this.shy = p.face * -dx > 0 || st.mode !== 'play';
    if (!this.shy) {
      const d = Math.hypot(dx, dy) || 1;
      if (d < 12 * T) { this.x += (dx / d) * 58 * dt; this.y += (dy / d) * 58 * dt; }
    }
    this.face = dx > 0 ? 1 : -1;
  }
  draw(c, t) { drawGhost(c, this.cx, this.y + this.h, this.t, this.shy, this.flash > 0); }
}

class Shusher extends Enemy {
  constructor(tx, ty, dir = -1) {
    super(tx, ty, 26, 32);
    this.face = dir; this.hp = 2;
    this.stompable = false; this.bouncy = true;
    this.cool = 1 + Math.random(); this.fireT = 0; this.puff = '#8c88a4';
  }
  update(dt, st) {
    this.tick(dt);
    const p = st.player;
    this.face = p.cx < this.cx ? -1 : 1;
    this.cool -= dt;
    this.fireT = Math.max(0, this.fireT - dt);
    const near = Math.abs(p.cx - this.cx) < 11 * T && Math.abs(p.cy - this.cy) < 2.5 * T;
    if (this.cool <= 0 && near && st.mode === 'play') {
      this.cool = 2.4; this.fireT = 0.3;
      st.addShot(new Shot(this.cx + this.face * 16, this.y + 14, this.face * 170, 0, 'shh'));
      Sound.play('shh');
    }
  }
  draw(c, t) { drawShusher(c, this.cx, this.y + this.h, this.t, this.face, this.fireT > 0, this.flash > 0); }
}

class Shot {
  constructor(x, y, vx, vy, kind) {
    this.kind = kind;
    this.w = kind === 'quake' ? 28 : 22;
    this.h = kind === 'quake' ? 22 : 16;
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.dead = false; this.t = 0; this.life = 6;
  }
  update(dt, st) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const tx = Math.floor((this.x + this.w / 2 + Math.sign(this.vx) * this.w * 0.4) / T);
    const ty = Math.floor((this.y + this.h / 2) / T);
    if (st.solidAt(tx, ty)) {
      this.dead = true;
      st.poof(this.x + this.w / 2, this.y + this.h / 2, this.kind === 'quake' ? '#9a99a8' : '#d7d0ff');
    }
    if (this.kind === 'quake' && this.t % 0.05 < dt) st.dust(this.x + this.w / 2, this.y + this.h, 1);
  }
  draw(c, t) {
    if (this.kind === 'shh') { drawShh(c, this.x + this.w / 2, this.y + this.h / 2, t, Math.sign(this.vx) || 1); return; }
    const x = this.x + this.w / 2, y = this.y + this.h;
    c.fillStyle = '#c9c6d6';
    for (let i = 0; i < 3; i++) {
      const hgt = 10 + Math.abs(Math.sin(this.t * 20 + i)) * 12;
      c.beginPath();
      c.moveTo(x - 12 + i * 8, y); c.lineTo(x - 8 + i * 8, y - hgt); c.lineTo(x - 4 + i * 8, y);
      c.fill();
    }
  }
}

/* ---------- The Hush ---------- */

class Hush extends Enemy {
  constructor(st) {
    super(0, 0, 104, 104);
    this.x = (st.w * T) / 2 - this.w / 2;
    this.homeY = 64;
    this.y = -170;
    this.hp = 6; this.maxHp = 6;
    this.state = 'intro'; this.st = 0;
    this.isBoss = true; this.stompable = false; this.hammerable = false;
    this.fired = false; this.vy = 0;
  }
  phase() { return this.hp > 4 ? 1 : this.hp > 2 ? 2 : 3; }
  set(s) { this.state = s; this.st = 0; }
  hitbox() { return { x: this.x + 16, y: this.y + 16, w: this.w - 32, h: this.h - 24 }; }
  update(dt, st) {
    this.tick(dt);
    this.st += dt;
    const p = st.player, ph = this.phase();
    const sp = [1, 1, 1.25, 1.55][ph];
    const floorY = 14 * T;
    switch (this.state) {
      case 'intro':
        this.y = lerp(-170, this.homeY, easeOut(this.st / 2.2));
        if (this.st > 0.6 && this.st - dt <= 0.6) { Sound.play('shh'); st.popText(this.cx, this.homeY + 140, 'SHHHHHH…', '#d7d0ff', 30); }
        if (this.st > 3) this.set('hover');
        break;
      case 'hover': {
        const tx = clamp(p.cx - this.w / 2, T, st.w * T - T - this.w);
        this.x = approach(this.x, tx, 180 * sp * dt);
        this.y = this.homeY + Math.sin(this.t * 2.5) * 10;
        if (ph >= 2 && !this.fired && this.st > 0.7 && st.mode === 'play') {
          this.fired = true;
          const base = Math.atan2(p.cy - (this.cy + 20), p.cx - this.cx);
          const spread = ph === 3 ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.28, 0, 0.28];
          for (const a of spread) st.addShot(new Shot(this.cx, this.cy + 20, Math.cos(base + a) * 210, Math.sin(base + a) * 210, 'shh'));
          Sound.play('shh');
        }
        if (this.st > 2.1 / sp) this.set('windup');
        break;
      }
      case 'windup':
        if (this.st > 0.6 / sp) { this.set('slam'); this.vy = 0; }
        break;
      case 'slam':
        this.vy += 3400 * dt;
        this.y += this.vy * dt;
        if (this.y + this.h >= floorY) {
          this.y = floorY - this.h;
          this.set('stunned');
          st.shakeIt(14);
          Sound.play('slam');
          st.addShot(new Shot(this.x + 10, floorY - 11, -250 * sp, 0, 'quake'));
          st.addShot(new Shot(this.x + this.w - 10, floorY - 11, 250 * sp, 0, 'quake'));
          for (let i = 0; i < 12; i++) st.dust(this.x + Math.random() * this.w, floorY, 1);
        }
        break;
      case 'stunned':
        if (this.st > 2.5 - ph * 0.3) this.set('rise');
        break;
      case 'hurt':
        if (this.st > 0.55) this.set('rise');
        break;
      case 'rise':
        this.y = approach(this.y, this.homeY, 280 * dt);
        if (this.y <= this.homeY + 0.5) {
          this.set('hover');
          this.fired = false;
          if (ph === 3) {
            const alive = st.enemies.filter(e => !e.dead && e instanceof Shush).length;
            if (alive < 3) { st.enemies.push(new Shush(2, 13)); st.enemies.push(new Shush(st.w - 3, 13)); st.enemies.forEach(e => { if (e instanceof Shush && e.x > st.w * T / 2) e.face = -1; else if (e instanceof Shush) e.face = 1; }); }
          }
        }
        break;
      case 'dead':
        this.y += 30 * dt;
        if (this.st % 0.12 < dt) st.burstH(this.x + Math.random() * this.w, this.y + Math.random() * this.h, 2);
        break;
    }
  }
  bossHit(st) {
    if (this.state !== 'stunned') return false;
    this.hp--;
    this.flash = 0.6;
    Sound.play('bossHit');
    st.shakeIt(10);
    st.hitstop = 0.12;
    st.burstH(this.cx, this.cy, 6);
    if (this.hp <= 0) {
      this.set('dead');
      st.bossDefeated();
    } else {
      this.set('hurt');
      if ((this.hp === 4 || this.hp === 2) && st.player.hp < st.player.maxHp) st.items.push(new Heart(14, 9));
    }
    return true;
  }
  draw(c, t) {
    if (this.state === 'dead') c.globalAlpha = Math.max(0, 1 - this.st / 3);
    drawHush(c, this, t);
    c.globalAlpha = 1;
  }
}

/* ---------- Pickups and props ---------- */

class Gold {
  constructor(tx, ty, idx, had) {
    this.x = tx * T + 4; this.y = ty * T + 2; this.w = 24; this.h = 28;
    this.idx = idx; this.had = had; this.taken = false; this.ph = Math.random() * 6;
  }
  collect(st) {
    this.taken = true;
    st.goldGot |= 1 << this.idx;
    st.persist();
    Sound.play(this.had ? 'goldOld' : 'gold');
    st.sparkle(this.x + 12, this.y + 14, GOLD, 14);
    st.popText(this.x + 12, this.y - 4, this.had ? 'H' : 'H!', GOLD, 22);
  }
  draw(c, t) { drawGoldH(c, this.x + 12, this.y + 14 + Math.sin(t * 2.5 + this.ph) * 3, 24, t + this.ph, this.had); }
}

class Honey {
  constructor(tx, ty) { this.x = tx * T + 8; this.y = ty * T + 8; this.w = 16; this.h = 18; this.taken = false; }
  collect(st) {
    this.taken = true;
    st.addHoney(this.x + 8, this.y + 8);
  }
  draw(c, t) { drawHoney(c, this.x + 8, this.y + 10, t); }
}

class Heart {
  constructor(tx, ty) { this.x = tx * T + 6; this.y = ty * T + 6; this.w = 20; this.h = 20; this.taken = false; }
  collect(st) {
    const p = st.player;
    if (p.hp >= p.maxHp) return;
    this.taken = true;
    p.hp++;
    Sound.play('heart');
    st.sparkle(this.x + 10, this.y + 10, '#ff6f8a', 10);
    st.popText(this.x + 10, this.y - 4, '+1', '#ff8fa4', 18);
  }
  draw(c, t) { drawHeart(c, this.x + 10, this.y + 10 + Math.sin(t * 3) * 2, 20 + Math.sin(t * 6) * 1.5, '#ff4d6d'); }
}

class Sign {
  constructor(tx, ty, word, idx, had) {
    this.word = word; this.idx = idx;
    this.restored = had; this.restoredAt = had ? -100 : null;
    const bw = word.length * 15 + 16;
    this.px = tx * T + T / 2; this.py = (ty + 1) * T;
    this.x = this.px - bw / 2 - 8; this.y = this.py - 60; this.w = bw + 16; this.h = 60;
  }
  restore(st) {
    this.restored = true;
    this.restoredAt = st.clock;
    st.signGot |= 1 << this.idx;
    st.persist();
    Sound.play('sign');
    st.sparkle(this.px, this.py - 40, GOLD, 18);
    st.popText(this.px, this.py - 66, this.word.replace(/_/g, 'H') + '!', GOLD_LIGHT, 22);
  }
  draw(c, st, t) { drawSignBoard(c, this.px, this.py, this.word, this.restoredAt, t, st.clock); }
}

class Checkpoint {
  constructor(tx, ty) {
    this.tx = tx; this.ty = ty;
    this.x = tx * T + 4; this.y = (ty + 1) * T - 64; this.w = 24; this.h = 64;
    this.active = false; this.at = 0;
  }
  activate(st) {
    this.active = true;
    this.at = st.clock;
    st.checkpoint = { x: this.tx * T + (T - 20) / 2, y: (this.ty + 1) * T - 30 };
    st.player.hp = st.player.maxHp;
    Sound.play('check');
    st.sparkle(this.x + 12, this.y + 10, '#ffffff', 12);
    st.popText(this.x + 12, this.y - 8, 'CHECKPOINT', '#ffffff', 14);
  }
  draw(c, t) {
    const x = this.tx * T + 12, y = (this.ty + 1) * T;
    c.fillStyle = '#3a3346'; c.fillRect(x - 6, y - 4, 16, 4);
    c.fillStyle = '#d9d4e6'; c.fillRect(x, y - 62, 4, 60);
    const wave = Math.sin(t * 6) * 3;
    c.fillStyle = this.active ? HANK : '#7d7890';
    c.beginPath();
    c.moveTo(x + 4, y - 62);
    c.quadraticCurveTo(x + 18, y - 62 + wave, x + 30, y - 58);
    c.lineTo(x + 30, y - 40);
    c.quadraticCurveTo(x + 18, y - 44 + wave, x + 4, y - 42);
    c.fill();
    drawGlyphH(c, x + 17, y - 51 + wave * 0.3, 12, this.active ? GOLD : '#b9b4ca', null);
  }
}

class Goal {
  constructor(tx, ty) {
    this.tx = tx; this.ty = ty;
    this.x = tx * T; this.y = (ty + 1) * T - 4.5 * T; this.w = 3 * T; this.h = 4.5 * T;
  }
  draw(c, t, st) {
    // rugby posts: the biggest H in the level
    const ground = (this.ty + 1) * T;
    const lx = this.x + 6, rx = this.x + this.w - 14, top = ground - 4.5 * T, bar = ground - 1.6 * T;
    c.fillStyle = '#00000030';
    c.fillRect(lx + 4, top + 4, 8, ground - top); c.fillRect(rx + 4, top + 4, 8, ground - top);
    c.fillStyle = '#fbf6ea';
    c.fillRect(lx, top, 8, ground - top); c.fillRect(rx, top, 8, ground - top);
    c.fillRect(lx, bar, rx - lx + 8, 8);
    c.fillStyle = HANK;
    c.fillRect(lx, ground - 26, 8, 20); c.fillRect(rx, ground - 26, 8, 20);
    for (const px of [lx, rx]) {
      const w = Math.sin(t * 5 + px) * 3;
      c.fillStyle = GOLD;
      c.beginPath(); c.moveTo(px + 8, top); c.quadraticCurveTo(px + 20, top + 4 + w, px + 30, top + 6); c.lineTo(px + 8, top + 14); c.fill();
    }
    outlined(c, 'HOME', this.x + this.w / 2, bar - 12, 14, GOLD, INK, 4);
  }
}

class Hint {
  constructor(tx, ty, text, touch) { this.x = tx * T + T / 2; this.y = ty * T + T / 2; this.text = text; this.touch = touch; }
  draw(c, st, t) {
    const p = st.player;
    const d = Math.abs(p.cx - this.x);
    const a = clamp(1 - (d - 4 * T) / (3 * T), 0, 1);
    if (a <= 0) return;
    const str = Input.usingTouch ? this.touch : this.text;
    c.font = `700 15px ${BODY}`;
    const w = c.measureText(str).width + 24;
    c.globalAlpha = a;
    c.fillStyle = 'rgba(18,16,31,0.72)';
    rrect(c, this.x - w / 2, this.y - 15, w, 30, 15); c.fill();
    c.fillStyle = '#fbf6ea'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(str, this.x, this.y + 1);
    c.globalAlpha = 1;
  }
}

class Mover {
  constructor(tx, ty, n, dx, dy, speed) {
    this.x0 = tx * T; this.y0 = ty * T; this.w = n * T; this.h = 14;
    this.rx = dx * T; this.ry = dy * T;
    const dist = Math.max(Math.abs(this.rx), Math.abs(this.ry), 1);
    this.omega = (Math.PI * speed) / dist;
    this.ph = 0; this.x = this.x0; this.y = this.y0; this.dx = 0; this.dy = 0;
  }
  update(dt) {
    this.ph += this.omega * dt;
    const k = (1 - Math.cos(this.ph)) / 2;
    const nx = this.x0 + this.rx * k, ny = this.y0 + this.ry * k;
    this.dx = nx - this.x; this.dy = ny - this.y;
    this.x = nx; this.y = ny;
  }
  draw(c, th) {
    const x = this.x, y = this.y;
    c.fillStyle = '#00000030'; rrect(c, x + 3, y + 5, this.w, this.h, 4); c.fill();
    c.fillStyle = th.plankDark; rrect(c, x, y + 4, this.w, this.h - 2, 4); c.fill();
    c.fillStyle = th.mover; rrect(c, x, y, this.w, this.h - 4, 4); c.fill();
    c.fillStyle = '#ffffff40'; c.fillRect(x + 4, y + 2, this.w - 8, 2);
    c.fillStyle = th.plankDark;
    for (let i = 1; i < this.w / T; i++) c.fillRect(x + i * T - 1, y + 1, 2, this.h - 6);
    c.fillStyle = '#3a3a48';
    c.fillRect(x + 6, y + 4, 3, 3); c.fillRect(x + this.w - 9, y + 4, 3, 3);
  }
}
