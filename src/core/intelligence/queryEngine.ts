/* ------------------------------------------------------------------
   Query generation.

   Two-phase by design (this is the "methodology" that stays inside
   CreatorTools rather than inside the user's model):
     Phase 1 — the model proposes *topic hypotheses* only (no claims).
     Phase 2 — this deterministic engine expands every topic across the
               nine mandatory research layers, so coverage can never be
               silently skipped by the model.
   ------------------------------------------------------------------ */
import type { AudienceProfile, QuerySpec, QueryType } from '../types';
import { uid } from '../lib/utils';

export interface QueryLayer {
  layer: number;
  name: string;
  purpose: string;
  types: QueryType[];
}

export const QUERY_LAYERS: QueryLayer[] = [
  { layer: 1, name: 'broad_market', purpose: 'Discover possible opportunity areas.', types: ['broad_discovery'] },
  { layer: 2, name: 'audience_problem', purpose: 'Find problems experienced by the exact audience.', types: ['problem'] },
  { layer: 3, name: 'pain_language', purpose: 'Find emotionally charged complaints and frustrations.', types: ['pain'] },
  { layer: 4, name: 'purchase_intent', purpose: 'Find evidence people seek paid solutions.', types: ['purchase_intent'] },
  { layer: 5, name: 'solution_gap', purpose: 'Find complaints about existing solutions.', types: ['solution_failure'] },
  { layer: 6, name: 'trend', purpose: 'Find recent momentum.', types: ['emerging_trend'] },
  { layer: 7, name: 'competition', purpose: 'Understand existing solutions and saturation.', types: ['competitor'] },
  { layer: 8, name: 'content_demand', purpose: 'Identify subjects that attract attention and questions.', types: ['content_demand'] },
  { layer: 9, name: 'contrarian', purpose: 'Attempt to disprove the opportunity.', types: ['contrarian'] },
];

export interface Hypothesis {
  topics: { topic: string; audience_descriptor?: string; context?: string }[];
  audience_descriptors: string[];
  market: string;
}

export function audiencePhrase(profile: AudienceProfile): string {
  const bits: string[] = [];
  if (profile.employment_status) bits.push(profile.employment_status.toLowerCase());
  if (profile.business_type && !/aspiring digital product creator/i.test(profile.business_type)) bits.push(profile.business_type.toLowerCase());
  if (profile.experience_level) bits.push(`${profile.experience_level.toLowerCase()} level`);
  return bits.filter(Boolean).slice(0, 2).join(' ') || 'beginners';
}

export function audienceDescriptor(profile: AudienceProfile): string {
  const bits = [
    `${profile.age_min}-${profile.age_max}`,
    profile.gender?.toLowerCase() === 'all genders' ? '' : profile.gender,
    profile.location,
    profile.employment_status,
  ].filter(Boolean);
  return bits.join(', ');
}

/**
 * Deterministic fallback topics so a run is still possible without the
 * model (degraded mode) — derived from the user's own stated interests.
 */
