import { useState } from 'react';
import { useListSettingsAudit, getListSettingsAuditQueryKey } from '@workspace/api-client-react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg } from '@/lib/format';
import { LoadError, Note, PanelHead } from './common';

const timestamp = (value: string) => new Date(value).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
});

export function SettingsAuditPanel() {
  const [cursors, setCursors] = useState<string[]>([]);
  const params = cursors.length ? { before: cursors[cursors.length - 1] } : undefined;
  const q = useListSettingsAudit(params, {
    query: { queryKey: getListSettingsAuditQueryKey(params), staleTime: 0, refetchInterval: 15000 },
  });
  return (
    <div className="space-y-6">
      <PanelHead n="04" title="Audit log" sub="Administrative changes, newest first. Employee names are captured at the time of each event."
        actions={<Button variant="outline" size="sm" onClick={() => { setCursors([]); q.refetch(); }} disabled={q.isFetching}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>} />
      <Note>Only changes recorded since audit logging was introduced appear here. Pending means the account service outcome is not confirmed; check current access before retrying. Before/after values for pending or failed entries describe the requested change, not a confirmed result. Signature images and private file links are never included.</Note>
      {q.isLoading ? <Skeleton className="h-60 w-full" /> : q.isError ?
        <LoadError message={errMsg(q.error, 'Audit log could not be loaded.')} onRetry={() => q.refetch()} testId="error-settings-audit" /> :
        !q.data?.entries.length ? <p className="text-sm text-muted-foreground" data-testid="empty-settings-audit">No administrative changes recorded.</p> :
        <div className="space-y-4" data-testid="settings-audit-entries">
          {q.data.entries.map(entry => (
            <article key={entry.id} className="rounded-lg border border-card-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-medium">{entry.action}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.actorName} · <time dateTime={entry.createdAt} title={entry.createdAt}>{timestamp(entry.createdAt)}</time></p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">Employee ID: {entry.actorId} · Target: {entry.targetId}</p>
                </div>
                <span className={`rounded border px-2 py-1 text-xs capitalize ${entry.outcome === 'failed' ? 'text-destructive' : entry.outcome === 'pending' ? 'text-accent' : 'text-muted-foreground'}`}>{entry.outcome}</span>
              </div>
              {entry.detail && <p className="mt-3 text-sm">{entry.detail}</p>}
              {entry.completedAt && <p className="mt-2 text-xs text-muted-foreground">Completed <time dateTime={entry.completedAt} title={entry.completedAt}>{timestamp(entry.completedAt)}</time></p>}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-2 pr-4">Field</th><th className="py-2 pr-4">Before</th><th className="py-2">After{entry.outcome !== 'succeeded' ? ' (requested)' : ''}</th></tr></thead>
                  <tbody>{entry.changes.map((c, i) => <tr key={i} className="border-t border-border"><td className="py-2 pr-4">{c.field}</td><td className="break-all py-2 pr-4">{c.before ?? '—'}</td><td className="break-all py-2">{c.after ?? '—'}</td></tr>)}</tbody>
                </table>
              </div>
            </article>
          ))}
        </div>}
      <div className="flex gap-2">
        {!!cursors.length && <Button variant="outline" size="sm" onClick={() => setCursors(prev => prev.slice(0, -1))}>Newer</Button>}
        {q.data?.nextCursor && <Button variant="outline" size="sm" onClick={() => setCursors(prev => [...prev, q.data!.nextCursor!])}>Older</Button>}
      </div>
    </div>
  );
}
