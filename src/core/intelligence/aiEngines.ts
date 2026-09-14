/* ------------------------------------------------------------------
   AI engine layer. Each engine:
     1. builds a versioned, schema-bound prompt,
     2. calls the user's own provider,
     3. validates the structured payload against the local Zod schema,
     4. drops any claim that references an evidence ID that does not exist.
   Step 4 is the anti-hallucination gate: unknown IDs are never rendered.
   ------------------------------------------------------------------ */
import { z } from 'zod';
import type {
  AIProviderConfig, AudienceProfile, ComponentKey, Evidence, ID, Niche, Problem, Signal,
  SignalType, Validation,
} from '../types';
import { err, rankEvidenceUnsafe, round1, tokenize, uid, jaccard, keywordSet } from './fingerprint';
import { runAI } from '../ai/providers';
import * as P from '../prompts';
import * as S from '../schemas/schemas';
import { computeConfidence, confidenceFromComponents } from './scoringEngine';

type Ctx = {
  config: AIProviderConfig;
  onUsage?: (u: { calls?: number; tokens_in?: number; tokens_out?: number }) => void;
  temperature?: number;
};

function bump(ctx: Ctx, r: { tokens_in: number; tokens_out: number }) {
  ctx.onUsage?.({ calls: 1, tokens_in: r.tokens_in, tokens_out: r.tokens_out });
}

const system = (specific: string) => `${P.GLOBAL_SYSTEM_PROMPT}\n\n${specific}`;

/* ============================== 1. hypotheses ========================= */

const HypothesisZ = z.object({
  market_summary: z.string(),
  audience_descriptors: z.array(z.string()).default([]),
  topics: z.array(z.object({
    topic: z.string(),
    why_researchable: z.string().default(''),
    context: z.string().default(''),
  })).default([]),
});

export async function generateHypotheses(ctx: Ctx, audience: AudienceProfile) {
  const res = await runAI<any>(ctx.config, {
    schema_name: 'research_hypotheses',
    schema: S.HYPOTHESIS_SCHEMA,
    temperature: ctx.temperature ?? 0.1,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: system(P.QUERY_STRATEGIST_PROMPT) },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'generate_research_hypotheses',
          audience: {
            age_range: `${audience.age_min}-${audience.age_max}`,
            gender: audience.gender,
            location: audience.location,
            language: audience.language,
            income_level: audience.income_level,
            employment_status: audience.employment_status,
            experience_level: audience.experience_level,
            interests: audience.interests,
            business_type: audience.business_type,
            life_stage: audience.life_stage,
            preferred_platforms: audience.platforms,
          },
          research_date: new Date().toISOString().slice(0, 10),
          instruction: 'Produce the topic hypotheses to research. No market claims, no statistics, no trend assertions.',
        }, null, 2),
      },
    ],
  });
  bump(ctx, res);
  const parsed = HypothesisZ.safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected hypothesis shape.', { detail: parsed.error.message, retryable: true });
  return parsed.data;
}

/* ============================== 2. signals ============================ */

const SignalZ = z.object({
  signal_id: z.string(),
  signal_type: z.string(),
  statement: z.string(),
  evidence_ids: z.array(z.string()).default([]),
  strength: z.number().default(0),
  confidence: z.number().default(0),
  direct_or_inferred: z.string().default('direct'),
  customer_language: z.array(z.string()).default([]),
});

