/* ------------------------------------------------------------------
   Session credential store.

   Deliberate design decision: API keys live in this module's memory
   ONLY. They are never written to IndexedDB, localStorage, sessionStorage
   or any server. A page refresh wipes them. The UI says this plainly.
   ------------------------------------------------------------------ */

export type CredentialKey = 'ai' | 'tavily' | 'serper' | 'exa';

const memory: Record<string, string | null> = {
  ai: null,
  tavily: null,
  serper: null,
  exa: null,
};

export function setCredential(kind: CredentialKey, value: string | null) {
  memory[kind] = value ? value.trim() : null;
  if (kind === 'ai') memory.aiModel = null; // no-op guard for model cache below
}

export function getCredential(kind: CredentialKey): string | null {
  return memory[kind] ?? null;
}

export function hasCredential(kind: CredentialKey): boolean {
  return Boolean(memory[kind]);
}

export function clearCredentials() {
  Object.keys(memory).forEach((k) => { memory[k] = null; });
}

/** Non-secret, in-memory cache of provider model lists (refreshed per session). */
const modelCache: Record<string, string[]> = {};
export function cacheModels(cacheKey: string, models: string[]) { modelCache[cacheKey] = models; }
export function readCachedModels(cacheKey: string): string[] | null { return modelCache[cacheKey] ?? null; }

/** Live session facts surfaced in the UI ("keys are in memory for this tab"). */
export const sessionState = {
  connectedAt: null as string | null,
  capability: null as null | {
    provider: string; model: string; structured_mode: string;
    latency_ms: number; models_available: number; checked_at: string; notes: string[];
  },
};
