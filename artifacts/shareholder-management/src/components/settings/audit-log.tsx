import { useState } from 'react';
import { useListSettingsAudit, getListSettingsAuditQueryKey } from '@workspace/api-client-react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg } from '@/lib/format';
import { LoadError, Note, PanelHead } from './common';

const timestamp = (value: string) => new Date(value).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
});

const categories = [
  { value: 'all', label: 'All activity' },
  { value: 'administration', label: 'Administration' },
  { value: 'shareholders', label: 'Shareholder changes' },
  { value: 'issuance', label: 'Certificate issuance' },
  { value: 'transfers', label: 'Transfers' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'documents', label: 'Documents' },
] as const;
type Category = typeof categories[number]['value'];

export function SettingsAuditPanel() {
  const [cursors, setCursors] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeError = from && to && from > to ? 'From date must be on or before To date.' : '';
  const params = { category, ...(search ? { search } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(cursors.length ? { before: cursors[cursors.length - 1] } : {}) };
  const q = useListSettingsAudit(params, {
    query: { queryKey: getListSettingsAuditQueryKey(params), enabled: !rangeError, staleTime: 0, refetchInterval: 15000 },
  });
  return (
    <div className="space-y-6">
      <PanelHead n="05" title="Audit log" sub="Company-wide activity, newest first. Expand an entry to see exactly what changed."
        actions={<Button variant="outline" size="sm" onClick={() => { if (cursors.length) setCursors([]); else q.refetch(); }} disabled={q.isFetching || !!rangeError}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>} />
      <Note>Administrative changes and recorded shareholder activity appear together here. The same events remain in Shareholder History and Transfer History. A transfer can have separate entries for the sender and recipient. Older entries may contain summaries only. “Recorded” confirms the history entry—not that a pending issuance or transfer has completed. Protected values and private file links are not exposed.</Note>
      <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={event => { event.preventDefault(); if (rangeError) return; setSearch(searchInput.trim()); setCursors([]); }}>
        <div className="sm:w-56">
          <label htmlFor="audit-category" className="mb-1.5 block text-xs font-medium">Activity type</label>
          <select id="audit-category" value={category} onChange={event => { setCategory(event.target.value as Category); setCursors([]); }}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-audit-category">
            {categories.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="sm:w-40">
          <label htmlFor="audit-from" className="mb-1.5 block text-xs font-medium">From date (UTC)</label>
          <Input id="audit-from" type="date" min="0001-01-01" max="9999-12-31" value={from} onChange={event => { setFrom(event.target.value); setCursors([]); }} aria-describedby="audit-date-help" aria-invalid={!!rangeError} data-testid="input-audit-from" />
        </div>
        <div className="sm:w-40">
          <label htmlFor="audit-to" className="mb-1.5 block text-xs font-medium">To date (UTC)</label>
          <Input id="audit-to" type="date" min="0001-01-01" max="9999-12-31" value={to} onChange={event => { setTo(event.target.value); setCursors([]); }} aria-describedby="audit-date-help" aria-invalid={!!rangeError} data-testid="input-audit-to" />
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="audit-search" className="mb-1.5 block text-xs font-medium">Search activity</label>
          <Input id="audit-search" type="search" maxLength={200} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Shareholder, employee, certificate, or action…" data-testid="input-audit-search" />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!!rangeError}>Search</Button>
        {(category !== 'all' || search || searchInput || from || to) && <Button type="button" variant="ghost" size="sm" onClick={() => { setCategory('all'); setSearch(''); setSearchInput(''); setFrom(''); setTo(''); setCursors([]); }}>Clear filters</Button>}
      </form>
      <p id="audit-date-help" className="text-xs text-muted-foreground">Dates filter when activity was recorded, in UTC. Both days are included; leave either date blank for no limit. Times below are shown in UTC.</p>
      {search && <p className="text-xs text-muted-foreground" role="status">Results matching “{search}”</p>}
      {rangeError ? <p className="text-sm text-destructive" role="alert">{rangeError}</p> : q.isLoading ? <Skeleton className="h-60 w-full" /> : q.isError ?
        <LoadError message={errMsg(q.error, 'Audit log could not be loaded.')} onRetry={() => q.refetch()} testId="error-settings-audit" /> :
        !q.data?.entries.length ? <p className="text-sm text-muted-foreground" data-testid="empty-settings-audit">{search || category !== 'all' || from || to ? 'No activity matches these filters.' : 'No activity recorded.'}</p> :
        <div className="space-y-3" data-testid="settings-audit-entries">
          {q.data.entries.map(entry => {
            const identity = entry.changes.find(c => c.field === 'Name') ?? entry.changes.find(c => c.field === 'Email');
            const subject = entry.shareholderName || (identity ? identity.after || identity.before : null);
            const changeCount = entry.changes.length;
            return (
            <details key={entry.id} className="group rounded-lg border border-card-border bg-card" data-testid={`settings-audit-entry-${entry.id}`}>
              <summary className="flex cursor-pointer list-none items-start gap-3 rounded-lg p-4 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronDown aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
                <div className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{entry.action}{subject ? ` · ${subject}` : ''}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {entry.actorName} · <time dateTime={entry.createdAt} title={entry.createdAt}>{timestamp(entry.createdAt)}</time>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {categories.find(option => option.value === entry.category)?.label ?? 'Administration'} · {entry.detailed === false ? 'Historical summary' : changeCount ? `${changeCount} ${changeCount === 1 ? 'field' : 'fields'}${entry.outcome === 'succeeded' ? ' changed' : ' in requested change'}` : 'Event details'}
                    <span aria-hidden="true"> · <span className="group-open:hidden">View details</span><span className="hidden group-open:inline">Hide details</span></span>
                  </span>
                </div>
                <span className={`shrink-0 rounded border px-2 py-1 text-xs ${entry.outcome === 'failed' ? 'text-destructive' : entry.outcome === 'pending' ? 'text-accent' : 'text-muted-foreground'}`}>
                  {entry.outcome === 'succeeded' ? entry.source === 'shareholder' ? 'Recorded' : 'Completed' : entry.outcome === 'pending' ? 'Pending' : 'Failed'}
                </span>
              </summary>
              <div className="border-t border-border px-4 pb-4 pt-3 sm:px-6">
              {entry.outcome !== 'succeeded' && <p className="mb-3 text-sm text-muted-foreground">{entry.outcome === 'pending' ? 'This change is not yet confirmed. Check current access before retrying.' : 'This attempt failed. The values below show the requested change, not a confirmed result.'}</p>}
              {entry.detail && <p className="mb-3 break-words text-sm">{entry.detail}</p>}
              {entry.shareholderId && <p className="mb-3 text-sm"><Link href={`/shareholders/${encodeURIComponent(entry.shareholderId)}`} className="text-accent underline underline-offset-4">Open shareholder record</Link></p>}
              {entry.detailed === false ? <p className="text-sm italic text-muted-foreground">Summary only. Field-level details were not recorded for this historical entry.</p> : !changeCount ? <p className="text-sm text-muted-foreground">No field-level changes were recorded for this event.</p> :
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Field changes for {entry.action}</caption>
                  <thead className="text-xs text-muted-foreground"><tr><th className="py-2 pr-4">Field</th><th className="py-2 pr-4">Before</th><th className="py-2">After{entry.outcome !== 'succeeded' ? ' (requested)' : ''}</th></tr></thead>
                  <tbody>{entry.changes.map((c, i) => <tr key={i} className="border-t border-border"><td className="py-2 pr-4">{c.field}</td><td className="break-all py-2 pr-4">{c.before ?? '—'}</td><td className="break-all py-2">{c.after ?? '—'}</td></tr>)}</tbody>
                </table>
              </div>}
              <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <p className="break-all">Employee ID: {entry.actorId}</p>
                <p className="break-all">Target ID: {entry.targetId}</p>
                {entry.completedAt && <p>Completed <time dateTime={entry.completedAt} title={entry.completedAt}>{timestamp(entry.completedAt)}</time></p>}
              </div>
              </div>
            </details>
          );})}
        </div>}
      <div className="flex gap-2">
        {!!cursors.length && <Button variant="outline" size="sm" disabled={q.isFetching || !!rangeError} onClick={() => setCursors(prev => prev.slice(0, -1))}>Newer</Button>}
        {q.data?.nextCursor && !rangeError && !q.isError && <Button variant="outline" size="sm" disabled={q.isFetching} onClick={() => setCursors(prev => [...prev, q.data!.nextCursor!])}>Older</Button>}
      </div>
    </div>
  );
}
