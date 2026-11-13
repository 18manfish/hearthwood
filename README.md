# 🌿 Hearthwood

A cozy, multiplayer island-life game inspired by Animal Crossing. You can play it in the browser. Rendering uses **Three.js**, and an **authoritative Node.js server** runs the game.

Each player creates a boy or girl villager and picks a starting location on the world map. Then they build their island up from a campfire to a town with seven villagers. Players can visit friends' islands and meet up in shared hubs.

### Accounts, admin tool and game creation tool

- **Accounts.** Players register with a username (3–20 letters, digits or `_`) and a password (8+ characters). Passwords are hashed with scrypt, and only SHA-256 hashes of login tokens are stored. Each account keeps its 5 most recent sessions, and logging in again elsewhere takes over the game session. **Outside dev mode registration is required**. Guest accounts created in dev mode are asked to pick a username and password the next time they connect to a non-dev server; they keep their island. The ⚙️ Island menu (V) shows who you're logged in as, a **Log out** button and links to the tools.
- **🛡️ Admin tool** at **`/admin.html`** (and `/admin` on the production server). It needs an admin account: put usernames in `ADMIN_USERS=alice,bob` when starting the server, or give someone the admin role in the tool. In dev mode every account counts as an admin.
  - **Players:** search, online status, profile (name, username, role, coins, gender, hat, look, redo character, permits, chapter, home island), inventory, hotbar, album and mail, kick, log out everywhere, set a password, ban (with reason and optional end date), unban and delete.
  - **Islands:** name, visitor access, invite code, biome, seed, founding day and world-map position. A **top-down 2D map** shows terrain, cliff levels, ramps, paths, trees and other objects, buildings, birds, villagers and the players on the island right now. The map has tools to select, move, paint terrain (tile type, cliff level, ramp direction), paint paths, add objects and buildings, and erase. You can also edit any object or building directly, move villagers in or out, edit friendships, reset terraforming, clear respawns or regenerate the island.
  - Saving an island that's in use rebuilds it at once; players standing on it are put back where they were. Every change is written to an **audit log**, which is viewable in the tool.
- **🛠️ Game creation tool** at **`/editor.html`**. **It's only available while the server runs in dev mode** (`npm run dev:fast`); otherwise the page and its API answer 404.
  - **Editable tables:** items (names, icons, categories, tags, sell and buy prices, stack size, which furniture **model** to use, clothing slot and cut, tools), fish and birds (prices, rarity, biomes, hours, seasons, bird colours and size), recipes, **shop stock (availability)**, buildings (costs, requirements, unlock day, build time, limits, colours), villagers (species model, personality, colours, catchphrase, likes, loves, dislikes, birthday), permit prices and path costs.
  - Furniture, birds, villagers and buildings show a live 3D preview.
  - Built-in rows can be edited but not deleted, because existing saves refer to them. New items, fish, birds, recipes and villagers can be added.
  - Everything is validated, and references must exist: recipe ingredients, shop items, loved gifts. Changes are stored in the database and applied to the running server. Clients load them when the page loads, and a toast tells online players to reload.
  - **Export / Import** moves a whole data set between servers, so you can design in dev mode and import the result into production.

---

## Quick start (Windows)

```powershell
# 1. One-time setup: installs Node.js LTS with winget if it's missing, then the npm packages
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# 2. Run server + client together
npm run dev
```

Open **http://localhost:5173**. Create an account (username and password) or, while the server runs in dev mode, click **Play as guest**. To try multiplayer on one PC, open a second browser profile or a private window.

Node.js **22.13 or newer** is required, because the server stores everything in Node's built-in SQLite database (`node:sqlite`). `setup.ps1` installs or updates Node for you.

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

The server buttons are sent as a schema-checked `dev` message, and the server rejects them unless it runs with `DEV_FAST=1`. The same commands work as chat shortcuts: `/kit /give /coins /day /finish /respawn /weather /season /tp /clearinv /permits /birds /beach /bottles`. `/permits` grants both Town Hall permits, `/birds [n]` lands a few birds next to you, `/beach [n]` washes things up on the beach, and `/bottles` delivers every bottle still at sea right away.

---

## How to play

