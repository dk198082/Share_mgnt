import { useMemo, useState } from 'react';
import { getListDirectoryUsersQueryKey, useListDirectoryUsers } from '@workspace/api-client-react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { errMsg } from '@/lib/format';
import { LoadError, Note, PanelHead } from './common';

export function UserDirectoryPanel() {
  const q = useListDirectoryUsers({ query: { queryKey: getListDirectoryUsersQueryKey(), staleTime: 0, refetchInterval: 60_000 } });
  const [search, setSearch] = useState('');
  const users = useMemo(() => (q.data ?? []).filter(u => u.source === 'microsoft_session'), [q.data]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter(u => !term || `${u.name} ${u.email ?? ''}`.toLowerCase().includes(term));
  }, [users, search]);
  return (
    <div className="space-y-6">
      <PanelHead n="01" title="Users" sub="A read-only directory of users with current Microsoft app sessions."
        actions={<Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-directory">
          <RefreshCw className={cn('mr-2 h-3.5 w-3.5', q.isFetching && 'animate-spin')} />Refresh
        </Button>} />
      <Note>
        <ul className="list-disc space-y-1 pl-4">
          <li>IT manages login access through Microsoft Entra ID. This is not the full company directory or a list of approved users.</li>
          <li>Microsoft entries appear while an app session remains valid; signing out or session expiry can remove an entry.</li>
          <li>Configure approvers, signatures and email notifications in <a className="underline underline-offset-2" href="?tab=signoffs">Sign-offs</a>.</li>
        </ul>
      </Note>
      <div className="relative max-w-sm">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search users by name or email" placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="input-search-directory" />
      </div>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ?
        <LoadError message={errMsg(q.error, 'The user directory could not be loaded.')} onRetry={() => q.refetch()} testId="error-directory" /> :
        <div className="overflow-x-auto rounded-lg border border-card-border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="table-user-directory">
            <caption className="sr-only">Users with current Microsoft app sessions</caption>
            <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-5 py-3 font-medium">Name</th><th className="px-5 py-3 font-medium">Email</th><th className="px-5 py-3 font-medium">Record source</th><th className="px-5 py-3 font-medium">Sign-off email match</th></tr>
            </thead>
            <tbody>{rows.map(u => <tr key={u.id} className="border-b border-border last:border-0">
              <td className="px-5 py-4 font-medium">{u.name}{u.isCurrent && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</td>
              <td className="px-5 py-4">{u.email || 'Not available'}</td>
              <td className="px-5 py-4 text-muted-foreground">Microsoft app session</td>
              <td className="px-5 py-4">{u.isSignoff ? 'Configured' : '—'}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">{search ? 'No users match your search.' : 'No user records are available.'}</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground" aria-live="polite">{rows.length} of {users.length} users</p>
        </div>}
    </div>
  );
}
