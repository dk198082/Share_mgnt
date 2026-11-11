import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListSignoffs, useRemoveSignoff, useUpdateSignoff, getListSignoffsQueryKey, type Signoff } from '@workspace/api-client-react';
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fmtDate } from '@/lib/format';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadError, Note, PanelHead } from './common';
import { SignatureImage } from './signature-image';
import { SignoffDialog } from './signoff-dialog';

export function SignoffsPanel() {
  const q = useListSignoffs();
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateSignoff();
  const [dlg, setDlg] = useState<{ open: boolean; editing: Signoff | null }>({ open: false, editing: null });
  const [del, setDel] = useState<Signoff | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const toggleEmails = (signer: Signoff, enabled: boolean) => {
    setSavingId(signer.id);
    update.mutate({ id: signer.id, data: {
      name: signer.name, email: signer.email, signaturePath: signer.signaturePath,
      emailNotificationsEnabled: enabled,
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSignoffsQueryKey() });
        toast({ title: enabled ? 'Email notifications enabled' : 'Email notifications disabled', description: signer.name });
      },
      onError: error => {
        qc.invalidateQueries({ queryKey: getListSignoffsQueryKey() });
        toast({ title: 'Notification setting not saved', description: errMsg(error, 'Refresh and try again.'), variant: 'destructive' });
      },
      onSettled: () => setSavingId(current => current === signer.id ? null : current),
    });
  };

  return (
    <div className="space-y-6">
      <PanelHead n="03" title="Sign-offs" sub="The named signers who must all approve every share transfer and every new certificate issuance."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-signoffs"><RefreshCw className={cn('mr-2 h-3.5 w-3.5', q.isFetching && 'animate-spin')} />Refresh</Button>
          <Button size="sm" onClick={() => setDlg({ open: true, editing: null })} data-testid="button-add-signoff"><Plus className="mr-2 h-3.5 w-3.5" />Add sign-off</Button>
        </>} />
      <Note tone="warn">
        <p>Every signer listed here must approve each transfer request and each new certificate issuance before anything changes on the ledger. A submitter who is also a listed signer may approve their own request.</p>
        <p className="mt-1.5">To approve, a signer must sign in with their own Microsoft account whose tenant sign-in address matches the email here. All signed-in tenant users have the same app access; a digital signature image on its own is not an approval.</p>
        <p className="mt-1.5">Use each signer’s checkbox to control approval-request emails. Turning emails off does not remove that person’s required approval. New requests capture the email settings; requests already pending keep the settings recorded when submitted.</p>
      </Note>
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        : q.isError ? <LoadError message={errMsg(q.error, 'Sign-offs could not be loaded.')} onRetry={() => q.refetch()} testId="error-signoffs" />
        : !q.data?.length ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <div className="font-display text-xl">No sign-offs recorded.</div>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add a signatory with their name, email and an image of their signature.</p>
            <Button className="mt-5" size="sm" onClick={() => setDlg({ open: true, editing: null })} data-testid="button-add-signoff-empty"><Plus className="mr-2 h-3.5 w-3.5" />Add sign-off</Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-card-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Name</th><th className="px-3 py-3 font-medium">Email</th><th className="px-3 py-3 font-medium">Approval emails</th><th className="px-3 py-3 font-medium">Digital signature</th><th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {q.data.map((s) => (
                    <tr key={s.id} className="hover:bg-secondary/40" data-testid={`row-signoff-${s.id}`}>
                      <td className="px-5 py-3"><div className="font-medium">{s.name}</div><div className="text-[11px] text-muted-foreground">Updated {fmtDate(s.updatedAt)}</div></td>
                      <td className="px-3 py-3 text-muted-foreground">{s.email}</td>
                      <td className="px-3 py-3">
                        <label htmlFor={`signoff-email-${s.id}`} className="flex items-center gap-2">
                          <Checkbox id={`signoff-email-${s.id}`} checked={s.emailNotificationsEnabled}
                            onCheckedChange={checked => toggleEmails(s, checked === true)}
                            disabled={savingId === s.id || update.isPending} aria-label={`Email approval requests to ${s.name}`}
                            data-testid={`checkbox-signoff-email-${s.id}`} />
                          <span className="text-xs">{s.emailNotificationsEnabled ? 'On' : 'Off'}</span>
                        </label>
                      </td>
                      <td className="px-3 py-3"><SignatureImage path={s.signaturePath} className="h-14 w-40" testId={`img-signature-${s.id}`} /></td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDlg({ open: true, editing: s })} aria-label="Edit sign-off" data-testid={`button-edit-signoff-${s.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDel(s)} aria-label="Remove sign-off" data-testid={`button-remove-signoff-${s.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      <SignoffDialog open={dlg.open} editing={dlg.editing} onClose={() => setDlg({ open: false, editing: null })} />
      <DeleteSignoff s={del} onClose={() => setDel(null)} />
    </div>
  );
}

function DeleteSignoff({ s, onClose }: { s: Signoff | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const rm = useRemoveSignoff();
  const [err, setErr] = useState('');
  return (
    <AlertDialog open={!!s} onOpenChange={(o) => { if (!o && !rm.isPending) { setErr(''); onClose(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl font-normal">Remove sign-off?</AlertDialogTitle>
          <AlertDialogDescription>{s?.name} ({s?.email}) and their signature will be removed from this list. New requests will no longer require them; requests already pending keep their captured signer list.</AlertDialogDescription>
        </AlertDialogHeader>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={rm.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={rm.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-remove-signoff"
            onClick={(e) => { e.preventDefault(); if (!s) return; setErr(''); rm.mutate({ id: s.id }, {
              onSuccess: () => { qc.invalidateQueries({ queryKey: getListSignoffsQueryKey() }); toast({ title: 'Sign-off removed', description: s.name }); setErr(''); onClose(); },
              onError: (x) => setErr(errMsg(x, 'The sign-off could not be removed.')),
            }); }}>
            {rm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
