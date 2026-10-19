# Black Gold — Theater of War · طلای سیاه

A 3D real-time strategy game on the **real map of the Middle East**. Each player leads a real nation
with its real territory, cities and oil fields. You build a base, research modern weapons, fight with
drones, missiles and armour, and run diplomacy (alliances, pacts, trade, sanctions, world opinion).
It runs in the browser on desktop, tablet and phone, in English and Farsi.

**Live:** https://black-gold-war.vercel.app · **Play:** https://black-gold-war.vercel.app/play/

```bash
npm install
npm run dev      # http://localhost:5173/play/  (landing at /, Farsi landing at /fa/)
npm test         # determinism, rules, pathfinding, data
npm run build    # production build in dist/
vercel deploy --prod --yes
```

## What's in it

| Area | Highlights |
|---|---|
| Map | 3,963 × 3,631 km theater baked from real elevation (AWS Terrain Tiles), Natural Earth borders, 150 cities with real populations, roads, rivers, lakes and 37 real oil/gas fields. Terrain streams Sentinel-2 / NASA imagery and elevation tiles through a quadtree LOD. Every water body sits at its true level (Caspian −28 m, Dead Sea −415 m). |
| Units | 24 units: infantry (rifle, ATGM, MANPADS, engineers, special forces), armour, SPG, MLRS, SHORAD, long-range SAM/ABM, EW, missile TELs, FPV and loitering drones, armed MALE drones, attack helicopters, fighters, stealth bombers, fast attack craft, frigates and submarines. |
| Structures | 19, including HQ tech levels (T1–T3), research centre, radar, C-RAM, SAM batteries, laser air defence, missile bases, naval bases, airbases and FOBs. |
| Physics | Vehicles with momentum and turn rates; mass-weighted collision; terrain and road speed; convoys for long road marches; jets that keep airspeed, orbit and rearm; lead-predicted shells, ballistic arcs and guided missiles with proximity fuses. Rockets, cruise, ballistic and hypersonic missiles can all be intercepted. |
| Politics | Real 2025 blocs as an optional scenario (no wars at start). Units only fire on nations you are at war with. Casus belli, reputation, stability, war weariness, sanctions, trade, military access, calls to arms and AI diplomacy. |
| Economy | City taxes from real populations, derricks on real fields, a live Brent market with crises (Hormuz tanker crisis, OPEC cuts, gluts), refineries, a power grid and supply caps. |
| AI | Builds a base, manages its economy, researches, attacks, fires missiles, uses General's Powers and conducts diplomacy. It issues normal commands, so it is deterministic in multiplayer. |
| Multiplayer | Up to 8 players over peer-to-peer WebRTC (PeerJS), with no server needed. Deterministic lockstep with adaptive input delay and hash-based desync detection. If a player drops, the AI takes over; if the host drops, clients continue offline. |
| Presentation | Instanced procedural PBR models, NATO tactical symbols at strategic zoom, bloom and SMAA with AgX tone mapping, dynamic resolution, synthesized audio with reverb, and a responsive HUD with touch controls. Installable as a PWA. |
| SEO | Static landing pages (en/fa) with JSON-LD (`VideoGame`, `FAQPage`), Open Graph and Twitter cards, hreflang, sitemap and robots. |

## Architecture

See [CLAUDE.md](CLAUDE.md) for the module map, hard rules (determinism) and dev scripts.
The code knowledge graph lives in `graphify-out/`; refresh it with `graphify update .`.

## Data & licences

Elevation: AWS Terrain Tiles (SRTM/GMTED/ETOPO1). Imagery: NASA Blue Marble NG (public domain) and
**Sentinel-2 cloudless by EOX**. EOX imagery is CC BY-NC-SA 4.0 (**non-commercial**). For commercial
use, switch the default imagery to `gibs` in `src/meta/settings.ts` and `src/render/terrain/TileSource.ts`,
or license EOX. Vector data: Natural Earth (public domain).

This is a work of fiction for entertainment and implies no endorsement of any government or conflict.

