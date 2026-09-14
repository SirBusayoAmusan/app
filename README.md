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

## First run

1. **Setup** — choose provider (Groq / OpenRouter / custom OpenAI-compatible), paste an API key,
   pick a model, hit *Test Connection*.
2. **Add a search key** (Tavily / Serper / Exa) under Settings — this is the evidence source;
   without it the app will not call anything a trend.
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
is therefore the default search provider**, and it is the only one that works with no proxy.
Tavily and Exa remain selectable and now show a "⚠ Needs a CORS proxy" badge with a required
proxy field; the runtime error names the cause instead of suggesting the network is at fault.

## Mobile

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
| Preview host over the proxy | HTTP 200 (`allowedHosts: true`) |
| Provider CORS from a real browser | measured — see the table above |

Still unverified: calls made *with real API keys*. The CORS verdicts above are conclusive (a
blocked call never reaches key validation), but end-to-end output quality depends on your keys
and credits.
