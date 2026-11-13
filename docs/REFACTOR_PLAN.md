# Hearthwood refactor plan

Written 2026-11-13 against commit `80e7642` + `cc9bdd8` on `main`.
Audience: a coding agent (Claude Opus 5.5) executing this later, one phase per session.

**Scope:** `shared/`, `server/` (game runtime), `client/` (game, UI, input).
**Out of scope:** `client/src/admin/`, `client/src/editor/`, `server/src/api.ts` admin routes, `shared/src/gamedata.ts`, `shared/src/data/dialogue.ts`. Do not restructure those. They may only receive import-path fixes needed to keep them compiling.

---

## 1. Why, and what "done" means

The game grew feature by feature. The code works and typechecks cleanly (0 `any`, 0 `ts-ignore`), but a handful of files have become catch-alls:

| File | Lines | What's wrong |
|---|---|---|
| `client/src/game/World.ts` | 1427 | One class: scene setup, sky/weather/lighting, entity interpolation, object/building meshes, paint/terraform/ghost tools, targeting, the server-message switch, fishing. |
| `shared/src/world.ts` | 1247 | Tile types, `Grid` (collision + coast heightfield + dock gangways), constants, island generator, cliffs, rivers, placement rules, misc maths. |
| `server/src/game/Game.ts` | 1214 | Accounts, sockets, message routing, room registry, travel, friends, board, chat, bottles, game data, dev commands, admin helpers. |
| `server/test/run.ts` | 1135 | One sequential script; a failure early hides everything after it; sections share bots and state. |
| `client/src/ui/hud.ts` | 1064 | Every panel (bag, craft, build, map, friends, mail, album, options…) as private methods of one class. |
| `server/src/game/actions.ts` | 804 | 28 action handlers in one object literal, all with access to the whole `Game`. |
| `client/src/game/models.ts` | 760 | All procedural models. |
| `server/src/game/Room.ts` | 755 | Room state + permissions + beach wash-ups + birds + villagers + terrain edits + beach migration. |
| `client/src/game/water.ts` | 498 | `buildWater` is one ~350-line function building five unrelated effects. |
| `client/src/game/terrain.ts` | 408 | `buildTerrainMesh` is one closure with ~15 inner functions; geometry maths is welded to THREE, so it can't be tested without a renderer. |

**Done means:**

1. No source file in scope over ~400 lines, no function over ~80 lines (guideline, not a hard gate; data tables are exempt).
2. Each module has one job you can state in a sentence, and that sentence is its header comment.
3. Geometry and game rules are pure functions (arrays in, arrays out) that run in Node without THREE or a DOM.
4. `npm run typecheck` and `npm test` pass, and the golden tests from Phase 0 are byte-identical before and after every phase.
5. **Zero behaviour change.** This is a restructuring. Bugs found on the way are written to `docs/REFACTOR_NOTES.md`, not fixed inline (exception: see §3 rule 6).

---

## 2. Invariants that must not break

These are easy to break silently. Phase 0 builds tests for each of them.

1. **Island generation is bit-identical.** Untouched islands are stored as `seed + biome` only and regenerated on every load (`Room` → `generateIsland`). If the generator's output changes for any seed, every existing island changes shape under its buildings. Order of RNG calls, hash inputs and floating-point expression order all matter. Move code; do not "tidy" arithmetic.
2. **Save format.** SQLite schema and the JSON inside `islands`/`players` rows stay as they are, including `IslandRecord.beach` (migration version, currently 4), `gen`, encoded `terrain`/`paths`.
3. **Protocol.** `PROTOCOL_VERSION` stays 11. Message and action shapes in `shared/src/protocol.ts` are unchanged. The ramp byte stays `dir + 1 + 4 × style`.
4. **Shared rules run on both sides.** `Grid.canMove/stepOk/surfaceY/coastY`, `terraformError`, `placeError`, `atDoor` are used by client prediction and server validation. They stay in `shared/` and stay one implementation.
5. **Public import surface.** `@hearthwood/shared` keeps exporting every name it exports today (keep `shared/src/index.ts` as the barrel). Admin/editor import these client modules and must keep working unchanged: `auth.ts`, `game/characters.ts`, `game/models.ts`, `ui/dom.ts`, `ui/login.ts`, `ui/richtext.ts`, `ui/start.ts`. If one is split, leave a re-export at the old path.
6. **Asset contracts.** Node names in `client/public/models/trees.glb` and `tileset.glb` (`tree_<species>_*`, `tile_<family>_<kind>`, `stairs_*`, `dock_*`) and `art/tileset_build.py` are untouched.
7. **`docs/ARCHITECTURE.md` is not edited** (project rule in `CLAUDE.md`). It will go stale during this work; see §9.