export async function extractSignals(
  ctx: Ctx,
  audience: AudienceProfile,
  evidenceBlocks: { evidence: Evidence[]; block: string }[],
): Promise<{ signals: Signal[]; rejected: { statement: string; reason: string }[]; batches: number }> {
  const runId = evidenceBlocks[0]?.evidence[0]?.research_run_id ?? '';
  const validIds = new Set(evidenceBlocks.flatMap((b) => b.evidence.map((e) => e.id)));
  const out: Signal[] = [];
  const rejected: { statement: string; reason: string }[] = [];

  for (let i = 0; i < evidenceBlocks.length; i++) {
    const batch = evidenceBlocks[i];
    const res = await runAI<any>(ctx.config, {
      schema_name: 'market_signals',
      schema: S.SIGNALS_SCHEMA,
      temperature: 0,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: system(P.SIGNAL_EXTRACTION_PROMPT) },
        {
          role: 'user',
          content: [
            `AUDIENCE\n${JSON.stringify({ age: `${audience.age_min}-${audience.age_max}`, location: audience.location, income: audience.income_level, experience: audience.experience_level, interests: audience.interests, business_type: audience.business_type })}`,
            `\nBATCH ${i + 1} of ${evidenceBlocks.length}. Only evidence IDs listed below are valid.\n`,
            batch.block,
          ].join('\n'),
        },
      ],
    });
    bump(ctx, res);
    const parsed = z.object({ signals: z.array(SignalZ).default([]) }).safeParse(res.data);
    if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected signal shape.', { detail: parsed.error.message, retryable: true });

    parsed.data.signals.forEach((s, idx) => {
      const ids = s.evidence_ids.filter((id) => validIds.has(id));
      if (!ids.length) {
        rejected.push({ statement: s.statement, reason: 'No valid evidence IDs — claim discarded.' });
        return;
      }
      if (ids.length !== s.evidence_ids.length) {
        rejected.push({ statement: s.statement, reason: `${s.evidence_ids.length - ids.length} unknown evidence ID(s) stripped.` });
      }
      out.push({
        id: uid('sig'),
        research_run_id: runId,
        niche_id: null,
        evidence_ids: ids,
        signal_type: (s.signal_type as SignalType) ?? 'problem',
        statement: s.statement,
        strength: round1(Math.max(0, Math.min(100, s.strength))),
        confidence: round1(Math.max(0, Math.min(100, s.confidence))),
        direct_or_inferred: s.direct_or_inferred === 'inferred' ? 'inferred' : 'direct',
        rejected: false,
      });
    });
  }
  return { signals: out, rejected, batches: evidenceBlocks.length };
}

/* =============================== 3. niches ============================ */

const NicheZ = z.object({
  niche_id: z.string(),
  broad_category: z.string(),
  specific_niche: z.string(),
  audience: z.string(),
  problem: z.string(),
  desired_outcome: z.string(),
  context: z.string().default(''),
  why_specific: z.string().default(''),
  product_formats: z.array(z.string()).default([]),
  evidence_ids: z.array(z.string()).default([]),
});

const BROAD_CATEGORY_WORDS = ['fitness', 'finance', 'marketing', 'health', 'ai', 'relationships', 'business', 'productivity', 'technology', 'lifestyle', 'education', 'self improvement', 'money', 'online business'];

/**
 * Deterministic specificity scoring — the model cannot grade its own
 * specificity. Checks structural properties of the niche string.
 */
