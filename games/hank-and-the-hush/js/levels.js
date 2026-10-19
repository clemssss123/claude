'use strict';
/* Worlds, abilities and the eleven levels. Levels are built in code with a small
   tile builder, then flattened into a character grid plus a list of things.

   Tiles:  #  solid        =  one-way plank   L  ladder (its top is a plank)
           ^  spikes       ~  water           J  spring
           B  cracked brick (hammer)          D  steel dash-block (haste)
           X  rotten plank that falls after you step on it                      */

const WORLDS = [
  { name: 'Hamlet Hills', theme: 'hills', music: 'hills', color: '#5fc24f' },
  { name: 'Harbor', theme: 'harbor', music: 'harbor', color: '#3c8fd0', gift: 'hover' },
  { name: 'Haunted House', theme: 'haunted', music: 'haunted', color: '#9a7cd6', gift: 'hammer' },
  { name: 'Honey Hive', theme: 'hive', music: 'hive', color: '#f2a61e', gift: 'haste' },
  { name: 'High Heights', theme: 'heights', music: 'heights', color: '#9cc4f2' },
  { name: "The Hush's Hall", theme: 'hush', music: 'boss', color: '#a19fb3' },
];

const ABILITIES = {
  hover: {
    name: 'HOVER', keys: 'Hold SPACE in the air', touch: 'Hold HOP in the air',
    text: 'Hank spins up a tiny rotor and glides. It runs out after a moment and refills when you land.',
  },
  hammer: {
    name: 'HAMMER', keys: 'Press X or J', touch: 'Tap HAMMER',
    text: 'Swing a hammer. It breaks cracked bricks and bonks hedgehogs, ghosts, Shushers and shh-waves.',
  },
  haste: {
    name: 'HASTE', keys: 'Press SHIFT or C', touch: 'Tap DASH',
    text: 'A quick dash, on the ground or once per jump. It smashes straight through steel dash-blocks.',
  },
};

function makeLevel(def) {
  const w = def.w, h = def.h || 17;
  const grid = Array.from({ length: h }, () => new Array(w).fill(' '));
  const ents = [];
  const b = {
    w, h,
    fill(x0, y0, x1, y1, ch = '#') {
      for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) grid[y][x] = ch;
    },
    ground(x0, x1, top = 14) { this.fill(x0, top, x1, h - 1); },
    plat(x, y, n, ch = '=') { this.fill(x, y, x + n - 1, y, ch); },
    tile(x, y, ch) { this.fill(x, y, x, y, ch); },
    ladder(x, y0, y1) { this.fill(x, y0, x, y1, 'L'); },
    spikes(x, y, n) { this.plat(x, y, n, '^'); },
    water(top = 15) {
      for (let y = top; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x] === ' ') grid[y][x] = '~';
    },
    ent(type, x, y, o = {}) { ents.push(Object.assign({ type, x, y }, o)); },
    start(x, y) { this.ent('P', x, y); },
    gold(x, y) { this.ent('h', x, y); },
    heart(x, y) { this.ent('+', x, y); },
    check(x, y) { this.ent('C', x, y); },
    goal(x, y) { this.ent('G', x, y); },
    sign(x, y, text) { this.ent('S', x, y, { text }); },
    hint(x, y, text, touch) { this.ent('hint', x, y, { text, touch: touch || text }); },
    mover(x, y, n, dx, dy, speed = 60) { this.ent('M', x, y, { n, dx, dy, speed }); },
    honey(x, y, n = 1, dx = 1, dy = 0) { for (let i = 0; i < n; i++) this.ent('o', x + i * dx, y + i * dy); },
    arc(x, y, n) {
      for (let i = 0; i < n; i++) this.ent('o', x + i, y - Math.round(Math.sin((Math.PI * i) / (n - 1)) * 2));
    },
    hut(x, ch = 'B') {
      // a 3-tall box with a gold H sealed inside, and a step in front of it
      this.fill(x - 1, 13, x - 1, 13);
      this.fill(x, 11, x + 4, 11, ch);
      this.fill(x, 12, x, 13, ch);
      this.fill(x + 4, 12, x + 4, 13, ch);
      this.gold(x + 2, 13);
    },
  };
  def.build(b);
  return Object.assign({}, def, { w, h, grid: grid.map(r => r.join('')), ents });
}

