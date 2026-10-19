# Graph Report - bazi  (2026-10-19)

## Corpus Check
- 79 files · ~191,490 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 3, .css 2, .graphify-bak 1)

## Summary
- 1197 nodes · 3475 edges · 58 communities (39 shown, 19 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 327 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e58fed8f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Controller
- Terrain
- bake-geo.ts
- Effects.ts
- index.ts
- theater.ts
- commands.ts
- entities.ts
- main.ts
- world.ts
- Game
- Menus.ts
- defs.ts
- movement.ts
- World
- dmath.ts
- MapLayers
- Pathfinder
- Theater
- Rng
- Game.ts
- Cover
- LobbyHost
- AIController
- buildings.ts
- AudioEngine
- EntityRenderer
- units.ts
- projectiles.ts
- Vision
- package.json
- Transport.ts
- svgIcon
- .close
- LobbyClient
- CameraRig
- compilerOptions
- Stage
- LockstepSession
- marketing-shots.mjs
- Lockstep.ts
- EntityRenderer.ts
- part
- Diplomacy
- h
- LocalConn
- devDependencies
- Minimap
- PeerConn
- vercel.json
- mp-test.mjs
- TileSource
- dependencies
- scripts
- playwright-core
- vite.config.ts

## God Nodes (most connected - your core abstractions)
1. `World` - 87 edges
2. `Controller` - 46 edges
3. `t()` - 44 edges
4. `h()` - 41 edges
5. `dist()` - 33 edges
6. `applyCommand()` - 33 edges
7. `Terrain` - 29 edges
8. `Theater` - 29 edges
9. `AIController` - 29 edges
10. `Game` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Hard rules` --references--> `SimEvent`  [INFERRED]
  CLAUDE.md → src/sim/world.ts
- `Architecture (where things live)` --references--> `Input`  [INFERRED]
  CLAUDE.md → src/input/Input.ts
- `Architecture (where things live)` --references--> `Session`  [INFERRED]
  CLAUDE.md → src/net/Session.ts
- `Architecture (where things live)` --references--> `Transport`  [INFERRED]
  CLAUDE.md → src/net/Transport.ts
- `Architecture (where things live)` --references--> `CameraRig`  [INFERRED]
  CLAUDE.md → src/render/CameraRig.ts

## Import Cycles
- None detected.

## Communities (58 total, 19 thin omitted)

### Community 0 - "Controller"
Cohesion: 0.09
Nodes (3): Controller, Input, Entity

### Community 1 - "Terrain"
Cohesion: 0.16
Nodes (6): tileToWorldRect(), bilinear(), edgeIndices(), gridIndex(), injectTerrainShader(), Terrain

### Community 2 - "bake-geo.ts"
Cohesion: 0.08
Nodes (46): CACHE, clipLine(), Feature, fetchCached(), flat(), geomLines(), geomPolys(), latToTileY() (+38 more)

### Community 3 - "Effects.ts"
Cohesion: 0.07
Nodes (11): visAlt(), Effects, mergeSimple(), radialTexture(), COL, Layer, Particles, rs() (+3 more)

### Community 4 - "index.ts"
Cohesion: 0.07
Nodes (33): audio, HIJAZ, Synth, SYNTHS, THROTTLE, en, I18nKey, fa (+25 more)

### Community 5 - "theater.ts"
Cohesion: 0.09
Nodes (21): theater, w, counts, minutes, seed, t0, theater, tStart (+13 more)

### Community 6 - "commands.ts"
Cohesion: 0.13
Nodes (32): AGGRESSION, ATTACK_SIZE, MIX, applyCommand(), build(), fail(), ownUnits(), train() (+24 more)

### Community 7 - "entities.ts"
Cohesion: 0.09
Nodes (13): BuildingDef, StrikeKind, UnitDef, WeaponDef, Building, EntityBase, OrderType, Projectile (+5 more)

### Community 8 - "main.ts"
Cohesion: 0.06
Nodes (22): Lang, setLang(), App, State, AchievementId, ACHIEVEMENTS, loadProfile(), Profile (+14 more)

### Community 9 - "world.ts"
Cohesion: 0.17
Nodes (20): DT, ECON, UNITS, sqrt, oilValue(), queuedSupply(), sanctionMul(), sellEfficiency() (+12 more)

### Community 10 - "Game"
Cohesion: 0.15
Nodes (4): Game, loc(), DiplomacyPanel, HUD

### Community 11 - "Menus.ts"
Cohesion: 0.18
Nodes (15): getLang(), t(), rankOf(), rankProgress(), randomCode(), BLOC_ALLIES, BLOC_RIVALS, countryOil() (+7 more)

### Community 12 - "defs.ts"
Cohesion: 0.10
Nodes (19): Armor, BUILD_ORDER, buildingList, DAMAGE, Domain, Flight, PowerDef, ResearchDef (+11 more)

### Community 13 - "movement.ts"
Cohesion: 0.15
Nodes (37): angleDiff(), dist(), dist2(), headingTo(), turnToward(), wrap(), bestWeaponFor(), buildingCombat() (+29 more)

### Community 14 - "World"
Cohesion: 0.14
Nodes (5): Country, City, OilField, Crises, World

### Community 15 - "dmath.ts"
Cohesion: 0.20
Nodes (13): atan(), atan2(), cos(), HALF_PI, PI, sin(), sinPoly(), TAU (+5 more)

### Community 16 - "MapLayers"
Cohesion: 0.12
Nodes (12): Architecture (where things live), Black Gold — Theater of War, Commands, Debugging, graphify, Hard rules, Token-efficient workflow, Architecture (+4 more)

### Community 17 - "Pathfinder"
Cohesion: 0.15
Nodes (5): Pathfinder, PathGrid, PathRequest, PathJob, spawnFrom()

### Community 20 - "Game.ts"
Cohesion: 0.10
Nodes (23): three, BAR_BUILD, C(), GameHooks, HOVER, SEL_ALLY, SEL_ENEMY, SEL_NEUTRAL (+15 more)

### Community 21 - "Cover"
Cohesion: 0.17
Nodes (12): Cover, Arid, Farmland, Forest, Lake, Rock, Sand, Sea (+4 more)

### Community 24 - "buildings.ts"
Cohesion: 0.20
Nodes (4): BuildingModel, Factory, FIXED, ModelDef

### Community 26 - "EntityRenderer"
Cohesion: 0.14
Nodes (5): Batch, EntityRenderer, lerpAngle(), partMatrix(), camoFor()

### Community 27 - "units.ts"
Cohesion: 0.14
Nodes (13): Anim, CAMO, GLOW, ModelPart, TEAM, tmpE, tmpM, tmpQ (+5 more)

### Community 28 - "projectiles.ts"
Cohesion: 0.22
Nodes (18): Delivery, clamp(), aimY(), arcPos(), baseProjectile(), destroyThreat(), fireWeapon(), GUIDED_TURN (+10 more)

### Community 30 - "package.json"
Cohesion: 0.13
Nodes (13): description, name, private, type, version, @fontsource/rajdhani, @fontsource/vazirmatn, postprocessing (+5 more)

### Community 31 - "Transport.ts"
Cohesion: 0.17
Nodes (5): peerjs, Envelope, ICE, PeerTransport, Transport

### Community 32 - "svgIcon"
Cohesion: 0.32
Nodes (5): compact(), digits(), num(), svgIcon(), CommandPanel

### Community 36 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, resolveJsonModule (+6 more)

### Community 41 - "marketing-shots.mjs"
Cohesion: 0.20
Nodes (3): sharp, svg, overlay

### Community 42 - "Lockstep.ts"
Cohesion: 0.08
Nodes (26): dataHash(), LobbyPlayer, LobbySettings, LobbyState, PROTOCOL, ToClient, ToHost, Session (+18 more)

### Community 43 - "EntityRenderer.ts"
Cohesion: 0.16
Nodes (13): _c, _e, _m, _p, _q, _s, _v, Wreck (+5 more)

### Community 46 - "h"
Cohesion: 0.40
Nodes (3): h(), SelectionPanel, thumb()

### Community 48 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, playwright-core, sharp, tsx, @types/node, @types/three, typescript, vite (+1 more)

### Community 52 - "vercel.json"
Cohesion: 0.25
Nodes (7): buildCommand, cleanUrls, framework, headers, outputDirectory, $schema, trailingSlash

### Community 53 - "mp-test.mjs"
Cohesion: 0.29
Nodes (4): bad, common, log(), secs

### Community 54 - "TileSource"
Cohesion: 0.18
Nodes (5): ELEVATION_MAX_ZOOM, ELEVATION_URL(), IMAGERY, Job, TileSource

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
- **20 isolated node(s):** `tsx`, `@types/node`, `@types/three`, `typescript`, `Arid` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 298 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `World` connect `World` to `Effects.ts`, `theater.ts`, `commands.ts`, `entities.ts`, `main.ts`, `world.ts`, `Game`, `movement.ts`, `dmath.ts`, `MapLayers`, `Pathfinder`, `Rng`, `Game.ts`, `LobbyHost`, `AIController`, `EntityRenderer`, `projectiles.ts`, `Vision`, `LobbyClient`, `LockstepSession`, `Lockstep.ts`, `EntityRenderer.ts`, `Diplomacy`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **What connects `tsx`, `@types/node`, `@types/three` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.09216589861751152 - nodes in this community are weakly interconnected._
- **Why does `Controller` connect `Controller` to `Game`, `Game.ts`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Should `bake-geo.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07510204081632653 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Game.ts` to `Effects.ts`, `main.ts`, `EntityRenderer.ts`, `Minimap`, `buildings.ts`, `units.ts`, `package.json`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `Effects.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0711864406779661 - nodes in this community are weakly interconnected._