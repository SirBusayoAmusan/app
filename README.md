# CreatorTools

**Stop guessing what to sell.** A local-first, evidence-backed opportunity-discovery and
digital-product-creation workspace. Static app / PWA — no backend, no accounts, no server-side
storage. Everything you research and build lives in your browser's IndexedDB; API keys live in
memory for the session only.

Live preview: the running `vite preview` server on port 4173 (see the live preview panel).

---

## The rule the whole app is built around

> The internet provides the evidence. AI provides the intelligence. The scoring system provides
> the differentiation.

- **No source → no factual claim.** Every claim of "trending / growing / underserved / in demand"
  must be attached to current external evidence with URL, title, publication date, the query used
  and the retrieval timestamp.
- **The LLM never writes the final score.** It supplies evidence-cited component assessments
  (0–100 per component, each citing evidence IDs). The app owns every number: weights,
  confidence, contradiction penalty, arithmetic trace.
- **Confidence is displayed separately from attractiveness.** A 90 at 35% confidence can never
  outrank an 84 at 92%. Too little evidence renders "Insufficient evidence", never a guess.
- **Names, dates and numbers are never invented.** AI-generated text carries source weight 0.00
  and cannot count as evidence.

## Pipeline

```
audience context → hypotheses → query plan (9 layers, 24 queries) → live search
  → evidence normalisation (dedupe, cluster, weight) → signals
  → niches (cluster + quality gate) → problems (per niche, ranked)
  → adversarial validation (10 counter-queries) → deterministic score → opportunity report
```

Progress states are stage-accurate ("Scanning current demand", "Clustering problems",
"Comparing opportunity signals", "Building your opportunity report") rather than generic spinners.

Scoring (SCORING `s1.0.0`), all arithmetic in `src/core/intelligence/scoringEngine.ts`:

```
base       = Σ(component × weight)                      # 10 weighted components
confidence = (reliability .25 + diversity .20 + recency .20 + directness .20
              + cross-source consistency .15) × volume   # volume = 0.55 + 0.45·min(1, n/8)
multiplier = 0.60 + confidence/100 × 0.40
final      = clamp(base × multiplier × (1 − contradiction_rate × 0.20), 0, 100)
```

Gates: ≥24 queries, ≥30 evidence items, ≥8 independent domains per run; ≥5 evidence / ≥3 domains
/ ≥1 source ≤90 days old per niche; ≥3 sources / ≥2 domains per validation.

## Stack

Vite 5 · React 18 · TypeScript 5.6 · Tailwind 3.4 · Dexie 4 (IndexedDB) · Zustand 4 · Zod 3 ·
lucide-react · jsPDF · fake-indexeddb (in-memory fallback) · jsdom (render harness).

```
src/core/types.ts            domain model
src/core/db/                 Dexie schema (18 stores) + storage bootstrap
src/core/ai/                 provider presets + session-memory credential store
src/core/intelligence/       search adapters, evidence engine, query engine,
                             scoring engine, AI engines, orchestrator
src/core/schemas/            16 strict JSON schemas (additionalProperties: false)
src/core/prompts/            versioned prompt set (p1.0.0), 15 engines
src/core/product/            strategy, guide, sales page, pricing, marketing,
                             ads, launch, analytics/optimization engines + PDF
src/pages/                   13 routed pages (setup, home, audience, discover,
                             trends, niches, problems, product, marketing,
                             pricing, ads, launch, analytics, learn, settings)
```

## Run it

```bash
npm install
npm run dev            # development
npm run build          # tsc -b && vite build → static dist/
npm test               # deterministic-core smoke suite (33 assertions)
npm run test:render    # jsdom render harness of the real App across all routes
npm run icons          # regenerate the favicon + PWA + share-card set
npm run verify:icons   # assert every icon path, size and frame in dist/
npm run verify:css     # assert no component class was tree-shaken out of the CSS
npm run verify         # build + every guard + both test suites
npm run audit:mobile   # real Chromium: 5 viewports × 14 routes, layout + tap targets
                       # needs a dev server first (it imports /scripts/fixtures.ts):
                       #   npm run dev   then   npm run audit:mobile [baseUrl]
```

