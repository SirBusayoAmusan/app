/* Shared numeric helpers for the scoring layer (kept separate to avoid
   circular imports between the scoring engine and the evidence engine). */
import type { Evidence } from '../types';
import { clamp, round1 } from '../lib/utils';
import { evidenceStats, type EvidenceStats } from './evidenceEngine';

export { clamp, round1 };

export function evidenceStatsSafe(rows: Evidence[]): EvidenceStats {
  try {
    return evidenceStats(rows);
  } catch {
    return {
      total: rows.length, independent_domains: 0, independent_clusters: 0, recent_30: 0, recent_90: 0,
      older_than_90: 0, unknown_date: 0, direct_signals: 0, avg_reliability: 0, avg_freshness: 0,
      avg_relevance: 0, avg_directness: 0, avg_independence: 0, consistency: 0, by_source_type: {},
    };
  }
}
