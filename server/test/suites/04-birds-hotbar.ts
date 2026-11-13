import {
  Grid, decodeTiles, isWaterTile, BUILDINGS, PROTOCOL_VERSION, ISLAND_SIZE, TERRA_REACH, Tile, applyTerrain, distToTile, relocationCost, placeError, classifyWater, FISH, DIRS, SEA_LEVEL, WADE_FLOOR, terraformError, terraformChanges, applyTerrainAndWater,
  type RoomView, type ServerMessage, type WorldObject, type BuildingType,
} from '@hearthwood/shared';
import { Bot, BASE, PORT, check, sleep, http, state, enterAndBack, exitTo, type Ctx } from '../harness.ts';

export async function run(ctx: Ctx) {
  const { A } = ctx;
  console.log('Clothes');
  {
    check(A.you?.outfit.top === 'dress_sunny' && A.you?.outfit.shoes === 'sandals_tan' && A.you?.outfit.hat === 'straw_hat' && A.you?.hat === 'straw_hat', 'the starter set is worn from the start');
    check(A.you?.look.eyeShape === 'happy' && A.you?.look.mouth === 'grin', 'the chosen face is saved');
    const look = async (a: Parameters<typeof A.act>[0]) => {
      A.inbox = A.inbox.filter((m) => m.t !== 'pLook');
      const r = await A.act(a);
      const m = r.ok ? await A.wait('pLook', () => true, 2000).catch(() => null) : null;
      return { r, outfit: m?.outfit ?? null };
    };
    check(!(await A.act({ k: 'wear', item: 'coat_wool' })).ok, 'you can only wear clothes you own');
    A.send({ t: 'dev', cmd: 'give', args: ['skirt_pleated', '1'] });
    A.send({ t: 'dev', cmd: 'give', args: ['coat_wool', '1'] });
    await sleep(300);
    const skirt = await look({ k: 'wear', item: 'skirt_pleated' });
    check(skirt.outfit?.bottom === 'skirt_pleated' && !skirt.outfit?.top, 'a skirt takes the place of a dress');
    const dress = await look({ k: 'wear', item: 'dress_sunny' });
    check(dress.outfit?.top === 'dress_sunny' && !dress.outfit?.bottom, 'a dress takes the place of a skirt');
    const coat = await look({ k: 'wear', item: 'coat_wool' });
    check(coat.outfit?.outer === 'coat_wool' && coat.outfit?.top === 'dress_sunny', 'a coat goes over the dress');
    const off = await look({ k: 'wear', item: null, slot: 'outer' });
    check(!!off.outfit && !off.outfit.outer, 'clothes come off one slot at a time');
    check(!(await A.act({ k: 'wear', item: 'wood' })).ok, 'wood is not clothing');
  }
  console.log('Birds & album');
  {
    const birdsSeen = () => [...A.objects.values()].filter((o) => o.kind === 'bird');
    A.send({ t: 'dev', cmd: 'birds', args: ['5'] });
    await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'bird')).catch(() => null);
    await sleep(200);
    check(birdsSeen().length > 0, `birds landed (${birdsSeen().length})`);
    // Birds land at random spots; use the nearest one we can actually walk up to.
    let first: (typeof birdsSeen extends () => (infer O)[] ? O : never) | undefined;
    for (const b of birdsSeen().sort((p, q) => Math.hypot(p.x - A.x, p.z - A.z) - Math.hypot(q.x - A.x, q.z - A.z))) {
      if (await A.walkTo(b.x + 1, b.z, false).catch(() => false)) { first = b; break; }
    }
    if (first) {
      const noNet = await A.act({ k: 'catch', id: first.id });
      check(!noNet.ok && /net/.test(noNet.err ?? ''), 'catching birds needs a net');
    }
    A.send({ t: 'dev', cmd: 'give', args: ['bird_net', '1'] });
    await sleep(300);
    let caught: string | null = null;
    for (let tries = 0; tries < 12 && !caught; tries++) {
      let b = birdsSeen()[0];
      if (!b) {
        A.send({ t: 'dev', cmd: 'birds', args: ['4'] });
        await A.wait('oAdd', (m) => m.o.some((o) => o.kind === 'bird')).catch(() => null);
        await sleep(150);
        b = birdsSeen()[0];
        if (!b) continue;
      }
      let reached = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!reached) reached = await A.walkTo(b.x + dx, b.z + dz, false).catch(() => false);
      const r = await A.act({ k: 'catch', id: b.id });
      if (r.ok && r.gained && Object.keys(r.gained).some((k) => k.startsWith('bird_'))) caught = Object.keys(r.gained)[0];
      else await sleep(200);
    }
    check(!!caught, `caught a bird (${caught})`);
    const album = A.inbox.filter((m) => m.t === 'album').pop() as Extract<ServerMessage, { t: 'album' }> | undefined;
    check(!!caught && !!album?.album.birds[caught], 'the bird is in the album');
    check(!birdsSeen().some((o) => o.id === caught), 'caught bird is gone from the island');
  }

  console.log('Hotbar');
  {
    const slots = ['net', 'hand', 'axe', null, 'rod', 'shovel', 'sapling', 'pick', 'spade', null];
    A.send({ t: 'hotbar', slots });
    A.send({ t: 'hotbar', slots: ['axe', 'axe', 'bogus'] }); // duplicates / unknown tools are cleaned
    await sleep(200);
    A.send({ t: 'hotbar', slots });
    await sleep(200);
    state.hotbarPlayer = A.self.id;
    state.hotbarExpected = slots;
  }
}
