/* Local export utilities: JSON, CSV and clipboard. Nothing leaves the device. */
import { exportAll, nowISO } from '../db/database';

export function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toCSV(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join(' | ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function exportCSV(name: string, rows: Record<string, any>[], columns?: string[]) {
  download(`${name}-${nowISO().slice(0, 10)}.csv`, toCSV(rows, columns), 'text/csv');
}

export function exportJSON(name: string, data: unknown) {
  download(`${name}-${nowISO().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export async function exportWorkspace() {
  const data = await exportAll();
  exportJSON('creatortools-workspace', data);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

export const markdownToPlain = (md: string) => (md || '')
  .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''))
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/[*_`]/g, '');
