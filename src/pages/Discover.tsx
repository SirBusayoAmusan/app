import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, CircleDashed, Compass, Filter, KeyRound, ListChecks, Loader2, Play, RefreshCw,
  Search, Square, TriangleAlert, Users, XCircle,
} from 'lucide-react';
import { Page, navigate, useRoute } from '../components/shell';
import { Mascot } from '../components/Mascot';
import { Button, Callout, Card, Chip, EmptyState, Modal, SectionTitle, Tag, cx } from '../components/ui';
import { OpportunityCard, ScoreLegend, type OpportunityRow } from '../components/intelligence';
import { useStore } from '../store';
import { db, deleteRun, getRunBundle } from '../core/db/database';
import { STAGES, cancelRun, runDiscovery } from '../core/intelligence/orchestrator';
import { searchProviderReady } from '../core/intelligence/searchProviders';
import { QUERY_LAYERS } from '../core/intelligence/queryEngine';
import { relTime } from '../core/lib/utils';
import type { Niche, OpportunityScore, Problem, QuerySpec, ResearchRun, Validation } from '../core/types';

type SortKey = 'final_score' | 'evidence_confidence' | 'current_demand' | 'trend_momentum' | 'pain_severity' | 'created_at';

export default function Discover() {
  const route = useRoute();
  const { settings, audience, runs, reload, toast, progress, running, setProgress, setRunning } = useStore();
  const [rows, setRows] = useState<OpportunityRow[]>([]);
  const [rejected, setRejected] = useState<{ niche: Niche; reason: string }[]>([]);
  const [unmined, setUnmined] = useState<Niche[]>([]);
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getRunBundle>> | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(route.query.get('run') ?? runs[0]?.id ?? null);
  const [sort, setSort] = useState<SortKey>('final_score');
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState<string>('all');
  const [showPlan, setShowPlan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const connected = Boolean(settings?.ai);
  const searchReady = searchProviderReady(settings?.search);
  const activeRun: ResearchRun | undefined = runs.find((r) => r.id === activeRunId) ?? runs[0];

  useEffect(() => {
    if (!activeRunId && runs.length) setActiveRunId(runs[0].id);
  }, [runs, activeRunId]);

  const loadRun = async (runId: string) => {
    setLoading(true);
    try {
      const b = await getRunBundle(runId);
      setBundle(b);
      const nicheById = new Map(b.niches.map((n) => [n.id, n]));
      const scoreByProblem = new Map(b.scores.map((s) => [s.problem_id, s]));
      const valByProblem = new Map(b.validations.map((v) => [v.problem_id, v]));
      const built: OpportunityRow[] = b.problems
        .map((p: Problem) => ({ problem: p, niche: nicheById.get(p.niche_id)!, score: scoreByProblem.get(p.id), validation: valByProblem.get(p.id) }))
        .filter((r) => r.niche);
      setRows(built);
      setRejected(b.niches.filter((n) => n.status === 'rejected').map((n) => ({ niche: n, reason: n.quality_gate.failures.join(' · ') })));
      const minedIds = new Set(b.problems.map((p) => p.niche_id));
      setUnmined(b.niches.filter((n) => !minedIds.has(n.id) && n.status !== 'rejected'));
      setWarnings(
        b.run?.usage
          ? []
          : [],
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeRun?.id) void loadRun(activeRun.id);
  }, [activeRun?.id]);

  const start = async () => {
    if (!audience) {
      toast({ tone: 'warn', title: 'Set your audience first', body: 'Discovery needs a target audience to build queries.' });
      navigate('/audience');
      return;
    }
    if (!connected) {
      toast({ tone: 'warn', title: 'Connect your AI provider', body: 'Setup takes about a minute.' });
      navigate('/setup');
      return;
    }
    setRunning(true);
    setProgress({ key: 'start', label: 'Starting run', pct: 0 });
    try {
      const summary = await runDiscovery({
        audience,
        onProgress: (e) => setProgress(e),
      });
      setWarnings(summary.warnings);
      await reload();
      setActiveRunId(summary.runId);
      await loadRun(summary.runId);
      if (summary.insufficient) {
        toast({ tone: 'warn', title: 'Run finished with insufficient evidence', body: summary.warnings[0] ?? 'CreatorTools refused to guess. See the run notes.' });
      } else {
        toast({ tone: 'success', title: `${summary.scored} opportunities scored`, body: `${summary.evidence} sources · ${summary.niches} niches · ${summary.problems} problems` });
      }
    } catch (e: any) {
      toast({ tone: 'error', title: 'Run failed', body: e?.message ?? 'Unknown error' });
      await reload();
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const filtered = useMemo(() => {
    let list = [...rows];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((r) => `${r.niche.specific_niche} ${r.problem.problem_statement} ${r.niche.target_audience}`.toLowerCase().includes(q));
    }
    if (labelFilter !== 'all') {
      list = list.filter((r) => {
        if (labelFilter === 'insufficient') return r.score?.insufficient_evidence;
        if (labelFilter === 'validated') return r.validation?.status === 'validated' || r.validation?.status === 'promising';
        if (labelFilter === 'mixed') return r.validation?.status === 'mixed' || r.validation?.status === 'weak';
        return r.score && r.score.final_score >= Number(labelFilter);
      });
    }
    return list.sort((a, b) => {
      if (sort === 'created_at') return (b.problem.created_at > a.problem.created_at ? 1 : -1);
      if (sort === 'evidence_confidence') return (b.score?.evidence_confidence ?? 0) - (a.score?.evidence_confidence ?? 0);
      if (sort === 'current_demand' || sort === 'trend_momentum' || sort === 'pain_severity') {
        return (b.score?.components?.[sort]?.score ?? 0) - (a.score?.['components']?.[sort]?.score ?? 0);
      }
      return (b.score?.final_score ?? 0) - (a.score?.final_score ?? 0);
    });
  }, [rows, query, labelFilter, sort]);

  const queries: QuerySpec[] = bundle?.queries ?? [];

  return (
    <Page
      wide
      title="Discover profitable niches"
      sub="Find specific markets and problems with real current demand — evidence first, then analysis, then a transparent score."
      badge={
        activeRun
          ? <Tag tone={activeRun.status === 'complete' ? 'moss' : activeRun.status === 'failed' ? 'rose' : 'sun'}>
              {activeRun.status === 'complete' ? 'finished'
                : activeRun.status === 'failed' ? 'stopped'
                  : activeRun.status === 'running' ? 'running'
                    : !searchReady.ready ? 'needs a search key' : 'partly finished'}
            </Tag>
          : undefined
      }
      actions={
        running ? (
          <Button variant="quiet" onClick={() => { if (activeRunId) cancelRun(activeRunId); toast({ tone: 'info', title: 'Cancelling after the current call' }); }}>
            <Square size={13} /> Stop
          </Button>
        ) : (
          <>
            <Button variant="quiet" onClick={() => setShowPlan(true)}><ListChecks size={14} /> See the plan</Button>
            {connected && searchReady.ready ? (
              <Button onClick={start}><Play size={14} /> {rows.length ? 'Run again' : 'Find my opportunity'}</Button>
            ) : (
              <Button onClick={() => navigate('/setup')}>{connected ? 'Add a search key' : 'Connect your key'}</Button>
            )}
          </>
        )
      }
    >
      {running && progress ? (
        <div className="mb-5 space-y-3">
          <Card className="pad">
            <div className="flex items-center gap-3.5">
              {/* Pip works alongside the progress bar rather than replacing it:
                  the label says what, she says "someone is on it". */}
              <Mascot mood="thinking" size={54} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium">{progress.label}</div>
                {progress.detail ? <div className="text-[12.5px] text-ink-mute mt-0.5 truncate">{progress.detail}</div> : null}
              </div>
              <span className="text-[12.5px] tnum text-ink-faint">{Math.round(progress.pct)}%</span>
            </div>
            <div className="mt-3.5 h-1.5 rounded-full bg-line-soft overflow-hidden">
              <div className="h-full bg-ink rounded-full transition-[width] duration-500" style={{ width: `${Math.max(3, progress.pct)}%` }} />
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-4">
              {STAGES.map((s) => {
                const log = (activeRun?.stages ?? []).find((x) => x.key === s.key);
                const currentLabel = progress.label === s.verb;
                const status = currentLabel ? 'running' : log?.status ?? 'pending';
                return (
                  <div key={s.key} className="flex items-start gap-2.5 text-[12.5px]">
                    {status === 'done' ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-moss-500 shrink-0" />
                      : status === 'running' ? <Loader2 size={11} className="mt-1 animate-spin text-lilac-500 shrink-0" />
                        : status === 'skipped' ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-line shrink-0" />
                          : status === 'failed' ? <XCircle size={11} className="mt-1 text-rose-500 shrink-0" />
                            : <CircleDashed size={11} className="mt-1 text-ink-faint shrink-0" />}
                    <span className={cx('leading-snug', status === 'pending' ? 'text-ink-faint' : 'text-ink-soft')}>
                      {s.verb}
                      {log?.detail ? <span className="block text-[11.5px] text-ink-faint">{log.detail}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ) : null}

      {!running && warnings.length ? (
        <Callout tone="warn" title={`${warnings.length} run note${warnings.length === 1 ? '' : 's'}`}>
          <ul className="space-y-1 mt-1">
            {warnings.slice(0, 6).map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </Callout>
      ) : null}

      {!running && activeRun?.error && !rows.length && searchReady.ready && connected ? (
        <div className="mt-4"><Callout tone="warn" title="This run did not find an opportunity">{activeRun.error}</Callout></div>
      ) : null}

      {!running && !rows.length ? (
        <div className="mt-5">
          <EmptyState
            icon={<Compass size={22} />}
            title={
              !connected ? 'One key and you are ready'
                : !searchReady.ready ? 'One more key and you are ready'
                  : 'Find your first opportunity'
            }
            body={
              !connected
                ? 'CreatorTools runs on your own AI key. Add it once, and it stays in this browser session — no account, nothing stored.'
                : !searchReady.ready
                  ? searchReady.reason
                  : 'CreatorTools will read current pages and posts for your audience, keep only the sources it can cite, and rank the problems underneath them — then show you exactly how each score was calculated.'
            }
            footer={
              connected && searchReady.ready ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check size={13} className="text-moss-600" />
                  Reading <strong className="text-ink-soft font-medium">{searchReady.label}</strong>
                  {searchReady.label === 'Public discussion data'
                    ? ' — Hacker News, Stack Overflow, GitHub and DEV, free and keyless'
                    : ''}
                </span>
              ) : null
            }
            tone={connected && !searchReady.ready ? 'warn' : 'neutral'}
            action={
              !connected || !searchReady.ready ? (
                <>
                  <Button onClick={() => navigate('/setup')}><KeyRound size={14} /> {connected ? 'Add a search key' : 'Connect your key'}</Button>
                  {!connected ? null : <Button variant="quiet" onClick={() => navigate('/audience')}>Review audience</Button>}
                </>
              ) : (
                <Button onClick={start}><Play size={14} /> Find my opportunity</Button>
              )
            }
          />
        </div>
      ) : null}

      {rows.length ? (
        <>
          {/* ------------------------- controls ------------------------- */}
          <Card className="pad mb-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  className="field pl-10"
                  placeholder="Search niches, problems, audiences…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 text-[12.5px] text-ink-mute">
                <Filter size={14} /> Sort
              </div>
              <select className="field field-sm w-auto" value={sort} onChange={(e: any) => setSort(e.target.value)}>
                <option value="final_score">Best opportunity</option>
                <option value="evidence_confidence">Best supported</option>
                <option value="current_demand">Most in demand</option>
                <option value="trend_momentum">Fastest growing</option>
                <option value="pain_severity">Most painful</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2 mt-3.5">
              {[
                ['all', 'All'],
                ['validated', 'Backed by sources'],
                ['mixed', 'Mixed proof'],
                ['80', 'Score 80+'],
                ['70', 'Score 70+'],
                ['insufficient', 'Not enough proof'],
              ].map(([key, label]) => (
                <Chip key={key} active={labelFilter === key} onClick={() => setLabelFilter(key)}>{label}</Chip>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-line-soft flex flex-wrap items-center justify-between gap-3">
              <ScoreLegend />
              <div className="text-[11.5px] text-ink-faint">
                {activeRun ? `Read ${bundle?.evidence.length ?? 0} real pages and posts` : ''}
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            {filtered.map((r, i) => <OpportunityCard key={r.problem.id} row={r} rank={i + 1} />)}
            {!filtered.length ? <EmptyState title="No opportunities match those filters" body="Clear the filters to see everything the run produced." /> : null}
          </div>

          {/* --------------------- beyond the run --------------------- */}
          {unmined.length ? (
            <div className="mt-8">
              <SectionTitle
                title="Discovered but not yet mined"
                sub="These niches passed the evidence gate but were outside the top-N analysed in this run. Open one and mine its problems on demand."
              />
              <div className="grid sm:grid-cols-2 gap-3">
                {unmined.map((n) => (
                  <Card key={n.id} className="pad p-4 cursor-pointer hover:shadow-lift transition" onClick={() => navigate(`/niche/${n.id}`)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium text-ink leading-snug">{n.specific_niche}</div>
                        <div className="text-[12px] text-ink-mute mt-1 line-clamp-2">{n.core_problem}</div>
                      </div>
                      <Tag tone="lilac">{n.specificity_score} spec</Tag>
                    </div>
                    <div className="flex items-center gap-3 mt-2.5 text-[11.5px] text-ink-faint">
                      <span>{n.evidence_count} sources</span>
                      <span>{n.independent_domains} domains</span>
                      <span>{n.recent_evidence_count} recent</span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}

          {rejected.length ? (
            <div className="mt-8">
              <SectionTitle
                title="Rejected by the evidence gate"
                sub="Shown for transparency — these candidates lacked enough independent, recent or specific evidence to be presented as opportunities."
              />
              <div className="rounded-xl2 border border-line bg-white divide-y divide-line-soft overflow-hidden">
                {rejected.map((r) => (
                  <div key={r.niche.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium text-ink">{r.niche.specific_niche}</div>
                        <div className="text-[12px] text-ink-mute mt-1">{r.niche.core_problem}</div>
                        <div className="text-[11.5px] text-sun-600 mt-2 flex items-start gap-1.5">
                          <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {r.reason}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/niche/${r.niche.id}`)}>Inspect</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ------------------------- run notes ---------------------- */}
          {(activeRun?.stages?.length ?? 0) > 0 ? (
            <div className="mt-8">
              <SectionTitle title="Run log" sub="Exactly what happened, stage by stage — including skipped stages and why." />
              <Card className="pad">
                <div className="space-y-3">
                  {(activeRun?.stages ?? []).map((s) => (
                    <div key={s.key} className="flex items-start justify-between gap-4 text-[12.5px]">
                      <div className="min-w-0 flex items-start gap-2.5">
                        {s.status === 'done' ? <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-moss-500 shrink-0" />
                          : s.status === 'skipped' ? <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-line shrink-0" />
                            : s.status === 'failed' ? <XCircle size={12} className="mt-0.5 text-rose-500 shrink-0" />
                              : <CircleDashed size={12} className="mt-0.5 text-ink-faint shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-ink">{s.label}</div>
                          {s.detail ? <div className="text-ink-faint text-[11.5px]">{s.detail}</div> : null}
                          {s.error ? <div className="text-rose-600 text-[11.5px]">{s.error}</div> : null}
                        </div>
                      </div>
                      <div className="text-ink-faint tnum shrink-0">{s.ms ? `${(s.ms / 1000).toFixed(1)}s` : s.status}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                  <Meta label="Started" value={activeRun ? relTime(activeRun.started_at) : '—'} />
                  <Meta label="Times it asked the AI" value={String(activeRun?.usage.ai_calls ?? 0)} />
                  <Meta label="Pages requested" value={String(activeRun?.usage.search_calls ?? 0)} />
                  <Meta label="Kept as evidence" value={String(bundle?.evidence.length ?? 0)} />
                </div>
                {activeRun ? (
                  <div className="mt-4 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={async () => {
                      await deleteRun(activeRun.id);
                      await reload();
                      setRows([]);
                      setBundle(null);
                      toast({ tone: 'info', title: 'Run deleted from this device' });
                      navigate('/home');
                    }}>Delete this run</Button>
                  </div>
                ) : null}
              </Card>
            </div>
          ) : null}
        </>
      ) : null}

      {/* --------------------------- query plan modal --------------------------- */}
      <Modal
        open={showPlan}
        onClose={() => setShowPlan(false)}
        title="Layered query plan"
        sub="Nine research layers. The model can only add queries — it can never remove coverage."
        wide
        footer={<Button variant="quiet" onClick={() => setShowPlan(false)}>Close</Button>}
      >
        {queries.length ? (
          <div className="space-y-5">
            {QUERY_LAYERS.map((layer) => {
              const list = queries.filter((q) => q.layer === layer.layer);
              if (!list.length) return null;
              return (
                <div key={layer.layer}>
                  <div className="flex items-center gap-2 mb-2">
                    <Tag tone="lilac">Layer {layer.layer}</Tag>
                    <span className="text-[13px] font-medium">{layer.name.replace(/_/g, ' ')}</span>
                    <span className="text-[11.5px] text-ink-faint">— {layer.purpose}</span>
                  </div>
                  <div className="rounded-xl2 border border-line divide-y divide-line-soft overflow-hidden">
                    {list.map((q) => (
                      <div key={q.id} className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                        <span className="font-mono text-[12.5px] text-ink-soft break-words">{q.query}</span>
                        <span className="text-[11px] text-ink-faint shrink-0">{q.executed ? `${q.results_count} results` : 'not executed'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No plan yet" body="Run discovery to generate the layered query set for your audience." />
        )}
      </Modal>
    </Page>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">{label}</div>
      <div className="text-[13px] text-ink mt-0.5 tnum">{value}</div>
    </div>
  );
}
