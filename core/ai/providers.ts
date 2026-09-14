/* ------------------------------------------------------------------
   Provider adapters. One OpenAI-compatible contract, three presets
   (Groq, OpenRouter, custom gateway) plus capability detection so the
   app degrades gracefully when a model cannot do strict JSON schema.
   ------------------------------------------------------------------ */
import type { AIProviderConfig, AppError, ProviderId, StructuredMode } from '../types';
import { err, isCorsOrNetworkFailure, mapHttpError, safeJsonParse, withTimeout } from '../lib/utils';
import { getCredential, sessionState } from './session';

export interface Preset {
  id: ProviderId;
  label: string;
  blurb: string;
  base_url: string;
  keys_url: string;
  docs_url: string;
  suggested_models: string[];
  /** Ordered budget → premium. The first entry is the default, chosen so a
   *  first run costs cents rather than dollars. */
  models: ModelOption[];
  /** One line on what a typical run costs, shown under the picker. */
  cost_note: string;
  notes: string;
  /** Whether a GET {base}/models listing is supported. */
  list_models: boolean;
}

export type CostTier = 'budget' | 'balanced' | 'premium';
export type ModelOption = { id: string; tier: CostTier; note: string };

export const TIER_LABEL: Record<CostTier, string> = {
  budget: 'Lowest cost',
  balanced: 'Balanced',
  premium: 'Highest quality',
};

/* Groq retires models aggressively — llama-3.3-70b-versatile and
   llama-3.1-8b-instant were both shut down on 2026-08-16, and kimi-k2,
   llama-4-maverick and qwen3-32b have gone too. A stale id here fails with
   model_not_found for every user, so this list is the current catalog and the
   UI always offers "load the live list". */
const GROQ_MODELS: ModelOption[] = [
  { id: 'openai/gpt-oss-120b', tier: 'budget', note: 'Recommended. $0.15 / $0.60 per million tokens.' },
  { id: 'openai/gpt-oss-20b', tier: 'budget', note: 'Cheapest. $0.075 / $0.30 per million tokens.' },
  { id: 'qwen/qwen3.6-27b', tier: 'balanced', note: 'Stronger reasoning, higher cost.' },
  { id: 'groq/compound', tier: 'balanced', note: 'Compound has its own built-in web search.' },
];

/* Deliberately budget-first. OpenRouter routes to whatever model you name, so
   "OpenRouter" is not expensive or cheap by itself — claude-sonnet at
   ~$3/$15 per million is, gemini-flash at a fraction of that is not. */
const OPENROUTER_MODELS: ModelOption[] = [
  { id: 'google/gemini-2.5-flash', tier: 'budget', note: 'Fast and inexpensive. Good default for analysis runs.' },
  { id: 'openai/gpt-4.1-mini', tier: 'budget', note: 'Small, capable, low cost.' },
  { id: 'deepseek/deepseek-chat-v3.1', tier: 'budget', note: 'Very low cost per token.' },
  { id: 'openai/gpt-4.1', tier: 'balanced', note: 'Noticeably stronger, mid-priced.' },
  { id: 'anthropic/claude-sonnet-4.5', tier: 'premium', note: 'Best writing quality. Roughly $3 / $15 per million tokens — budget accordingly.' },
];