| Key | Action |
|---|---|
| WASD / arrows | Walk (hold **Shift** to run) |
| **E** / Space | Use whatever is in front of you: shake or chop a tree, break a rock, pick, talk, use a building, cast or reel |
| 1–9, 0 | Hotbar slots (right-click a slot to change it, drag slots to rearrange) |
| F | Pick up placed furniture |
| G · I · C · B · M · O · L · K · V | Goals · Pockets · Craft · Build · Map · Friends · Mail · Album · Options |
| Enter | Chat |
| R / Esc | Rotate placement or switch terraforming tool / cancel |
| F3 or ` | Developer debug menu |

### Controller

The game works with any controller the browser supports, including Xbox, PlayStation, Switch Pro and most USB or Bluetooth pads. Plug it in and press any button. On-screen hints switch to controller glyphs, and back again as soon as you use the keyboard or mouse.

| Button | Action |
|---|---|
| Left stick / D-pad | Walk; hold **Ⓑ** to run |
| **Ⓐ** | Use / talk / reel in / confirm placement; hold while walking to paint a path |
| **Ⓑ** (tap) | Back: close a menu or dialog, cancel placement or painting |
| **Ⓧ** | Pockets |
| **Ⓨ** | Pick up furniture / rotate while placing / next terraforming tool |
| LB / RB | Previous / next hotbar slot |
| LT / RT | Build menu / craft menu |
| START / SELECT | Goals / world map |
| Right stick | Zoom the camera (scrolls when a menu is open) |
| R3 | Developer debug menu |

**In menus**, including character creation, the D-pad or left stick moves a highlight between controls and **Ⓐ** presses the highlighted one. Left/right change sliders and dropdowns. **When placing** a building, furniture or a path with the controller, the spot right in front of your character is used.

### Progression (follows the real calendar)
1. **Day 1: Make Camp.** Shake trees for branches, pick up loose stones and pick bushes for fibre. Craft a stone axe, shovel and fishing rod. Then build a tent, campfire and workbench.
2. **Week 1: Starter House.** Unlocks on day 2. Break rocks with the shovel to get clay.
   Then put up a **mailbox** (4 wood, 2 stone, 1 clay). From it you can send letters and gifts to friends, and visitors can drop a letter in it for you. Its flag goes up when you have unread mail. Letters can be read anywhere (L).
3. **Month 1: Village.** The Town Hall unlocks on day 7. Build three villager houses, and a villager moves into each one when it's finished.
4. **Month 2: Thriving Town.** From day 31 you can have up to **7 villagers** and build the Travel Agent, Clothing Shop, Restaurant, Tool Store and Furniture Store.

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

**Hotbar.** The hotbar has ten slots. Right-click a slot to choose the tool in it, drag a slot onto another to swap them, or use the dropdowns at the top of Pockets (I), which also works with a controller. Your layout is saved with your account.

**Clothes.** Everyone always wears trousers and an undershirt (you pick their colours, along with your face: eye shape, brows, nose, mouth and cheeks). On top of that you wear one item per slot: a **hat**, a **top** (T-shirt, shirt, pullover or a short, knee-length or long dress), a **skirt** (short, knee-length or long), a **jacket or coat**, **shoes** (sneakers, boots, sandals) and **gloves or mittens**. A dress and a skirt replace each other. Character creation offers six starter sets (Casual, Cozy, Summer, Explorer, Picnic, Winter) which you keep; the Clothing Shop sells the rest and lets you try things on. Wear and take off clothes from your pockets (I). Characters made before this model (`LOOK_VERSION` in `shared/src/protocol.ts`) are asked to redo their looks the next time they log in: the character generator opens with their current looks, and their name, island, pockets and progress stay as they are. Admins can ask a single player to redo their character from the player page (**Redo character**); raising `LOOK_VERSION` asks everyone. Clothing items have `wear` (slot) and `garment` (cut) in the item table; the sets are `OUTFIT_SETS` in `shared/src/data/clothing.ts`, the model is `client/src/game/player.ts`.

**Birds & the album.** Birds land on islands, hop around for a few minutes and then fly off. Which birds appear depends on the biome, the time of day and the season; owls and nightjars only come out at night. Craft a **Bird Net** by hand (4 wood, 5 fiber), or buy the better **Silk Bird Net** at the Tool Store. Select the net in your hotbar, walk up to a bird and press **E**. Rare birds are warier and fly off more often. Every fish and bird you catch goes into the **Album (K)**. Entries you haven't caught yet show where and when to look.

**Water.** A **river** is fresh water that's connected to the sea; a **pond** isn't. New islands have a river that starts at a lake on the highest plateau and runs down to the north coast. Wherever it drops a cliff level there's a **waterfall**. River biomes (Nordic forest, Forest edge, Jungle) and the grassland also have a pond. Each kind of water has its own fish: sea fish, river fish (trout, salmon, dace, eel, sturgeon…) and pond fish (carp, koi, bitterling, goldfish, frogs…). Fish only bite where you can see one: dark **fish shadows** swim in the water, and you cast next to one. In the sea they come in three sizes, and each size has its own fish (sardines and clownfish are small, mackerel and sea bream medium, cod, tuna and oarfish large). Rivers and ponds only have medium shadows, and any of their fish can bite there. Catch the fish and its shadow is gone; the others swim off after a few minutes and new ones turn up. Out in the deep sea, schools of small fish swim by. When you dig or fill water while terraforming, the game re-sorts the tiles automatically: water joined to the sea or a river becomes river.

**Bridges.** Build menu → 🌉 Bridge (north–south or east–west), for 30 wood and 10 stone, after a workbench. A bridge spans a 2-tile river or pond. Both ends need flat ground at the same height, and you walk across at that height, even over a river running in a gorge.

**Beachcombing & messages in bottles.** Seashells, driftwood, seaweed, sea glass, conches, coral (on tropical islands) and the odd pearl wash up on beaches over time; walk up and press **E**. Craft a **Message Bottle** by hand from 2 sea glass and 1 fiber (empty bottles sometimes wash up too). In Pockets choose **Write & throw**, then throw it from the beach. Within 5 minutes to 24 hours it washes up on a **random other player's** island, and that island's owner reads it in their letters. If nobody else is around, it drifts back to you. You can throw one every 10 minutes.

**Builders & residents.** In **⚙️ Options (V)** the island owner can give any friend a role:
- **🔨 Builder:** may build, pave, terraform (with the owner's permits), move buildings and place furniture.
- **🏡 Resident:** lives on the island and has the same rights as the owner: gathering, the workbench and shops, the Town Hall, and building **their own tent and house**, which belong to them. The only things a resident can't do are manage visitors and roles.

Builders and residents can always visit, whatever the access setting. The islands you help on are listed in Options with a **Go there** button.

**Location & time zone.** Also in Options: pick your time zone and latitude/longitude, or press **Use this device**. Your island's sun, seasons and clock follow that place right away. It's stored rounded to about 50 km.

**Doors.** You go into a building only when you stand in front of its door (the middle of its front side), not from the back or the sides.

**Start screen.** After logging in you see the logo, the news boxes and a **Play** button. Admins write and edit the news boxes in the admin tool under **📰 News**: icon, title, text with paragraphs and `**bold**`, pinned or draft, with a live preview.

**Moving buildings.** In the Build menu under 🚚 Move a building, pick a building up and click its new spot. This costs coins depending on its size. Villagers and everything inside move along with it. The dock stays where it is.

**Terraforming.** Buy permits at your **Town Hall** counter: the **Cliff Construction Permit** (2000 coins) lets you raise and lower cliffs and build ramps, and the **Waterscaping Permit** (1500 coins) lets you dig and fill ponds. Then pick ⛰️ or 💧 in your hotbar, or use the Build menu (B) under ⛰️ Terraforming, and click or drag tiles just like paths. Press **R** (or **Ⓨ**) to switch between the permit's tools:

| Tool | What it does |
| --- | --- |
| ⛰️ Raise / 🕳️ Lower cliff | Moves ground up or down one level, to a maximum of 3. Cliffs grow one level at a time and need solid ground all around them. |
| 📐 Build / 🚧 Remove ramp | Adds a grassy slope up to a cliff one level higher, or turns a ramp back into flat ground. |
| 🪨 🪜 🪵 Stairs | Stone stairs, wooden stairs with posts and a rail, or log steps. Build them like a ramp, or use one on an existing ramp to change its look. |
| 💧 Dig / 🟫 Fill water | Digs water into ground or beach sand on any cliff level, also right against a cliff (joined to the sea or a river it's river, otherwise a pond), or fills it back in (sand on the beach). Water can't sit at a cliff edge with dry ground below – dig water below first and you get a **waterfall**. |

The tile must be empty, and nobody can be standing on it. Reshaped terrain is saved with your island.

New islands are **72 × 72 tiles**, 1.5× larger than before, with proportionally more trees, rocks and bushes. Islands created before this change keep their 48 × 48 layout so nothing on them moves.

**Grass, foliage & footprints.** Grass tufts, tall grass, ferns, pond reeds, wildflowers, fallen leaves and snow clumps all sway in the wind. They follow the biome and the season:
- **Spring:** fresh green with lots of flowers.
- **Summer:** lush and tall.
- **Autumn:** golden grass with leaves under the trees.
- **Snowy winter:** a few frosted tufts and snow clumps.
- **Deserts** have dry, sparse grass; **tropical** islands and the **jungle** have dense, deep-green growth.

In snowy winters everyone who walks leaves footprints in the snow, and on beaches you leave prints in the sand all year round. The prints slowly fade away.

**Cliffs & ramps.** New islands have up to two cliff levels. You can only go up or down using ramps or stairs; you can't climb or drop off a cliff edge. Each building has to sit on one level. Ramp landings are kept clear so that a plateau can never be cut off.

**Every building has an inside.** Walk up to a door and press **E** (or **Ⓐ**) to go in, and use the doormat to leave.
- **Your tent and starter house:** a bed and a storage chest (your sell box). You can place furniture inside, and it's saved.
- **Town Hall:** a clerk's counter where you sell items and manage visitors. Also benches, banners, the island map and a red runner carpet.
- **Shops:** every shop has a shopkeeper behind the counter, and that's where you buy, cook, change your look or book a mystery tour. Shops no longer serve you through the wall.
  - **Tool Store:** tool racks and crates.
  - **Furniture Store:** a showroom.
  - **Clothing Shop:** clothes racks, mannequins and a mirror.
  - **Restaurant:** a kitchen and dining tables.
  - **Travel Agent:** a globe, maps and posters.
- **Villager houses** are themed after the villager who lives there:
  - **Colours:** taken from the villager's own colours.
  - **Floor:** set by their personality: warm planks for cheerful villagers, carpet for lazy ones, dark wood for grumpy ones, gym tiles for sporty ones, a checkerboard for artsy ones and pastel carpet for shy ones.
  - **Furniture by personality:** a sofa and TV, an armchair by the fireplace, dumbbells and a punching bag, an easel and paintings, a teddy bear, and so on.
  - **Furniture by what they like:** an aquarium for fish lovers, a fruit bowl, a wardrobe and mirror, mushroom lamps, a telescope and globe for collectors of rare things, and more.
  - **Visiting hours:** villagers are home from **19:00 to 07:00**. Visit them then to chat and give gifts in their living room; the rest of the time they're out on the island.
- **Harbor Town:** the fishermen's cottages and the lighthouse can be explored too.

**The rolling-log world.** The whole world curves away from the camera, like in Animal Crossing. This is a vertex-shader bend that is applied to every mesh, sprite and shadow. You can tune it in the debug menu.

**Villagers.** Talk to each villager once a day and give them one gift a day. They love some specific items, like whole categories of others (shown as a hint) and dislike some. Their friendship goes through five levels, and they give you a present at each new level.

### Locations, time & weather
- The location picker shows a small 3D preview of an example island for each biome, in the season it has right now. Pick one of 7 starting biomes: **Grassland, Tropical Island, Nordic Forest, Edge of the Forest, Desert Oasis, Jungle or Desert**. The world map also has three **shared hubs** open to everyone: Harbor Town Square, Aurora Lookout and Sunset Bazaar.
- **Sun and calendar** come from the island owner's real location. You can share it with the browser's geolocation, which is rounded to about 50 km; otherwise it's estimated from your time zone. The sun's real position drives day and night, dawn, dusk and stars.
- **Climate** comes from the biome. Temperate and Nordic islands have four seasons (Nordic winters are long, with snow and auroras). The tropics have wet and dry seasons, and deserts have hot and cool seasons. Weather (clear, cloudy, rain, storm, snow, fog, sandstorm or heatwave) is the same for everyone on an island at the same moment. It's computed from the island seed, the date and a 3-hour block.

### Shared locations
- **Harbor Town Square** is a hand-built hillside harbour town.
  - **Up the hill:** colourful plank houses with gabled roofs sit on two cliff terraces, joined to the town below by wide stairs.
  - **The plaza:** a brick square with a fountain, market stalls, lanterns and picnic tables. A lily pond with reeds lies beside it.
  - **The waterfront:** a sandy bay ringed by a wooden boardwalk, with rowboats bobbing in the water. A long pier leads out to the travel dock, and a lighthouse sweeps its beam across the water at night.
  - **Town mailbox:** send letters and gifts to any of your friends from here.
  - **Billboard:** pin a note of up to 140 characters for everyone to read (one note every 20 s). Notes are saved, appear live for everyone in town and show up as paper notes pinned to the board. You can take down your own notes, but not other people's. The board keeps the newest 60.
- **Aurora Lookout** has clear skies every evening and night, with animated northern-light curtains rippling above the horizon. The light also gives the snow a faint green glow. On Nordic islands the aurora appears on clear winter nights.
- **Sunset Bazaar** is a lantern-lit market on the edge of the desert.

### Visitors
In **Options (V)** you choose who may visit your island:
- 🔒 Nobody
- 💌 Friends only
- 🎟️ Friends + invite code (you can regenerate the code at any time)
- 🌍 Everyone (listed on the world map)

Visitors can walk around, chat, fish and befriend your villagers, but only the owner and residents can harvest, and only the owner, residents and builders can build. The owner can send any visitor home.

---

## 3D models

Trees are low-poly models made in Blender: the source is `art/trees.blend`, and the game loads `client/public/models/trees.glb`. Each species has a root node `tree_<species>` with child meshes named by role (`_trunk`, `_foliage`, `_branches` for bare winter trees, `_snow`, `_marks`, `_ribs`) and empties `_fruit0…` where fruit hangs. Colours come from the game data, so seasons and the game creation tool still apply. If the file is missing, or a species isn't in it, the game draws the old procedural tree. To change a tree, edit the .blend and re-export it as glTF Binary (+Y up) over `trees.glb`.

The terrain uses a tileset from Blender too (`art/tileset.blend`, generated by `art/tileset_build.py`, loaded from `client/public/models/tileset.glb`). Every tile is drawn as four quarter tiles; each quarter looks at its two side neighbours and the diagonal one and picks a flat top, a cliff edge (three variants), a rounded outer corner or an inner corner, stretched to the real drop. Grass tiles use the rocky `cliff` pieces, sand and water beds the gentler `bank` pieces. Ramps use the same pieces: their rock walls taper along the slope. The tileset also holds the stairs models (`stairs_stone`, `stairs_wood`, `stairs_log`), which sit on ramps with a stairs look (the ramp byte stores direction + 4 × style). The coast has no steps at all: the wide beaches slope smoothly from the grass down to just under the waterline, and the sea floor keeps sloping to full depth over about 4.5 tiles (`Grid.coastY`, from `shared/src/world/coast.ts`, which the walking height follows too). Players can wade into the sea while the floor is no deeper than chest height (`WADE_FLOOR`); villagers stay dry. Water effects live in `client/src/game/water/` (one file per layer, put together by `water.ts`): a depth tint (clear shallows, dark deep sea), faint flow streaks that drift downstream along every river (fainter on one-tile streams), waterfalls as a curved sheet with foam and spray particles (rock closes their sides), and surf rolling in and breaking along the beaches. Rivers at sea level are part of that smooth coast too: sandy banks where they cross the beach, and their bed runs out into the sea floor. Docks are built from Blender pieces as well (`dock_deck`, `dock_post`, `dock_ramp`, `dock_bollard`); a pier's land end always gets a gangway down to dry sand (`Grid.dockRamp`, in `shared/src/world/dock.ts`, which the walking height follows). To tweak the shapes, edit the profiles in `tileset_build.py` and run it in Blender's Text Editor; it re-exports `tileset.glb`.

Birds, catchable fish, the fish shadows and schools, bushes, flowers, mushrooms, rocks, saplings, ground cover (grass, ferns, reeds, clover, pebbles, fallen leaves, snow) and furniture (the placeables and a 20-piece **Bohemian pack** in the Carpenter's shop) come from the art kit in `art/kit/`: each model is a set of convex parts written in Python. `python3 art/kit/build_glbs.py` (numpy + scipy, no Blender needed) writes `birds`, `fish`, `ambient_fish`, `fish_school`, `plants`, `placeables` and `furniture_boho` `.glb` files into `client/public/models/`; `art/kit/blender_bake.py` bakes the same kit into .blend files. Every file has one root node per model (`bird_robin`, `bush_nordic`, `boho_sofa`…) with child nodes for the moving parts (`hop`, `head`, `wingL`/`wingR`, `berries`, `bulb`, `boat`, `swing`) and materials named by role; the game swaps in its own shared materials. The fish shadows swim with morph targets (`swim_a`, `swim_b`, `fins`), the school is one looping animation. Missing files fall back to the procedural models. Furniture can be `flat` (rugs: walk over them), `wall` (hangs on the wall behind its tile) or `long` (the canopy bed takes two tiles), see `FURNITURE_SHAPES` in `shared/src/data/items.ts`.

## Architecture

Full guide with diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
hearthwood/
├─ shared/        Pure TypeScript used by both sides (no I/O)
│  └─ src/
│     ├─ protocol.ts   Message types + runtime schemas for every client message
│     ├─ schema.ts     Tiny dependency-free validator (unknown keys are dropped)
│     ├─ world/        Tiles, constants, objects, Grid (collision, walking heights), coast & docks, movement, placement
│     ├─ generate/     Island generation in steps: landmass, cliffs & ramps, river, beach, scatter
│     ├─ world.ts      Re-exports world/ and generate/ (the old import path)
│     ├─ terraform.ts  Terraforming rules (one table, shared by client preview and server)
│     ├─ harbor.ts     Hand-designed Harbor Town Square layout
│     ├─ env.ts        Solar position, seasons, weather, local time
│     └─ data/         Items, biomes, buildings, recipes, villagers, chapters
├─ server/        Authoritative game server (Node + ws)
│  ├─ src/
│  │  ├─ index.ts      HTTP (register, health, static) + WebSocket upgrade
│  │  ├─ store.ts      SQLite persistence (dirty tracking, batched writes)
│  │  └─ game/
│  │     ├─ Game.ts     Composition root: store, rooms, sessions; work lives in services/
│  │     ├─ services/   Accounts, message router (typed table), rooms, travel, roles, bottles, progress, views, social
│  │     ├─ Room.ts     One simulated location: world state, interest management
│  │     ├─ room/       Beach & bottles, birds, villagers, regrowth
│  │     ├─ actions/    Validation + execution of every player action, one file per area
│  │     └─ Session.ts  Per-connection state, rate limiting
│  └─ test/         Bot-driven end-to-end test: harness.ts + ordered suites/ (run.ts)
├─ client/        Vite + Three.js
│  └─ src/
│     ├─ main.ts       Entry point: wires app/ and input/ together
│     ├─ app/          Boot, session (World + HUD), server messages, what input does
│     ├─ input/        Keyboard, controller, menu navigation
│     ├─ net.ts        WebSocket client (auth, reconnect, clock sync, act→result)
│     ├─ game/World.ts Scene, camera, frame loop; the work lives in game/world/
│     ├─ game/world/   Environment & sky, terrain layer, objects, players, villagers, tools, targeting
│     ├─ game/terrain/, water/  Terrain geometry (tileset pieces, coast, docks) and water layers
│     ├─ game/bend.ts  "Rolling log" world-curvature + wind-sway shader patch
│     ├─ game/foliage.ts, footprints.ts, paths.ts  Instanced grass & foliage, fading footprints, path layer
│     ├─ game/models/, characters.ts  Procedural low-poly art (trees, nature, furniture, buildings)
│     └─ ui/           Character creator, world map, HUD (ui/hud/: hotbar and one file per panel)
└─ tools/golden/  Golden tests: hashes of generation, movement and client geometry (npm run test:golden)
```

