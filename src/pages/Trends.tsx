import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarClock, Database, Download, ExternalLink, Filter, Layers, Radar, Search, TriangleAlert } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, Chip, EmptyState, SectionTitle, Stat, Tag, cx } from '../components/ui';
import { SourceTypeTag } from '../components/intelligence';
import { db } from '../core/db/database';
import { evidenceStats } from '../core/intelligence/evidenceEngine';
import { QUERY_LAYERS } from '../core/intelligence/queryEngine';
import { exportCSV } from '../core/export/exporters';
import { useStore } from '../store';
import type { Evidence, ResearchRun } from '../core/types';
import { relTime, shortDate, truncate } from '../core/lib/utils';

export default function Trends() {
  const { runs } = useStore();
  const [runId, setRunId] = useState<string>('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [freshness, setFreshness] = useState<'all' | '30' | '90' | '365'>('all');
  const [query, setQuery] = useState('');
  const [hideSyndicated, setHideSyndicated] = useState(true);

  useEffect(() => {
    if (!runId && runs.length) setRunId(runs[0].id);
  }, [runs, runId]);

  useEffect(() => {
    if (!runId) return;
    db.evidence.where('research_run_id').equals(runId).toArray().then(setEvidence);
  }, [runId]);

  const run: ResearchRun | undefined = runs.find((r) => r.id === runId);
  const stats = useMemo(() => evidenceStats(evidence), [evidence]);
  const types = useMemo(() => Object.entries(stats.by_source_type).sort((a, b) => b[1] - a[1]), [stats]);

  const filtered = useMemo(() => {
    let list = [...evidence];
    if (typeFilter !== 'all') list = list.filter((e) => e.source_type === typeFilter);
    if (freshness !== 'all') list = list.filter((e) => e.age_days !== null && e.age_days <= Number(freshness));
    if (hideSyndicated) list = list.filter((e) => !e.duplicate_of);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((e) => `${e.title} ${e.snippet} ${e.query} ${e.domain}`.toLowerCase().includes(q));
    }
    return list.sort((a, b) => b.importance_weight - a.importance_weight);
  }, [evidence, typeFilter, freshness, query, hideSyndicated]);

  const freshnessBuckets = [
    { label: '0-30 days', count: evidence.filter((e) => e.age_days !== null && e.age_days <= 30).length, tone: 'moss' },
    { label: '31-90 days', count: evidence.filter((e) => e.age_days !== null && e.age_days > 30 && e.age_days <= 90).length, tone: 'lilac' },
    { label: '91-365 days', count: evidence.filter((e) => e.age_days !== null && e.age_days > 90 && e.age_days <= 365).length, tone: 'sun' },
    { label: '1 year+', count: evidence.filter((e) => e.age_days !== null && e.age_days > 365).length, tone: 'neutral' },
    { label: 'no date', count: evidence.filter((e) => e.age_days === null).length, tone: 'neutral' },
  ];

  return (
    <Page
      wide
      title="Trend intelligence"
      sub="Every real page and post behind your results, with its link, the date it was published, and the search that found it. None of it was written by AI."
      badge={run ? <Tag tone="lilac"><Database size={11} /> run {run.id.slice(-6)}</Tag> : undefined}
      actions={
        <>
          {runs.length ? (
            <select className="field field-sm w-auto" value={runId} onChange={(e: any) => setRunId(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.started_at).toLocaleDateString()} · {r.audience_snapshot?.location} · {r.status}
                </option>
              ))}
            </select>
          ) : null}
          <Button variant="quiet" disabled={!filtered.length} onClick={() => exportCSV('evidence', filtered as any)}>
            <Download size={14} /> Export CSV
          </Button>
        </>
      }
    >
      {!evidence.length ? (
        <EmptyState
          icon={<Radar size={22} />}
          title="No evidence collected yet"
          body="Run a discovery and everything it reads shows up here. Each line links to the real page it came from."
          action={<Button onClick={() => navigate('/discover')}>Run discovery</Button>}
        />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="Pages and posts read" value={stats.total} sub={`from ${stats.independent_domains} different sites`} />
            <Stat label="Separate stories" value={stats.independent_clusters} sub="reprints counted only once" tone="lilac" />
            <Stat label="Published recently" value={stats.recent_90} sub="from the last 90 days" tone={stats.recent_90 ? 'moss' : 'sun'} />
            <Stat label="How trustworthy" value={`${(stats.avg_reliability * 100).toFixed(0)}%`} sub="weighted by where it came from" />
          </div>

          {stats.recent_90 === 0 ? (
            <div className="mb-5">
              <Callout tone="warn" title="No recent evidence in this run">
                Nothing here was published in the last 90 days, so CreatorTools cannot support a current-trend claim. Older sources
                are still useful for evergreen context — they are marked accordingly rather than discarded.
              </Callout>
            </div>
          ) : null}

          <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
            <div className="space-y-4">
              <Card className="pad">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                    <input className="field pl-10" placeholder="Search titles, snippets, queries, domains…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-mute"><Filter size={14} /> Freshness</div>
                  <select className="field field-sm w-auto" value={freshness} onChange={(e: any) => setFreshness(e.target.value)}>
                    <option value="all">Any date</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="365">Last year</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-2 mt-3.5">
                  <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types</Chip>
                  {types.map(([type, count]) => (
                    <Chip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
                      {type.replace(/_/g, ' ')} {count}
                    </Chip>
                  ))}
                </div>
                <div className="mt-3.5 flex items-center gap-3 text-[12.5px] text-ink-mute">
                  <label className="checkline inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hideSyndicated} onChange={(e) => setHideSyndicated(e.target.checked)} />
                    Hide syndicated duplicates
                  </label>
                  <span className="text-ink-faint">Showing {filtered.length} of {evidence.length}</span>
                </div>
              </Card>

              <div className="rounded-xl2 border border-line bg-white divide-y divide-line-soft overflow-hidden">
                {filtered.slice(0, 80).map((e) => (
                  <div key={e.id} className="p-4 row-hover">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <SourceTypeTag type={e.source_type} />
                      {e.duplicate_of ? <Tag tone="neutral">syndicated</Tag> : null}
                      {e.age_days !== null && e.age_days <= 90 ? <Tag tone="moss">recent</Tag> : null}
                      <span className="text-[11.5px] text-ink-faint">{e.domain}</span>
                      <span className="text-[11.5px] text-ink-faint">· {shortDate(e.published_at)} ({relTime(e.published_at)})</span>
                      {e.signal_hints?.slice(0, 3).map((s) => <Tag key={s} tone="lilac">{s.replace(/_/g, ' ')}</Tag>)}
                    </div>
                    <a href={e.source_url} target="_blank" rel="noreferrer" className="text-[14px] font-medium text-ink hover:underline inline-flex items-start gap-1.5 leading-snug">
                      {truncate(e.title, 150)} <ExternalLink size={12} className="mt-1 shrink-0 text-ink-faint" />
                    </a>
                    <p className="text-[12.5px] text-ink-mute mt-1.5 leading-snug">{truncate(e.snippet, 260)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint font-mono">
                      <span>{e.id}</span>
                      <span>query: “{truncate(e.query, 60)}”</span>
                      <span>retrieved {relTime(e.retrieved_at)}</span>
                      <span>weight {e.importance_weight.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
                {!filtered.length ? <div className="p-6 text-center text-[13px] text-ink-faint">No sources match these filters.</div> : null}
              </div>
            </div>

            <div className="space-y-4">
              <Card className="pad">
                <SectionTitle title="Freshness distribution" sub="Trend claims need dated, recent sources." icon={<CalendarClock size={16} />} />
                <div className="space-y-2.5">
                  {freshnessBuckets.map((b) => {
                    const pct = stats.total ? (b.count / stats.total) * 100 : 0;
                    return (
                      <div key={b.label}>
                        <div className="flex items-center justify-between text-[12px] mb-1">
                          <span className="text-ink-mute">{b.label}</span>
                          <span className="tnum text-ink">{b.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-line-soft overflow-hidden">
                          <div className={cx('h-full rounded-full', { moss: 'bg-moss-500', lilac: 'bg-lilac-500', sun: 'bg-sun-500', neutral: 'bg-[#c9c9d1]' }[b.tone as string])} style={{ width: `${Math.max(2, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="pad">
                <SectionTitle title="Why some sources counted more than others" sub="How much each source was allowed to influence the result." icon={<BarChart3 size={16} />} />
                <div className="space-y-2.5 text-[12.5px]">
                  {[
                    ['How credible the site is', stats.avg_reliability],
                    ['How recently it was published', stats.avg_freshness],
                    ['How close it is to your audience', stats.avg_relevance],
                    ['How directly it addresses the problem', stats.avg_directness],
                    ['How independent the voices are', stats.avg_independence],
                  ].map(([label, value]: any) => (
                    <div key={label}>
                      <div className="flex justify-between mb-1"><span className="text-ink-mute">{label}</span><span className="tnum">{(value * 100).toFixed(0)}%</span></div>
                      <div className="h-1.5 rounded-full bg-line-soft overflow-hidden">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(2, value * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11.5px] text-ink-faint mt-4 leading-relaxed">
                  Ten articles repeating one press release count as roughly one independent signal. The independence column collapses
                  those clusters before any score is computed.
                </p>
              </Card>

              <Card className="pad">
                <SectionTitle title="What we searched for" sub="Every angle is covered, every time." icon={<Layers size={16} />} />
                <div className="space-y-2">
                  {QUERY_LAYERS.map((layer) => (
                    <div key={layer.layer} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-ink-soft">{layer.layer}. {layer.name.replace(/_/g, ' ')}</span>
                      <span className="tnum text-ink-faint">{evidence.filter((e) => e.query_type === layer.types[0]).length} sources</span>
                    </div>
                  ))}
                </div>
              </Card>

              {run?.error ? (
                <Callout tone="warn" title="Run note">
                  <span className="flex items-start gap-2"><TriangleAlert size={14} className="mt-0.5 shrink-0" />{run.error}</span>
                </Callout>
              ) : null}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
