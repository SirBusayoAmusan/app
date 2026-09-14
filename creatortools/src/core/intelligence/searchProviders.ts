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
    label: 'No search provider',
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

export function searchProviderReady(cfg: SearchProviderConfig | null | undefined): { ready: boolean; reason: string } {
  if (!cfg || cfg.id === 'none' || !cfg.enabled) {
    return { ready: false, reason: 'No live search provider is connected. Add a search API key to collect current market evidence.' };
  }
  if (!getCredential(cfg.id as 'tavily' | 'serper' | 'exa')) {
    return { ready: false, reason: `A ${cfg.id} key is required. It is used from this browser session only and is not stored.` };
  }
  return { ready: true, reason: '' };
}

export async function runSearch(cfg: SearchProviderConfig, query: string, opts: SearchOptions): Promise<RawResult[]> {
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
