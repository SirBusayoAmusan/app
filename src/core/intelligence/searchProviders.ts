/* ------------------------------------------------------------------
   Live market evidence collection. This is the layer that makes the
   product honest: the LLM never supplies market facts, these providers
   do. Every result keeps its URL, title, date, query and timestamp.
   ------------------------------------------------------------------ */
import type { AppError, SearchProviderConfig, SearchProviderId, SourceType } from '../types';
import { err, isCorsOrNetworkFailure, mapHttpError, safeJsonParse, withTimeout } from '../lib/utils';
import { getCredential } from '../ai/session';

export interface RawResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  published_at?: string | null;
  score?: number;
  provider: SearchProviderId | 'fixture';
  query: string;
  source_type: SourceType;
  extra?: Record<string, any>;
}

export interface SearchProviderMeta {
  id: SearchProviderId;
  label: string;
  blurb: string;
  keys_url: string;
  docs_url: string;
  defaultEndpoint: string;
  supportsDateFilter: boolean;
  costNote: string;
  /** Whether the provider answers a browser fetch() from a third-party origin.
   *  Measured, not assumed — see BROWSER_CORS_NOTE below. When false the call
   *  is blocked by the provider before your key is even validated, so the
   *  no-backend architecture needs a proxy for it. */
  browserDirect: boolean;
  /** Extra line shown in the picker when browserDirect is false. */
  proxyNote?: string;
  /** True when the provider needs no credential at all: it reads open,
   *  CORS-enabled public datasets. Verified from a browser origin, and the
   *  reason a single AI key is enough to run a full discovery. */
  keyless?: boolean;
}

/* Empirically verified from a real browser origin (Chromium, 2026-09):
     OpenRouter 200 + readable body      -> direct calls fine
     Groq       401 + readable JSON      -> CORS fine, only the key was fake
     Serper     403 + readable JSON      -> CORS fine
     Tavily     TypeError: Failed to fetch   -> no CORS headers, always blocked
     Exa        TypeError: Failed to fetch   -> no CORS headers, always blocked
   A blocked call fails before the API key is checked, so this is a property of
   the provider, not of the user's key or network. */
export const BROWSER_CORS_NOTE = 'No CORS headers: a browser cannot call this API directly.';

export const SEARCH_PROVIDERS: SearchProviderMeta[] = [
  {
    id: 'community',
    label: 'Public discussion data',
    browserDirect: true,
    keyless: true,
    blurb:
      'Free and keyless. Reads Hacker News, Stack Overflow, GitHub Issues and DEV directly — real posts, real URLs, real timestamps.',
    keys_url: '',
    docs_url: '',
    defaultEndpoint: '',
    supportsDateFilter: true,
    costNote:
      'Free, no key and no account. Rate-limited, so a commercial search key is a worthwhile upgrade when you want broader commercial coverage.',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    browserDirect: false,
    proxyNote: 'Tavily sends no CORS headers, so a browser call is blocked before your key is checked — this provider needs a proxy URL below.',
    blurb: 'Search API built for AI agents. Returns extracted page content and best-effort publish dates.',
    keys_url: 'https://app.tavily.com',
    docs_url: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
    defaultEndpoint: 'https://api.tavily.com/search',
    supportsDateFilter: true,
    costNote: 'Free monthly credit allowance, then paid per search.',
  },
  {
    id: 'serper',
    label: 'Serper.dev',
    browserDirect: true,
    blurb: 'Google SERPs as JSON — organic results, People Also Ask and related searches.',
    keys_url: 'https://serper.dev',
    docs_url: 'https://serper.dev/docs',
    defaultEndpoint: 'https://google.serper.dev/search',
    supportsDateFilter: true,
    costNote: '2,500 free queries on signup, then credit packs.',
  },
  {
    id: 'exa',
    label: 'Exa',
    browserDirect: false,
    proxyNote: 'Exa sends no CORS headers, so a browser call is blocked before your key is checked — this provider needs a proxy URL below.',
    blurb: 'Neural/semantic web search with page text and publish dates.',
    keys_url: 'https://dashboard.exa.ai',
    docs_url: 'https://docs.exa.ai/reference/search',
    defaultEndpoint: 'https://api.exa.ai/search',
    supportsDateFilter: true,
    costNote: 'Pay-per-search pricing with a free starter credit.',
  },
  {
    id: 'none',
    label: 'None — plan only, no live sources',
    browserDirect: false,
    blurb: 'Runs in degraded mode: the model may only structure your own input, never claim current market demand.',
    keys_url: '',
    docs_url: '',
    defaultEndpoint: '',
    supportsDateFilter: false,
    costNote: 'Free — but opportunity discovery is disabled.',
  },
];