---

## 3. Working rules for the executor

1. **One phase per session, one step per commit.** Each step below is sized to be a single commit that passes all checks. Commit message prefix: `refactor(<area>): …`. Push after each phase, not each commit.
2. **Before starting a phase:** `git pull --rebase`. Other sessions push to `main` (editor/admin work). If a pull brings changes into a file you are about to split, re-read that file first.
3. **After every step run:** `npm run typecheck && npm test`. After every step that touches `shared/` or `client/src/game/`, also run the golden tests (`npm run test:golden`). Never commit on red.
4. **Moves are moves.** When relocating code, move it verbatim first (commit), then improve its shape (separate commit). This keeps diffs reviewable and makes a golden-test failure easy to bisect.
5. **Do not rename exported symbols** unless the step says so. Internal renames are fine.
6. **Allowed non-structural changes** (the only ones): deleting provably dead code; replacing duplicated constants/helpers with one definition *when the values are identical*; adding types; adding header comments.
7. **You cannot see the game.** No renderer is available to the agent, so visual regressions are invisible to you. The geometry golden tests are the substitute; anything shader- or material-related must be moved verbatim. End each client phase by listing for the user what to eyeball in-game.
8. **If a step turns out to need a behaviour change, stop** and write the question to `docs/REFACTOR_NOTES.md` rather than deciding.
9. **Environment note.** In the cloud workspace used so far, `three` and `vite` are not installed and package installs may be blocked. Typechecking the client there used a stub (`/tmp/threestub`) which will not exist in a new session. Phase 0 step 0.1 deals with this; if installs are impossible, say so at the top of your report rather than skipping checks silently.

---

## 4. Phase 0: safety net (do this first, no production code moves)

**Goal:** make "nothing changed" checkable by a machine.

**0.1 Tooling check.** Run `npm install` (root). Confirm `npm run typecheck` works for all three workspaces with the real `three` types. If installs are blocked, add `tools/three-stub/` (a minimal `.d.ts` declaring the THREE names the client uses as `any`) plus `client/tsconfig.stub.json` with a `paths` mapping, and a script `typecheck:stub`. Document which mode you used.

**0.2 Golden test harness.** Add `tools/golden/` (plain Node + tsx, no THREE, no DOM) and scripts `test:golden` (compare) and `test:golden:update` (rewrite). Goldens are SHA-256 hashes plus a few human-readable numbers, stored in `tools/golden/snapshots.json`. Cover:

| Golden | Input matrix | What is hashed |
|---|---|---|
| `generate` | seeds {1, 7, 42, 99, 12345} × every `BiomeId` × `{elevation: true, size: 72}`, plus seeds {7, 42} legacy `{size: 48}`, plus variants `shared` and `tour` | `tiles`, `levels`, `ramps`, `beachBand`, `spawn`, objects (id, kind, x, z, species, stage), buildings |
| `harbor` / `interiors` | every interior type; harbor for 2 seeds | layout arrays + objects |
| `grid-heights` | every biome's `generate` grid at seeds 7 and 42 | `surfaceY` and `coastY` sampled on a 4×-per-tile lattice incl. 10 tiles of margin, rounded to 1e-5; `walkableTile`, `wadeableTile`, `walkLevel` per tile; `dockRamp` over the dock |
| `movement` | 2 grids | `canMove` for 2 000 seeded random short moves; `slideMove` results |
| `terraform` | scripted op sequence on 2 grids (raise, lower, each ramp style, water on levels 0/1, land, waterfall setup) | error strings + resulting tile/level/ramp arrays after `applyTerrainAndWater` |
| `env` | fixed timestamps × biomes × lat/tz | `computeEnvironment` output |
| `dialogue` / `quests` / `gamedata` | existing pure functions with fixed seeds | output JSON (cheap, protects the barrel) |

