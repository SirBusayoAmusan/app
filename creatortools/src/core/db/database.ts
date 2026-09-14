/* ------------------------------------------------------------------
   Local-first persistence. Everything the user creates lives in the
   browser (IndexedDB). API keys are NEVER written here — they live in
   session memory only (see core/ai/session.ts).
   ------------------------------------------------------------------ */
import Dexie, { type Table } from 'dexie';
import type {
  AudienceProfile, Campaign, Evidence, ID, LaunchPlan, MarketingAsset, Niche,
  OpportunityReport, OpportunityScore, PricingPlan, Problem, Product, Project,
  QuerySpec, ResearchRun, SettingsRow, Signal, Validation, AnalyticsSnapshot,
} from '../types';

export const DB_NAME = 'creatorToolsDB';
export const DB_VERSION = 2;
export const ENGINE_VERSION = '1.0.0';
export const PROMPT_VERSION = 'p1.0.0';
export const SCORING_VERSION = 's1.0.0';

export class CreatorToolsDB extends Dexie {
  settings!: Table<SettingsRow, string>;
  audience_profiles!: Table<AudienceProfile, string>;
  research_runs!: Table<ResearchRun, string>;
  search_queries!: Table<QuerySpec, string>;
  evidence!: Table<Evidence, string>;
  signals!: Table<Signal, string>;
  niches!: Table<Niche, string>;
  problems!: Table<Problem, string>;
  validations!: Table<Validation, string>;
  opportunity_scores!: Table<OpportunityScore, string>;
  reports!: Table<OpportunityReport, string>;
  projects!: Table<Project, string>;
  products!: Table<Product, string>;
  pricing!: Table<PricingPlan, string>;
  marketing!: Table<MarketingAsset, string>;
  campaigns!: Table<Campaign, string>;
  launch!: Table<LaunchPlan, string>;
  analytics!: Table<AnalyticsSnapshot, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      settings: 'id',
      audience_profiles: 'id, updated_at',
      research_runs: 'id, started_at, status, audience_profile_id',
      search_queries: 'id, research_run_id, query_type',
      evidence: 'id, research_run_id, domain, canonical_url, source_type, published_at',
      signals: 'id, research_run_id, niche_id, signal_type',
      niches: 'id, research_run_id, cluster_id, status',
      problems: 'id, niche_id, research_run_id, rank',
      validations: 'id, problem_id, status',
      opportunity_scores: 'id, problem_id, niche_id, final_score',
      reports: 'id, problem_id',
      projects: 'id, status, updated_at',
      products: 'id, project_id',
      pricing: 'id, project_id',
      marketing: 'id, project_id, module_key',
      campaigns: 'id, project_id, platform',
      launch: 'id, project_id',
      analytics: 'id, project_id, captured_at',
    });
    // v2: project lookups by the opportunity they came from (used when a
    // problem is opened again, and when deleting a run or a project).
    this.version(DB_VERSION).stores({
      settings: 'id',
      audience_profiles: 'id, updated_at',
      research_runs: 'id, started_at, status, audience_profile_id',
      search_queries: 'id, research_run_id, query_type',
      evidence: 'id, research_run_id, domain, canonical_url, source_type, published_at',
      signals: 'id, research_run_id, niche_id, signal_type',
      niches: 'id, research_run_id, cluster_id, status',
      problems: 'id, niche_id, research_run_id, rank',
      validations: 'id, problem_id, status',
      opportunity_scores: 'id, problem_id, niche_id, final_score',
      reports: 'id, problem_id',
      projects: 'id, status, updated_at, problem_id, niche_id, run_id',
      products: 'id, project_id',
      pricing: 'id, project_id',
      marketing: 'id, project_id, module_key',
      campaigns: 'id, project_id, platform',
      launch: 'id, project_id',
      analytics: 'id, project_id, captured_at',
    });
  }
}

export const db = new CreatorToolsDB();

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

export const nowISO = () => new Date().toISOString();

/* ------------------------------ settings ----------------------------- */

export const DEFAULT_METHODOLOGY = {
  max_queries: 24,
  results_per_query: 6,
  freshness_days: 90,
  priority_freshness_days: 30,
  minimum_evidence_items: 24,
  minimum_independent_domains: 8,
  minimum_supporting_sources: 3,
  cluster_threshold: 0.72,
  signal_batch_size: 14,
  analyze_top_niches: 5,
  max_problems_per_niche: 10,
};

export async function getSettings(): Promise<SettingsRow> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const fresh: SettingsRow = {
    id: 'app',
    theme: 'light',
    default_currency: 'USD',
    default_location: 'Global',
    default_language: 'English',
    ai: null,
    search: null,
    methodology: { ...DEFAULT_METHODOLOGY },
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  await db.settings.put(fresh);
  return fresh;
}

export async function updateSettings(patch: Partial<SettingsRow>): Promise<SettingsRow> {
  const current = await getSettings();
  const next = { ...current, ...patch, updated_at: nowISO() };
  await db.settings.put(next);
  return next;
}

/* ---------------------------- audience ------------------------------- */

