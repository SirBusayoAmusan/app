/* ------------------------------------------------------------------
   CreatorTools — shared domain types.
   These mirror the local IndexedDB schema (creatorToolsDB v1) and the
   strict JSON contracts the AI provider must satisfy.
   ------------------------------------------------------------------ */

export type ID = string;
export type ISO = string;

export type ProviderId = 'groq' | 'openrouter' | 'custom';
export type StructuredMode = 'json_schema' | 'json_object' | 'text';
export type SearchProviderId = 'tavily' | 'serper' | 'exa' | 'none';
export type SourceType =
  | 'search_result' | 'news' | 'reddit' | 'youtube' | 'forum'
  | 'marketplace' | 'trend_data' | 'social' | 'competitor' | 'other';

export type SignalType =
  | 'problem' | 'desire' | 'pain' | 'urgency' | 'purchase_intent' | 'trend'
  | 'growth' | 'complaint' | 'market_gap' | 'competitor' | 'content_demand'
  | 'emotional_intensity' | 'solution_failure' | 'question';

export type RunStatus = 'queued' | 'running' | 'complete' | 'failed' | 'partial';
export type ValidationStatus = 'validated' | 'promising' | 'mixed' | 'weak' | 'insufficient_evidence';
export type NicheStatus = 'candidate' | 'validated' | 'rejected';
export type ProjectStatus = 'idea' | 'building' | 'launched' | 'archived';

export type ComponentKey =
  | 'current_demand' | 'trend_momentum' | 'pain_severity' | 'willingness_to_pay'
  | 'problem_frequency' | 'market_gap' | 'emotional_intensity' | 'product_feasibility'
  | 'viral_content_potential' | 'competition_opportunity';

/* ----------------------------- settings ----------------------------- */

export interface AIProviderConfig {
  provider: ProviderId;
  model: string;
  base_url: string;
  /** For OpenRouter, sent as attribution headers. Never contains secrets. */
  app_title?: string;
  app_url?: string;
  /** Optional capability override once detected / known. */
  structured_mode?: StructuredMode | null;
  temperature?: number;
  /** Optional extra headers for custom OpenAI-compatible gateways. */
  extra_headers?: Record<string, string>;
}

export interface SearchProviderConfig {
  id: SearchProviderId;
  /** Optional self-hosted CORS proxy base (e.g. https://my-proxy.dev/?url=) */
  proxy?: string;
  enabled: boolean;
}

export interface Methodology {
  max_queries: number;
  results_per_query: number;
  freshness_days: number;
  priority_freshness_days: number;
  minimum_evidence_items: number;
  minimum_independent_domains: number;
  minimum_supporting_sources: number;
  cluster_threshold: number;
  signal_batch_size: number;
  analyze_top_niches: number;
  max_problems_per_niche: number;
}

export interface SettingsRow {
  id: 'app';
  theme: 'light' | 'dark' | 'system';
  default_currency: string;
  default_location: string;
  default_language: string;
  ai: AIProviderConfig | null;
  search: SearchProviderConfig | null;
  methodology: Methodology;
  created_at: ISO;
  updated_at: ISO;
}

/* ---------------------------- audience ------------------------------ */

export interface AudienceProfile {
  id: ID;
  name: string;
  age_min: number;
  age_max: number;
  gender: string;
  location: string;
  language: string;
  income_level: string;
  employment_status: string;
  experience_level: string;
  interests: string[];
  business_type: string;
  life_stage: string;
  platforms: string[];
  is_active?: boolean;
  created_at: ISO;
  updated_at: ISO;
}

/* ---------------------------- research ------------------------------ */

export interface ResearchRun {
  id: ID;
  audience_profile_id: ID;
  audience_snapshot: AudienceProfile;
  research_type: 'niche_discovery';
  status: RunStatus;
  stage: string;
  progress: number;
  stages: RunStageLog[];
  started_at: ISO;
  completed_at?: ISO | null;
  engine_version: string;
  prompt_version: string;
  scoring_version: string;
  search_provider?: SearchProviderId;
  ai_provider?: ProviderId;
  ai_model?: string;
  usage: { ai_calls: number; search_calls: number; tokens_in: number; tokens_out: number; evidence_collected: number };
  error?: string | null;
  is_fixture?: boolean;
}