**0.3 Geometry goldens.** These need the terrain/water builders, which import THREE today. For Phase 0 only, run them through a tiny fake (`tools/golden/fake-three.ts`: `Color`, `Vector3`, `BufferGeometry`, `Float32BufferAttribute`, `Mesh`, `Group`, materials as plain objects, `CanvasTexture` with `offset`) and a `document.createElement('canvas')` stub, bundled with esbuild aliases, exactly as the ad-hoc checks during development did. Load piece geometry by parsing `tileset.glb` directly (JSON chunk + BIN chunk; ~20 lines) and calling `setPieces`. Hash, for seeds 7 and 42:
- terrain mesh `position` and `color` arrays (rounded to 1e-4), triangle count;
- per child of `buildWater`: name, vertex count, `position` hash, and `aDepth`/`color` hashes where present;
- `findWaterfalls` output;
- `buildStairs` / `buildDockModels` placements (position + rotation per instance).
Also keep the two structural checks as assertions: **no holes** (a vertical ray at 16×16 points per tile always hits the terrain) and **walk height matches the mesh** within 0.03 at tile centres on Ground/Shore.
Phase 3 replaces the fake with real pure builders; the hashes must survive that.

**0.4 Split the server test.** Turn `server/test/run.ts` into `server/test/harness.ts` (server spawn, `Bot`, `http`, `check`, `sleep`) plus one file per existing section in `server/test/suites/` (accounts, basics, building, terraforming, birds-album, permits-hotbar, admin-api, water-bridges, beach-bottles, roles, geo, news, doors, dialogue…). Each suite exports `async function run(ctx)`, creates the players it needs, and must pass when run alone (`npm test -- water`) and in sequence. `run.ts` becomes a 30-line runner that prints a summary and exits non-zero on any failure. Keep every existing assertion.

**0.5 Baseline.** Commit `snapshots.json`. Record in `docs/REFACTOR_NOTES.md`: commit hash, test counts, line counts of the ten files in §1.

**Acceptance:** `npm run typecheck && npm test && npm run test:golden` green; no file under `shared/src`, `server/src`, `client/src` changed except test imports.

---

## 5. Phase 1: `shared/`

Target layout (the barrel `index.ts` re-exports all of it; `world.ts` remains as a thin re-export file so deep imports keep working):

```
shared/src/world/
  tiles.ts        Tile enum, DIRS, tile predicates (isWaterTile, isFreshWater, waterKind), encode/decodeTiles, classifyWater
  constants.ts    ISLAND_SIZE, CLIFF, MAX_LEVEL, SEA_LEVEL, BEACH_*, SEA_*, DOCK_Y, BRIDGE_DECK, WADE_FLOOR, RAMP_STYLES, baseHeight
  objects.ts      WorldObject, Building, IslandLayout, objectBlocks, isFlatDecor, buildingFootprint
  grid.ts         Grid: storage, occupancy, tile/level/ramp accessors, walkable/stepOk/canMove/canPlace/canPave/canSpawn
  heights.ts      surfaceY, cornerHeights, groundAt (functions taking a Grid; Grid methods delegate)
  coast.ts        CoastField (the cached distance field), coastY, isCoastal
  dock.ts         dockRamp, dockRampLen
  placement.ts    placeError, atDoor, nearBuilding, isBridge, findFreeSpot
  move.ts         slideMove, wrapAngle, distToTile
shared/src/generate/
  island.ts       generateIsland (orchestration only)
  landmass.ts     land mask, shore, biome ponds
  cliffs.ts       carveCliffs, smoothLevels, connectPlateaus
  river.ts        carveRiver, RIVER_BIOMES
  beach.ts        wide-beach band + river-mouth extension + dock bay
  scatter.ts      trees, rocks, flowers, and other objects
```