export function specificityOf(niche: { specific_niche?: string; audience?: string; problem?: string; desired_outcome?: string; context?: string; evidence_ids: string[] }) {
  const notes: string[] = [];
  let score = 0;
  const specific_niche = niche.specific_niche ?? '';
  const audienceText = niche.audience ?? '';
  const problemText = niche.problem ?? '';
  const desired = niche.desired_outcome ?? '';
  const text = `${specific_niche} ${audienceText} ${problemText} ${niche.context ?? ''}`.toLowerCase();
  const words = tokenize(`${specific_niche} ${audienceText} ${problemText}`);

  if (BROAD_CATEGORY_WORDS.includes(specific_niche.trim().toLowerCase())) {
    notes.push('Rejected pattern: the niche is a broad category, not a niche.');
    return { score: 5, notes };
  }
  if (words.length >= 8) { score += 18; notes.push('Specific enough to read as a niche statement (8+ meaningful keywords).'); }
  else if (words.length >= 5) { score += 11; notes.push('Moderately specific phrasing.'); }
  else notes.push('Very short niche description — likely too broad.');

  if (/\b(for|who|that|which|aged?\s?\d|freelanc\w+|founders?|creators?|teachers?|nurses?|students?|coaches|consultants?|agenc\w+|managers?|owners?|parents?|immigrants?|beginners?|moms?|dads?)\b/i.test(text)) {
    score += 18; notes.push('Named audience present (role, stage or situation).');
  } else notes.push('No explicit audience role found.');

  if (/\d|per (month|week|day)|within \d+ days|first (sale|customer|client)/i.test(`${desired} ${problemText}`)) {
    score += 12; notes.push('Outcome has a measurable or time-bound element.');
  } else notes.push('Outcome is not measurable or time-bound.');

  if (/\b(struggl\w*|can'?t|cannot|fail\w*|stuck|difficult|keep losing|not able|never)\b/i.test(problemText)) {
    score += 16; notes.push('Problem contains explicit struggle language.');
  } else notes.push('Problem does not read as a struggle the audience states.');

  if (niche.evidence_ids.length >= 6) { score += 16; notes.push(`${niche.evidence_ids.length} supporting evidence items.`); }
  else if (niche.evidence_ids.length >= 3) { score += 10; notes.push(`${niche.evidence_ids.length} supporting evidence items (minimum met).`); }
  else notes.push(`Only ${niche.evidence_ids.length} evidence items — below the 3-item minimum.`);

  if (/\b(and|or)\b.*\b(and|or)\b/i.test(specific_niche)) {
    score -= 8; notes.push('Niche bundles several ideas with "and/or" — narrower is stronger.');
  }
  return { score: Math.max(0, Math.min(100, score)), notes };
}

export async function generateNiches(
  ctx: Ctx,
  audience: AudienceProfile,
  signals: Signal[],
  evidence: Evidence[],
  opts: { minEvidence: number },
): Promise<{ niches: Niche[]; rejected: { niche: string; reason: string }[] }> {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const block = signals.slice(0, 90).map((s) => {
    const cited = s.evidence_ids.map((id) => byId.get(id)).filter(Boolean) as Evidence[];
    const sources = cited.slice(0, 4).map((e) => `  - [${e.id}] ${e.domain} · ${e.source_type} · ${e.published_at ?? 'undated'}: ${e.snippet.slice(0, 180)}`).join('\n');
    return `SIGNAL ${s.id} (${s.signal_type}, strength ${s.strength}, ${s.direct_or_inferred})\n  ${s.statement}\n${sources}`;
  }).join('\n\n');

  const res = await runAI<any>(ctx.config, {
    schema_name: 'niche_candidates',
    schema: S.NICHES_SCHEMA,
    temperature: ctx.temperature ?? 0.1,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: system(P.NICHE_DIFFERENTIATION_PROMPT) },
      {
        role: 'user',
        content: [
          `TARGET AUDIENCE\n${JSON.stringify({ age: `${audience.age_min}-${audience.age_max}`, location: audience.location, language: audience.language, income: audience.income_level, employment: audience.employment_status, experience: audience.experience_level, interests: audience.interests, business_type: audience.business_type, life_stage: audience.life_stage }, null, 2)}`,
          `\nEXTRACTED SIGNALS WITH SOURCE EXCERPTS\n${block}`,
          `\nRULES\n- Every niche needs at least ${opts.minEvidence} evidence IDs copied exactly from the signal blocks above.\n- Return 10-24 niches, each a distinct opportunity. Do not return broad categories.\n- Prefer specificity over volume. It is acceptable to return fewer niches.`,
        ].join('\n'),
      },
    ],
  });
  bump(ctx, res);

  const parsed = z.object({ niches: z.array(NicheZ) }).safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected niche shape.', { detail: parsed.error.message, retryable: true });

  const runId = evidence[0]?.research_run_id ?? '';
  const accepted: Niche[] = [];
  const rejected: { niche: string; reason: string }[] = [];

  parsed.data.niches.forEach((raw) => {
    const ids = raw.evidence_ids.filter((id) => byId.has(id));
    if (ids.length < opts.minEvidence) {
      rejected.push({ niche: raw.specific_niche, reason: `Only ${ids.length} valid evidence item(s); ${opts.minEvidence} required.` });
      return;
    }
    const cited = ids.map((id) => byId.get(id)!) as Evidence[];
    const spec = specificityOf({ ...(raw as any), evidence_ids: ids });
    const independentDomains = new Set(cited.map((e) => e.domain)).size;
    const recent = cited.filter((e) => e.age_days !== null && e.age_days <= 90).length;
    accepted.push({
      id: uid('nch'),
      research_run_id: runId,
      broad_category: raw.broad_category,
      specific_niche: raw.specific_niche,
      target_audience: raw.audience,
      core_problem: raw.problem,
      desired_outcome: raw.desired_outcome,
      context: raw.context,
      why_specific: raw.why_specific,
      product_formats: raw.product_formats,
      specificity_score: spec.score,
      specificity_notes: spec.notes,
      evidence_ids: ids,
      evidence_count: ids.length,
      independent_domains: independentDomains,
      recent_evidence_count: recent,
      status: 'candidate',
      quality_gate: { passed: true, failures: [], warnings: [] },
      created_at: new Date().toISOString(),
    });
  });

  return { niches: accepted, rejected };
}

