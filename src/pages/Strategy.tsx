import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Check, DollarSign, Download, Megaphone, Printer, RefreshCw, Rocket, Sparkles, Target, TrendingUp, Zap,
} from 'lucide-react';
import { Page, navigate, useRoute } from '../components/shell';
import {
  Button, Callout, Card, CopyBlock, EmptyState, Field, Input, KeyValue, SectionTitle, Select, Tabs, Tag, Textarea, Toggle, cx,
} from '../components/ui';
import { db } from '../core/db/database';
import {
  LAUNCH_TASKS, MARKETING_MODULES, analyzePerformance, computeMetrics, exportProjectJSON,
  generateAds, generateLaunchPlan, generateMarketingModule, generatePricing, setLaunchTask,
} from '../core/product/engines';
import { exportCSV, exportJSON } from '../core/export/exporters';
import { useStore } from '../store';
import type { AnalyticsSnapshot, AnalyticsInputs, Campaign, LaunchPlan, MarketingAsset, PricingPlan, Project } from '../core/types';
import { fmtMoney, fmtNumber, relTime, truncate } from '../core/lib/utils';

/* ------------------------------ shared -------------------------------- */

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { runs } = useStore();
  useEffect(() => {
    db.projects.orderBy('updated_at').reverse().toArray().then(setProjects);
  }, [runs.length]);
  return projects;
}

function useActiveProject(): [Project | null, (p: Project) => void, Project[]] {
  const route = useRoute();
  const projects = useProjects();
  const routeId = route.parts[1];
  const [selected, setSelected] = useState<string | null>(routeId && routeId !== 'new' ? routeId : null);
  const project = useMemo(() => projects.find((p) => p.id === (selected ?? projects[0]?.id)) ?? null, [projects, selected]);
  return [project, (p) => setSelected(p.id), projects];
}

function ProjectHeader({ project, projects, onSelect, right }: { project: Project | null; projects: Project[]; onSelect: (p: Project) => void; right?: React.ReactNode }) {
  if (!project) return null;
  return (
    <Card className="pad mb-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="micro mb-1">Active project</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="field field-sm w-auto max-w-full font-medium"
              value={project.id}
              onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); if (p) onSelect(p); }}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{truncate(p.name, 70)}</option>)}
            </select>
            <Tag tone="neutral">{project.status}</Tag>
          </div>
        </div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
    </Card>
  );
}

function NoProject({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Sparkles size={22} />}
      title={`No project to ${what} yet`}
      body="Choose an opportunity, generate a product, then this workspace becomes active."
      action={<Button onClick={() => navigate('/discover')}>Find an opportunity</Button>}
    />
  );
}

const aiCtxFrom = (settings: any) => (settings?.ai ? { config: settings.ai, onUsage: () => {} } : null);

/* ---------------------------- marketing ------------------------------- */

