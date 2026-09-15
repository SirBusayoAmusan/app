/* ------------------------------------------------------------------
   Deterministic scoring engine.

   The model supplies component assessments (0-100) with reasons and
   evidence IDs. This module owns ALL arithmetic: base score, evidence
   confidence, confidence adjustment, contradiction penalty, bounds and
   labels. The model can never write the final number.
   ------------------------------------------------------------------ */
import type {
  ComponentKey, ConfidenceComponents, Evidence, OpportunityScore, ScoreComponentValue, ValidationStatus,
} from '../types';
import { clamp, evidenceStatsSafe, round1 } from './scoringInternals';

export const SCORING_VERSION = 's1.0.0';

export const WEIGHTS: Record<ComponentKey, number> = {
  current_demand: 0.20,
  trend_momentum: 0.15,
  pain_severity: 0.15,
  willingness_to_pay: 0.12,
  problem_frequency: 0.08,
  market_gap: 0.08,
  emotional_intensity: 0.07,
  product_feasibility: 0.05,
  viral_content_potential: 0.05,
  competition_opportunity: 0.05,
};

/* Labels are written as plain questions a creator would actually ask, so a
   number like "72" reads as an answer rather than an analyst's metric. */
export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  current_demand: 'People want this now',
  trend_momentum: 'It is getting more popular',
  pain_severity: 'It really hurts them',
  willingness_to_pay: 'They already pay to fix it',
  problem_frequency: 'It comes up again and again',
  market_gap: 'Current options leave them cold',
  emotional_intensity: 'They feel strongly about it',
  product_feasibility: 'You could build this quickly',
  viral_content_potential: 'It spreads by itself',
  competition_opportunity: 'Rivals have obvious weak spots',
};

/** One-line explanation shown beside each bar, so nothing needs decoding. */
export const COMPONENT_HELP: Record<ComponentKey, string> = {
  current_demand: 'How many people are actively looking for help with this right now.',
  trend_momentum: 'Whether interest is rising or fading.',
  pain_severity: 'How badly this affects their day or their income.',
  willingness_to_pay: 'Proof they already spend money trying to solve it.',
  problem_frequency: 'How often they run into it, not just once.',
  market_gap: 'Whether what already exists fails them.',
  emotional_intensity: 'How frustrated or worried they sound when they talk about it.',
  product_feasibility: 'Whether a small product could genuinely fix it.',
  viral_content_potential: 'Whether the topic gets shared and talked about.',
  competition_opportunity: 'Whether the big players are overlooking this group.',
};

export const COMPONENT_ORDER: ComponentKey[] = [
  'current_demand', 'trend_momentum', 'pain_severity', 'willingness_to_pay', 'problem_frequency',
  'market_gap', 'emotional_intensity', 'product_feasibility', 'viral_content_potential', 'competition_opportunity',
];

export const CONFIDENCE_WEIGHTS = {
  source_reliability: 0.25,
  source_diversity: 0.20,
  recency: 0.20,
  directness: 0.20,
  cross_source_consistency: 0.15,
};

export const CONFIDENCE_BANDS: [number, number, string, string][] = [
  [90, 100, 'Very well supported', 'Many separate, recent sources agree on this.'],
  [75, 89, 'Well supported', 'Several separate sources say the same thing.'],
  [60, 74, 'Fairly supported', 'Enough to act on, but some gaps remain.'],
  [40, 59, 'Thinly supported', 'Few or indirect sources. Treat the score as provisional.'],
  [0, 39, 'Not enough to go on', 'Too little current evidence to call this an opportunity.'],
];

/* Plain verdicts. A reader should understand the ladder without a legend. */
export const SCORE_BANDS: [number, number, string, string][] = [
  [90, 100, 'Excellent opportunity', '🔥'],
  [80, 89.999, 'Strong opportunity', '🚀'],
  [70, 79.999, 'Good opportunity', '💰'],
  [60, 69.999, 'Worth investigating', '🟡'],
  [50, 59.999, 'Unclear so far', '🟡'],
  [0, 49.999, 'Probably skip this one', '⚪'],
];

export function confidenceBand(score: number) {
  const row = CONFIDENCE_BANDS.find(([lo, hi]) => score >= lo && score <= hi);
  return { label: row?.[2] ?? 'Insufficient evidence', detail: row?.[3] ?? '' };
}