/* =========================== 4. clustering ============================ */

/**
 * Hybrid clustering: lexical similarity (no embedding endpoint needed in
 * a local-first app) plus evidence-overlap. Deterministic and inspectable.
 */
export function clusterNiches(niches: Niche[], threshold: number) {
  const groups: { canonical: Niche; members: Niche[]; similarity: number }[] = [];
  const sorted = [...niches].sort((a, b) => b.evidence_count - a.evidence_count || b.specificity_score - a.specificity_score);

  const similarity = (a: Niche, b: Niche) => {
    const kw = jaccard(
      keywordSet(`${a.specific_niche} ${a.core_problem} ${a.desired_outcome}`),
      keywordSet(`${b.specific_niche} ${b.core_problem} ${b.desired_outcome}`),
    );
    const problemSim = jaccard(keywordSet(a.core_problem), keywordSet(b.core_problem));
    const audienceSim = jaccard(keywordSet(a.target_audience), keywordSet(b.target_audience));
    const evidenceSim = jaccard(new Set(a.evidence_ids), new Set(b.evidence_ids));
    return kw * 0.45 + problemSim * 0.25 + audienceSim * 0.15 + evidenceSim * 0.15;
  };

  sorted.forEach((niche) => {
    let best: { idx: number; sim: number } | null = null;
    groups.forEach((g, idx) => {
      const sim = Math.max(...g.members.map((m) => similarity(m, niche)));
      if (sim >= threshold && (!best || sim > best.sim)) best = { idx, sim };
    });
    if (best) {
      groups[best.idx].members.push(niche);
      groups[best.idx].similarity = Math.max(groups[best.idx].similarity, best.sim);
    } else {
      groups.push({ canonical: niche, members: [niche], similarity: 1 });
    }
  });

  return groups.map((g, i) => {
    const mergedEvidence = [...new Set(g.members.flatMap((m) => m.evidence_ids))];
    // Keep the most specific representative, but inherit merged evidence.
    const canonical = [...g.members].sort(
      (a, b) => (b.specificity_score + b.evidence_count * 2) - (a.specificity_score + a.evidence_count * 2),
    )[0];
    return {
      cluster_id: `cl_${i + 1}`,
      canonical: {
        ...canonical,
        evidence_ids: mergedEvidence,
        evidence_count: mergedEvidence.length,
        cluster_id: `cl_${i + 1}`,
        merged_from: g.members.filter((m) => m.id !== canonical.id).map((m) => m.id),
      } as Niche,
      members: g.members,
      similarity: round1(g.similarity * 100) / 100,
      reason: `Merged ${g.members.length} candidate(s) — shared problem keywords, audience and evidence overlap ≥ ${(threshold * 100).toFixed(0)}%.`,
    };
  });
}

/* ============================ 5. problems ============================= */

const ProblemZ = z.object({
  problem_id: z.string(),
  problem_statement: z.string(),
  underlying_problem: z.string().default(''),
  rank: z.number().default(99),
  customer_language: z.array(z.string()).default([]),
  who_experiences_it: z.string().default(''),
  why_it_hurts: z.string().default(''),
  current_workarounds: z.array(z.string()).default([]),
  why_existing_solutions_fail: z.string().default(''),
  what_people_search: z.array(z.string()).default([]),
  conversation_signals: z.array(z.string()).default([]),
  potential_product_solutions: z.array(z.string()).default([]),
  recommended_product: z.string().default(''),
  evidence_ids: z.array(z.string()).default([]),
});

