import { useEffect, useState } from 'react';
import { useListShareholderHistory, getListShareholderHistoryQueryKey, type ShareholderHistoryEntry, type HistoryChange } from '@workspace/api-client-react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, History, Info, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { errMsg } from '@/lib/format';
import { CertificatePdfList } from '@/components/certificate-pdfs';

const tsFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const fmtTs = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : tsFmt.format(d); };

export function ShareholderHistory({ shareholderId, active }: { shareholderId: string; active: boolean }) {
  // Stack of cursors: [undefined] = newest page; each "Older" pushes the server's nextCursor.
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  useEffect(() => { setStack([undefined]); }, [shareholderId]);
  const before = stack[stack.length - 1];
  const params = before ? { before } : undefined;
  const q = useListShareholderHistory(shareholderId, params, {
    query: {
      enabled: !!shareholderId && active,
      queryKey: getListShareholderHistoryQueryKey(shareholderId, params),
      staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: active && stack.length === 1 ? 60_000 : false,
    },
  });
  const page = q.data;
  const pageNo = stack.length;

  function refresh() {
    if (stack.length > 1) setStack([undefined]);
    else q.refetch();
  }

  return (
    <div className="max-w-3xl">
      {active && <CertificatePdfList shareholderId={shareholderId} />}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Change history</h2>
          <p className="text-xs text-muted-foreground">Newest first. Recorded by the server on each save, issuance, and transfer step.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={q.isFetching} data-testid="button-refresh-history">
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', q.isFetching && 'animate-spin')} />Refresh
        </Button>
      </div>

      {page?.notice && (
        <div className="mb-4 flex gap-3 rounded-md border border-accent/30 bg-accent/5 p-3 text-sm" role="note" data-testid="text-history-notice">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p className="whitespace-pre-wrap break-words">{page.notice}</p>
        </div>
      )}

      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : q.isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8 text-center text-sm" role="alert">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="text-destructive">History couldn't be loaded. {errMsg(q.error)}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => q.refetch()} data-testid="button-retry-history"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
        </div>
      ) : !page || page.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center" data-testid="empty-history">
          <History className="h-6 w-6 text-muted-foreground" />
          <div className="font-display text-lg">{pageNo > 1 ? 'No older entries.' : 'No history recorded yet.'}</div>
          <p className="text-xs text-muted-foreground">Changes appear here after they are saved.</p>
        </div>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-5" data-testid="list-history">
          {page.entries.map((e) => <EntryRow key={e.id} e={e} />)}
        </ol>
      )}

      {(pageNo > 1 || page?.nextCursor) && (
        <nav className="mt-5 flex items-center justify-between gap-3 text-xs" aria-label="History pages">
          <Button type="button" variant="ghost" size="sm" disabled={pageNo === 1 || q.isFetching} onClick={() => setStack((s) => s.slice(0, -1))} data-testid="button-history-newer">
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />Newer
          </Button>
          <span className="text-muted-foreground tnum" data-testid="text-history-page">Page {pageNo}</span>
          <Button type="button" variant="ghost" size="sm" disabled={!page?.nextCursor || q.isFetching} onClick={() => page?.nextCursor && setStack((s) => [...s, page.nextCursor!])} data-testid="button-history-older">
            Older<ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </nav>
      )}
    </div>
  );
}

function EntryRow({ e }: { e: ShareholderHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const has = e.detailed && e.changes.length > 0;
  return (
    <li className="relative rounded-lg border border-card-border bg-card" data-testid={`row-history-${e.id}`}>
      <span className="absolute -left-[25px] top-5 h-2 w-2 rounded-full bg-accent ring-4 ring-background" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-medium" data-testid={`text-history-action-${e.id}`}>{e.action}</div>
          <div className="text-xs text-muted-foreground">by <span className="text-foreground" data-testid={`text-history-actor-${e.id}`}>{e.actorName || 'Unknown employee'}</span></div>
        </div>
        <time dateTime={e.createdAt} title={e.createdAt} className="text-xs text-muted-foreground tnum">{fmtTs(e.createdAt)}</time>
      </div>
      {!e.detailed ? (
        <p className="border-t border-border px-4 py-2 text-[11px] italic text-muted-foreground">Summary only. Field-level details were not recorded for this historical entry.</p>
      ) : has ? (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-1 border-t border-border px-4 py-2 text-xs text-accent hover:bg-secondary/40" data-testid={`button-history-expand-${e.id}`}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            {open ? 'Hide' : 'Show'} {e.changes.length} field {e.changes.length === 1 ? 'change' : 'changes'}
          </button>
          {open && <dl className="divide-y divide-border border-t border-border">{e.changes.map((c, i) => <ChangeRow key={`${c.field}-${i}`} c={c} />)}</dl>}
        </>
      ) : (
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">No field values changed.</p>
      )}
    </li>
  );
}

function Val({ v, prot }: { v: string | null; prot: boolean }) {
  if (v === null) return <span className="italic text-muted-foreground">Not set</span>;
  return <span className={cn('whitespace-pre-wrap break-words', prot && 'italic text-muted-foreground')}>{v}</span>;
}

function ChangeRow({ c }: { c: HistoryChange }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 text-xs sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {c.protected && <Lock className="h-3 w-3" aria-label="Protected field" />}{c.field}
      </dt>
      <dd className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start">
        <div className="min-w-0 rounded bg-destructive/5 px-2 py-1"><span className="sr-only">Before: </span><Val v={c.before} prot={c.protected} /></div>
        <ChevronRight className="hidden h-3.5 w-3.5 self-center text-muted-foreground sm:block" aria-hidden />
        <div className="min-w-0 rounded bg-primary/5 px-2 py-1"><span className="sr-only">After: </span>{c.after === null && c.before !== null ? <span className="italic text-muted-foreground">Removed</span> : <Val v={c.after} prot={c.protected} />}</div>
      </dd>
    </div>
  );
}