const LEVELS = [
  {
    id: '1-1', world: 0, name: 'Hello, Hollow', w: 120,
    build(b) {
      b.ground(0, 17); b.ground(20, 36); b.ground(40, 72); b.ground(76, 96); b.ground(99, 119);
      b.start(2, 13);
      b.hint(6, 9, '← → to walk · SPACE to hop', '◀ ▶ to walk · tap HOP');
      b.sign(9, 13, '_ELLO');
      b.honey(11, 11, 3);
      b.fill(14, 13, 15, 13); b.gold(15, 11);
      b.arc(17, 11, 4);
      b.hint(25, 6, 'Hop on a Shush to quiet it');
      b.plat(23, 10, 4); b.honey(23, 9, 4);
      b.ent('g', 28, 13);
      b.fill(32, 12, 33, 13); b.gold(33, 10);
      b.arc(36, 11, 5);
      b.fill(44, 13, 44, 13); b.fill(45, 12, 46, 13); b.fill(47, 11, 48, 13); b.gold(48, 9); b.fill(49, 12, 49, 13);
      b.sign(53, 13, '_OUSE');
      b.check(56, 13);
      b.ent('z', 61, 10, { range: 3 });
      b.spikes(64, 13, 2); b.arc(63, 11, 4);
      b.ent('g', 69, 13);
      b.arc(72, 11, 5);
      b.plat(80, 12, 3); b.plat(83, 10, 3); b.gold(84, 8); b.honey(80, 11, 3);
      b.ent('g', 87, 13); b.ent('g', 91, 13);
      b.sign(94, 13, '_ILL');
      b.heart(101, 13);
      b.hut(104);
      b.hint(106, 8, 'Something rattles inside. A hammer would help…');
      b.goal(114, 13);
    },
  },
  {
    id: '1-2', world: 0, name: 'Hornet Heath', w: 126,
    build(b) {
      b.ground(0, 12); b.ground(16, 30); b.ground(35, 55); b.ground(59, 62); b.ground(66, 90); b.ground(94, 125);
      b.start(2, 13);
      b.sign(5, 13, '_AY');
      b.honey(8, 12, 3);
      b.arc(12, 11, 5);
      b.ent('z', 19, 10, { range: 2 });
      b.fill(24, 10, 25, 13); b.ladder(23, 10, 13); b.gold(24, 8);
      b.hint(21, 6, '↑ ↓ to climb ladders', '▲ ▼ to climb ladders');
      b.plat(28, 9, 3); b.plat(32, 8, 3); b.honey(28, 8, 3); b.honey(32, 7, 3);
      b.ent('g', 40, 13); b.ent('z', 44, 9, { range: 2 }); b.spikes(46, 13, 2); b.arc(45, 11, 4); b.ent('g', 51, 13);
      b.check(53, 13);
      b.gold(61, 11);
      b.sign(68, 13, '_EAT_');
      b.fill(74, 12, 80, 13);
      b.ent('z', 76, 8, { range: 2 }); b.ent('z', 80, 9, { range: 2 });
      b.gold(77, 10);
      b.ladder(85, 7, 13); b.plat(86, 7, 4); b.gold(89, 6); b.honey(86, 6, 2);
      b.fill(97, 6, 99, 6); b.gold(98, 5);
      b.hint(93, 3, 'Too far to hop. A rotor would do it…');
      b.heart(96, 13);
      b.ent('g', 101, 13); b.ent('g', 107, 13);
      b.sign(111, 13, 'BUS_');
      b.goal(120, 13);
    },
  },
  {
    id: '2-1', world: 1, name: 'Harbor Lights', w: 140,
    build(b) {
      b.ground(0, 14); b.ground(22, 36); b.ground(44, 60); b.ground(67, 80); b.ground(89, 110); b.ground(115, 139);
      b.start(2, 13);
      b.sign(6, 13, '_ARBOR');
      b.hint(10, 9, 'Hold SPACE in the air to HOVER', 'Hold HOP in the air to HOVER');
      b.mover(16, 12, 3, 3, 0);
      b.ent('d', 30, 13);
      b.sign(34, 13, 'S_IP');
      b.gold(40, 10); b.honey(38, 11); b.honey(42, 11);
      b.check(46, 13);
      b.fill(50, 12, 51, 13); b.plat(52, 10, 4); b.plat(57, 8, 3); b.gold(58, 6);
      b.ent('d', 55, 13);
      b.mover(62, 12, 3, 0, -5); b.gold(63, 5);
      b.fill(72, 11, 73, 13); b.ent('z', 76, 9, { range: 2 });
      b.sign(78, 13, 'FIS_');
      b.mover(82, 11, 3, 4, 0); b.honey(84, 9, 3);
      b.ent('d', 95, 13); b.ent('d', 104, 13);
      b.plat(99, 11, 3); b.gold(100, 9);
      b.arc(110, 11, 6);
      b.hut(122);
      b.goal(134, 13);
      b.water(15);
    },
  },
  {
    id: '2-2', world: 1, name: 'High Tide', w: 150,
    build(b) {
      b.ground(0, 10); b.ground(17, 30); b.ground(39, 52); b.ground(63, 65); b.ground(76, 95); b.ground(103, 149);
      b.start(2, 13);
      b.sign(5, 13, '_ULL');
      b.tile(13, 13, 'X'); b.tile(14, 13, 'X');
      b.hint(13, 9, 'Old planks give way!');
      b.ent('g', 21, 13); b.ent('g', 25, 13);
      b.fill(28, 10, 30, 13); b.ladder(27, 10, 13); b.gold(29, 8);
      b.plat(34, 9, 3); b.honey(34, 8, 3);
      b.ent('d', 45, 13);
      b.check(50, 13);
      b.mover(54, 12, 3, 5, 0); b.mover(67, 11, 3, 5, 0); b.gold(70, 9);
      b.sign(80, 13, 'W_ALE');
      b.ent('z', 84, 9, { range: 2 });
      b.fill(88, 12, 89, 13); b.plat(91, 10, 3); b.gold(92, 8); b.ent('z', 93, 6, { range: 1 });
      b.arc(96, 11, 7);
      b.ent('d', 110, 13); b.ent('g', 115, 13); b.ent('d', 120, 13);
      b.tile(125, 13, 'J'); b.plat(124, 6, 3); b.gold(125, 5);
      b.hut(133);
      b.goal(145, 13);
      b.water(15);
    },
  },
  {
    id: '3-1', world: 2, name: 'Haunted Hallway', w: 140,
    build(b) {
      b.fill(0, 0, 139, 1);
      b.ground(0, 23); b.ground(27, 139);
      b.start(2, 13);
      b.hint(4, 7, 'X to swing your HAMMER', 'Tap HAMMER to swing');
      b.fill(8, 2, 8, 9); b.fill(8, 10, 8, 13, 'B');
      b.sign(12, 13, '_AUNTED');
      b.hint(17, 6, 'Ghosts creep closer when you look away');
      b.ent('q', 20, 10);
      b.ladder(32, 6, 13); b.fill(33, 6, 46, 6);
      b.honey(35, 5, 4); b.ent('q', 41, 3); b.gold(45, 5);
      b.ent('g', 37, 13); b.ent('t', 45, 13, { dir: -1 });
      b.check(51, 13);
      b.fill(55, 2, 72, 10);
      b.fill(60, 11, 60, 13, 'B'); b.fill(66, 11, 66, 13, 'B');
      b.honey(56, 12, 3); b.ent('q', 63, 12); b.gold(69, 13);
      b.spikes(75, 13, 21);
      b.plat(74, 11, 3); b.plat(79, 9, 3); b.plat(84, 11, 3); b.plat(89, 9, 3); b.plat(94, 11, 3);
      b.honey(79, 8, 3); b.honey(84, 10, 3);
      b.ent('q', 84, 5); b.gold(90, 7);
      b.sign(103, 13, 'C_AIR');
      b.ent('t', 110, 13, { dir: -1 }); b.ent('g', 114, 13);
      b.fill(117, 12, 119, 13, 'B'); b.gold(118, 10);
      b.hut(129, 'D');
      b.goal(136, 13);
    },
  },
  {
    id: '3-2', world: 2, name: 'Hollow Halls', w: 150,
    build(b) {
      b.fill(0, 0, 149, 1);
      b.ground(0, 45); b.ground(49, 95); b.ground(99, 149);
      b.start(2, 13);
      b.sign(5, 13, '_ALLWAY');
      b.ladder(9, 9, 13); b.plat(10, 9, 20); b.gold(20, 8); b.ent('t', 28, 8, { dir: -1 });
      b.ent('q', 18, 12); b.ent('g', 24, 13); b.spikes(32, 13, 3);
      b.check(37, 13);
      b.ladder(39, 9, 13); b.plat(40, 9, 25); b.ent('q', 55, 6); b.sign(61, 8, 'G_OST');
      b.fill(52, 10, 52, 13, 'B'); b.fill(58, 10, 58, 13, 'B'); b.gold(55, 13);
      b.ent('g', 70, 13); b.ent('q', 74, 9);
      b.ladder(79, 9, 13); b.plat(80, 9, 25); b.gold(90, 8); b.ent('q', 95, 6); b.ent('t', 103, 8, { dir: -1 });
      b.spikes(84, 13, 3); b.ent('g', 88, 13);
      b.sign(101, 13, '_INGE');
      b.check(108, 13);
      b.ladder(114, 9, 13); b.plat(115, 9, 20); b.gold(125, 8); b.ent('q', 122, 12); b.spikes(128, 13, 2);
      b.ent('t', 133, 8, { dir: -1 });
      b.hut(138, 'D');
      b.goal(146, 13);
    },
  },
  {
    id: '4-1', world: 3, name: 'Honeycomb Hive', w: 150,
    build(b) {
      b.ground(0, 29); b.ground(38, 60); b.ground(71, 95); b.ground(100, 149);
      b.start(2, 13);
      b.hint(4, 7, 'SHIFT to dash with HASTE', 'Tap DASH to dash');
      b.fill(8, 0, 8, 9); b.fill(8, 10, 8, 13, 'D');
      b.sign(12, 13, '_IVE');
      b.hint(19, 7, 'Hedgehogs are prickly. Hammer them!');
      b.ent('k', 18, 13); b.ent('z', 22, 9, { range: 2 }); b.ent('k', 26, 13);
      b.gold(34, 10); b.honey(32, 10); b.honey(36, 10);
      b.fill(44, 12, 46, 13); b.ent('z', 45, 8, { range: 2 }); b.ent('z', 50, 10, { range: 2 }); b.ent('k', 54, 13);
      b.check(58, 13);
      b.gold(66, 11); b.arc(62, 10, 9);
      b.ent('t', 80, 13, { dir: -1 }); b.ent('k', 85, 13); b.sign(88, 13, '_ONEY');
      b.fill(92, 0, 92, 9); b.fill(92, 10, 92, 13, 'D');
      b.ent('z', 105, 7, { range: 2 }); b.ent('z', 111, 7, { range: 2 });
      b.plat(103, 11, 3); b.plat(107, 9, 3); b.gold(108, 8);
      b.ent('k', 118, 13); b.ent('k', 124, 13);
      b.tile(128, 13, 'J'); b.plat(127, 5, 4); b.gold(129, 4);
      b.sign(133, 13, '_EXAGON');
      b.hut(139, 'D');
      b.goal(146, 13);
    },
  },
  {
    id: '4-2', world: 3, name: 'Hum of the Hive', w: 160,
    build(b) {
      b.ground(0, 12); b.ground(26, 80); b.ground(91, 159);
      b.start(2, 13);
      b.sign(5, 13, '_UM');
      b.tile(14, 13, 'X'); b.tile(15, 13, 'X'); b.tile(18, 12, 'X'); b.tile(19, 12, 'X'); b.tile(22, 11, 'X'); b.tile(23, 11, 'X');
      b.ent('k', 30, 13); b.ent('z', 35, 6, { range: 2 }); b.ent('t', 43, 13, { dir: -1 });
      b.plat(31, 12, 3); b.plat(34, 10, 3); b.plat(37, 8, 3); b.gold(38, 7);
      b.check(46, 13);
      b.tile(53, 13, 'J'); b.fill(56, 5, 58, 13); b.gold(57, 4);
      b.hint(53, 9, 'Springs send you sky-high');
      b.ent('k', 64, 13); b.ent('z', 67, 9, { range: 2 }); b.ent('k', 72, 13);
      b.sign(75, 13, 'T_ORN');
      b.tile(84, 11, 'X'); b.tile(85, 11, 'X'); b.tile(86, 11, 'X'); b.gold(85, 9);
      b.ent('t', 98, 13, { dir: -1 }); b.ent('g', 103, 13); b.ent('t', 108, 13, { dir: -1 }); b.ent('k', 115, 13);
      b.fill(119, 12, 124, 13);
      b.hut(128, 'D');
      b.tile(138, 13, 'J'); b.plat(137, 6, 3); b.gold(138, 5);
      b.sign(145, 13, '_ATC_');
      b.goal(155, 13);
    },
  },
  {
    id: '5-1', world: 4, name: 'Hush Heights', w: 40, h: 62,
    build(b) {
      b.fill(0, 0, 1, 61); b.fill(38, 0, 39, 61); b.fill(2, 58, 37, 61);
      b.start(5, 57);
      b.sign(9, 57, '_EIG_TS');
      b.hint(20, 50, 'Up, up, up to the summit!');
      b.plat(13, 55, 6);
      b.plat(20, 52, 6);
      b.plat(27, 49, 9); b.gold(34, 48);
      b.plat(20, 46, 6, 'X');
      b.plat(12, 43, 7);
      b.ent('z', 14, 40, { range: 3 });
      b.fill(3, 40, 10, 40); b.check(5, 39);
      b.plat(12, 37, 5);
      b.mover(18, 34, 4, 9, 0);
      b.plat(31, 31, 6); b.gold(35, 30);
      b.plat(24, 28, 6);
      b.plat(17, 25, 6, 'X'); b.gold(19, 24);
      b.ent('z', 10, 24, { range: 3 });
      b.fill(3, 22, 15, 22); b.check(5, 21);
      b.plat(12, 19, 5);
      b.fill(18, 16, 23, 16); b.tile(22, 15, 'J');
      b.ent('z', 28, 13, { range: 2 });
      b.plat(26, 10, 7);
      b.plat(30, 13, 4); b.gold(31, 12);
      b.fill(14, 7, 25, 7);
      b.fill(3, 7, 7, 7); b.gold(5, 6);
      b.goal(18, 6);
    },
  },
  {
    id: '5-2', world: 4, name: 'Hailstone Ridge', w: 160,
    build(b) {
      b.ground(0, 14); b.ground(22, 52); b.ground(61, 75); b.ground(91, 110); b.ground(123, 159);
      b.start(2, 13);
      b.sign(6, 13, '_AIL');
      b.hint(8, 9, 'Ice is slippery. Mind the edges!');
      b.gold(18, 10);
      b.ent('d', 28, 13);
      b.tile(34, 13, 'J'); b.fill(37, 4, 38, 13); b.gold(38, 3);
      b.check(44, 13); b.ent('d', 49, 13);
      b.mover(55, 11, 3, 3, 0);
      b.ent('z', 66, 9, { range: 2 }); b.ent('z', 70, 11, { range: 1 }); b.ent('k', 73, 13);
      b.plat(78, 12, 3, 'X'); b.plat(84, 12, 3, 'X'); b.gold(85, 10);
      b.ent('d', 95, 13);
      b.fill(100, 0, 100, 9); b.fill(100, 10, 100, 13, 'D');
      b.check(104, 13); b.ent('t', 108, 13, { dir: -1 });
      b.mover(113, 12, 3, 0, -4); b.mover(118, 8, 3, 0, 4); b.gold(119, 5);
      b.ent('d', 130, 13); b.ent('d', 136, 13); b.ent('k', 142, 13);
      b.sign(146, 13, '_ILLTOP');
      b.plat(149, 11, 3); b.gold(150, 9);
      b.goal(155, 13);
    },
  },
  {
    id: '6-1', world: 5, name: 'The Hush', w: 30, boss: true,
    build(b) {
      b.fill(0, 0, 0, 16); b.fill(29, 0, 29, 16); b.ground(0, 29);
      b.plat(4, 10, 4); b.plat(22, 10, 4);
      b.start(3, 13);
      b.ent('W', 13, 4);
    },
  },
].map(makeLevel);

const firstOfWorld = w => LEVELS.findIndex(l => l.world === w);

function abilitiesFor(unlocked) {
  return {
    hover: unlocked >= firstOfWorld(1),
    hammer: unlocked >= firstOfWorld(2),
    haste: unlocked >= firstOfWorld(3),
  };
}

const LEVEL_TOTALS = LEVELS.map(l => ({
  gold: l.ents.filter(e => e.type === 'h').length,
  signs: l.ents.filter(e => e.type === 'S').length,
}));
const TOTAL_GOLD = LEVEL_TOTALS.reduce((a, t) => a + t.gold, 0);
const TOTAL_SIGNS = LEVEL_TOTALS.reduce((a, t) => a + t.signs, 0);

