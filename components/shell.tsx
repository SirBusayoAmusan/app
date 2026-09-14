import React, { useEffect, useState } from 'react';
import {
  BarChart3, Bell, BookOpen, Compass, DollarSign, Home, Layers, LayoutGrid, Megaphone,
  Menu, Rocket, Settings as SettingsIcon, Sparkles, TrendingUp, X, Zap,
} from 'lucide-react';
import { useStore } from '../store';
import { cx, IconButton, Tag } from './ui';
import { sessionState } from '../core/ai/session';

export interface Route { path: string; parts: string[]; query: URLSearchParams }

export function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pathname, qs] = raw.split('?');
  const parts = pathname.split('/').filter(Boolean);
  return { path: `/${parts.join('/')}`, parts, query: new URLSearchParams(qs ?? '') };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (to: string, opts: { replace?: boolean } = {}) => {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) window.location.replace(target);
  else window.location.hash = target;
  if (!opts.replace) window.scrollTo({ top: 0 });
};

export const NAV_DESKTOP = [
  { path: '/home', label: 'Home', icon: Home },
  { path: '/discover', label: 'Find Opportunity', icon: Compass },
  { path: '/trends', label: 'Trend Intelligence', icon: TrendingUp },
  { path: '/projects', label: 'My Products', icon: Layers },
  { path: '/marketing', label: 'Marketing', icon: Megaphone },
  { path: '/pricing', label: 'Pricing', icon: DollarSign },
  { path: '/ads', label: 'Ads', icon: Zap },
  { path: '/launch', label: 'Launch', icon: Rocket },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export const NAV_MOBILE = [
  { path: '/home', label: 'Home', icon: Home },
  { path: '/discover', label: 'Discover', icon: Compass },
  { path: '/projects', label: 'Projects', icon: LayoutGrid },
  { path: '/learn', label: 'Learn', icon: BookOpen },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <circle cx="12" cy="16" r="7.5" fill="#1d1d1f" />
        <circle cx="21" cy="16" r="7.5" fill="#7c5cff" fillOpacity="0.85" />
      </svg>
      {!compact ? <span className="text-[15.5px] font-semibold tracking-[-0.02em]">CreatorTools</span> : null}
    </div>
  );
}

function ConnectionPill() {
  const { sessionVersion } = useStore();
  const cap = sessionState.capability;
  const connected = Boolean(sessionState.connectedAt);
  void sessionVersion;
  return (
    <button
      onClick={() => navigate('/settings')}
      className={cx('hidden sm:flex items-center gap-2 rounded-full border px-3 h-9 text-[12.5px] transition',
        connected ? 'border-moss-500/25 bg-moss-50 text-moss-600 hover:border-moss-500/40' : 'border-line bg-white text-ink-mute hover:text-ink')}
      title={connected ? `${cap?.provider} · ${cap?.model}` : 'Connect your AI provider'}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', connected ? 'bg-moss-500' : 'bg-sun-500')} />
      {connected ? `${cap?.provider ?? 'AI'} · ${(cap?.model ?? '').split('/').pop()?.slice(0, 22)}` : 'Connect your AI'}
    </button>
  );
}

