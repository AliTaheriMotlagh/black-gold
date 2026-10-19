# Graph Report - bazi  (2026-10-19)

## Corpus Check
- 78 files · ~191,131 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 2, .css 2, .gz 1)

## Summary
- 1190 nodes · 3459 edges · 62 communities (44 shown, 18 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 318 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `28d5f8b2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Controller
- Theater
- bake-geo.ts
- Particles
- index.ts
- theater.ts
- commands.ts
- world.ts
- App
- production.ts
- HUD
- t
- defs.ts
- combat.ts
- World
- dmath.ts
- .overlays
- Pathfinder
- Game.ts
- .constructor
- Controller.ts
- Menus.ts
- LobbyHost
- AIController
- movement.ts
- AudioEngine
- EntityRenderer
- buildings.ts
- projectiles.ts
- Vision
- package.json
- Transport.ts
- svgIcon
- main.ts
- LobbyClient
- CameraRig
- compilerOptions
- Session
- Stage
- LockstepSession
- units.ts
- marketing-shots.mjs
- Lockstep.ts
- EntityRenderer.ts
- part
- Diplomacy
- num
- LocalConn
- devDependencies
- Minimap
- PeerConn
- Building
- vercel.json
- mp-test.mjs
- Terrain.ts
- dependencies
- scripts
- playwright-core
- vite.config.ts

## God Nodes (most connected - your core abstractions)
1. `World` - 87 edges
2. `Controller` - 46 edges
3. `t()` - 44 edges
4. `h()` - 41 edges
5. `applyCommand()` - 33 edges
6. `dist()` - 33 edges
7. `Game` - 29 edges
8. `Theater` - 29 edges
9. `Terrain` - 29 edges
10. `AIController` - 29 edges

## Surprising Connections (you probably didn't know these)
- `mosaicPx()` --calls--> `worldToLonLat()`  [EXTRACTED]
  scripts/bake-geo.ts → src/geo/projection.ts
- `projectRing()` --calls--> `lonLatToWorld()`  [EXTRACTED]
  scripts/bake-geo.ts → src/geo/projection.ts
- `main()` --calls--> `lonLatToWorld()`  [EXTRACTED]
  scripts/bake-geo.ts → src/geo/projection.ts
- `main()` --calls--> `worldToLonLat()`  [EXTRACTED]
  scripts/bake-geo.ts → src/geo/projection.ts
- `Game` --references--> `Controller`  [EXTRACTED]
  src/game/Game.ts → src/input/Controller.ts

## Import Cycles
- None detected.

## Communities (62 total, 18 thin omitted)

### Community 0 - "Controller"
Cohesion: 0.09
Nodes (3): Controller, Input, AlertKey

### Community 1 - "Theater"
Cohesion: 0.07
Nodes (9): tileToWorldRect(), Theater, MapLayers, bilinear(), edgeIndices(), gridIndex(), injectTerrainShader(), Terrain (+1 more)

### Community 2 - "bake-geo.ts"
Cohesion: 0.08
Nodes (46): CACHE, clipLine(), Feature, fetchCached(), flat(), geomLines(), geomPolys(), latToTileY() (+38 more)

### Community 3 - "Particles"
Cohesion: 0.09
Nodes (12): Architecture, Black Gold: Sands of War · طلای سیاه: شن‌های جنگ, Controls, Features, Taking it further, Effects, mergeSimple(), radialTexture() (+4 more)

### Community 4 - "index.ts"
Cohesion: 0.08
Nodes (28): Game, en, I18nKey, fa, detectLang(), dictionaries, enDec, enFormatter (+20 more)

### Community 5 - "theater.ts"
Cohesion: 0.06
Nodes (33): theater, w, counts, minutes, seed, t0, theater, tStart (+25 more)

### Community 6 - "commands.ts"
Cohesion: 0.15
Nodes (28): applyCommand(), build(), fail(), ownUnits(), train(), ProposalKind, aiAccepts(), BLOCS (+20 more)

### Community 7 - "world.ts"
Cohesion: 0.11
Nodes (19): Command, StrikeKind, UnitDef, WeaponDef, dist2(), sqrt, Entity, EntityBase (+11 more)

### Community 8 - "App"
Cohesion: 0.11
Nodes (4): App, NetSessionInfo, MatchSetup, MenuMap

### Community 9 - "production.ts"
Cohesion: 0.11
Nodes (24): Controller, CountryStats, Proposal, Rel, Alliance, Hostile, Neutral, Pact (+16 more)

### Community 10 - "HUD"
Cohesion: 0.16
Nodes (5): fmtTime(), loc(), strength(), DiplomacyPanel, HUD

### Community 11 - "t"
Cohesion: 0.28
Nodes (7): getLang(), t(), rankOf(), rankProgress(), saveSettings(), h(), Menus

### Community 12 - "defs.ts"
Cohesion: 0.08
Nodes (23): AGGRESSION, ATTACK_SIZE, MIX, Armor, BuildingDef, buildingList, DAMAGE, Domain (+15 more)

### Community 13 - "combat.ts"
Cohesion: 0.21
Nodes (24): angleDiff(), dist(), headingTo(), turnToward(), wrap(), bestWeaponFor(), buildingCombat(), canHit() (+16 more)

### Community 14 - "World"
Cohesion: 0.16
Nodes (3): Country, OilField, World

### Community 15 - "dmath.ts"
Cohesion: 0.15
Nodes (15): T_MUNITION, atan(), atan2(), cos(), HALF_PI, PI, sin(), sinPoly() (+7 more)

### Community 16 - ".overlays"
Cohesion: 0.15
Nodes (5): drawSymbol(), IconShape, Rings, Sprites, WHITE

### Community 17 - "Pathfinder"
Cohesion: 0.18
Nodes (3): Pathfinder, PathGrid, spawnFrom()

### Community 18 - "Game.ts"
Cohesion: 0.11
Nodes (15): audio, HIJAZ, Synth, SYNTHS, THROTTLE, BAR_BUILD, C(), GameHooks (+7 more)

### Community 19 - ".constructor"
Cohesion: 0.12
Nodes (5): City, Rng, applyScenario(), Crises, Market

### Community 20 - "Controller.ts"
Cohesion: 0.20
Nodes (10): three, Mode, Ptr, Label, SEAS, QUALITY, QualityProfile, VEX (+2 more)

### Community 21 - "Menus.ts"
Cohesion: 0.10
Nodes (17): AchievementId, ACHIEVEMENTS, loadProfile(), Profile, RANK_XP, saveProfile(), unlock(), BUILD_ORDER (+9 more)

### Community 24 - "movement.ts"
Cohesion: 0.22
Nodes (17): clamp(), PathRequest, clampWorld(), dockedUpdate(), finishPath(), homeBase(), moveAir(), moveSurface() (+9 more)

### Community 26 - "EntityRenderer"
Cohesion: 0.22
Nodes (4): Batch, EntityRenderer, lerpAngle(), partMatrix()

### Community 27 - "buildings.ts"
Cohesion: 0.12
Nodes (11): BUILDING_MODELS, Factory, Anim, CAMO, FIXED, ModelPart, TEAM, tmpE (+3 more)

### Community 28 - "projectiles.ts"
Cohesion: 0.22
Nodes (15): Delivery, T_BALLISTIC, aimY(), arcPos(), baseProjectile(), destroyThreat(), GUIDED_TURN, impact() (+7 more)

### Community 30 - "package.json"
Cohesion: 0.13
Nodes (13): description, name, private, type, version, @fontsource/rajdhani, @fontsource/vazirmatn, postprocessing (+5 more)

### Community 31 - "Transport.ts"
Cohesion: 0.16
Nodes (6): peerjs, Envelope, ICE, PeerTransport, randomCode(), Transport

### Community 32 - "svgIcon"
Cohesion: 0.35
Nodes (4): compact(), digits(), svgIcon(), CommandPanel

### Community 33 - "main.ts"
Cohesion: 0.21
Nodes (11): Lang, State, defaultSettings(), loadSettings(), Settings, modelMaterial(), autoQuality(), ImageryProvider (+3 more)

### Community 36 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, resolveJsonModule (+6 more)

### Community 37 - "Session"
Cohesion: 0.22
Nodes (4): LocalSession, Session, Markers, SimEvent

### Community 40 - "units.ts"
Cohesion: 0.18
Nodes (7): GLOW, CAMO_BY_ISO, camoFor(), Factory, truck(), UNIT_MODELS, wheels()

### Community 41 - "marketing-shots.mjs"
Cohesion: 0.20
Nodes (3): sharp, svg, overlay

### Community 42 - "Lockstep.ts"
Cohesion: 0.22
Nodes (10): SetupPrefs, dataHash(), LobbyPlayer, LobbySettings, LobbyState, PROTOCOL, ToClient, ToHost (+2 more)

### Community 43 - "EntityRenderer.ts"
Cohesion: 0.20
Nodes (10): _c, _e, _m, _p, _q, _s, _v, Wreck (+2 more)

### Community 46 - "num"
Cohesion: 0.44
Nodes (3): num(), SelectionPanel, thumb()

### Community 48 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, playwright-core, sharp, tsx, @types/node, @types/three, typescript, vite (+1 more)

### Community 52 - "vercel.json"
Cohesion: 0.25
Nodes (7): buildCommand, cleanUrls, framework, headers, outputDirectory, $schema, trailingSlash

### Community 53 - "mp-test.mjs"
Cohesion: 0.29
Nodes (4): bad, common, log(), secs

### Community 54 - "Terrain.ts"
Cohesion: 0.33
Nodes (5): Node, ELEVATION_MAX_ZOOM, ELEVATION_URL(), IMAGERY, Job

### Community 55 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, @fontsource/rajdhani, @fontsource/vazirmatn, peerjs, postprocessing, three

### Community 56 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, test, typecheck

### Community 57 - "playwright-core"
Cohesion: 0.40
Nodes (3): playwright-core, logs, [url, out, w = '1440', h = '900', actions = '']

## Knowledge Gaps
- **20 isolated node(s):** `@types/node`, `@types/three`, `tsx`, `typescript`, `Sea` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 295 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `World` connect `World` to `Theater`, `Particles`, `index.ts`, `theater.ts`, `commands.ts`, `world.ts`, `App`, `production.ts`, `defs.ts`, `combat.ts`, `dmath.ts`, `Pathfinder`, `Game.ts`, `.constructor`, `Controller.ts`, `LobbyHost`, `AIController`, `movement.ts`, `projectiles.ts`, `Vision`, `main.ts`, `LobbyClient`, `Session`, `LockstepSession`, `units.ts`, `Lockstep.ts`, `EntityRenderer.ts`, `Diplomacy`, `Building`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `applyCommand()` (e.g. with `.allied()` and `.get()`) actually correct?**
  _`applyCommand()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/node`, `@types/three`, `tsx` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.09254362771020624 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Controller.ts` to `main.ts`, `Particles`, `index.ts`, `units.ts`, `EntityRenderer.ts`, `.overlays`, `Game.ts`, `Terrain.ts`, `buildings.ts`, `package.json`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Should `Theater` be split into smaller, more focused modules?**
  _Cohesion score 0.06836055656382335 - nodes in this community are weakly interconnected._
- **Why does `Game` connect `index.ts` to `Controller`, `Theater`, `main.ts`, `EntityRenderer`, `Particles`, `Session`, `svgIcon`, `App`, `HUD`, `World`, `.overlays`, `Minimap`, `Game.ts`, `.dispose`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._