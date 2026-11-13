# Refactor notes

Working log for `docs/REFACTOR_PLAN.md`. Open questions and bugs found along the way
go here instead of being fixed inline (plan §3 rule 8, §10 decision 4).

## Baseline (Phase 0)

- Starting commit: `549f570` (plan), safety net added in the following commits.
- Server integration checks: 203 passing (`npm test`), plus 6 production-mode checks.
- Golden checks: 177 (`npm run test:golden`).
- Typecheck in the cloud workspace: `npm run typecheck:stub` (package installs are blocked there,
  so `three`, `vite` and `@types/ws` are missing; `tools/stubs` stands in for them).
  On a machine with `npm install` done, use `npm run typecheck`.

| File | Lines at start |
|---|---|
| client/src/game/World.ts | 1427 |
| shared/src/world.ts | 1247 |
| server/src/game/Game.ts | 1214 |
| server/test/run.ts | 1135 |
| client/src/ui/hud.ts | 1064 |
| server/src/game/actions.ts | 804 |
| client/src/game/models.ts | 760 |
| server/src/game/Room.ts | 755 |
| client/src/game/water.ts | 498 |
| client/src/game/terrain.ts | 408 |

## Deviations from the plan

- **Server test suites are not independent** (plan step 0.4 asked for each suite to pass alone).
  The checks build on one another's progress (Alice's tools, coins, buildings, villagers), and
  rewriting them to set up their own state would change what is tested. Instead: suites run in
  order, each in its own try/catch so a crash no longer hides the rest, and
  `npm test -- <name>` runs everything up to and including the matching suite.
- **Golden geometry uses a fake three.js** (`tools/golden/fake-three.mjs`). Its colour maths
  (`offsetHSL`) is a plain sRGB HSL, not three's colour-managed version, so goldens catch any
  change in the code but say nothing about exact on-screen colours.

- **Server services are functions taking `game`, not classes with injected dependencies**
  (plan step 2.4). Moving method bodies verbatim (`this.` → `game.`) kept the risk low;
  narrowing each service to the parts of `Game` it needs is a follow-up that can be done one
  file at a time now that they're separate. The action handlers already see only `GameApi`.
- **`store.ts` was not split** (plan step 2.6 said only if natural; at 440 lines it is one
  cohesive SQLite wrapper).

- **Client geometry still uses `THREE.Color` / `THREE.Vector3`** (plan step 3.1 asked for no
  three.js import in `terrain/`). They are plain maths classes with no renderer behind them;
  porting colour maths (`offsetHSL`) by hand risked tiny colour shifts the goldens could not
  vouch for against real three.js. The mesh/material code is out of the geometry modules, and
  `buildTerrainGeometry` returns plain arrays.
- **`World` parts are functions taking the World (`self`)**, like the server services. World's
  fields lost their `private` modifiers so the parts can reach them. `World.ts` is 377 lines
  (plan target ≤ 300): the remaining bulk is field declarations, `load`/`clearRoom`, the frame
  loop and one-line delegates for main.ts and the HUD.

## Open questions / bugs found

- **Flaky server test (pre-existing):** islands get a random seed, and on crowded ones the test
  bot found no free spot for the Town Hall (it wanted a one-tile margin around it), which then
  cascaded into the villager suites. Seen on CI before any production code moved. The test
  helper now falls back to spots without a margin. The game itself is unchanged; whether a
  crowded island can always fit a Town Hall for real players is worth a look.
- **More random-island flakiness in the server test:** about one run in five a section ends with
  Alice on a tile she can't walk off (`reachable 1` in the build error), and every later build
  fails; the fishing check also sometimes can't reach a pond ("Too far to cast", skipped
  silently). Both depend on the random island seed, not on the refactor (three reruns of the
  same code passed fully). A fixed seed for test islands (e.g. a `TEST_SEED` env var the server
  honours in dev mode) would make the suite deterministic; that is a behaviour change, so it is
  left for you to decide.

## Splitter slip caught in Phase 4

The class splitter rewrote the word `this` inside two HUD strings and one comment
(“clock of hud place”, “📡 Use hud device”, “on a dev server hud changes…”). Found with
a TypeScript-scanner diff of every string literal against the pre-refactor commit
(a8a0f46) and a comment diff; all three restored. The literal diff now shows only the
expected changes (router keys moved into the routes table; the glb loader builds its
log messages from parts). The earlier splits (Room, Game, World, terrain, water,
models) had no such slips.