## Icons

The mark is the one the app already carried inline: two overlapping circles —
lavender `#ecdcff` meeting violet `#7c5cff` — with the lens tinted so the
overlap survives at 16 px. Everything is drawn from primitives at high
supersampling by `scripts/make-icons.py`; no image model is involved, so the
set is reproducible and stays on-brand.

| File | Purpose |
| --- | --- |
| `favicon.svg` | primary tab icon; vector, crisp on any DPI |
| `favicon.ico` | 16 / 32 / 48 frames for legacy tabs, bookmarks, Windows shortcuts |
| `favicon-16x16.png`, `favicon-32x32.png` | explicit PNG fallbacks (16 px uses a re-proportioned mark) |
| `apple-touch-icon.png` | 180 px home-screen icon (full-bleed; iOS applies its own mask) |
| `icons/icon-192.png`, `icons/icon-512.png` | manifest `any` icons — squircle tile, transparent corners |
| `icons/maskable-192/512.png` | manifest `maskable` icons, mark inside the 80% safe zone |
| `icons/safari-pinned-tab.svg` | monochrome Safari pinned-tab silhouette |
| `og-image.png` | 1200×630 share card for link previews |

`favicon-preview.png` is a review sheet showing every asset at true size, the
16 px tab rendering and the worst-case circular maskable crop. `npm run
verify:icons` fails the check if any declared icon 404s, is not square, is not
the size it claims, or if the `.ico` loses its frames — the failure mode that
otherwise ships silently.

> The share card and `og:*` tags point at `https://creatortools.app/`. Swap
> that origin in `index.html` (canonical, `og:url`, `og:image`, `twitter:image`)
> and in `scripts/make-icons.py` when you deploy somewhere else.

Deploy by serving `dist/` from any static host (Vercel, Cloudflare Pages, Netlify, object storage).
Hosting only ever serves application files.

## One key is enough

The app is fully usable with **a single AI key**. Evidence collection is on from the first run and
needs no credential at all, because it reads open, CORS-enabled, *dated* public datasets:

| Source | What it gives | Rate limit |
| --- | --- | --- |
| Hacker News (Algolia) — stories | launches, market shifts, tooling gaps, with points + comments | generous |
| Hacker News (Algolia) — comments | raw pain language: *"I still can't get clients…"* | generous |
| Stack Exchange | literal questions people typed, with scores and answer counts | 300/day |
| GitHub Issues | an open issue is an explicitly unmet need; reactions size the demand | 10/min |
| DEV (tag feed) | practitioner write-ups and post-mortems | generous |

Measured from a browser origin: all four answer with `access-control-allow-origin`. Reddit returns
`403` with no CORS header and is deliberately absent. A three-query probe returned **51 unique
results across 16 domains, 51/51 carrying a real publication date and 45 within 90 days** — enough
to clear the ≥8-domain run gate and the ≥3-domain niche gate with no commercial key.

A commercial search key (Serper) stays available and upgrades *recall*: the free sources skew
technical, so they are strong on pain and urgency and thinner on mainstream buying behaviour.
Choosing one is an upgrade, never a prerequisite.

Three measured constraints shape the keyless layer:

1. **These are keyword-AND indexes, not semantic search.** The natural-language queries the
   commercial providers accept return nothing here — `"freelancers struggling to get clients"`
   scores `nbHits: 0` on HN and `total_count: 0` on GitHub. Every query is reduced to its two
   strongest content words first (`keylessKeywords()`), which is why `"freelancers clients"`
   works and the full sentence does not.
2. **They are rate-limited**, so each source has a per-run budget and a minimum spacing
   (`KEYLESS_BUDGET`), refilled by `resetKeylessBudget()` at the start of every run.
3. **A source returning nothing is normal.** Partial evidence is still evidence; a throttled or
   empty source never fails the run.