export function scoreBand(score: number) {
  const row = SCORE_BANDS.find(([lo, hi]) => score >= lo && score <= hi);
  return { label: row?.[2] ?? 'Weak Opportunity', emoji: row?.[3] ?? '⚪' };
}

/* Badges read as a verdict on the proof, not as a technical status code. */
export const STATUS_LABEL: Record<ValidationStatus, string> = {
  validated: 'Backed by sources',
  promising: 'Looks promising',
  mixed: 'Sources disagree',
  weak: 'Thin proof',
  insufficient_evidence: 'Not enough proof yet',
};

export const STATUS_TONE: Record<ValidationStatus, 'moss' | 'lilac' | 'sun' | 'rose' | 'neutral'> = {
  validated: 'moss',
  promising: 'moss',
  mixed: 'sun',
  weak: 'sun',
  insufficient_evidence: 'neutral',
};

/* --------------------------- confidence ----------------------------- */

export function computeConfidence(params: {
  evidence: Evidence[];
  supporting: string[];
  contradicting: string[];
  directnessFromModel?: number;
}): ConfidenceComponents {
  const { evidence, supporting, contradicting } = params;
  const stats = evidenceStatsSafe(evidence);
  const reliability = Math.round(stats.avg_reliability * 100);

  // Diversity: independent domains and clusters, capped and scaled.
  const diversity = Math.round(
    clamp((Math.min(stats.independent_domains, 12) / 12) * 65 + (Math.min(stats.independent_clusters, 8) / 8) * 35, 0, 100),
  );

  // Recency: share of evidence published inside 90 days, with a 30-day bonus.
  const dated = evidence.filter((e) => e.age_days !== null);
  const recent90 = dated.filter((e) => (e.age_days as number) <= 90).length;
  const recent30 = dated.filter((e) => (e.age_days as number) <= 30).length;
  const recency = dated.length
    ? Math.round(clamp((recent90 / dated.length) * 80 + (recent30 / dated.length) * 20, 0, 100))
    : 25;

  const directness = Math.round(clamp(stats.avg_directness * 70 + (stats.direct_signals > 0 ? 30 * Math.min(1, stats.direct_signals / 6) : 0), 0, 100));

  const total = supporting.length + contradicting.length;
  const agreement = total ? supporting.length / total : 0;
  const cross = Math.round(clamp(agreement * 100 * 0.8 + Math.min(1, total / 8) * 20, 0, 100));

  return {
    source_reliability: reliability,
    source_diversity: diversity,
    recency,
    directness: params.directnessFromModel !== undefined ? Math.round((directness * 0.6 + params.directnessFromModel * 0.4)) : directness,
    cross_source_consistency: cross,
  };
}

/**
 * Volume factor: a handful of sources can never reach full confidence.
 * 1-2 sources → ~0.61, 4 sources → ~0.78, 8+ sources → 1.00
 * This is what stops a thin evidence base from producing a confident score.
 */
export function confidenceVolumeFactor(evidenceCount: number): number {
  return Math.round((0.55 + 0.45 * Math.min(1, evidenceCount / 8)) * 1000) / 1000;
}

export function confidenceFromComponents(c: ConfidenceComponents, evidenceCount = 8): number {
  const value =
    c.source_reliability * CONFIDENCE_WEIGHTS.source_reliability +
    c.source_diversity * CONFIDENCE_WEIGHTS.source_diversity +
    c.recency * CONFIDENCE_WEIGHTS.recency +
    c.directness * CONFIDENCE_WEIGHTS.directness +
    c.cross_source_consistency * CONFIDENCE_WEIGHTS.cross_source_consistency;
  return round1(clamp(value * confidenceVolumeFactor(evidenceCount), 0, 100));
}

/* ------------------------------ scoring ------------------------------ */

export interface ScoreInput {
  problem_id: string;
  niche_id: string;
  research_run_id: string;
  components: Record<ComponentKey, ScoreComponentValue>;
  evidence: Evidence[];
  supporting_ids: string[];
  contradicting_ids: string[];
  validation_status: ValidationStatus;
}

export interface ComputedScore {
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
  arithmetic: string[];
}