export function Sidebar({ route }: { route: Route }) {
  const active = (p: string) => route.path === p || route.path.startsWith(`${p}/`);
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-line bg-white/70 backdrop-blur-sm">
      <div className="px-5 h-16 flex items-center">
        <button onClick={() => navigate('/home')}><Logo /></button>
      </div>
      <nav className="px-3 pb-4 flex-1 overflow-y-auto">
        {NAV_DESKTOP.map((item) => {
          const Icon = item.icon;
          const on = active(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cx('w-full flex items-center gap-3 rounded-xl px-3 h-10 text-[13.5px] transition mb-0.5',
                on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft')}
            >
              <Icon size={16} className={on ? 'text-white' : 'text-ink-mute'} />
              {item.label}
            </button>
          );
        })}
        <div className="my-3 h-px bg-line" />
        {[
          { path: '/learn', label: 'How it works', icon: BookOpen },
          { path: '/settings', label: 'Settings', icon: SettingsIcon },
        ].map((item) => {
          const Icon = item.icon;
          const on = active(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cx('w-full flex items-center gap-3 rounded-xl px-3 h-10 text-[13.5px] transition mb-0.5',
                on ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft')}
            >
              <Icon size={16} className={on ? 'text-white' : 'text-ink-mute'} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="px-4 pb-5">
        <div className="rounded-xl2 border border-line bg-canvas p-3.5">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink"><Sparkles size={13} /> Local-first</div>
          <p className="text-[11.5px] text-ink-faint mt-1.5 leading-snug">
            Research and products stay in this browser. API keys stay in memory for this session only.
          </p>
        </div>
      </div>
    </aside>
  );
}

export function MobileHeader({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);
  const { settings, sessionVersion } = useStore();
  void sessionVersion;
  const title = (() => {
    if (route.path.startsWith('/niche')) return 'Niche';
    if (route.path.startsWith('/problem')) return 'Problem';
    const found = NAV_DESKTOP.find((n) => route.path.startsWith(n.path));
    if (found) return found.label;
    if (route.path.startsWith('/setup')) return 'Connect';
    if (route.path.startsWith('/audience')) return 'Audience';
    if (route.path.startsWith('/settings')) return 'Settings';
    if (route.path.startsWith('/create')) return 'Create';
    if (route.path.startsWith('/marketing')) return 'Marketing';
    if (route.path.startsWith('/pricing')) return 'Pricing';
    if (route.path.startsWith('/ads')) return 'Ads';
    if (route.path.startsWith('/launch')) return 'Launch';
    if (route.path.startsWith('/analytics')) return 'Analytics';
    return 'CreatorTools';
  })();

  return (
    <>
      <header className="lg:hidden sticky top-0 z-40 bg-canvas/85 backdrop-blur-md border-b border-line">
        <div className="h-14 px-4 flex items-center justify-between">
          <button onClick={() => navigate('/home')} className="-m-2 p-2" aria-label="CreatorTools home">
            <Logo compact />
          </button>
          <div className="text-[14px] font-semibold tracking-[-0.01em]">{title}</div>
          <div className="flex items-center gap-1">
            <IconButton label="Alerts" onClick={() => navigate('/trends')}><Bell size={17} /></IconButton>
            <IconButton label="Menu" onClick={() => setOpen(true)}><Menu size={18} /></IconButton>
          </div>
        </div>
      </header>
      {open ? (
        <div className="lg:hidden fixed inset-0 z-50 animate-fadeIn">
          <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[80%] max-w-[320px] bg-white shadow-lift p-5 overflow-y-auto animate-fadeUp">
            <div className="flex items-center justify-between mb-5">
              <Logo />
              <IconButton label="Close" onClick={() => setOpen(false)}><X size={18} /></IconButton>
            </div>
            <div className="space-y-1">
              {[...NAV_DESKTOP, { path: '/audience', label: 'Target Audience', icon: LayoutGrid }, { path: '/learn', label: 'How it works', icon: BookOpen }, { path: '/settings', label: 'Settings', icon: SettingsIcon }].map((item: any) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => { setOpen(false); navigate(item.path); }}
                    className={cx('w-full flex items-center gap-3 rounded-xl px-3 h-11 text-[14px]', route.path.startsWith(item.path) ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line-soft')}
                  >
                    <Icon size={17} /> {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 pt-5 border-t border-line text-[12px] text-ink-faint leading-relaxed">
              {settings?.ai ? `Model: ${settings.ai.model}` : 'No AI provider connected'}
              <br />Everything is stored locally in this browser.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function BottomNav({ route }: { route: Route }) {
  const active = (p: string) => route.path === p || route.path.startsWith(`${p}/`);
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-line safe-b">
      <div className="grid grid-cols-5 h-[58px]">
        {NAV_MOBILE.map((item) => {
          const Icon = item.icon;
          const on = active(item.path);
          return (
            <button key={item.path} onClick={() => navigate(item.path)} className={cx('flex flex-col items-center justify-center gap-0.5', on ? 'text-ink' : 'text-ink-faint')}>
              <Icon size={19} strokeWidth={on ? 2.2 : 1.8} />
              <span className="text-[10.5px] font-medium">{item.label}</span>
            </button>
          );
        })}
        <button onClick={() => navigate('/settings')} className={cx('flex flex-col items-center justify-center gap-0.5', route.path.startsWith('/settings') ? 'text-ink' : 'text-ink-faint')}>
          <Menu size={19} strokeWidth={route.path.startsWith('/settings') ? 2.2 : 1.8} />
          <span className="text-[10.5px] font-medium">More</span>
        </button>
      </div>
    </nav>
  );
}

export function Page({ children, wide, title, sub, actions, badge }: { children: React.ReactNode; wide?: boolean; title?: string; sub?: string; actions?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0">
      <TopBar title={title} sub={sub} actions={actions} badge={badge} />
      <div className={cx('px-4 sm:px-6 lg:px-8 pb-28 lg:pb-14 pt-5 lg:pt-7 mx-auto w-full', wide ? 'max-w-[1180px]' : 'max-w-[1000px]')}>
        {title ? (
          <div className="lg:hidden mb-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[22px] font-semibold tracking-[-0.03em] leading-tight">{title}</h1>
                {badge ? <div className="mt-2">{badge}</div> : null}
              </div>
            </div>
            {sub ? <p className="sub mt-2">{sub}</p> : null}
            {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function TopBar({ title, sub, actions, badge }: { title?: string; sub?: string; actions?: React.ReactNode; badge?: React.ReactNode }) {
  const { running, progress } = useStore();
  if (!title) {
    return (
      <div className="hidden lg:flex items-center justify-between h-16 px-8 border-b border-line bg-canvas/70 backdrop-blur-sm sticky top-0 z-30">
        <div className="micro">Opportunity intelligence workspace</div>
        <div className="flex items-center gap-2">
          {running && progress ? <Tag tone="lilac">{progress.label}</Tag> : null}
          <ConnectionPill />
        </div>
      </div>
    );
  }
  return (
    <div className="hidden lg:flex items-start justify-between gap-6 px-8 pt-8 pb-5 border-b border-line">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="h1">{title}</h1>
          {badge}
        </div>
        {sub ? <p className="sub mt-2 max-w-2xl">{sub}</p> : null}
      </div>
      <div className="shrink-0 flex items-center gap-2 pt-1">{actions}</div>
    </div>
  );
}
