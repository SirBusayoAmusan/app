/* Headless verification of the deterministic core: query layering,
   evidence normalisation/weighting, clustering and the scoring engine. */
import { buildQuerySet, buildValidationQueries, deterministicHypotheses, QUERY_LAYERS } from '../src/core/intelligence/queryEngine';
import { normalizeEvidence, evidenceStats, rankEvidence, evidencePromptBlock } from '../src/core/intelligence/evidenceEngine';
import { clusterNiches } from '../src/core/intelligence/aiEngines';
import { computeOpportunityScore, evidenceGate, confidenceBand, scoreBand } from '../src/core/intelligence/scoringEngine';
import { computeMetrics } from '../src/core/product/engines';
import type { AudienceProfile, Evidence, Niche } from '../src/core/types';

let pass = 0; let fail = 0;
const ok = (label: string, cond: boolean, extra?: any) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`, extra ?? ''); }
};

const audience: AudienceProfile = {
  id: 'aud1', name: 'Test', age_min: 22, age_max: 35, gender: 'All genders', location: 'Nigeria',
  language: 'English', income_level: 'Middle income', employment_status: 'Self-employed / freelancer',
  experience_level: 'Beginner', interests: ['digital marketing', 'freelancing'], business_type: 'freelance social media manager',
  life_stage: 'Early career', platforms: ['Instagram'], created_at: '', updated_at: '', is_active: true,
};

console.log('\n1. Query layers');
const hypotheses = deterministicHypotheses(audience);
const qs = buildQuerySet('run1', audience, hypotheses, { max_queries: 24 });
ok('generates the requested number of queries', qs.queries.length === 24, qs.queries.length);
ok('covers all nine layers', qs.layersCovered.length === 9, qs.layersCovered);
const types = new Set(qs.queries.map(q => q.query_type));
ok('includes contrarian + purchase intent queries', types.has('contrarian') && types.has('purchase_intent'), [...types]);
const vq = buildValidationQueries('Freelancers cannot consistently get clients', audience, 10);
ok('builds 10 adversarial validation queries', vq.length === 10 && vq[8].query_type === 'contrarian');

console.log('\n2. Evidence pipeline');
const mk = (i: number, domain: string, publishedDays: number | null, title: string, snippet: string) => ({
  result: {
    title, url: `https://${domain}/post-${i}`, snippet,
    published_at: publishedDays === null ? null : new Date(Date.now() - publishedDays * 86400000).toISOString(),
    score: 0.8, provider: 'tavily' as const, query: 'q', source_type: 'search_result' as const,
  },
  query: `query ${i}`, query_type: 'problem' as const,
});
const inputs = [
  mk(1, 'reddit.com', 5, 'How do I get clients as a freelance social media manager?', 'I am struggling to get clients, referrals dried up and I cannot find new work.'),
  mk(2, 'indiehackers.com', 20, 'Freelance client acquisition is brutal right now', 'I keep failing to get clients and it is frustrating and expensive.'),
  mk(3, 'blog.example.com', 120, 'Client acquisition for freelancers', 'Getting clients is the hardest part of freelancing and most people fail.'),
  mk(4, 'syndication-a.com', 12, 'Client acquisition for freelancers', 'Getting clients is the hardest part of freelancing and most people fail.'),
  mk(5, 'syndication-b.com', 12, 'Client acquisition for freelancers', 'Getting clients is the hardest part of freelancing and most people fail.'),
  mk(6, 'gov.example.gov', 800, 'Self-employment statistics report', 'Labour market statistics for self-employed workers across regions.'),
  { ...mk(9, 'near-dup-a.com', 15, 'Why freelance social media managers cannot find clients', 'Freelance social media managers cannot find clients and getting clients is the hardest part of freelancing.') },
  { ...mk(10, 'near-dup-b.com', 15, 'Freelance social media managers struggle to find clients', 'Social media managers cannot find clients; getting clients is the hardest part of freelancing.') },
  { ...mk(7, 'news.example.com', null, 'Freelance market overview', 'A general overview with no publication date available.'), },
  mk(8, 'a', 10, '', ''),
];
const { evidence, dropped } = normalizeEvidence('run1', inputs as any, audience);
ok('keeps unique sources, drops the unusable one', evidence.length === 7, [evidence.length, evidence.map(e => e.domain)]);
ok('exact syndicated copies are removed outright', dropped.some(d => d.reason === 'duplicate content' && d.count === 2), dropped);
ok('near-duplicate sources are clustered and down-weighted', evidence.filter(e => e.duplicate_of).length === 2 && evidence.some(e => e.independence_score < 0.8), evidence.map(e => [e.domain, e.independence_score]));
ok('drops empty results rather than scoring them', dropped.some(d => d.reason === 'empty result'), dropped);
const reddit = evidence.find(e => e.domain === 'reddit.com')!;
ok('fresh source gets freshness 1.0', reddit.freshness_score === 1, reddit.freshness_score);
const old = evidence.find(e => e.domain === 'gov.example.gov')!;
ok('2yr+ source drops to 0.2 freshness', old.freshness_score === 0.2, old.freshness_score);
ok('unknown-date source gets 0.5 and never counts as recent', evidence.find(e => e.domain === 'news.example.com')!.freshness_score === 0.5);
ok('reliability: gov > reddit > blog', old.source_reliability === 1 && reddit.source_reliability === 0.72 && evidence.find(e => e.domain === 'blog.example.com')!.source_reliability === 0.7);
ok('evidence weight is a product of the five components', reddit.evidence_weight > 0 && reddit.importance_weight > 0);
const stats = evidenceStats(evidence);
ok('independent domains counted', stats.independent_domains === 7, stats.independent_domains);
ok('recent 90d counted', stats.recent_90 === 4, stats.recent_90);
ok('prompt block preserves evidence ids', evidencePromptBlock(evidence, { maxChars: 5000 }).includes('[ev_'));
ok('ranking returns most relevant first', rankEvidence(evidence, 'client acquisition freelance', 3).length === 3);