function proxyWrap(proxy: string | undefined, endpoint: string) {
  if (!proxy) return endpoint;
  const p = proxy.trim();
  if (!p) return endpoint;
  if (p.includes('{url}')) return p.replace('{url}', encodeURIComponent(endpoint));
  return `${p}${p.includes('?') ? '' : ''}${encodeURIComponent(endpoint)}`;
}

function guardNetwork(e: any, label: string, providerId: SearchProviderId): AppError {
  if (e?.code) return e as AppError;
  if (isCorsOrNetworkFailure(e)) {
    const meta = SEARCH_PROVIDERS.find((m) => m.id === providerId);
    if (meta && meta.browserDirect === false) {
      return err(
        'cors_or_network',
        `${label} does not allow direct browser requests (no CORS headers), so it was blocked before your API key was even checked. Add a CORS proxy URL in Settings → Intelligence sources, or switch to Serper.dev, which works directly.`,
        { retryable: true },
      );
    }
    return err('cors_or_network', `${label} could not be reached from this browser. Check your network/ad-blocker, or set an optional CORS proxy in Settings → Intelligence sources.`, { retryable: true });
  }
  return err('search_api_failure', e?.message ?? `${label} request failed.`);
}

/* -------------------------------- Tavily ------------------------------ */

async function tavilySearch(cfg: SearchProviderConfig, key: string, query: string, opts: SearchOptions): Promise<RawResult[]> {
  const endpoint = proxyWrap(cfg.proxy, 'https://api.tavily.com/search');
  const body: Record<string, any> = {
    query,
    search_depth: opts.depth === 'deep' ? 'advanced' : 'basic',
    max_results: opts.max_results,
    include_answer: false,
    include_published_date: true,
    include_raw_content: false,
    chunks_per_source: 3,
  };
  if (opts.topic === 'news') body.topic = 'news';
  if (opts.freshness_days <= 7) body.time_range = 'week';
  else if (opts.freshness_days <= 31) body.time_range = 'month';
  else if (opts.freshness_days <= 366) body.time_range = 'year';

  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }), 45000, 'Tavily search');
  if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), 'tavily');
  const json = await res.json();
  const rows: any[] = json?.results ?? [];
  return rows.map((r) => ({
    title: r.title ?? r.url,
    url: r.url,
    snippet: (r.content ?? '').slice(0, 1200),
    content: (r.content ?? '').slice(0, 2400),
    published_at: r.published_date ?? null,
    score: typeof r.score === 'number' ? r.score : undefined,
    provider: 'tavily' as const,
    query,
    source_type: (opts.topic === 'news' ? 'news' : 'search_result') as SourceType,
  }));
}

/* -------------------------------- Serper ------------------------------ */

async function serperSearch(cfg: SearchProviderConfig, key: string, query: string, opts: SearchOptions): Promise<RawResult[]> {
  const newsPath = opts.topic === 'news';
  const endpoint = proxyWrap(cfg.proxy, newsPath ? 'https://google.serper.dev/news' : 'https://google.serper.dev/search');
  const body: Record<string, any> = { q: query, num: opts.max_results };
  if (opts.gl) body.gl = opts.gl;
  if (opts.hl) body.hl = opts.hl;
  if (opts.freshness_days <= 7) body.tbs = 'qdr:w';
  else if (opts.freshness_days <= 31) body.tbs = 'qdr:m';
  else if (opts.freshness_days <= 366) body.tbs = 'qdr:y';

  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify(body),
  }), 45000, 'Serper search');
  if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), 'serper');
  const json = await res.json();
  const out: RawResult[] = [];
  (json?.organic ?? json?.news ?? []).forEach((r: any) => {
    if (!r?.link) return;
    out.push({
      title: r.title ?? r.link,
      url: r.link,
      snippet: (r.snippet ?? r.description ?? '').slice(0, 1200),
      content: (r.snippet ?? '').slice(0, 1800),
      published_at: r.date ?? null,
      provider: 'serper',
      query,
      source_type: newsPath ? 'news' : 'search_result',
      extra: { position: r.position },
    });
  });
  // People Also Ask are literal questions people typed — strong problem signals with real URLs.
  (json?.peopleAlsoAsk ?? []).forEach((r: any) => {
    if (!r?.link) return;
    out.push({
      title: r.question ?? r.title ?? r.link,
      url: r.link,
      snippet: (r.snippet ?? r.answer ?? '').slice(0, 1000),
      content: (r.snippet ?? '').slice(0, 1400),
      published_at: null,
      provider: 'serper',
      query,
      source_type: 'forum',
      extra: { peopleAlsoAsk: true, question: r.question },
    });
  });
  return out;
}


