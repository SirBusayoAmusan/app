import { useEffect, useState } from 'react';
import { ArrowLeft, Compass, Hammer, Info, ListTree, Play, Sparkles, TriangleAlert, Users } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, EmptyState, KeyValue, ScoreBadge, SectionTitle, Tabs, Tag, cx } from '../components/ui';
import { EvidenceList, ScoreBreakdown, SignalList, type OpportunityRow } from '../components/intelligence';
import { useRoute } from '../components/shell';
import { db } from '../core/db/database';
import { mineProblemsForNiche, scoreProblemNow } from '../core/intelligence/orchestrator';
import { useStore } from '../store';
import { STATUS_LABEL, STATUS_TONE } from '../core/intelligence/scoringEngine';
import type { Evidence, Niche, OpportunityScore, Problem, Signal, Validation } from '../core/types';
import { truncate } from '../core/lib/utils';

export default function NicheDetail() {
  const route = useRoute();
  const nicheId = route.parts[1];
  const { toast, reload } = useStore();
  const [niche, setNiche] = useState<Niche | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [scores, setScores] = useState<Record<string, OpportunityScore>>({});
  const [validations, setValidations] = useState<Record<string, Validation>>({});
  const [tab, setTab] = useState('problems');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const n = await db.niches.get(nicheId);
    if (!n) return;
    setNiche(n);
    const [ev, sg, pr] = await Promise.all([
      db.evidence.where('research_run_id').equals(n.research_run_id).toArray(),
      db.signals.where('research_run_id').equals(n.research_run_id).toArray(),
      db.problems.where('niche_id').equals(n.id).toArray(),
    ]);
    setEvidence(ev);
    setSignals(sg.filter((s) => s.evidence_ids.some((id) => n.evidence_ids.includes(id)) || s.statement.length > 0).slice(0, 40));
    const sorted = pr.sort((a, b) => a.rank - b.rank);
    setProblems(sorted);
    const [sc, va] = await Promise.all([db.opportunity_scores.toArray(), db.validations.toArray()]);
    setScores(Object.fromEntries(sc.filter((s) => s.niche_id === n.id).map((s) => [s.problem_id, s])));
    setValidations(Object.fromEntries(va.filter((v) => sorted.some((p) => p.id === v.problem_id)).map((v) => [v.problem_id, v])));
  };

  useEffect(() => { void load(); }, [nicheId]);

  if (!niche) {
    return (
      <Page title="Niche">
        <Card className="pad">
          <div className="skeleton h-6 w-2/3 mb-3" />
          <div className="skeleton h-4 w-1/2" />
        </Card>
      </Page>
    );
  }

  const nicheEvidence = evidence.filter((e) => niche.evidence_ids.includes(e.id));
  const unmined = !problems.length;

  const mine = async () => {
    setBusy('mine');
    try {
      const res = await mineProblemsForNiche(niche.id, (label) => toast({ tone: 'info', title: label }));
      toast({ tone: 'success', title: `${res.problems} problems mined`, body: res.rejected.length ? `${res.rejected.length} rejected for weak evidence.` : undefined });
      await load();
      await reload();
    } catch (e: any) {
      toast({ tone: 'error', title: 'Problem mining failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const scoreNow = async (problemId: string) => {
    setBusy(problemId);
    try {
      await scoreProblemNow(problemId, (label) => toast({ tone: 'info', title: label }));
      await load();
      toast({ tone: 'success', title: 'Validated and scored', body: 'Adversarial search pass completed, contradictions counted.' });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Scoring failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title={truncate(niche.specific_niche, 90)}
      sub={niche.why_specific || undefined}
      badge={
        <>
          <Tag tone={niche.quality_gate?.passed ? 'moss' : 'sun'}>
            {niche.quality_gate?.passed ? 'Evidence gate passed' : 'Needs more evidence'}
          </Tag>
          <Tag tone="neutral">specificity {niche.specificity_score}/100</Tag>
        </>
      }
      actions={
        <>
          <Button variant="quiet" onClick={() => navigate('/discover')}><ArrowLeft size={14} /> Back</Button>
          {unmined ? <Button onClick={mine} loading={busy === 'mine'}><Hammer size={14} /> Mine problems</Button> : null}
        </>
      }
    >
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Card className="pad">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
              <KeyValue
                cols={1}
                rows={[
                  { label: 'Broad category', value: niche.broad_category },
                  { label: 'Target audience', value: niche.target_audience },
                  { label: 'Core problem', value: niche.core_problem },
                  { label: 'Desired outcome', value: niche.desired_outcome },
                  { label: 'Context', value: niche.context },
                ]}
              />
              <div className="space-y-3">
                <div className="rounded-xl2 border border-line-soft bg-canvas p-3.5">
                  <div className="micro mb-2">Evidence quality</div>
                  <div className="space-y-1.5 text-[12.5px]">
                    <div className="flex justify-between"><span className="text-ink-mute">Sources cited</span><span className="tnum">{niche.evidence_count}</span></div>
                    <div className="flex justify-between"><span className="text-ink-mute">Independent domains</span><span className="tnum">{niche.independent_domains}</span></div>
                    <div className="flex justify-between"><span className="text-ink-mute">Published in 90 days</span><span className="tnum">{niche.recent_evidence_count}</span></div>
                    <div className="flex justify-between"><span className="text-ink-mute">Merged duplicates</span><span className="tnum">{niche.merged_from?.length ?? 0}</span></div>
                  </div>
                </div>
                <div className="rounded-xl2 border border-line-soft bg-canvas p-3.5">
                  <div className="micro mb-2">Possible formats</div>
                  <div className="flex flex-wrap gap-1.5">
                    {niche.product_formats?.map((f) => <Tag key={f} tone="lilac">{f}</Tag>)}
                  </div>
                </div>
              </div>
            </div>
            {!niche.quality_gate?.passed ? (
              <div className="mt-4">
                <Callout tone="warn" title="Why this niche did not pass the gate">
                  <ul className="space-y-1">{niche.quality_gate?.failures?.map((f) => <li key={f}>• {f}</li>)}</ul>
                </Callout>
              </div>
            ) : null}
          </Card>

          <div>
            <Tabs
              tabs={[
                { key: 'problems', label: 'Problems', badge: problems.length },
                { key: 'evidence', label: 'Evidence', badge: nicheEvidence.length },
                { key: 'signals', label: 'Signals' },
                { key: 'method', label: 'Specificity audit' },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div className="pt-5">
              {tab === 'problems' ? (
                unmined ? (
                  <EmptyState
                    icon={<Hammer size={20} />}
                    title="Problems not mined yet"
                    body="This niche was discovered but not analysed in depth. Mining extracts the specific problems and their evidence."
                    action={<Button onClick={mine} loading={busy === 'mine'}><Play size={14} /> Mine problems</Button>}
                  />
                ) : (
                  <div className="space-y-4">
                    {problems.map((p) => {
                      const score = scores[p.id];
                      const validation = validations[p.id];
                      return (
                        <Card key={p.id} className="pad">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                <span className="text-[12px] font-semibold text-ink-faint tnum">#{p.rank}</span>
                                {validation ? <Tag tone={STATUS_TONE[validation.status]}>{STATUS_LABEL[validation.status]}</Tag> : <Tag tone="neutral">unscored</Tag>}
                                <Tag tone="neutral">{p.evidence_count} sources</Tag>
                              </div>
                              <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] leading-snug cursor-pointer hover:underline" onClick={() => navigate(`/problem/${p.id}`)}>
                                {p.problem_statement}
                              </h3>
                              <p className="sub mt-1.5">{truncate(p.underlying_problem, 180)}</p>
                            </div>
                            {score ? <ScoreBadge score={score.final_score} insufficient={score.insufficient_evidence} /> : null}
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="quiet" onClick={() => navigate(`/problem/${p.id}`)}>Open intelligence</Button>
                            {!score ? (
                              <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => scoreNow(p.id)}>
                                <Sparkles size={13} /> Validate & score
                              </Button>
                            ) : null}
                            {score ? <Button size="sm" variant="ghost" onClick={() => navigate(`/create/new?problem=${p.id}`)}><Hammer size={13} /> Create product</Button> : null}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )
              ) : null}

              {tab === 'evidence' ? <EvidenceList evidence={nicheEvidence} citedIds={niche.evidence_ids} /> : null}
              {tab === 'signals' ? <SignalList signals={signals.slice(0, 24)} evidence={evidence} /> : null}
              {tab === 'method' ? (
                <Card className="pad">
                  <SectionTitle title="Why this scored as specific" sub="Deterministic specificity checks — the model cannot grade its own specificity." icon={<ListTree size={16} />} />
                  <ul className="space-y-2 text-[13px] text-ink-soft">
                    {niche.specificity_notes?.map((note) => (
                      <li key={note} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-lilac-500 shrink-0" /> {note}
                      </li>
                    ))}
                  </ul>
                  {niche.merged_from?.length ? (
                    <div className="mt-4 pt-4 border-t border-line-soft text-[12.5px] text-ink-mute">
                      This niche absorbed {niche.merged_from.length} near-duplicate candidate{niche.merged_from.length === 1 ? '' : 's'} during clustering
                      (lexical similarity above the configured threshold with shared evidence).
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <Card className="pad">
            <div className="flex items-center gap-2 mb-3"><Compass size={16} /> <h3 className="h3">Opportunity snapshot</h3></div>
            {Object.values(scores).length ? (
              <div className="space-y-4">
                {Object.values(scores).slice(0, 3).map((s) => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between mb-2">
                      <ScoreBadge score={s.final_score} insufficient={s.insufficient_evidence} />
                      <span className="text-[12px] text-ink-faint">{s.evidence_confidence.toFixed(0)}% confidence</span>
                    </div>
                    <ScoreBreakdown score={s} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-faint">No scored problems in this niche yet.</p>
            )}
          </Card>

          <Card className="pad">
            <div className="flex items-center gap-2 mb-3"><Info size={16} /> <h3 className="h3">What we know</h3></div>
            <div className="space-y-2.5 text-[12.5px] text-ink-mute leading-relaxed">
              <p>• <strong className="text-ink">{niche.evidence_count} sources</strong> across <strong className="text-ink">{niche.independent_domains} domains</strong>, of which {niche.recent_evidence_count} were published in the last 90 days.</p>
              <p>• Problems shown here are only those the sources actually support — anything the model could not cite was discarded before display.</p>
              <p>• Contradictory evidence is counted against the score rather than hidden.</p>
            </div>
          </Card>

          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><Users size={15} /> <h3 className="h3">Next steps</h3></div>
            <div className="space-y-2">
              <Button className="w-full" variant="quiet" onClick={() => navigate('/audience')}>Refine audience for sharper evidence</Button>
              <Button className="w-full" variant="quiet" onClick={() => navigate('/trends')}>Browse all sources from this run</Button>
              {problems[0] ? <Button className="w-full" onClick={() => navigate(`/problem/${problems[0].id}`)}>Open top problem</Button> : null}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
