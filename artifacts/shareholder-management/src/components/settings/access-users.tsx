import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAddAccessUser, useListAccessUsers, useRemoveAccessUser, getListAccessUsersQueryKey, type AccessUser } from '@workspace/api-client-react';
import { Loader2, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtDate, initials, relTime } from '@/lib/format';
import { LoadError, Note, PanelHead, ROLE_INFO, roleLabel } from './common';

type Filter = 'all' | 'Active' | 'Invited' | 'No access';
const STATUS_CLS: Record<string, string> = {
  Active: 'bg-[hsl(150_35%_92%)] text-[hsl(150_40%_26%)]',
  Invited: 'bg-accent/10 text-accent',
  'No access': 'bg-muted text-muted-foreground',
};

export function AccessUsersPanel() {
  const q = useListAccessUsers();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AccessUser | null>(null);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((u) => (filter === 'all' || u.status === filter) &&
      (!s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || roleLabel(u.role).toLowerCase().includes(s)));
  }, [q.data, search, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, Active: 0, Invited: 0, 'No access': 0 };
    (q.data ?? []).forEach((u) => { c.all++; c[u.status]++; });
    return c;
  }, [q.data]);

  return (
    <div className="space-y-6">
      <PanelHead n="01" title="User access" sub="Everyone with an account in this environment, plus pending invitations. Administrator is the only access role. Approval rights come from Settings, Sign-offs, not from a role."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-users"><RefreshCw className={cn('mr-2 h-3.5 w-3.5', q.isFetching && 'animate-spin')} />Refresh</Button>
          <Button size="sm" onClick={() => setAdding(true)} data-testid="button-add-user"><UserPlus className="mr-2 h-3.5 w-3.5" />Add user</Button>
        </>} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or role" className="pl-9" data-testid="input-search-users" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
          {(['all', 'Active', 'Invited', 'No access'] as Filter[]).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} data-testid={`filter-users-${f.replace(' ', '-').toLowerCase()}`}
              className={cn('rounded px-2.5 py-1 text-xs transition-colors', filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {f === 'all' ? 'All' : f} <span className="tnum opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : q.isError ? (
        <LoadError message={errMsg(q.error, 'The user list could not be loaded.')} onRetry={() => q.refetch()} testId="error-users" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-card-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="px-5 py-3 font-medium">Person</th><th className="px-3 py-3 font-medium">Role</th><th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Last sign-in</th><th className="px-5 py-3 text-right font-medium">Access</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-secondary/40" data-testid={`row-user-${u.id}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials(u.name || u.email) || '?'}</div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 truncate font-medium">{u.name || <span className="text-muted-foreground">No name</span>}
                            {u.isCurrent && <span className="rounded-sm bg-primary px-1.5 py-px text-[9px] uppercase tracking-wider text-primary-foreground">You</span>}</div>
                          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.role ? <Tooltip><TooltipTrigger asChild><span className="cursor-help border-b border-dotted border-muted-foreground/50">{roleLabel(u.role)}</span></TooltipTrigger>
                        <TooltipContent className="max-w-xs">{ROLE_INFO.admin.desc}</TooltipContent></Tooltip>
                        : <span className="text-muted-foreground">None</span>}
                    </td>
                    <td className="px-3 py-3"><span className={cn('rounded-full px-2 py-0.5 text-[11px]', STATUS_CLS[u.status])} data-testid={`status-user-${u.id}`}>{u.status}</span></td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{u.kind === 'invitation' ? `Invited ${fmtDate(u.createdAt)}` : u.lastSignInAt ? relTime(u.lastSignInAt) : 'Never'}</td>
                    <td className="px-5 py-3 text-right"><RemoveCell u={u} onRemove={() => setRemoving(u)} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-12 text-center">
                    <div className="font-display text-lg">{q.data?.length ? 'No one matches.' : 'No users yet.'}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{q.data?.length ? 'Try another search or filter.' : 'Add a user to grant access.'}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Note>Invitations are sent from this environment's sign-in system. Someone invited in development cannot sign in to the published app (and vice versa); invite them again in the environment they will use. People listed as "No access" have an account but no access; grant Administrator with Add user using their existing email.</Note>
      <AddUserDialog open={adding} onOpenChange={setAdding} />
      <RemoveDialog user={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

function RemoveCell({ u, onRemove }: { u: AccessUser; onRemove: () => void }) {
  if (u.status === 'No access') return <span className="text-[11px] text-muted-foreground">Grant via Add user</span>;
  const btn = (
    <Button variant="ghost" size="sm" onClick={onRemove} disabled={u.isCurrent} className="text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`button-remove-user-${u.id}`}>
      <X className="mr-1 h-3.5 w-3.5" />{u.kind === 'invitation' ? 'Revoke invite' : 'Remove access'}
    </Button>
  );
  if (!u.isCurrent) return btn;
  return <Tooltip><TooltipTrigger asChild><span tabIndex={0}>{btn}</span></TooltipTrigger><TooltipContent className="max-w-xs">You can't remove your own access. Ask another administrator.</TooltipContent></Tooltip>;
}

function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const add = useAddAccessUser();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const role = 'admin' as const;
  const [err, setErr] = useState('');
  const emailErr = email && !/^\S+@\S+\.\S+$/.test(email.trim()) ? 'Enter a valid email address.' : '';

  function close(o: boolean) {
    if (add.isPending) return;
    onOpenChange(o);
    if (!o) { setEmail(''); setName(''); setErr(''); }
  }
  function submit() {
    setErr('');
    if (!email.trim() || emailErr) { setErr(emailErr || 'Email is required.'); return; }
    add.mutate({ data: { email: email.trim(), role, ...(name.trim() ? { name: name.trim() } : {}) } }, {
      onSuccess: (u) => {
        qc.invalidateQueries({ queryKey: getListAccessUsersQueryKey() });
        toast({ title: u.kind === 'invitation' ? 'Invitation sent' : 'Access granted', description: `${u.email} · ${roleLabel(u.role)}` });
        close(false);
      },
      onError: (e) => setErr(errMsg(e, 'The user could not be added.')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Add user</DialogTitle>
          <DialogDescription>A new email receives a real sign-up invitation. An email that already has a verified account here is granted the role immediately.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="au-email" className="text-xs text-muted-foreground">Email <span className="text-accent">*</span></Label>
            <Input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoFocus data-testid="input-user-email" />
            {emailErr && <p className="text-xs text-destructive">{emailErr}</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="au-name" className="text-xs text-muted-foreground">Name (optional)</Label>
            <Input id="au-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="input-user-name" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Role</Label>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm" data-testid="text-user-role">Administrator</div>
            <p className="text-xs text-muted-foreground">{ROLE_INFO.admin.desc} Adding someone here does not make them a signer.</p></div>
          {err && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-add-user-error">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={add.isPending}>Cancel</Button>
            <Button type="submit" disabled={add.isPending} data-testid="button-submit-user">{add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ user, onClose }: { user: AccessUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const rm = useRemoveAccessUser();
  const [err, setErr] = useState('');
  const invite = user?.kind === 'invitation';
  function go() {
    if (!user) return;
    setErr('');
    rm.mutate({ id: user.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAccessUsersQueryKey() });
        toast({ title: invite ? 'Invitation revoked' : 'Access removed', description: user.email });
        onClose();
      },
      onError: (e) => setErr(errMsg(e, 'This change could not be made.')),
    });
  }
  return (
    <AlertDialog open={!!user} onOpenChange={(o) => { if (!o && !rm.isPending) { setErr(''); onClose(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl font-normal">{invite ? 'Revoke invitation?' : 'Remove app access?'}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p><span className="font-medium text-foreground">{user?.name || user?.email}</span> {user?.name && <>({user.email}) </>}
                {invite ? 'will no longer be able to accept this invitation.' : `loses the ${roleLabel(user?.role ?? null)} role and can no longer open the registry.`}</p>
              {!invite && <p>Their sign-in account and everything they recorded (edits, approvals, history) are kept. You can grant access again later with Add user.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {err && <p className="text-xs text-destructive" data-testid="text-remove-user-error">{err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={rm.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); go(); }} disabled={rm.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-remove-user">
            {rm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{invite ? 'Revoke invitation' : 'Remove access'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
