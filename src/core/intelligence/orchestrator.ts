/* ------------------------------------------------------------------
   The research orchestrator: user's provider → live search → evidence →
   AI analysis → deterministic scoring → opportunity.

   Order matters and is fixed:
     1 collect audience context      7 cluster into specific niches
     2 generate search hypotheses    8 mine problems inside niches
     3 build layered query plan      9 adversarial validation (+ searches)
     4 execute current-market search 10 deterministic scoring
     5 normalize + weight evidence   11 opportunity report
     6 extract evidence-bound signals
   ------------------------------------------------------------------ */
import type {
  AudienceProfile, Evidence, ID, Niche, Problem, ProgressEvent, QuerySpec, ResearchRun, SettingsRow, SearchProviderConfig } from '../types';
import { db, bumpUsage, createRun, nowISO, patchRun, uid } from '../db/database';
import { err, mapLimit, rankEvidenceUnsafe, round1, tokenize } from './fingerprint';
import { resetKeylessBudget, runSearch, searchProviderReady, type RawResult } from './searchProviders';
import { buildQuerySet, buildValidationQueries, deterministicHypotheses, type Hypothesis } from './queryEngine';
import { evidencePromptBlock, evidenceStats, normalizeEvidence } from './evidenceEngine';
import {
  assessScoreComponents, clusterNiches, extractSignals, generateHypotheses, generateNiches,
  generateProblems, generateReport, validateProblem,
} from './aiEngines';
import { buildScoreRecord, computeOpportunityScore, evidenceGate } from './scoringEngine';
import { getCredential } from '../ai/session';
import { getSettings } from '../db/database';

export type StageKey =
  | 'context' | 'hypotheses' | 'plan' | 'search' | 'normalize' | 'signals'
  | 'niches' | 'problems' | 'validate' | 'score' | 'report';

export interface StageDef { key: StageKey; label: string; verb: string }

/** Labels double as the intelligent loading states in the UI. */
export const STAGES: StageDef[] = [
  { key: 'context', label: 'Your audience', verb: 'Working out who you are selling to' },
  { key: 'hypotheses', label: 'What to look for', verb: 'Deciding what to search for' },
  { key: 'plan', label: 'The plan', verb: 'Planning the searches' },
  { key: 'search', label: 'Real sources', verb: 'Reading current posts and pages' },
  { key: 'normalize', label: 'Tidying up', verb: 'Removing repeats and noise' },
  { key: 'signals', label: 'What people say', verb: 'Picking out what people actually complain about' },
  { key: 'niches', label: 'Groups of people', verb: 'Grouping similar problems together' },
  { key: 'problems', label: 'The problems', verb: 'Naming the specific problems' },
  { key: 'validate', label: 'Fact-checking', verb: 'Trying to prove each one wrong' },
  { key: 'score', label: 'Scoring', verb: 'Scoring each opportunity' },
  { key: 'report', label: 'Your report', verb: 'Writing up what we found' },
];

export interface RunHandle {
  runId: string;
  cancel: () => void;
}

const cancelled = new Set<string>();
export function isCancelled(runId: string) { return cancelled.has(runId); }
export function cancelRun(runId: string) { cancelled.add(runId); }

function stageLogger(runId: ID) {
  const rows = new Map<StageKey, any>();
  STAGES.forEach((s) => rows.set(s.key, { key: s.key, label: s.verb, status: 'pending' }));
  let persisted = false;

  const flush = async () => {
    await patchRun(runId, { stages: [...rows.values()] });
    persisted = true;
  };
  return {
    async start(key: StageKey, detail?: string) {
      const row = rows.get(key);
      row.status = 'running';
      row.started_at = nowISO();
      if (detail) row.detail = detail;
      await flush();
    },
    async done(key: StageKey, detail?: string) {
      const row = rows.get(key);
      row.status = 'done';
      row.finished_at = nowISO();
      row.ms = row.started_at ? Date.now() - new Date(row.started_at).getTime() : undefined;
      if (detail) row.detail = detail;
      await flush();
    },
    async skip(key: StageKey, detail: string) {
      const row = rows.get(key);
      row.status = 'skipped';
      row.detail = detail;
      await flush();
    },
    async fail(key: StageKey, message: string) {
      const row = rows.get(key);
      row.status = 'failed';
      row.error = message;
      row.finished_at = nowISO();
      await flush();
    },
    rows,
    hasRun: () => persisted,
  };
}

