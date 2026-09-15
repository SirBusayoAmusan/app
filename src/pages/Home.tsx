import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Compass, Play, Plug, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wand2 } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { MascotJourney } from '../components/Mascot';
import { Button, Callout, Card, EmptyState, SectionTitle, Stat, Tag, cx } from '../components/ui';
import { OpportunityCard, type OpportunityRow } from '../components/intelligence';
import { useStore, sessionState } from '../store';
import { db } from '../core/db/database';
import { STAGES } from '../core/intelligence/orchestrator';
import { searchProviderReady } from '../core/intelligence/searchProviders';
import { relTime, truncate } from '../core/lib/utils';
import type { Niche, OpportunityScore, Problem, Validation } from '../core/types';

export default function Home() {
  const { settings, audience, runs, sessionVersion } = useStore();
  const [rows, setRows] = useState<OpportunityRow[]>([]);
  const [counts, setCounts] = useState({ evidence: 0, niches: 0, problems: 0, projects: 0 });
  const connected = Boolean(sessionState.connectedAt);
  const searchReady = searchProviderReady(settings?.search).ready;

  /* One next action, in dependency order. */
  const allReady = connected && searchReady && Boolean(audience);
  const nextStep = !connected
    ? { title: 'Connect your AI key', body: 'CreatorTools runs on your own key. It takes about a minute and nothing is stored.', cta: 'Set up', to: '/setup' }
    : !searchReady
      ? { title: 'Add a search key', body: 'This is what lets CreatorTools read real pages instead of guessing. Without it, nothing gets called a trend.', cta: 'Add key', to: '/setup' }
      : { title: 'Describe who you are selling to', body: 'A named audience with a specific problem is what turns research into an opportunity.', cta: 'Set audience', to: '/audience' };
  const nextStepNumber = !connected ? 1 : !searchReady ? 2 : 3;
  const latestRun = runs[0];
  void sessionVersion;

  useEffect(() => {
    (async () => {
      const [niches, problems, scores, validations, projects, evidenceCount] = await Promise.all([
        db.niches.toArray(),
        db.problems.toArray(),
        db.opportunity_scores.toArray(),
        db.validations.toArray(),
        db.projects.toArray(),
        db.evidence.count(),
      ]);
      const nicheById = new Map<string, Niche>(niches.map((n) => [n.id, n]));
      const scoreByProblem = new Map<string, OpportunityScore>(scores.map((s) => [s.problem_id, s]));
      const valByProblem = new Map<string, Validation>(validations.map((v) => [v.problem_id, v]));
      const built = problems
        .map((p: Problem) => ({ problem: p, niche: nicheById.get(p.niche_id)!, score: scoreByProblem.get(p.id), validation: valByProblem.get(p.id) }))
        .filter((r) => r.niche && r.score)
        .sort((a, b) => (b.score!.final_score) - (a.score!.final_score));
      setRows(built);
      setCounts({ evidence: evidenceCount, niches: niches.length, problems: problems.length, projects: projects.length });
    })();
  }, [runs.length]);

  const top = useMemo(() => rows.slice(0, 3), [rows]);
  const bestScore = rows[0]?.score;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <Page wide>
      {/* ------------------------------- hero ------------------------------- */}
      <section className="mb-7">
        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6 lg:gap-10 items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-faint mb-3">
              <Sparkles size={13} /> {greeting}, Creator
            </div>
            <h1 className="text-[30px] sm:text-[40px] lg:text-[46px] font-semibold tracking-[-0.04em] leading-[1.06]">
              Stop guessing what to sell.
            </h1>
            <p className="sub mt-4 max-w-2xl text-[15px] leading-relaxed">
              Find real problems people are trying to solve, turn them into products, and build the system to sell them.
            </p>
          </div>
          {/* Pip walks the three steps so the shape of the whole product is
              legible before anyone reads a word of the copy. */}
          <MascotJourney className="order-first lg:order-none" />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => navigate('/discover')}>
            <Compass size={16} /> Find My Opportunity
          </Button>
          <Button size="lg" variant="quiet" onClick={() => navigate('/learn')}>Explore How It Works</Button>
        </div>
      </section>

      {/* --------------------------- readiness ------------------------------
          Exactly one thing to do next, never a wall of warnings. The order is
          the real dependency order: key → evidence → audience → run. */}
      {!allReady ? (
        <Card className="pad mb-7">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] font-medium tracking-[0.06em] uppercase text-ink-faint mb-1">
                Step {nextStepNumber} of 3
              </div>
              <div className="text-[15px] font-semibold">{nextStep.title}</div>
              <p className="sub mt-1">{nextStep.body}</p>
            </div>
            <Button size="lg" className="shrink-0" onClick={() => navigate(nextStep.to)}>
              {nextStep.cta} <ArrowRight size={15} />
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-4">
            {[connected, searchReady, Boolean(audience)].map((done, i) => (
              <div key={i} className={cx('h-1.5 rounded-full flex-1 transition-colors', done ? 'bg-moss-500' : 'bg-line')} />
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          {/* ---------------------- audience card ----------------------- */}
          <Card className="pad">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <span className="h-11 w-11 rounded-2xl bg-lilac-100 text-lilac-600 flex items-center justify-center shrink-0">
                  <Users size={19} />
                </span>
                <div className="min-w-0">
                  <h2 className="h2">Your target audience</h2>
                  <p className="sub mt-1">We'll tailor search queries, problem ranking, messaging and pricing to these people.</p>
                </div>
              </div>
              <Button variant="quiet" size="sm" onClick={() => navigate('/audience')}>Edit</Button>
            </div>
            {audience ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
                {[
                  ['Age range', `${audience.age_min} – ${audience.age_max}`],
                  ['Gender', audience.gender],
                  ['Location', audience.location],
                  ['Income level', audience.income_level],
                  ['Employment', truncate(audience.employment_status, 34)],
                  ['Experience', audience.experience_level],
                  ['Interests', audience.interests.length ? truncate(audience.interests.join(', '), 34) : 'Not set'],
                  ['Platforms', audience.platforms.length ? truncate(audience.platforms.join(', '), 34) : 'Not set'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl2 border border-line-soft bg-canvas px-3.5 py-3">
                    <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">{label}</div>
                    <div className="text-[13px] text-ink mt-1 leading-snug">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <Button onClick={() => navigate('/audience')}>Define audience</Button>
              </div>
            )}
          </Card>

          {/* --------------------- opportunities ------------------------ */}
          <div>
            <SectionTitle
              title="Top opportunities"
              sub={rows.length ? 'Ranked by how strong each one is, with how well the sources back it up shown separately.' : undefined}
              action={rows.length ? <Button variant="quiet" size="sm" onClick={() => navigate('/discover')}>See all <ArrowRight size={13} /></Button> : undefined}
            />
            {top.length ? (
              <div className="space-y-4">{top.map((r, i) => <OpportunityCard key={r.problem.id} row={r} rank={i + 1} />)}</div>
            ) : (
              <EmptyState
                icon={<Target size={22} />}
                title="No opportunities yet"
                body="Run discovery to collect current market evidence, extract signals, mine problems and score opportunities."
                action={<Button onClick={() => navigate('/discover')}><Play size={14} /> Run discovery</Button>}
              />
            )}
          </div>

          {/* ------------------------ how it works --------------------- */}
          <Card className="pad">
            <SectionTitle
              title="How each recommendation is made"
              sub="Eleven steps. Finding the sources and doing the maths are handled by the app, never guessed by the AI."
              icon={<Wand2 size={17} />}
            />
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {STAGES.map((s, i) => (
                <li key={s.key} className="flex items-start gap-3 text-[13px] text-ink-soft">
                  <span className="h-5 w-5 rounded-full bg-line-soft text-ink-mute text-[11px] flex items-center justify-center shrink-0 mt-0.5 tnum">{i + 1}</span>
                  <span>{s.verb}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="pad bg-canvas">
            <blockquote className="text-[15px] leading-relaxed text-ink-soft italic">
              “The internet provides the evidence. AI provides the intelligence. The scoring system provides the differentiation.”
            </blockquote>
            <div className="mt-3 text-[12px] text-ink-faint">Every score can be traced back to the exact pages behind it.</div>
          </Card>
        </div>

        {/* ---------------------------- sidebar ---------------------------- */}
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Evidence collected" value={counts.evidence.toLocaleString()} sub="dated sources with URLs" />
            <Stat label="Niches found" value={counts.niches} sub={`${rows.length} scored problems`} />
            <Stat label="Best score" value={bestScore ? bestScore.final_score.toFixed(1) : '—'} tone={bestScore && bestScore.final_score >= 75 ? 'moss' : 'ink'} sub={bestScore ? `${bestScore.evidence_confidence.toFixed(0)}% confidence` : 'run discovery'} />
            <Stat label="Projects" value={counts.projects} sub="opportunities in build" />
          </div>

          <Card className="pad">
            <div className="flex items-center justify-between mb-3">
              <h3 className="h3">Session</h3>
              <Tag tone={connected ? 'moss' : 'sun'}>{connected ? 'AI connected' : 'not connected'}</Tag>
            </div>
            <div className="space-y-2.5 text-[12.5px]">
              <Row label="Your AI" value={settings?.ai ? `${settings.ai.provider} · ${truncate(settings.ai.model, 26)}` : 'Not connected'} onClick={() => navigate('/settings')} />
              <Row label="AI reply time" value={sessionState.capability ? `${sessionState.capability.latency_ms}ms` : '—'} />
              <Row label="Intelligence source" value={settings?.search?.id && settings.search.id !== 'none' ? settings.search.id : 'none'} onClick={() => navigate('/settings')} />
              <Row label="Search queries / run" value={String(settings?.methodology.max_queries ?? 24)} />
              <Row label="Sources must be newer than" value={`${settings?.methodology.freshness_days ?? 90} days old`} />
            </div>
            <div className="mt-4 pt-4 border-t border-line-soft flex items-start gap-2.5 text-[11.5px] text-ink-faint">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              Your research, products and analytics never leave this device. API keys are session-only.
            </div>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">Recent runs</h3>
            {runs.length ? (
              <div className="space-y-2.5">
                {runs.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/discover?run=${r.id}`)}
                    className="w-full text-left rounded-xl2 border border-line-soft px-3.5 py-3 hover:border-line transition"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{r.audience_snapshot?.location ?? 'Global'} · {r.audience_snapshot?.age_min}-{r.audience_snapshot?.age_max}</span>
                      <Tag tone={r.status === 'complete' ? 'moss' : r.status === 'failed' ? 'rose' : r.status === 'partial' ? 'sun' : 'neutral'}>{r.status}</Tag>
                    </div>
                    <div className="text-[11.5px] text-ink-faint mt-1">
                      {relTime(r.started_at)} · {r.usage?.evidence_collected ?? 0} sources · {r.usage?.ai_calls ?? 0} model calls
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-faint">No runs yet.</p>
            )}
          </Card>

          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><Plug size={15} /> <h3 className="h3">Where to go next</h3></div>
            <div className="space-y-1.5">
              {[
                ['/trends', 'Trend Intelligence', 'Browse every source collected'],
                ['/projects', 'My Products', 'Products in build and launched'],
                ['/marketing', 'Marketing engine', 'Content, email, funnel assets'],
                ['/learn', 'How it works', 'Exactly what the app checks, in plain English'],
              ].map(([path, label, sub]) => (
                <button key={path} onClick={() => navigate(path)} className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-line-soft transition flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-[13px] font-medium text-ink">{label}</span>
                    <span className="block text-[11.5px] text-ink-faint">{sub}</span>
                  </span>
                  <ArrowRight size={14} className="text-ink-faint" />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Row({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div className={cx('flex items-center justify-between gap-3', onClick && 'cursor-pointer hover:opacity-80')} onClick={onClick}>
      <span className="text-ink-mute">{label}</span>
      <span className="text-ink font-medium truncate text-right">{value}</span>
    </div>
  );
}
