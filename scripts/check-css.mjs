#!/usr/bin/env node
/**
 * CSS integrity check — run after `npm run build`.
 *
 * Tailwind v3 tree-shakes classes declared in `@layer components` by scanning
 * the source for *literal* class strings. A class built as `btn-${size}` is
 * therefore dropped from the compiled stylesheet with no error anywhere: the
 * button simply loses its height, padding and colours. That is invisible to
 * DOM/text tests and only shows up when a human looks at a rendered page.
 *
 * This asserts:
 *   1. every class declared in @layer components actually exists in the build,
 *   2. no source file composes a component class from a template literal,
 *   3. the compiled stylesheet is non-trivial and contains the base layers.
 *
 * Usage: node scripts/check-css.mjs [distDir]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const root = resolve(import.meta.dirname, '..');
const fails = [];
const passes = [];

/* --- 1. every declared component class must exist in the built CSS -------- */
const source = readFileSync(join(root, 'src/index.css'), 'utf8');
const layerMatch = /@layer\s+components\s*\{/.exec(source);
if (!layerMatch) fails.push('src/index.css has no @layer components block');

const declared = [...source.matchAll(/^\s{2}\.([a-z][a-z0-9-]*)\s*\{/gm)].map((m) => m[1]);
if (declared.length < 10) fails.push(`only ${declared.length} component classes parsed — parser drift?`);

const cssDir = join(dist, 'assets');
if (!existsSync(cssDir)) {
  console.error(`no ${cssDir} — run npm run build first`);
  process.exit(1);
}
const cssFile = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
if (!cssFile.length) {
  console.error('no CSS emitted into dist/assets');
  process.exit(1);
}
const css = cssFile.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');

for (const cls of declared) {
  // match ".name{" or ".name," (grouped) or ".name " (descendant)
  const present = new RegExp(`\\.${cls}(?![a-zA-Z0-9_-])(?=\\s*[,{: >])`).test(css);
  if (!present) {
    fails.push(`.${cls} is declared in @layer components but missing from the compiled CSS — it was tree-shaken (dynamic class name?) or is dead code`);
  }
}
if (!fails.length) passes.push(`${declared.length} component classes all present in dist CSS`);

/* --- 2. no component class may be composed from a template literal -------- */
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(t|j)sx?$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(join(root, 'src'));

const componentNames = new Set(declared);
const dynamicHits = [];
for (const file of sourceFiles) {
  const raw = readFileSync(file, 'utf8');
  // strip comments first: prose may legitimately mention the anti-pattern
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of text.matchAll(/`([a-zA-Z][\w-]*-)\$\{/g)) {
    const prefix = m[1];
    // flag only when the prefix could produce one of our component classes
    if (declared.some((c) => c.startsWith(prefix))) {
      dynamicHits.push(`${file.replace(root + '/', '')}: \`${prefix}\${...}\` could resolve to a tree-shaken component class`);
    }
  }
}
if (dynamicHits.length) fails.push(...dynamicHits);
else passes.push('no component class is composed from a template literal');

/* --- 3. sane stylesheet --------------------------------------------------- */
if (/\.btn\s*\{/.test(css)) passes.push('button base styles present');
else fails.push('.btn missing from compiled CSS');
if (!/@media[^{]*max-width:\s*640px[^{]*\{[^}]*font-size:\s*16px\s*!important/.test(css)) {
  fails.push('iOS focus-zoom guard missing — fields under 16px zoom the page on focus');
} else {
  passes.push('iOS focus-zoom guard present (16px fields on phones and touch devices)');
}
if (!/@media\s*\(pointer:\s*coarse\)/.test(css)) {
  fails.push('touch-target block (pointer: coarse) missing — chips, text buttons and sliders lose their hit area on touch devices');
} else {
  passes.push('touch-target block present (pointer: coarse: 40px controls, 28px slider boxes)');
}
const kb = Math.round(Buffer.byteLength(css) / 1024);
if (kb < 8) fails.push(`compiled CSS is only ${kb} kB — Tailwind content scan is probably misconfigured`);
else passes.push(`compiled CSS ${kb} kB across ${cssFile.length} file(s)`);

console.log(`css check (${dist})`);
for (const p of passes) console.log(`  ✓ ${p}`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(`\n${passes.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
