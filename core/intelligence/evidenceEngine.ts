/* ------------------------------------------------------------------
   Evidence engine — deterministic. This module owns everything that
   must NOT be left to a language model: deduplication, freshness,
   source reliability, independence clustering and evidence weighting.
   ------------------------------------------------------------------ */
import type { AudienceProfile, Evidence, ID, QuerySpec, QueryType, SourceType, SignalType } from '../types';
import {
  ageDays, canonicalUrl, directnessScore, domainOf, freshnessScore, hash as hashStr,
  inferSourceType, keywordSet, mapLimit, overlapCoefficient, painMarkerHits, round1,
  sourceReliability, tokenize,
} from '../lib/utils';
import type { RawResult } from './searchProviders';

export interface RawEvidenceInput {
  result: RawResult;
  query: string;
  query_type: QueryType | 'validation';
}

/* ------------------------- signal-hint detection ---------------------- */

const HINT_RULES: { type: SignalType; patterns: RegExp }[] = [
  { type: 'purchase_intent', patterns: /\b(buy|price|pricing|cost|paid|course|template|hire|freelancer|agency|subscription|worth it|budget|invest in|afford)\b/i },
  { type: 'complaint', patterns: /\b(complaint|scam|terrible|worst|hate|refund|cancel(l)?ed|disappointed|ripped off|not worth)\b/i },
  { type: 'pain', patterns: /\b(struggl\w*|frustrat\w*|overwhelm\w*|stress\w*|burn(t|ed) out|stuck|anxious|exhaust\w*|shame\w*|embarrass\w*)\b/i },
  { type: 'question', patterns: /\?|how (do|can|to)\b|why (does|do|can't|is)\b|what is the best\b/i },
  { type: 'trend', patterns: /\b(2025|2026|this year|recently|new|emerging|growing|surge|boom|shift|trend|latest)\b/i },
  { type: 'growth', patterns: /\b(growth|grew|increase[ds]?|up \d+%|double[ds]?|rising|demand for)\b/i },
  { type: 'competitor', patterns: /\b(vs\.?|alternative to|competitor|better than|instead of|replace)\b/i },
  { type: 'market_gap', patterns: /\b(no (good|real|actual)|nothing (out there|available)|gap|underserved|hard to find|doesn'?t exist|lacking)\b/i },
  { type: 'content_demand', patterns: /\b(views|watch|tutorial|explained|guide|walkthrough|checklist)\b/i },
  { type: 'urgency', patterns: /\b(asap|urgent|deadline|right now|immediately|need (this|it) (now|today))\b/i },
];

export function detectSignalHints(text: string): SignalType[] {
  const t = (text || '').slice(0, 3000);
  const out = new Set<SignalType>();
  HINT_RULES.forEach((rule) => { if (rule.patterns.test(t)) out.add(rule.type); });
  if (/\b(still can'?t|not working|doesn'?t work|failed|tried everything)\b/i.test(t)) out.add('solution_failure');
  if (/\b(need to|have to|must|want to)\b/i.test(t)) out.add('desire' as SignalType);
  return [...out];
}

/* --------------------------- normalization ---------------------------- */

const STOP_DOMAINS = ['pinterest.com', 'quora.com/widgets', 'play.google.com', 'apps.apple.com'];

export function normalizeEvidence(
  runId: ID,
  inputs: RawEvidenceInput[],
  audience: AudienceProfile,
): { evidence: Evidence[]; dropped: { reason: string; count: number }[] } {
  const dropped = new Map<string, number>();
  const bump = (reason: string) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);

  const seenCanonical = new Map<string, Evidence>();
  const seenHash = new Map<string, Evidence>();
  const audienceKeywords = new Set([
    ...tokenize(audience.interests.join(' ')),
    ...tokenize(audience.location),
    ...tokenize(audience.business_type),
    ...tokenize(audience.employment_status),
  ]);

  const evidence: Evidence[] = [];

  inputs.forEach(({ result, query, query_type }) => {
    if (!result?.url || !/^https?:\/\//i.test(result.url)) { bump('invalid url'); return; }
    const canonical = canonicalUrl(result.url);
    const domain = domainOf(result.url);
    if (!domain) { bump('invalid url'); return; }
    if (STOP_DOMAINS.some((d) => domain.endsWith(d))) { bump('low-signal domain'); return; }

    const title = (result.title ?? '').trim();
    const snippet = (result.snippet ?? '').trim();
    const content = (result.content ?? snippet).trim();
    if (!title && !snippet) { bump('empty result'); return; }
    if (`${title}${snippet}`.length < 40) { bump('too little text'); return; }

    const contentHash = hashStr(`${title.toLowerCase().slice(0, 120)}|${tokenize(`${title} ${snippet}`).slice(0, 14).join(' ')}`);
    if (seenHash.has(contentHash)) {
      const original = seenHash.get(contentHash)!;
      bump('duplicate content');
      // Keep the more recent/complete copy only.
      if ((result.snippet?.length ?? 0) > original.content.length) {
        original.content = content.slice(0, 2400);
        original.snippet = snippet.slice(0, 1200);
      }
      return;
    }

    const sourceType: SourceType = (result.source_type as SourceType) ?? inferSourceType(result.url, result.provider);
    const reliability = sourceReliability(domain, sourceType);
    const published = result.published_at ? new Date(result.published_at) : null;
    const fresh = freshnessScore(published && !Number.isNaN(published.getTime()) ? published : null);
    const hints = detectSignalHints(`${title} ${snippet} ${content}`);
    const text = `${title} ${snippet}`.toLowerCase();
    const audienceHit = [...audienceKeywords].filter((k) => k.length > 3 && text.includes(k)).length;
    const providerScore = typeof result.score === 'number' ? Math.max(0, Math.min(1, result.score)) : 0.55;
    const relevance = Math.max(0.15, Math.min(1, providerScore * 0.6 + Math.min(1, audienceHit / 3) * 0.2 + Math.min(1, painMarkerHits(text) / 4) * 0.2));
    const direct = result.source_type === 'forum' || (result.extra?.peopleAlsoAsk ? 1 : directnessScore(title, snippet, content, hints as string[]));

    if (published && published > new Date()) { /* future-dated: treat as unknown */ }

    const ev: Evidence = {
      id: `ev_${hashStr(canonical + query).slice(0, 10)}`,
      research_run_id: runId,
      query,
      query_type,
      provider: result.provider,
      source_url: result.url,
      canonical_url: canonical,
      domain,
      title: title || domain,
      snippet: snippet.slice(0, 1200),
      content: content.slice(0, 2400),
      author: null,
      published_at: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      retrieved_at: new Date().toISOString(),
      source_type: sourceType,
      source_reliability: reliability,
      relevance_score: Math.round((relevance as number) * 1000) / 1000,
      directness_score: Math.round((direct as number) * 1000) / 1000,
      freshness_score: fresh,
      independence_score: 1,
      evidence_weight: 0,
      importance_weight: 0,
      age_days: ageDays(published),
      content_hash: contentHash,
      duplicate_of: null,
      signal_hints: hints,
    };

    if (seenCanonical.has(canonical)) { bump('duplicate url'); return; }
    seenCanonical.set(canonical, ev);
    seenHash.set(contentHash, ev);
    evidence.push(ev);
  });

  /* --- independence: collapse syndicated copies into clusters --- */
  applyIndependence(evidence);
  evidence.forEach(computeWeights);

  return { evidence, dropped: [...dropped.entries()].map(([reason, count]) => ({ reason, count })) };
}

/** Syndication clusters: same domain OR near-identical text from different domains. */
function applyIndependence(evidence: Evidence[]): void {
  const clusters: Evidence[][] = [];
  evidence.forEach((ev) => {
    const setA = new Set(tokenize(`${ev.title} ${ev.snippet}`).slice(0, 40));
    const home = clusters.find((cluster) => cluster.some((other) => {
      if (other.domain === ev.domain) return true;
      const setB = new Set(tokenize(`${other.title} ${other.snippet}`).slice(0, 40));
      return overlapCoefficient(setA, setB) > 0.72;
    }));
    if (home) home.push(ev); else clusters.push([ev]);
  });
  clusters.forEach((cluster) => {
    const size = cluster.length;
    // One source repeated ten times is not ten independent signals.
    const independence = size <= 1 ? 1 : 1 / Math.sqrt(size);
    cluster.forEach((ev) => {
      ev.independence_score = round1(independence * 100) / 100;
      if (size > 1) ev.duplicate_of = 'cluster:' + hashStr(cluster.map((c) => c.id).sort().join(''));
    });
  });
}

export const EVIDENCE_WEIGHT_COMPONENTS = {
  source_reliability: 0.25,
  freshness: 0.20,
  relevance: 0.25,
  directness: 0.15,
  independence: 0.15,
};

export function computeWeights(ev: Evidence): void {
  const product =
    ev.source_reliability * ev.freshness_score * ev.relevance_score * ev.directness_score * Math.max(0.2, ev.independence_score);
  ev.evidence_weight = round1(product * 1000) / 1000;
  ev.importance_weight = round1(
    (ev.source_reliability * EVIDENCE_WEIGHT_COMPONENTS.source_reliability +
      ev.freshness_score * EVIDENCE_WEIGHT_COMPONENTS.freshness +
      ev.relevance_score * EVIDENCE_WEIGHT_COMPONENTS.relevance +
      ev.directness_score * EVIDENCE_WEIGHT_COMPONENTS.directness +
      Math.max(0.2, ev.independence_score) * EVIDENCE_WEIGHT_COMPONENTS.independence) * 1000,
  ) / 1000;
}

/* ---------------------------- evidence stats -------------------------- */

export interface EvidenceStats {
  total: number;
  independent_domains: number;
  independent_clusters: number;
  recent_30: number;
  recent_90: number;
  older_than_90: number;
  unknown_date: number;
  direct_signals: number;
  avg_reliability: number;
  avg_freshness: number;
  avg_relevance: number;
  avg_directness: number;
  avg_independence: number;
  consistency: number;
  by_source_type: Record<string, number>;
}

export function evidenceStats(rows: Evidence[]): EvidenceStats {
  const domains = new Set(rows.map((r) => r.domain));
  const clusters = new Set(rows.map((r) => r.duplicate_of ?? r.id));
  const recent30 = rows.filter((r) => r.age_days !== null && r.age_days <= 30).length;
  const recent90 = rows.filter((r) => r.age_days !== null && r.age_days <= 90).length;
  const older = rows.filter((r) => r.age_days !== null && r.age_days > 90).length;
  const unknown = rows.filter((r) => r.age_days === null).length;
  const direct = rows.filter((r) => r.directness_score >= 0.6 && r.duplicate_of === null).length;
  const avg = (pick: (e: Evidence) => number) => (rows.length ? rows.reduce((s, r) => s + pick(r), 0) / rows.length : 0);
  const byType: Record<string, number> = {};
  rows.forEach((r) => { byType[r.source_type] = (byType[r.source_type] ?? 0) + 1; });
  return {
    total: rows.length,
    independent_domains: domains.size,
    independent_clusters: clusters.size,
    recent_30: recent30,
    recent_90: recent90,
    older_than_90: older,
    unknown_date: unknown,
    direct_signals: direct,
    avg_reliability: avg((r) => r.source_reliability),
    avg_freshness: avg((r) => r.freshness_score),
    avg_relevance: avg((r) => r.relevance_score),
    avg_directness: avg((r) => r.directness_score),
    avg_independence: avg((r) => Math.max(0.2, r.independence_score)),
    consistency: 0,
    by_source_type: byType,
  };
}

/** Keyword overlap between two evidence sets — a proxy for cross-source agreement. */
export function crossSourceConsistency(a: Evidence[], b: Evidence[]): number {
  if (!a.length || !b.length) return 0;
  const ka = keywordSet(a.map((e) => `${e.title} ${e.snippet}`).join(' '));
  const kb = keywordSet(b.map((e) => `${e.title} ${e.snippet}`).join(' '));
  return overlapCoefficient(ka, kb);
}

/** Cheap lexical ranking used to pick the most relevant evidence for a prompt. */
export function rankEvidence(rows: Evidence[], focus: string, n: number): Evidence[] {
  const focusTokens = new Set(tokenize(focus));
  return [...rows]
    .map((ev) => {
      const overlap = overlapCoefficient(keywordSet(`${ev.title} ${ev.snippet} ${ev.content}`), focusTokens);
      return { ev, s: overlap * 0.55 + ev.importance_weight * 0.35 + Math.min(1, ev.age_days !== null && ev.age_days <= 90 ? 1 : 0.4) * 0.1 };
    })
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.ev);
}

/** Compact evidence block for prompts — ids must survive verbatim. */
export function evidencePromptBlock(rows: Evidence[], opts: { maxChars?: number; includeContent?: boolean } = {}): string {
  const maxChars = opts.maxChars ?? 14000;
  let out = '';
  for (const ev of rows) {
    const chunk = [
      `[${ev.id}] ${ev.title}`,
      `  domain: ${ev.domain} | type: ${ev.source_type} | published: ${ev.published_at ?? 'unknown'} | age_days: ${ev.age_days ?? 'unknown'} | reliability: ${ev.source_reliability.toFixed(2)} | freshness: ${ev.freshness_score.toFixed(2)} | independence: ${ev.independence_score.toFixed(2)}`,
      `  query: ${ev.query}`,
      `  text: ${(opts.includeContent === false ? ev.snippet : `${ev.snippet} ${ev.content}`).replace(/\s+/g, ' ').slice(0, 900)}`,
      `  url: ${ev.canonical_url}`,
    ].join('\n');
    if (out.length + chunk.length > maxChars) break;
    out += `${chunk}\n\n`;
  }
  return out.trim();
}

export { mapLimit };
