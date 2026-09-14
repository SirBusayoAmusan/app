#!/usr/bin/env node
/**
 * Mobile responsiveness audit — real Chromium, real layout.
 *
 * Loads the running Vite dev server, seeds the shared fixture into IndexedDB
 * through the app's own data layer, then walks every route at several viewport
 * widths and measures the things that actually break on phones:
 *
 *   1. horizontal document overflow (the classic mobile killer)
 *   2. individual elements breaking the viewport
 *   3. tap targets under 40 px
 *   4. form controls under 16 px (iOS zooms the page on focus)
 *   5. content hidden behind the fixed bottom nav
 *   6. console / page errors at phone width
 *
 * Screenshots at 390×844 are written to mobile-audit/ for review.
 *
 * Usage: node scripts/mobile-audit.mjs [baseUrl]
 *   default baseUrl: http://127.0.0.1:5173 (vite dev — serves /scripts/fixtures.ts)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = 'mobile-audit';

const VIEWPORTS = [
  { name: 'iPhone SE', width: 320, height: 568, dpr: 2, touch: true },
  { name: 'iPhone 14', width: 390, height: 844, dpr: 3, touch: true },
  { name: 'Pixel 7', width: 412, height: 915, dpr: 2.6, touch: true },
  // a 768px tablet is still a thumb target — it must exercise pointer: coarse
  { name: 'iPad mini', width: 768, height: 1024, dpr: 2, touch: true },
  // desktop: overflow still matters, 40px tap targets do not (mouse, not thumb)
  { name: 'Desktop', width: 1440, height: 900, dpr: 1, touch: false, skipTargets: true },
];

const SHOT_WIDTH = 390;

/* ------------------------------------------------------------ page probe -- */
const probe = (deviceWidth) => {
  // Chrome on mobile expands the layout viewport when content overflows and
  // zooms out to fit, so window.innerWidth can exceed the device width and
  // hide the very overflow we are looking for. Measure against the device.
  const vw = Math.min(window.innerWidth, deviceWidth ?? window.innerWidth);
  const root = document.documentElement;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  const describe = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 3).join('.');
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` “${text}”` : ''}`;
  };

  /* 1 + 2 — overflow */
  const overflowElements = [];
  const scrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.position === 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      if (inScroller(el)) continue;
      // An element that is itself a horizontal scroller (tab strip, filter
      // rail) is meant to extend past the edge. Verified separately instead of
      // reported as overflow — but only if it genuinely scrolls.
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') {
        if (el.scrollWidth > el.clientWidth + 1) scrollers.push({ el: describe(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
        else overflowElements.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
        continue;
      }
      overflowElements.push({
        el: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      });
    }
  }

  /* 3 — tap targets */
  const controlSel = 'button, [role="button"], input:not([type="hidden"]), select, textarea, summary';
  const smallTargets = [];
  for (const el of document.querySelectorAll(controlSel)) {
    if (!visible(el)) continue;
    // A checkbox wrapped in a <label> has a target the size of the label, not
    // of the 13px box, so measure the label — that is what the thumb hits.
    const type = el.getAttribute('type');
    const target = (type === 'checkbox' || type === 'radio')
      ? (el.closest('label') ?? el)
      : el;
    if (!visible(target)) continue;
    const r = target.getBoundingClientRect();
    const min = Math.min(r.width, r.height);
    // A range input is measured against the 24px WCAG 2.5.8 minimum rather
    // than the 40px comfort target: its thumb is the real target, and forcing
    // the whole track to 40px would distort the layout for no real gain.
    const floor = el.getAttribute('type') === 'range' ? 24 : 40;
    if (min < floor) {
      smallTargets.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height), below: floor });
    }
  }

  /* 4 — iOS focus zoom */
  const smallFont = [];
  for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) smallFont.push({ el: describe(el), fontSize: fs });
  }

  /* 5 — content hidden behind the bottom nav */
  const nav = document.querySelector('nav[data-bottom-nav]') ?? document.querySelector('nav.fixed.bottom-0');
  let navOverlap = [];
  let navInfo = null;
  if (nav && visible(nav)) {
    const nr = nav.getBoundingClientRect();
    navInfo = { top: Math.round(nr.top), height: Math.round(nr.height) };
    const paddingBottom = parseFloat(getComputedStyle(nav).paddingBottom) || 0;
    navInfo.safeAreaAware = getComputedStyle(nav).paddingBottom.includes('env')
      || document.body.innerHTML.includes('safe-area-inset-bottom');
    window.scrollTo(0, document.body.scrollHeight);
    for (const el of document.querySelectorAll('button, a, h2, h3, p')) {
      if (!visible(el) || nav.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || s.position === 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > nr.top + 2 && r.top < nr.bottom && r.width > 20) {
        navOverlap.push({ el: describe(el), bottom: Math.round(r.bottom), navTop: Math.round(nr.top) });
      }
    }
    window.scrollTo(0, 0);
  }

  const bodyIncludesSeed = (document.body.textContent ?? '').includes('acquisition for freelance social media managers')
    || (document.body.textContent ?? '').includes('Freelancers struggle')
    || (document.body.textContent ?? '').includes('Client acquisition');

  return {
    bodyIncludesSeed,
    docScrollWidth: root.scrollWidth,
    deviceWidth,
    layoutWidth: window.innerWidth,
    viewportWidth: vw,
    overflowPx: Math.max(0, root.scrollWidth - vw),
    overflowElements: overflowElements.slice(0, 8),
    scrollers: scrollers.slice(0, 4),
    smallTargets: smallTargets.slice(0, 8),
    smallTargetCount: smallTargets.length,
    smallFont: smallFont.slice(0, 6),
    navOverlap: navOverlap.slice(0, 6),
    navOverlapCount: navOverlap.length,
    navInfo,
    scrollHeight: root.scrollHeight,
  };
};

/* --------------------------------------------------------------- main ----- */
const ROUTES = [
  ['#/setup', 'setup'],
  ['#/home', 'home'],
  ['#/audience', 'audience'],
  ['#/discover', 'discover'],
  ['#/trends', 'trends'],
  ['#/projects', 'projects'],
  ['#/create/__PROJECT__', 'create'],
  ['#/marketing', 'marketing'],
  ['#/pricing', 'pricing'],
  ['#/ads', 'ads'],
  ['#/launch', 'launch'],
  ['#/analytics', 'analytics'],
  ['#/learn', 'learn'],
  ['#/settings', 'settings'],
];

const findings = [];
const consoleErrors = [];
let seedVisible = 0;

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  /* Playwright's storageState carries cookies and localStorage only — IndexedDB
     is NOT included (that arrived in a later release). Seeding once and porting
     the state silently measured empty states on every route, which is exactly
     the opposite of what needs checking: the dense, seeded screens are where
     overflow and tap-target problems live. So each context seeds itself. */
  const seedInPage = async (page) => page.evaluate(async () => {
    const mod = await import('/scripts/fixtures.ts');
    // clear rather than db.delete(): delete() closes the instance the app has
    // already booted on, so every later write would throw DatabaseClosedError
    const { db } = await import('/src/core/db/database.ts');
    await Promise.all(db.tables.map((t) => t.clear()));
    return mod.seedFixture();
  });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.touch,
      hasTouch: vp.touch,
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[${vp.name}] ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`[${vp.name}] pageerror: ${String(e).slice(0, 200)}`));

    /* boot the app once so the module graph is live, then seed this context */
    await page.goto(`${BASE}/#/setup`, { waitUntil: 'networkidle' });
    const fixture = await seedInPage(page);
    if (!fixture?.projectId) throw new Error(`${vp.name}: fixture did not seed`);
    console.log(`  ${vp.name}: seeded project ${fixture.projectId}`);
    await page.reload({ waitUntil: 'networkidle' });

    let seeded = 0;
    let scrollerCount = 0;
    for (const [rawHash, name] of ROUTES) {
      const hash = rawHash.replace('__PROJECT__', fixture.projectId);
      await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(450);
      const r = await page.evaluate(probe, vp.width);
      if (r.bodyIncludesSeed) seeded += 1;
      scrollerCount += (r.scrollers ?? []).length;

      if (r.overflowPx > 1) {
        findings.push({ vp: vp.name, route: name, kind: 'HORIZONTAL OVERFLOW', detail: `${r.overflowPx}px wider than the device (${r.docScrollWidth} vs ${r.viewportWidth}${r.layoutWidth > r.viewportWidth ? `; the browser had already zoomed the layout out to ${r.layoutWidth}px to hide it` : ''})`, items: r.overflowElements });
      } else if (r.overflowElements.length) {
        findings.push({ vp: vp.name, route: name, kind: 'element past edge', detail: 'no document overflow, but an element extends past the viewport (usually a clipped/scrollable row — verify by eye)', items: r.overflowElements });
      }
      if (r.smallTargetCount && !vp.skipTargets) {
        findings.push({ vp: vp.name, route: name, kind: 'small tap target', detail: `${r.smallTargetCount} control(s) under 40px`, items: r.smallTargets });
      }
      if (r.smallFont.length && !vp.skipTargets) {
        findings.push({ vp: vp.name, route: name, kind: 'iOS zoom risk', detail: 'form control under 16px font — iOS zooms the page on focus', items: r.smallFont });
      }
      if (r.navOverlapCount) {
        findings.push({ vp: vp.name, route: name, kind: 'bottom-nav overlap', detail: `${r.navOverlapCount} element(s) sit under the fixed bottom nav`, items: r.navOverlap });
      }

      if (vp.width === SHOT_WIDTH) {
        await page.screenshot({ path: `${OUT}/390-${name}.png`, fullPage: false });
      }
    }
    await ctx.close();
    seedVisible += seeded;
    console.log(`audited ${vp.name} (${vp.width}×${vp.height}) — seed visible on ${seeded}/${ROUTES.length} routes; ${scrollerCount} intentional scroll row(s) verified as scrollable`);
  }

  await browser.close();

  /* ------------------------------------------------------------ report --- */
  const totalRoutes = VIEWPORTS.length * ROUTES.length;
  const byKind = findings.reduce((acc, f) => {
    const key = `${f.kind}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\n──────────────────────────────────────────');
  console.log(`seed visible on ${seedVisible}/${totalRoutes} route×viewport combinations`);
  if (!findings.length) console.log('no layout findings 🎉');
  for (const f of findings) {
    console.log(`\n${f.vp} · ${f.route} · ${f.kind}\n  ${f.detail}`);
    for (const it of f.items ?? []) {
      if ('left' in it) console.log(`    · ${it.el} → ${it.left}..${it.right} (${it.width}px)`);
      else if ('w' in it) console.log(`    · ${it.el} → ${it.w}×${it.h}`);
      else if ('fontSize' in it) console.log(`    · ${it.el} → ${it.fontSize}px`);
      else if ('bottom' in it) console.log(`    · ${it.el} → bottom ${it.bottom} vs nav top ${it.navTop}`);
    }
  }
  if (consoleErrors.length) {
    console.log(`\nconsole/page errors (${consoleErrors.length}):`);
    [...new Set(consoleErrors)].slice(0, 10).forEach((e) => console.log(`  · ${e}`));
  } else {
    console.log('\nno console or page errors at any width');
  }

  writeFileSync(`${OUT}/audit-report.json`, JSON.stringify({ generated: new Date().toISOString(), byKind, findings, consoleErrors: [...new Set(consoleErrors)] }, null, 2));
  writeFileSync(`${OUT}/audit-report.md`, [
    '# Mobile audit',
    '',
    `Run ${new Date().toISOString()} · viewports ${VIEWPORTS.map((v) => `${v.width}×${v.height}`).join(', ')}`,
    '',
    '## Totals',
    '',
    ...Object.entries(byKind).map(([k, v]) => `- ${v}× ${k}`),
    findings.length ? '' : '- no findings',
    '',
    '## Findings',
    '',
    ...findings.flatMap((f) => [
      `### ${f.vp} · \`${f.route}\` · ${f.kind}`,
      '',
      f.detail,
      '',
      ...(f.items ?? []).map((it) => `- \`${JSON.stringify(it)}\``),
      '',
    ]),
    '## Console errors',
    '',
    ...([...new Set(consoleErrors)].map((e) => `- \`${e}\``)),
    ...([...new Set(consoleErrors)].length ? [] : ['- none']),
  ].join('\n'));

  console.log(`\nscreenshots → ${OUT}/ · report → ${OUT}/audit-report.md`);
  process.exit(0);
};

main().catch((e) => { console.error('AUDIT FAILURE', e); process.exit(1); });