export interface RunStageLog {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  started_at?: ISO;
  finished_at?: ISO;
  ms?: number;
  error?: string;
}

export interface QuerySpec {
  id: ID;
  research_run_id: ID;
  query: string;
  query_type: QueryType;
  layer: number;
  intent: string;
  generated_by: 'rules' | 'ai';
  executed: boolean;
  results_count: number;
}

export type QueryType =
  | 'broad_discovery' | 'problem' | 'pain' | 'purchase_intent' | 'emerging_trend'
  | 'competitor' | 'content_demand' | 'community' | 'solution_failure' | 'contrarian';

export interface Evidence {
  id: ID;
  research_run_id: ID;
  query: string;
  query_type: QueryType | 'validation';
  provider: SearchProviderId | 'fixture';
  source_url: string;
  canonical_url: string;
  domain: string;
  title: string;
  snippet: string;
  content: string;
  author?: string | null;
  published_at: ISO | null;
  retrieved_at: ISO;
  source_type: SourceType;
  source_reliability: number;
  relevance_score: number;
  directness_score: number;
  freshness_score: number;
  independence_score: number;
  evidence_weight: number;
  importance_weight: number;
  age_days: number | null;
  content_hash: string;
  duplicate_of?: ID | null;
  signal_hints: SignalType[];
  is_fixture?: boolean;
}

export interface Signal {
  id: ID;
  research_run_id: ID;
  niche_id?: ID | null;
  evidence_ids: ID[];
  signal_type: SignalType;
  statement: string;
  strength: number;           // 0-100 (model assessment)
  confidence: number;         // 0-100 (model assessment)
  direct_or_inferred: 'direct' | 'inferred';
  rejected?: boolean;
  rejected_reason?: string;
}

export interface Niche {
  id: ID;
  research_run_id: ID;
  broad_category: string;
  specific_niche: string;
  target_audience: string;
  core_problem: string;
  desired_outcome: string;
  context: string;
  why_specific: string;
  product_formats: string[];
  specificity_score: number;
  specificity_notes: string[];
  evidence_ids: ID[];
  evidence_count: number;
  independent_domains: number;
  recent_evidence_count: number;
  status: NicheStatus;
  quality_gate: { passed: boolean; failures: string[]; warnings: string[] };
  cluster_id?: ID | null;
  merged_from?: ID[];
  created_at: ISO;
}

export interface Problem {
  id: ID;
  research_run_id: ID;
  niche_id: ID;
  rank: number;
  problem_statement: string;
  underlying_problem: string;
  customer_language: string[];
  who_experiences_it: string;
  why_it_hurts: string;
  current_workarounds: string[];
  why_existing_solutions_fail: string;
  what_people_search: string[];
  conversation_signals: string[];
  potential_product_solutions: string[];
  recommended_product: string;
  evidence_ids: ID[];
  evidence_count: number;
  created_at: ISO;
}

export interface Validation {
  id: ID;
  research_run_id: ID;
  problem_id: ID;
  supporting_evidence_ids: ID[];
  contradicting_evidence_ids: ID[];
  validation_evidence_ids: ID[];
  contradiction_rate: number;
  confidence: number;
  status: ValidationStatus;
  reasoning_summary: string;
  confidence_components: ConfidenceComponents;
  searches_run: number;
  created_at: ISO;
}

export interface ConfidenceComponents {
  source_reliability: number;
  source_diversity: number;
  recency: number;
  directness: number;
  cross_source_consistency: number;
}

export interface ScoreComponentValue { score: number; reason: string; evidence_ids: ID[]; assessment?: 'direct' | 'inferred' | 'insufficient' }

export interface OpportunityScore {
  id: ID;
  research_run_id: ID;
  problem_id: ID;
  niche_id: ID;
  components: Record<ComponentKey, ScoreComponentValue>;
  base_score: number;
  evidence_confidence: number;
  confidence_multiplier: number;
  contradiction_rate: number;
  contradiction_multiplier: number;
  final_score: number;
  score_label: string;
  opportunity_label: string;
  insufficient_evidence: boolean;
  confidence_components: ConfidenceComponents;
  scoring_version: string;
  computed_at: ISO;
  /** Human-readable audit trail of the arithmetic the engine performed. */
  arithmetic?: string[];
}