async function collectEvidence(
  runId: ID,
  queries: QuerySpec[],
  settings: SettingsRow,
  audience: AudienceProfile,
  onProgress: (done: number, total: number) => void,
  queryTypeOverrides?: (q: QuerySpec) => QuerySpec['query_type'],
  tag: 'validation' | undefined = undefined,
) {
  const cfg = settings.search ?? ({ id: 'community', enabled: true } as SearchProviderConfig);
  let searchCalls = 0;
  const errors: { query: string; error: string }[] = [];
  const hits = await mapLimit(queries, 3, async (q) => {
    if (isCancelled(runId)) return [] as RawResult[];
    try {
      const rows = await runSearch(cfg, q.query, {
        max_results: settings.methodology.results_per_query,
        freshness_days: settings.methodology.freshness_days,
        topic: /news|trend/i.test(q.query) ? 'news' : 'general',
        gl: countryCode(audience.location),
        hl: languageCode(audience.language),
        depth: q.query_type === 'contrarian' || q.query_type === 'purchase_intent' ? 'deep' : 'basic',
      });
      searchCalls++;
      await db.search_queries.update(q.id, { executed: true, results_count: rows.length });
      return rows.map((r) => ({ result: r, query: q.query, query_type: (queryTypeOverrides?.(q) ?? tag ?? q.query_type) as any }));
    } catch (e: any) {
      errors.push({ query: q.query, error: e?.message ?? 'search failed' });
      return [] as RawResult[];
    }
  }, onProgress);

  const inputs = hits.flat() as { result: RawResult; query: string; query_type: any }[];
  const { evidence, dropped } = normalizeEvidence(runId, inputs, audience);
  await bumpUsage(runId, { search_calls: searchCalls, evidence_collected: evidence.length });
  return { evidence, errors, dropped, searchCalls };
}

const COUNTRY: Record<string, string> = {
  nigeria: 'ng', 'united states': 'us', usa: 'us', uk: 'gb', 'united kingdom': 'gb', canada: 'ca',
  india: 'in', kenya: 'ke', 'south africa': 'za', ghana: 'gh', australia: 'au', germany: 'de',
  france: 'fr', brazil: 'br', philippines: 'ph', pakistan: 'pk', egypt: 'eg', uae: 'ae',
};
const LANGUAGE: Record<string, string> = { english: 'en', spanish: 'es', french: 'fr', portuguese: 'pt', german: 'de', arabic: 'ar', hindi: 'hi', swahili: 'sw' };
export const countryCode = (location: string) => COUNTRY[(location || '').toLowerCase().trim()] ?? undefined;
export const languageCode = (language: string) => LANGUAGE[(language || '').toLowerCase().trim()] ?? 'en';

export interface StartOptions {
  audience: AudienceProfile;
  onProgress: (e: ProgressEvent) => void;
  dryRunPlan?: boolean;
}

export interface RunSummary {
  runId: string;
  evidence: number;
  niches: number;
  problems: number;
  scored: number;
  warnings: string[];
  insufficient: boolean;
}