Steps (one commit each):

1. **1.1** Extract `tiles.ts`, `constants.ts`, `objects.ts` (pure moves). `world.ts` re-exports.
2. **1.2** Extract `placement.ts`, `move.ts`.
3. **1.3** Extract the coast field out of `Grid` into `coast.ts` as a class `CoastField` owned by `Grid` (`grid.coast`), invalidated in `setTerrain` exactly as now. `Grid.coastY/isCoastal` stay as one-line delegates. Then `dock.ts` and `heights.ts` the same way.
4. **1.4** Split `generateIsland`. This is the riskiest step of the whole plan (invariant 1). Procedure: first only cut the function body into the files above as functions that take and mutate one explicit `GenState` object (`{seed, size, S, c, tiles, levels, ramps, rng…}`), preserving statement order exactly. Run `test:golden` after *each* extracted block, not at the end.
5. **1.5** One definition each for helpers that are currently duplicated: `isFresh` (`terraform.ts`, client `terrain.ts`, client `water.ts` → use `isFreshWater` from `tiles.ts`), `smoothstep` (→ `shared/src/math.ts`, exported). Water heights: `SEA_LEVEL` (shared), `WATER_LEVEL_Y` (`terrain.ts`) and `WATER_Y` (`World.ts`) are all `-0.12` → use `SEA_LEVEL` everywhere. **`WATER_SURFACE = -0.2` is a different value** used by `surfaceY` for standing on water tiles: keep the value, rename nothing, add a comment saying what it is for.
6. **1.6** `terraform.ts`: split the `terraformError` switch into one small validator per op in a table keyed by `TerraOp` (same strings, same order of checks). `interiors.ts`, `harbor.ts`, `env.ts`: only add header comments unless a function exceeds ~80 lines.

**Acceptance:** all goldens identical; `shared/src/world.ts` ≤ 30 lines of re-exports; no file in `shared/src/world|generate` over 400 lines.

---

## 6. Phase 2: `server/`

Principle: `Game` becomes a small composition root; features get the narrow interface they need instead of the whole `Game`.

Target layout:

```
server/src/game/
  Game.ts            composition root: owns store, rooms, sessions, timers; wires services (≤ 250 lines)
  router.ts          ClientMessage → handler table (replaces the switch in onMessage), with the auth/created guards
  services/
    accounts.ts      register, login, issueToken, claimAccount, banReason, isAdmin, hello, createCharacter
    rooms.ts         islandRoom, interiorRoom, sharedRoom, islandRooms, syncIsland, reloadIsland, mapSpot
    travel.ts        travel, canVisit, enterIsland, moveToRoom, homeIsland, mapFor
    movement.ts      move (validation + broadcast)
    social.ts        friendOp, friendView, sendFriends, boardOp, chat, sanitize, notifyMail
    roles.ts         setRole, setGeo
    bottles.ts       deliverBottles
    progress.ts      progress, sendQuest, levelUpCheck, buildingCompleted, afterAction
    gamedata.ts      loadGameData, setGameData, resetGameData, announceDataChange
    views.ts         selfView, sendSelf, sendInv, broadcastLook, adminIslandView
    dev.ts           devCommand (one function per command in a table)
  actions/
    index.ts         runAction, Ctx, ActionResult, shared guards (near, getObj, harvestGuard, give…)
    gather.ts        shake, chop, dig, hit, forage, plant
    fishing-birds.ts cast, reel, catch, recordCatch
    build.ts         build, relocate, demolish, place, pickup, pave, unpave, placementError, paveGuard
    terraform.ts     terra
    economy.ts       craft, buy, sell, permit, wear, restyle
    villagers.ts     talk, gift, dialogueContext, sendTalk
    social.ts        mail, give, bottle, openBottle
  room/
    Room.ts          state, sessions, join/leave, broadcast, object/building CRUD, persistence (≤ 350 lines)
    permissions.ts   roleOf, isResident, isBuilder, resendView
    terrain.ts       setTerrain, widenBeaches migration (keep BEACH_VERSION logic verbatim)
    beach.ts         beachTick, washUp, beachSpot
    birds.ts         spawn/flee/tick
    villagers.ts     schedule, wander, at-home sync
    growth.ts        tree growth, respawns, day rollover
```