export async function generateProblems(
  ctx: Ctx,
  niche: Niche,
  evidence: Evidence[],
  signals: Signal[],
  maxProblems: number,
): Promise<{ problems: Problem[]; rejected: { problem: string; reason: string }[] }> {
  const nicheEvidence = evidence.filter((e) => niche.evidence_ids.includes(e.id));
  const pool = rankEvidenceUnsafe(nicheEvidence, `${niche.core_problem} ${niche.specific_niche}`, 28);
  const validIds = new Set(pool.map((e) => e.id));
  const block = pool.map((e) => `[${e.id}] ${e.title}\n  ${e.domain} · ${e.source_type} · ${e.published_at ?? 'undated'}\n  ${(`${e.snippet} ${e.content}`).replace(/\s+/g, ' ').slice(0, 700)}\n  url: ${e.canonical_url}`).join('\n\n');
  const sigBlock = signals.filter((s) => s.evidence_ids.some((id) => validIds.has(id))).slice(0, 30)
    .map((s) => `- (${s.signal_type}) ${s.statement} [${s.evidence_ids.filter((i) => validIds.has(i)).join(', ')}]`).join('\n');

  const res = await runAI<any>(ctx.config, {
    schema_name: 'niche_problems',
    schema: S.PROBLEMS_SCHEMA,
    temperature: 0,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: system(P.PROBLEM_MINING_PROMPT) },
      {
        role: 'user',
        content: [
          `NICHE\n${JSON.stringify({ niche: niche.specific_niche, audience: niche.target_audience, problem: niche.core_problem, desired_outcome: niche.desired_outcome, context: niche.context }, null, 2)}`,
          `\nEXTRACTED SIGNALS\n${sigBlock || '(none)'}`,
          `\nEVIDENCE (only these IDs are valid)\n${block}`,
          `\nReturn at most ${maxProblems} problems, ranked 1..N. Do not invent facts.`,
        ].join('\n'),
      },
    ],
  });
  bump(ctx, res);

  const parsed = z.object({ problems: z.array(ProblemZ) }).safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected problem shape.', { detail: parsed.error.message, retryable: true });

  const problems: Problem[] = [];
  const rejected: { problem: string; reason: string }[] = [];
  parsed.data.problems.forEach((raw, i) => {
    const ids = raw.evidence_ids.filter((id) => validIds.has(id));
    if (ids.length < 2) {
      rejected.push({ problem: raw.problem_statement, reason: `Only ${ids.length} valid evidence reference(s).` });
      return;
    }
    problems.push({
      id: uid('prb'),
      research_run_id: niche.research_run_id,
      niche_id: niche.id,
      rank: Math.round(raw.rank || i + 1),
      problem_statement: raw.problem_statement,
      underlying_problem: raw.underlying_problem,
      customer_language: raw.customer_language,
      who_experiences_it: raw.who_experiences_it,
      why_it_hurts: raw.why_it_hurts,
      current_workarounds: raw.current_workarounds,
      why_existing_solutions_fail: raw.why_existing_solutions_fail,
      what_people_search: raw.what_people_search,
      conversation_signals: raw.conversation_signals,
      potential_product_solutions: raw.potential_product_solutions,
      recommended_product: raw.recommended_product,
      evidence_ids: ids,
      evidence_count: ids.length,
      created_at: new Date().toISOString(),
    });
  });
  return { problems: problems.sort((a, b) => a.rank - b.rank), rejected };
}

/* =========================== 6. validation ============================ */

const ValidationZ = z.object({
  supporting_evidence_ids: z.array(z.string()).default([]),
  contradicting_evidence_ids: z.array(z.string()).default([]),
  validation_status: z.string(),
  confidence: z.number().default(0),
  demand_vs_saturation: z.string().default(''),
  monetization_signals: z.string().default(''),
  reasoning_summary: z.string().default(''),
  disproof_notes: z.array(z.string()).default([]),
});