### Server-authoritative design
- **Clients send intents, never results.** For example, a client sends `{"t":"act","a":{"k":"chop","id":"o42"}}`. The server checks ownership, distance, tools, inventory, cooldowns, day-gates, footprint space and so on. Then it replies with `res` (ok / error and items gained) and broadcasts state deltas (`oAdd`, `bAdd`, `vs`…) to the room.
- **Every inbound message is schema-validated** (`shared/src/schema.ts`): types, ranges, string patterns and enum membership. Unknown fields are dropped. Malformed messages count as strikes, and repeated abuse disconnects the client.
- **Movement:** the client predicts its own movement using the same `slideMove`/`Grid` code as the server. The server checks each step for maximum speed, walkability and tunnelling (it samples the path). If a step fails, it sends a `corr` and the client snaps back. Other players are interpolated from 10 Hz snapshots.
- **Fishing timing is server-side.** The server chooses the fish and the bite time, then checks that the reel arrives inside the bite window plus a small network grace period.
- **Interest management:** each island, hub or tour is a `Room`, and only its members receive its updates. Idle rooms are unloaded. When an island loads again, the server catches up whatever happened meanwhile (growth, construction, the daily refresh).
- **Abuse protection:** a per-connection token-bucket rate limiter, a chat rate limit with sanitising (control and bidi characters are stripped), a WebSocket `maxPayload`, a hello timeout, ping/pong heartbeats, per-IP account-creation limits and an optional Origin allow-list (`ALLOWED_ORIGINS`).
- **Auth:** username and password accounts (scrypt), with guests only in dev mode. Logging in returns a random 256-bit token that the browser keeps. The server stores only its SHA-256 hash, in the `tokens` table. The token is sent in the first WebSocket message rather than the URL, so it stays out of logs. The HTTP tools send it as `Authorization: Bearer …`. Login attempts are rate-limited per IP. Banned accounts are refused at login and on connect.
- **Database:** `DATA_DIR/hearthwood.db` (SQLite, WAL mode) has tables for `players`, `tokens`, `islands`, `boards`, `gamedata` (editor overrides), `bottles` (messages in bottles at sea and delivered), `news` (start-screen boxes) and `audit`. Players and islands are kept in memory and the changed ones are written in one transaction every 5 s and on shutdown. Saves from older versions (JSON files) are imported on first start and moved to `DATA_DIR/json-backup-<date>/`.
- **Determinism:** island generation uses integer-only hashing and noise, and the server also sends the tiles, cliff levels and ramps it generated. Weather comes from a seeded RNG, so all observers agree.
- **Cliffs on both sides:** `Grid.canMove` / `Grid.stepOk` define when you can move between levels: same level, or via a ramp from its bottom or sides, or from the tile directly uphill. The client uses them for prediction and the server uses the same code to validate every movement step.
- **Interiors are rooms too:** a tent or house interior is its own `Room` with its own interest management. Furniture you place inside is saved in the island record.
- **Respawn queue:** each island keeps a saved list of pending respawns. When the island loads again, the server catches up on any that came due while it was unloaded.
- **Versioned protocol:** if the versions don't match, the server asks the client to refresh.

