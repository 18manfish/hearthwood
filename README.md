# 🌿 Hearthwood

A cozy, multiplayer island-life game inspired by Animal Crossing. You can play it in the browser. Rendering uses **Three.js**, and an **authoritative Node.js server** runs the game.

Each player creates a boy or girl villager and picks a starting location on the world map. Then they build their island up from a campfire to a town with seven villagers. Players can visit friends' islands and meet up in shared hubs.

---

## Quick start (Windows)

```powershell
# 1. One-time setup: installs Node.js LTS with winget if it's missing, then the npm packages
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# 2. Run server + client together
npm run dev
```

Open **http://localhost:5173**. To try multiplayer on one PC, open a second browser profile or a private window. Each browser gets its own guest account.

| Command | What it does |
|---|---|
| `npm run dev` | Game server on :8787 plus the Vite dev client on :5173 (hot reload) |
| `npm run dev:fast` | Same, but construction and tree growth run 60× faster, day-gates are lifted and dev chat commands are on |
| `npm test` | Starts a real server and plays it with bot clients. It checks the server rules: movement, harvesting, crafting, building, villagers, fishing, access control, friends, rate limits and saving |
| `npm run typecheck` | Strict TypeScript check of shared, server and client |
| `npm run build && npm start` | Production build. The server also serves the built client on :8787 |

In VS Code, press **Ctrl+Shift+B** to run the dev task. Use **F5 → "Debug game server"** to set breakpoints in the server.