## First run

1. **Setup** — paste an AI key (Groq / OpenRouter / custom OpenAI-compatible), press *Check key*.
   That is the only thing anyone has to do.
2. **Evidence** — already connected. Nothing to fill in; a Google search key is offered as an
   optional upgrade behind one link.
3. **Audience** — narrow to audience + specific problem + desired outcome + context. Generic
   "fitness / finance / health / marketing" is rejected until it is narrowed.
4. **Find My Opportunity** — run the pipeline, then open a niche, rank its problems, and promote
   one into a product workspace (strategy → guide → sales page → pricing → marketing → ads →
   launch → analytics → scale).

> Keys are held in a module-level variable for the current tab session only. They are never
> written to IndexedDB or localStorage, never logged, never forwarded to another provider, and are
> cleared on refresh. Direct browser calls to providers mean your key is visible to that provider
> and to your own browser session — that is the trade for having no server.

## Which providers actually work from a browser

This architecture has no backend, so every provider call is made by the browser. That makes CORS
a hard constraint, not a detail. Measured with a real Chromium against the app's own origin:

| Provider | Result | Verdict |
| --- | --- | --- |
| OpenRouter | `200` + readable body | ✅ direct calls work |
| Groq | `401` + readable JSON (fake key) | ✅ CORS fine |
| Serper.dev | `403` + readable JSON (fake key) | ✅ CORS fine |
| Tavily | `TypeError: Failed to fetch` | ❌ blocked |
| Exa | `TypeError: Failed to fetch` | ❌ blocked |

Tavily and Exa send no CORS headers, so the browser refuses the response **before the API key is
even validated** — it is a property of the provider, not of your key or your network. **Serper.dev
is therefore an optional upgrade**, not the default: the default is now the keyless public-dataset
layer above, which needs no credential at all.
Tavily and Exa remain selectable and now show a "⚠ Needs a CORS proxy" badge with a required
proxy field; the runtime error names the cause instead of suggesting the network is at fault.

## Pip, the guide

Pip is the logo brought to life — the same two overlapping circles, given a face. She exists
to answer *"what is happening and what do I do next?"* without a paragraph of text, so every
mood maps to a real state and nothing is decorative:

| Mood | Where | What it means |
| --- | --- | --- |
| `idle` | step footers, empty screens | breathing, waiting for you |
| `thinking` | key check, live discovery run | working — dots orbit, eyes glance up |
| `happy` | key verified, end of the journey | something landed |
| `alert` | a rejected key | something needs you |
| `sleepy` | empty states | nothing to do yet |

She appears where a state needs explaining and nowhere else — the hero, the setup wizard beside
the progress rail, the run progress card, and empty states. Every animation is slow and small,
and all of it collapses under `prefers-reduced-motion`.

**Mood classes are written out in full**, not built with a template literal, because the CSS
guard rejects interpolated class names: a misspelt mood would silently produce a class that does
not exist and the character would simply stop animating, with no error anywhere.

### Journey navigation

`src/components/FlowBar.tsx` owns the step order. Every screen in the sequence gets an explicit
Back and Next — including step 1, whose Back goes home, so nobody is ever stranded. Reference
screens (How it works, Settings) are deliberately outside the flow and get no bar.

Two screens are excluded on purpose: **Setup** has its own per-step Back/Next, and a second
competing navigation row underneath it would be confusing. **Niche** and **Problem** are annex
screens that sit inside the journey with their own back/forward targets.

The logo returns to Home from every screen, on both desktop and mobile. There is a test for it.

## Mobile



**Run it against the dev server**, not `vite preview`: the audit seeds each context via
`import('/scripts/fixtures.ts')`, and Vite only transforms that path in dev mode. Against a
preview build it fails with `Failed to fetch dynamically imported module`.

```
npx vite --host 0.0.0.0 --port 5178 --strictPort   # in one shell
node scripts/mobile-audit.mjs http://127.0.0.1:5178
```

Beyond the built-in checks, these were probed by hand and are clean:

- **Bottom-nav trapping.** Scrolled every route to its maximum and asked whether any control
  still sits under the fixed nav. Zero — the earlier "trapped" hits were the nav's own buttons.
- **Range inputs at 28px.** Deliberate: WCAG 2.5.8 sets 24px as the floor for a slider, and the
  thumb is the real target. Forcing a 40px track would distort the layout for no gain.

Verified with `npm run audit:mobile` — real Chromium, seeded IndexedDB, 5 viewports
(320 / 390 / 412 / 768 / 1440) × 14 routes, screenshots in `mobile-audit/`.

- **No horizontal overflow anywhere.** One subtlety worth knowing: Chrome on a phone expands the
  layout viewport and zooms out to hide overflow, so `window.innerWidth` can exceed the device
  width and mask the bug. The audit measures against the *device* width and cross-checks the two.
- **Touch targets.** Anything tappable reaches 40px under `@media (pointer: coarse)` — chips,
  text buttons, small buttons, select fields, checkbox rows, sliders. Keyed to pointer type, not
  width: a 768px iPad is just as much a thumb target as a 390px phone.
- **iOS focus zoom.** Form controls are forced to 16px on phones *and* touch devices; iOS Safari
  zooms the whole page when a focused field is smaller, which kicked the layout off-centre
  mid-typing of an API key.
- **Bottom nav.** `env(safe-area-inset-bottom)` respected; no content sits under it.

### The bug that mattered most

Tailwind v3 tree-shakes classes declared in `@layer components` by scanning the source for
*literal* strings. `Button` composed its classes as `` `btn-${size}` ``, so **`btn-sm`, `btn-lg`,
`btn-ghost` and `btn-quiet` were never emitted into the stylesheet** — in dev or in prod. Every
button in the app had been rendering with no height, no padding and no variant styling, and it
was invisible to every DOM/text-level test because the markup was still correct.

`npm run verify:css` now fails the build if any declared component class is missing from the
compiled CSS, or if any class is composed from a template literal.

## Verification status

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run build` | passes, `dist/` emitted incl. `manifest.webmanifest` |
| `npm test` (deterministic core) | 33 / 33 |
| `npm run test:render` (real App in jsdom) | 25 / 25, zero console/window errors |
| `npm run verify:icons` | 9 / 9 |
| `npm run verify:css` | 6 / 6 |
| `npm run audit:mobile` | 0 layout findings, 0 console errors, 5 viewports × 14 routes |
| Bottom-nav trapping (extra probe) | 0 unreachable controls at max scroll, 320/390/412 × 13 routes |
| Jargon sweep (rendered text) | 0 hits across 7 routes, from ~40 patterns |
| Preview host over the proxy | HTTP 200 (`allowedHosts: true`) |
| Provider CORS from a real browser | measured — see the table above |
| Keyless evidence layer, live | 51 unique results / 16 domains / 51 dated / 45 ≤90d from 3 queries |
| One-key flow in the real UI | AI key only → Discover not gated, Run enabled, 0 console errors |

Still unverified: calls made *with real AI keys*. The CORS verdicts above are conclusive (a blocked
call never reaches key validation) and the keyless evidence layer was exercised against the live
APIs, but model output quality depends on your key and credits.

## Deploying

`npm run build` emits a fully static `dist/`. Two things matter for hosting:

1. **Asset paths are relative (`base: './'`).** This is what makes a GitHub Pages project
   site work. Root-absolute `/assets/...` URLs 404 under `/<repo>/`, and the symptom is a
   blank or stale-looking page — not an obvious error. If a deploy "did not update", check
   this first.
2. **Routing is hash-based** (`#/discover`), so no server rewrite rules are needed and deep
   links work on any static host.

To confirm which build is live, open **Settings → This session → This version**. It shows the
build stamp written at compile time, so a stale deploy is obvious at a glance rather than
something you have to guess at.

Verified by serving `dist/` from a plain static directory: page loads with zero failed
requests and deep routes resolve.