export async function validateProblem(
  ctx: Ctx,
  problem: Problem,
  niche: Niche,
  evidence: Evidence[],
  runId: ID,
  searchesRun: number,
): Promise<Validation> {
  const pool = evidence;
  const validIds = new Set(pool.map((e) => e.id));
  const block = pool.map((e) => `[${e.id}] ${e.title}\n  ${e.domain} · ${e.source_type} · ${e.published_at ?? 'undated'} · freshness ${e.freshness_score.toFixed(2)} · independence ${e.independence_score.toFixed(2)}\n  ${(`${e.snippet} ${e.content}`).replace(/\s+/g, ' ').slice(0, 620)}\n  url: ${e.canonical_url}`).join('\n\n');

  const res = await runAI<any>(ctx.config, {
    schema_name: 'opportunity_validation',
    schema: S.VALIDATION_SCHEMA,
    temperature: 0,
    max_tokens: 3500,
    messages: [
      { role: 'system', content: system(P.ADVERSARIAL_VALIDATION_PROMPT) },
      {
        role: 'user',
        content: [
          `PROBLEM UNDER TEST\n${JSON.stringify({ statement: problem.problem_statement, underlying: problem.underlying_problem, audience: niche.target_audience, desired_outcome: niche.desired_outcome }, null, 2)}`,
          `\nVALIDATION EVIDENCE (second, adversarial search pass — only these IDs are valid)\n${block}`,
          `\nAssign validation_status. Use "insufficient_evidence" when the sources do not actually address this problem. Cite real IDs for both supporting and contradicting evidence.`,
        ].join('\n'),
      },
    ],
  });
  bump(ctx, res);

  const parsed = ValidationZ.safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected validation shape.', { detail: parsed.error.message, retryable: true });
  const v = parsed.data;
  const supporting = v.supporting_evidence_ids.filter((id) => validIds.has(id));
  const contradicting = v.contradicting_evidence_ids.filter((id) => validIds.has(id));

  const considered = supporting.length + contradicting.length;
  const contradiction_rate = considered ? round1(contradicting.length / considered) : 0;

  const citedEvidence = [...supporting, ...contradicting].map((id) => pool.find((e) => e.id === id)!).filter(Boolean);
  const confidence_components = computeConfidence({
    evidence: citedEvidence.length ? citedEvidence : pool,
    supporting,
    contradicting,
    directnessFromModel: v.confidence,
  });

  const statusMap: Record<string, Validation['status']> = {
    validated: 'validated', promising: 'promising', mixed: 'mixed', weak: 'weak', insufficient_evidence: 'insufficient_evidence',
  };
  const confidenceValue = confidenceFromComponents(confidence_components, citedEvidence.length || pool.length);
  return {
    id: uid('val'),
    research_run_id: runId,
    problem_id: problem.id,
    supporting_evidence_ids: supporting,
    contradicting_evidence_ids: contradicting,
    validation_evidence_ids: pool.map((e) => e.id),
    contradiction_rate,
    confidence: confidenceValue,
    status: statusMap[v.validation_status] ?? 'mixed',
    reasoning_summary: [v.reasoning_summary, v.demand_vs_saturation, v.monetization_signals, ...v.disproof_notes.map((d) => `Risk: ${d}`)].filter(Boolean).join('\n\n'),
    confidence_components,
    searches_run: searchesRun,
    created_at: new Date().toISOString(),
  };
}

/* ========================= 7. score components ======================== */

const ScoreComponentZ = z.object({
  score: z.number().default(0),
  reason: z.string().default(''),
  evidence_ids: z.array(z.string()).default([]),
  assessment: z.string().default('inferred'),
});