export function MarketingPage() {
  const { settings, toast } = useStore();
  const [project, select, projects] = useActiveProject();
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [active, setActive] = useState<string>(MARKETING_MODULES[0].key);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    db.marketing.where('project_id').equals(project.id).toArray().then(setAssets);
  }, [project?.id]);

  const current = assets.find((a) => a.module_key === active);
  const mod = MARKETING_MODULES.find((m) => m.key === active)!;
  const ctx = aiCtxFrom(settings);

  const run = async (key: string) => {
    if (!project) return;
    if (!ctx) {
      toast({ tone: 'warn', title: 'Connect your AI provider first' });
      return navigate('/setup');
    }
    setBusy(key);
    try {
      const saved = await generateMarketingModule(ctx, project.id, key);
      setAssets((prev) => [...prev.filter((a) => a.module_key !== key), saved]);
      toast({ tone: 'success', title: `${saved.title} ready` });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Generation failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  if (!project) return <Page wide title="Build the marketing machine"><NoProject what="market" /></Page>;

  return (
    <Page
      wide
      title="Build the marketing machine"
      sub="Positioning, offer, content, email, community and funnel assets — written for this specific validated problem."
      badge={<Tag tone="lilac"><Megaphone size={11} /> {MARKETING_MODULES.length} modules</Tag>}
      actions={
        <>
          <Button variant="quiet" onClick={async () => { exportJSON('marketing-assets', assets); }}><Download size={14} /> Export</Button>
          <Button onClick={() => run(active)} loading={busy === active}><Sparkles size={14} /> Generate {mod.title}</Button>
        </>
      }
    >
      <ProjectHeader project={project} projects={projects} onSelect={select} right={<Button variant="quiet" size="sm" onClick={() => navigate(`/create/${project.id}`)}>Product</Button>} />

      <div className="grid lg:grid-cols-[240px_1fr] gap-5 items-start">
        <Card className="p-2 hidden lg:block">
          {MARKETING_MODULES.map((m) => {
            const done = assets.some((a) => a.module_key === m.key);
            const on = active === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setActive(m.key)}
                className={cx('w-full text-left rounded-xl px-3 py-2.5 text-[13px] transition flex items-center justify-between gap-2', on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft')}
              >
                <span className="truncate">{m.title}</span>
                {done ? <Check size={13} className={on ? 'text-white' : 'text-moss-500'} /> : null}
              </button>
            );
          })}
        </Card>

        <div className="space-y-4">
          <div className="lg:hidden">
            <Select value={active} onChange={(e: any) => setActive(e.target.value)}>
              {MARKETING_MODULES.map((m) => <option key={m.key} value={m.key}>{m.title}{assets.some((a) => a.module_key === m.key) ? ' ✓' : ''}</option>)}
            </Select>
          </div>

          <Card className="pad">
            <SectionTitle
              title={mod.title}
              sub={mod.brief}
              action={<Button size="sm" loading={busy === active} onClick={() => run(active)}>{current ? <RefreshCw size={13} /> : <Sparkles size={13} />} {current ? 'Regenerate' : 'Generate'}</Button>}
            />
            {current ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{current.payload.headline}</h3>
                  <p className="sub mt-1.5">{current.payload.summary}</p>
                </div>
                {current.payload.blocks?.map((b: any) => (
                  <div key={b.title} className="rounded-xl2 border border-line-soft p-4">
                    <div className="text-[13.5px] font-medium text-ink">{b.title}</div>
                    {b.detail ? <p className="text-[13px] text-ink-mute mt-1 leading-relaxed">{b.detail}</p> : null}
                    {b.items?.length ? (
                      <ul className="mt-2.5 space-y-1.5">
                        {b.items.map((i: string) => <li key={i} className="text-[13px] text-ink-soft">• {i}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ))}
                {current.payload.assets?.length ? (
                  <div className="space-y-3">
                    <h4 className="h3">Copy-paste assets</h4>
                    {current.payload.assets.map((a: any) => <CopyBlock key={a.label} label={a.label} text={a.content} />)}
                  </div>
                ) : null}
                {current.payload.next_actions?.length ? (
                  <Callout tone="lilac" title="Do next">
                    <ul className="space-y-1">{current.payload.next_actions.map((n: string) => <li key={n}>• {n}</li>)}</ul>
                  </Callout>
                ) : null}
                <div className="text-[11.5px] text-ink-faint">Generated {relTime(current.updated_at)} · {current.meta?.model ?? 'model not recorded'}</div>
              </div>
            ) : (
              <EmptyState
                title={`${mod.title} not generated`}
                body={mod.brief}
                action={<Button loading={busy === active} onClick={() => run(active)}><Sparkles size={14} /> Generate {mod.title}</Button>}
              />
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ----------------------------- pricing -------------------------------- */

export function PricingPage() {
  const { settings, toast } = useStore();
  const [project, select, projects] = useActiveProject();
  const [plan, setPlan] = useState<PricingPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = aiCtxFrom(settings);

  useEffect(() => {
    if (!project) return;
    db.pricing.where('project_id').equals(project.id).first().then((p) => setPlan(p ?? null));
  }, [project?.id]);

  const run = async () => {
    if (!project) return;
    if (!ctx) { toast({ tone: 'warn', title: 'Connect your AI provider first' }); return navigate('/setup'); }
    setBusy(true);
    try {
      const p = await generatePricing(ctx, project.id);
      setPlan(p);
      toast({ tone: 'success', title: 'Pricing recommendation ready' });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Pricing failed', body: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <Page wide title="Find the right price"><NoProject what="price" /></Page>;

  return (
    <Page
      wide
      title="Find the right price"
      sub="Price from the severity of the problem, the value of the outcome and the audience's real purchasing power — never from invented competitor prices."
      badge={<Tag tone="lilac"><DollarSign size={11} /> Pricing engine</Tag>}
      actions={<Button onClick={run} loading={busy}>{plan ? <RefreshCw size={14} /> : <Sparkles size={14} />} {plan ? 'Regenerate' : 'Generate pricing'}</Button>}
    >
      <ProjectHeader project={project} projects={projects} onSelect={select} />
      {plan ? (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5 items-start">
          <div className="space-y-4">
            <Card className="pad">
              <SectionTitle title="Recommended pricing" />
              <div className="grid sm:grid-cols-3 gap-3">
                <PriceCard label="Launch price" value={plan.launch_price} currency={plan.currency} tone="moss" note="First 50 buyers / launch week" />
                <PriceCard label="Standard price" value={plan.standard_price} currency={plan.currency} note="After launch" />
                <PriceCard label="Premium" value={plan.premium_price} currency={plan.currency} tone="lilac" note={plan.premium_bundle?.length ? `${plan.premium_bundle.length} extras` : 'No premium tier'} />
              </div>
              <div className="mt-5">
                <h4 className="h3 mb-2">Why this range</h4>
                <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-line">{plan.pricing_reasoning}</p>
              </div>
              <div className="mt-5">
                <h4 className="h3 mb-2">Value justification</h4>
                <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-line">{plan.value_justification}</p>
              </div>
            </Card>

            <Card className="pad">
              <SectionTitle title="Objections and how to answer them" sub="Priced-in resistance, handled on the page and in DMs." />
              <div className="space-y-3.5">
                {plan.objections.map((o) => (
                  <div key={o.objection} className="rounded-xl2 border border-line-soft p-3.5">
                    <div className="text-[13.5px] font-medium text-ink">“{o.objection}”</div>
                    <div className="text-[13px] text-ink-mute mt-1 leading-relaxed">{o.response}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="pad">
              <SectionTitle title="Price testing plan" sub="Small, fast tests that do not damage trust." />
              <ol className="space-y-2">
                {plan.price_testing_plan.map((t, i) => (
                  <li key={t} className="flex gap-3 text-[13.5px] text-ink-soft">
                    <span className="text-[11px] tnum text-ink-faint mt-1">{String(i + 1).padStart(2, '0')}</span>{t}
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="pad">
              <h3 className="h3 mb-3">Offer stack</h3>
              <ul className="space-y-2">
                {plan.offer_stack.map((s) => <li key={s} className="text-[13px] text-ink-soft">• {s}</li>)}
              </ul>
            </Card>
            <Card className="pad">
              <h3 className="h3 mb-2">Discount strategy</h3>
              <p className="text-[13px] text-ink-soft leading-relaxed">{plan.discount_strategy}</p>
            </Card>
            <Card className="pad">
              <h3 className="h3 mb-3">Next</h3>
              <div className="space-y-2">
                <Button className="w-full" variant="quiet" onClick={() => navigate(`/create/${project.id}`)}>Review the product</Button>
                <Button className="w-full" variant="quiet" onClick={() => navigate(`/ads/${project.id}`)}>Plan the ads</Button>
                <Button className="w-full" onClick={() => navigate(`/launch/${project.id}`)}>Move to launch</Button>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<DollarSign size={22} />}
          title="No pricing yet"
          body="The engine prices against problem severity, outcome value, audience economics and evidence of what this audience already pays for."
          action={<Button loading={busy} onClick={run}><Sparkles size={14} /> Generate pricing</Button>}
        />
      )}
    </Page>
  );
}

function PriceCard({ label, value, currency, tone = 'neutral', note }: { label: string; value: number | null; currency: string; tone?: 'neutral' | 'moss' | 'lilac'; note?: string }) {
  const tones = { neutral: 'border-line-soft', moss: 'border-moss-500/30 bg-moss-50/50', lilac: 'border-lilac-500/25 bg-lilac-50/60' };
  return (
    <div className={cx('rounded-xl2 border p-4', tones[tone])}>
      <div className="micro">{label}</div>
      <div className="text-[24px] font-semibold tracking-[-0.03em] mt-1.5 tnum">{value ? fmtMoney(value, currency) : '—'}</div>
      {note ? <div className="text-[11.5px] text-ink-faint mt-1">{note}</div> : null}
    </div>
  );
}

/* ------------------------------- ads ---------------------------------- */

const PLATFORMS = ['Meta (Instagram + Facebook)', 'TikTok', 'Google Search', 'YouTube'];

export function AdsPage() {
  const { settings, toast } = useStore();
  const [project, select, projects] = useActiveProject();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [busy, setBusy] = useState(false);
  const ctx = aiCtxFrom(settings);

  useEffect(() => {
    if (!project) return;
    db.campaigns.where('project_id').equals(project.id).toArray().then(setCampaigns);
  }, [project?.id]);

  const campaign = campaigns.find((c) => c.platform === platform) ?? null;

  const run = async () => {
    if (!project) return;
    if (!ctx) { toast({ tone: 'warn', title: 'Connect your AI provider first' }); return navigate('/setup'); }
    setBusy(true);
    try {
      const c = await generateAds(ctx, project.id, platform);
      setCampaigns((prev) => [...prev.filter((x) => x.platform !== platform), c as any]);
      toast({ tone: 'success', title: `${platform} concepts ready` });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Ad generation failed', body: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <Page wide title="Turn attention into sales"><NoProject what="advertise" /></Page>;

  return (
    <Page
      wide
      title="Turn attention into sales"
      sub="Concepts built from the validated problem: audience, pain angle, hook, creative, copy, CTA, landing page match and the hypothesis being tested."
      badge={<Tag tone="lilac"><Zap size={11} /> Advertising engine</Tag>}
      actions={<Button onClick={run} loading={busy}>{campaign ? <RefreshCw size={14} /> : <Sparkles size={14} />} {campaign ? 'Regenerate' : 'Generate concepts'}</Button>}
    >
      <ProjectHeader
        project={project}
        projects={projects}
        onSelect={select}
        right={<Select className="field-sm w-full sm:w-auto" value={platform} onChange={(e: any) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</Select>}
      />

      {campaign ? (
        <div className="space-y-4">
          <Card className="pad">
            <SectionTitle title={`${platform} strategy`} sub={(campaign as any).strategy_summary} />
            <div className="grid sm:grid-cols-3 gap-3">
              {campaign.budget_scenarios.map((b: any) => (
                <div key={b.level} className="rounded-xl2 border border-line-soft p-3.5">
                  <div className="micro">{b.level}</div>
                  <div className="text-[16px] font-semibold mt-1">{b.daily_budget}</div>
                  <div className="text-[12px] text-ink-mute mt-1">{b.objective}</div>
                  <div className="text-[12px] text-ink-faint mt-1.5">{b.expectation}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            {campaign.concepts.map((c: any) => (
              <Card key={c.concept_id} className="pad">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <Tag tone="lilac">{c.concept_id || 'concept'}</Tag>
                  <span className="text-[11.5px] text-ink-faint">{truncate(c.audience, 42)}</span>
                </div>
                <div className="rounded-xl2 bg-canvas border border-line-soft p-3.5 mb-3">
                  <div className="micro mb-1">Hook</div>
                  <p className="text-[14px] text-ink font-medium leading-snug">{c.hook}</p>
                </div>
                <dl className="space-y-2.5 text-[12.5px]">
                  <Row label="Pain angle" value={c.pain_angle} />
                  <Row label="Creative" value={c.creative_concept} />
                  <Row label="Landing page angle" value={c.landing_page_angle} />
                  <Row label="Testing hypothesis" value={c.testing_hypothesis} />
                </dl>
                <div className="mt-3 space-y-2">
                  <CopyBlock label="Primary text" text={c.primary_text} maxHeight={180} />
                  <CopyBlock label={`Headline · ${c.headline}\nDescription · ${c.description}\nCTA · ${c.cta}`} text={`${c.headline}\n${c.description}\n${c.cta}`} maxHeight={110} />
                </div>
              </Card>
            ))}
          </div>

          <Card className="pad">
            <SectionTitle title="Testing matrix" sub="Change one variable at a time, or you learn nothing." />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink-faint">
                    <th className="py-2 pr-4 font-medium">Variable</th>
                    <th className="py-2 pr-4 font-medium">Variant A</th>
                    <th className="py-2 pr-4 font-medium">Variant B</th>
                    <th className="py-2 font-medium">Success metric</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {campaign.testing_matrix.map((t: any) => (
                    <tr key={t.variable}>
                      <td className="py-2.5 pr-4 text-ink font-medium">{t.variable}</td>
                      <td className="py-2.5 pr-4 text-ink-mute">{t.variant_a}</td>
                      <td className="py-2.5 pr-4 text-ink-mute">{t.variant_b}</td>
                      <td className="py-2.5 text-ink-mute">{t.success_metric}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="pad">
              <h3 className="h3 mb-2">Retargeting</h3>
              <p className="text-[13px] text-ink-soft leading-relaxed whitespace-pre-line">{campaign.retargeting}</p>
            </Card>
            <Card className="pad">
              <h3 className="h3 mb-2.5">Platform cautions</h3>
              <ul className="space-y-1.5">
                {(campaign as any).compliance_notes?.map((n: string) => (
                  <li key={n} className="text-[13px] text-ink-soft flex items-start gap-2"><AlertTriangle size={13} className="mt-1 shrink-0 text-sun-600" />{n}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Zap size={22} />}
          title={`No ${platform} campaign yet`}
          body="Generates 6-10 varied concepts with full copy, a testing matrix, budget scenarios for a small budget and retargeting logic."
          action={<Button loading={busy} onClick={run}><Sparkles size={14} /> Generate concepts</Button>}
        />
      )}
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-[0.05em] text-ink-faint">{label}</dt>
      <dd className="text-ink-soft mt-0.5 leading-snug">{value || '—'}</dd>
    </div>
  );
}

/* ------------------------------ launch -------------------------------- */

export function LaunchPage() {
  const { settings, toast } = useStore();
  const [project, select, projects] = useActiveProject();
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = aiCtxFrom(settings);

  useEffect(() => {
    if (!project) return;
    db.launch.where('project_id').equals(project.id).first().then((p) => setPlan(p ?? null));
  }, [project?.id]);

  const tasks = plan?.tasks?.length ? plan.tasks : LAUNCH_TASKS.map((t) => ({ ...t, done: false }));
  const done = tasks.filter((t) => t.done).length;
  const pct = Math.round((done / tasks.length) * 100);

  const run = async () => {
    if (!project) return;
    if (!ctx) { toast({ tone: 'warn', title: 'Connect your AI provider first' }); return navigate('/setup'); }
    setBusy(true);
    try {
      const p = await generateLaunchPlan(ctx, project.id);
      setPlan(p as any);
      toast({ tone: 'success', title: 'Launch sequence ready' });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Launch planning failed', body: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <Page wide title="Launch your product"><NoProject what="launch" /></Page>;

  return (
    <Page
      wide
      title="Launch your product"
      sub="A checklist that gates the launch, plus a realistic day-by-day sequence for a solo seller with limited time."
      badge={<Tag tone={pct === 100 ? 'moss' : 'sun'}>{done}/{tasks.length} ready · {pct}%</Tag>}
      actions={<Button onClick={run} loading={busy}>{plan?.sequence?.length ? <RefreshCw size={14} /> : <Sparkles size={14} />} {plan?.sequence?.length ? 'Regenerate sequence' : 'Generate launch plan'}</Button>}
    >
      <ProjectHeader project={project} projects={projects} onSelect={select} />

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-5 items-start">
        <Card className="pad">
          <SectionTitle title="Launch readiness" sub="Nothing here is decoration — every unchecked item is a real failure point on launch day." icon={<Rocket size={17} />} />
          <div className="space-y-2">
            {tasks.map((t: any) => (
              <button
                key={t.key}
                onClick={async () => {
                  if (!project) return;
                  const next = await setLaunchTask(project.id, t.key, !t.done);
                  setPlan((prev) => ({ id: prev?.id ?? 'local', project_id: project.id, tasks: next, sequence: prev?.sequence ?? [], updated_at: new Date().toISOString() } as any));
                }}
                className={cx('w-full text-left rounded-xl2 border p-3.5 transition flex items-start gap-3', t.done ? 'border-moss-500/30 bg-moss-50/50' : 'border-line-soft hover:border-line')}
              >
                <span className={cx('mt-0.5 h-4.5 w-4.5 min-h-[18px] min-w-[18px] rounded-md border flex items-center justify-center', t.done ? 'bg-moss-500 border-moss-500 text-white' : 'border-line bg-white')}>
                  {t.done ? <Check size={12} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink">{t.label}</span>
                  <span className="block text-[12.5px] text-ink-mute mt-0.5 leading-snug">{t.detail}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          {plan?.headline ? (
            <Card className="pad">
              <div className="micro mb-1.5">Launch narrative</div>
              <p className="text-[15px] text-ink leading-relaxed">{plan.headline}</p>
            </Card>
          ) : null}

          {plan?.sequence?.length ? (
            <Card className="pad">
              <SectionTitle title="Day-by-day sequence" />
              <ol className="space-y-3.5">
                {plan.sequence.map((s: any) => (
                  <li key={s.day + s.action} className="flex gap-3">
                    <span className="text-[11px] tnum text-ink-faint mt-1 w-12 shrink-0">{s.day}</span>
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">{s.action}</span>
                      <span className="block text-[12.5px] text-ink-mute mt-0.5 leading-snug">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : (
            <EmptyState
              title="No launch sequence yet"
              body="Generates a 10-14 day plan assuming 1-2 hours a day and no email list at the start."
              action={<Button loading={busy} onClick={run}><Sparkles size={14} /> Generate sequence</Button>}
            />
          )}

          {(plan as any)?.key_risks?.length ? (
            <Card className="pad">
              <h3 className="h3 mb-2.5">Launch risks</h3>
              <ul className="space-y-1.5">
                {(plan as any).key_risks.map((r: string) => <li key={r} className="text-[13px] text-ink-soft flex items-start gap-2"><AlertTriangle size={13} className="mt-1 shrink-0 text-sun-600" />{r}</li>)}
              </ul>
            </Card>
          ) : null}

          <Card className="pad">
            <h3 className="h3 mb-3">When you are live</h3>
            <Button className="w-full" onClick={() => navigate(`/analytics/${project.id}`)}><BarChart3 size={14} /> Open performance tracking</Button>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ----------------------------- analytics ------------------------------ */

export function AnalyticsPage() {
  const { settings, toast } = useStore();
  const [project, select, projects] = useActiveProject();
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [inputs, setInputs] = useState<AnalyticsInputs>({ visitors: 0, leads: 0, sales: 0, revenue: 0, ad_spend: 0, refunds: 0, repeat_purchases: 0, price: 27, notes: '' });
  const [label, setLabel] = useState('Launch week');
  const [busy, setBusy] = useState(false);
  const [showInputs, setShowInputs] = useState(true);
  const ctx = aiCtxFrom(settings);

  useEffect(() => {
    if (!project) return;
    db.analytics.where('project_id').equals(project.id).reverse().sortBy('captured_at').then((rows) => setSnapshots(rows.reverse()));
    db.pricing.where('project_id').equals(project.id).first().then((p) => setInputs((prev) => ({ ...prev, price: p?.standard_price || prev.price })));
  }, [project?.id]);

  const metrics = computeMetrics(inputs);

  const analyse = async () => {
    if (!project) return;
    if (!ctx) { toast({ tone: 'warn', title: 'Connect your AI provider first' }); return navigate('/setup'); }
    setBusy(true);
    try {
      const snap = await analyzePerformance(ctx, project.id, inputs, label);
      setSnapshots((prev) => [...prev, snap as any]);
      toast({ tone: 'success', title: 'Analysis complete', body: (snap as any).analysis?.biggest_bottleneck ? `Bottleneck: ${(snap as any).analysis.biggest_bottleneck.replace(/_/g, ' ')}` : undefined });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Analysis failed', body: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const latest = snapshots[snapshots.length - 1];

  if (!project) return <Page wide title="Track. Learn. Scale."><NoProject what="measure" /></Page>;

  return (
    <Page
      wide
      title="Track. Learn. Scale."
      sub="Enter what actually happened. The engine reads the real numbers, names the bottleneck, and chooses fix, reposition, reprice, expand or scale."
      badge={<Tag tone="lilac"><TrendingUp size={11} /> Optimization engine</Tag>}
      actions={
        <>
          <Button variant="quiet" onClick={() => exportCSV('creatortools-analytics', snapshots.map((s) => ({ label: s.label, captured_at: s.captured_at, ...s.inputs, ...s.metrics })))}>
            <Download size={14} /> Export CSV
          </Button>
          <Button onClick={analyse} loading={busy}><Sparkles size={14} /> Analyse performance</Button>
        </>
      }
    >
      <ProjectHeader project={project} projects={projects} onSelect={select} right={<Button variant="quiet" size="sm" onClick={() => exportProjectJSON(project.id).then((d) => exportJSON('project', d))}>Export project</Button>} />

      <div className="grid lg:grid-cols-[1fr_1.25fr] gap-5 items-start">
        <div className="space-y-4">
          <Card className="pad">
            <SectionTitle
              title="Performance input"
              sub="Use real numbers from your checkout and ad platforms. Small samples are flagged, not hidden."
              action={<Button variant="ghost" size="sm" onClick={() => setShowInputs((v) => !v)}>{showInputs ? 'Hide' : 'Edit'}</Button>}
            />
            {showInputs ? (
              <div className="space-y-4">
                <Field label="Snapshot label"><Input value={label} onChange={(e: any) => setLabel(e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3.5">
                  {([
                    ['visitors', 'Visitors'],
                    ['leads', 'Leads'],
                    ['sales', 'Sales'],
                    ['refunds', 'Refunds'],
                    ['repeat_purchases', 'Repeat purchases'],
                  ] as const).map(([key, labelText]) => (
                    <Field key={key} label={labelText}>
                      <Input type="number" min={0} value={(inputs as any)[key]} onChange={(e: any) => setInputs({ ...inputs, [key]: Number(e.target.value) })} />
                    </Field>
                  ))}
                  <Field label="Price"><Input type="number" min={0} step="0.01" value={inputs.price} onChange={(e: any) => setInputs({ ...inputs, price: Number(e.target.value) })} /></Field>
                  <Field label="Revenue"><Input type="number" min={0} step="0.01" value={inputs.revenue} onChange={(e: any) => setInputs({ ...inputs, revenue: Number(e.target.value) })} /></Field>
                  <Field label="Ad spend"><Input type="number" min={0} step="0.01" value={inputs.ad_spend} onChange={(e: any) => setInputs({ ...inputs, ad_spend: Number(e.target.value) })} /></Field>
                </div>
                <Field label="Notes" hint="What changed this period? A new hook, a price test, a different audience.">
                  <Textarea rows={3} value={inputs.notes} onChange={(e: any) => setInputs({ ...inputs, notes: e.target.value })} />
                </Field>
              </div>
            ) : (
              <KeyValue rows={[
                { label: 'Visitors', value: fmtNumber(inputs.visitors) },
                { label: 'Leads', value: fmtNumber(inputs.leads) },
                { label: 'Sales', value: fmtNumber(inputs.sales) },
                { label: 'Revenue', value: fmtMoney(inputs.revenue, project.currency) },
              ]} />
            )}
            {metrics.sample_warning ? (
              <div className="mt-4"><Callout tone="warn" title="Small sample">{metrics.sample_warning}</Callout></div>
            ) : null}
          </Card>

          <Card className="pad">
            <SectionTitle title="Computed metrics" sub="Calculated by the app, from your inputs only." />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                ['Conversion rate', metrics.conversion_rate === null ? '—' : `${metrics.conversion_rate}%`],
                ['Lead rate', metrics.lead_rate === null ? '—' : `${metrics.lead_rate}%`],
                ['Cost per lead', metrics.cost_per_lead === null ? '—' : fmtMoney(metrics.cost_per_lead, project.currency)],
                ['CAC', metrics.cac === null ? '—' : fmtMoney(metrics.cac, project.currency)],
                ['AOV', metrics.aov === null ? '—' : fmtMoney(metrics.aov, project.currency)],
                ['ROAS', metrics.roas === null ? '—' : `${metrics.roas}×`],
                ['Refund rate', metrics.refund_rate === null ? '—' : `${metrics.refund_rate}%`],
                ['Repeat rate', metrics.repeat_rate === null ? '—' : `${metrics.repeat_rate}%`],
                ['Gross profit', metrics.gross_profit === null ? '—' : fmtMoney(metrics.gross_profit, project.currency)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl2 border border-line-soft px-3.5 py-3">
                  <div className="text-[10.5px] uppercase tracking-[0.05em] text-ink-faint">{k}</div>
                  <div className="text-[17px] font-semibold tnum mt-1">{v}</div>
                </div>
              ))}
            </div>
            {metrics.cac_vs_breakeven !== null ? (
              <div className="mt-4 text-[12.5px] text-ink-mute">
                CAC is <strong className="text-ink">{metrics.cac_vs_breakeven}%</strong> of the break-even point
                ({fmtMoney(metrics.breakeven_cac, project.currency)}). {metrics.cac_vs_breakeven > 100 ? 'Paid acquisition is currently loss-making.' : 'Paid acquisition is currently viable per sale.'}
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          {latest?.analysis ? (
            <>
              <Card className="pad">
                <SectionTitle title="Read of the numbers" sub={`Snapshot: ${latest.label} · ${relTime(latest.captured_at)}`} icon={<BarChart3 size={17} />} />
                <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-line">{latest.analysis.read_of_the_numbers}</p>
                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  <div className="rounded-xl2 bg-canvas border border-line-soft p-4">
                    <div className="micro mb-1">Biggest bottleneck</div>
                    <div className="text-[15px] font-semibold">{String(latest.analysis.biggest_bottleneck).replace(/_/g, ' ')}</div>
                    <p className="text-[12.5px] text-ink-mute mt-1.5 leading-snug">{latest.analysis.bottleneck_reasoning}</p>
                  </div>
                  <div className="rounded-xl2 bg-canvas border border-line-soft p-4">
                    <div className="micro mb-1">Recommended direction</div>
                    <div className="text-[15px] font-semibold">{String(latest.analysis.scale_or_fix).replace(/_/g, ' ')}</div>
                    <p className="text-[12.5px] text-ink-mute mt-1.5 leading-snug">{latest.analysis.scale_reasoning}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl2 bg-ink text-white p-4">
                  <div className="text-[10.5px] uppercase tracking-[0.06em] opacity-70 mb-1">Next highest-leverage action</div>
                  <p className="text-[14.5px] leading-relaxed">{latest.analysis.next_action}</p>
                </div>
              </Card>

              <Card className="pad">
                <SectionTitle title="Prioritised actions" />
                <div className="space-y-3">
                  {latest.analysis.prioritized_actions?.map((a: any, i: number) => (
                    <div key={a.action} className="flex gap-3">
                      <span className="text-[11px] tnum text-ink-faint mt-1 w-5">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <div className="text-[13.5px] font-medium text-ink">{a.action}</div>
                        <div className="text-[12.5px] text-ink-mute mt-0.5">Expected: {a.expected_effect} · Effort: {a.effort} · Measure: {a.measure}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="pad">
                <SectionTitle title="Experiments" sub="Sequenced tests, each with a hypothesis and a metric." />
                <div className="space-y-3">
                  {latest.analysis.experiments?.map((e: any) => (
                    <div key={e.experiment} className="rounded-xl2 border border-line-soft p-3.5">
                      <div className="text-[13.5px] font-medium text-ink">{e.experiment}</div>
                      <div className="text-[12.5px] text-ink-mute mt-1">Hypothesis: {e.hypothesis}</div>
                      <div className="text-[12px] text-ink-faint mt-1">Success: {e.success_metric} · Duration: {e.duration}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <EmptyState
              icon={<Target size={22} />}
              title="No analysis yet"
              body="Enter real performance numbers, then analyse. With nothing real to read, the engine will say so instead of inventing advice."
              action={<Button loading={busy} onClick={analyse}><Sparkles size={14} /> Analyse performance</Button>}
            />
          )}

          {snapshots.length > 1 ? (
            <Card className="pad">
              <SectionTitle title="History" />
              <div className="space-y-2">
                {[...snapshots].reverse().map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 text-[12.5px] border-b border-line-soft last:border-0 pb-2 last:pb-0">
                    <span className="text-ink">{s.label}</span>
                    <span className="text-ink-faint">{relTime(s.captured_at)}</span>
                    <span className="text-ink-mute tnum">{fmtNumber(s.inputs.visitors)} visitors · {fmtNumber(s.inputs.sales)} sales</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
