import { create } from 'zustand';
import type { AudienceProfile, ProgressEvent, ResearchRun, SettingsRow } from './core/types';
import { db, getActiveAudience, getSettings, nowISO } from './core/db/database';
import { sessionState } from './core/ai/session';

export interface Toast { id: string; tone: 'info' | 'success' | 'error' | 'warn'; title: string; body?: string }

interface State {
  ready: boolean;
  settings: SettingsRow | null;
  audience: AudienceProfile | null;
  runs: ResearchRun[];
  progress: ProgressEvent | null;
  running: boolean;
  toasts: Toast[];
  sessionVersion: number;
  init: () => Promise<void>;
  reload: () => Promise<void>;
  setSettings: (s: SettingsRow) => void;
  setAudience: (a: AudienceProfile | null) => void;
  setProgress: (p: ProgressEvent | null) => void;
  setRunning: (r: boolean) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
  bumpSession: () => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  settings: null,
  audience: null,
  runs: [],
  progress: null,
  running: false,
  toasts: [],
  sessionVersion: 0,

  init: async () => {
    const [settings, audience, runs] = await Promise.all([
      getSettings(),
      getActiveAudience(),
      db.research_runs.orderBy('started_at').reverse().limit(40).toArray(),
    ]);
    set({ settings, audience, runs, ready: true });
  },

  reload: async () => {
    const [settings, audience, runs] = await Promise.all([
      getSettings(),
      getActiveAudience(),
      db.research_runs.orderBy('started_at').reverse().limit(40).toArray(),
    ]);
    set({ settings, audience, runs });
  },

  setSettings: (settings) => set({ settings }),
  setAudience: (audience) => set({ audience }),
  setProgress: (progress) => set({ progress }),
  setRunning: (running) => set({ running }),
  bumpSession: () => set({ sessionVersion: get().sessionVersion + 1 }),

  toast: (t) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 9000 : 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const connectedToAI = () => Boolean(sessionState.connectedAt);
export const sessionCapability = () => sessionState.capability;
export { sessionState };
