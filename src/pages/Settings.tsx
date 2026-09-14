import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Database, Download, Info, KeyRound, Layers, RefreshCw, ShieldCheck, Sparkles, Trash2, Upload, Wand2, XCircle,
} from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, CopyBlock, Field, Input, Modal, SectionTitle, Select, Tabs, Tag, Toggle, cx } from '../components/ui';
import { db, DEFAULT_METHODOLOGY, ENGINE_VERSION, PROMPT_VERSION, SCORING_VERSION, importAll, updateSettings, wipeEverything } from '../core/db/database';
import { PRESETS, listModels, testConnection, normalizeBaseUrl } from '../core/ai/providers';
import { SEARCH_PROVIDERS, testSearchProvider } from '../core/intelligence/searchProviders';
import { clearCredentials, getCredential, sessionState, setCredential } from '../core/ai/session';
import { COMPONENT_LABELS, CONFIDENCE_WEIGHTS, COMPONENT_ORDER, WEIGHTS } from '../core/intelligence/scoringEngine';
import { QUERY_LAYERS } from '../core/intelligence/queryEngine';
import { PROMPT_CATALOGUE } from '../core/prompts';
import { exportWorkspace } from '../core/export/exporters';
import { useStore } from '../store';
import { maskKey, safeJsonParse } from '../core/lib/utils';
import type { AIProviderConfig, Methodology, SearchProviderConfig } from '../core/types';