Steps:

1. **2.1** `actions/`: move helpers to `actions/index.ts`, then handlers into domain files, each exporting a partial handler map; `index.ts` merges them and keeps the exhaustive type `{ [K in Action['k']]: … }` so a missing handler is a compile error.
2. **2.2** Define `interface GameApi` in `actions/index.ts` with exactly what handlers use today (`store`, `sanitize`, `levelUpCheck`, `broadcastLook`, `sendSelf`, `notifyMail`, plus whatever the compiler shows). `Ctx.game` becomes `GameApi`. No behaviour change, just a narrower type.
3. **2.3** `room/`: extract `beach.ts`, `birds.ts`, `villagers.ts`, `growth.ts`, `permissions.ts`, `terrain.ts` as modules of functions taking the `Room` (or a narrow `RoomState` interface). Keep the RNG instances and the order they are drawn from unchanged (tests depend on dev commands, and bird/beach timing is seeded).
4. **2.4** `services/`: extract in this order (least coupled first): `gamedata`, `bottles`, `dev`, `social`, `roles`, `progress`, `views`, `travel`, `rooms`, `accounts`, `movement`. Each is a class or closure created in `Game`'s constructor with explicit dependencies. Methods that `api.ts` calls on `game` (`online`, `kick`, `adminIslandView`, `setGameData`, `rooms`, `register`, `isAdmin`, `syncIsland`, `resetGameData`, `reloadIsland`, `refreshPlayer`, `login`, `deletePlayer`) **stay available on `Game` as one-line delegates** so `api.ts` needs no edits.
5. **2.5** `router.ts`: replace the `onMessage` switch with a typed table `{ [T in ClientMessage['t']]: handler }` (exhaustive). Guards (`hello` first, `created` check, rate limits if any) keep their order.
6. **2.6** `store.ts` (440 lines, out of the admin scope but game-critical): only split if natural, into `store/schema.ts` (DDL + legacy JSON import) and `store/index.ts`. SQL statements move verbatim.

**Acceptance:** `npm test` green suite by suite; `Game.ts` ≤ 250 lines; no handler receives the full `Game`; `api.ts` diff is empty or imports only.

---

## 7. Phase 3: client rendering (`client/src/game/`)

Do 3.1–3.3 before touching `World.ts`; they are covered by geometry goldens. `World.ts` itself has no automated coverage beyond the browser smoke test, so its steps are strict verbatim moves.

**3.1 Pure geometry.** Create `client/src/game/geo/` with no THREE import:
- `meshbuf.ts`: a tiny `MeshBuffer` (`tri`, `quad`, growing `Float32Array`s for position/colour/uv/custom attributes, colours as `[r,g,b]`).
- `terrainGeo.ts`: orchestration; `tilePieces.ts` (`emitPiece`, `tiledTile`, waterfall corner rule), `coastGeo.ts` (`coastTile`, colours), `fallbackGeo.ts` (`edgeFaces`, used without tileset and for interiors).
- Colour maths currently uses `THREE.Color` (`offsetHSL`, `lerp`, `multiplyScalar`). Port to a small `rgb.ts` and prove equality: the terrain `color` golden must not change (tolerance 1e-4). If `offsetHSL` cannot be matched exactly, keep `THREE.Color` behind an injected interface instead and note it.
- `terrain.ts` shrinks to: build buffers → wrap in `BufferGeometry` + material (materials and shadow settings verbatim).
- Switch the Phase 0 geometry goldens from the fake THREE to these pure builders. Hashes must match.