export async function blankAudience(): Promise<AudienceProfile> {
  const s = await getSettings();
  return {
    id: uid('aud'),
    name: 'My audience',
    age_min: 22,
    age_max: 40,
    gender: 'All genders',
    location: s.default_location,
    language: s.default_language,
    income_level: 'Middle income',
    employment_status: 'Employed or self-employed',
    experience_level: 'Beginner',
    interests: [],
    business_type: 'Aspiring digital product creator',
    life_stage: 'Early career',
    platforms: ['Instagram', 'TikTok', 'YouTube'],
    is_active: true,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

export async function getActiveAudience(): Promise<AudienceProfile | null> {
  const all = await db.audience_profiles.toArray();
  if (!all.length) return null;
  return all.find((a) => a.is_active) ?? all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
}

export async function saveAudience(profile: AudienceProfile): Promise<AudienceProfile> {
  const next = { ...profile, updated_at: nowISO() };
  await db.audience_profiles.put(next);
  return next;
}

/* --------------------------- run plumbing ---------------------------- */

export async function createRun(profile: AudienceProfile, partial: Partial<ResearchRun> = {}): Promise<ResearchRun> {
  const s = await getSettings();
  const run: ResearchRun = {
    id: uid('run'),
    audience_profile_id: profile.id,
    audience_snapshot: profile,
    research_type: 'niche_discovery',
    status: 'queued',
    stage: 'init',
    progress: 0,
    stages: [],
    started_at: nowISO(),
    completed_at: null,
    engine_version: ENGINE_VERSION,
    prompt_version: PROMPT_VERSION,
    scoring_version: SCORING_VERSION,
    search_provider: s.search?.id ?? 'none',
    ai_provider: s.ai?.provider,
    ai_model: s.ai?.model,
    usage: { ai_calls: 0, search_calls: 0, tokens_in: 0, tokens_out: 0, evidence_collected: 0 },
    error: null,
    ...partial,
  };
  await db.research_runs.put(run);
  return run;
}

export async function patchRun(id: ID, patch: Partial<ResearchRun>): Promise<void> {
  await db.research_runs.update(id, patch as any);
}

export async function bumpUsage(id: ID, delta: Partial<ResearchRun['usage']>): Promise<void> {
  const run = await db.research_runs.get(id);
  if (!run) return;
  const usage = { ...run.usage };
  (Object.keys(delta) as (keyof ResearchRun['usage'])[]).forEach((k) => {
    usage[k] = (usage[k] ?? 0) + (delta[k] ?? 0);
  });
  await db.research_runs.update(id, { usage });
}

export async function getRunBundle(runId: ID) {
  const [run, queries, evidence, signals, niches, problems, validations, scores, reports] = await Promise.all([
    db.research_runs.get(runId),
    db.search_queries.where('research_run_id').equals(runId).toArray(),
    db.evidence.where('research_run_id').equals(runId).toArray(),
    db.signals.where('research_run_id').equals(runId).toArray(),
    db.niches.where('research_run_id').equals(runId).toArray(),
    db.problems.where('research_run_id').equals(runId).toArray(),
    db.validations.toArray(),
    db.opportunity_scores.toArray(),
    db.reports.toArray(),
  ]);
  const problemIds = new Set(problems.map((p) => p.id));
  return {
    run,
    queries,
    evidence,
    signals,
    niches: niches.sort((a, b) => b.specificity_score - a.specificity_score),
    problems: problems.sort((a, b) => a.rank - b.rank),
    validations: validations.filter((v) => problemIds.has(v.problem_id)),
    scores: scores.filter((s) => problemIds.has(s.problem_id)),
    reports: reports.filter((r) => problemIds.has(r.problem_id)),
  };
}

export async function deleteRun(runId: ID) {
  await db.transaction('rw', [db.research_runs, db.search_queries, db.evidence, db.signals,
    db.niches, db.problems, db.validations, db.opportunity_scores, db.reports], async () => {
      const problems = await db.problems.where('research_run_id').equals(runId).toArray();
      const pids = problems.map((p) => p.id);
      await db.validations.where('problem_id').anyOf(pids).delete();
      await db.opportunity_scores.where('problem_id').anyOf(pids).delete();
      await db.reports.where('problem_id').anyOf(pids).delete();
      await db.problems.where('research_run_id').equals(runId).delete();
      await db.niches.where('research_run_id').equals(runId).delete();
      await db.signals.where('research_run_id').equals(runId).delete();
      await db.evidence.where('research_run_id').equals(runId).delete();
      await db.search_queries.where('research_run_id').equals(runId).delete();
      await db.research_runs.delete(runId);
    });
}

export async function wipeEverything() {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}

export async function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  out.__meta = [{ exported_at: nowISO(), engine_version: ENGINE_VERSION, db: DB_NAME, schema: DB_VERSION }] as any;
  return out;
}

export async function importAll(data: Record<string, any[]>) {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      const rows = data[t.name];
      if (Array.isArray(rows) && rows.length) await t.bulkPut(rows as any);
    }
  });
}
