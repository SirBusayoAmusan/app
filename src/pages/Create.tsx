import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, Download, FileText, Hammer, Info, ListPlus, Pencil, RefreshCw, Sparkles, Wand2, X,
} from 'lucide-react';
import { Page, navigate, useRoute } from '../components/shell';
import {
  Button, Callout, Card, CopyBlock, EmptyState, Field, Input, KeyValue, Modal, SectionTitle, Tabs, Tag, Textarea, cx,
} from '../components/ui';
import { db } from '../core/db/database';
import {
  createProjectFromOpportunity, ensureGuide, generateChapter, generateProductStrategy, generateSalesPage, opportunityContext, saveGuide,
} from '../core/product/engines';
import { exportProductPDF, exportSalesPagePDF } from '../core/product/pdf';
import { useStore } from '../store';
import type { Guide, Product, Project, ProductStrategy } from '../core/types';
import { truncate } from '../core/lib/utils';

export default function Create() {
  const route = useRoute();
  const { settings, toast, reload } = useStore();
  const param = route.parts[1];
  const [project, setProject] = useState<Project | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [strategy, setStrategy] = useState<ProductStrategy | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [tab, setTab] = useState('strategy');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<typeof opportunityContext>> | null>(null);
  const [salesPage, setSalesPage] = useState<any>(null);

  const ensureProject = async () => {
    if (param && param !== 'new') return param;
    const problemId = route.query.get('problem');
    if (!problemId) return null;
    const problem = await db.problems.get(problemId);
    if (!problem) return null;
    const created = await createProjectFromOpportunity(problem.niche_id, problem.id);
    navigate(`/create/${created.id}`, { replace: true });
    return created.id;
  };

  const load = async (projectId: string) => {
    const p = await db.projects.get(projectId);
    if (!p) return;
    setProject(p);
    const prod = await db.products.where('project_id').equals(projectId).first();
    setProduct(prod ?? null);
    setStrategy(prod?.strategy ?? null);
    setGuide(prod?.guide ?? null);
    setContext(await opportunityContext(projectId));
    const sp = await db.marketing.where('project_id').equals(projectId).filter((m) => m.module_key === 'sales_page').first();
    setSalesPage(sp?.payload ?? null);
  };

  useEffect(() => {
    (async () => {
      const id = await ensureProject();
      if (id) await load(id);
    })();
  }, [param, route.query.toString()]);

  const aiCtx = useMemo(() => (settings?.ai ? { config: settings.ai, onUsage: () => {} } : null), [settings?.ai]);

  const requireAI = () => {
    if (!aiCtx) {
      toast({ tone: 'warn', title: 'Connect your AI provider first' });
      navigate('/setup');
      return false;
    }
    return true;
  };

  const runStrategy = async () => {
    if (!project || !requireAI()) return;
    setBusy('strategy');
    try {
      const s = await generateProductStrategy(aiCtx!, project.id);
      setStrategy(s);
      const prod = await db.products.where('project_id').equals(project.id).first();
      setProduct(prod ?? null);
      toast({ tone: 'success', title: 'Product strategy ready', body: `${s.recommended_format} — ${s.product_name_options.length} name options.` });
      await reload();
    } catch (e: any) {
      toast({ tone: 'error', title: 'Strategy generation failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const buildOutline = async () => {
    if (!project) return;
    setBusy('outline');
    try {
      const g = await ensureGuide(project.id);
      setGuide(g);
      setTab('guide');
      toast({ tone: 'success', title: `${g.chapters.length} chapters outlined` });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Could not build the outline', body: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const writeChapter = async (index: number) => {
    if (!project || !requireAI()) return;
    setBusy(`ch-${index}`);
    try {
      await generateChapter(aiCtx!, project.id, index);
      const prod = await db.products.where('project_id').equals(project.id).first();
      setGuide(prod?.guide ?? null);
      toast({ tone: 'success', title: `Chapter ${index + 1} written` });
    } catch (e: any) {
      toast({ tone: 'error', title: `Chapter ${index + 1} failed`, body: e?.message });
      const prod = await db.products.where('project_id').equals(project.id).first();
      setGuide(prod?.guide ?? null);
    } finally {
      setBusy(null);
    }
  };

  const writeAll = async () => {
    if (!project || !guide || !requireAI()) return;
    setBusy('all');
    try {
      for (let i = 0; i < guide.chapters.length; i++) {
        if (guide.chapters[i].status === 'ready') continue;
        await writeChapterSilent(i);
      }
      toast({ tone: 'success', title: 'Guide drafted', body: 'Review each chapter, then export the PDF.' });
    } finally {
      setBusy(null);
    }
  };

  const writeChapterSilent = async (index: number) => {
    await generateChapter(aiCtx!, project!.id, index);
    const prod = await db.products.where('project_id').equals(project!.id).first();
    setGuide(prod?.guide ?? null);
  };

  const persistGuide = async (next: Guide) => {
    setGuide(next);
    if (project) await saveGuide(project.id, next);
  };

  const doExport = () => {
    if (!product) return;
    const name = exportProductPDF({ ...product, strategy, guide }, { author: context?.audience?.name ?? '' });
    toast({ tone: 'success', title: 'PDF exported', body: name });
  };

  if (!project || !context) {
    return (
      <Page title="Product workspace">
        <Card className="pad"><div className="skeleton h-6 w-1/2 mb-3" /><div className="skeleton h-4 w-1/3" /></Card>
      </Page>
    );
  }

  const readyChapters = guide?.chapters.filter((c) => c.status === 'ready').length ?? 0;
  const words = guide?.chapters.reduce((n, c) => n + (c.body?.split(/\s+/).length ?? 0), 0) ?? 0;

  return (
    <Page
      wide
      title={strategy?.selected_name || product?.name || truncate(context.niche.specific_niche, 60) || 'Product workspace'}
      sub="Turn the validated problem into the smallest product that solves it — then write it, export it and sell it."
      badge={
        <>
          <Tag tone="lilac">{strategy?.recommended_format ?? 'format pending'}</Tag>
          {guide ? <Tag tone="neutral">{readyChapters}/{guide.chapters.length} chapters · ~{words.toLocaleString()} words</Tag> : null}
        </>
      }
      actions={
        <>
          <Button variant="quiet" onClick={() => navigate(`/problem/${project.problem_id}`)}><ArrowLeft size={14} /> Problem</Button>
          <Button variant="quiet" onClick={() => navigate(`/marketing/${project.id}`)}>Marketing engine</Button>
          <Button onClick={doExport} disabled={!product}><Download size={14} /> Export PDF</Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1.55fr_1fr] gap-5 items-start">
        {/* min-w-0: a grid item defaults to min-width:auto, so the tab strip's
            min-content width would otherwise force this column wider than the
            phone screen and push the last tabs out of reach. */}
        <div className="space-y-5 min-w-0">
          <div>
            <Tabs
              tabs={[
                { key: 'strategy', label: 'Product strategy' },
                { key: 'guide', label: 'Guide builder', badge: guide?.chapters.length },
                { key: 'sales', label: 'Sales page' },
              ]}
              active={tab}
              onChange={setTab}
            />
            <div className="pt-5">
              {/* ------------------------- strategy ------------------------ */}
              {tab === 'strategy' ? (
                strategy ? (
                  <div className="space-y-4">
                    <Card className="pad">
                      <SectionTitle
                        title={strategy.recommended_format}
                        sub={strategy.format_reasoning}
                        icon={<Wand2 size={17} />}
                        action={<Button variant="quiet" size="sm" loading={busy === 'strategy'} onClick={runStrategy}><RefreshCw size={13} /> Regenerate</Button>}
                      />
                      <div className="rounded-xl2 bg-canvas border border-line-soft p-4">
                        <div className="micro mb-1.5">Promise</div>
                        <p className="text-[14.5px] text-ink leading-relaxed">{strategy.product_promise}</p>
                      </div>
                      {strategy.transformation ? (
                        <div className="grid sm:grid-cols-2 gap-3 mt-4">
                          <div className="rounded-xl2 border border-line-soft p-3.5">
                            <div className="micro mb-1">From</div>
                            <p className="text-[13px] text-ink-soft">{strategy.transformation.from}</p>
                          </div>
                          <div className="rounded-xl2 border border-line-soft p-3.5 bg-moss-50/60">
                            <div className="micro mb-1">To</div>
                            <p className="text-[13px] text-ink-soft">{strategy.transformation.to}</p>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-5">
                        <div className="micro mb-2">Name options — pick the one you will sell</div>
                        <div className="space-y-2">
                          {strategy.product_name_options.map((n) => {
                            const on = (strategy.selected_name ?? product?.name) === n;
                            return (
                              <button
                                key={n}
                                onClick={async () => {
                                  if (!product) return;
                                  const next = { ...strategy, selected_name: n };
                                  setStrategy(next);
                                  await db.products.update(product.id, { name: n, strategy: next, updated_at: new Date().toISOString() });
                                  setProduct({ ...product, name: n, strategy: next });
                                }}
                                className={cx('w-full text-left rounded-xl2 border px-3.5 py-3 text-[14px] transition', on ? 'border-ink bg-white shadow-card' : 'border-line-soft hover:border-line')}
                              >
                                <span className="flex items-center justify-between gap-3">
                                  {n}
                                  {on ? <Check size={15} /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </Card>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <Card className="pad">
                        <SectionTitle title="What is inside" sub={`${strategy.contents.length} sections`} icon={<ListPlus size={16} />} />
                        <ol className="space-y-3">
                          {strategy.contents.map((c, i) => (
                            <li key={c.title} className="flex gap-3">
                              <span className="text-[11px] tnum text-ink-faint mt-1">{String(i + 1).padStart(2, '0')}</span>
                              <span>
                                <span className="block text-[13.5px] font-medium text-ink">{c.title}</span>
                                <span className="block text-[12.5px] text-ink-mute">{c.purpose}</span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </Card>
                      <div className="space-y-4">
                        <Card className="pad">
                          <h3 className="h3 mb-2.5">Worksheets</h3>
                          <ul className="space-y-2">
                            {strategy.worksheets.map((w) => (
                              <li key={w.title} className="text-[13px] text-ink-soft"><strong className="text-ink font-medium">{w.title}</strong> — {w.purpose}</li>
                            ))}
                          </ul>
                        </Card>
                        <Card className="pad">
                          <h3 className="h3 mb-2.5">Checklists & bonuses</h3>
                          <ul className="space-y-2">
                            {strategy.checklists.map((c) => (
                              <li key={c.title} className="text-[13px] text-ink-soft"><strong className="text-ink font-medium">{c.title}</strong> · {c.items.length} items</li>
                            ))}
                            {strategy.bonuses.map((b) => <li key={b} className="text-[13px] text-ink-soft">Bonus — {b}</li>)}
                          </ul>
                        </Card>
                      </div>
                    </div>

                    <Card className="pad">
                      <SectionTitle title="Positioning" icon={<Info size={16} />} />
                      <p className="text-[13.5px] text-ink-soft leading-relaxed">{strategy.positioning}</p>
                    </Card>

                    <div className="flex flex-wrap gap-3">
                      <Button size="lg" onClick={buildOutline} loading={busy === 'outline'}><Hammer size={15} /> Build the guide outline</Button>
                      <Button size="lg" variant="quiet" onClick={() => setTab('guide')}>Go to guide builder</Button>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Sparkles size={22} />}
                    title="No product strategy yet"
                    body="CreatorTools recommends the smallest format that solves the validated problem, then structures it into sections, worksheets, checklists and bonuses."
                    action={<Button onClick={runStrategy} loading={busy === 'strategy'}><Sparkles size={14} /> Generate product strategy</Button>}
                  />
                )
              ) : null}

              {/* --------------------------- guide -------------------------- */}
              {tab === 'guide' ? (
                guide ? (
                  <div className="space-y-4">
                    <Card className="pad">
                      <SectionTitle
                        title="Guide builder"
                        sub="Write chapter by chapter. Each chapter is a separate model call so you can review, regenerate or edit before continuing."
                        icon={<FileText size={17} />}
                        action={
                          <Button size="sm" loading={busy === 'all'} onClick={writeAll}>
                            <Sparkles size={13} /> Write remaining chapters
                          </Button>
                        }
                      />
                      <div className="space-y-3">
                        {guide.chapters.map((c, i) => (
                          <div key={c.id} className="rounded-xl2 border border-line p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[11px] tnum text-ink-faint">CH {String(i + 1).padStart(2, '0')}</span>
                                  <Tag tone={c.status === 'ready' ? 'moss' : c.status === 'generating' ? 'lilac' : c.status === 'error' ? 'rose' : 'neutral'}>
                                    {c.status === 'ready' ? `${(c.body?.split(/\s+/).length ?? 0).toLocaleString()} words` : c.status}
                                  </Tag>
                                </div>
                                <div className="text-[14px] font-medium text-ink leading-snug">{c.title}</div>
                                <div className="text-[12.5px] text-ink-mute mt-0.5">{c.purpose}</div>
                                {c.error ? <div className="text-[12px] text-rose-600 mt-1">{c.error}</div> : null}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {c.status === 'ready' ? (
                                  <>
                                    <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setDraft(c.body); }}><Pencil size={13} /> Edit</Button>
                                    <Button size="sm" variant="quiet" loading={busy === `ch-${i}`} onClick={() => writeChapter(i)}><RefreshCw size={13} /> Regenerate</Button>
                                  </>
                                ) : (
                                  <Button size="sm" loading={busy === `ch-${i}`} onClick={() => writeChapter(i)}><Sparkles size={13} /> Write</Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>

                    <Card className="pad">
                      <SectionTitle title="Front matter & extras" sub="These print on the cover, worksheets and closing pages of the PDF." />
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="Deliverable title">
                          <Input value={guide.title} onChange={(e: any) => persistGuide({ ...guide, title: e.target.value })} />
                        </Field>
                        <Field label="Subtitle"><Input value={guide.subtitle} onChange={(e: any) => persistGuide({ ...guide, subtitle: e.target.value })} /></Field>
                        <Field label="Who it is for"><Input value={guide.audience} onChange={(e: any) => persistGuide({ ...guide, audience: e.target.value })} /></Field>
                        <Field label="Promise"><Input value={guide.promise} onChange={(e: any) => persistGuide({ ...guide, promise: e.target.value })} /></Field>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Button onClick={doExport}><Download size={14} /> Export polished PDF</Button>
                        <Button variant="quiet" onClick={() => navigate(`/pricing/${project.id}`)}>Next: price it</Button>
                      </div>
                    </Card>
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileText size={22} />}
                    title="Outline not built yet"
                    body="The outline uses the sections from your product strategy. You can rename, reorder or drop chapters before writing."
                    action={<Button onClick={buildOutline} loading={busy === 'outline'}><ListPlus size={14} /> Build outline from strategy</Button>}
                  />
                )
              ) : null}

              {/* ------------------------- sales page ----------------------- */}
              {tab === 'sales' ? (
                salesPage ? (
                  <div className="space-y-4">
                    <Card className="pad">
                      <SectionTitle
                        title="Sales page"
                        icon={<FileText size={17} />}
                        action={
                          <>
                            <Button size="sm" variant="quiet" onClick={() => exportSalesPagePDF(product?.name ?? 'product', salesPage)}><Download size={13} /> PDF proof</Button>
                            <Button size="sm" loading={busy === 'sales'} onClick={doSalesPage}><RefreshCw size={13} /> Regenerate</Button>
                          </>
                        }
                      />
                      <h2 className="text-[21px] font-semibold tracking-[-0.02em] leading-snug">{salesPage.hero_headline}</h2>
                      <p className="sub mt-2">{salesPage.hero_subheadline}</p>
                      <div className="mt-5 space-y-5">
                        <SalesSection title="The problem" body={salesPage.problem_section} />
                        <SalesSection title="The solution" body={salesPage.solution_section} />
                        {salesPage.whats_inside?.length ? (
                          <div>
                            <h4 className="h3 mb-2">What's inside</h4>
                            <ul className="space-y-1.5">{salesPage.whats_inside.map((i: string) => <li key={i} className="text-[13.5px] text-ink-soft">• {i}</li>)}</ul>
                          </div>
                        ) : null}
                        <SalesSection title="Proof" body={salesPage.proof_section} />
                        <SalesSection title="The offer" body={salesPage.offer_section} />
                        {salesPage.faq?.length ? (
                          <div>
                            <h4 className="h3 mb-2">FAQ</h4>
                            <div className="space-y-3">
                              {salesPage.faq.map((f: any) => (
                                <div key={f.q}>
                                  <div className="text-[13.5px] font-medium text-ink">{f.q}</div>
                                  <div className="text-[13px] text-ink-mute mt-0.5">{f.a}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="rounded-xl2 bg-ink text-white p-4 text-center text-[15px] font-medium">{salesPage.final_cta}</div>
                      </div>
                    </Card>
                    <CopyBlock label="Sales page as markdown" text={salesPageToMarkdown(salesPage)} />
                  </div>
                ) : (
                  <EmptyState
                    icon={<FileText size={22} />}
                    title="No sales page yet"
                    body="Generates a complete direct-response page from the validated problem, product contents and price. No invented testimonials or sales numbers."
                    action={<Button loading={busy === 'sales'} onClick={doSalesPage}><Sparkles size={14} /> Write the sales page</Button>}
                  />
                )
              ) : null}
            </div>
          </div>
        </div>

        {/* --------------------------- sidebar --------------------------- */}
        <div className="space-y-5">
          <Card className="pad">
            <h3 className="h3 mb-3">The validated opportunity</h3>
            <KeyValue
              cols={1}
              rows={[
                { label: 'Audience', value: context.niche.target_audience },
                { label: 'Problem', value: context.problem.problem_statement },
                { label: 'Desired outcome', value: context.niche.desired_outcome },
                { label: 'Recommended product', value: context.problem.recommended_product },
                { label: 'Score', value: context.score ? `${context.score.final_score.toFixed(1)} · ${context.score.evidence_confidence.toFixed(0)}% confidence` : '—' },
              ]}
            />
            <button className="linkbtn no-underline text-[12.5px] text-ink-mute hover:text-ink mt-3" onClick={() => navigate(`/problem/${project.problem_id}`)}>
              Open full intelligence →
            </button>
          </Card>

          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><Info size={15} /> <h3 className="h3">Smallest viable product</h3></div>
            <p className="text-[12.5px] text-ink-mute leading-relaxed">
              We deliberately recommend the smallest thing that genuinely solves the problem — no membership, cohort or
              software as a first product. Depth beats volume: fewer chapters that fully solve one painful problem convert better.
            </p>
            <div className="mt-3 text-[12px] text-ink-faint">Engine v1.0.0 · prompts {settings?.ai ? 'p1.0.0' : '—'}</div>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-3">After the PDF</h3>
            <div className="space-y-2">
              {[
                [`/pricing/${project.id}`, 'Price it'],
                [`/marketing/${project.id}`, 'Build the marketing machine'],
                [`/ads/${project.id}`, 'Create paid campaigns'],
                [`/launch/${project.id}`, 'Run the launch'],
                [`/analytics/${project.id}`, 'Track, learn, scale'],
              ].map(([path, label]) => (
                <Button key={path} variant="quiet" className="w-full justify-start" onClick={() => navigate(path)}>{label}</Button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* -------------------------- chapter editor -------------------------- */}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={guide?.chapters[editing ?? 0]?.title ?? 'Edit chapter'}
        sub="Markdown supported. Your edits are kept exactly as written into the PDF."
        wide
        footer={
          <>
            <Button variant="quiet" onClick={() => setEditing(null)}><X size={14} /> Cancel</Button>
            <Button
              onClick={async () => {
                if (editing === null || !guide) return;
                const chapters = [...guide.chapters];
                chapters[editing] = { ...chapters[editing], body: draft };
                await persistGuide({ ...guide, chapters });
                setEditing(null);
                toast({ tone: 'success', title: 'Chapter saved' });
              }}
            >
              <Check size={14} /> Save chapter
            </Button>
          </>
        }
      >
        <Textarea rows={18} value={draft} onChange={(e: any) => setDraft(e.target.value)} className="font-mono text-[12.5px]" />
      </Modal>
    </Page>
  );

  async function doSalesPage() {
    if (!project || !requireAI()) return;
    setBusy('sales');
    try {
      const page = await generateSalesPage(aiCtx!, project.id);
      setSalesPage(page);
      toast({ tone: 'success', title: 'Sales page ready' });
    } catch (e: any) {
      toast({ tone: 'error', title: 'Sales page failed', body: e?.message });
    } finally {
      setBusy(null);
    }
  }
}

function SalesSection({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="h3 mb-2">{title}</h4>
      <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  );
}

function salesPageToMarkdown(p: any) {
  return [
    `# ${p.hero_headline}`,
    p.hero_subheadline ? `_${p.hero_subheadline}_` : '',
    p.problem_section ? `\n## The problem\n${p.problem_section}` : '',
    p.solution_section ? `\n## The solution\n${p.solution_section}` : '',
    p.whats_inside?.length ? `\n## What's inside\n${p.whats_inside.map((i: string) => `- ${i}`).join('\n')}` : '',
    p.proof_section ? `\n## Proof\n${p.proof_section}` : '',
    p.offer_section ? `\n## The offer\n${p.offer_section}` : '',
    p.faq?.length ? `\n## FAQ\n${p.faq.map((f: any) => `**${f.q}**\n${f.a}`).join('\n\n')}` : '',
    p.final_cta ? `\n## ${p.final_cta}` : '',
  ].filter(Boolean).join('\n');
}
