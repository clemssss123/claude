# Past Due

An incremental game about rent, rebirth, and the people you used to be.
It is one self-contained HTML file: open `index.html` in a browser to play.
Progress saves to the browser's local storage.

## How a life works

- **Punch in** on the time card to earn cash, and buy **ventures**
  (Lemonade Stand up to Multiverse Office) that earn on their own. Prices rise
  15% per venture owned. Owning 1, 5, 25, 50, 100, 150 and 200 of a venture
  unlocks upgrades that double its income.
- **Bills land in your inbox.** Rent arrives every minute, income tax every
  2.5 minutes (20% of what you earned), and surprise expenses at random. You
  have 40 seconds to pay each one. A missed bill becomes debt, with interest,
  and costs you a strike. Three strikes and you are evicted.
- **Rent rises every month, and the rise itself grows by a point each month.**
  Sooner or later it outgrows any economy, so every life hits a wall.
- **Opportunity envelopes** turn up now and then: a windfall, a ×7 boom
  market, or a ×20 viral moment for your punches.

## Rebirth and the Soul Tree

Reincarnate whenever you like. Karma works like Cookie Clicker's heavenly
chips: your karma total is the cube root of everything you have ever earned,
in thousands, so each life adds whatever it lifts that total by. An evicted
life only counts half. Every karma point also adds 1% to all income, with
diminishing returns past +100%.

Spend karma on the Soul Tree. It has four branches of six nodes, plus an
endless Transcendence node at the bottom:

| Branch     | What it does                                                        |
| ---------- | ------------------------------------------------------------------- |
| Hustle     | Stronger punches, lucky punches, hired help, Rush from a full card  |
| Enterprise | Seed money, cheaper ventures, synergy, offline income, Monopoly     |
| Frugality  | Direct debit, cheaper bills, slower rent, extra strikes, Landlord   |
| Echoes     | More echo slots, louder echoes, bigger race bonus, faster playback  |

## The unique part: Echoes

Every finished life is recorded, second by second, as an **echo**. When the
next life starts, your echoes replay alongside it like ghost cars in a racing
game:

- An echo **pays you a share** (20% to start) of what that past life was
  earning at the same age.
- Echoes replay **in today's terms**. A recording is divided by the permanent
  multipliers you had when you earned it, and multiplied by the ones you have
  now, so a past life is a fair rival.
- **Race them.** For each echo you are currently out-earning, all your income
  rises 20% (up to 50% with Rivalry). An echo you outlive counts as beaten.
- Slots are limited (1 to 4). When they are full, the reincarnation form asks
  which past life the new one replaces, so you keep your best runs.
- The Echoes branch changes the race. Déjà Vu plays echoes faster, so they get
  richer sooner but are harder to beat. Lingering keeps finished echoes paying.
  Chorus doubles the pay of every echo you are beating.

The Echoes tab charts this life's income against every echo on a log scale,
with a playhead at the current moment.

## Time away

Your life clock only runs while the page is open and visible, so bills never
come due behind your back. While you are away, ventures keep earning at 25%
(up to 100% with Night Shift) for up to eight hours.

## Tinkering

The page exposes `window.pastDue` in the browser console, with the live
`state` and the game's core functions (`tick`, `punch`, `buySkill`,
`doRebirth`, and so on). Use it to inspect or fast-forward a run.

## Desktop version

`desktop/` wraps the game in Electron so it runs in its own window, with the
fonts bundled so it looks right offline. Saves live in the app's own data
folder.

```bash
cd games/past-due/desktop
npm install
npm start          # play in a desktop window
npm run dist:win   # portable Windows .exe, into desktop/release/
```

The **Past Due desktop build** workflow (`.github/workflows/past-due.yml`)
builds the Windows .exe on GitHub whenever the game changes. It publishes the
file as the `past-due-v1.0.0` GitHub Release.

The .exe is not code-signed, so Windows SmartScreen may warn about it on first
launch. Choose "More info", then "Run anyway".
