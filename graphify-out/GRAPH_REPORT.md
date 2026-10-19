# Graph Report - bazi  (2026-10-19)

## Corpus Check
- 79 files · ~192,849 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 3, .css 2, .graphify-bak 1)

## Summary
- 1201 nodes · 3486 edges · 57 communities (38 shown, 19 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 328 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d5f4dd81`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Controller
- Theater
- bake-geo.ts
- Particles
- index.ts
- sim.test.ts
- commands.ts
- entities.ts
- main.ts
- world.ts
- Game
- t
- defs.ts
- movement.ts
- World
- sin
- Architecture (where things live)
- Pathfinder
- .overlays
- Game.ts
- Controller.ts
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
- theater.ts
- Stage
- LockstepSession
- loc
- marketing-shots.mjs
- Menus.ts
- EntityRenderer.ts
- part
- MapLayers
- num
- LocalConn
- devDependencies
- Transport
- vercel.json
- mp-test.mjs
- dependencies
- scripts
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

## Communities (57 total, 19 thin omitted)

### Community 0 - "Controller"
Cohesion: 0.09
Nodes (3): Controller, Input, Entity

### Community 1 - "Theater"
Cohesion: 0.07
Nodes (13): tileToWorldRect(), Theater, bilinear(), edgeIndices(), gridIndex(), injectTerrainShader(), Node, Terrain (+5 more)

### Community 2 - "bake-geo.ts"
Cohesion: 0.08
Nodes (46): CACHE, clipLine(), Feature, fetchCached(), flat(), geomLines(), geomPolys(), latToTileY() (+38 more)

### Community 3 - "Particles"
Cohesion: 0.11
Nodes (8): visAlt(), Effects, mergeSimple(), radialTexture(), COL, Layer, Particles, rs()

### Community 4 - "index.ts"
Cohesion: 0.08
Nodes (30): audio, HIJAZ, Synth, SYNTHS, THROTTLE, en, I18nKey, fa (+22 more)

### Community 5 - "sim.test.ts"
Cohesion: 0.13
Nodes (13): vitest, theater, w, counts, minutes, seed, t0, theater (+5 more)

### Community 6 - "commands.ts"
Cohesion: 0.16
Nodes (29): applyCommand(), build(), fail(), ownUnits(), train(), ProposalKind, aiAccepts(), BLOCS (+21 more)

### Community 7 - "entities.ts"
Cohesion: 0.09
Nodes (13): BuildingDef, StrikeKind, UnitDef, WeaponDef, Building, EntityBase, OrderType, Projectile (+5 more)

### Community 8 - "main.ts"
Cohesion: 0.05
Nodes (36): loadTheater(), detectLang(), Lang, setLang(), App, State, AchievementId, ACHIEVEMENTS (+28 more)

### Community 9 - "world.ts"
Cohesion: 0.09
Nodes (33): Command, Controller, Country, CountryStats, Proposal, Rel, Alliance, Hostile (+25 more)

### Community 10 - "Game"
Cohesion: 0.14
Nodes (3): Game, HUD, Minimap

### Community 11 - "t"
Cohesion: 0.31
Nodes (6): getLang(), t(), rankOf(), rankProgress(), h(), Menus

### Community 12 - "defs.ts"
Cohesion: 0.08
Nodes (26): AGGRESSION, ATTACK_SIZE, MIX, Armor, buildingList, BUILDINGS, DAMAGE, Domain (+18 more)

### Community 13 - "movement.ts"
Cohesion: 0.10
Nodes (43): angleDiff(), atan(), atan2(), dist2(), HALF_PI, headingTo(), PI, sinPoly() (+35 more)

### Community 14 - "World"
Cohesion: 0.09
Nodes (6): Diplomacy, City, OilField, applyScenario(), Crises, World

### Community 15 - "sin"
Cohesion: 0.39
Nodes (8): T_MUNITION, cos(), sin(), moveUnits(), blankShell(), offmapBomb(), offmapShell(), usePower()

### Community 16 - "Architecture (where things live)"
Cohesion: 0.15
Nodes (11): Architecture (where things live), Black Gold — Theater of War, Commands, Debugging, graphify, Hard rules, Token-efficient workflow, Architecture (+3 more)

### Community 17 - "Pathfinder"
Cohesion: 0.09
Nodes (5): Pathfinder, PathGrid, Rng, Market, spawnFrom()

### Community 19 - "Game.ts"
Cohesion: 0.12
Nodes (12): BAR_BUILD, C(), GameHooks, HOVER, SEL_ALLY, SEL_ENEMY, SEL_NEUTRAL, SEL_OWN (+4 more)

### Community 20 - "Controller.ts"
Cohesion: 0.18
Nodes (11): postprocessing, three, Mode, Ptr, Label, SEAS, QualityProfile, VEX (+3 more)

### Community 21 - "Cover"
Cohesion: 0.17
Nodes (12): Cover, Arid, Farmland, Forest, Lake, Rock, Sand, Sea (+4 more)

### Community 24 - "buildings.ts"
Cohesion: 0.20
Nodes (4): BuildingModel, Factory, ModelDef, TEAM

### Community 26 - "EntityRenderer"
Cohesion: 0.16
Nodes (4): Batch, EntityRenderer, lerpAngle(), partMatrix()

### Community 27 - "units.ts"
Cohesion: 0.14
Nodes (13): Anim, CAMO, FIXED, GLOW, ModelPart, tmpE, tmpM, tmpQ (+5 more)

### Community 28 - "projectiles.ts"
Cohesion: 0.23
Nodes (20): Delivery, clamp(), dist(), aimY(), arcPos(), baseProjectile(), destroyThreat(), fireWeapon() (+12 more)

### Community 30 - "package.json"
Cohesion: 0.15
Nodes (11): description, name, private, type, version, @fontsource/rajdhani, @fontsource/vazirmatn, tsx (+3 more)

### Community 31 - "Transport.ts"
Cohesion: 0.16
Nodes (6): peerjs, Envelope, ICE, PeerConn, PeerTransport, randomCode()

### Community 32 - "svgIcon"
Cohesion: 0.35
Nodes (4): compact(), digits(), svgIcon(), CommandPanel

### Community 36 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, resolveJsonModule (+6 more)

### Community 37 - "theater.ts"
Cohesion: 0.18
Nodes (9): CityMeta, CountryMeta, COVER_SPEED, FLAG_COAST, FLAG_RIVER, FLAG_ROAD, Localized, OilMeta (+1 more)

### Community 41 - "marketing-shots.mjs"
Cohesion: 0.20
Nodes (3): sharp, svg, overlay

### Community 42 - "Menus.ts"
Cohesion: 0.18
Nodes (10): BUILD_ORDER, BLOC_ALLIES, BLOC_RIVALS, countryOil(), countryPop(), DIFFS, FUNDS, LIMITS (+2 more)

### Community 43 - "EntityRenderer.ts"
Cohesion: 0.16
Nodes (12): _c, _e, _m, _p, _q, _s, _v, Wreck (+4 more)

### Community 48 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, playwright-core, sharp, tsx, @types/node, @types/three, typescript, vite (+1 more)

### Community 52 - "vercel.json"
Cohesion: 0.25
Nodes (7): buildCommand, cleanUrls, framework, headers, outputDirectory, $schema, trailingSlash

### Community 53 - "mp-test.mjs"
Cohesion: 0.17
Nodes (7): playwright-core, bad, common, log(), secs, logs, [url, out, w = '1440', h = '900', actions = '']

### Community 55 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, @fontsource/rajdhani, @fontsource/vazirmatn, peerjs, postprocessing, three

### Community 56 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, test, typecheck

## Knowledge Gaps
- **20 isolated node(s):** `@types/node`, `@types/three`, `tsx`, `typescript`, `Sea` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 296 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `World` connect `World` to `Theater`, `Particles`, `sim.test.ts`, `commands.ts`, `entities.ts`, `main.ts`, `world.ts`, `Game`, `defs.ts`, `movement.ts`, `sin`, `Pathfinder`, `Game.ts`, `Controller.ts`, `LobbyHost`, `AIController`, `projectiles.ts`, `Vision`, `LobbyClient`, `LockstepSession`, `EntityRenderer.ts`, `MapLayers`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `applyCommand()` (e.g. with `.allied()` and `.get()`) actually correct?**
  _`applyCommand()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@types/node`, `@types/three`, `tsx` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.09216589861751152 - nodes in this community are weakly interconnected._
- **Why does `Game` connect `Game` to `Controller`, `svgIcon`, `Particles`, `index.ts`, `main.ts`, `loc`, `MapLayers`, `World`, `.overlays`, `Game.ts`, `EntityRenderer`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Should `Theater` be split into smaller, more focused modules?**
  _Cohesion score 0.0701344243132671 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Controller.ts` to `Theater`, `Particles`, `index.ts`, `main.ts`, `EntityRenderer.ts`, `defs.ts`, `Game.ts`, `buildings.ts`, `units.ts`, `package.json`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._