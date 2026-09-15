import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, CircleAlert, ExternalLink, FileText, MessageSquare, TrendingUp, Users } from 'lucide-react';
import type { ComponentKey, Evidence, Niche, OpportunityScore, Problem, Signal, Validation } from '../core/types';
import { navigate } from './shell';
import { Card, ConfidenceMeter, ScoreBadge, ScoreBar, Tag, cx } from './ui';
import { COMPONENT_LABELS, COMPONENT_ORDER, SCORE_BANDS, STATUS_LABEL, STATUS_TONE, WEIGHTS, confidenceBand, scoreBand } from '../core/intelligence/scoringEngine';
import { relTime, truncate } from '../core/lib/utils';

export interface OpportunityRow { niche: Niche; problem: Problem; score?: OpportunityScore; validation?: Validation }

export function SourceTypeTag({ type }: { type: string }) {
  const map: Record<string, { tone: any; label: string }> = {
    reddit: { tone: 'sun', label: 'Reddit' },
    youtube: { tone: 'rose', label: 'YouTube' },
    news: { tone: 'lilac', label: 'News' },
    forum: { tone: 'sun', label: 'Forum' },
    marketplace: { tone: 'moss', label: 'Marketplace' },
    trend_data: { tone: 'lilac', label: 'Trend data' },
    social: { tone: 'rose', label: 'Social' },
    competitor: { tone: 'neutral', label: 'Competitor' },
    search_result: { tone: 'neutral', label: 'Web' },
    other: { tone: 'neutral', label: 'Other' },
  };
  const row = map[type] ?? map.other;
  return <Tag tone={row.tone}>{row.label}</Tag>;
}