### Configuration (environment variables)
`PORT` (8787), `HOST`, `DATA_DIR` (server/data, which holds `hearthwood.db`), `CLIENT_DIST`, `ALLOWED_ORIGINS`, `DEV_FAST=1` (dev mode: fast time, guests, dev commands, game creation tool, everyone is an admin), `ADMIN_USERS` (comma-separated usernames that are always admins).

Logging: `LOG_LEVEL` (`debug` · `info` · `warn` · `error`; the default is `info`, or `debug` with `DEV_FAST`), `LOG_FORMAT` (`pretty` in a terminal, otherwise `json`; one JSON object per line), and `LOG_FILE` to also append JSON lines to a file. The server logs startup, registrations, connections and disconnects (with IP), refused or malformed messages, abuse disconnects, character creation, building completions, moves, permit purchases, dev commands, save timings (debug) and all errors. Tokens are never logged. Gameplay constants are in `server/src/config.ts`, for example `treeStageMinutes` and the fishing window.

### Going further
- Move from SQLite to Postgres if several server processes need one database; `Store` is the only module that talks to it.
- Add OAuth or passkeys next to username and password.
- Put it behind HTTPS (the client switches to `wss://` automatically) and set `ALLOWED_ORIGINS`.
- If one process isn't enough, scale out by assigning rooms to worker processes.