/* ------------------------ keyless public data -------------------------
   One AI key should be enough. These datasets are open, CORS-enabled and
   carry real timestamps, which is what the scoring engine actually needs:
   a URL, a title, a date and a retrieval time for every claim. Measured
   from a browser origin (Chromium, 2026-09): all return
   `access-control-allow-origin`. Reddit returns 403 with no CORS header and
   is deliberately absent.

   Three constraints shape this code, all measured rather than assumed:
   1. These are keyword-AND indexes, not semantic search. The natural-language
      queries the commercial providers accept return zero hits here
      ("freelancers struggling to get clients" -> 0 results on HN and GitHub),
      so every query is reduced to its strongest content words first.
   2. They are rate-limited. GitHub allows 10 unauthenticated searches per
      minute, Stack Exchange 300 per day. A 24-query run would trip both, so
      each source has a per-run budget and a minimum spacing between calls.
   3. A source that is out of budget, throttled or unhappy returns nothing.
      That is normal and must never fail the run — partial evidence is still
      evidence.                                                           */

const KEYLESS_TIMEOUT = 18000;

/** Per-run call budgets and spacing, sized to each API's published limits. */
const KEYLESS_BUDGET: Record<string, { max: number; minIntervalMs: number }> = {
  hn: { max: 40, minIntervalMs: 250 },
  stackexchange: { max: 10, minIntervalMs: 500 },
  github: { max: 8, minIntervalMs: 6500 }, // 10/min unauthenticated
  dev: { max: 10, minIntervalMs: 500 },
};
const spent: Record<string, number> = {};
const lastCall: Record<string, number> = {};

/** Called at the start of every run so budgets refill. */
export function resetKeylessBudget() {
  for (const k of Object.keys(KEYLESS_BUDGET)) {
    spent[k] = 0;
    lastCall[k] = 0;
  }
}

function budgetAvailable(src: string): boolean {
  const b = KEYLESS_BUDGET[src];
  if (!b) return false;
  return (spent[src] ?? 0) < b.max;
}

/** Serialises a source and spaces its calls out. */
async function politely(src: string, fn: () => Promise<RawResult[]>): Promise<RawResult[]> {
  if (!budgetAvailable(src)) return [];
  const gap = KEYLESS_BUDGET[src].minIntervalMs;
  const wait = Math.max(0, (lastCall[src] ?? 0) + gap - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  spent[src] = (spent[src] ?? 0) + 1;
  lastCall[src] = Date.now();
  return fn();
}

const STOP = new Set(['how', 'to', 'the', 'a', 'an', 'for', 'and', 'or', 'of', 'in', 'on', 'my', 'i', 'is', 'are', 'with', 'without', 'not', 'can', 'cannot', 'you', 'your', 'best', 'way', 'getting', 'get', 'help', 'need', 'want', 'why', 'what', 'when', 'who', 'that', 'this', 'it', 'me', 'do', 'does', 'they', 'their', 'from', 'about', 'into', 'out', 'so', 'but', 'if', 'as', 'at', 'be', 'been', 'has', 'have', 'was', 'were', 'will', 'would', 'should', 'could', 'more', 'most', 'much', 'very', 'just', 'really']);
/** Pain verbs describe the symptom, not the topic — they only narrow matches. */
const PAIN = new Set(['struggl', 'struggling', 'struggle', 'frustrat', 'frustrated', 'frustrating', 'difficult', 'difficulty', 'hard', 'problem', 'problems', 'issue', 'issues', 'stuck', 'overwhelm', 'overwhelmed', 'failing', 'fails', 'fail', 'hate', 'confus', 'confused', 'confusing', 'waste', 'wasting', 'expensive', 'scam', 'disappoint', 'disappointed', 'annoy', 'annoying', 'anyone', 'advice', 'trying', 'try', 'losing', 'lost', 'cannot', 'cant', 'unable']);

/** Reduce a natural-language query to the content words these APIs index on. */
export function keylessKeywords(query: string, max = 3): string {
  const words = (query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP.has(w) && !PAIN.has(w) && w.length > 2);
  if (!words.length) return (query || '').trim().slice(0, 60);
  // Preserve original order but keep the most distinctive terms: longer words
  // are the specific ones ("freelancers", "acquisition"), short ones are generic.
  const scored = words.map((w, i) => ({ w, i, s: w.length + (i === 0 ? 1.5 : 0) }));
  const kept = scored.sort((a, b) => b.s - a.s).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.w);
  // Two terms is the sweet spot: three or more almost always returns nothing.
  return kept.slice(0, 2).join(' ') || kept[0] || '';
}

