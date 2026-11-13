import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A, B, C } = ctx;
  console.log('Water, bridges & the beach');
  {
    if (A.room.id !== A.self.homeIslandId) {
      A.send({ t: 'travel', to: { kind: 'home' } });
      await A.wait('room', (m) => m.room.id === A.self.homeIslandId);
    }
    const g = A.grid;
    let river = 0, pond = 0;
    for (let i = 0; i < g.size * g.size; i++) { if (g.tiles[i] === Tile.River) river++; if (g.tiles[i] === Tile.Pond) pond++; }
    check(river > 0 && pond > 0, `the island has a river (${river} tiles) and a pond (${pond})`);
    check(classifyWater(g.size, Uint8Array.from(g.tiles)).length === 0, 'rivers connect to the sea, ponds don’t');
    // Digging into beach sand: joined to the sea it's a river; filled in, it's sand again.
    {
      const n = 10, tiles = new Uint8Array(n * n).fill(Tile.Ground);
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (z >= 6) tiles[z * n + x] = z >= 8 ? Tile.Sea : Tile.Shore;
      const tg = new Grid(n, tiles);
      check(terraformError(tg, 'water', 4, 7) === null, 'water can be dug into sand');
      applyTerrainAndWater(tg, terraformChanges(tg, 'water', 4, 7));
      check(tg.tile(4, 7) === Tile.River, 'sand dug next to the sea becomes river');
      applyTerrainAndWater(tg, terraformChanges(tg, 'land', 4, 7));
      check(tg.tile(4, 7) === Tile.Shore, 'filled back in with sand on the beach');
    }
    // Water on cliffs: against a cliff is fine, over an edge only with water below (a waterfall).
    {
      const n = 10, tiles = new Uint8Array(n * n).fill(Tile.Ground), levels = new Uint8Array(n * n);
      for (let z = 0; z < 5; z++) for (let x = 0; x < n; x++) levels[z * n + x] = 1;
      const tg = new Grid(n, tiles, levels);
      const dig = (op: 'water' | 'land' | 'lower', x: number, z: number) => {
        const err = terraformError(tg, op, x, z);
        if (!err) applyTerrainAndWater(tg, terraformChanges(tg, op, x, z));
        return err;
      };
      check(dig('water', 4, 4) !== null, 'water at a cliff edge with dry ground below is refused');
      check(dig('water', 4, 5) === null && dig('water', 5, 5) === null, 'water dug right against a cliff');
      check(dig('water', 4, 4) === null && tg.level(4, 4) === 1 && tg.level(4, 5) === 0, 'water on the cliff above water below (a waterfall)');
      check(dig('land', 4, 5) !== null, 'the water under a waterfall can’t be filled while it falls');
      check(dig('lower', 3, 4) !== null, 'ground holding raised water can’t be lowered');
      check(dig('land', 4, 4) === null && tg.tile(4, 4) === Tile.Ground && tg.level(4, 4) === 1, 'raised water filled back in on its level');
    }
    // Wide beaches and wading into the shallow sea.
    {
      let shore = 0, wade = 0, deep = 0;
      for (let z = 0; z < g.size; z++)
        for (let x = 0; x < g.size; x++) {
          if (g.tile(x, z) === Tile.Shore) shore++;
          if (g.tile(x, z) === Tile.Sea) g.wadeableTile(x, z) ? wade++ : deep++;
        }
      check(shore > g.size * 8, `wide beaches (${shore} sand tiles)`);
      check(wade > 0 && deep > 0, `the sea is shallow near the beach (${wade} wadeable tiles), then deep`);
      let pair: [number, number, number, number] | null = null;
      let best = Infinity;
      for (let z = 1; z < g.size - 1; z++)
        for (let x = 1; x < g.size - 1; x++) {
          if (g.tile(x, z) !== Tile.Shore || !g.walkableTile(x, z)) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const wx = x + dx * 2, wz = z + dz * 2;
            if (g.tile(x + dx, z + dz) !== Tile.Sea || !g.wadeableTile(x + dx, z + dz) || !g.wadeableTile(wx, wz)) continue;
            const d = Math.hypot(x - A.x, z - A.z);
            if (d < best) { best = d; pair = [x, z, dx, dz]; }
          }
        }
      check(!!pair, 'found a beach with shallow water in front');
      if (pair && (await A.walkTo(pair[0], pair[1], false))) {
        A.inbox = A.inbox.filter((m) => m.t !== 'corr');
        for (let i = 1; i <= 4; i++) {
          A.x += pair[2] * 0.4;
          A.z += pair[3] * 0.4;
          A.send({ t: 'move', seq: ++A.seq, x: A.x, z: A.z, r: 0 });
          await sleep(110);
        }
        await sleep(200);
        const corrected = A.inbox.some((m) => m.t === 'corr');
        const tx = Math.floor(A.x), tz = Math.floor(A.z);
        check(!corrected && g.tile(tx, tz) === Tile.Sea, 'waded into the shallow sea');
        check(g.surfaceY(A.x, A.z) < SEA_LEVEL - 0.1 && g.surfaceY(A.x, A.z) >= WADE_FLOOR, `standing in the water (floor ${g.surfaceY(A.x, A.z).toFixed(2)})`);
        // Back to the beach.
        for (let i = 0; i < 4; i++) {
          A.x -= pair[2] * 0.4;
          A.z -= pair[3] * 0.4;
          A.send({ t: 'move', seq: ++A.seq, x: A.x, z: A.z, r: 0 });
          await sleep(110);
        }
      }
      check(!g.walkable(0.5, 0.5) && !g.wadeableTile(0, 0), 'the deep sea is still off limits');
      // The pier reaches dry sand: a gangway from the deck down onto the beach.
      let gang: ReturnType<typeof g.dockRamp> = null;
      for (let z = 0; z < g.size && !gang; z++) for (let x = 0; x < g.size && !gang; x++) gang = g.dockRamp(x + 0.5, z + 0.5);
      check(!!gang && gang.to >= SEA_LEVEL, `the dock's gangway lands on dry sand (${gang?.to.toFixed(2)})`);
      // No stepping off the pier (deck or gangway) into the sea, nor climbing onto it from the water.
      let edges = 0, leaks = 0;
      for (let z = 0; z < g.size; z++)
        for (let x = 0; x < g.size; x++) {
          if (!g.isPier(x, z)) continue;
          for (const [dx, dz] of DIRS) {
            if (g.tile(x + dx, z + dz) !== Tile.Sea) continue;
            edges++;
            if (g.stepOk(x, z, x + dx, z + dz) || g.stepOk(x + dx, z + dz, x, z) || g.canMove(x + 0.5, z + 0.5, x + 0.5 + dx * 0.6, z + 0.5 + dz * 0.6)) leaks++;
          }
        }
      check(edges > 0 && leaks === 0, `the pier's edges are closed to the sea (${edges} edges, ${leaks} open)`);
    }
    // A bridge across the river.
    A.send({ t: 'dev', cmd: 'kit', args: [] });
    await sleep(300);
    // The rules on a hand-made river first: 2 tiles of water between two banks.
    {
      const n = 8, tiles = new Uint8Array(n * n).fill(Tile.Ground);
      for (let z = 0; z < n; z++) tiles[z * n + 3] = tiles[z * n + 4] = Tile.River;
      const tg = new Grid(n, tiles);
      check(placeError(tg, 'bridge_ew', 2, 2) === null && placeError(tg, 'bridge_ns', 2, 2) !== null && placeError(tg, 'bridge_ew_long', 2, 2) !== null, 'bridge placement rules (ends on banks, middle over water)');
      tg.addBuilding({ id: 'tb', type: 'bridge_ew', x: 2, z: 2, w: 4, h: 2, completeAt: 0 });
      check(tg.walkableTile(3, 2) && tg.stepOk(2, 2, 3, 2) && tg.stepOk(4, 2, 5, 2) && !tg.walkableTile(3, 4), 'a bridge makes its water walkable (only there)');
    }
    type BT = 'bridge_ns' | 'bridge_ew' | 'bridge_ns_long' | 'bridge_ew_long';
    let bridged: { type: BT; x: number; z: number } | null = null;
    const cands: { type: BT; x: number; z: number }[] = [];
    for (const type of ['bridge_ns', 'bridge_ew', 'bridge_ns_long', 'bridge_ew_long'] as const)
      for (let z = 1; z < g.size - 5; z++) for (let x = 1; x < g.size - 5; x++) if (!placeError(g, type, x, z)) cands.push({ type, x, z });
    cands.sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z));
    for (const c of cands.slice(0, 25)) {
      const [sx, sz] = c.type.startsWith('bridge_ns') ? [c.x, c.z - 1] : [c.x - 1, c.z];
      if (!(await A.walkTo(sx, sz, false))) continue;
      const r = await A.act({ k: 'build', type: c.type, x: c.x, z: c.z });
      if (r.ok) { bridged = c; break; }
    }
    if (!cands.length) console.log('  (no free bridge spot on this island’s river – trees or uneven banks)');
    else check(!!bridged, `built a bridge over the river ${bridged ? `(${bridged.type})` : `(${cands.length} spots)`}`);
    if (bridged) {
      const len = bridged.type.endsWith('long') ? 5 : 4;
      const [ex, ez] = bridged.type.startsWith('bridge_ns') ? [bridged.x, bridged.z + len] : [bridged.x + len, bridged.z];
      const corr0 = A.inbox.filter((m) => m.t === 'corr').length;
      const walked = await A.walkTo(ex, ez, false);
      await sleep(300);
      check(walked && A.inbox.filter((m) => m.t === 'corr').length === corr0 && Math.floor(A.x) === ex && Math.floor(A.z) === ez, 'walked across the bridge to the other bank');
    }
    // River fishing gives river fish.
    let rs: [number, number] | null = null, rc: [number, number] | null = null;
    outerR: for (let z = 1; z < g.size - 1; z++) for (let x = 1; x < g.size - 1; x++) {
      if (!g.walkableTile(x, z) || g.bridges[z * g.size + x]) continue;
      for (const [dx, dz] of DIRS) if (g.tile(x + dx, z + dz) === Tile.River && !g.bridges[(z + dz) * g.size + x + dx]) { rs = [x, z]; rc = [x + dx, z + dz]; if (await A.walkTo(x, z, false)) break outerR; rs = null; }
    }
    if (rs && rc) {
      A.inbox = A.inbox.filter((m) => m.t !== 'bite' && m.t !== 'fish'); // forget earlier casts
      const spot = await A.fishShadow(rc[0], rc[1], 'large');
      check(spot?.size === 'medium', 'rivers only have medium fish shadows');
      const c = await A.act({ k: 'cast', x: rc[0], z: rc[1] });
      if (c.ok && !c.msg) {
        const bite = await A.wait('bite', () => true, 8000);
        A.send({ t: 'act', seq: ++A.seq, a: { k: 'reel', castId: bite.castId } });
        const f = await A.wait('fish', () => true, 3000).catch(() => null);
        check(!!f?.item && FISH.find((x) => x.id === f.item)?.water === 'river', `river fishing catches river fish (${f?.item})`);
      } else console.log('  cast:', c.err ?? c.msg);
    }
    // Things wash ashore.
    A.send({ t: 'dev', cmd: 'beach', args: ['4'] });
    const wash = await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'washed')).catch(() => null);
    const item = wash?.o.find((o) => o.kind === 'washed');
    check(!!item, `something washed ashore (${item?.item})`);
    if (item && (await A.walkTo(item.x, item.z))) {
      const r = await A.act({ k: 'forage', id: item.id });
      check(r.ok && !!r.gained?.[item.item!], 'picked it up');
    }
    // Message in a bottle.
    A.send({ t: 'dev', cmd: 'give', args: ['message_bottle', '1'] });
    await sleep(200);
    let atSea = false;
    for (let z = 1; z < g.size - 1 && !atSea; z++) for (let x = 1; x < g.size - 1 && !atSea; x++)
      if (g.tile(x, z) === Tile.Shore && DIRS.some(([dx, dz]) => g.tile(x + dx, z + dz) === Tile.Sea) && Math.hypot(x - A.x, z - A.z) < 25) atSea = await A.walkTo(x, z, false);
    const thrown = await A.act({ k: 'bottle', text: 'Hello from Alice' });
    check(thrown.ok, `message in a bottle thrown ${thrown.err ?? ''}`);
    A.send({ t: 'dev', cmd: 'bottles', args: [] });
    await sleep(400);
    let finder: Bot | null = null;
    for (const bot of [B, C]) {
      const v = await http('GET', `/api/admin/islands/${bot.self.homeIslandId}`, undefined, A.token);
      if ((v.body.record as { bottles?: unknown[] }).bottles?.length) finder = bot;
    }
    check(!!finder, `the bottle washed up on another player’s island (${finder?.name})`);
    if (finder) {
      finder.send({ t: 'travel', to: { kind: 'home' } });
      await finder.wait('room', (m) => m.room.id === finder!.self.homeIslandId);
      await sleep(300);
      const bottle = [...finder.objects.values()].find((o) => o.kind === 'washed' && o.bottle);
      if (bottle && (await finder.walkTo(bottle.x, bottle.z))) {
        await finder.act({ k: 'forage', id: bottle.id });
        const mail = await finder.wait('mail', (m) => m.list.some((l) => l.text === 'Hello from Alice')).catch(() => null);
        check(!!mail, 'its finder reads the message in their letters');
      } else check(false, 'bottle lies on the finder’s beach');
    }
  }
}
