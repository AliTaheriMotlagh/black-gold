# Graph Report - bazi  (2026-10-19)

## Corpus Check
- 79 files · ~192,849 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 3, .css 2, .graphify-bak 1)

## Summary
- 1201 nodes · 3482 edges · 57 communities (38 shown, 19 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 328 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a5661471`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Controller
- Theater
- bake-geo.ts
- Particles
- index.ts
- simbench.ts
- commands.ts
- entities.ts
- main.ts
- economy.ts
- Game
- t
- world.ts
- movement.ts
- Diplomacy
- powers.ts
- Architecture (where things live)
- World
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
- combat.ts
- sim.test.ts
- PeerConn
- Rel
- vercel.json
- country.ts
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
9. `Game` - 29 edges
10. `AIController` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Hard rules` --references--> `SimEvent`  [INFERRED]
  CLAUDE.md → src/sim/world.ts
- `Architecture (where things live)` --references--> `MapLayers`  [INFERRED]
  CLAUDE.md → src/render/MapLayers.ts
- `Architecture (where things live)` --references--> `World3D`  [INFERRED]
  CLAUDE.md → src/render/World3D.ts
- `Architecture (where things live)` --references--> `Input`  [INFERRED]
  CLAUDE.md → src/input/Input.ts
- `Architecture (where things live)` --references--> `EntityRenderer`  [INFERRED]
  CLAUDE.md → src/render/EntityRenderer.ts

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

### Community 5 - "simbench.ts"
Cohesion: 0.20
Nodes (9): counts, minutes, seed, t0, theater, tStart, w, wars (+1 more)

### Community 6 - "commands.ts"
Cohesion: 0.16
Nodes (28): applyCommand(), build(), fail(), ownUnits(), train(), aiAccepts(), BLOCS, borderViolations() (+20 more)

### Community 7 - "entities.ts"
Cohesion: 0.14
Nodes (10): StrikeKind, UnitDef, WeaponDef, EntityBase, OrderType, Projectile, Unit, WeaponState (+2 more)

### Community 8 - "main.ts"
Cohesion: 0.05
Nodes (37): loadTheater(), detectLang(), Lang, setLang(), App, State, AchievementId, ACHIEVEMENTS (+29 more)

### Community 9 - "economy.ts"
Cohesion: 0.33
Nodes (9): oilValue(), queuedSupply(), sanctionMul(), sellEfficiency(), sellOil(), unitSupply(), updateEconomy(), updatePolitics() (+1 more)

### Community 10 - "Game"
Cohesion: 0.14
Nodes (3): Game, HUD, Minimap

### Community 11 - "t"
Cohesion: 0.31
Nodes (6): getLang(), t(), rankOf(), rankProgress(), h(), Menus

### Community 12 - "world.ts"
Cohesion: 0.08
Nodes (34): AGGRESSION, ATTACK_SIZE, MIX, Command, Armor, buildingList, BUILDINGS, DAMAGE (+26 more)

### Community 13 - "movement.ts"
Cohesion: 0.14
Nodes (29): angleDiff(), atan(), atan2(), clamp(), cos(), HALF_PI, headingTo(), PI (+21 more)

### Community 15 - "powers.ts"
Cohesion: 0.60
Nodes (5): T_MUNITION, blankShell(), offmapBomb(), offmapShell(), usePower()

### Community 16 - "Architecture (where things live)"
Cohesion: 0.15
Nodes (11): Architecture (where things live), Black Gold — Theater of War, Commands, Debugging, graphify, Hard rules, Token-efficient workflow, Architecture (+3 more)

### Community 17 - "World"
Cohesion: 0.06
Nodes (14): Country, City, OilField, Pathfinder, PathGrid, Rng, Crises, CrisisId (+6 more)

### Community 19 - "Game.ts"
Cohesion: 0.12
Nodes (12): BAR_BUILD, C(), GameHooks, HOVER, SEL_ALLY, SEL_ENEMY, SEL_NEUTRAL, SEL_OWN (+4 more)

### Community 20 - "Controller.ts"
Cohesion: 0.18
Nodes (11): postprocessing, three, Mode, Ptr, Label, SEAS, QualityProfile, VEX (+3 more)

### Community 21 - "Cover"
Cohesion: 0.17
Nodes (12): Cover, Arid, Farmland, Forest, Lake, Rock, Sand, Sea (+4 more)

### Community 23 - "AIController"
Cohesion: 0.12
Nodes (4): AIController, BuildingDef, Building, MoveState

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
Cohesion: 0.18
Nodes (21): Delivery, T_BALLISTIC, sqrt, aimY(), arcPos(), baseProjectile(), destroyThreat(), fireWeapon() (+13 more)

### Community 30 - "package.json"
Cohesion: 0.04
Nodes (40): dependencies, @fontsource/rajdhani, @fontsource/vazirmatn, peerjs, postprocessing, three, description, devDependencies (+32 more)

### Community 31 - "Transport.ts"
Cohesion: 0.16
Nodes (6): peerjs, Envelope, ICE, PeerTransport, randomCode(), Transport

### Community 32 - "svgIcon"
Cohesion: 0.35
Nodes (4): compact(), digits(), svgIcon(), CommandPanel

### Community 36 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, resolveJsonModule (+6 more)

### Community 37 - "theater.ts"
Cohesion: 0.22
Nodes (8): CityMeta, COVER_SPEED, FLAG_COAST, FLAG_RIVER, FLAG_ROAD, Localized, OilMeta, TheaterMeta

### Community 41 - "marketing-shots.mjs"
Cohesion: 0.20
Nodes (3): sharp, svg, overlay

### Community 42 - "Menus.ts"
Cohesion: 0.18
Nodes (10): BUILD_ORDER, BLOC_ALLIES, BLOC_RIVALS, countryOil(), countryPop(), DIFFS, FUNDS, LIMITS (+2 more)

### Community 43 - "EntityRenderer.ts"
Cohesion: 0.16
Nodes (12): _c, _e, _m, _p, _q, _s, _v, Wreck (+4 more)

### Community 48 - "combat.ts"
Cohesion: 0.25
Nodes (19): dist(), dist2(), bestWeaponFor(), buildingCombat(), canHit(), edgeDist(), findTarget(), findThreat() (+11 more)

### Community 49 - "sim.test.ts"
Cohesion: 0.29
Nodes (3): theater, w, parseTheater()

### Community 51 - "Rel"
Cohesion: 0.25
Nodes (6): Rel, Alliance, Hostile, Neutral, Pact, War

### Community 52 - "vercel.json"
Cohesion: 0.25
Nodes (7): buildCommand, cleanUrls, framework, headers, outputDirectory, $schema, trailingSlash

### Community 53 - "country.ts"
Cohesion: 0.29
Nodes (5): CountryMeta, Controller, CountryStats, Proposal, ProposalKind

## Knowledge Gaps
- **20 isolated node(s):** `Arid`, `Farmland`, `Forest`, `Lake`, `Rock` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 296 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `World` connect `World` to `Theater`, `Particles`, `simbench.ts`, `commands.ts`, `entities.ts`, `main.ts`, `economy.ts`, `Game`, `world.ts`, `movement.ts`, `Diplomacy`, `powers.ts`, `Game.ts`, `Controller.ts`, `LobbyHost`, `AIController`, `projectiles.ts`, `Vision`, `LobbyClient`, `LockstepSession`, `EntityRenderer.ts`, `MapLayers`, `combat.ts`, `sim.test.ts`, `Rel`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **What connects `Arid`, `Farmland`, `Forest` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.09216589861751152 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Controller.ts` to `Theater`, `Particles`, `index.ts`, `main.ts`, `EntityRenderer.ts`, `world.ts`, `Game.ts`, `buildings.ts`, `units.ts`, `package.json`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `Theater` be split into smaller, more focused modules?**
  _Cohesion score 0.0701344243132671 - nodes in this community are weakly interconnected._
- **Why does `Game` connect `Game` to `Controller`, `svgIcon`, `Particles`, `index.ts`, `main.ts`, `loc`, `MapLayers`, `World`, `.overlays`, `Game.ts`, `EntityRenderer`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Should `bake-geo.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07738095238095238 - nodes in this community are weakly interconnected._