**3.2 Water.** Split `water.ts` into `water/` : `falls.ts` (findWaterfalls, sheet, foam, spray), `flow.ts` (flow field + streak quads), `depthTint.ts`, `surf.ts` (geometry + `surfMaterial`; GLSL verbatim), `raised.ts`, `textures.ts`, `index.ts` (`buildWater`, `seaColor`, the `tick`). Geometry parts go through `MeshBuffer`.

**3.3 Assets and models.**
- `treeAssets.ts` and `tileAssets.ts` each implement "load a glb once, never reject, clone templates". Extract `assets/glb.ts` (`loadGlb(url)` with the shared promise/warn behaviour) and keep both public APIs as they are.
- Split `models.ts` (kept as a re-export barrel for admin/editor) into `models/primitives.ts` (`G`, `part`, `mat`, `rand`), `trees.ts`, `nature.ts` (rocks, bushes, flowers, washed-up items), `buildings.ts`, `bridges.ts`, `furniture.ts` (+ existing `decor.ts`).

**3.4 `World.ts`.** Target: `World` is a coordinator ≤ 300 lines that owns the scene and delegates. Extract in this order, each as a class constructed with the pieces it needs (`scene`, `world` group, `grid` getter, `camera`):

| New module | Takes from `World` |
|---|---|
| `scene/setup.ts` | renderer, camera, lights, sea plane, stars, aurora, weather particle systems (constructor body) |
| `scene/environment.ts` | `updateEnvironment`, `interiorLighting`, `env`, `visual`, `refreshVisuals`, lightning |
| `scene/camera.ts` | `zoom`, `resize`, follow logic from `frame`, bend focus |
| `room/terrainLayer.ts` | `buildTerrain`, `scheduleTerrain`, `rebuildPaths`, `schedulePaths`, `rebuildFoliage`, `scheduleFoliage`, grid overlay |
| `room/objects.ts` | `upsertObjectMesh`, `upsertBuildingMesh`, `objectLabel`, `animateProps` |
| `entities/players.ts` | `addPlayer`, `interp`, `updateLocal`, `wadeRipple`, `swing`, `say`, labels |
| `entities/villagers.ts`, `entities/birds.ts` | `upsertVillager`, `villagerPos`, `animateBirds` |
| `tools/paint.ts` | `startPaint`, `startTerra`, `paintOk`, `paintHere`, `pickGround`, `updatePaintGhost`, `rampDir` |
| `tools/ghost.ts` | build/move/place ghosts, `rotateGhost`, `cancelGhost`, `updateGhost` |
| `tools/fishing.ts` | `startCast`, `endCast`, bobber |
| `targeting.ts` | `facing`, `facingTile`, `computeTarget` |
| `messages.ts` | the `handle(m)` switch as a typed table calling the modules above |

`World` keeps its current public methods (used by `main.ts` and `hud.ts`) as delegates in this phase; do not change call sites yet.

**Acceptance:** goldens identical; browser smoke test passes; `World.ts` ≤ 300 lines. Hand the user this checklist to eyeball: day/night and weather, tree seasons and fruit, cliffs/ramps/stairs, beach slope and wading ring, dock and gangway, river flow, waterfall with spray, surf, placing a building (ghost colours), terraform painting, fishing bobber, villager speech bubbles, interiors.

---

## 8. Phase 4: client UI, input, boot

1. **4.1 Panels.** `ui/panels/<name>.ts` each exporting `render(body, hud)`: `album`, `debug`, `goals`, `hotbarEditor`, `bag`, `craft`, `build`, `map`, `friends`, `mail`, `billboard`, `island` (+ `roles`, `geo`), `building` (town hall, shop, workbench…), `villager` (dialogue). `Hud` keeps: shell, toast/gain/chat/prompt, hotbar, the open/close/toggle registry (`Record<PanelId, PanelDef>` instead of the `if` chain). The helpers at the top of `hud.ts` (`have`, `hasPermit`, `toolOwned`, `tagCount`, `ingLabel`) move to `ui/inventoryHelpers.ts`.
2. **4.2 Hotbar** into `ui/hotbar.ts` (render, assign, swap, select, cycle, `cycleTerra`).
3. **4.3 `main.ts`** (425 lines) into `boot.ts` (health → gamedata → login → `/api/me` → start screen → assets → connect; keep this order exactly), `input/keyboard.ts` (`bindKeys`), `input/actions.ts` (`interact`, `confirmGhost`, `queuePaint`, `back`), leaving `main.ts` as the entry that wires them.
4. **4.4 CSS.** `style.css` only: group rules by component with comment banners; no selector or value changes. Leave `tools.css` (admin/editor).