**Developer debug menu: press F3 (or `)**, or click 🐞.
- **Live stats:** FPS, ping, position, tile, cliff level, ramp, room, environment and draw calls.
- **Season picker:** lists only the seasons that exist in the island's climate. On a `dev:fast` server it changes the real season of the island and its interiors, so fish, weather and visuals all change for everyone there. Otherwise it's a visual preview for you only.
- **Client-only visual controls:** world-bend strength, a time-of-day shift, a weather preview, and shadows, labels and collision-grid overlay on or off.
- **Server buttons (need `dev:fast`):** material kit, coins, day +1/+7/+30, finish construction and growth, respawn resources now, give any item, set the island's weather, teleport to spawn.

The server buttons are sent as a schema-checked `dev` message, and the server rejects them unless it runs with `DEV_FAST=1`. The same commands work as chat shortcuts: `/kit /give /coins /day /finish /respawn /weather /season /tp /clearinv`.

---

## How to play

| Key | Action |
|---|---|
| WASD / arrows | Walk (hold **Shift** to run) |
| **E** / Space | Use whatever is in front of you: shake or chop a tree, break a rock, pick, talk, use a building, cast or reel |
| 1–5 | Hands · Axe · Shovel · Rod · Sapling |
| F | Pick up placed furniture |
| G · I · C · B · M · O · L · V | Goals · Pockets · Craft · Build · Map · Friends · Mail · Island & visitors |
| Enter | Chat |
| R / Esc | Rotate / cancel placement |
| F3 or ` | Developer debug menu |

### Progression (follows the real calendar)
1. **Day 1: Make Camp.** Shake trees for branches, pick up loose stones and pick bushes for fibre. Craft a stone axe, shovel and fishing rod. Then build a tent, campfire and workbench.
2. **Week 1: Starter House.** Unlocks on day 2. Break rocks with the shovel to get clay.
3. **Month 1: Village.** The Town Hall unlocks on day 7. Build three villager houses, and a villager moves into each one when it's finished.
4. **Month 2: Thriving Town.** From day 31 you can have up to **7 villagers** and build the Post Office, Travel Agent, Clothing Shop, Restaurant, Tool Store and Furniture Store.

**Resources.** Used-up resources **disappear and respawn later**:
- A **rock** crumbles after 6 shovel hits (8 with the iron shovel) and comes back after about a day. Rocks sometimes give clay or iron ore.
- A **bush** disappears once it's picked and regrows after about 12 hours.
- A felled **tree** leaves a stump. If you dig the stump up you often get a sapling, and a wild tree sprouts again about 2 days later. Undug stumps rot away on their own and sprout a sapling.

If a resource's old spot is blocked when it's due back (you built there, placed furniture, or someone is standing on it), it appears on the nearest free tile instead. If nothing nearby is free, it picks a random free tile on the island. Saplings you plant yourself grow into full trees in about a day.

Mushrooms (and rare glowing *glowcaps*) appear under trees, and flowers pop up in the grass. Fish depend on the biome, freshwater or sea, the season and the hour.

**Paths.** In the Build menu (B) under 🛤️ Paths, choose one of five paths and paint it tile by tile: click and drag on the ground, or press **E** to pave the tile in front of you. **Esc** stops painting. The eraser removes paths and refunds their materials.

| Path | Cost per tile |
|---|---|
| Dirt path | free, needs a shovel |
| Gravel path | 1 stone |
| Stepping stones | 2 stone |
| Brick path | 2 clay |
| Wooden boardwalk | 2 wood |

Adjacent tiles of the same path join up, and open edges get soft, bevelled borders. You can walk on paths and place furniture on them, but trees, flowers and respawning resources never appear on a path.

**Grass, foliage & footprints.** Grass tufts, tall grass, ferns, pond reeds, wildflowers, fallen leaves and snow clumps all sway in the wind. They follow the biome and the season:
- **Spring:** fresh green with lots of flowers.
- **Summer:** lush and tall.
- **Autumn:** golden grass with leaves under the trees.
- **Snowy winter:** a few frosted tufts and snow clumps.
- **Deserts** have dry, sparse grass; **tropical** islands and the **jungle** have dense, deep-green growth.

In snowy winters everyone who walks leaves footprints in the snow, and on beaches you leave prints in the sand all year round. The prints slowly fade away.

**Cliffs & ramps.** New islands have up to two cliff levels. You can only go up or down using the ramps; you can't climb or drop off a cliff edge. Each building has to sit on one level. Ramp landings are kept clear so that a plateau can never be cut off.

**Homes you can enter.** Walk up to your tent (or your starter house) and press **E** to go inside. Each has a bed and a storage chest, which is your sell box, plus the mailbox in the house. You can place furniture inside, and the door takes you back out.

**The rolling-log world.** The whole world curves away from the camera, like in Animal Crossing. This is a vertex-shader bend that is applied to every mesh, sprite and shadow. You can tune it in the debug menu.

**Villagers.** Talk to each villager once a day and give them one gift a day. They love some specific items, like whole categories of others (shown as a hint) and dislike some. Their friendship goes through five levels, and they give you a present at each new level.

### Locations, time & weather
- The location picker shows a small 3D preview of an example island for each biome, in the season it has right now. Pick one of 7 starting biomes: **Grassland, Tropical Island, Nordic Forest, Edge of the Forest, Desert Oasis, Jungle or Desert**. The world map also has three **shared hubs** open to everyone: Harbor Town Square, Aurora Lookout and Sunset Bazaar.
- **Sun and calendar** come from the island owner's real location. You can share it with the browser's geolocation, which is rounded to about 50 km; otherwise it's estimated from your time zone. The sun's real position drives day and night, dawn, dusk and stars.
- **Climate** comes from the biome. Temperate and Nordic islands have four seasons (Nordic winters are long, with snow and auroras). The tropics have wet and dry seasons, and deserts have hot and cool seasons. Weather (clear, cloudy, rain, storm, snow, fog, sandstorm or heatwave) is the same for everyone on an island at the same moment. It's computed from the island seed, the date and a 3-hour block.

### Visitors
In **Island & visitors (V)** you choose who may visit your island:
- 🔒 Nobody
- 💌 Friends only
- 🎟️ Friends + invite code (you can regenerate the code at any time)
- 🌍 Everyone (listed on the world map)

Visitors can walk around, chat, fish and befriend your villagers, but only the owner can harvest or build. The owner can send any visitor home.

---

## Architecture

```
hearthwood/
├─ shared/        Pure TypeScript used by both sides (no I/O)
│  └─ src/
│     ├─ protocol.ts   Message types + runtime schemas for every client message
│     ├─ schema.ts     Tiny dependency-free validator (unknown keys are dropped)
│     ├─ world.ts      Island generation (cliffs & ramps), interiors, level-aware collision, paths
│     ├─ env.ts        Solar position, seasons, weather, local time
│     └─ data/         Items, biomes, buildings, recipes, villagers, chapters
├─ server/        Authoritative game server (Node + ws)
│  ├─ src/
│  │  ├─ index.ts      HTTP (register, health, static) + WebSocket upgrade
│  │  ├─ store.ts      JSON persistence (atomic writes, dirty tracking)
│  │  └─ game/
│  │     ├─ Game.ts     Sessions, auth, rooms, travel, social, progression
│  │     ├─ Room.ts     One simulated location: world state, villagers, interest mgmt
│  │     ├─ actions.ts  Validation + execution of every player action
│  │     └─ Session.ts  Per-connection state, rate limiting
│  └─ test/run.ts   Bot-driven end-to-end test
└─ client/        Vite + Three.js
   └─ src/
      ├─ net.ts        WebSocket client (auth, reconnect, clock sync, act→result)
      ├─ game/World.ts Scene, prediction, interpolation, lighting, weather
      ├─ game/bend.ts  "Rolling log" world-curvature + wind-sway shader patch
      ├─ game/foliage.ts, footprints.ts, paths.ts  Instanced grass & foliage, fading footprints, path layer
      ├─ game/models.ts, characters.ts  Procedural low-poly art (no asset files)
      └─ ui/           Character creator, world map, HUD and menus
```

### Server-authoritative design
- **Clients send intents, never results.** For example, a client sends `{"t":"act","a":{"k":"chop","id":"o42"}}`. The server checks ownership, distance, tools, inventory, cooldowns, day-gates, footprint space and so on. Then it replies with `res` (ok / error and items gained) and broadcasts state deltas (`oAdd`, `bAdd`, `vs`…) to the room.
- **Every inbound message is schema-validated** (`shared/src/schema.ts`): types, ranges, string patterns and enum membership. Unknown fields are dropped. Malformed messages count as strikes, and repeated abuse disconnects the client.
- **Movement:** the client predicts its own movement using the same `slideMove`/`Grid` code as the server. The server checks each step for maximum speed, walkability and tunnelling (it samples the path). If a step fails, it sends a `corr` and the client snaps back. Other players are interpolated from 10 Hz snapshots.
- **Fishing timing is server-side.** The server chooses the fish and the bite time, then checks that the reel arrives inside the bite window plus a small network grace period.
- **Interest management:** each island, hub or tour is a `Room`, and only its members receive its updates. Idle rooms are unloaded. When an island loads again, the server catches up whatever happened meanwhile (growth, construction, the daily refresh).
- **Abuse protection:** a per-connection token-bucket rate limiter, a chat rate limit with sanitising (control and bidi characters are stripped), a WebSocket `maxPayload`, a hello timeout, ping/pong heartbeats, per-IP account-creation limits and an optional Origin allow-list (`ALLOWED_ORIGINS`).
- **Auth:** guest accounts. A random 256-bit token is stored in the browser, and the server keeps only its SHA-256 hash. The token is sent in the first WebSocket message rather than the URL, so it stays out of logs. A second login takes over the old session.
- **Determinism:** island generation uses integer-only hashing and noise, and the server also sends the tiles, cliff levels and ramps it generated. Weather comes from a seeded RNG, so all observers agree.
- **Cliffs on both sides:** `Grid.canMove` / `Grid.stepOk` define when you can move between levels: same level, or via a ramp from its bottom or sides, or from the tile directly uphill. The client uses them for prediction and the server uses the same code to validate every movement step.
- **Interiors are rooms too:** a tent or house interior is its own `Room` with its own interest management. Furniture you place inside is saved in the island record.
- **Respawn queue:** each island keeps a saved list of pending respawns. When the island loads again, the server catches up on any that came due while it was unloaded.
- **Versioned protocol:** if the versions don't match, the server asks the client to refresh.

### Configuration (environment variables)
`PORT` (8787), `HOST`, `DATA_DIR` (server/data), `CLIENT_DIST`, `ALLOWED_ORIGINS`, `DEV_FAST=1`. Gameplay constants are in `server/src/config.ts`, for example `treeStageMinutes` and the fishing window.

### Going further
- Swap `Store` for SQLite or Postgres; the interface is small.
- Add real accounts (OAuth or passkeys) on top of the token system.
- Put it behind HTTPS (the client switches to `wss://` automatically) and set `ALLOWED_ORIGINS`.
- If one process isn't enough, scale out by assigning rooms to worker processes.
