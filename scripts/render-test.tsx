/* Runtime render test: boots the real app in jsdom against fake-indexeddb,
   visits every route, and fails on any React/console error. */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://local.creatortools.test/#/home',
  pretendToBeVisual: true,
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.location = dom.window.location;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.HashChangeEvent = dom.window.HashChangeEvent ?? dom.window.Event;
g.CustomEvent = dom.window.CustomEvent;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
g.IS_REACT_ACT_ENVIRONMENT = false;

/* Install the in-memory IndexedDB shim BEFORE any app module (Dexie resolves
   its dependencies at import time). Mirrors the shim onto the jsdom window. */
await import('fake-indexeddb/auto'); // side-effect module: installs globals
const idbKeys = ['indexedDB', 'IDBKeyRange', 'IDBTransaction', 'IDBDatabase', 'IDBFactory', 'IDBOpenDBRequest', 'IDBRequest', 'IDBCursor', 'IDBCursorWithValue', 'IDBIndex', 'IDBObjectStore', 'IDBVersionChangeEvent'];
/* Dexie captures globalThis.indexedDB at import time; fake-indexeddb installs
   onto `window` when one exists, so mirror both directions before app import. */
idbKeys.forEach((k) => {
  const fromWindow = (dom.window as any)[k];
  const fromGlobal = (globalThis as any)[k];
  if (fromWindow && !fromGlobal) (globalThis as any)[k] = fromWindow;
  if (fromGlobal && !fromWindow) (dom.window as any)[k] = fromGlobal;
});
const idbAvailable = Boolean((dom.window as any).indexedDB || (globalThis as any).indexedDB);
if (!idbAvailable) throw new Error('fake-indexeddb did not install');

const errors: string[] = [];
const origError = console.error;
console.error = (...args: any[]) => { errors.push(args.map(String).join(' ')); origError('[console.error]', ...args); };
dom.window.addEventListener('error', (e: any) => errors.push(`window error: ${e?.message ?? e}`));
dom.window.addEventListener('unhandledrejection', (e: any) => errors.push(`unhandled rejection: ${e?.reason?.message ?? e?.reason}`));

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const App = (await import('../src/App')).default;
  const { db, uid } = await import('../src/core/db/database');

  const root = createRoot(document.getElementById('root')!);
  root.render(React.createElement(App));
  await wait(500);

  const bodyText = () => document.body.textContent ?? '';
  const routes: [string, string][] = [
    ['#/setup', 'Your AI key'],
    ['#/home', 'Stop guessing what to sell.'],
    ['#/audience', 'Who are you trying to sell to'],
    ['#/discover', 'Discover profitable niches'],
    ['#/trends', 'Trend intelligence'],
    ['#/projects', 'My products'],
    ['#/marketing', 'Build the marketing machine'],
    ['#/pricing', 'Find the right price'],
    ['#/ads', 'Turn attention into sales'],
    ['#/launch', 'Launch your product'],
    ['#/analytics', 'Track. Learn. Scale.'],
    ['#/learn', 'How CreatorTools thinks'],
    ['#/settings', 'Settings'],
  ];

  let pass = 0; let fail = 0;
  for (const [hash, needle] of routes) {
    dom.window.location.hash = hash;
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    await wait(320);
    const ok = bodyText().includes(needle);
    if (ok) { pass++; console.log(`  ✓ ${hash} renders (“${needle}”)`); }
    else { fail++; console.log(`  ✗ ${hash} missing “${needle}” →`, bodyText().slice(0, 160)); }
  }

  /* Seed a fixture through the real data layer, then render the deep routes. */
  const { seedFixture } = await import('./fixtures');
  const fx = await seedFixture();
  const { nicheId, problemId } = fx;

  const { useStore } = await import('../src/store');
  await useStore.getState().reload();

  for (const [hash, needle] of [['#/discover', 'Freelancers struggle'], ['#/trends', 'Pages and posts read'], [`#/niche/${nicheId}`, 'Client acquisition'], [`#/problem/${problemId}`, 'why we think this is an opportunity'], ['#/home', 'Top opportunities']] as [string, string][]) {
    dom.window.location.hash = hash;
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    await wait(320);
    const text = bodyText().toLowerCase();
    const ok = text.includes(needle.toLowerCase());
    if (ok) { pass++; console.log(`  ✓ seeded ${hash} renders (“${needle}”)`); }
    else { fail++; console.log(`  ✗ seeded ${hash} missing “${needle}” →`, bodyText().slice(0, 200)); }
  }

  /* Project flow: open the workspace created by the fixture. */
  dom.window.location.hash = `#/create/${fx.projectId}`;
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  await wait(400);
  if (bodyText().includes('Product workspace') || bodyText().includes('Small') || bodyText().includes('Generate product strategy')) {
    pass++; console.log('  ✓ product workspace renders for a created project');
  } else { fail++; console.log('  ✗ product workspace failed →', bodyText().slice(0, 200)); }

  for (const [hash, needle] of [['#/projects', 'acquisition for freelance social media managers'], ['#/marketing', 'Positioning'], ['#/pricing', 'Pricing'], ['#/launch', 'Launch readiness'], ['#/analytics', 'Performance input']] as [string, string][]) {
    dom.window.location.hash = hash;
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    await wait(320);
    const ok = bodyText().includes(needle);
    if (ok) { pass++; console.log(`  ✓ project ${hash} renders (“${needle}”)`); }
    else { fail++; console.log(`  ✗ project ${hash} missing “${needle}” →`, bodyText().slice(0, 200)); }
  }

  const realErrors = errors.filter((e) => !/not wrapped in act|Warning: ReactDOM.render|findDOMNode|HTMLCanvasElement's getContext/i.test(e));
  if (realErrors.length) {
    fail++;
    console.log(`\n  ✗ ${realErrors.length} console/window error(s):`);
    realErrors.slice(0, 8).forEach((e) => console.log('     ', e.slice(0, 220)));
  } else {
    pass++;
    console.log('\n  ✓ no console or window errors during the whole session');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILURE', e); process.exit(1); });