**Acceptance:** typecheck + browser smoke test; `hud.ts` ≤ 300 lines. Checklist for the user: open every panel with keyboard and gamepad, craft, buy a permit, swap hotbar slots, write a bottle, options (time zone/location, roles), start screen news.

---

## 9. Phase 5: cleanup and documentation

1. **Dead code.** With the structure clear, list (do not yet delete) unreferenced exports using `tsc --noUnusedLocals --noUnusedParameters` plus a grep for each export in scope. Delete only what nothing imports, including admin/editor.
2. **Fallback paths: decision needed from the user before deleting anything** (see §10): procedural trees (`treeModel` shapes), straight-wall terrain (`edgeFaces` for outdoor tiles), old plank docks (`buildDocks`).
3. **Legacy data paths.** Keep: JSON-save import, `LEGACY_ISLAND_SIZE`, `gen: 1` islands, beach migration v2→v4. Only add a comment per path stating what data still needs it.
4. **README.** Update the "Project structure" tree and file references to the new paths. Keep the gameplay text.
5. **`docs/ARCHITECTURE.md` and the linked Claude doc are now stale.** Do not edit them. End the final report by telling the user so and asking whether they want a documentation update.
6. Delete `docs/REFACTOR_NOTES.md` only after the user has read the open items; otherwise leave it.

---

## 10. Decisions for the user (defaults apply if unanswered)

| # | Question | Default |
|---|---|---|
| 1 | Remove the render fallbacks (procedural trees, straight cliffs, plank dock) now that the Blender assets ship with the game? Saves roughly 500 lines, but a missing `.glb` would then mean missing trees/cliffs instead of a plainer look. | **Keep**, isolated in `fallback*.ts` files. |
| 2 | Add a linter/formatter (ESLint + Prettier) and a GitHub Actions workflow running typecheck + tests + goldens? Not present today. | **Add CI only** in Phase 0 if the executor has push rights to add workflows; no linter (it would reformat every file and bury the refactor diffs). |
| 3 | Adopt a unit-test runner (Vitest / `node:test`) instead of custom scripts? | **`node:test`** for goldens and new pure-function tests (no new dependency); keep the integration suites on the existing harness. |
| 4 | May the executor fix bugs it finds? | **No**: log them in `docs/REFACTOR_NOTES.md`. |

---

## 11. Order, size and risk

| Phase | Risk | Why | Rough size |
|---|---|---|---|
| 0 Safety net | Low | No production code changes | 1 session |
| 1 Shared | **High** at step 1.4 (generator), low elsewhere | Bit-identical generation | 1–2 sessions |
| 2 Server | Medium | Well covered by integration suites | 2 sessions |
| 3 Client rendering | **High** for `World.ts` (no visual tests) | Verbatim moves + user checklist | 2–3 sessions |
| 4 Client UI | Medium | DOM code, smoke test only | 1–2 sessions |
| 5 Cleanup | Low | | 1 session |

Phases 1 → 2 → 3 → 4 in order; 2 and 3 are independent of each other once 1 is done and could run in parallel sessions on separate branches (`refactor/server`, `refactor/client-render`), merged by rebase.

## 12. Report format for each phase

At the end of a session, report: steps completed (with commit hashes); checks run and their results; line counts before/after for the files touched; anything logged to `REFACTOR_NOTES.md`; the in-game checklist for the user (client phases); what the next session should start with.