export async function assessScoreComponents(
  ctx: Ctx,
  problem: Problem,
  niche: Niche,
  evidence: Evidence[],
  validation: Validation,
) {
  const validIds = new Set(evidence.map((e) => e.id));
  const supporting = evidence.filter((e) => validation.supporting_evidence_ids.includes(e.id));
  const contradicting = evidence.filter((e) => validation.contradicting_evidence_ids.includes(e.id));
  const others = evidence.filter((e) => !validation.supporting_evidence_ids.includes(e.id) && !validation.contradicting_evidence_ids.includes(e.id));
  const pool = [...supporting, ...contradicting, ...rankEvidenceUnsafe(others, niche.core_problem, 12)];

  const block = pool.map((e) => `[${e.id}] ${e.title} (${validation.supporting_evidence_ids.includes(e.id) ? 'SUPPORTING' : validation.contradicting_evidence_ids.includes(e.id) ? 'CONTRADICTING' : 'context'})\n  ${e.domain} · ${e.published_at ?? 'undated'} · age_days ${e.age_days ?? '?'} · reliability ${e.source_reliability}\n  ${(`${e.snippet} ${e.content}`).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n\n');

  const res = await runAI<any>(ctx.config, {
    schema_name: 'score_components',
    schema: S.SCORE_COMPONENTS_SCHEMA,
    temperature: 0,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: system(P.SCORING_ANALYST_PROMPT) },
      {
        role: 'user',
        content: [
          `PROBLEM\n${JSON.stringify({ statement: problem.problem_statement, audience: niche.target_audience, desired_outcome: niche.desired_outcome, validation_status: validation.status }, null, 2)}`,
          `\nEVIDENCE (only these IDs are valid; you will not compute the final score)\n${block}`,
          `\nScore all ten dimensions from 0-100 with reasons and evidence IDs. Downgrade rather than guess when evidence is thin.`,
        ].join('\n'),
      },
    ],
  });
  bump(ctx, res);

  const parsed = z.object({ components: z.record(ScoreComponentZ) }).safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected scoring shape.', { detail: parsed.error.message, retryable: true });

  const components = {} as Record<ComponentKey, { score: number; reason: string; evidence_ids: string[]; assessment?: 'direct' | 'inferred' | 'insufficient' }>;
  const keys: ComponentKey[] = ['current_demand', 'trend_momentum', 'pain_severity', 'willingness_to_pay', 'problem_frequency', 'market_gap', 'emotional_intensity', 'product_feasibility', 'viral_content_potential', 'competition_opportunity'];
  keys.forEach((k) => {
    const raw = parsed.data.components[k] ?? { score: 0, reason: 'Not assessed.', evidence_ids: [], assessment: 'insufficient' };
    // Model-supplied ids are validated; unknown ids are dropped before render.
    const ids = (raw.evidence_ids ?? []).filter((id) => validIds.has(id));
    components[k] = {
      score: Math.max(0, Math.min(100, raw.score ?? 0)),
      reason: raw.reason || 'No reason supplied.',
      evidence_ids: ids,
      assessment: (['direct', 'inferred', 'insufficient'].includes(raw.assessment) ? raw.assessment : 'inferred') as 'direct' | 'inferred' | 'insufficient',
    };
  });
  return components;
}

/* ============================ 8. report =============================== */

const ReportZ = z.object({
  opportunity_summary: z.string(),
  why_now: z.string().default(''),
  customer_problem: z.string().default(''),
  commercial_reason: z.string().default(''),
  risks: z.array(z.string()).default([]),
  recommended_action: z.string().default(''),
  positioning_angle: z.string().default(''),
  first_content_ideas: z.array(z.string()).default([]),
});

export async function generateReport(
  ctx: Ctx,
  problem: Problem,
  niche: Niche,
  validation: Validation,
  score: { final_score: number; evidence_confidence: number; base_score: number; score_label: string; contradiction_rate: number },
  evidence: Evidence[],
) {
  const supporting = evidence.filter((e) => validation.supporting_evidence_ids.includes(e.id)).slice(0, 14);
  const contradicting = evidence.filter((e) => validation.contradicting_evidence_ids.includes(e.id)).slice(0, 8);

  const res = await runAI<any>(ctx.config, {
    schema_name: 'opportunity_report',
    schema: S.REPORT_SCHEMA,
    temperature: 0.2,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: system(P.OPPORTUNITY_REPORT_PROMPT) },
      {
        role: 'user',
        content: [
          `OPPORTUNITY\n${JSON.stringify({ niche: niche.specific_niche, audience: niche.target_audience, problem: problem.problem_statement, underlying: problem.underlying_problem, desired_outcome: niche.desired_outcome, customer_language: problem.customer_language.slice(0, 8) }, null, 2)}`,
          `\nCOMPUTED SCORES (fixed — never change or restate differently)\n${JSON.stringify({ opportunity_score: score.final_score, base_score: score.base_score, evidence_confidence: score.evidence_confidence, contradiction_rate: score.contradiction_rate, label: score.score_label }, null, 2)}`,
          `\nVALIDATION STATUS: ${validation.status}\nVALIDATION REASONING: ${validation.reasoning_summary.slice(0, 1200)}`,
          `\nSUPPORTING EVIDENCE\n${supporting.map((e) => `[${e.id}] ${e.title} — ${e.domain} (${e.published_at ?? 'undated'})`).join('\n') || '(none)'}`,
          `\nCONTRADICTING EVIDENCE\n${contradicting.map((e) => `[${e.id}] ${e.title} — ${e.domain} (${e.published_at ?? 'undated'})`).join('\n') || '(none)'}`,
          `\nWrite the report. Where evidence is thin, say so plainly. Never invent facts or numbers.`,
        ].join('\n'),
      },
    ],
  });
  bump(ctx, res);
  const parsed = ReportZ.safeParse(res.data);
  if (!parsed.success) throw err('malformed_response', 'The model returned an unexpected report shape.', { detail: parsed.error.message, retryable: true });
  return parsed.data;
}

export { computeConfidence };
