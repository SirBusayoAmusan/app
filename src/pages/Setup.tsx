import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, Loader2, Plug, RefreshCw, ShieldCheck, Trash2, TriangleAlert,
} from 'lucide-react';
import { Page, navigate } from '../components/shell';
import { Button, Callout, Card, Field, Input, Select, Tag, cx } from '../components/ui';
import { PRESETS, TIER_LABEL, defaultConfig, listModels, normalizeBaseUrl, testConnection } from '../core/ai/providers';
import { SEARCH_PROVIDERS, searchProviderReady, testSearchProvider } from '../core/intelligence/searchProviders';
import { Mascot, type MascotMood } from '../components/Mascot';
import { cacheModels, clearCredentials, getCredential, readCachedModels, sessionState, setCredential } from '../core/ai/session';
import { saveAudience, updateSettings } from '../core/db/database';
import { useStore } from '../store';
import type { AIProviderConfig, ProviderId, SearchProviderConfig, SearchProviderId } from '../core/types';
import { maskKey } from '../core/lib/utils';

/* Read the provider out of the key itself, so the user never has to know that
   "provider" is a thing they need to choose. Only unambiguous prefixes are
   trusted — a bare `sk-` is several providers, and guessing wrong is worse
   than falling back to the picker. */
function detectProvider(key: string): ProviderId | null {
  const k = key.trim();
  if (!k) return null;
  if (/^sk-or-/i.test(k)) return 'openrouter';
  if (/^gsk_/i.test(k)) return 'groq';
  return null;
}