export function OpportunityCard({ row, rank, compact }: { row: OpportunityRow; rank?: number; compact?: boolean }) {
  const { niche, problem, score, validation } = row;
  const insufficient = score?.insufficient_evidence;
  const band = score ? scoreBand(score.final_score) : null;
  const confidence = confidenceBand(score?.evidence_confidence ?? 0);
  /* The four that decide whether this is worth a creator's time. */
  const headline: ComponentKey[] = ['current_demand', 'pain_severity', 'willingness_to_pay', 'market_gap'];

  return (
    <Card
      className={cx('pad cursor-pointer transition hover:shadow-lift hover:-translate-y-[1px]', compact && 'p-4')}
      onClick={() => navigate(`/problem/${problem.id}`)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {rank ? <span className="text-[12px] font-semibold text-ink-faint tnum">#{rank}</span> : null}
            <Tag tone="neutral">{niche.broad_category || 'Niche'}</Tag>
            {validation ? <Tag tone={STATUS_TONE[validation.status]}>{STATUS_LABEL[validation.status]}</Tag> : <Tag tone="neutral">Still checking</Tag>}
          </div>
          <h3 className="text-[16.5px] sm:text-[17.5px] font-semibold tracking-[-0.02em] leading-snug">{problem.problem_statement}</h3>
          <p className="sub mt-1.5">{truncate(niche.specific_niche, 150)}</p>
        </div>
        {score ? (
          <div className="shrink-0 text-right">
            <div className="flex items-baseline gap-1 justify-end">
              <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] tnum">{score.final_score.toFixed(0)}</span>
              <span className="text-[12px] text-ink-faint">/100</span>
            </div>
            <div className={cx('text-[12.5px] font-medium mt-1.5', insufficient ? 'text-ink-mute' : 'text-ink-soft')}>
              {insufficient ? 'Not enough to go on' : band?.label}
            </div>
          </div>
        ) : (
          <span className="text-[12px] text-ink-faint shrink-0">Not scored</span>
        )}
      </div>

      {/* Why it scored that way — plain questions, not metric names. */}
      {!insufficient && score ? (
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mt-5">
          {headline.map((k) => (
            <div key={k}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] text-ink-soft">{COMPONENT_LABELS[k]}</span>
                <span className="text-[12px] font-medium tnum text-ink-mute shrink-0">{score.components?.[k]?.score?.toFixed(0) ?? '—'}</span>
              </div>
              <div className="mt-1.5">
                <ScoreBar value={score.components?.[k]?.score ?? 0} height={5} tone={insufficient ? 'ink' : 'lilac'} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 mt-5">
        <MiniStat icon={<Users size={13} />} label="Who" value={truncate(niche.target_audience, 60)} />
        <MiniStat icon={<TrendingUp size={13} />} label="They want" value={truncate(niche.desired_outcome, 60)} />
        <MiniStat icon={<FileText size={13} />} label="Smallest product" value={truncate(problem.recommended_product || niche.product_formats?.[0] || '—', 60)} />
        <MiniStat
          icon={<MessageSquare size={13} />}
          label="Based on"
          value={`${niche.evidence_count} real sources from ${niche.independent_domains} sites`}
        />
      </div>

      <div className="mt-4 pt-4 border-t border-line-soft flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-ink-mute inline-flex items-center gap-1.5">
          {insufficient ? <CircleAlert size={13} className="text-sun-600" /> : <Check size={13} className="text-moss-600" />}
          {insufficient ? 'Not enough current evidence yet' : `${confidence.label} · ${niche.recent_evidence_count} sources from the last 90 days`}
        </span>
        <span className="text-[12.5px] text-ink-mute inline-flex items-center gap-1 shrink-0">See why <ChevronRight size={14} /></span>
      </div>
    </Card>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-ink-faint">{icon}{label}</div>
      <div className="text-[12.5px] text-ink mt-1 leading-snug">{value || '—'}</div>
    </div>
  );
}

export function ScoreBreakdown({ score }: { score: OpportunityScore }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-[12px] text-ink-mute">
        <span>Component assessment × weight = base score</span>
        <span className="tnum">base <strong className="text-ink">{score.base_score.toFixed(1)}</strong></span>
      </div>
      {COMPONENT_ORDER.map((key) => {
        const comp = score.components?.[key];
        const isOpen = open === key;
        return (
          <div key={key}>
            <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : key)}>
              <div className="flex items-center justify-between text-[12.5px] mb-1.5">
                <span className="text-ink-soft">
                  {COMPONENT_LABELS[key]}
                  <span className="text-ink-faint ml-1.5">×{WEIGHTS[key].toFixed(2)}</span>
                </span>
                <span className="tnum font-medium text-ink">{comp?.score?.toFixed(0) ?? '—'}</span>
              </div>
              <ScoreBar
                value={comp?.score ?? 0}
                tone={(comp?.score ?? 0) >= 75 ? 'moss' : (comp?.score ?? 0) >= 55 ? 'lilac' : 'sun'}
                height={5}
              />
            </button>
            {isOpen && comp ? (
              <div className="mt-2 rounded-xl2 bg-canvas border border-line-soft p-3.5 text-[12.5px] text-ink-mute leading-relaxed animate-fadeUp">
                <div className="flex items-center gap-2 mb-1.5">
                  <Tag tone={comp.assessment === 'direct' ? 'moss' : comp.assessment === 'insufficient' ? 'sun' : 'neutral'}>
                    {comp.assessment ?? 'assessment'}
                  </Tag>
                  {comp.evidence_ids.length ? <span className="text-[11.5px] text-ink-faint">{comp.evidence_ids.length} cited source(s)</span> : <span className="text-[11.5px] text-ink-faint">no direct citation</span>}
                </div>
                {comp.reason}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="pt-3 mt-1 border-t border-line space-y-1.5">
        <div className="text-[12px] text-ink-faint mb-1">Engine arithmetic (owned by the app, not the model)</div>
        {score.arithmetic?.map?.((line) => (
          <div key={line} className="font-mono text-[11.5px] text-ink-mute break-words">{line}</div>
        )) ?? null}
      </div>
    </div>
  );
}

export function EvidenceList({ evidence, citedIds, emptyLabel = 'No sources.' }: { evidence: Evidence[]; citedIds?: string[]; emptyLabel?: string }) {
  const [filter, setFilter] = useState<'all' | 'cited' | 'recent'>('all');
  const rows = useMemo(() => {
    let list = evidence;
    if (filter === 'cited' && citedIds?.length) list = list.filter((e) => citedIds.includes(e.id));
    if (filter === 'recent') list = list.filter((e) => e.age_days !== null && e.age_days <= 90);
    return [...list].sort((a, b) => (a.duplicate_of === null ? -1 : 1) - (b.duplicate_of === null ? -1 : 1) || b.importance_weight - a.importance_weight);
  }, [evidence, filter, citedIds]);

  if (!evidence.length) return <p className="text-[13px] text-ink-faint">{emptyLabel}</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {([
          ['all', `All ${evidence.length}`],
          ['cited', `Cited ${citedIds?.length ?? 0}`],
          ['recent', `Last 90 days ${evidence.filter((e) => e.age_days !== null && e.age_days <= 90).length}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key as any)}
            className={cx('rounded-full px-3 py-1.5 text-[12px] transition border', filter === key ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink-mute hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-line-soft rounded-xl2 border border-line overflow-hidden bg-white">
        {rows.slice(0, 60).map((e) => (
          <div key={e.id} className="p-3.5 row-hover">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <SourceTypeTag type={e.source_type} />
                  {e.duplicate_of ? <Tag tone="neutral">syndicated cluster</Tag> : null}
                  {e.age_days !== null && e.age_days <= 30 ? <Tag tone="moss">fresh · {e.age_days}d</Tag> : null}
                  <span className="text-[11.5px] text-ink-faint">{e.domain}</span>
                  <span className="text-[11.5px] text-ink-faint">· {relTime(e.published_at)}</span>
                </div>
                <a href={e.source_url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium text-ink hover:underline leading-snug inline-flex items-start gap-1">
                  {truncate(e.title, 130)} <ExternalLink size={12} className="mt-1 shrink-0 text-ink-faint" />
                </a>
                <p className="text-[12.5px] text-ink-mute mt-1 leading-snug">{truncate(e.snippet, 230)}</p>
                <div className="text-[11px] text-ink-faint mt-1.5 font-mono">
                  {e.id} · query: “{truncate(e.query, 70)}” · retrieved {relTime(e.retrieved_at)}
                </div>
              </div>
              <div className="shrink-0 text-right hidden sm:block">
                <div className="text-[11px] text-ink-faint">weight</div>
                <div className="text-[13px] font-medium tnum">{e.importance_weight.toFixed(2)}</div>
                <div className="text-[10.5px] text-ink-faint mt-1">rel {(e.source_reliability * 100).toFixed(0)} · fresh {(e.freshness_score * 100).toFixed(0)} · ind {e.independence_score.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SignalList({ signals, evidence }: { signals: Signal[]; evidence: Evidence[] }) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return (
    <div className="space-y-2.5">
      {signals.map((s) => (
        <div key={s.id} className="rounded-xl2 border border-line bg-white p-3.5">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <Tag tone={s.direct_or_inferred === 'direct' ? 'moss' : 'neutral'}>{s.signal_type.replace(/_/g, ' ')}</Tag>
            <span className="text-[11.5px] text-ink-faint">strength <span className="tnum text-ink">{s.strength.toFixed(0)}</span> · confidence <span className="tnum text-ink">{s.confidence.toFixed(0)}</span></span>
            <span className="text-[11.5px] text-ink-faint">{s.direct_or_inferred === 'direct' ? 'direct evidence' : 'inferred'}</span>
          </div>
          <p className="text-[13.5px] text-ink leading-relaxed">{s.statement}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.evidence_ids.map((id) => {
              const e = byId.get(id);
              if (!e) return null;
              return (
                <a key={id} href={e.source_url} target="_blank" rel="noreferrer" className="text-[11px] rounded-full bg-line-soft px-2 py-0.5 text-ink-mute hover:text-ink inline-flex items-center gap-1">
                  {e.domain} <ArrowUpRight size={10} />
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Built from SCORE_BANDS rather than hardcoded, so the legend can never drift
   out of step with the labels the cards actually show. */
export function ScoreLegend() {
  const tones: Record<string, string> = {
    'Excellent opportunity': 'moss',
    'Strong opportunity': 'moss',
    'Good opportunity': 'lilac',
    'Worth investigating': 'sun',
    'Unclear so far': 'sun',
    'Probably skip this one': 'neutral',
  };
  return (
    <div className="flex flex-wrap gap-2 text-[11.5px]">
      {[...SCORE_BANDS].reverse().filter(([lo]) => lo >= 50).map(([lo, hi, label]) => (
        <Tag key={label} tone={(tones[label] ?? 'neutral') as any}>
          {label} {lo}{lo >= 100 ? '' : lo >= 90 ? '+' : `–${Math.floor(hi)}`}
        </Tag>
      ))}
    </div>
  );
}
