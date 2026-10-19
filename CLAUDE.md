# Black Gold — Theater of War

Browser 3D RTS on the real Middle East (Three.js + TypeScript + Vite). Deterministic lockstep
simulation, P2P multiplayer, English + Farsi (RTL). Deployed on Vercel: https://black-gold-war.vercel.app

## Commands

```bash
npm run dev                    # vite on :5173 — game at /play/, landing at /, Farsi landing at /fa/
npm run build                  # tsc --noEmit + vite build → dist/ (also writes sitemap.xml / robots.txt)
npm test                       # vitest: determinism, sim rules, pathfinding, theater data
npx tsc --noEmit               # typecheck only
npx tsx scripts/simbench.ts 20 # headless all-AI match for 20 game-minutes (perf + balance log)
node scripts/mp-test.mjs 25    # two-tab lockstep test over BroadcastChannel (dev server must run)
node scripts/shot.mjs <url> <out.png> [w] [h] [js-actions]   # screenshot via installed Chrome
node scripts/marketing-shots.mjs # regenerate public/media/*.webp + og-image.jpg (dev server)
npx tsx scripts/bake-geo.ts    # rebuild public/data/* from real-world sources (cached in .cache/geo)
vercel deploy --prod --yes     # deploy (project: black-gold-war, team alan-f3ab)
```
npm cache in ~/.npm has root-owned files: prefix installs with `npm_config_cache=$TMPDIR/npm-cache`.

## Architecture (where things live)

| Path | Responsibility |
|---|---|
| `src/sim/` | **Deterministic simulation.** No DOM/Three.js. `world.ts` (state + tick order), `defs.ts` (ALL balance data: units, buildings, weapons, research, powers, strikes, damage table, economy), `commands.ts` (every player action), `entities.ts`, `country.ts` (diplomacy matrix), `path.ts` (incremental A*), `dmath.ts`, `rng.ts`, `hash.ts` |
| `src/sim/systems/` | movement (physics, convoys, aircraft), combat (targeting), projectiles (ballistics, guidance, interception), production, economy, territory (cities/capture), diplomacy, vision (fog/radar), powers, events (market/crises) |
| `src/sim/ai/ai.ts` | Skirmish AI — issues normal commands, so it is deterministic in MP |
| `src/geo/` | `projection.ts` (Web Mercator × cos27°, km), `theater.ts` (loads `public/data/theater.bin.gz`) |
| `src/render/` | `Stage` (renderer/post/quality), `CameraRig`, `terrain/` (quadtree LOD + tile streaming + water), `EntityRenderer` (instancing), `models/` (procedural models), `fx/` (particles, effects), `Overlays` (NATO icons, bars, rings), `MapLayers` (borders, labels, fog/territory textures), `World3D` |
| `src/game/Game.ts` | One match: session → renderer/HUD/audio glue, ambient effects, strategic icons |
| `src/net/` | `Session` (local), `Lockstep` (lobby + lockstep host/client), `Transport` (PeerJS WebRTC, BroadcastChannel) |
| `src/input/` | `Input` (mouse/touch/keys) → `Controller` (selection, orders, placement, targeting) |
| `src/ui/` | `hud/` (HUD, Minimap, SelectionPanel, CommandPanel, DiplomacyPanel), `menus/` (Menus, MenuMap), `thumbs.ts`, `dom.ts` (`h()` helper + SVG icons) |
| `src/i18n/` | `en.ts` defines keys; `fa.ts` must have every key (typechecked) |
| `scripts/` | data bake, benchmarks, screenshots, MP test |

Tick order lives in `World.step()`. Sim runs at 20 Hz (`DT`); renderer interpolates with `px/pz/pHeading`.

## Hard rules

- **Determinism** (`src/sim/**`): never use `Math.sin/cos/atan2/pow/exp/log/hypot/random`, `**`,
  `Date.now`, `performance.now`. Use `dmath.ts` and `world.rng`. Iterate arrays in stable order.
  `tests/sim.test.ts` greps for violations. Budget work by counts, never wall-clock.
- Every player action goes through `commands.ts` (`session.issue(...)`) — never mutate the world from UI.
- Sim emits `SimEvent`s; render/audio/UI react to them. Sim never imports render code.
- Units: km, km/s, seconds, $M. Render height = metres × `VEX`.
- New UI text → add the key to `en.ts` and `fa.ts`. CSS uses logical properties (RTL).
- Map labels use class `mlbl` (`.lbl` is the button-label class).
- Imagery default is Sentinel-2 cloudless (EOX, CC BY-NC-SA — non-commercial). `gibs`/`base` are public domain.

## Debugging

Dev builds expose `window.app`: `app.game.world`, `app.debugAutoplay(speed)`, `app.debugSimulate(seconds)`.
`/play/?quick=1[&country=SAU]` skips menus; `/play/?local=1` uses the BroadcastChannel transport.

## Token-efficient workflow

- Query the code graph before reading files: `graphify query "<question>"`, `graphify explain "<Symbol>"`,
  `graphify path "A" "B"`. Refresh with `graphify update .` (free, code-only).
- Use the TypeScript LSP plugin (go-to-definition / references) instead of grepping big files.
- Don't read generated/binary paths: `public/data/`, `dist/`, `.cache/`, `graphify-out/graph.*`, `package-lock.json`.
- `defs.ts` is the single place to tune balance; `simbench.ts` shows the effect in seconds.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
