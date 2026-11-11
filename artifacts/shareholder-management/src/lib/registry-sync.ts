import type { QueryClient } from '@tanstack/react-query';

/** Query-path prefixes whose data depends on transfers, requests, or certificate ownership. */
const PREFIXES = [
  '/api/transfers',
  '/api/transfer-requests',
  '/api/sign-off-requests',
  '/api/sign-off-history',
  '/api/certificates',
  '/api/shareholders',
  '/api/summary',
  '/api/activity',
];

export function refreshRegistry(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === 'string' && (PREFIXES.some((p) => k.startsWith(p)) || k.includes('/history'));
    },
  });
}

/** Finite freshness for registry-wide lists: refetch on focus, considered fresh for 20s. */
export const LIVE = { staleTime: 20_000, refetchOnWindowFocus: true } as const;
export const QUEUE_POLL = 15_000;

export const fmtDay = (d: string | null | undefined) => {
  if (!d) return 'Not recorded';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