async function getJson(url: string, label: string): Promise<any> {
  const res = await withTimeout(fetch(url, { headers: { Accept: 'application/json' } }), KEYLESS_TIMEOUT, label);
  if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), 'community');
  return res.json();
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'",
  '&#x2F;': '/', '&#47;': '/', '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’',
};

/** Strip markup and decode the entities these APIs actually emit, so titles
 *  reach the evidence table as readable text rather than `&#x2F;`. */
function stripTags(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x?[0-9a-fA-F]+;|&[a-zA-Z]+;/g, (m) => ENTITIES[m.toLowerCase()] ?? ENTITIES[m] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Hacker News — stories and comments. Comments carry raw pain language
   ("I still can't get clients…"), the strongest problem signal available
   without a paid key. */
async function hnSearch(kw: string, kind: 'story' | 'comment', limit: number, from: number): Promise<RawResult[]> {
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw)}` +
    `&tags=${kind}&hitsPerPage=${Math.min(50, limit)}` +
    `&numericFilters=created_at_i%3E${from}`;
  const json = await getJson(url, 'Hacker News');
  return (json?.hits ?? [])
    .map((h: any): RawResult | null => {
      const text = stripTags(h.story_text ?? h.comment_text ?? '');
      if (!h.title && !text) return null;
      // Ask HN posts have no outbound URL; point at the discussion itself.
      const link = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`;
      return {
        title: h.title ?? text.slice(0, 90),
        url: link,
        snippet: (text || h.title || '').slice(0, 1200),
        content: text.slice(0, 2400),
        published_at: h.created_at ?? null,
        score: typeof h.points === 'number' ? h.points : undefined,
        provider: 'community' as const,
        query: kw,
        source_type: 'forum' as const,
        extra: { points: h.points ?? 0, comments: h.num_comments ?? 0, hn_kind: kind, keyword_query: kw },
      };
    })
    .filter(Boolean) as RawResult[];
}

/* Stack Exchange — literal questions people typed, with scores and answer
   counts. Many views with no accepted answer is an unmet need. */
async function stackExchangeSearch(kw: string, limit: number, from: number): Promise<RawResult[]> {
  const url =
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance` +
    `&q=${encodeURIComponent(kw)}&site=stackoverflow&pagesize=${Math.min(25, limit)}` +
    `&fromdate=${from}&filter=withbody`;
  const json = await getJson(url, 'Stack Overflow');
  return (json?.items ?? []).map((i: any): RawResult => ({
    title: i.title ?? i.link,
    url: i.link,
    snippet: stripTags(i.body).slice(0, 1200),
    content: stripTags(i.body).slice(0, 2400),
    published_at: i.creation_date ? new Date(i.creation_date * 1000).toISOString() : null,
    score: i.score,
    provider: 'community' as const,
    query: kw,
    source_type: 'forum' as const,
    extra: { answers: i.answer_count ?? 0, views: i.view_count ?? 0, accepted: Boolean(i.is_answered), keyword_query: kw },
  }));
}

/* GitHub Issues — an open issue is an explicitly unmet need, and reaction
   counts measure how many people share it. */
async function githubSearch(kw: string, limit: number, from: number): Promise<RawResult[]> {
  const since = new Date(from * 1000).toISOString().slice(0, 10);
  const url =
    `https://api.github.com/search/issues?q=${encodeURIComponent(kw)}+created:%3E${since}` +
    `&sort=reactions&order=desc&per_page=${Math.min(20, limit)}`;
  const json = await getJson(url, 'GitHub');
  return (json?.items ?? []).map((i: any): RawResult => ({
    title: i.title ?? i.html_url,
    url: i.html_url,
    snippet: String(i.body ?? '').replace(/\s+/g, ' ').slice(0, 1200),
    content: String(i.body ?? '').slice(0, 2400),
    published_at: i.created_at ?? null,
    score: i.reactions?.total_count,
    provider: 'community' as const,
    query: kw,
    source_type: 'forum' as const,
    extra: { comments: i.comments ?? 0, state: i.state, keyword_query: kw },
  }));
}