/** Full pipeline. Persists everything as it goes so nothing is lost on failure. */
export async function runDiscovery(opts: StartOptions): Promise<RunSummary> {
  const settings = await getSettings();
  const { audience, onProgress } = opts;
  const warnings: string[] = [];

  if (!settings.ai) throw err('no_provider', 'Connect an AI provider before running discovery.');
  if (!getCredential('ai')) throw err('invalid_api_key', 'No API key in this session. Reconnect your provider.');

  const run = await createRun(audience, { status: 'running', stage: 'context' });
  const log = stageLogger(run.id);
  const aiCtx = {
    config: settings.ai,
    onUsage: (u: any) => { void bumpUsage(run.id, { ai_calls: u.calls ?? 0, tokens_in: u.tokens_in ?? 0, tokens_out: u.tokens_out ?? 0 }); },
  };

  const step = (pct: number, key: StageKey, detail?: string) => {
    const def = STAGES.find((s) => s.key === key)!;
    onProgress({ key, label: def.verb, detail, pct });
  };

  try {
    /* 1 — context ---------------------------------------------------- */
    await log.start('context');
    step(2, 'context');
    if (!audience.interests.length && !audience.business_type) {
      warnings.push('Your audience has no interests or business type set — hypothesis quality will be limited. Edit the audience for sharper results.');
    }
    await log.done('context', `Audience: ${audience.age_min}-${audience.age_max}, ${audience.location}`);

    /* 2 — hypotheses ------------------------------------------------- */
    let hypothesis: Hypothesis;
    await log.start('hypotheses');
    step(6, 'hypotheses');
    try {
      const h = await generateHypotheses(aiCtx, audience);
      hypothesis = {
        topics: h.topics.map((t) => ({ topic: t.topic, context: t.context })),
        audience_descriptors: h.audience_descriptors,
        market: audience.location,
      };
      await log.done('hypotheses', `${hypothesis.topics.length} topic hypotheses (model-proposed, unverified)`);
    } catch (e: any) {
      hypothesis = deterministicHypotheses(audience);
      warnings.push(`Hypothesis generation failed (${e?.message ?? e}). Fell back to deterministic topics from your audience profile.`);
      await log.done('hypotheses', `${hypothesis.topics.length} deterministic topics (fallback)`);
    }

    /* 3 — query plan ------------------------------------------------- */
    await log.start('plan');
    step(12, 'plan');
    const querySet = buildQuerySet(run.id, audience, hypothesis, { max_queries: settings.methodology.max_queries });
    await db.search_queries.bulkPut(querySet.queries);
    warnings.push(...querySet.warnings);
    await log.done('plan', `${querySet.queries.length} queries across ${querySet.layersCovered.length}/9 layers`);

    if (opts.dryRunPlan) {
      await patchRun(run.id, { status: 'complete', stage: 'plan', progress: 100, completed_at: nowISO() });
      return { runId: run.id, evidence: 0, niches: 0, problems: 0, scored: 0, warnings, insufficient: true };
    }

    /* 4 — live search ------------------------------------------------ */
    /* Per-source call budgets are per run, so refill them here. */
    resetKeylessBudget();
    const ready = searchProviderReady(settings.search);
    await log.start('search');
    step(18, 'search');
    let evidence: Evidence[] = [];
    if (!ready.ready) {
      warnings.push(ready.reason);
      await log.skip('search', ready.reason);
      await log.skip('normalize', 'No evidence to normalise.');
      await log.skip('signals', 'No evidence to analyse.');
      await log.skip('niches', 'No evidence to cluster.');
      await log.skip('problems', 'Blocked: no evidence.');
      await log.skip('validate', 'Blocked: no evidence.');
      await log.skip('score', 'Blocked: no evidence.');
      await log.skip('report', 'Blocked: no evidence.');
      await patchRun(run.id, { status: 'partial', stage: 'search', progress: 100, completed_at: nowISO(), error: ready.reason });
      onProgress({ key: 'search', label: 'No live evidence collected', detail: ready.reason, pct: 100 });
      return { runId: run.id, evidence: 0, niches: 0, problems: 0, scored: 0, warnings, insufficient: true };
    }

    const collected = await collectEvidence(run.id, querySet.queries, settings, audience, (done, total) => {
      step(18 + (done / total) * 24, 'search', `${done}/${total} queries · ${collected_evidence_estimate(done)} sources so far`);
    });
    evidence = collected.evidence;
    if (collected.errors.length) warnings.push(`${collected.errors.length} search quer${collected.errors.length === 1 ? 'y' : 'ies'} failed (rate limit or provider error). Evidence from the remaining queries was used.`);
    const droppedNote = collected.dropped.filter((d) => d.count > 0).map((d) => `${d.count} ${d.reason}`).join(', ');
    await log.done('search', `${querySet.queries.length} queries · ${evidence.length} unique sources${droppedNote ? ` · removed: ${droppedNote}` : ''}`);

    /* 5 — normalize -------------------------------------------------- */
    await log.start('normalize');
    step(45, 'normalize');
    await db.evidence.bulkPut(evidence);
    const stats = evidenceStats(evidence);
    const minEvidence = settings.methodology.minimum_evidence_items;
    if (evidence.length < minEvidence) {
      warnings.push(`Only ${evidence.length} usable sources were found (methodology minimum ${minEvidence}). Scores will be marked insufficient evidence rather than guessed.`);
    }
    if (stats.independent_domains < settings.methodology.minimum_independent_domains) {
      warnings.push(`Sources clustered around ${stats.independent_domains} domains — independent corroboration is thin.`);
    }
    if (stats.recent_30 + stats.recent_90 === 0) {
      warnings.push('No evidence published in the last 90 days was found — no current-trend claim can be made for this run.');
    }
    await log.done('normalize', `${evidence.length} sources · ${stats.independent_domains} domains · ${stats.independent_clusters} independent clusters · ${stats.recent_90} within 90 days`);

    /* 6 — signals ---------------------------------------------------- */
    await log.start('signals');
    step(52, 'signals');
    const batches = chunkEvidence(evidence, settings.methodology.signal_batch_size, audience);
    const signalResult = await extractSignals(aiCtx, audience, batches.map((b) => ({ evidence: b, block: evidencePromptBlock(b) })));
    await db.signals.bulkPut(signalResult.signals);
    if (signalResult.rejected.length) {
      warnings.push(`${signalResult.rejected.length} model claim(s) were discarded for citing evidence that does not exist.`);
    }
    await log.done('signals', `${signalResult.signals.length} evidence-bound signals from ${signalResult.batches} batches`);

    if (signalResult.signals.length < 4) {
      await log.skip('niches', 'Too few signals to build defensible niches.');
      await patchRun(run.id, { status: 'partial', stage: 'signals', progress: 100, completed_at: nowISO(), error: 'Insufficient signals.' });
      return { runId: run.id, evidence: evidence.length, niches: 0, problems: 0, scored: 0, warnings, insufficient: true };
    }

    /* 7 — niches ----------------------------------------------------- */
    await log.start('niches');
    step(60, 'niches');
    const nicheResult = await generateNiches(aiCtx, audience, signalResult.signals, evidence, { minEvidence: 3 });
    const clusters = clusterNiches(nicheResult.niches, settings.methodology.cluster_threshold);
    const niches: Niche[] = clusters.map((c) => c.canonical);
    niches.forEach((n) => {
      const failures: string[] = [];
      if (n.evidence_count < 5) failures.push(`${n.evidence_count} evidence items (5+ recommended)`);
      if (n.independent_domains < 3) failures.push(`${n.independent_domains} independent domains (3+ recommended)`);
      if (n.recent_evidence_count === 0) failures.push('No evidence from the last 90 days');
      if (n.specificity_score < 55) failures.push('Specificity score below 55 — likely too broad');
      n.quality_gate = { passed: failures.length === 0, failures, warnings: n.specificity_notes.slice(0, 3) };
      n.status = failures.length === 0 ? 'candidate' : 'rejected';
    });
    await db.niches.bulkPut(niches);
    if (nicheResult.rejected.length) warnings.push(`${nicheResult.rejected.length} niche candidate(s) were rejected by the evidence gate.`);
    await log.done('niches', `${niches.length} niches from ${nicheResult.niches.length} candidates (${nicheResult.niches.length - niches.length} merged as duplicates)`);

    /* 8 — problems --------------------------------------------------- */
    const rankedNiches = niches
      .filter((n) => n.status === 'candidate')
      .sort((a, b) => (b.specificity_score + b.evidence_count * 2) - (a.specificity_score + a.evidence_count * 2));
    const topNiches = rankedNiches.slice(0, settings.methodology.analyze_top_niches);
    if (!topNiches.length) {
      await log.skip('problems', 'Every niche failed the evidence gate.');
    } else {
      await log.start('problems');
      step(68, 'problems');
      const allProblems: Problem[] = [];
      for (let i = 0; i < topNiches.length; i++) {
        const niche = topNiches[i];
        step(68 + (i / topNiches.length) * 10, 'problems', `${niche.specific_niche.slice(0, 60)}…`);
        try {
          const res = await generateProblems(aiCtx, niche, evidence, signalResult.signals, settings.methodology.max_problems_per_niche);
          allProblems.push(...res.problems);
        } catch (e: any) {
          warnings.push(`Problem mining failed for “${niche.specific_niche.slice(0, 48)}…” — ${e?.message ?? e}`);
        }
      }
      await db.problems.bulkPut(allProblems);
      await log.done('problems', `${allProblems.length} problems across ${topNiches.length} niches`);
      if (rankedNiches.length > topNiches.length) {
        warnings.push(`${rankedNiches.length - topNiches.length} additional niches were discovered but not yet mined for problems — open a niche and run problem mining on demand.`);
      }
    }

    /* 9/10/11 — validate, score, report ------------------------------ */
    const problems = (await db.problems.where('research_run_id').equals(run.id).toArray())
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 12);
    const scored: string[] = [];
    for (let i = 0; i < problems.length; i++) {
      if (isCancelled(run.id)) break;
      const problem = problems[i];
      const niche = niches.find((n) => n.id === problem.niche_id)!;
      const pct = 78 + (i / Math.max(1, problems.length)) * 18;
      try {
        step(pct, 'validate', `Validating “${problem.problem_statement.slice(0, 52)}…”`);
        const validation = await validateAndScore(aiCtx, run, settings, problem, niche, evidence, (label) => step(pct, 'validate', label));
        scored.push(validation.problem_id);
      } catch (e: any) {
        warnings.push(`Validation/scoring failed for “${problem.problem_statement.slice(0, 40)}…” — ${e?.message ?? e}`);
      }
    }
    await log.done('validate', `${scored.length}/${problems.length} problems validated`);
    await log.done('score', `${scored.length} opportunities scored (deterministic engine ${'s1.0.0'})`);
    await log.done('report', `${scored.length} opportunity reports generated`);

    const status = scored.length ? 'complete' : 'partial';
    await patchRun(run.id, { status, stage: 'done', progress: 100, completed_at: nowISO(), error: status === 'partial' ? warnings[0] ?? null : null });
    onProgress({ key: 'done', label: 'Opportunity report ready', pct: 100 });

    return {
      runId: run.id,
      evidence: evidence.length,
      niches: niches.length,
      problems: problems.length,
      scored: scored.length,
      warnings,
      insufficient: scored.length === 0,
    };
  } catch (e: any) {
    const key = (await db.research_runs.get(run.id))?.stage as StageKey | undefined;
    if (key) await log.fail(key, e?.message ?? 'failed');
    await patchRun(run.id, { status: 'failed', progress: 100, completed_at: nowISO(), error: e?.message ?? 'Run failed.' });
    throw e;
  }
}

