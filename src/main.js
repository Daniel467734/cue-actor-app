import './styles.css';
import { h } from './util.js';

const routes = [
  [/^\/?$/, () => import('./views/library.js'), 'library'],
  [/^\/dictate(?:\/([^/]+))?$/, () => import('./views/dictate.js'), 'dictate'],
  [/^\/script\/([^/]+)$/, () => import('./views/script.js'), 'library'],
  [/^\/rehearse\/([^/]+)$/, () => import('./views/rehearse.js'), 'rehearse'],
  [/^\/settings$/, () => import('./views/settings.js'), 'settings'],
];

const view = h('main', { id: 'view' });
const navItems = [['library', '#/', '📚', 'Library'], ['dictate', '#/dictate', '🎙', 'Dictate'], ['settings', '#/settings', '⚙️', 'Settings']];
const nav = h('nav', { class: 'nav' },
  h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo' }, '◐'), ' Cue'),
  navItems.map(([k, href, ico, label]) => h('a', { class: 'nav-link', 'data-k': k, href }, h('span', {}, ico), h('small', {}, label))));
const app = document.getElementById('app');
app.append(nav, view);

let cleanup = null;
let token = 0;

async function route() {
  const my = ++token;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  if (cleanup) {
    try { cleanup(); } catch (e) { console.error(e); }
    cleanup = null;
  }
  for (const [re, load, key] of routes) {
    const m = path.match(re);
    if (!m) continue;
    document.body.dataset.route = key;
    nav.querySelectorAll('.nav-link').forEach((a) => a.classList.toggle('on', a.dataset.k === key));
    try {
      const mod = await load();
      if (my !== token) return;
      view.replaceChildren();
      const c = await mod.render(view, { id: m[1] });
      if (my !== token) { if (typeof c === 'function') c(); return; }
      cleanup = typeof c === 'function' ? c : null;
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      if (/dynamically imported module|Importing a module script failed/i.test(e.message) && !sessionStorage.getItem('cue-reloaded')) {
        sessionStorage.setItem('cue-reloaded', '1');
        return location.reload();
      }
      view.replaceChildren(h('section', { class: 'page' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to library')));
    }
    return;
  }
  location.hash = '#/';
}

addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