export const PRESETS: Record<ProviderId, Preset> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    blurb: 'Fast and genuinely cheap. A full discovery run costs a few cents.',
    base_url: 'https://api.groq.com/openai/v1',
    keys_url: 'https://console.groq.com/keys',
    docs_url: 'https://console.groq.com/docs/structured-outputs',
    suggested_models: GROQ_MODELS.map((m) => m.id),
    models: GROQ_MODELS,
    cost_note: 'Roughly 1–3 cents per discovery run on the recommended model.',
    notes: 'Groq is OpenAI-compatible and supports JSON Schema structured outputs on supported models.',
    list_models: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'One key, any model. You choose the model, so you choose the price.',
    base_url: 'https://openrouter.ai/api/v1',
    keys_url: 'https://openrouter.ai/keys',
    docs_url: 'https://openrouter.ai/docs/features/structured-outputs',
    suggested_models: OPENROUTER_MODELS.map((m) => m.id),
    models: OPENROUTER_MODELS,
    cost_note: 'The model decides the price — the default is a few cents per run, not dollars.',
    notes: 'Structured-output support varies by upstream model — CreatorTools probes the capability and adapts.',
    list_models: true,
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    blurb: 'Ollama, vLLM, LM Studio, Together, Fireworks, Azure-style gateways, your own proxy.',
    base_url: '',
    keys_url: '',
    docs_url: '',
    suggested_models: [],
    models: [],
    cost_note: 'Whatever your own endpoint charges.',
    notes: 'Any endpoint exposing POST {base}/chat/completions with an OpenAI-shaped body.',
    list_models: true,
  },
};

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface StructuredRequest {
  schema_name: string;
  schema: Record<string, any>;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Forced structured mode; when omitted the adapter negotiates. */
  mode?: StructuredMode;
}

export interface StructuredResult<T = any> {
  data: T | null;
  raw: string;
  mode: StructuredMode;
  ms: number;
  tokens_in: number;
  tokens_out: number;
  model: string;
  provider: ProviderId;
  attempts: { mode: StructuredMode; ok: boolean; status?: number; note?: string }[];
}

export const defaultConfig = (provider: ProviderId, baseUrlOverride?: string): AIProviderConfig => {
  const p = PRESETS[provider];
  return {
    provider,
    model: p.suggested_models[0] ?? '',
    base_url: baseUrlOverride ?? p.base_url,
    structured_mode: null,
    temperature: 0,
    app_title: 'CreatorTools',
    app_url: typeof location !== 'undefined' ? location.origin : 'https://creatortools.app',
  };
};

export function normalizeBaseUrl(config: AIProviderConfig): string {
  const raw = (config.base_url || PRESETS[config.provider]?.base_url || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  // Tolerate users pasting the full completions URL.
  return raw.replace(/\/chat\/completions$/, '');
}

function headersFor(config: AIProviderConfig, apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (config.provider === 'openrouter') {
    if (config.app_url) h['HTTP-Referer'] = config.app_url;
    if (config.app_title) h['X-Title'] = config.app_title;
  }
  return { ...h, ...(config.extra_headers ?? {}) };
}

/* ------------------------- model discovery -------------------------- */

export async function listModels(config: AIProviderConfig, apiKey: string): Promise<string[]> {
  const base = normalizeBaseUrl(config);
  if (!base) throw err('no_provider', 'No base URL configured for this provider.');
  try {
    const res = await withTimeout(
      fetch(`${base}/models`, { headers: headersFor(config, apiKey) }),
      15000,
      'Model list request',
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw mapHttpError(res.status, body, config.provider);
    }
    const json = await res.json();
    const rows: any[] = json?.data ?? json?.models ?? [];
    return rows.map((r) => r?.id ?? r?.name).filter(Boolean).sort();
  } catch (e: any) {
    if (e?.code) throw e;
    if (isCorsOrNetworkFailure(e)) {
      throw err('cors_or_network', 'The provider list endpoint could not be reached from this browser. Type the model name manually.', { retryable: true });
    }
    throw err('unknown', e?.message || 'Could not list models.');
  }
}

/* ------------------------- chat completions ------------------------- */

function buildBody(config: AIProviderConfig, req: StructuredRequest, mode: StructuredMode): Record<string, any> {
  const body: Record<string, any> = {
    model: config.model,
    messages: req.messages,
    temperature: req.temperature ?? config.temperature ?? 0,
  };
  if (req.max_tokens) body.max_completion_tokens = req.max_tokens;
  if (mode === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: req.schema_name, strict: true, schema: req.schema },
    };
    // Some OpenAI-compatible servers require `strict` inside json_schema; ours is included.
  } else if (mode === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function postCompletion(config: AIProviderConfig, apiKey: string, body: Record<string, any>, timeoutMs = 120000) {
  const base = normalizeBaseUrl(config);
  if (!base || !config.model) throw err('no_provider', 'AI provider is not fully configured (base URL + model required).');
  const res = await withTimeout(
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headersFor(config, apiKey),
      body: JSON.stringify(body),
    }),
    timeoutMs,
    'Model call',
  );
  return res;
}