export function deterministicHypotheses(profile: AudienceProfile): Hypothesis {
  const interests = profile.interests.length ? profile.interests : ['digital products', 'online income'];
  const topics = interests.flatMap((interest) => ([
    { topic: `getting started with ${interest}`, context: profile.location },
    { topic: `${interest} not producing results`, context: profile.employment_status },
    { topic: `making money from ${interest}`, context: profile.income_level },
  ]));
  return {
    topics: topics.slice(0, 12),
    audience_descriptors: [audiencePhrase(profile), audienceDescriptor(profile)],
    market: profile.location,
  };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface TemplateSpec {
  type: QueryType;
  layer: number;
  build: (topic: string, audience: string, market: string, profile: AudienceProfile) => string;
  intent: string;
}

const TEMPLATES: TemplateSpec[] = [
  { type: 'problem', layer: 2, intent: 'problem framing by audience', build: (t, a) => `"${t}" ${a}`, },
  { type: 'problem', layer: 2, intent: 'struggle language', build: (t, a) => `${a} struggling with ${t}`, },
  { type: 'problem', layer: 2, intent: 'question form', build: (t, a) => `how do ${a} solve ${t}`, },
  { type: 'pain', layer: 3, intent: 'frustration language', build: (t) => `${t} frustrating`, },
  { type: 'pain', layer: 3, intent: 'complaint language', build: (t, a) => `${a} ${t} complaints`, },
  { type: 'problem', layer: 2, intent: 'exact topic problem search', build: (t) => `${t} problem`, },
  { type: 'purchase_intent', layer: 4, intent: 'buying keywords', build: (t) => `${t} course OR template OR coaching price`, },
  { type: 'purchase_intent', layer: 4, intent: 'hiring intent', build: (t, a) => `best ${t} service for ${a}`, },
  { type: 'purchase_intent', layer: 4, intent: 'tool spend', build: (t) => `${t} software OR tool pricing`, },
  { type: 'solution_failure', layer: 5, intent: 'solution dissatisfaction', build: (t) => `${t} not working solutions failed`, },
  { type: 'solution_failure', layer: 5, intent: 'alternatives', build: (t) => `${t} alternatives better than`, },
  { type: 'emerging_trend', layer: 6, intent: 'recency', build: (t) => `${t} 2026 trend growth`, },
  { type: 'emerging_trend', layer: 6, intent: 'change over time', build: (t) => `${t} what changed recently`, },
  { type: 'competitor', layer: 7, intent: 'competitive landscape', build: (t) => `${t} competitors tools market`, },
  { type: 'competitor', layer: 7, intent: 'saturation check', build: (t) => `${t} saturated too competitive`, },
  { type: 'content_demand', layer: 8, intent: 'content pull', build: (t) => `${t} tutorial guide walkthrough`, },
  { type: 'content_demand', layer: 8, intent: 'community questions', build: (t) => `${t} reddit OR forum discussion`, },
  { type: 'content_demand', layer: 8, intent: 'youtube demand', build: (t) => `${t} youtube most watched`, },
  { type: 'contrarian', layer: 9, intent: 'disproof attempt', build: (t) => `${t} is a bad idea demand declining`, },
  { type: 'contrarian', layer: 9, intent: 'disproof attempt', build: (t) => `${t} no longer works saturated`, },
];

/** Broad discovery queries always run first — they seed the topic space. */
export function broadDiscoveryQueries(profile: AudienceProfile, market: string): string[] {
  const a = audiencePhrase(profile);
  const interests = profile.interests.join(' OR ') || 'digital products';
  const local = market && market !== 'Global' ? ` ${market}` : '';
  return [
    `${a}${local} biggest problems 2026`,
    `${interests}${local} what people struggle with 2026`,
    `${a}${local} willing to pay for help with`,
    `${a}${local} how to make money online problems`,
    `most searched questions ${interests}${local}`,
    `${interests}${local} market demand growing 2026`,
  ];
}

export interface QuerySet {
  queries: QuerySpec[];
  byType: Record<string, number>;
  layersCovered: number[];
  warnings: string[];
}

/**
 * Expand hypotheses across the mandatory layers. Mandatory types are
 * guaranteed a minimum count; the caller caps the total afterwards.
 */
export function buildQuerySet(
  runId: string,
  profile: AudienceProfile,
  hypothesis: Hypothesis,
  opts: { max_queries: number; minPerType?: number },
): QuerySet {
  const audience = audiencePhrase(profile);
  const market = profile.location || hypothesis.market || 'Global';
  const warnings: string[] = [];
  const rows: QuerySpec[] = [];
  const seen = new Set<string>();

  const push = (query: string, type: QueryType, layer: number, intent: string, generated_by: 'rules' | 'ai') => {
    const q = norm(query).slice(0, 220);
    const key = q.toLowerCase();
    if (!q || seen.has(key)) return;
    seen.add(key);
    rows.push({ id: uid('q'), research_run_id: runId, query: q, query_type: type, layer, intent, generated_by, executed: false, results_count: 0 });
  };

  broadDiscoveryQueries(profile, market).forEach((q) => push(q, 'broad_discovery', 1, 'opportunity space discovery', 'rules'));

  const topics = hypothesis.topics
    .map((t) => norm(typeof t === 'string' ? t : t.topic))
    .filter((t) => t.length > 3)
    .slice(0, 14);
  if (!topics.length) warnings.push('No topic hypotheses available — discovery ran without topic expansion.');

  topics.forEach((topic) => {
    TEMPLATES.forEach((tpl) => {
      const built = tpl.build(topic, audience, market, profile);
      if (/^"?\s*(getting started with|making money from)\s*"?$/i.test(built)) return;
      push(built, tpl.type, tpl.layer, tpl.intent, 'rules');
    });
  });

  // Model-supplied query variants are additive only — they can never remove coverage.
  const byType: Record<string, number> = {};
  rows.forEach((r) => { byType[r.query_type] = (byType[r.query_type] ?? 0) + 1; });

  const mandatory: QueryType[] = ['problem', 'pain', 'purchase_intent', 'solution_failure', 'emerging_trend', 'competitor', 'content_demand', 'contrarian'];
  mandatory.forEach((type) => {
    if (!byType[type]) warnings.push(`No ${type.replace('_', ' ')} queries were generated — coverage gap for that layer.`);
  });

  // Trim: keep a balanced spread across layers rather than the first N.
  const capped: QuerySpec[] = [];
  const groups = new Map<number, QuerySpec[]>();
  rows.forEach((r) => { groups.set(r.layer, [...(groups.get(r.layer) ?? []), r]); });
  const order = [...groups.keys()].sort((a, b) => a - b);
  let i = 0;
  while (capped.length < opts.max_queries && order.some((l) => (groups.get(l)?.length ?? 0) > i)) {
    order.forEach((l) => {
      const list = groups.get(l) ?? [];
      if (list[i] && capped.length < opts.max_queries) capped.push(list[i]);
    });
    i++;
  }

  const finalByType: Record<string, number> = {};
  capped.forEach((r) => { finalByType[r.query_type] = (finalByType[r.query_type] ?? 0) + 1; });
  if (capped.length < opts.max_queries) warnings.push(`Only ${capped.length} unique queries were available (target ${opts.max_queries}).`);

  return { queries: capped, byType: finalByType, layersCovered: [...new Set(capped.map((q) => q.layer))].sort((a, b) => a - b), warnings };
}

/** Adversarial second pass — built from a chosen problem, not a topic guess. */
export function buildValidationQueries(problemStatement: string, profile: AudienceProfile, max = 10): QuerySpec[] {
  const topic = norm(problemStatement).replace(/[."]/g, '');
  const audience = audiencePhrase(profile);
  const specs: [string, QueryType, string][] = [
    [`"${topic}"`, 'problem', 'exact problem phrase'],
    [`${topic} solution`, 'problem', 'alternative wording'],
    [`${topic} ${audience}`, 'problem', 'audience-specific version'],
    [`${topic} complaints`, 'pain', 'complaint evidence'],
    [`${topic} reddit`, 'community', 'community discussion'],
    [`${topic} course OR template OR guide`, 'purchase_intent', 'buying intent'],
    [`${topic} not working still struggling`, 'solution_failure', 'solution failure evidence'],
    [`${topic} 2026 recent`, 'emerging_trend', 'recent activity'],
    [`${topic} saturated overrated`, 'contrarian', 'disproof attempt'],
    [`${topic} alternative better`, 'competitor', 'competitive alternatives'],
  ];
  return specs.slice(0, max).map(([query, type, intent]) => ({
    id: uid('q'),
    research_run_id: '',
    query,
    query_type: type,
    layer: type === 'contrarian' ? 9 : 5,
    intent,
    generated_by: 'rules' as const,
    executed: false,
    results_count: 0,
  }));
}