/** Rough live counter for the progress copy (evidence is counted after normalisation). */
let collected_evidence_estimate = (done: number) => done * 4;

function chunkEvidence(evidence: Evidence[], size: number, audience: AudienceProfile): Evidence[][] {
  const focus = [...audience.interests, audience.business_type, audience.location].join(' ');
  const ranked = rankEvidenceUnsafe(evidence, focus, evidence.length);
  const out: Evidence[][] = [];
  for (let i = 0; i < ranked.length; i += size) out.push(ranked.slice(i, i + size));
  return out;
}

/** Stages 9-11 for one problem: adversarial search → validation → score → report. */
export async function validateAndScore(
  aiCtx: { config: any; onUsage?: (u: any) => void },
  run: ResearchRun,
  settings: SettingsRow,
  problem: Problem,
  niche: Niche,
  baseEvidence: Evidence[],
  onLabel?: (label: string) => void,
): Promise<{ problem_id: string; validation_id: string; score_id: string; status: string }> {
  // 9a — adversarial search pass (new queries, new evidence)
  let validationEvidence = baseEvidence;
  let searchesRun = 0;
  const ready = searchProviderReady(settings.search);
  if (ready.ready) {
    onLabel?.('Running the disproof searches');
    const vQueries = buildValidationQueries(problem.problem_statement, run.audience_snapshot, 10)
      .map((q) => ({ ...q, research_run_id: run.id }));
    await db.search_queries.bulkPut(vQueries);
    const collected = await collectEvidence(run.id, vQueries, settings, run.audience_snapshot, () => {}, undefined, 'validation' as any);
    searchesRun = vQueries.length;
    const existing = new Set(baseEvidence.map((e) => e.id));
    validationEvidence = [...baseEvidence, ...collected.evidence.filter((e) => !existing.has(e.id))];
    await db.evidence.bulkPut(collected.evidence);
  } else {
    onLabel?.('No search provider — validating against existing evidence only');
  }

  const relevant = rankEvidenceUnsafe(
    validationEvidence,
    `${problem.problem_statement} ${niche.core_problem} ${problem.underlying_problem}`,
    44,
  );

  onLabel?.('Attempting to disprove the opportunity');
  const validation = await validateProblem(aiCtx, problem, niche, relevant, run.id, searchesRun);
  await db.validations.put(validation);

  onLabel?.('Comparing opportunity signals');
  const components = await assessScoreComponents(aiCtx, problem, niche, relevant, validation);
  const supporting = relevant.filter((e) => validation.supporting_evidence_ids.includes(e.id));
  const contradicting = relevant.filter((e) => validation.contradicting_evidence_ids.includes(e.id));
  const gate = evidenceGate([...supporting, ...contradicting].length >= 5 ? [...supporting, ...contradicting] : relevant);

  const computed = computeOpportunityScore({
    problem_id: problem.id,
    niche_id: niche.id,
    research_run_id: run.id,
    components,
    evidence: relevant,
    supporting_ids: validation.supporting_evidence_ids,
    contradicting_ids: validation.contradicting_evidence_ids,
    validation_status: validation.status,
  });
  if (!gate.passed && !computed.insufficient_evidence) {
    computed.insufficient_evidence = true;
    computed.arithmetic.push(`gate: ${gate.failures.join('; ')}`);
  }

  const record = buildScoreRecord({
    problem_id: problem.id,
    niche_id: niche.id,
    research_run_id: run.id,
    components,
    evidence: relevant,
    supporting_ids: validation.supporting_evidence_ids,
    contradicting_ids: validation.contradicting_evidence_ids,
    validation_status: validation.status,
    computed,
  });
  await db.opportunity_scores.put(record);

  onLabel?.('Building the opportunity report');
  try {
    const report = await generateReport(aiCtx, problem, niche, validation, {
      final_score: record.final_score,
      base_score: record.base_score,
      evidence_confidence: record.evidence_confidence,
      score_label: record.score_label,
      contradiction_rate: record.contradiction_rate,
    }, relevant);
    await db.reports.put({ id: uid('rep'), research_run_id: run.id, problem_id: problem.id, generated_at: nowISO(), ...(report as any) });
  } catch {
    /* the report is optional; scores and evidence remain available */
  }

  return { problem_id: problem.id, validation_id: validation.id, score_id: record.id, status: validation.status };
}

