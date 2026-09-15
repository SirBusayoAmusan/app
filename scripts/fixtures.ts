/* Shared fixture: a complete, realistic research run written through the app's
   real data layer.

   Used by two harnesses so there is exactly one definition of "seeded state":
     - scripts/render-test.tsx  (jsdom, bundled by esbuild, every route)
     - scripts/mobile-audit.mjs (real Chromium, imported by the page via Vite)
   It imports only app modules, so Vite can serve it to the browser as-is. */
import { db, uid, saveAudience } from '../src/core/db/database';

export type Fixture = {
  audienceId: string;
  runId: string;
  nicheId: string;
  problemId: string;
  projectId: string;
  evidenceIds: string[];
};

export async function seedFixture(): Promise<Fixture> {
  const now = () => new Date().toISOString();

  const audience = await saveAudience({
    id: uid('aud'), name: 'Fixture', age_min: 22, age_max: 35, gender: 'All genders',
    location: 'Nigeria', language: 'English', income_level: 'Middle income',
    employment_status: 'Self-employed / freelancer', experience_level: 'Beginner',
    interests: ['digital marketing'], business_type: 'freelance social media manager',
    life_stage: 'Early career', platforms: ['Instagram'], is_active: true,
    created_at: now(), updated_at: now(),
  });

  const runId = uid('run');
  await db.research_runs.put({
    id: runId, audience_profile_id: audience.id, audience_snapshot: audience,
    research_type: 'niche_discovery', status: 'complete', stage: 'done', progress: 100,
    stages: [{ key: 'search', label: 'Reading current posts and pages', status: 'done', detail: 'searched 24 ways · 118 pages read' }],
    started_at: now(), completed_at: now(), engine_version: '1.0.0', prompt_version: 'p1.0.0',
    scoring_version: 's1.0.0',
    usage: { ai_calls: 12, search_calls: 34, tokens_in: 51000, tokens_out: 9000, evidence_collected: 118 },
  });

  const evidenceIds = ['ev_1', 'ev_2', 'ev_3'];
  for (const [i, id] of evidenceIds.entries()) {
    await db.evidence.put({
      id, research_run_id: runId, query: 'freelancers struggling with client acquisition',
      query_type: 'problem', provider: 'tavily',
      source_url: `https://example.com/${i}`, canonical_url: `https://example.com/${i}`,
      domain: 'example.com', title: `Evidence ${i}`,
      snippet: 'Freelancers report they cannot get clients consistently and referrals have dried up.',
      content: '', published_at: new Date(Date.now() - i * 86400000).toISOString(),
      retrieved_at: now(), source_type: 'search_result', source_reliability: 0.7,
      relevance_score: 0.8, directness_score: 0.8, freshness_score: 1, independence_score: 1,
      evidence_weight: 0.45, importance_weight: 0.8, age_days: i, content_hash: `${i}`,
      duplicate_of: null, signal_hints: ['pain'],
    });
  }

  const nicheId = uid('nch');
  await db.niches.put({
    id: nicheId, research_run_id: runId, broad_category: 'Freelancing',
    specific_niche: 'Client acquisition for freelance social media managers',
    target_audience: 'Freelance social media managers aged 22-35',
    core_problem: 'Cannot consistently acquire paying clients without referrals',
    desired_outcome: 'Acquire 3-5 qualified clients per month', context: 'Solo, no ad budget',
    why_specific: 'Named audience, measurable outcome.',
    product_formats: ['pdf guide', 'template pack'], specificity_score: 88,
    specificity_notes: ['Named audience present.'], evidence_ids: evidenceIds, evidence_count: 3,
    independent_domains: 3, recent_evidence_count: 3, status: 'candidate',
    quality_gate: { passed: true, failures: [], warnings: [] }, created_at: now(),
  });

  const problemId = uid('prb');
  await db.problems.put({
    id: problemId, research_run_id: runId, niche_id: nicheId, rank: 1,
    problem_statement: 'Freelancers struggle to consistently acquire paying clients without relying on referrals',
    underlying_problem: 'No repeatable acquisition system',
    customer_language: ['I cannot find clients'], who_experiences_it: 'Freelance social media managers',
    why_it_hurts: 'Income is unpredictable', current_workarounds: ['Cold DMs'],
    why_existing_solutions_fail: 'Courses are generic',
    what_people_search: ['how to get clients as a freelancer'],
    conversation_signals: ['Reddit threads'], potential_product_solutions: ['pdf guide'],
    recommended_product: 'PDF guide', evidence_ids: evidenceIds, evidence_count: 3, created_at: now(),
  });

  await db.validations.put({
    id: uid('val'), research_run_id: runId, problem_id: problemId,
    supporting_evidence_ids: evidenceIds, contradicting_evidence_ids: [],
    validation_evidence_ids: evidenceIds, contradiction_rate: 0, confidence: 82,
    status: 'validated',
    reasoning_summary: 'Multiple independent sources describe the same acquisition problem.',
    confidence_components: { source_reliability: 70, source_diversity: 60, recency: 100, directness: 80, cross_source_consistency: 75 },
    searches_run: 10, created_at: now(),
  });

  await db.opportunity_scores.put({
    id: `score_${problemId}`, research_run_id: runId, problem_id: problemId, niche_id: nicheId,
    components: Object.fromEntries(
      ['current_demand', 'trend_momentum', 'pain_severity', 'willingness_to_pay', 'problem_frequency',
        'market_gap', 'emotional_intensity', 'product_feasibility', 'viral_content_potential', 'competition_opportunity']
        .map((k) => [k, { score: 80, reason: 'Fixture reasoning.', evidence_ids: evidenceIds, assessment: 'direct' }]),
    ) as any,
    base_score: 80, evidence_confidence: 82, confidence_multiplier: 0.928,
    contradiction_rate: 0, contradiction_multiplier: 1, final_score: 74.2,
    score_label: 'Strong Opportunity', opportunity_label: '💰 Strong Opportunity',
    insufficient_evidence: false,
    confidence_components: { source_reliability: 70, source_diversity: 60, recency: 100, directness: 80, cross_source_consistency: 75 },
    scoring_version: 's1.0.0', computed_at: now(),
    arithmetic: ['base = 80.00', 'evidence confidence = 82.0', 'confidence multiplier = 0.928', 'contradiction multiplier = 1.000', 'final = 74.20'],
  });

  await db.reports.put({
    id: uid('rep'), research_run_id: runId, problem_id: problemId,
    opportunity_summary: 'Freelance social media managers need a repeatable client acquisition system.',
    why_now: 'Recent discussions show the problem is active.',
    customer_problem: 'No predictable pipeline.',
    commercial_reason: 'Buyers already pay for acquisition help.',
    risks: ['Crowded course market'],
    recommended_action: 'Publish one proof-of-work post per week.',
    positioning_angle: 'Systems, not tactics.',
    first_content_ideas: ['Teardown of a failed outreach week'], generated_at: now(),
  });

  /* A created product workspace, so the project pages have real content. */
  const { createProjectFromOpportunity } = await import('../src/core/product/engines');
  const project = await createProjectFromOpportunity(nicheId, problemId);

  return { audienceId: audience.id, runId, nicheId, problemId, projectId: project.id, evidenceIds };
}
