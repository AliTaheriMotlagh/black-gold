# Black Gold: Sands of War · طلای سیاه: شن‌های جنگ

A 3D real-time strategy game set on a real map of the Middle East, inspired by *Command & Conquer: Generals* and *Age of Empires*. Build oil derricks, trade crude on a volatile market, capture cities, survive regional crises and settle things with rocket artillery and ballistic missiles.

It runs in any modern browser on **desktop, tablet and phone**, can be installed as a PWA, and ships in **English and Farsi** (full RTL layout, Persian digits).

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build      # type-check + production bundle in dist/
npm run preview    # serve the production build
npm test           # unit tests (geography, pathfinding, i18n, market, balance)
```

## Features

| Area | What's in |
|---|---|
| **Map** | Real geography from lon/lat data: Persian Gulf, Red Sea, Caspian, Mediterranean, Black Sea, Strait of Hormuz; Zagros, Alborz (snow-capped Damavand), Taurus, Caucasus, Hejaz, Hajar; Tigris, Euphrates, Nile, Karun, Aras; dune seas (Rub' al Khali, Nafud); 34 cities, 25 real oil fields (Ghawar, Burgan, Rumaila, Kirkuk, South Pars…) |
| **Economy** | Derricks pump oil → sell at a live Brent-style price (mean-reverting random walk + shocks) or spend it on vehicles and missiles. Refineries raise the sale price. Captured cities pay income. Power grid; low power slows production. |
| **Regional crises** | Sandstorms (vision drops, haze, wind audio), tanker crisis in Hormuz (price spike), oil glut (crash), heatwave (power −30%), water crisis (city income halved), pipeline sabotage (derrick fire), sanctions on the strongest player. |
| **Units** | Rifleman, RPG trooper, Technical, Battle tank, Rocket artillery (MLRS salvos), Mobile SAM, Attack helicopter, Recon drone. Armor-vs-weapon damage table, veterancy chevrons. |
| **Buildings** | HQ, Power plant, Barracks, Oil derrick, Refinery, War factory, Gun bunker, Missile shield, Airfield, Ballistic missile silo (superweapon with interception by SAMs). |
| **AI** | 1–3 opponents, 3 difficulties. Expands to oil, captures cities, mixes army vs your composition, defends, attacks in waves, trades oil on price spikes, fires missiles at your most valuable cluster. |
| **Gamification** | Guided objectives with credit rewards, 11 medals, XP and 10 military ranks (Private → Field Marshal), battle report and score, persistent career. |
| **3D / VFX** | Procedural low-poly models with animated rigs (turrets, recoil, rotors, pumpjacks, radar, silo doors), soft shadows, sky-based reflections, oil-slick material, GPU particles (explosions, smoke trails, oil fires, steam, dust), shockwaves, scorch marks, explosion lights, camera shake, fog of war. |
| **Audio** | 100% synthesized with Web Audio: weapons, explosions, sirens, UI, wind ambience, and a generative soundtrack in the Hijaz maqam with darbuka rhythms that intensifies in combat. No audio files to download. |
| **UX** | Responsive HUD (sidebar on desktop, bottom sheet plus quick actions on touch), minimap with camera frustum and pings, tooltips, toasts, crisis banners, medal pop-ups, haptics, safe-area insets, reduced-motion support, fullscreen + landscape lock, auto-pause when backgrounded. |

## Controls

**Mouse & keyboard**: left-click select, drag to box-select, shift-click to add, double-click to select all of a type. Right-click to move or attack (Ctrl + right-click to attack-move), right-drag to pan. WASD / arrows / screen edges to pan, wheel to zoom toward the cursor, Q/E or middle-drag to rotate. `A` attack-move, `S` stop, `Ctrl+1–9` set a group, `1–9` recall it (double-tap to focus), `Space` jumps to the last alert, `Esc` cancels or pauses.

**Touch**: tap to select; with units selected, tap the ground to move or an enemy to attack. Drag to pan, pinch to zoom, twist to rotate. Long-press then drag to box-select, or use the box-select quick action. Double-tap a unit to select all of its type. When placing a building, tap to position the ghost, then press **Place**. Long-press a unit card to cancel it from the queue.

## Architecture

```
src/
  geo/geography.ts     real-world data (coastlines, ridges, rivers, oil, cities) + projection
  world/heightmap.ts   pure terrain generation → MapData (heights, water, passability)
  world/Terrain.ts     terrain mesh, water, rivers, sea labels, fog texture, minimap image
  game/config.ts       all balance data (units, buildings, damage table, economy, AI)
  game/World.ts        simulation: economy, production, movement, combat, capture, win/loss
  game/combat.ts       projectiles: hitscan, shells, rockets, homing missiles, artillery, ballistic + interception
  game/ai.ts           skirmish AI
  game/events.ts       oil market + regional crises
  game/fog.ts          fog of war
  game/pathfinding.ts  A* (binary heap, no corner cutting) + line-of-sight smoothing
  game/models.ts       procedural 3D models and animation rigs, UI thumbnails
  game/objectives.ts   objectives + medal triggers
  render/              renderer, lights, shadows, quality presets, RTS camera
  input/               unified pointer/touch/keyboard input → Controller (selection, commands, placement)
  ui/                  HUD, minimap, menus (vanilla TS + CSS, logical properties for RTL)
  audio/audio.ts       synthesized SFX + generative music
  i18n/                en + fa dictionaries (fa is type-checked against en: missing keys fail the build)
  meta/                persisted settings & career profile (localStorage)
```

- **Simulation and rendering are separate.** `World.update(dt)` runs fixed sub-steps (≤ 1/30 s), so 2×/3× game speed stays stable. `heightmap.ts`, `pathfinding.ts`, `events.ts` and `config.ts` have no DOM or Three.js dependency and are unit-tested in Node.
- **Performance.** Shared geometry and material caches, a spatial hash for proximity queries, a time-budgeted path queue (3 ms per frame), two draw calls for all particles, a single line buffer for all tracers, a 20 Hz fog upload and a 10 Hz HUD refresh. Low / Medium / High presets control pixel ratio, shadows and particle density; the default is picked automatically from device hints.
- **Bundle.** About 200 KB of gzipped JS (Three.js split into its own chunk) plus self-hosted fonts. There are no runtime network dependencies, and a service worker caches everything for offline play.

## Taking it further

- **Artist-made models:** the rigs in `game/models.ts` expose named parts (`turret`, `barrel`, `muzzle`, `rotors`…). Load a glTF with `GLTFLoader`, map its nodes onto a `ModelRig`, and the simulation and animation code keep working unchanged.
- **Recorded audio / voice lines:** add buffers next to the synths in `audio/audio.ts`. `play(name, {pan, distance})` already handles 3D placement.
- **Multiplayer:** the simulation is already driven by commands (`commandMove`, `queueUnit`, `placeBuilding`…), which suits a lockstep model. Replace `Math.random` in `game/` with the seeded `rng()` from `world/noise.ts` and relay commands over WebSockets.
- **Native app stores:** wrap `dist/` with Capacitor for iOS and Android.
