# td.davinux.net — Tower Defense

A browser tower-defense game with a 3D map editor, a 120-level campaign, and
full-3D rendering (Three.js, vendored locally). No build step, no dependencies
to install — just serve the folder statically.

Live at **https://td.davinux.net**.

## Running it

The game loads its data files (`data/*.json`) and ES modules via `fetch`,
so it must be served over HTTP (opening `index.html` via `file://` will fail
to load the campaign).

```bash
./start-server.sh          # serves on http://localhost:8000
./start-server.sh 8080     # custom port
```

Then open the printed URL. Any static server works (`python3 -m http.server`,
`npx serve`, nginx, …) — there is no backend.

## The game

- **Campaign** — 6 worlds × 20 maps (120 levels), each playable on
  Easy / Normal / Hard. Every world is its own biome — Meadow (groves,
  ponds), Crossing (rivers), Gauntlet (boulder canyons), Mire (mud roads,
  bogs, phantoms), Stormpeak (slate ridges, fast foes), Abyss (void lakes,
  everything at once) — with its own enemy roster and named maps. Inside a
  world roads get shorter, build room tighter and waves tougher; enemy
  types unlock one at a time; maps 10 and 20 (and 5/15 from world 3) end
  in boss fights. Hard is much tougher than Normal early and stays
  demanding to the end. Finishing a map unlocks the next; finishing map 20
  unlocks the next world. Best difficulty per map is tracked with ★ ranks,
  saved in the browser.
- **Towers (10)** — Arrow, Cannon, Frost, Sniper, Gatling, Tesla, Missile,
  Mortar, Railgun, Tempest. Buy, upgrade (up to level scaling), sell (+70%
  refund). Abilities (splash, chain lightning, slow, crit, pierce, homing
  rockets, multi-target, minimum range) are data-driven per tower.
- **Enemies (10)** — Grunts, Runners, Bulwarks, Mites, Aegis shields, Wisps,
  Splitters (spawn Mites on death), Golems, slow-immune Phantoms, and Warlord
  bosses. HP scales per wave; later waves mix compositions.
- **Waves** — press Space (or the Start button) to send each wave; clearing a
  wave pays a gold bonus. A live wave panel shows each enemy type's spawn
  progress (✓ out, spawning, yet to come).
- **Map editor** — paint Path / Buildable / Blocked / Spawn / Base tiles,
  resize the grid, validate, save to localStorage, export/import JSON, and
  jump straight into testing the map.
- **Quick Play** — sandbox mode on your own maps or a procedurally generated
  random map (self-avoiding road + scattered blockers), with endless waves
  past the final one.
- **Navigation** — Home has a live 3D diorama hero with a one-click
  *Continue* (next unfinished map), world tabs and compact level tiles.
  Every view has a URL hash (`#play`, `#editor`, `#enemies`, `#towers`,
  `#help`), so browser Back/Forward and deep links work; on phones the
  tabs become a bottom bar. In-game, *Menu* / `Esc` opens a pause menu
  (resume, restart, sound, level select, main menu).
- **Views** — everything plays in 3D (orbit / pan / zoom, fullscreen HUD
  with tower bar, wave preview, and inspector card). The main menu has an
  animated 3D diorama backdrop.
- **PWA** — installable (`manifest.json` + `sw.js`): the full 3D game works
  offline once visited, since Three.js is vendored in `vendor/`.
- **Sound** — procedural Web Audio SFX (shots, explosions, placements,
  upgrades, wave horns, victory/defeat stingers): zero assets, fully offline.
  Volume, mute, and on/off live in the header 🔊 settings (available before
  any game), the play sidebar, the 3D HUD, and the `M` hotkey — persisted in
  localStorage.

### Controls

| Key | Action |
| --- | ------ |
| `Space` / `Enter` | Start next wave |
| `1`–`9`, `0` | Select tower |
| `U` / `X` | Upgrade / sell selected tower |
| `P` / `F` / `R` | Pause / cycle speed / restart |
| `M` | Mute / unmute |
| `G` | Generate random map (sandbox) |
| `Esc` | Deselect · open / close the pause menu · close dialog |
| `C` | Recenter 3D camera |

In 3D: drag to orbit, right-drag (or Shift-drag / two fingers) to pan,
wheel / pinch to zoom, click to place or select.

## Tech stack

- **Vanilla JS (ES modules)** — `js/` holds one module per concern
  (`main.js` app shell, `game.js` simulation, `view3d.js` Three.js game view,
  `editor3d.js` Three.js map editor,
  `hud3d.js` 3D HUD, `art3d.js` shared materials + lighting rig (sun shadows, sky env map), `terrain3d.js` / `towers3d.js` / `enemies3d.js` 3D mesh builders + animation, `editor.js`, `levels.js` campaign/progress,
  `graphics.js` canvas vector art, `content.js` data loading, `model.js`
  tiles/pathfinding, `storage.js` persistence, `generator.js` random maps,
  `codex.js` / `showroom.js` catalogs, `tooltip.js` hover cards, `uiicons.js` SVG UI line icons,
  `audio.js` procedural sound, `menu3d.js` menu diorama). No framework, no bundler, no npm.
- **SVG icons** (`icons.js`) for towers, enemies and editor tiles — 3/4-view
  portraits matching the 3D models, crisp at any size, CSS-animated in the
  codex / showroom. Canvas 2D remains only as the emergency board fallback.
- **Three.js 0.160.0, vendored** in `vendor/` (no CDN, works offline) — game
  view, map editor, codex/showroom showcases, and menu diorama all share the
  same mesh builders.
- **Data-driven content** — `data/towers.json` and `data/enemies.json`
  define stats; `data/campaign.json` defines each world's biome (road length
  and straightness, water/forest/rock/cliff shares, canyon walls, mud),
  enemy weights, economy, toughness curve and map names. `js/mapgen.js`
  builds every map from that theme with a fixed seed (lattice road that can
  never shortcut itself + clumpy noise terrain), so maps are identical on
  every load; Quick Play's random maps use the same generator.
- **Balance tool** — `node tools/balance.mjs` replays levels headlessly with a
  greedy bot player (same combat rules as the game) and prints win / lives
  per difficulty; `--all`, `--world <id>`, `--maps 1,5,20`, `--diffs hard`,
  `--verbose`. `--calibrate` measures each map's bot limit and prints the
  per-map `levelHp` multipliers that keep the difficulty curve smooth —
  re-run it (and paste into `campaign.json`) after changing maps, towers or
  enemies.
- **Persistence** — campaign progress, view preference, and custom maps live
  in `localStorage`; no account or server state.
- **PWA** — `manifest.json`, generated PNG icons in `icons/`, and a
  cache-first service worker (`sw.js`).

## Project layout

```
index.html          app shell + all views (menu, codex, showroom, editor, play, help)
style.css           full UI theme (single stylesheet)
manifest.json       PWA manifest
sw.js               offline service worker
icons/              PWA / touch icons
vendor/             vendored Three.js (offline-capable 3D)
js/                 ES modules (see Tech stack)
data/               towers, enemies, campaign worlds (*.json)
tools/              balance simulator (node tools/balance.mjs)
start-server.sh     local static server helper
```

## Notes for contributors

- Keep the game dependency-free: no build step means any change is live on
  reload.
- Gameplay-affecting numbers belong in `data/*.json`, not in code.
- The 2D canvas is an emergency fallback only: all player-facing rendering
  is 3D. The 3D scenes read live state via the `game`/editor APIs.
- The HUD mirrors the sidebar by calling the same `game` methods — add new
  player actions there once and wire both UIs to them.
