import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, BadgeCheck, BookOpen, Compass, Hammer, Quote, RefreshCw,
  ShieldAlert, Sparkles, Target, Users,
} from 'lucide-react';
import { Page, navigate, useRoute } from '../components/shell';
import { Button, Callout, Card, ConfidenceMeter, EmptyState, KeyValue, MarkdownView, ScoreBadge, SectionTitle, Tabs, Tag, cx } from '../components/ui';
import { EvidenceList, ScoreBreakdown, SourceTypeTag } from '../components/intelligence';
import { db } from '../core/db/database';
import { scoreProblemNow } from '../core/intelligence/orchestrator';
import { STATUS_LABEL, STATUS_TONE } from '../core/intelligence/scoringEngine';
import { createProjectFromOpportunity } from '../core/product/engines';
import { useStore } from '../store';
import type { Evidence, Niche, OpportunityReport, OpportunityScore, Problem, Validation } from '../core/types';
import { truncate } from '../core/lib/utils';

export default function ProblemDetail() {
  const route = useRoute();
  const problemId = route.parts[1];
  const { toast, reload } = useStore();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [niche, setNiche] = useState<Niche | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [score, setScore] = useState<OpportunityScore | null>(null);
  const [report, setReport] = useState<OpportunityReport | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [cited, setCited] = useState<Evidence[]>([]);
  const [contradicting, setContradicting] = useState<Evidence[]>([]);
  const [tab, setTab] = useState('intelligence');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const p = await db.problems.get(problemId);
    if (!p) return;
    setProblem(p);
    const [n, v, s, r, ev] = await Promise.all([
      db.niches.get(p.niche_id),
      db.validations.where('problem_id').equals(p.id).first(),
      db.opportunity_scores.where('problem_id').equals(p.id).first(),
      db.reports.where('problem_id').equals(p.id).first(),
      db.evidence.where('research_run_id').equals(p.research_run_id).toArray(),
    ]);
    setNiche(n ?? null);
    setValidation(v ?? null);
    setScore(s ?? null);
    setReport(r ?? null);
    setEvidence(ev);
    if (v) {
      setCited(ev.filter((e) => v.supporting_evidence_ids.includes(e.id)));
      setContradicting(ev.filter((e) => v.contradicting_evidence_ids.includes(e.id)));
    }
  };

  useEffect(() => { void load(); }, [problemId]);

  const rescore = async () => {
    setBusy('score');
    try {
      await scoreProblemNow(problemId, (label) => toast({ tone: 'info', title: label }));
      await load();
      toast({ tone: 'success', title: 'Re-validated with a fresh adversarial search pass' });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Scoring failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const createProduct = async () => {
    if (!problem || !niche) return;
    setBusy('create');
    try {
      const project = await createProjectFromOpportunity(niche.id, problem.id);
      await reload();
      navigate(`/create/${project.id}`);
    } catch (e: any) {
      toast({ tone: 'error', title: 'Could not open the product workspace', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  if (!problem || !niche) {
    return (
      <Page title="Problem">
        <Card className="pad"><div className="skeleton h-6 w-2/3 mb-3" /><div className="skeleton h-4 w-1/2" /></Card>
      </Page>
    );
  }

  return (
    <Page
      wide
      title={truncate(problem.problem_statement, 110)}
      sub={niche.specific_niche}
      badge={
        <>
          {validation ? <Tag tone={STATUS_TONE[validation.status]}>{STATUS_LABEL[validation.status]}</Tag> : <Tag tone="neutral">not validated</Tag>}
          <Tag tone="neutral">{problem.evidence_count} cited sources</Tag>
          {score?.insufficient_evidence ? <Tag tone="sun">insufficient evidence</Tag> : null}
        </>
      }
      actions={
        <>
          <Button variant="quiet" onClick={() => navigate(`/niche/${niche.id}`)}><ArrowLeft size={14} /> Niche</Button>
          <Button variant="quiet" loading={busy === 'score'} onClick={rescore}><RefreshCw size={14} /> Re-validate</Button>
          <Button loading={busy === 'create'} onClick={createProduct}><Hammer size={14} /> Create this product</Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1.55fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          {/* ----------------------- score panel ----------------------- */}
          {score ? (
            <Card className="pad">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <div className="micro mb-2">Opportunity score</div>
                  <div className="flex items-end gap-3">
                    <ScoreBadge score={score.final_score} insufficient={score.insufficient_evidence} size="lg" />
                  </div>
                  <div className="mt-3 w-[220px]">
                    <ConfidenceMeter value={score.evidence_confidence} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12.5px] min-w-[230px]">
                  <div><div className="text-ink-faint text-[11px]">Base score</div><div className="tnum font-medium">{score.base_score.toFixed(1)}</div></div>
                  <div><div className="text-ink-faint text-[11px]">Confidence multiplier</div><div className="tnum font-medium">×{score.confidence_multiplier.toFixed(3)}</div></div>
                  <div><div className="text-ink-faint text-[11px]">Contradiction rate</div><div className="tnum font-medium">{(score.contradiction_rate * 100).toFixed(1)}%</div></div>
                  <div><div className="text-ink-faint text-[11px]">Penalty multiplier</div><div className="tnum font-medium">×{score.contradiction_multiplier.toFixed(3)}</div></div>
                  <div className="col-span-2 text-[11.5px] text-ink-faint">
                    Scored by engine {score.scoring_version} — the model supplied component assessments only.
                  </div>
                </div>
              </div>
              {score.insufficient_evidence ? (
                <div className="mt-4">
                  <Callout tone="warn" title="Marked as insufficient evidence">
                    The evidence gate was not met, so this score is shown for transparency but must not be treated as a validated
                    opportunity. Add a search provider, narrow the audience, or re-run discovery to collect more sources.
                  </Callout>
                </div>
              ) : null}
            </Card>
          ) : (
            <Card className="pad">
              <EmptyState
                icon={<Sparkles size={20} />}
                title="Not validated or scored yet"
                body="An adversarial search pass looks for evidence that disproves this opportunity, then the engine scores it."
                action={<Button loading={busy === 'score'} onClick={rescore}><Sparkles size={14} /> Validate & score</Button>}
              />
            </Card>
          )}

          {validation ? (
            <Card className="pad">
              <SectionTitle
                title="Why we think this is an opportunity"
                sub="Adversarial validation: the system actively searched for reasons this would fail."
                icon={<BadgeCheck size={17} />}
              />
              <MarkdownView md={validation.reasoning_summary} />
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <Metric label="Supporting sources" value={validation.supporting_evidence_ids.length} tone="moss" />
                <Metric label="Contradicting sources" value={validation.contradicting_evidence_ids.length} tone={validation.contradicting_evidence_ids.length ? 'rose' : 'neutral'} />
                <Metric label="Disproof searches" value={validation.searches_run} tone="neutral" />
              </div>
              <div className="mt-5 pt-4 border-t border-line-soft grid sm:grid-cols-5 gap-3">
                {Object.entries(validation.confidence_components).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10.5px] uppercase tracking-[0.05em] text-ink-faint">{k.replace(/_/g, ' ')}</div>
                    <div className="text-[13px] tnum font-medium mt-0.5">{Math.round(v as number)}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {report ? (
            <Card className="pad">
              <SectionTitle title="Opportunity report" sub="Written by the model from the computed score and cited sources." icon={<Compass size={17} />} />
              <div className="space-y-5">
                <ReportBlock title="The opportunity" body={report.opportunity_summary} />
                <ReportBlock title="Why now" body={report.why_now} />
                <ReportBlock title="What the customer is dealing with" body={report.customer_problem} />
                <ReportBlock title="Why it is commercial" body={report.commercial_reason} />
                <div>
                  <h4 className="h3 mb-2">Risks to weigh</h4>
                  <ul className="space-y-2">
                    {report.risks.map((r) => (
                      <li key={r} className="flex items-start gap-2.5 text-[13.5px] text-ink-soft">
                        <ShieldAlert size={14} className="mt-1 shrink-0 text-sun-600" /> {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl2 bg-canvas border border-line-soft p-4">
                  <div className="micro mb-1.5">Next action this week</div>
                  <p className="text-[14px] text-ink leading-relaxed">{report.recommended_action}</p>
                </div>
                {report.positioning_angle ? (
                  <div>
                    <h4 className="h3 mb-2">Positioning angle</h4>
                    <p className="text-[13.5px] text-ink-soft leading-relaxed">{report.positioning_angle}</p>
                  </div>
                ) : null}
                {report.first_content_ideas?.length ? (
                  <div>
                    <h4 className="h3 mb-2">Content ideas that test interest first</h4>
                    <ul className="space-y-1.5">
                      {report.first_content_ideas.map((c) => <li key={c} className="text-[13.5px] text-ink-soft">• {c}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* --------------------- research detail --------------------- */}
          <div>
            <Tabs
              tabs={[
                { key: 'intelligence', label: 'Problem intelligence' },
                { key: 'components', label: 'Score breakdown' },
                { key: 'evidence', label: 'Evidence', badge: evidence.filter((e) => problem.evidence_ids.includes(e.id)).length },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div className="pt-5">
              {tab === 'intelligence' ? (
                <div className="space-y-4">
                  <Card className="pad">
                    <KeyValue
                      rows={[
                        { label: 'What people are struggling with', value: problem.problem_statement },
                        { label: 'Underlying problem', value: problem.underlying_problem },
                        { label: 'Who experiences it', value: problem.who_experiences_it },
                        { label: 'Why it hurts', value: problem.why_it_hurts },
                        { label: 'Why existing solutions fail', value: problem.why_existing_solutions_fail },
                      ]}
                    />
                  </Card>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <ListCard icon={<Users size={15} />} title="What they currently do" items={problem.current_workarounds} />
                    <ListCard icon={<Target size={15} />} title="What they search for" items={problem.what_people_search} />
                    <ListCard icon={<Quote size={15} />} title="How they say it" items={problem.customer_language} />
                    <ListCard icon={<BookOpen size={15} />} title="Where it is being discussed" items={problem.conversation_signals} />
                  </div>
                  <Card className="pad">
                    <SectionTitle title="Potential product solutions" sub="Smallest viable format first." icon={<Hammer size={16} />} />
                    <ul className="space-y-2">
                      {problem.potential_product_solutions.map((s) => (
                        <li key={s} className={cx('text-[13.5px] rounded-xl2 border px-3.5 py-2.5', s === problem.recommended_product ? 'border-lilac-500/30 bg-lilac-50 text-lilac-600 font-medium' : 'border-line-soft text-ink-soft')}>
                          {s}{s === problem.recommended_product ? ' — recommended' : ''}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              ) : null}

              {tab === 'components' ? (
                <Card className="pad">
                  {score ? <ScoreBreakdown score={score} /> : <EmptyState title="No score yet" body="Validate and score this problem to see the transparent breakdown." />}
                </Card>
              ) : null}

              {tab === 'evidence' ? (
                <div className="space-y-5">
                  {cited.length ? (
                    <div>
                      <h3 className="h3 mb-3 flex items-center gap-2"><BadgeCheck size={15} className="text-moss-600" /> Supporting evidence ({cited.length})</h3>
                      <EvidenceList evidence={cited} />
                    </div>
                  ) : null}
                  {contradicting.length ? (
                    <div>
                      <h3 className="h3 mb-3 flex items-center gap-2"><AlertTriangle size={15} className="text-rose-500" /> Contradicting evidence ({contradicting.length})</h3>
                      <EvidenceList evidence={contradicting} />
                    </div>
                  ) : (
                    <Callout tone="info" title="No contradicting evidence surfaced">
                      The adversarial pass did not find sources that weaken this opportunity. That is a genuine result — but re-run
                      validation periodically because markets move.
                    </Callout>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* --------------------------- sidebar --------------------------- */}
        <div className="space-y-5">
          <Card className="pad">
            <div className="flex items-center gap-2 mb-3"><Hammer size={16} /> <h3 className="h3">Recommended product</h3></div>
            <p className="text-[14px] text-ink leading-relaxed">{problem.recommended_product || 'Not determined yet.'}</p>
            <Button className="w-full mt-4" onClick={createProduct} loading={busy === 'create'}>
              Turn this problem into a product <ArrowUpRight size={14} />
            </Button>
            <p className="text-[11.5px] text-ink-faint mt-2.5">
              Opens the product workspace: format recommendation, outline, chapter-by-chapter writing, worksheets and PDF export.
            </p>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">Cited sources at a glance</h3>
            <div className="space-y-2.5">
              {evidence.filter((e) => problem.evidence_ids.includes(e.id)).slice(0, 6).map((e) => (
                <a key={e.id} href={e.source_url} target="_blank" rel="noreferrer" className="block rounded-xl2 border border-line-soft p-3 hover:border-line transition">
                  <div className="flex items-center gap-2 mb-1">
                    <SourceTypeTag type={e.source_type} />
                    <span className="text-[11px] text-ink-faint">{e.domain}</span>
                  </div>
                  <div className="text-[12.5px] text-ink leading-snug">{truncate(e.title, 90)}</div>
                </a>
              ))}
            </div>
            <button className="text-[12.5px] text-ink-mute hover:text-ink mt-3" onClick={() => setTab('evidence')}>
              See all {evidence.filter((e) => problem.evidence_ids.includes(e.id)).length} sources →
            </button>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">Niche context</h3>
            <KeyValue
              cols={1}
              rows={[
                { label: 'Niche', value: niche.specific_niche },
                { label: 'Audience', value: niche.target_audience },
                { label: 'Desired outcome', value: niche.desired_outcome },
                { label: 'Specificity', value: `${niche.specificity_score}/100` },
              ]}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'moss' | 'rose' | 'neutral' }) {
  const toneClass = { moss: 'text-moss-600', rose: 'text-rose-600', neutral: 'text-ink' }[tone];
  return (
    <div className="rounded-xl2 border border-line-soft bg-canvas px-3.5 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.05em] text-ink-faint">{label}</div>
      <div className={cx('text-[20px] font-semibold tnum mt-1', toneClass)}>{value}</div>
    </div>
  );
}

function ReportBlock({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="h3 mb-2">{title}</h4>
      <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  );
}

function ListCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <Card className="pad">
      <div className="flex items-center gap-2 mb-2.5 text-ink">{icon}<h3 className="h3">{title}</h3></div>
      {items?.length ? (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((i) => <li key={i} className="text-[13px] text-ink-soft leading-snug">• {i}</li>)}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-faint">No evidence found in the supplied sources.</p>
      )}
    </Card>
  );
}
