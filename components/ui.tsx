import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Info, Loader2, X } from 'lucide-react';
import { useStore } from '../store';
import { copyToClipboard } from '../core/export/exporters';
import { confidenceBand, scoreBand } from '../core/intelligence/scoringEngine';

/* ------------------------------- primitives ---------------------------- */

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function Card({ className, children, as: Tag = 'div', ...rest }: any) {
  return <Tag className={cx('card', className)} {...rest}>{children}</Tag>;
}

export function SectionTitle({ title, sub, action, icon }: { title: string; sub?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    // Stacks on phones: a wide action (a platform <select>, say) next to a
    // title needs a definite width to shrink into, otherwise its intrinsic
    // width pushes the card past the screen edge.
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4">
      <div className="flex items-start gap-3 min-w-0">
        {icon ? <div className="mt-0.5 text-ink-mute">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="h2">{title}</h2>
          {sub ? <p className="sub mt-1">{sub}</p> : null}
        </div>
      </div>
      {action ? <div className="w-full sm:w-auto sm:shrink-0">{action}</div> : null}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'accent' | 'quiet' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean };

/* Explicit maps, never `btn-${size}`: Tailwind v3 tree-shakes classes declared
   in @layer components by scanning the source for *literal* strings, so a
   template-literal class name is silently dropped from the compiled CSS and
   every button loses its height, padding and variant styling.
   scripts/check-css.mjs fails the build if this ever regresses. */
const BTN_SIZE: Record<NonNullable<BtnProps['size']>, string> = {
  sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg',
};
const BTN_VARIANT: Record<NonNullable<BtnProps['variant']>, string> = {
  primary: 'btn-primary', accent: 'btn-accent', quiet: 'btn-quiet',
  ghost: 'btn-ghost', danger: 'btn-danger',
};
/* Touch targets: 36px icon buttons are below the 44px Apple/mobile guidance,
   so every icon button gets at least 40px of hit area on small screens. */

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      className={cx('btn', BTN_SIZE[size], BTN_VARIANT[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: any) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        // 36px is the desktop size; at touch widths the hit area grows to 44px
        // without changing the icon size, so the header still reads as airy.
        'iconbtn h-9 w-9 inline-flex items-center justify-center rounded-full text-ink-mute hover:bg-line-soft hover:text-ink transition',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Tag({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'moss' | 'lilac' | 'sun' | 'rose' | 'ink'; children: React.ReactNode; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'bg-line-soft text-ink-mute',
    moss: 'bg-moss-100 text-moss-600',
    lilac: 'bg-lilac-100 text-lilac-600',
    sun: 'bg-sun-100 text-sun-600',
    rose: 'bg-rose-100 text-rose-600',
    ink: 'bg-ink text-white',
  };
  return <span className={cx('tag', tones[tone], className)}>{children}</span>;
}

export function Chip({ active, children, className, ...rest }: any) {
  return (
    <button type="button" className={cx('chip', active && 'chip-on', className)} {...rest}>
      {active ? <Check size={12} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      {label ? <span className="label">{label}</span> : null}
      {children}
      {hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}

export const Input = (p: any) => <input {...p} className={cx('field', p.className)} />;
export const Textarea = (p: any) => <textarea rows={p.rows ?? 4} {...p} className={cx('field resize-y', p.className)} />;
/* min-w-0 on the wrapper: as a flex child it defaults to min-width: auto, so a
   select whose longest <option> is wide ("Meta (Instagram + Facebook)") would
   force the whole row — and on a phone the whole page — past the screen edge.
   The select then shrinks and shows the label it can fit. */
export const Select = ({ children, ...p }: any) => (
  <div className="relative min-w-0">
    <select {...p} className={cx('field appearance-none pr-9', p.className)}>{children}</select>
    <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint" />
  </div>
);

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-start gap-3 text-left w-full">
      <span className={cx('mt-0.5 h-[22px] w-[38px] rounded-full transition-colors shrink-0', checked ? 'bg-moss-500' : 'bg-[#dcdce2]')}>
        <span className={cx('block h-[18px] w-[18px] mt-[2px] rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
      </span>
      {label ? (
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-ink">{label}</span>
          {hint ? <span className="block text-[12px] text-ink-faint mt-0.5">{hint}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-full bg-line-soft p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx('px-3.5 h-8 rounded-full text-[12.5px] font-medium transition', value === o.value ? 'bg-white text-ink shadow-card' : 'text-ink-mute hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone = 'ink' }: { label: string; value: React.ReactNode; sub?: string; tone?: 'ink' | 'moss' | 'lilac' | 'sun' }) {
  const toneClass = { ink: 'text-ink', moss: 'text-moss-600', lilac: 'text-lilac-600', sun: 'text-sun-600' }[tone];
  return (
    <div className="card pad">
      <div className="micro">{label}</div>
      <div className={cx('mt-2 text-[26px] font-semibold tracking-[-0.03em] tnum', toneClass)}>{value}</div>
      {sub ? <div className="text-[12px] text-ink-faint mt-1">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------- scores -------------------------------- */

export function ScoreBar({ value, tone = 'lilac', height = 6, label }: { value: number; tone?: 'lilac' | 'moss' | 'sun' | 'rose' | 'ink'; height?: number; label?: string }) {
  const bg = { lilac: 'bg-lilac-500', moss: 'bg-moss-500', sun: 'bg-sun-500', rose: 'bg-rose-500', ink: 'bg-ink' }[tone];
  return (
    <div>
      {label ? <div className="flex items-center justify-between text-[12px] text-ink-mute mb-1.5"><span>{label}</span><span className="tnum font-medium text-ink">{value.toFixed(0)}</span></div> : null}
      <div className="w-full rounded-full bg-line-soft overflow-hidden" style={{ height }}>
        <div className={cx('h-full rounded-full transition-[width] duration-500', bg)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function ScoreBadge({ score, insufficient, size = 'md' }: { score: number; insufficient?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const band = scoreBand(score);
  const tone = insufficient ? 'neutral' : score >= 80 ? 'moss' : score >= 70 ? 'lilac' : score >= 60 ? 'sun' : 'neutral';
  const sizes = { sm: 'text-[13px] px-2 py-0.5', md: 'text-[15px] px-2.5 py-1', lg: 'text-[22px] px-3 py-1' };
  return (
    <span className={cx('inline-flex items-baseline gap-1.5 rounded-xl font-semibold tnum', sizes[size], {
      neutral: 'bg-line-soft text-ink-mute', moss: 'bg-moss-100 text-moss-600', lilac: 'bg-lilac-100 text-lilac-600', sun: 'bg-sun-100 text-sun-600',
    }[tone])}>
      {score.toFixed(1)}
      <span className="text-[10.5px] font-medium opacity-70">{insufficient ? 'insufficient evidence' : band.label}</span>
    </span>
  );
}

export function ConfidenceMeter({ value, compact }: { value: number; compact?: boolean }) {
  const band = confidenceBand(value);
  const tone = value >= 75 ? 'moss' : value >= 60 ? 'sun' : value >= 40 ? 'sun' : 'rose';
  return (
    <div className={cx(!compact && 'space-y-1.5')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-mute">Evidence confidence</span>
        <span className="text-[12.5px] font-medium tnum text-ink">{value.toFixed(0)}%</span>
      </div>
      <ScoreBar value={value} tone={tone as any} height={5} />
      {!compact ? <div className="text-[11.5px] text-ink-faint">{band.label} — {band.detail}</div> : null}
    </div>
  );
}

export function Dial({ value, size = 76, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f4" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1d1d1f" strokeWidth={7} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[16px] font-semibold tnum">{value.toFixed(0)}</span>
        {label ? <span className="text-[9.5px] uppercase tracking-wide text-ink-faint">{label}</span> : null}
      </div>
    </div>
  );
}

/* ---------------------------- layout helpers --------------------------- */

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-line -mx-4 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx('tabbtn relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition', active === t.key ? 'text-ink' : 'text-ink-mute hover:text-ink')}
        >
          {t.label}
          {t.badge ? <span className="ml-1.5 text-[11px] text-ink-faint tnum">{t.badge}</span> : null}
          {active === t.key ? <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-ink" /> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, sub, children, footer, wide }: { open: boolean; onClose: () => void; title: string; sub?: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 animate-fadeIn">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('relative bg-white w-full rounded-t-xl3 sm:rounded-xl3 shadow-lift max-h-[92vh] flex flex-col animate-fadeUp', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-line">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h3>
            {sub ? <p className="sub mt-1">{sub}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto">{children}</div>
        {footer ? <div className="px-5 sm:px-6 py-4 border-t border-line flex flex-wrap items-center justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action, footer, tone = 'neutral' }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; footer?: React.ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <div className={cx('rounded-xl2 border border-dashed p-8 text-center', tone === 'warn' ? 'border-sun-500/40 bg-sun-50/60' : 'border-line bg-white/60')}>
      {icon ? <div className="flex justify-center text-ink-faint mb-3">{icon}</div> : null}
      <h3 className="h3">{title}</h3>
      {body ? <p className="sub mt-1.5 max-w-md mx-auto">{body}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      {footer ? <div className="mt-4 text-[11.5px] text-ink-faint">{footer}</div> : null}
    </div>
  );
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'moss' | 'lilac'; title?: string; children: React.ReactNode }) {
  const tones = {
    info: 'bg-canvas border-line text-ink-soft',
    warn: 'bg-sun-50 border-sun-500/25 text-sun-600',
    moss: 'bg-moss-50 border-moss-500/25 text-moss-600',
    lilac: 'bg-lilac-50 border-lilac-500/20 text-lilac-600',
  }[tone];
  return (
    <div className={cx('rounded-xl2 border p-4 text-[13px] leading-relaxed', tones)}>
      {title ? <div className="font-semibold mb-1 flex items-center gap-1.5"><Info size={13} />{title}</div> : null}
      <div className="[&_a]:underline">{children}</div>
    </div>
  );
}

export function KeyValue({ rows, cols = 2 }: { rows: { label: string; value: React.ReactNode }[]; cols?: number }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : cols === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1')}>
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-[11.5px] uppercase tracking-[0.06em] text-ink-faint">{r.label}</dt>
          <dd className="text-[13.5px] text-ink mt-1 break-words">{r.value || <span className="text-ink-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyBlock({ text, label, maxHeight = 320 }: { text: string; label?: string; maxHeight?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl2 border border-line bg-canvas overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-line bg-white">
        <span className="text-[12px] font-medium text-ink-mute">{label ?? 'Copy'}</span>
        <button
          className="linkbtn no-underline gap-1.5 text-[12px] text-ink-mute hover:text-ink"
          onClick={async () => { if (await copyToClipboard(text)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-ink-soft overflow-auto" style={{ maxHeight }}>{text}</pre>
    </div>
  );
}

/* ------------------------------ markdown ------------------------------- */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function MarkdownView({ md, className }: { md: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(md || ''), [md]);
  return <div className={cx('prose-ct', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  lines.forEach((line) => {
    const t = line.trim();
    if (!t) { closeLists(); return; }
    if (/^#{3,}\s/.test(t)) { closeLists(); out.push(`<h4>${fmt(t.replace(/^#{3,}\s/, ''))}</h4>`); return; }
    if (/^##\s/.test(t)) { closeLists(); out.push(`<h3>${fmt(t.replace(/^##\s/, ''))}</h3>`); return; }
    if (/^#\s/.test(t)) { closeLists(); out.push(`<h3>${fmt(t.replace(/^#\s/, ''))}</h3>`); return; }
    if (/^[-*•]\s/.test(t)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${fmt(t.replace(/^[-*•]\s/, ''))}</li>`);
      return;
    }
    if (/^\d+[.)]\s/.test(t)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${fmt(t.replace(/^\d+[.)]\s/, ''))}</li>`);
      return;
    }
    if (/^>\s?/.test(t)) { closeLists(); out.push(`<blockquote>${fmt(t.replace(/^>\s?/, ''))}</blockquote>`); return; }
    if (/^---+$/.test(t)) { closeLists(); out.push('<hr class="my-5 border-line" />'); return; }
    closeLists();
    out.push(`<p>${fmt(t)}</p>`);
  });
  closeLists();
  return out.join('\n');
}

const fmt = (s: string) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|\s)\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
  .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-line-soft text-[12.5px]">$1</code>');

/* -------------------------------- toasts ------------------------------- */

export function ToastHost() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="fixed z-[60] bottom-20 sm:bottom-6 right-4 left-4 sm:left-auto sm:right-6 sm:w-[380px] space-y-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx('pointer-events-auto rounded-xl2 border p-3.5 shadow-lift animate-fadeUp bg-white',
            t.tone === 'error' ? 'border-rose-500/30' : t.tone === 'warn' ? 'border-sun-500/30' : t.tone === 'success' ? 'border-moss-500/30' : 'border-line')}
        >
          <div className="flex items-start gap-3">
            <div className={cx('mt-1 h-1.5 w-1.5 rounded-full shrink-0',
              t.tone === 'error' ? 'bg-rose-500' : t.tone === 'warn' ? 'bg-sun-500' : t.tone === 'success' ? 'bg-moss-500' : 'bg-ink')} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-ink">{t.title}</div>
              {t.body ? <div className="text-[12.5px] text-ink-mute mt-0.5 leading-snug break-words">{t.body}</div> : null}
            </div>
            <button className="text-ink-faint hover:text-ink" onClick={() => dismiss(t.id)}><X size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ pipeline ------------------------------- */

export function PipelineProgress({ progress }: { progress: { label: string; detail?: string; pct: number } }) {
  return (
    <div className="rounded-xl2 border border-line bg-white p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Loader2 size={16} className="animate-spin text-lilac-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">{progress.label}</div>
          {progress.detail ? <div className="text-[12.5px] text-ink-mute mt-0.5 truncate">{progress.detail}</div> : null}
        </div>
        <div className="text-[12.5px] tnum text-ink-faint">{Math.round(progress.pct)}%</div>
      </div>
      <div className="mt-3.5 h-1.5 rounded-full bg-line-soft overflow-hidden">
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.max(3, progress.pct)}%` }} />
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function useScrollTop(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [dep]);
  return ref;
}