/* DEV — practitioner write-ups, tag-driven because the public API has no
   search endpoint. A miss here is harmless; the others still answer. */
async function devSearch(kw: string, limit: number): Promise<RawResult[]> {
  const tag = (kw.match(/[a-z][a-z0-9+-]{2,}/g) ?? []).sort((a, b) => b.length - a.length)[0];
  if (!tag) return [];
  const json = await getJson(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=${Math.min(20, limit)}`, 'DEV');
  return (json ?? []).map((a: any): RawResult => ({
    title: a.title ?? a.url,
    url: a.url,
    snippet: String(a.description ?? '').slice(0, 1200),
    content: String(a.description ?? '').slice(0, 2000),
    published_at: a.published_at ?? null,
    score: a.positive_reactions_count,
    provider: 'community' as const,
    query: kw,
    source_type: 'forum' as const,
    extra: { reactions: a.positive_reactions_count ?? 0, comments: a.comments_count ?? 0, tag, keyword_query: kw },
  }));
}

/** Keyless fan-out. Partial failure is normal and must never kill a run:
 *  one source answering is usable, four answering is a good haul. */
async function communitySearch(query: string, opts: SearchOptions): Promise<RawResult[]> {
  const from = Math.floor((Date.now() - (opts.freshness_days > 0 ? opts.freshness_days : 90) * 86400000) / 1000);
  const per = Math.max(3, Math.ceil(opts.max_results / 2));
  const kw = keylessKeywords(query);
  if (!kw) return [];

  const settled = await Promise.allSettled([
    politely('hn', () => hnSearch(kw, 'story', per, from)),
    politely('hn', () => hnSearch(kw, 'comment', per, from)),
    politely('stackexchange', () => stackExchangeSearch(kw, per, from)),
    politely('github', () => githubSearch(kw, per, from)),
    politely('dev', () => devSearch(kw, per)),
  ]);
  const terms = kw.split(/\s+/).filter((t) => t.length > 3);
  const rows = settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    /* Keyword-AND matching guarantees the words appeared somewhere in the
       document, but a comment thread can match on an incidental word and land
       far off-topic ("clients" inside an unrelated job post). Keep only results
       where a term is visible in the text we would cite — the last cheap
       precision filter before the scoring engine sees them. */
    .filter((r) => {
      if (!terms.length) return true;
      const hay = `${r.title} ${r.snippet}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  // Budget exhaustion is a legitimate quiet outcome, not an error.
  const anyBudget = Object.keys(KEYLESS_BUDGET).some((k) => budgetAvailable(k));
  if (!rows.length && !anyBudget) return [];
  if (!rows.length) {
    const first = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (first?.reason && !isCorsOrNetworkFailure(first.reason)) throw first.reason;
  }
  return rows;
}

/* --------------------------------- Exa -------------------------------- */

async function exaSearch(cfg: SearchProviderConfig, key: string, query: string, opts: SearchOptions): Promise<RawResult[]> {
  const endpoint = proxyWrap(cfg.proxy, 'https://api.exa.ai/search');
  const body: Record<string, any> = {
    query,
    numResults: opts.max_results,
    type: 'auto',
    contents: { text: { maxCharacters: 1400 } },
  };
  if (opts.freshness_days && opts.freshness_days < 3650) {
    body.startPublishedDate = new Date(Date.now() - opts.freshness_days * 86400000).toISOString();
  }
  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body),
  }), 45000, 'Exa search');
  if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''), 'exa');
  const json = await res.json();
  const rows: any[] = json?.results ?? [];
  return rows.map((r) => ({
    title: r.title ?? r.url,
    url: r.url,
    snippet: (r.text ?? '').slice(0, 1200),
    content: (r.text ?? '').slice(0, 2400),
    published_at: r.publishedDate ?? null,
    score: typeof r.score === 'number' ? r.score : undefined,
    provider: 'exa' as const,
    query,
    source_type: 'search_result' as SourceType,
  }));
}