/**
 * Structured call with graceful degradation:
 *  1. strict JSON Schema (best)
 *  2. JSON object mode (validation still enforced by Zod downstream)
 *  3. plain text with fence-stripping + brace extraction (last resort, flagged)
 * Every attempt is logged into `attempts`, and a schema-invalid payload is
 * never silently accepted — the caller validates and can reject.
 */
export async function callStructured<T = any>(
  config: AIProviderConfig,
  apiKey: string,
  req: StructuredRequest,
  opts: { timeoutMs?: number; allowDegrade?: boolean } = {},
): Promise<StructuredResult<T>> {
  if (!apiKey) throw err('invalid_api_key', 'No API key for this session. Reconnect your provider.');
  const allowDegrade = opts.allowDegrade !== false;
  const known = req.mode ?? config.structured_mode ?? null;
  const ladder: StructuredMode[] = known
    ? allowDegrade
      ? ([known, 'json_object', 'text'].filter((m, i, a) => a.indexOf(m) === i) as StructuredMode[])
      : [known]
    : allowDegrade
      ? ['json_schema', 'json_object', 'text']
      : ['json_schema'];

  const attempts: StructuredResult<T>['attempts'] = [];
  let lastError: AppError | null = null;
  const started = performance.now();

  for (const mode of ladder) {
    const body = buildBody(
      config,
      mode === 'text'
        ? {
            ...req,
            messages: [
              ...req.messages,
              {
                role: 'user',
                content: `Return ONLY minified JSON matching this JSON Schema. No prose, no markdown fences.\nSCHEMA:\n${JSON.stringify(req.schema)}`,
              },
            ],
          }
        : req,
      mode,
    );
    try {
      const res = await postCompletion(config, apiKey, body, opts.timeoutMs);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const mapped = mapHttpError(res.status, text, config.provider);
        attempts.push({ mode, ok: false, status: res.status, note: mapped.code });
        lastError = mapped;
        const downgradable = ['unsupported_structured_output', 'unsupported_model'].includes(mapped.code) && res.status === 400;
        if (downgradable && allowDegrade) continue;
        if (mapped.code === 'rate_limit' || mapped.code === 'invalid_api_key') throw mapped;
        if (!allowDegrade) throw mapped;
        continue;
      }
      const json = await res.json();
      const raw: string = json?.choices?.[0]?.message?.content ?? '';
      const data = safeJsonParse<T>(raw);
      attempts.push({ mode, ok: Boolean(data) });
      if (!data) {
        lastError = err('malformed_response', 'The model returned content that is not valid JSON.', {
          provider: config.provider,
          detail: raw.slice(0, 400),
          retryable: true,
        });
        continue;
      }
      const usage = json?.usage ?? {};
      const ms = Math.round(performance.now() - started);
      if (mode !== 'json_schema') config.structured_mode = mode; // remember working mode for the session
      return {
        data,
        raw,
        mode,
        ms,
        tokens_in: usage.prompt_tokens ?? 0,
        tokens_out: usage.completion_tokens ?? 0,
        model: config.model,
        provider: config.provider,
        attempts,
      };
    } catch (e: any) {
      if (e?.code === 'timeout' || e?.code === 'invalid_api_key' || e?.code === 'rate_limit') {
        attempts.push({ mode, ok: false, note: e.code });
        throw e;
      }
      if (isCorsOrNetworkFailure(e)) {
        attempts.push({ mode, ok: false, note: 'network/cors' });
        throw err(
          'cors_or_network',
          'The browser could not reach the AI provider directly. This is usually a network, ad-blocker or CORS restriction on your connection.',
          { provider: config.provider, retryable: true },
        );
      }
      attempts.push({ mode, ok: false, note: e?.code ?? 'unknown' });
      lastError = e?.code ? e : err('unknown', e?.message ?? 'Unknown provider error.');
      if (!allowDegrade) throw lastError;
    }
  }
  throw lastError ?? err('unknown', 'The provider could not produce a structured response.');
}

