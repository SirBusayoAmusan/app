import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ExternalLink, KeyRound, Plug, RefreshCw, ShieldCheck, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, Chip, CopyBlock, Field, Input, Segmented, Select, Toggle, Tag, cx } from '../components/ui';
import { PRESETS, defaultConfig, listModels, normalizeBaseUrl, testConnection } from '../core/ai/providers';
import { SEARCH_PROVIDERS, testSearchProvider } from '../core/intelligence/searchProviders';
import { cacheModels, clearCredentials, getCredential, readCachedModels, sessionState, setCredential } from '../core/ai/session';
import { updateSettings } from '../core/db/database';
import { useStore } from '../store';
import type { AIProviderConfig, ProviderId, SearchProviderConfig, SearchProviderId } from '../core/types';
import { maskKey } from '../core/lib/utils';

export default function Setup() {
  const { settings, reload, toast, bumpSession } = useStore();
  const [ai, setAi] = useState<AIProviderConfig>(() => settings?.ai ?? defaultConfig('groq'));
  const [aiKey, setAiKey] = useState(() => getCredential('ai') ?? '');
  // Defaults to Serper.dev: it is the one search API that answers a direct
  // browser call (verified — Tavily and Exa send no CORS headers), and this app
  // has no backend to proxy through.
  const [search, setSearch] = useState<SearchProviderConfig>(() => settings?.search ?? { id: 'serper', enabled: true, proxy: '' });
  const [searchKeys, setSearchKeys] = useState<Record<string, string>>({
    tavily: getCredential('tavily') ?? '',
    serper: getCredential('serper') ?? '',
    exa: getCredential('exa') ?? '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testConnection>> | null>(null);
  const [models, setModels] = useState<string[]>(() => readCachedModels('ai') ?? []);
  const [loadingModels, setLoadingModels] = useState(false);
  const [searchTest, setSearchTest] = useState<{ ok: boolean; ms: number; sample: any[]; error?: string } | null>(null);
  const [testingSearch, setTestingSearch] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => { if (settings?.ai) setAi(settings.ai); }, [settings?.ai]);

  const preset = PRESETS[ai.provider];
  const connected = Boolean(sessionState.connectedAt);
  const modelList = useMemo(() => (models.length ? models : preset.suggested_models), [models, preset]);

  const pickProvider = (provider: ProviderId) => {
    const next = defaultConfig(provider, provider === 'custom' ? ai.base_url : undefined);
    if (provider === 'custom') next.base_url = ai.base_url || 'http://localhost:11434/v1';
    setAi({ ...next, structured_mode: null, extra_headers: ai.extra_headers });
    setTestResult(null);
    setModels(readCachedModels(provider) ?? []);
  };

  const loadModels = async () => {
    if (!aiKey) return toast({ tone: 'warn', title: 'Add your API key first' });
    setLoadingModels(true);
    try {
      const list = await listModels(ai, aiKey);
      setModels(list);
      cacheModels('ai', list);
      cacheModels(ai.provider, list);
      toast({ tone: 'success', title: `${list.length} models available`, body: 'Pick the model you want to use per run.' });
      if (!ai.model && list.length) setAi((prev) => ({ ...prev, model: list[0] }));
    } catch (e: any) {
      toast({ tone: 'error', title: 'Could not list models', body: e?.message });
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async () => {
    if (!aiKey) return toast({ tone: 'warn', title: 'Enter your API key first' });
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(ai, aiKey);
      setTestResult(result);
      if (result.ok) {
        toast({ tone: 'success', title: 'Connection verified', body: `${result.provider} · ${result.model} · ${result.latency_ms}ms` });
      } else {
        toast({ tone: 'error', title: 'Connection failed', body: result.error?.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!aiKey) return toast({ tone: 'warn', title: 'Enter your API key to continue' });
    if (!ai.model) return toast({ tone: 'warn', title: 'Choose a model' });
    setCredential('ai', aiKey);
    (['tavily', 'serper', 'exa'] as const).forEach((id) => {
      if (searchKeys[id]) setCredential(id, searchKeys[id]);
    });
    const savedSearch: SearchProviderConfig = { ...search, enabled: search.id !== 'none' };
    await updateSettings({ ai: { ...ai, base_url: normalizeBaseUrl(ai) }, search: savedSearch });
    await reload();
    bumpSession();
    toast({ tone: 'success', title: 'Workspace ready', body: 'Your key stays in this browser session only.' });
    navigate('/home');
  };

  const removeCredentials = () => {
    clearCredentials();
    setAiKey('');
    setSearchKeys({ tavily: '', serper: '', exa: '' });
    bumpSession();
    toast({ tone: 'info', title: 'Credentials cleared', body: 'Nothing was ever stored on disk.' });
  };

  return (
    <Page
      title="Connect your AI"
      sub="Bring your own AI credits. Choose the model that powers your CreatorTools workspace."
      badge={<Tag tone="lilac"><Sparkles size={11} /> Bring your own key</Tag>}
    >
      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          {/* ---------------- AI provider ---------------- */}
          <Card className="pad">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="h3">1 · AI provider</h2>
                <p className="sub mt-1">The model does the analysis. It never supplies market facts — that is the search layer's job.</p>
              </div>
              {connected ? <Tag tone="moss"><Check size={11} /> session active</Tag> : null}
            </div>

            <div className="grid sm:grid-cols-3 gap-2.5 mb-5">
              {(Object.keys(PRESETS) as ProviderId[]).map((id) => {
                const p = PRESETS[id];
                const on = ai.provider === id;
                return (
                  <button
                    key={id}
                    onClick={() => pickProvider(id)}
                    className={cx('text-left rounded-xl2 border p-3.5 transition', on ? 'border-ink bg-white shadow-card' : 'border-line bg-white/60 hover:border-[#d7d7de]')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] font-semibold">{p.label}</span>
                      {on ? <Check size={14} /> : null}
                    </div>
                    <p className="text-[11.5px] text-ink-faint mt-1.5 leading-snug">{p.blurb}</p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-4">
              {ai.provider === 'custom' ? (
                <Field label="API base URL" hint="Any OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 (Ollama), https://api.together.xyz/v1, a self-hosted proxy.">
                  <Input value={ai.base_url} onChange={(e: any) => setAi({ ...ai, base_url: e.target.value })} placeholder="https://your-gateway.com/v1" />
                </Field>
              ) : null}

              <Field label="API key" hint="Used directly from this browser tab to the provider. Never stored, never sent anywhere else.">
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    className="pl-10 font-mono text-[13px]"
                    value={aiKey}
                    onChange={(e: any) => { setAiKey(e.target.value); setCredential('ai', e.target.value); }}
                    placeholder={ai.provider === 'groq' ? 'gsk_…' : ai.provider === 'openrouter' ? 'sk-or-v1-…' : 'your-key'}
                  />
                </div>
              </Field>
              {aiKey ? <div className="text-[11.5px] text-ink-faint -mt-2">Session value: <span className="font-mono">{maskKey(aiKey)}</span></div> : null}

              <Field label="Model">
                <div className="flex gap-2">
                  <Input
                    list="model-options"
                    value={ai.model}
                    onChange={(e: any) => setAi({ ...ai, model: e.target.value })}
                    placeholder={modelList[0] ?? 'model-id'}
                    className="font-mono text-[13px]"
                  />
                  <datalist id="model-options">
                    {modelList.map((m) => <option key={m} value={m} />)}
                  </datalist>
                  <Button variant="quiet" onClick={loadModels} loading={loadingModels} className="shrink-0">
                    <RefreshCw size={14} /> Load
                  </Button>
                </div>
                <div className="hint">Model names change often — load the live list from your provider or paste any model id.</div>
              </Field>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={runTest} loading={testing} variant="quiet"><Plug size={14} /> Test connection</Button>
                {ai.provider !== 'custom' ? (
                  <a href={preset.keys_url} target="_blank" rel="noreferrer" className="text-[12.5px] text-ink-mute hover:text-ink inline-flex items-center gap-1">
                    Get a {preset.label} key <ExternalLink size={12} />
                  </a>
                ) : null}
                <button className="linkbtn no-underline ml-auto text-[12.5px] text-ink-mute hover:text-ink" onClick={() => setAdvanced((v) => !v)}>
                  {advanced ? 'Hide advanced' : 'Advanced'}
                </button>
              </div>

              {advanced ? (
                <div className="rounded-xl2 border border-line p-4 space-y-3.5 bg-canvas">
                  <Field label="Structured output mode" hint="Auto-negotiates: strict JSON Schema → JSON mode → parsed text. Pin it if your gateway only supports one.">
                    <Select value={ai.structured_mode ?? ''} onChange={(e: any) => setAi({ ...ai, structured_mode: e.target.value || null })}>
                      <option value="">Auto (recommended)</option>
                      <option value="json_schema">Force strict JSON Schema</option>
                      <option value="json_object">Force JSON object mode</option>
                      <option value="text">Force text + local parsing</option>
                    </Select>
                  </Field>
                  <Field label="Temperature" hint="0 keeps analysis deterministic. Higher adds variety to writing tasks.">
                    <Input type="number" min={0} max={1} step={0.05} value={ai.temperature ?? 0.1} onChange={(e: any) => setAi({ ...ai, temperature: Number(e.target.value) })} />
                  </Field>
                  <Field label="Extra headers (JSON)" hint="For gateways that need custom routing headers. Never put secrets you don't want sent by this browser.">
                    <Input
                      className="font-mono text-[12.5px]"
                      value={JSON.stringify(ai.extra_headers ?? {})}
                      onChange={(e: any) => {
                        try { setAi({ ...ai, extra_headers: JSON.parse(e.target.value || '{}') }); } catch { /* ignore until valid */ }
                      }}
                    />
                  </Field>
                </div>
              ) : null}

              {testResult ? (
                <div className={cx('rounded-xl2 border p-4', testResult.ok ? 'border-moss-500/25 bg-moss-50' : 'border-rose-500/25 bg-rose-50')}>
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold mb-2.5">
                    {testResult.ok ? <Check size={15} className="text-moss-600" /> : <TriangleAlert size={15} className="text-rose-500" />}
                    {testResult.ok ? 'Connection verified' : 'Connection failed'}
                  </div>
                  <div className="space-y-1.5">
                    {testResult.checks.map((c) => (
                      <div key={c.label} className="flex items-start gap-2 text-[12.5px]">
                        <span className={cx('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', c.ok ? 'bg-moss-500' : 'bg-rose-500')} />
                        <span className="text-ink-soft"><strong className="font-medium text-ink">{c.label}:</strong> {c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          {/* ---------------- Search provider ---------------- */}
          <Card className="pad">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="h3">2 · Live market evidence</h2>
                <p className="sub mt-1">
                  Required for honest discovery. Without a search provider CreatorTools refuses to present model guesses as market opportunities.
                </p>
              </div>
              <Tag tone={search.id === 'none' ? 'sun' : 'lilac'}><Plug size={11} /> {search.id === 'none' ? 'disabled' : search.id}</Tag>
            </div>

            <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
              {SEARCH_PROVIDERS.map((p) => {
                const on = search.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { setSearch({ ...search, id: p.id as SearchProviderId, enabled: p.id !== 'none' }); setSearchTest(null); }}
                    className={cx('text-left rounded-xl2 border p-3.5 transition', on ? 'border-ink bg-white shadow-card' : 'border-line bg-white/60 hover:border-[#d7d7de]')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold">{p.label}</span>
                      {on ? <Check size={14} /> : null}
                    </div>
                    <p className="text-[11.5px] text-ink-faint mt-1.5 leading-snug">{p.blurb}</p>
                    <p className="text-[11px] text-ink-faint/80 mt-1.5">{p.costNote}</p>
                    {p.id !== 'none' ? (
                      <p className={cx('text-[11px] mt-2 font-medium', p.browserDirect ? 'text-moss-600' : 'text-sun-600')}>
                        {p.browserDirect ? '✓ Works directly from the browser' : '⚠ Needs a CORS proxy'}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {search.id !== 'none' ? (
              <div className="space-y-4">
                <Field label={`${SEARCH_PROVIDERS.find((p) => p.id === search.id)?.label} API key`} hint="Session-only, same as your AI key.">
                  <Input
                    type="password"
                    autoComplete="off"
                    className="font-mono text-[13px]"
                    value={searchKeys[search.id] ?? ''}
                    onChange={(e: any) => {
                      setSearchKeys({ ...searchKeys, [search.id]: e.target.value });
                      setCredential(search.id as 'tavily' | 'serper' | 'exa', e.target.value);
                    }}
                    placeholder={search.id === 'tavily' ? 'tvly-…' : search.id === 'serper' ? 'serper key' : 'exa key'}
                  />
                </Field>
                <Field
                  label={SEARCH_PROVIDERS.find((p) => p.id === search.id)?.browserDirect === false ? 'CORS proxy (required for this provider)' : 'Optional CORS proxy'}
                  hint={SEARCH_PROVIDERS.find((p) => p.id === search.id)?.proxyNote
                    ?? 'Only if your network blocks direct browser calls. Provide a URL that forwards to the provider; use {url} as the encoded target placeholder.'}
                >
                  <Input value={search.proxy ?? ''} onChange={(e: any) => setSearch({ ...search, proxy: e.target.value })} placeholder="https://my-proxy.example.com/?url={url}" />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="quiet"
                    loading={testingSearch}
                    onClick={async () => {
                      setTestingSearch(true);
                      try {
                        setSearchTest(await testSearchProvider(search));
                      } finally {
                        setTestingSearch(false);
                      }
                    }}
                  >
                    <Plug size={14} /> Test search
                  </Button>
                  <a
                    href={SEARCH_PROVIDERS.find((p) => p.id === search.id)?.keys_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12.5px] text-ink-mute hover:text-ink inline-flex items-center gap-1"
                  >
                    Get a key <ExternalLink size={12} />
                  </a>
                </div>
                {searchTest ? (
                  <div className={cx('rounded-xl2 border p-4', searchTest.ok ? 'border-moss-500/25 bg-moss-50' : 'border-rose-500/25 bg-rose-50')}>
                    <div className="text-[13px] font-semibold mb-1.5">
                      {searchTest.ok ? `Search working · ${searchTest.ms}ms · ${searchTest.sample.length} sample results` : 'Search failed'}
                    </div>
                    {searchTest.sample.map((s: any) => (
                      <div key={s.url} className="text-[12px] text-ink-mute truncate">• {s.title} — <span className="text-ink-faint">{s.url}</span></div>
                    ))}
                    {searchTest.error ? <div className="text-[12.5px] text-rose-600">{searchTest.error}</div> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <Callout tone="warn" title="Degraded mode">
                You can still build the layered research plan and export the query set, but discovery will stop with an explicit
                “insufficient evidence” result instead of inventing market demand.
              </Callout>
            )}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={save}>
              Continue to workspace <ArrowRight size={15} />
            </Button>
            {aiKey || Object.values(searchKeys).some(Boolean) ? (
              <Button size="lg" variant="ghost" onClick={removeCredentials}><Trash2 size={14} /> Clear all keys</Button>
            ) : null}
          </div>
        </div>

        {/* ---------------- Side panel ---------------- */}
        <div className="space-y-5">
          <Card className="pad">
            <div className="flex items-center gap-2 mb-2.5"><ShieldCheck size={16} /> <h3 className="h3">Your keys, your browser</h3></div>
            <ul className="space-y-2.5 text-[12.5px] text-ink-mute leading-relaxed">
              <li>• Keys are held in this tab's memory and sent <strong className="text-ink">directly</strong> to the provider you choose.</li>
              <li>• Nothing is written to IndexedDB, cookies or storage. Refresh and the key is gone.</li>
              <li>• CreatorTools runs no backend. Research, products and analytics stay on this device.</li>
              <li>• Your provider is <strong className="text-ink">never</strong> sent another provider's key.</li>
              <li>• You pay your provider directly — CreatorTools takes no margin on inference.</li>
            </ul>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-2.5">How the intelligence is layered</h3>
            <div className="space-y-2.5 text-[12.5px] text-ink-mute">
              {[
                ['1', 'Your AI provider', 'Reasons over evidence. Never the source of market facts.'],
                ['2', 'Search / trend APIs', 'Supply current, dateable evidence with URLs.'],
                ['3', 'The scoring engine', 'Deterministic arithmetic you can audit, bundled with the app.'],
              ].map(([n, t, d]) => (
                <div key={n} className="flex gap-3">
                  <span className="h-5 w-5 rounded-full bg-ink text-white text-[11px] flex items-center justify-center shrink-0">{n}</span>
                  <span><strong className="text-ink font-medium">{t}</strong> — {d}</span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <CopyBlock
                label="What a run actually sends"
                maxHeight={190}
                text={`SYSTEM  market-intelligence analyst rules (bundled, versioned)
+ STRICT JSON SCHEMA (scores, evidence ids, no free-form claims)
+ YOUR AUDIENCE PROFILE
+ EVIDENCE BLOCKS from your search provider:
    [ev_ab12] title · domain · published date · snippet · url
RULES    every claim must cite an evidence id that exists`}
              />
            </div>
          </Card>

          <Card className="pad">
            <h3 className="h3 mb-2.5">Only keys, every time?</h3>
            <p className="text-[12.5px] text-ink-mute leading-relaxed">
              Yes — deliberate. An offline-first tool cannot prove it kept a key safe, so it simply keeps none. If you use this
              daily, keep your key in a password manager and paste it at the start of a session.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