/* ------------------------------ public API ---------------------------- */

export interface SearchOptions {
  max_results: number;
  freshness_days: number;
  topic?: 'general' | 'news';
  gl?: string;
  hl?: string;
  depth?: 'basic' | 'deep';
}

export function searchProviderReady(cfg: SearchProviderConfig | null | undefined): {
  ready: boolean;
  reason: string;
  /** Short, human label for badges and buttons — never internal ids. */
  label: string;
} {
  const meta = SEARCH_PROVIDERS.find((p) => p.id === cfg?.id);
  if (meta?.keyless) {
    return { ready: true, reason: '', label: meta.label };
  }
  /* Never configured at all (older installs, or a cleared store): fall back to
     the keyless datasets rather than blocking. Only an explicit "none" means
     the user wants no external evidence. */
  if (!cfg) {
    const fallback = SEARCH_PROVIDERS.find((p) => p.keyless);
    return { ready: true, reason: '', label: fallback?.label ?? 'Public discussion data' };
  }
  if (cfg.id === 'none' || !cfg.enabled) {
    return {
      ready: false,
      label: 'No evidence source',
      reason: 'CreatorTools reads live pages and posts to find real demand. Without a search key it will not label anything a trend — that rule is deliberate, so it needs one key to work.',
    };
  }
  if (!getCredential(cfg.id as 'tavily' | 'serper' | 'exa')) {
    return {
      ready: false,
      label: `${meta?.label ?? 'Search'} key needed`,
      reason: `CreatorTools reads live pages and posts to find real demand. Add your ${meta?.label ?? 'search'} key and it can start looking — the key stays in this browser session and is never stored.`,
    };
  }
  return { ready: true, reason: '', label: meta?.label ?? 'Search' };
}

export async function runSearch(cfg: SearchProviderConfig, query: string, opts: SearchOptions): Promise<RawResult[]> {
  const provider = cfg ?? ({ id: 'community', enabled: true } as SearchProviderConfig);
  cfg = provider;
  if (cfg.id === 'community') {
    try {
      return await communitySearch(query, opts);
    } catch (e: any) {
      throw guardNetwork(e, 'Public discussion data', cfg.id);
    }
  }
  const key = getCredential(cfg.id as 'tavily' | 'serper' | 'exa');
  if (!key) throw err('search_api_failure', `No ${cfg.id} API key in this session.`);
  try {
    if (cfg.id === 'tavily') return await tavilySearch(cfg, key, query, opts);
    if (cfg.id === 'serper') return await serperSearch(cfg, key, query, opts);
    if (cfg.id === 'exa') return await exaSearch(cfg, key, query, opts);
    throw err('search_api_failure', 'Unknown search provider.');
  } catch (e: any) {
    throw guardNetwork(e, SEARCH_PROVIDERS.find((p) => p.id === cfg.id)?.label ?? 'Search provider', cfg.id);
  }
}

export async function testSearchProvider(cfg: SearchProviderConfig): Promise<{ ok: boolean; ms: number; sample: RawResult[]; error?: string }> {
  const started = performance.now();
  try {
    const rows = await runSearch(cfg, 'freelancers struggling to get clients 2026', { max_results: 3, freshness_days: 90 });
    return { ok: true, ms: Math.round(performance.now() - started), sample: rows.slice(0, 3) };
  } catch (e: any) {
    return { ok: false, ms: Math.round(performance.now() - started), sample: [], error: e?.message ?? 'Search test failed.' };
  }
}

/** Parses a user-pasted search payload — used by the fixture importer and tests. */
export function parseSearchPayload(raw: string): RawResult[] {
  const json = safeJsonParse<any>(raw);
  if (!json) return [];
  const rows = json.results ?? json.organic ?? [];
  return rows.map((r: any) => ({
    title: r.title ?? r.url ?? '',
    url: r.url ?? r.link ?? '',
    snippet: r.snippet ?? r.content ?? r.description ?? '',
    published_at: r.published_at ?? r.publishedDate ?? r.date ?? null,
    provider: 'fixture' as const,
    query: json.query ?? '',
    source_type: 'search_result' as SourceType,
  })).filter((r) => r.url);
}
