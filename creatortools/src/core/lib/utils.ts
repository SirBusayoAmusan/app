/* ------------------------------------------------------------------
   Small shared helpers: ids, hashing, text, dates, numbers, safety.
   ------------------------------------------------------------------ */
import type { AppError, SourceType } from '../types';

export const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
export const round1 = (n: number) => Math.round(n * 10) / 10;

export function titleCase(s: string) {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

/** djb2 — stable, dependency-free content hash for duplicate detection. */
export function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const STOPWORDS = new Set(('a an the and or but if then than that this these those of for to in on at by with from as is are was were be been being it its it\'s they them their there here what which who whom whose how why when where do does did doing done can could should would may might must will just not no nor so very too also more most much many any all some each other into over under out up down about after before again further once only own same such own you your yours we our ours i me my mine he she his her him'.split(' ')));

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function keywordSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / Math.min(a.size, b.size);
}

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const strip = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref', 'ref_src', 'si', 's', 'mc_cid', 'mc_eid', 'igshid', 'spm', 'scrlybrkr'];
    strip.forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return `${u.origin}${u.pathname}${u.searchParams.toString() ? `?${u.searchParams}` : ''}`.toLowerCase();
  } catch {
    return (raw || '').toLowerCase();
  }
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function daysBetween(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relTime(iso?: string | null): string {
  const d = parseDate(iso);
  if (!d) return 'date unknown';
  const days = Math.round(daysBetween(d, new Date()));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export const shortDate = (iso?: string | null) => {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

export function fmtNumber(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(n: number | null | undefined, currency = 'USD') {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

export function truncate(text: string, n: number) {
  const t = (text || '').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export function maskKey(key?: string | null) {
  if (!key) return '';
  const k = key.trim();
  if (k.length <= 10) return `${k.slice(0, 2)}••••`;
  return `${k.slice(0, 5)}••••••••${k.slice(-4)}`;
}

export function safeJsonParse<T = any>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch { /* ignore */ }
  }
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try { return JSON.parse(text.slice(firstBracket, lastBracket + 1)) as T; } catch { /* ignore */ }
  }
  return null;
}

export function err(code: AppError['code'], message: string, extra: Partial<AppError> = {}): AppError {
  const retryableCodes: AppError['code'][] = ['rate_limit', 'provider_unavailable', 'timeout', 'cors_or_network', 'unknown'];
  return { code, message, retryable: extra.retryable ?? retryableCodes.includes(code), ...extra };
}

export function mapHttpError(status: number, body: string, provider: string): AppError {
  const clean = (body || '').slice(0, 600);
  if (status === 401 || status === 403) return err('invalid_api_key', 'The provider rejected this API key.', { status, provider, detail: clean });
  if (status === 404) return err('unsupported_model', 'Model or endpoint not found for this provider.', { status, provider, detail: clean });
  if (status === 429) return err('rate_limit', 'Rate limit reached at the provider. Wait a moment and retry.', { status, provider, detail: clean });
  if (status === 400) {
    if (/json_schema|response_format|structured/i.test(clean)) {
      return err('unsupported_structured_output', 'This model does not accept strict JSON schema output.', { status, provider, detail: clean });
    }
    return err('unsupported_model', 'The provider rejected the request body. Check the model name.', { status, provider, detail: clean });
  }
  if (status >= 500) return err('provider_unavailable', 'The provider is currently unavailable.', { status, provider, detail: clean });
  return err('unknown', `Request failed with status ${status}.`, { status, provider, detail: clean });
}

export function isCorsOrNetworkFailure(e: unknown): boolean {
  const msg = (e as Error)?.message ?? String(e);
  return /Failed to fetch|NetworkError|Load failed|ERR_FAILED|CORS/i.test(msg);
}

export function sourceReliability(domain: string, type: SourceType): number {
  const d = (domain || '').toLowerCase();
  if (!d) return 0.4;
  if (/(^|\.)(gov|gov\.[a-z]{2}|mil)(\.|$)/.test(d) || d.endsWith('.gov')) return 1.0;
  if (d.endsWith('.edu') || d.includes('who.int') || d.includes('worldbank.org') || d.includes('oecd.org')) return 0.97;
  if (d.includes('nature.com') || d.includes('sciencedirect') || d.includes('ssrn.com') || d.includes('arxiv.org') || d.includes('jstor')) return 0.95;
  if (d.includes('mckinsey') || d.includes('statista') || d.includes('gartner') || d.includes('nielsen') || d.includes('pewresearch')) return 0.93;
  if (d.includes('reuters') || d.includes('bloomberg') || d.includes('ft.com') || d.includes('bbc.') || d.includes('economist') || d.includes('wsj.') || d.includes('nytimes') || d.includes('apnews') || d.includes('cnbc') || d.includes('forbes') || d.includes('techcrunch')) return 0.88;
  if (d.includes('guim.co') || d.includes('theguardian') || d.includes('wired') || d.includes('fastcompany') || d.includes('hbr.org') || d.includes('businessinsider')) return 0.85;
  if (type === 'reddit' || d.includes('reddit.com')) return 0.72;
  if (d.includes('quora') || d.includes('stackexchange') || d.includes('stackoverflow')) return 0.7;
  if (d.includes('facebook') || d.includes('x.com') || d.includes('twitter') || d.includes('tiktok') || d.includes('instagram') || d.includes('threads')) return 0.6;
  if (type === 'youtube' || d.includes('youtube') || d.includes('youtu.be')) return 0.68;
  if (d.includes('trustpilot') || d.includes('g2.com') || d.includes('capterra') || d.includes('glassdoor')) return 0.75;
  if (d.includes('etsy') || d.includes('gumroad') || d.includes('udemy') || d.includes('skillshare') || d.includes('amazon')) return 0.78;
  if (d.includes('medium.com') || d.includes('substack') || d.includes('wordpress') || d.includes('blogspot') || d.includes('beehiiv')) return 0.62;
  return 0.7;
}

export function inferSourceType(url: string, providerHint?: string): SourceType {
  const d = (url || '').toLowerCase();
  if (providerHint === 'reddit' || d.includes('reddit.com')) return 'reddit';
  if (d.includes('youtube.com') || d.includes('youtu.be')) return 'youtube';
  if (d.includes('news') || d.includes('reuters') || d.includes('bbc') || d.includes('techcrunch')) return 'news';
  if (d.includes('quora') || d.includes('forum') || d.includes('community') || d.includes('stackexchange') || d.includes('discourse')) return 'forum';
  if (d.includes('etsy') || d.includes('gumroad') || d.includes('amazon') || d.includes('udemy') || d.includes('shopify') || d.includes('appsumo')) return 'marketplace';
  if (d.includes('trends.google') || d.includes('semrush') || d.includes('ahrefs') || d.includes('explodingtopics')) return 'trend_data';
  if (d.includes('twitter.com') || d.includes('x.com') || d.includes('linkedin.com') || d.includes('instagram.com') || d.includes('tiktok.com') || d.includes('facebook.com')) return 'social';
  return 'search_result';
}

const PAIN_MARKERS = ['struggl', 'frustrat', 'can\'t', 'cannot', 'hard to', 'difficult', 'problem', 'issue', 'not working', 'no idea', 'overwhelm', 'stuck', 'fail', 'hate', 'confus', 'waste', 'expensive', 'scam', 'disappoint', 'annoy', 'why do', 'help me', 'how do i', 'how to', 'anyone else', 'advice'];

export function painMarkerHits(text: string): number {
  const t = (text || '').toLowerCase();
  return PAIN_MARKERS.reduce((n, m) => (t.includes(m) ? n + 1 : n), 0);
}

export function directnessScore(title: string, snippet: string, content: string, signalHints: string[]): number {
  const combined = `${title} ${snippet} ${content}`.toLowerCase();
  const hits = painMarkerHits(combined);
  let base = Math.min(1, 0.35 + hits * 0.12);
  if (/\?/.test(title)) base += 0.08;
  if (signalHints.some((s) => ['purchase_intent', 'complaint', 'pain', 'problem'].includes(s))) base += 0.08;
  return Math.min(1, base);
}

export function freshnessScore(published: Date | null): number {
  if (!published) return 0.5; // unknown date: usable for context, never a trend claim
  const age = daysBetween(published, new Date());
  if (age <= 30) return 1.0;
  if (age <= 90) return 0.9;
  if (age <= 180) return 0.75;
  if (age <= 365) return 0.55;
  if (age <= 730) return 0.35;
  return 0.2;
}

export function ageDays(published: Date | null): number | null {
  if (!published) return null;
  return Math.round(daysBetween(published, new Date()));
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Request'): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(err('timeout', `${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = e as any;
      }
      done++;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return out;
}