const STEPS = [
  { key: 'ai', title: 'Your AI key', blurb: 'Paste a key. Nothing is stored and there is no account.' },
  { key: 'search', title: 'Evidence', blurb: 'Already connected. This is what stops CreatorTools guessing.' },
  { key: 'audience', title: 'Who is it for?', blurb: 'Everyone gets sharper results from a narrow audience.' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export default function Setup() {
  const { settings, audience, reload, toast, bumpSession } = useStore();
  const [step, setStep] = useState<StepKey>('ai');

  const [ai, setAi] = useState<AIProviderConfig>(() => settings?.ai ?? defaultConfig('groq'));
  const [aiKey, setAiKey] = useState(() => getCredential('ai') ?? '');
  const [search, setSearch] = useState<SearchProviderConfig>(() => settings?.search ?? { id: 'serper', enabled: true, proxy: '' });
  const [searchKeys, setSearchKeys] = useState<Record<string, string>>({
    tavily: getCredential('tavily') ?? '',
    serper: getCredential('serper') ?? '',
    exa: getCredential('exa') ?? '',
  });
  const [audienceText, setAudienceText] = useState(() => audience?.business_type ?? '');
  const [interestText, setInterestText] = useState(() => (audience?.interests ?? []).join(', '));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testConnection>> | null>(null);
  const [models, setModels] = useState<string[]>(() => readCachedModels('ai') ?? []);
  const [loadingModels, setLoadingModels] = useState(false);
  const [searchTest, setSearchTest] = useState<{ ok: boolean; ms: number; sample: any[]; error?: string } | null>(null);
  const [testingSearch, setTestingSearch] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showProviders, setShowProviders] = useState(false);

  useEffect(() => { if (settings?.ai) setAi(settings.ai); }, [settings?.ai]);

  const preset = PRESETS[ai.provider];
  const aiReady = Boolean(testResult?.ok);
  const searchMeta = SEARCH_PROVIDERS.find((p) => p.id === search.id);
  const searchReadyFromCfg = searchProviderReady(search).ready;
  const searchKey = searchKeys[search.id] ?? '';
  /* The keyless public datasets need no credential, so evidence is live from
     the first run; only a commercial key has to be proven before it counts. */
  const keylessEvidence = Boolean(searchMeta?.keyless);
  const searchReady = keylessEvidence ? searchReadyFromCfg : Boolean(searchTest?.ok);
  const canFinish = aiReady;

  /* Persist credentials + settings at the moment they are proven to work, so a
     later step can never silently discard an earlier one. */
  const persist = async (overrides: Partial<{ search: SearchProviderConfig }> = {}) => {
    setCredential('ai', aiKey);
    (['tavily', 'serper', 'exa'] as const).forEach((id) => { if (searchKeys[id]) setCredential(id, searchKeys[id]); });
    const nextSearch = overrides.search ?? search;
    await updateSettings({ ai: { ...ai, base_url: normalizeBaseUrl(ai) }, search: { ...nextSearch, enabled: nextSearch.id !== 'none' } });
    await reload();
    bumpSession();
  };

  const onKeyChange = (value: string) => {
    setAiKey(value);
    setCredential('ai', value);
    setTestResult(null);
    setModels(readCachedModels('ai') ?? []);
    const detected = detectProvider(value);
    if (detected && detected !== ai.provider) {
      const next = { ...defaultConfig(detected), extra_headers: ai.extra_headers };
      setAi(next);
      setModels(readCachedModels(detected) ?? []);
    }
  };

  const pickProvider = (provider: ProviderId) => {
    const next = defaultConfig(provider, provider === 'custom' ? ai.base_url : undefined);
    if (provider === 'custom') next.base_url = ai.base_url || 'http://localhost:11434/v1';
    setAi({ ...next, structured_mode: null, extra_headers: ai.extra_headers });
    setTestResult(null);
    setModels(readCachedModels(provider) ?? []);
  };

  const loadModels = async () => {
    if (!aiKey) return toast({ tone: 'warn', title: 'Add your key first' });
    setLoadingModels(true);
    try {
      const list = await listModels(ai, aiKey);
      setModels(list);
      cacheModels('ai', list);
      cacheModels(ai.provider, list);
      if (list.length && !list.includes(ai.model)) {
        // The configured model is gone or misspelled — move to one that exists.
        setAi((prev) => ({ ...prev, model: list[0] }));
        toast({ tone: 'info', title: 'Model updated', body: `“${ai.model}” is not available at ${preset.label}. Switched to ${list[0]}.` });
      } else {
        toast({ tone: 'success', title: `${list.length} models available` });
      }
    } catch (e: any) {
      toast({ tone: 'error', title: 'Could not load models', body: e?.message });
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async () => {
    if (!aiKey) return toast({ tone: 'warn', title: 'Paste your key first' });
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(ai, aiKey);
      setTestResult(result);
      if (result.ok) toast({ tone: 'success', title: 'Key works', body: `${result.provider} · ${result.model}` });
    } finally {
      setTesting(false);
    }
  };

  const runSearchTest = async () => {
    if (!searchKey) return toast({ tone: 'warn', title: 'Paste the search key first' });
    setTestingSearch(true);
    try {
      const result = await testSearchProvider(search);
      setSearchTest(result);
      if (result.ok) toast({ tone: 'success', title: 'Evidence source working', body: `${result.sample.length} sample results` });
    } finally {
      setTestingSearch(false);
    }
  };

  /* Next: prove the step works, save it, then move on. */
  const next = async () => {
    if (step === 'ai') {
      if (!aiReady) return toast({ tone: 'warn', title: 'Check your key first', body: 'It takes a second and proves the key works.' });
      await persist();
      setStep('search');
      return;
    }
    if (step === 'search') {
      if (searchTest && !searchTest.ok && !keylessEvidence) return toast({ tone: 'warn', title: 'Check the search key first' });
      await persist();
      setStep('audience');
      return;
    }
    // audience
    const businessType = audienceText.trim();
    if (businessType) {
      const now = new Date().toISOString();
      await saveAudience({
        id: audience?.id ?? `aud_${Date.now().toString(36)}`,
        name: audience?.name || 'My audience',
        age_min: audience?.age_min ?? 22,
        age_max: audience?.age_max ?? 40,
        gender: audience?.gender ?? 'All genders',
        location: audience?.location ?? 'Global',
        language: audience?.language ?? 'English',
        income_level: audience?.income_level ?? 'Middle income',
        employment_status: audience?.employment_status ?? 'Self-employed / freelancer',
        experience_level: audience?.experience_level ?? 'Beginner',
        interests: interestText.split(',').map((s) => s.trim()).filter(Boolean),
        business_type: businessType,
        life_stage: audience?.life_stage ?? 'Early career',
        platforms: audience?.platforms ?? [],
        is_active: true,
        created_at: audience?.created_at ?? now,
        updated_at: now,
      });
      await reload();
    }
    await persist();
    toast({
      tone: 'success',
      title: 'You are ready',
      body: 'Finding your first opportunity now takes one tap.',
    });
    navigate('/discover');
  };

  const back = () => {
    if (step === 'search') return setStep('ai');
    if (step === 'audience') return setStep('search');
  };

  const removeCredentials = () => {
    clearCredentials();
    setAiKey('');
    setSearchKeys({ tavily: '', serper: '', exa: '' });
    setTestResult(null);
    setSearchTest(null);
    bumpSession();
    toast({ tone: 'info', title: 'Keys cleared', body: 'Nothing was ever stored on disk.' });
  };

  const modelOptions = useMemo(() => preset.models, [preset]);
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  /* Pip reflects real state, never decoration: she is unsure until a key
     checks out, busy while it is being tested, and pleased once it works. */
  const pipMood: MascotMood = testing || testingSearch
    ? 'thinking'
    : testResult?.ok || (step === 'search' && keylessEvidence)
      ? 'happy'
      : testResult && !testResult.ok
        ? 'alert'
        : 'idle';

  return (
    <Page title={STEPS[stepIndex].title} sub={STEPS[stepIndex].blurb}>
      {/* Pip sits with the progress rail: one glance says where you are and
          how it is going, before you read a single label. */}
      <div className="flex items-center gap-4 mb-5 max-w-2xl">
        <Mascot mood={pipMood} size={62} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 flex-1">
                <div className={cx('h-1.5 rounded-full flex-1 transition-colors', i <= stepIndex ? 'bg-ink' : 'bg-line')} />
                <span className={cx('text-[11.5px] tnum shrink-0', i <= stepIndex ? 'text-ink font-medium' : 'text-ink-faint')}>{i + 1}</span>
              </div>
            ))}
            <span className="text-[11.5px] text-ink-faint shrink-0">of {STEPS.length}</span>
          </div>
          <div className="text-[12.5px] text-ink-mute mt-2">
            {pipMood === 'thinking' ? 'Checking that key…'
              : pipMood === 'happy' ? 'Connected — on to the next thing.'
                : pipMood === 'alert' ? 'That key was not accepted. Everything else still works.'
                  : 'One thing at a time.'}
          </div>
        </div>
      </div>

      <div className="max-w-2xl space-y-5">
        {/* ============================ STEP 1 · AI KEY ============================ */}
        {step === 'ai' ? (
          <Card className="pad">
            <Field label="Paste your AI key">
              <div className="relative">
                <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="pl-10 font-mono text-[13px]"
                  value={aiKey}
                  onChange={(e: any) => onKeyChange(e.target.value)}
                  placeholder="sk-or-… or gsk_…"
                />
              </div>
              <div className="hint">
                Paste a key from OpenRouter, Groq, OpenAI or Anthropic — we work out which one it is. A discovery costs {preset.cost_note.toLowerCase()}
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Button onClick={runTest} loading={testing}>
                {aiReady ? <Check size={14} /> : <Plug size={14} />} {aiReady ? 'Working' : 'Check key'}
              </Button>
              {preset.keys_url ? (
                <a href={preset.keys_url} target="_blank" rel="noreferrer" className="linkbtn no-underline text-[12.5px] text-ink-mute hover:text-ink">
                  Get a {preset.label} key <ExternalLink size={12} />
                </a>
              ) : null}
            </div>

            {testResult?.ok ? (
              <div className="mt-4 rounded-xl2 border border-moss-500/25 bg-moss-50 p-3.5 flex items-start gap-2.5">
                <Check size={15} className="text-moss-600 mt-0.5 shrink-0" />
                <div className="text-[12.5px] text-ink-soft">
                  <strong className="text-ink font-medium">Connected.</strong> {testResult.model}
                  <span className="text-ink-faint"> · {testResult.latency_ms}ms · {maskKey(aiKey)}</span>
                </div>
              </div>
            ) : null}

            {testResult && !testResult.ok ? (
              <div className="mt-4 rounded-xl2 border border-rose-500/25 bg-rose-50 p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-600 mb-2">
                  <TriangleAlert size={15} /> {testResult.error?.message ?? 'That key did not work'}
                </div>
                {testResult.checks.filter((c) => !c.ok).map((c) => (
                  <p key={c.label} className="text-[12.5px] text-ink-soft mt-1">{c.detail}</p>
                ))}
                {testResult.error?.code === 'unsupported_model' ? (
                  <Button variant="quiet" className="mt-3" onClick={loadModels} loading={loadingModels}>
                    <RefreshCw size={14} /> Load current models
                  </Button>
                ) : null}
              </div>
            ) : null}

            {/* Everything a learner does not need, one line away. */}
            <button className="linkbtn no-underline text-[12px] text-ink-mute hover:text-ink mt-5" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? 'Hide options' : 'Change the model'}
            </button>

            {showAdvanced ? (
              <div className="mt-3 space-y-4 rounded-xl2 border border-line bg-canvas p-4">
                {modelOptions.length ? (
                  <Field label="Model" hint={preset.cost_note}>
                    <Select value={modelOptions.some((m) => m.id === ai.model) ? ai.model : ''} onChange={(e: any) => setAi({ ...ai, model: e.target.value })}>
                      {modelOptions.map((m) => (
                        <option key={m.id} value={m.id}>{m.id} — {TIER_LABEL[m.tier]}</option>
                      ))}
                      {modelOptions.some((m) => m.id === ai.model) ? null : <option value={ai.model}>{ai.model}</option>}
                    </Select>
                    <div className="hint">{modelOptions.find((m) => m.id === ai.model)?.note}</div>
                  </Field>
                ) : null}

                <Field label="Model id">
                  <div className="flex gap-2">
                    <Input
                      list="model-options"
                      value={ai.model}
                      onChange={(e: any) => setAi({ ...ai, model: e.target.value })}
                      placeholder="model-id"
                      className="font-mono text-[13px]"
                    />
                    <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
                    <Button variant="quiet" onClick={loadModels} loading={loadingModels} className="shrink-0"><RefreshCw size={14} /> Load</Button>
                  </div>
                  <div className="hint">Providers retire models often. Loading the live list is the quickest way to see what your key can actually use.</div>
                </Field>

                {preset.list_models && models.length ? (
                  <Field label="Any model your key can see" hint={`${models.length} available.`}>
                    <Select value="" onChange={(e: any) => { if (e.target.value) setAi({ ...ai, model: e.target.value }); }}>
                      <option value="">Choose from the live list…</option>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select>
                  </Field>
                ) : null}

                <button className="linkbtn no-underline text-[12px] text-ink-mute hover:text-ink" onClick={() => setShowProviders((v) => !v)}>
                  {showProviders ? 'Keep this provider' : `Change provider (currently ${preset.label})`}
                </button>
                {showProviders ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(PRESETS) as ProviderId[]).map((id) => (
                        <button
                          key={id}
                          onClick={() => pickProvider(id)}
                          className={cx('rounded-full border px-3 py-1.5 text-[12.5px] transition', ai.provider === id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-soft hover:text-ink')}
                        >
                          {PRESETS[id].label}
                        </button>
                      ))}
                    </div>
                    {ai.provider === 'custom' ? (
                      <Field label="API base URL" hint="Any OpenAI-compatible endpoint, e.g. http://localhost:11434/v1 (Ollama).">
                        <Input value={ai.base_url} onChange={(e: any) => setAi({ ...ai, base_url: e.target.value })} placeholder="https://your-gateway.com/v1" />
                      </Field>
                    ) : null}
                    <Field label="Structured output" hint="Auto-negotiates JSON Schema → JSON mode → parsed text.">
                      <Select value={ai.structured_mode ?? ''} onChange={(e: any) => setAi({ ...ai, structured_mode: e.target.value || null })}>
                        <option value="">Auto (recommended)</option>
                        <option value="json_schema">Force strict JSON Schema</option>
                        <option value="json_object">Force JSON object mode</option>
                        <option value="text">Force text + local parsing</option>
                      </Select>
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ) : null}
        {/* ==================== STEP 2 · EVIDENCE (ALREADY ON) ====================
            The keyless public datasets are on from the first run, so this step
            has nothing to fill in. It exists to say so plainly, and to offer a
            deliberate upgrade for anyone who wants commercial search coverage. */}
        {step === 'search' ? (
          <Card className="pad">
            <div className="rounded-xl2 border border-moss-500/25 bg-moss-50 p-4">
              <div className="flex items-start gap-2.5">
                <Check size={17} className="text-moss-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-ink">Already working — nothing to add</div>
                  <p className="text-[13px] text-ink-soft mt-1">
                    CreatorTools reads live public discussions and dated posts to check demand. It needs no key for
                    this, and it is on right now.
                  </p>
                </div>
              </div>
            </div>

            {searchTest?.ok ? (
              <div className="mt-4 rounded-xl2 border border-line bg-canvas p-3.5">
                <div className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                  <Check size={15} className="text-moss-600 shrink-0" />
                  <span>
                    <strong className="text-ink font-medium">Reading the web.</strong> {searchTest.sample.length} live
                    results in {searchTest.ms}ms
                  </span>
                </div>
                {searchTest.sample.slice(0, 2).map((s: any) => (
                  <div key={s.url} className="text-[11.5px] text-ink-faint truncate mt-1.5">• {s.title}</div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 mt-5">
              <Button variant="quiet" onClick={runSearchTest} loading={testingSearch}>
                {searchReady ? <Check size={14} /> : <Plug size={14} />} {searchReady ? 'Working' : 'Test evidence'}
              </Button>
              <button className="linkbtn no-underline text-[12px] text-ink-mute hover:text-ink" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide options' : 'Add a Google search key for wider coverage'}
              </button>
            </div>

            {showAdvanced ? (
              <div className="mt-4 space-y-4 rounded-xl2 border border-line bg-canvas p-4">
                <p className="text-[12.5px] text-ink-soft">
                  Optional. The free sources lean technical — great for judging pain and urgency, thinner on mainstream
                  buying behaviour. A Google results key widens coverage; it is not required and everything above keeps
                  working without it.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SEARCH_PROVIDERS.filter((p) => p.id !== 'none' && !p.keyless).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSearch({ ...search, id: p.id as SearchProviderId, enabled: true }); setSearchTest(null); }}
                      className={cx('rounded-full border px-3 py-1.5 text-[12.5px] transition', search.id === p.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-soft hover:text-ink')}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => { setSearch({ ...search, id: 'community', enabled: true }); setSearchTest(null); }}
                    className={cx('rounded-full border px-3 py-1.5 text-[12.5px] transition', search.id === 'community' ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-soft hover:text-ink')}
                  >
                    Public discussion data only
                  </button>
                </div>

                {search.id !== 'community' ? (
                  <Field label={`${searchMeta?.label} key`} hint={searchMeta?.costNote}>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        autoComplete="off"
                        className="font-mono text-[13px]"
                        value={searchKey}
                        onChange={(e: any) => {
                          setSearchTest(null);
                          setSearchKeys({ ...searchKeys, [search.id]: e.target.value });
                          setCredential(search.id as 'tavily' | 'serper' | 'exa', e.target.value);
                        }}
                        placeholder="paste your key"
                      />
                      <Button variant="quiet" onClick={runSearchTest} loading={testingSearch} className="shrink-0">
                        {searchReady ? <Check size={14} /> : <Plug size={14} />} {searchReady ? 'Working' : 'Check'}
                      </Button>
                    </div>
                    {searchMeta?.keys_url ? (
                      <a href={searchMeta.keys_url} target="_blank" rel="noreferrer" className="linkbtn no-underline text-[12.5px] text-ink-mute hover:text-ink inline-flex items-center gap-1 mt-2">
                        Get a {searchMeta.label} key <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </Field>
                ) : null}

                {searchTest && !searchTest.ok ? (
                  <div className="rounded-xl2 border border-rose-500/25 bg-rose-50 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-600 mb-1.5">
                      <TriangleAlert size={15} /> {searchTest.error ?? 'That key did not work'}
                    </div>
                    <p className="text-[12.5px] text-ink-soft">
                      The free sources still work, so you can keep going without this.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* =========================== STEP 3 · AUDIENCE =========================== */}
        {step === 'audience' ? (
          <Card className="pad">
            <Field label="Who do you want to help?">
              <textarea
                className="field min-h-[92px] resize-y"
                value={audienceText}
                onChange={(e: any) => setAudienceText(e.target.value)}
                placeholder="e.g. freelance social media managers who cannot win clients without referrals"
              />
              <div className="hint">
                Be specific — a named person with a specific problem beats a broad category. “Small business owners” is too wide;
                “Etsy sellers doing under $2k a month” is not. You can refine this later.
              </div>
            </Field>

            <Field label="What are they into?" className="mt-5">
              <Input value={interestText} onChange={(e: any) => setInterestText(e.target.value)} placeholder="e.g. digital marketing, client acquisition" />
              <div className="hint">Comma separated. These steer the searches.</div>
            </Field>

            <div className="mt-4">
              <button className="linkbtn no-underline text-[12px] text-ink-mute hover:text-ink" onClick={() => navigate('/audience')}>
                Add budget, platform and other detail →
              </button>
            </div>
          </Card>
        ) : null}

        {/* ============================== controls ================================ */}
        <div className="flex flex-wrap items-center gap-3">
          {stepIndex > 0 ? (
            <Button variant="ghost" onClick={back}><ArrowLeft size={15} /> Back</Button>
          ) : null}
          <Button size="lg" onClick={next} disabled={step === 'ai' && !aiReady}>
            {step === 'audience' ? (canFinish ? 'Find my opportunity' : 'Finish setup') : 'Next'}
            <ArrowRight size={15} />
          </Button>
          {step === 'ai' ? (
            <span className="text-[12px] text-ink-faint">
              {aiReady ? 'Key verified — continue.' : 'Check the key to continue.'}
            </span>
          ) : null}
          {aiKey ? (
            <Button variant="ghost" onClick={removeCredentials} className="ml-auto"><Trash2 size={14} /> Clear keys</Button>
          ) : null}
        </div>

        <p className="text-[12px] text-ink-faint leading-relaxed flex items-start gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <span>
            Your key lives in this browser tab only — never saved, never sent to anyone except the AI service you chose,
            and cleared when you refresh. <button className="linkbtn no-underline" onClick={() => navigate('/learn')}>How it works →</button>
          </span>
        </p>
      </div>
    </Page>
  );
}