export default function Settings() {
  const { settings, reload, toast, bumpSession } = useStore();
  const [tab, setTab] = useState('connection');
  const [ai, setAi] = useState<AIProviderConfig | null>(settings?.ai ?? null);
  const [aiKey, setAiKey] = useState(getCredential('ai') ?? '');
  const [search, setSearch] = useState<SearchProviderConfig | null>(settings?.search ?? null);
  const [searchKey, setSearchKey] = useState(getCredential('tavily') ?? getCredential('serper') ?? getCredential('exa') ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [methodology, setMethodology] = useState<Methodology>(settings?.methodology ?? DEFAULT_METHODOLOGY);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => { if (settings?.ai) setAi(settings.ai); }, [settings?.ai]);
  useEffect(() => { if (settings?.search) setSearch(settings.search); }, [settings?.search]);
  useEffect(() => { if (settings?.methodology) setMethodology(settings.methodology); }, [settings?.methodology]);

  const capability = sessionState.capability;

  const counts = async () => ({
    runs: await db.research_runs.count(),
    evidence: await db.evidence.count(),
    niches: await db.niches.count(),
    problems: await db.problems.count(),
    projects: await db.projects.count(),
    products: await db.products.count(),
  });
  const [stats, setStats] = useState<Record<string, number>>({});
  useEffect(() => { void counts().then(setStats); }, [tab]);

  const saveConnection = async () => {
    if (!ai) return;
    if (aiKey) setCredential('ai', aiKey);
    if (search && search.id !== 'none' && searchKey) setCredential(search.id as any, searchKey);
    await updateSettings({ ai: { ...ai, base_url: normalizeBaseUrl(ai) }, search, methodology });
    await reload();
    bumpSession();
    toast({ tone: 'success', title: 'Settings saved', body: 'Session keys updated in memory only.' });
  };

  return (
    <Page
      title="Settings"
      sub="Provider connections, methodology thresholds, data ownership and the exact prompts and formulas running in this app."
      badge={<Tag tone="moss"><ShieldCheck size={11} /> local-first</Tag>}
      actions={<Button onClick={saveConnection}><RefreshCw size={14} /> Save changes</Button>}
    >
      <Tabs
        tabs={[
          { key: 'connection', label: 'Connection' },
          { key: 'methodology', label: 'Methodology' },
          { key: 'engine', label: 'Scoring engine' },
          { key: 'prompts', label: 'Prompts' },
          { key: 'data', label: 'Data' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="pt-5">
        {tab === 'connection' ? (
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5 items-start">
            <div className="space-y-4">
              <Card className="pad">
                <SectionTitle
                  title="AI provider"
                  sub="Change, test or remove your provider. Keys are session-only — removing them here clears the current session."
                  icon={<KeyRound size={16} />}
                  action={capability ? <Tag tone="moss">{capability.structured_mode}</Tag> : undefined}
                />
                {ai ? (
                  <div className="space-y-4">
                    <Field label="Provider">
                      <Select value={ai.provider} onChange={(e: any) => { const p = PRESETS[e.target.value as keyof typeof PRESETS]; setAi({ ...ai, provider: p.id, base_url: p.base_url || ai.base_url, model: p.suggested_models[0] ?? ai.model, structured_mode: null }); }}>
                        {Object.values(PRESETS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </Select>
                    </Field>
                    {ai.provider === 'custom' ? (
                      <Field label="Base URL"><Input value={ai.base_url} onChange={(e: any) => setAi({ ...ai, base_url: e.target.value })} /></Field>
                    ) : null}
                    <Field label="API key" hint={aiKey ? `Session: ${maskKey(aiKey)}` : 'No key in memory for this session.'}>
                      <Input type="password" autoComplete="off" className="font-mono text-[13px]" value={aiKey} onChange={(e: any) => { setAiKey(e.target.value); setCredential('ai', e.target.value); }} placeholder="paste to set for this session" />
                    </Field>
                    <Field label="Model">
                      <div className="flex gap-2">
                        <Input list="settings-models" className="font-mono text-[13px]" value={ai.model} onChange={(e: any) => setAi({ ...ai, model: e.target.value })} />
                        <datalist id="settings-models">{(models.length ? models : PRESETS[ai.provider].suggested_models).map((m) => <option key={m} value={m} />)}</datalist>
                        <Button variant="quiet" className="shrink-0" loading={busy === 'models'} onClick={async () => {
                          setBusy('models');
                          try { setModels(await listModels(ai, aiKey)); toast({ tone: 'success', title: 'Model list loaded' }); }
                          catch (e: any) { toast({ tone: 'error', title: 'Could not load models', body: e?.message }); }
                          finally { setBusy(null); }
                        }}>Load</Button>
                      </div>
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="quiet" loading={busy === 'test'} onClick={async () => {
                        setBusy('test');
                        try {
                          const r = await testConnection(ai, aiKey);
                          toast({ tone: r.ok ? 'success' : 'error', title: r.ok ? 'Connection OK' : 'Connection failed', body: r.ok ? `${r.model} · ${r.latency_ms}ms · ${r.structured_mode}` : r.error?.message });
                          bumpSession();
                        } finally { setBusy(null); }
                      }}>Test connection</Button>
                      <Button variant="ghost" onClick={() => { setAiKey(''); setCredential('ai', null); bumpSession(); toast({ tone: 'info', title: 'AI key cleared from this session' }); }}>
                        <XCircle size={14} /> Remove key
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Callout tone="warn" title="No provider configured">
                    <button className="linkbtn" onClick={() => navigate('/setup')}>Run the setup flow →</button>
                  </Callout>
                )}
              </Card>

              <Card className="pad">
                <SectionTitle title="Live market evidence provider" sub="Without this, discovery cannot make current-market claims." icon={<Database size={16} />} />
                <div className="space-y-4">
                  <Field label="Provider">
                    <Select value={search?.id ?? 'none'} onChange={(e: any) => setSearch({ id: e.target.value, enabled: e.target.value !== 'none', proxy: search?.proxy ?? '' })}>
                      {SEARCH_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                  </Field>
                  {search && search.id !== 'none' ? (
                    <>
                      <Field label="API key" hint={searchKey ? `Session: ${maskKey(searchKey)}` : 'No key in memory for this session.'}>
                        <Input type="password" autoComplete="off" className="font-mono text-[13px]" value={searchKey} onChange={(e: any) => { setSearchKey(e.target.value); setCredential(search.id as any, e.target.value); }} />
                      </Field>
                      <Field label="Optional CORS proxy"><Input value={search.proxy ?? ''} onChange={(e: any) => setSearch({ ...search, proxy: e.target.value })} placeholder="https://proxy.example.com/?url={url}" /></Field>
                      <div className="flex gap-2">
                        <Button variant="quiet" loading={busy === 'search'} onClick={async () => {
                          setBusy('search');
                          try {
                            const r = await testSearchProvider(search);
                            toast({ tone: r.ok ? 'success' : 'error', title: r.ok ? `Search OK · ${r.ms}ms` : 'Search failed', body: r.ok ? `${r.sample.length} sample results returned` : r.error });
                          } finally { setBusy(null); }
                        }}>Test search</Button>
                        <Button variant="ghost" onClick={() => { setSearchKey(''); ['tavily', 'serper', 'exa'].forEach((k) => setCredential(k as any, null)); bumpSession(); toast({ tone: 'info', title: 'Search key cleared from this session' }); }}>
                          <XCircle size={14} /> Remove key
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Callout tone="warn" title="Degraded mode">
                      Discovery will stop with an explicit “insufficient evidence” result rather than presenting model guesses as market demand.
                    </Callout>
                  )}
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="pad">
                <h3 className="h3 mb-2.5">Session status</h3>
                <div className="space-y-2.5 text-[12.5px]">
                  <Line label="AI connected" value={sessionState.connectedAt ? new Date(sessionState.connectedAt).toLocaleTimeString() : 'no'} tone={sessionState.connectedAt ? 'moss' : 'neutral'} />
                  <Line label="Structured mode" value={capability?.structured_mode ?? 'unknown'} tone={capability?.structured_mode === 'json_schema' ? 'moss' : 'sun'} />
                  <Line label="Models visible" value={String(capability?.models_available ?? 0)} />
                  <Line label="Last check latency" value={capability ? `${capability.latency_ms}ms` : '—'} />
                </div>
                {capability?.notes?.length ? (
                  <div className="mt-3 text-[11.5px] text-ink-faint font-mono space-y-0.5">
                    {capability.notes.map((n) => <div key={n}>{n}</div>)}
                  </div>
                ) : null}
              </Card>

              <Card className="pad">
                <div className="flex items-center gap-2 mb-2.5"><ShieldCheck size={15} /> <h3 className="h3">Key handling</h3></div>
                <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
                  <li>• Keys live in JavaScript memory for this tab only.</li>
                  <li>• They are never written to IndexedDB, cookies or localStorage.</li>
                  <li>• A full page refresh clears them — paste again next session.</li>
                  <li>• CreatorTools has no backend and cannot see your keys.</li>
                  <li>• Your AI key is never sent to your search provider, and vice versa.</li>
                </ul>
                <Button
                  className="w-full mt-3.5"
                  variant="quiet"
                  onClick={() => { clearCredentials(); setAiKey(''); setSearchKey(''); bumpSession(); toast({ tone: 'info', title: 'All session keys cleared' }); }}
                >
                  <Trash2 size={14} /> Clear all session keys
                </Button>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'methodology' ? (
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
            <Card className="pad">
              <SectionTitle title="Research thresholds" sub="These gates decide when CreatorTools is allowed to call something an opportunity. Raising them costs more search credits but produces stronger evidence." icon={<Wand2 size={16} />} />
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Max queries per run" hint="Default 24. More queries = broader evidence, higher search cost.">
                  <Input type="number" min={6} max={80} value={methodology.max_queries} onChange={(e: any) => setMethodology({ ...methodology, max_queries: Number(e.target.value) })} />
                </Field>
                <Field label="Results per query">
                  <Input type="number" min={3} max={15} value={methodology.results_per_query} onChange={(e: any) => setMethodology({ ...methodology, results_per_query: Number(e.target.value) })} />
                </Field>
                <Field label="Freshness window (days)" hint="Trend claims prefer sources inside this window.">
                  <Input type="number" min={7} max={3650} value={methodology.freshness_days} onChange={(e: any) => setMethodology({ ...methodology, freshness_days: Number(e.target.value) })} />
                </Field>
                <Field label="Priority freshness (days)">
                  <Input type="number" min={7} max={365} value={methodology.priority_freshness_days} onChange={(e: any) => setMethodology({ ...methodology, priority_freshness_days: Number(e.target.value) })} />
                </Field>
                <Field label="Minimum evidence items per run">
                  <Input type="number" min={5} max={200} value={methodology.minimum_evidence_items} onChange={(e: any) => setMethodology({ ...methodology, minimum_evidence_items: Number(e.target.value) })} />
                </Field>
                <Field label="Minimum independent domains">
                  <Input type="number" min={2} max={40} value={methodology.minimum_independent_domains} onChange={(e: any) => setMethodology({ ...methodology, minimum_independent_domains: Number(e.target.value) })} />
                </Field>
                <Field label="Niches analysed per run" hint="Problems are mined for the top N niches by specificity and evidence. Others can be mined on demand.">
                  <Input type="number" min={1} max={15} value={methodology.analyze_top_niches} onChange={(e: any) => setMethodology({ ...methodology, analyze_top_niches: Number(e.target.value) })} />
                </Field>
                <Field label="Problems per niche">
                  <Input type="number" min={3} max={20} value={methodology.max_problems_per_niche} onChange={(e: any) => setMethodology({ ...methodology, max_problems_per_niche: Number(e.target.value) })} />
                </Field>
                <Field label="Signal batch size" hint="Evidence items per signal-extraction call. Smaller is more accurate, larger is cheaper.">
                  <Input type="number" min={4} max={30} value={methodology.signal_batch_size} onChange={(e: any) => setMethodology({ ...methodology, signal_batch_size: Number(e.target.value) })} />
                </Field>
                <Field label="Niche cluster threshold" hint="0.60-0.90. Higher keeps more near-duplicates separate.">
                  <Input type="number" min={0.5} max={0.95} step={0.01} value={methodology.cluster_threshold} onChange={(e: any) => setMethodology({ ...methodology, cluster_threshold: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="mt-5 flex gap-2">
                <Button onClick={saveConnection}>Save thresholds</Button>
                <Button variant="quiet" onClick={() => setMethodology({ ...DEFAULT_METHODOLOGY })}>Reset to defaults</Button>
              </div>
            </Card>

            <Card className="pad">
              <SectionTitle title="Query layers" sub="Mandatory coverage for every run." icon={<Layers size={16} />} />
              <ol className="space-y-3">
                {QUERY_LAYERS.map((l) => (
                  <li key={l.layer} className="flex gap-3">
                    <span className="text-[11px] tnum text-ink-faint mt-1">{String(l.layer).padStart(2, '0')}</span>
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">{l.name.replace(/_/g, ' ')}</span>
                      <span className="block text-[12.5px] text-ink-mute">{l.purpose}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <Callout tone="lilac" title="Why this matters">
                Layer 9 (contrarian) exists to disprove the opportunity before you spend money on it. If you disable a search
                provider, layers 2-9 cannot run at all and the run is marked partial.
              </Callout>
            </Card>
          </div>
        ) : null}

        {tab === 'engine' ? (
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
            <Card className="pad">
              <SectionTitle title="Opportunity score" sub={`Deterministic. Engine ${SCORING_VERSION}. The model supplies component assessments; the app owns every calculation.`} icon={<Sparkles size={16} />} />
              <div className="space-y-2.5">
                {COMPONENT_ORDER.map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-[13px] text-ink-soft flex-1">{COMPONENT_LABELS[k]}</span>
                    <span className="w-24 h-1.5 rounded-full bg-line-soft overflow-hidden">
                      <span className="block h-full bg-ink rounded-full" style={{ width: `${WEIGHTS[k] * 100 * 5}%` }} />
                    </span>
                    <span className="text-[12.5px] tnum text-ink w-12 text-right">{(WEIGHTS[k] * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <CopyBlock
                  label="Formulas in use"
                  maxHeight={260}
                  text={`base_score = Σ(component × weight)

evidence_confidence =
  source_reliability   ${(CONFIDENCE_WEIGHTS.source_reliability * 100).toFixed(0)}%
  source_diversity     ${(CONFIDENCE_WEIGHTS.source_diversity * 100).toFixed(0)}%
  recency              ${(CONFIDENCE_WEIGHTS.recency * 100).toFixed(0)}%
  directness           ${(CONFIDENCE_WEIGHTS.directness * 100).toFixed(0)}%
  cross_source_consistency ${(CONFIDENCE_WEIGHTS.cross_source_consistency * 100).toFixed(0)}%

confidence_multiplier     = 0.60 + (confidence / 100 × 0.40)
contradiction_multiplier  = 1 − (contradiction_rate × 0.20)
final_score = clamp(base × confidence_multiplier × contradiction_multiplier, 0, 100)

evidence_weight = reliability × freshness × relevance × directness × independence`}
                />
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="pad">
                <h3 className="h3 mb-2.5">Gates that block a claim</h3>
                <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
                  <li>• No source → no factual claim. Uncited model statements are discarded before display.</li>
                  <li>• No dated evidence inside 90 days → no current-trend claim.</li>
                  <li>• Fewer than 5 evidence items or 3 domains → marked insufficient evidence.</li>
                  <li>• Contradicting sources reduce the score by up to 20% and are always shown.</li>
                  <li>• A high score with low confidence is never presented as a stronger opportunity than a slightly lower score with strong evidence.</li>
                </ul>
              </Card>
              <Card className="pad">
                <h3 className="h3 mb-2.5">Versions</h3>
                <div className="space-y-2 text-[12.5px]">
                  <Line label="Engine" value={ENGINE_VERSION} />
                  <Line label="Prompt set" value={PROMPT_VERSION} />
                  <Line label="Scoring" value={SCORING_VERSION} />
                  <Line label="Freshness formula" value="0-30d 1.0 · 31-90d 0.9 · 91-180d 0.75 · 181-365d 0.55 · 1y+ 0.35" />
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'prompts' ? (
          <div className="space-y-4">
            <Callout tone="info" title={`Prompt set ${PROMPT_VERSION} — bundled, versioned, inspectable`}>
              Every production prompt lives in one place inside the app and is prepended with the global system prompt. Nothing is
              assembled ad hoc at call time, so improving quality does not require re-architecting the product.
            </Callout>
            {PROMPT_CATALOGUE.map((p) => (
              <Card key={p.key} className="pad">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="h3">{p.title}</h3>
                    <p className="text-[12.5px] text-ink-mute mt-0.5">{p.applies}</p>
                  </div>
                  <Tag tone="neutral">{p.version}</Tag>
                </div>
                <CopyBlock label={`prompt key: ${p.key}`} text={p.body} maxHeight={210} />
              </Card>
            ))}
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 items-start">
            <div className="space-y-4">
              <Card className="pad">
                <SectionTitle title="What is stored on this device" sub="Everything the app knows about you lives in this browser's IndexedDB." icon={<Database size={16} />} />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(stats).map(([k, v]) => (
                    <div key={k} className="rounded-xl2 border border-line-soft px-3.5 py-3">
                      <div className="text-[10.5px] uppercase tracking-[0.05em] text-ink-faint">{k}</div>
                      <div className="text-[18px] font-semibold tnum mt-1">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={async () => {
                    const summary = await exportWorkspace();
                    toast({ tone: 'success', title: 'Workspace exported', body: Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(' · ') });
                  }}>
                    <Download size={14} /> Export all data (JSON)
                  </Button>
                  <Button variant="quiet" onClick={() => setShowImport(true)}><Upload size={14} /> Import from JSON</Button>
                  <Button variant="quiet" onClick={() => navigate('/discover')}>Back to discovery</Button>
                </div>
                <div className="mt-5">
                  <Callout tone="warn" title="API keys are not in this export">
                    Exports contain your research, products and analytics — never credentials. Those only ever exist in memory for the
                    current session.
                  </Callout>
                </div>
              </Card>

              <Card className="pad">
                <SectionTitle title="Danger zone" />
                <p className="text-[13px] text-ink-mute leading-relaxed">
                  Deleting everything removes research runs, evidence, niches, problems, scores, reports, projects, products, pricing,
                  marketing assets, campaigns and analytics from this browser. It cannot be undone.
                </p>
                <Button variant="danger" className="mt-4" onClick={() => setConfirmWipe(true)}><Trash2 size={14} /> Delete all local data</Button>
              </Card>
            </div>

            <div className="space-y-4">
              <Card className="pad">
                <h3 className="h3 mb-2.5">Why local-first</h3>
                <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
                  <li>• No account, no server, no telemetry.</li>
                  <li>• Your niche research is commercially sensitive — it stays with you.</li>
                  <li>• The app is static files: it can be hosted anywhere, including offline via PWA install.</li>
                  <li>• The moat is the methodology inside the app (queries, gates, formulas, prompts), not your data.</li>
                </ul>
              </Card>
              <Card className="pad">
                <div className="flex items-center gap-2 mb-2.5"><Info size={15} /> <h3 className="h3">Known limits</h3></div>
                <ul className="space-y-2 text-[12.5px] text-ink-mute leading-relaxed">
                  <li>• Browser calls to third-party APIs can be blocked by CORS, corporate proxies or ad-blockers. Use the optional proxy field if that happens.</li>
                  <li>• Keys are visible to anything running in this page while the tab is open — don't run untrusted extensions alongside it.</li>
                  <li>• Search providers charge per query; a full run consumes roughly {methodology.max_queries} search credits plus one credit per deep validation pass.</li>
                </ul>
              </Card>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title="Delete all local data?"
        sub="This clears the entire local database for CreatorTools in this browser."
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmWipe(false)}>Cancel</Button>
            <Button variant="danger" onClick={async () => {
              await wipeEverything();
              await reload();
              setConfirmWipe(false);
              toast({ tone: 'info', title: 'Local data deleted', body: 'The workspace is empty. Keys were untouched (memory only).' });
              navigate('/home');
            }}><Trash2 size={14} /> Delete everything</Button>
          </>
        }
      >
        <div className="flex items-start gap-3 text-[13.5px] text-ink-soft">
          <AlertTriangle size={18} className="mt-0.5 text-rose-500 shrink-0" />
          <p>Export first if you want a copy. There is no server-side backup, by design.</p>
        </div>
      </Modal>

      <Modal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import workspace JSON"
        sub="Paste an export produced by CreatorTools. Rows are merged by id."
        wide
        footer={
          <>
            <Button variant="quiet" onClick={() => setShowImport(false)}>Cancel</Button>
            <Button onClick={async () => {
              const parsed = safeJsonParse<any>(importText);
              if (!parsed) return toast({ tone: 'error', title: 'That is not valid JSON' });
              await importAll(parsed);
              await reload();
              setShowImport(false);
              setImportText('');
              toast({ tone: 'success', title: 'Workspace imported' });
            }}>Import</Button>
          </>
        }
      >
        <textarea
          className="field font-mono text-[12px] h-72"
          placeholder='{"research_runs":[…],"evidence":[…]}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
      </Modal>
    </Page>
  );
}

function Line({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'moss' | 'sun' }) {
  const toneClass = { neutral: 'text-ink', moss: 'text-moss-600', sun: 'text-sun-600' }[tone];
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-ink-mute">{label}</span>
      <span className={cx('font-medium text-right break-words max-w-[60%]', toneClass)}>{value}</span>
    </div>
  );
}
