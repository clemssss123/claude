# Hank and the Hush

A platform game about the letter H. The Hush, who cannot stand a sound, has
stolen every H in Hamlet Hollow, so signs now read `_OUSE` and `_ILL`. Hank, a
small lowercase h, sets out to bring them all home.

Open `index.html` in a browser. There is no build step and nothing to install;
the game is plain JavaScript drawn on a canvas, with synthesized sound and
music. It also works from a `file://` URL.

## What's in it

- **11 levels in 6 worlds**: Hamlet Hills, Harbor, Haunted House, Honey Hive,
  High Heights, and a boss fight against the Hush in its hall.
- **Four H abilities**: Hop from the start, then **Hover** (Harbor),
  **Hammer** (Haunted House) and **Haste** (Honey Hive). Earlier levels hide
  golden H's behind walls and gaps that only later abilities can reach.
- **50 golden H's and 25 signs** to restore. Each sign is a word missing its
  H (`S_IP`, `W_ALE`, `_ATC_`); touching it puts the H back.
- **Six enemies**: Shushes, Hornets, Hedgehogs, Hounds, Ghosts that creep up
  while you look away, and Shushers that spit shh-waves.
- **H everywhere**: ladders are stacked H's, the finish line is a pair of
  H-shaped posts, the checkpoint flags carry an H, and the world map is laid
  out in the shape of an H.
- A story intro, world map, results with ranks, ability unlock screens, a
  help section, settings and an ending. Progress saves in the browser.
- Keyboard, gamepad and on-screen touch controls.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Walk | Arrow keys or A / D | D-pad or stick |
| Hop (hold to go higher) | Space, Z, Up or W | A |
| Climb | Up / Down on a ladder | D-pad |
| Drop through a plank | Down + Space | |
| Hover | Hold Space in the air | Hold A |
| Hammer | X or J | X |
| Haste (dash) | Shift or C | B or RB |
| Pause / mute | Esc or P / M | Start |

## Code layout

| File | Contents |
| --- | --- |
| `js/core.js` | Constants, physics tuning, input and save data |
| `js/audio.js` | Sound effects and the chiptune sequencer |
| `js/levels.js` | Worlds, abilities and the level builder with all 11 levels |
| `js/art.js` | Palettes, tiles, parallax backdrops and every character |
| `js/entities.js` | Hank, enemies, the Hush, pickups and props |
| `js/stage.js` | A level in play: collisions, effects, camera and HUD |
| `js/scenes.js` | Menus, screens and the main loop |

Levels are written with a small builder (`b.ground(...)`, `b.plat(...)`,
`b.gold(...)`) that flattens into a tile grid, so adding a level is a matter
of appending an entry to `LEVELS` in `js/levels.js`.