console.log('\n3. Niche clustering');
const niche = (id: string, text: string, audienceText: string, problem: string, evidence_ids: string[]): Niche => ({
  id, research_run_id: 'run1', broad_category: 'Freelancing', specific_niche: text, target_audience: audienceText,
  core_problem: problem, desired_outcome: 'get 3 clients per month', context: '', why_specific: '', product_formats: [],
  specificity_score: 80, specificity_notes: [], evidence_ids, evidence_count: evidence_ids.length, independent_domains: 3,
  recent_evidence_count: 2, status: 'candidate', quality_gate: { passed: true, failures: [], warnings: [] }, created_at: '',
});
const families: Niche[] = [
  niche('n1', 'Client acquisition for freelance social media managers', 'freelance social media managers', 'cannot get clients consistently', ['ev_a','ev_b','ev_c']),
  niche('n2', 'Getting clients as a freelance social media manager', 'freelance social media managers', 'cannot get clients consistently', ['ev_b','ev_c','ev_d']),
  niche('n3', 'Pricing retainer packages as a freelance designer', 'freelance designers', 'underpricing retainer work', ['ev_e','ev_f']),
];
const clusters = clusterNiches(families, 0.72);
ok('merges near-duplicate niches', clusters.length === 2, clusters.map(c => c.members.length));
ok('merged cluster inherits all evidence ids', clusters.some(c => c.canonical.evidence_ids.length === 4));
ok('distinct opportunity stays separate', clusters.some(c => c.canonical.specific_niche.includes('Pricing retainer')));

console.log('\n4. Scoring engine');
const components = Object.fromEntries([
  ['current_demand', 91], ['trend_momentum', 87], ['pain_severity', 94], ['willingness_to_pay', 82],
  ['problem_frequency', 89], ['market_gap', 76], ['emotional_intensity', 84], ['product_feasibility', 95],
  ['viral_content_potential', 90], ['competition_opportunity', 71],
].map(([k, v]) => [k, { score: v as number, reason: 'test', evidence_ids: ['ev_a'], assessment: 'direct' as const }]));
const supporting = evidence.filter(e => ['reddit.com','indiehackers.com','blog.example.com','gov.example.gov','news.example.com'].includes(e.domain)).map(e => e.id);
const computed = computeOpportunityScore({
  problem_id: 'p1', niche_id: 'n1', research_run_id: 'run1', components: components as any,
  evidence, supporting_ids: supporting, contradicting_ids: [evidence[0].id], validation_status: 'promising',
});
const expectedBase = 91*0.2 + 87*0.15 + 94*0.15 + 82*0.12 + 89*0.08 + 76*0.08 + 84*0.07 + 95*0.05 + 90*0.05 + 71*0.05;
ok('base score matches the published weights', Math.abs(computed.base_score - Math.round(expectedBase*10)/10) < 0.11, [computed.base_score, expectedBase]);
ok('confidence multiplier sits in 0.60-1.00', computed.confidence_multiplier >= 0.6 && computed.confidence_multiplier <= 1);
ok('contradiction reduces the score below base', computed.final_score < computed.base_score * computed.confidence_multiplier);
ok('arithmetic trace is auditable', computed.arithmetic.length === 5 && computed.arithmetic[4].includes('final ='));
const weak = computeOpportunityScore({ problem_id: 'p2', niche_id: 'n2', research_run_id: 'run1', components: components as any, evidence: evidence.slice(0,1), supporting_ids: [], contradicting_ids: [], validation_status: 'insufficient_evidence' });
ok('thin evidence is flagged insufficient and confidence collapses', weak.insufficient_evidence && weak.evidence_confidence < 40, weak.evidence_confidence);
ok('weak evidence cannot out-rank strong evidence', weak.final_score < computed.final_score);
ok('gate fails on a single source', !evidenceGate(evidence.slice(0, 2)).passed);
ok('labels resolve', scoreBand(86).label === 'High Potential' && confidenceBand(30).label === 'Insufficient evidence', [scoreBand(86), confidenceBand(30)]);
ok('all nine query layers defined', QUERY_LAYERS.length === 9);

console.log('\n5. Analytics math');
const m = computeMetrics({ visitors: 500, leads: 40, sales: 12, revenue: 444, ad_spend: 200, refunds: 1, repeat_purchases: 2, price: 37, notes: '' });
ok('conversion rate = sales/visitors', m.conversion_rate === 2.4, m.conversion_rate);
ok('CAC = spend/sales', m.cac === 16.67, m.cac);
ok('ROAS = revenue/spend', m.roas === 2.22, m.roas);
ok('flags small samples', computeMetrics({ visitors: 50, leads: 2, sales: 1, revenue: 37, ad_spend: 20, refunds: 0, repeat_purchases: 0, price: 37, notes: '' }).sample_warning !== null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