export function computeOpportunityScore(input: ScoreInput): ComputedScore {
  const { components, evidence, supporting_ids, contradicting_ids } = input;

  const base = COMPONENT_ORDER.reduce((sum, key) => sum + clamp(components[key]?.score ?? 0, 0, 100) * WEIGHTS[key], 0);
  const base_score = round1(clamp(base, 0, 100));

  const confidence_components = computeConfidence({ evidence, supporting: supporting_ids, contradicting: contradicting_ids });
  const volume = confidenceVolumeFactor(evidence.length);
  const confidence_value = confidenceFromComponents(confidence_components, evidence.length);

  // Weak evidence must never produce an apparently certain high score.
  const confidence_multiplier = round1((0.6 + (confidence_value / 100) * 0.4) * 1000) / 1000;

  const considered = supporting_ids.length + contradicting_ids.length;
  const contradiction_rate = considered ? round1((contradicting_ids.length / considered) * 1000) / 1000 : 0;
  const contradiction_multiplier = round1((1 - contradiction_rate * 0.2) * 1000) / 1000;

  const final_score = round1(clamp(base_score * confidence_multiplier * contradiction_multiplier, 0, 100));
  const band = scoreBand(final_score);

  const insufficient =
    input.validation_status === 'insufficient_evidence' ||
    confidence_value < 40 ||
    evidence.length < 5 ||
    supporting_ids.length < 2;

  return {
    base_score,
    evidence_confidence: confidence_value,
    confidence_multiplier,
    contradiction_rate,
    contradiction_multiplier,
    final_score,
    score_label: band.label,
    opportunity_label: `${band.emoji} ${band.label}`,
    insufficient_evidence: insufficient,
    confidence_components,
    arithmetic: [
      `base = ${COMPONENT_ORDER.map((k) => `${k.replace(/_/g, ' ')} ${clamp(components[k]?.score ?? 0, 0, 100).toFixed(0)}×${WEIGHTS[k]}`).join(' + ')} = ${base_score.toFixed(2)}`,
      `evidence confidence = (reliability×0.25 + diversity×0.20 + recency×0.20 + directness×0.20 + consistency×0.15) × volume(${evidence.length} sources → ${volume.toFixed(3)}) = ${confidence_value.toFixed(1)}`,
      `confidence multiplier = 0.60 + (${confidence_value.toFixed(1)}/100 × 0.40) = ${confidence_multiplier.toFixed(3)}`,
      `contradiction rate = ${(contradiction_rate * 100).toFixed(1)}% → multiplier = 1 − rate×0.20 = ${contradiction_multiplier.toFixed(3)}`,
      `final = ${base_score.toFixed(2)} × ${confidence_multiplier.toFixed(3)} × ${contradiction_multiplier.toFixed(3)} = ${final_score.toFixed(2)} → ${band.emoji} ${band.label}`,
    ],
  };
}

/** Minimum-evidence gate: a problem cannot be presented as validated below these thresholds. */
export const EVIDENCE_GATE = {
  minimum_evidence_items: 5,
  minimum_independent_domains: 3,
  minimum_recent_sources: 1,
};

export function evidenceGate(evidence: Evidence[]): { passed: boolean; failures: string[] } {
  const stats = evidenceStatsSafe(evidence);
  const failures: string[] = [];
  if (stats.total < EVIDENCE_GATE.minimum_evidence_items) failures.push(`Only ${stats.total} evidence items (minimum ${EVIDENCE_GATE.minimum_evidence_items}).`);
  if (stats.independent_domains < EVIDENCE_GATE.minimum_independent_domains) failures.push(`${stats.independent_domains} independent domains (minimum ${EVIDENCE_GATE.minimum_independent_domains}).`);
  if (stats.recent_30 + stats.recent_90 < EVIDENCE_GATE.minimum_recent_sources) failures.push('No evidence published in the last 90 days — no current-trend claim is possible.');
  return { passed: failures.length === 0, failures };
}

export function buildScoreRecord(input: ScoreInput & { computed: ComputedScore }): OpportunityScore {
  const { computed } = input;
  return {
    id: `score_${input.problem_id}`,
    research_run_id: input.research_run_id,
    problem_id: input.problem_id,
    niche_id: input.niche_id,
    components: input.components,
    base_score: computed.base_score,
    evidence_confidence: computed.evidence_confidence,
    confidence_multiplier: computed.confidence_multiplier,
    contradiction_rate: computed.contradiction_rate,
    contradiction_multiplier: computed.contradiction_multiplier,
    final_score: computed.final_score,
    score_label: computed.score_label,
    opportunity_label: computed.opportunity_label,
    insufficient_evidence: computed.insufficient_evidence,
    confidence_components: computed.confidence_components,
    scoring_version: SCORING_VERSION,
    computed_at: new Date().toISOString(),
  };
}
