#!/usr/bin/env node
/**
 * Icon integrity check — run after `npm run build`.
 *
 * A missing favicon is a 404 in every browser tab and it fails silently in
 * every other test we have, so this asserts that:
 *   1. every icon referenced by dist/index.html resolves to a real file,
 *   2. the manifest's icon set resolves too and declares the right sizes,
 *   3. the raster icons are actually the size they claim (and square),
 *   4. the .ico really carries 16/32/48 frames.
 *
 * Usage: node scripts/check-icons.mjs [distDir]
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const root = resolve(import.meta.dirname, '..');
const fails = [];
const passes = [];

const fail = (m) => fails.push(m);
const pass = (m) => passes.push(m);

const readSize = (file) => {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { format: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 2).toString('ascii') === '<s') return { format: 'svg', w: null, h: null };
  if (buf.subarray(0, 4).toString('hex') === '00000100') {
    return { format: 'ico', count: buf.readUInt16LE(4) };
  }
  return { format: 'unknown' };
};

// 1 + 3 — icons declared in the document head
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const headIcons = [...html.matchAll(/<link[^>]+rel="(icon|shortcut icon|apple-touch-icon|mask-icon)"[^>]*>/g)]
  .map((m) => m[0])
  .map((tag) => {
    const href = /\shref="([^"]+)"/.exec(tag)?.[1] ?? '';
    const sizes = /\ssizes="([^"]+)"/.exec(tag)?.[1] ?? '';
    return { href, sizes };
  });

if (headIcons.length < 5) fail(`expected at least 5 icon links in index.html, found ${headIcons.length}`);

for (const { href, sizes } of headIcons) {
  if (!href || href.startsWith('data:')) {
    fail(`icon link is still a data URI or empty: ${href.slice(0, 40)}`);
    continue;
  }
  if (!href.startsWith('/')) {
    fail(`icon path must be root-absolute (${href}) — relative paths break on deep routes`);
    continue;
  }
  const file = join(dist, href.replace(/^\//, ''));
  if (!existsSync(file)) {
    fail(`index.html references ${href} but ${file} does not exist`);
    continue;
  }
  const { format, w, h } = readSize(file);
  if (sizes && /^\d+x\d+$/.test(sizes)) {
    const [sw, sh] = sizes.split('x').map(Number);
    if (format === 'png' && (w !== sw || h !== sh)) {
      fail(`${href} declares ${sizes} but the file is ${w}x${h}`);
      continue;
    }
  }
  if (format === 'png' && w !== h) fail(`${href} is not square (${w}x${h})`);
  pass(`${href} (${format}${w ? ` ${w}x${h}` : ''})`);
}

// .ico really multi-frame
const icoPath = join(dist, 'favicon.ico');
if (existsSync(icoPath)) {
  const { format, count } = readSize(icoPath);
  if (format !== 'ico') fail('favicon.ico is not a real ICO container');
  else if (count < 3) fail(`favicon.ico carries ${count} frame(s); 16/32/48 expected`);
  else pass(`favicon.ico (${count} frames)`);
} else {
  fail('favicon.ico is missing from dist — legacy tabs and bookmarks will 404');
}

// 2 — manifest icon set
const manifestPath = join(dist, 'manifest.webmanifest');
if (!existsSync(manifestPath)) {
  fail('manifest.webmanifest missing from dist');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const icons = manifest.icons ?? [];
  if (!icons.some((i) => String(i.purpose ?? '').includes('maskable'))) {
    fail('manifest has no maskable icon — Android will shrink or crop the mark');
  }
  if (!icons.some((i) => i.sizes === '192x192')) fail('manifest is missing a 192x192 icon');
  if (!icons.some((i) => i.sizes === '512x512')) fail('manifest is missing a 512x512 icon');
  let real = 0;
  for (const icon of icons) {
    if (String(icon.src).startsWith('data:')) {
      fail(`manifest icon ${icon.sizes} is still an inline data URI`);
      continue;
    }
    const file = join(dist, String(icon.src).replace(/^\//, ''));
    if (!existsSync(file)) {
      fail(`manifest references ${icon.src} but the file does not exist`);
      continue;
    }
    real += 1;
    const { format, w, h } = readSize(file);
    if (icon.sizes !== 'any' && format === 'png' && `${w}x${h}` !== icon.sizes) {
      fail(`manifest icon ${icon.src} declares ${icon.sizes} but is ${w}x${h}`);
    }
  }
  pass(`manifest: ${real}/${icons.length} icon files resolve`);
  if (!manifest.theme_color) fail('manifest has no theme_color');
}

// og share card
if (existsSync(join(dist, 'og-image.png'))) {
  const { w, h } = readSize(join(dist, 'og-image.png'));
  if (w !== 1200 || h !== 630) fail(`og-image.png should be 1200x630, got ${w}x${h}`);
  else pass('og-image.png 1200x630');
  if (!/og:image/.test(html)) fail('index.html does not declare og:image');
} else {
  fail('og-image.png missing — link previews will have no card');
}

console.log(`icon check (${dist})`);
for (const p of passes) console.log(`  ✓ ${p}`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(`\n${passes.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
