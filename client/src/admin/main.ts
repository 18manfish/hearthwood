// Admin tool: look after every player and island. Talks to /api/admin/* with
// the admin's login token; every change is validated and audited by the server.
// One file per page; this one logs the admin in and shows the page the address asks for.

import { watchEmojis } from '../ui/emoji.ts';
import '../style.css';
import '../tools.css';
import { api, clearToken, health, loadGameData, logout, token } from '../auth.ts';
import { showLogin } from '../ui/login.ts';
import { h, clear } from '../ui/dom.ts';
import { auditPage } from './audit.ts';
import { giftsPage } from './gifts.ts';
import { islandPage } from './islandEditor.ts';
import { islandsPage } from './islands.ts';
import { newsPage } from './news.ts';
import { playerPage, playersPage } from './players.ts';
import { villagerPage } from './villagers.ts';
import { app, hasUnsaved, type Me, setMe } from './ui.ts';

let currentHash = location.hash;

async function route() {
  currentHash = location.hash;
  const [page, id, ...rest] = location.hash.replace(/^#/, '').split('/');
  if (page === 'player' && id) return playerPage(id);
  if (page === 'islands') return islandsPage();
  if (page === 'island' && id) return islandPage(id, rest[0]);
  if (page === 'villager' && id && rest[0]) return villagerPage(id, rest[0]);
  if (page === 'audit') return auditPage();
  if (page === 'news') return newsPage(id ? Number(id) : null);
  if (page === 'gifts') return giftsPage(id ?? null, rest[0]);
  return playersPage();
}

async function start() {
  let me: Me;
  const info = await health();
  await loadGameData().catch(() => null);
  for (;;) {
    if (!token()) await showLogin(app, { health: info, message: 'Log in with an admin account.' });
    try {
      me = await api<Me>('GET', '/api/me');
      setMe(me);
      break;
    } catch {
      clearToken();
    }
  }
  if (!me.admin) {
    clear(app);
    app.append(h('div', { class: 'screen' }, h('div', { class: 'card col', style: 'max-width:420px;text-align:center' },
      h('h2', {}, '🛡️ Admins only'), h('p', {}, `You're logged in as ${me.username ?? me.name}, which isn't an admin account.`),
      h('p', { class: 'muted' }, 'Ask an admin to give you the admin role, or start the server with ADMIN_USERS=yourname.'),
      h('button', { class: 'btn', onclick: async () => { await logout(); location.reload(); } }, 'Log in as someone else'))));
    return;
  }
  window.addEventListener('hashchange', () => {
    if (location.hash === currentHash) return;
    if (hasUnsaved() && !confirm('You have unsaved changes on this page. Leave anyway?')) {
      history.replaceState(null, '', currentHash || location.pathname);
      return;
    }
    currentHash = location.hash;
    route();
  });
  route();
}
watchEmojis(document.body);
start();
