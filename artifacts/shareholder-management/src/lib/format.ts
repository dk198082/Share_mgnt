import type { Holding, Shareholder } from '@workspace/api-client-react';

export const nf = new Intl.NumberFormat('en-US');

export function totalShares(shares: Holding[] | undefined) {
  return (shares ?? []).reduce((a, h) => a + (Number(h.quantity) || 0), 0);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function fmtDate(d?: string) {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relTime(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(d);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const fileUrl = (objectPath: string) => `/api/storage${objectPath}`;

export const isDeceased = (s: Shareholder) => !!s.dateOfPassing;

export function errMsg(e: unknown, fallback = 'Something went wrong.') {
  if (!e) return fallback;
  const anyE = e as { data?: { error?: string; message?: string }; message?: string };
  return anyE.data?.error || anyE.data?.message || anyE.message || fallback;
}