export interface OpportunityReport {
  id: ID;
  research_run_id: ID;
  problem_id: ID;
  opportunity_summary: string;
  why_now: string;
  customer_problem: string;
  commercial_reason: string;
  risks: string[];
  recommended_action: string;
  positioning_angle?: string;
  first_content_ideas?: string[];
  generated_at: ISO;
}

/* ---------------------------- projects ------------------------------ */

export interface Project {
  id: ID;
  run_id: ID;
  niche_id: ID;
  problem_id: ID;
  name: string;
  status: ProjectStatus;
  currency: string;
  created_at: ISO;
  updated_at: ISO;
}

export interface ProductStrategy {
  recommended_format: string;
  format_reasoning: string;
  product_promise: string;
  product_name_options: string[];
  selected_name?: string;
  transformation: { from: string; to: string };
  contents: { title: string; purpose: string }[];
  worksheets: { title: string; purpose: string }[];
  checklists: { title: string; items: string[] }[];
  bonuses: string[];
  positioning: string;
  sales_page: {
    headline: string;
    subheadline: string;
    bullets: string[];
    offer_stack: string[];
    guarantee: string;
    faq: { q: string; a: string }[];
    cta: string;
  };
  generated_at: ISO;
}

export interface GuideChapter {
  id: ID;
  title: string;
  purpose: string;
  body: string;
  status: 'empty' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface Guide {
  title: string;
  subtitle: string;
  audience: string;
  promise: string;
  chapters: GuideChapter[];
  worksheets: { title: string; purpose: string; body: string }[];
  checklists: { title: string; items: string[] }[];
  bonus: string;
  word_target: number;
}

export interface Product {
  id: ID;
  project_id: ID;
  product_type: string;
  name: string;
  promise: string;
  strategy: ProductStrategy | null;
  guide: Guide | null;
  status: 'draft' | 'ready' | 'launched';
  created_at: ISO;
  updated_at: ISO;
}

export interface PricingPlan {
  id: ID;
  project_id: ID;
  currency: string;
  recommended_price: number;
  launch_price: number;
  standard_price: number;
  premium_price: number | null;
  premium_bundle: string[];
  value_justification: string;
  pricing_reasoning: string;
  objections: { objection: string; response: string }[];
  offer_stack: string[];
  discount_strategy: string;
  price_testing_plan: string[];
  generated_at: ISO;
}

export interface MarketingAsset {
  id: ID;
  project_id: ID;
  module_key: string;
  title: string;
  payload: any;
  meta?: { model?: string; provider?: string; ms?: number; tokens_in?: number; tokens_out?: number };
  updated_at: ISO;
}

export interface Campaign {
  id: ID;
  project_id: ID;
  platform: string;
  concepts: any[];
  testing_matrix: any[];
  budget_scenarios: any[];
  retargeting: string;
  generated_at: ISO;
}

export interface LaunchTask {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  updated_at?: ISO;
}

export interface LaunchPlan {
  id: ID;
  project_id: ID;
  tasks: LaunchTask[];
  sequence: { day: string; action: string; detail: string }[];
  headline?: string;
  key_risks?: string[];
  updated_at: ISO;
}

export interface AnalyticsSnapshot {
  id: ID;
  project_id: ID;
  label: string;
  captured_at: ISO;
  inputs: AnalyticsInputs;
  metrics: Record<string, number | null>;
  analysis?: any;
}

export interface AnalyticsInputs {
  visitors: number;
  leads: number;
  sales: number;
  revenue: number;
  ad_spend: number;
  refunds: number;
  repeat_purchases: number;
  price: number;
  notes: string;
}

/* ------------------------------ misc -------------------------------- */

export interface AppError {
  code:
    | 'invalid_api_key' | 'rate_limit' | 'unsupported_model' | 'provider_unavailable'
    | 'malformed_response' | 'timeout' | 'cors_or_network' | 'insufficient_evidence'
    | 'search_api_failure' | 'unsupported_structured_output' | 'no_provider'
    | 'cancelled' | 'unknown';
  message: string;
  detail?: string;
  status?: number;
  provider?: string;
  retryable: boolean;
}

export interface ProgressEvent {
  key: string;
  label: string;
  detail?: string;
  pct: number;
}