/* --------------------------- connection test ------------------------ */

export interface ConnectionTestResult {
  ok: boolean;
  provider: ProviderId;
  model: string;
  latency_ms: number;
  models_available: string[];
  structured_mode: StructuredMode | 'unknown';
  checks: { label: string; ok: boolean; detail: string }[];
  error?: AppError;
}

export async function testConnection(config: AIProviderConfig, apiKey: string): Promise<ConnectionTestResult> {
  const checks: ConnectionTestResult['checks'] = [];
  const started = performance.now();
  let models: string[] = [];

  try {
    models = await listModels(config, apiKey).catch((e) => {
      checks.push({ label: 'List models', ok: false, detail: e?.message ?? 'unavailable' });
      return [];
    });
    if (models.length) {
      checks.push({ label: 'List models', ok: true, detail: `${models.length} models visible to this key` });
      if (config.model && !models.includes(config.model)) {
        // A stale id is the single most common cause of "it does not work", and
        // providers retire models often. Say exactly that, and stop — probing a
        // model we know is absent just produces a confusing second error.
        const label = PRESETS[config.provider]?.label ?? config.provider;
        checks.push({
          label: 'Model',
          ok: false,
          detail: `“${config.model}” is not in ${label}'s current model list — it has most likely been retired. Load the live list and pick one of those.`,
        });
        return {
          ok: false,
          provider: config.provider,
          model: config.model,
          latency_ms: Math.round(performance.now() - started),
          models_available: models,
          structured_mode: 'unknown',
          checks,
          error: err('unsupported_model', `“${config.model}” is not available at ${label}. Load the live model list and choose one of the returned models.`),
        };
      }
      if (config.model) {
        checks.push({ label: 'Model', ok: true, detail: `${config.model} is available` });
      }
    }
  } catch (e: any) {
    checks.push({ label: 'List models', ok: false, detail: e?.message ?? 'failed' });
  }

  // Structured probe: ask for a tiny schema-shaped object.
  const probeSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'echo'],
    properties: { ok: { type: 'boolean' }, echo: { type: 'string' } },
  };
  try {
    const result = await callStructured<{ ok: boolean; echo: string }>(config, apiKey, {
      schema_name: 'creatortools_connection_check',
      schema: probeSchema,
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: 'system', content: 'You are performing an API connectivity test for CreatorTools. Return only the requested JSON.' },
        { role: 'user', content: 'Return ok=true and echo="connected".' },
      ],
    }, { timeoutMs: 45000 });
    checks.push({
      label: 'Structured output',
      ok: true,
      detail: result.mode === 'json_schema'
        ? 'Native JSON Schema enforced'
        : result.mode === 'json_object'
          ? 'JSON mode available (schema enforcement handled locally)'
          : 'Text mode only — JSON parsed and schema-validated locally',
    });
    sessionState.capability = {
      provider: config.provider,
      model: config.model,
      structured_mode: result.mode,
      latency_ms: result.ms,
      models_available: models.length,
      checked_at: new Date().toISOString(),
      notes: result.attempts.map((a) => `${a.mode}: ${a.ok ? 'ok' : a.note ?? 'failed'}`),
    };
    sessionState.connectedAt = new Date().toISOString();
    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      latency_ms: result.ms,
      models_available: models,
      structured_mode: result.mode,
      checks,
    };
  } catch (e: any) {
    const error: AppError = e?.code ? e : err('unknown', e?.message ?? 'Connection failed.');
    checks.push({ label: 'Structured output', ok: false, detail: error.message });
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      latency_ms: Math.round(performance.now() - started),
      models_available: models,
      structured_mode: 'unknown',
      checks,
      error,
    };
  }
}

/** Thin wrapper used by engines: pulls the session key, logs usage, returns data. */
export async function runAI<T>(config: AIProviderConfig, req: StructuredRequest, timeoutMs = 150000) {
  const key = getCredential('ai');
  if (!key) throw err('invalid_api_key', 'No API key for this session. Reconnect your provider.');
  return callStructured<T>(config, key, req, { timeoutMs });
}
