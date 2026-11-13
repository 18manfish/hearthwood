// End-to-end test: boots a real server (DEV_FAST) and drives it with bot
// clients over WebSockets, exercising the authoritative rules.
//   npm test                 every suite
//   npm test -- water        runs up to and including the suites whose name contains "water"
//                            (suites build on each other's progress, so earlier ones run too)
// Suites live in ./suites and run in file-name order; harness.ts has the bots and helpers.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodeTiles } from '@hearthwood/shared';
import { BASE, PORT, check, dataDir, dbAll, here, productionChecks, sleep, state, type Ctx } from './harness.ts';

const SUITES = fs.readdirSync(path.join(here, 'suites')).filter((f) => f.endsWith('.ts')).sort();

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const lastMatch = (f: string) => SUITES.reduce((n, s, i) => (s.includes(f) ? i : n), -1);
  const last = filter.length ? Math.max(...filter.map(lastMatch)) : SUITES.length - 1;
  if (last < 0) {
    console.log(`No suite matches ${filter.join(', ')}. Suites: ${SUITES.join(', ')}`);
    process.exit(1);
  }

  const server = spawn(process.execPath, ['--import', 'tsx', path.join(here, '../src/index.ts')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DEV_FAST: '1', LOG_LEVEL: process.env.LOG_LEVEL ?? 'error' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout!.resume(); // logs go to stdout; we don't need them
  // Wait until the server answers.
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await sleep(100);
  }

  const ctx = {} as Ctx;
  const crashed: string[] = [];
  try {
    for (const file of SUITES.slice(0, last + 1)) {
      const mod = (await import(`./suites/${file}`)) as { run: (ctx: Ctx) => Promise<void> };
      try {
        await mod.run(ctx);
      } catch (e) {
        state.failures++;
        crashed.push(file);
        console.error(`✘ suite ${file} crashed:`, e);
        if (!ctx.A) break; // nothing after this can run without the first player
      }
    }
  } finally {
    server.kill('SIGINT');
    await sleep(400);
    const saved = (dbAll('SELECT id FROM islands') as unknown[]).length;
    check(saved >= (filter.length ? 1 : 3), `state persisted to the database (${saved} islands)`);
    if (state.terraSpot) {
      const [tx, tz] = state.terraSpot;
      const rec = JSON.parse((dbAll('SELECT data FROM islands WHERE id = ?', state.terraIsland)[0] as { data: string }).data);
      const lv = rec.terrain ? decodeTiles(rec.terrain.levels)[tz * (rec.size ?? 48) + tx] : -1;
      check(rec.size === 72 && lv === 1, 'terraformed terrain is saved with the island');
      check(!rec.objects.some((o: { kind: string }) => o.kind === 'bird'), 'birds are not saved with the island');
    }
    if (state.hotbarPlayer) {
      const pl = JSON.parse((dbAll('SELECT data FROM players WHERE id = ?', state.hotbarPlayer)[0] as { data: string }).data);
      check(!('passHash' in pl) || typeof pl.passHash === 'string', 'player rows stored as JSON');
      check((dbAll('SELECT hash FROM tokens WHERE player_id = ?', state.hotbarPlayer) as { hash: string }[]).every((t) => /^[0-9a-f]{64}$/.test(t.hash)), 'only token hashes are stored');
      check(JSON.stringify(pl.hotbar) === JSON.stringify(state.hotbarExpected), 'hotbar layout is saved');
      check(Object.keys(pl.album?.birds ?? {}).length > 0, 'album is saved');
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (!filter.length)
    await productionChecks().catch((e) => {
      state.failures++;
      console.error(e);
    });
  if (crashed.length) console.log(`\nCrashed suites: ${crashed.join(', ')}`);
  console.log(state.failures ? `\n${state.failures} check(s) failed` : '\nAll checks passed');
  process.exit(state.failures ? 1 : 0);
}

main();