/** On-demand mining for a niche that was discovered but not analysed in the run. */
export async function mineProblemsForNiche(nicheId: ID, onProgress?: (label: string) => void) {
  const settings = await getSettings();
  const niche = await db.niches.get(nicheId);
  if (!niche) throw err('unknown', 'Niche not found.');
  if (!settings.ai) throw err('no_provider', 'Connect an AI provider first.');
  const evidence = await db.evidence.where('research_run_id').equals(niche.research_run_id).toArray();
  const signals = await db.signals.where('research_run_id').equals(niche.research_run_id).toArray();
  const run = await db.research_runs.get(niche.research_run_id);
  if (!run) throw err('unknown', 'Run not found.');
  onProgress?.('Mining problems for this niche');
  const ctx = { config: settings.ai, onUsage: (u: any) => { void bumpUsage(run.id, { ai_calls: u.calls ?? 0, tokens_in: u.tokens_in ?? 0, tokens_out: u.tokens_out ?? 0 }); } };
  const res = await generateProblems(ctx, niche, evidence, signals, settings.methodology.max_problems_per_niche);
  await db.problems.bulkPut(res.problems);
  return { problems: res.problems.length, rejected: res.rejected };
}

/** Validate + score an existing problem on demand (used from niche detail). */
export async function scoreProblemNow(problemId: ID, onLabel?: (l: string) => void) {
  const settings = await getSettings();
  if (!settings.ai) throw err('no_provider', 'Connect an AI provider first.');
  const problem = await db.problems.get(problemId);
  if (!problem) throw err('unknown', 'Problem not found.');
  const niche = await db.niches.get(problem.niche_id);
  if (!niche) throw err('unknown', 'Niche not found.');
  const run = await db.research_runs.get(problem.research_run_id);
  if (!run) throw err('unknown', 'Run not found.');
  const evidence = await db.evidence.where('research_run_id').equals(run.id).toArray();
  const ctx = { config: settings.ai, onUsage: (u: any) => { void bumpUsage(run.id, { ai_calls: u.calls ?? 0, tokens_in: u.tokens_in ?? 0, tokens_out: u.tokens_out ?? 0 }); } };
  return validateAndScore(ctx, run, settings, problem, niche, evidence, onLabel);
}

export { round1, tokenize };
