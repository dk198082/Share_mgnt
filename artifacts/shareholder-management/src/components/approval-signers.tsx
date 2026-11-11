import { Link } from 'wouter';
import { useListSignoffHistory, getListSignoffHistoryQueryKey, type TransferRequest } from '@workspace/api-client-react';
import { CheckCircle2, Circle, History, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SignatureImage } from '@/components/settings/signature-image';
import { StatusPill } from '@/components/attachments';
import { nf } from '@/lib/format';
import { LIVE, QUEUE_POLL, fmtDay } from '@/lib/registry-sync';

/** Short "2 of 3 approved" summary, never role-based. */
export const approvalTally = (r: TransferRequest) =>
  r.requiredSigners.length ? `${r.approvals.length} of ${r.requiredSigners.length} signers approved` : 'No signers captured yet';

export function SignerList({ r }: { r: TransferRequest }) {
  const voted = new Map(r.approvals.map((a) => [a.email.toLowerCase(), a]));
  return (
    <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-required-signers">
      {r.requiredSigners.map((s) => {
        const v = voted.get(s.email.toLowerCase()) ?? r.approvals.find((a) => a.id === s.id);
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`row-signer-${s.id}`}>
            {v ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name}</div>
              <div className="truncate text-xs text-muted-foreground">{s.email}</div>
              <div className="mt-0.5 text-xs" data-testid={`status-signer-${s.id}`}>
                {v ? <>Approved {new Date(v.approvedAt).toLocaleString()}{v.userId === r.requestedBy ? ' · self-approval by the requester' : ''}</> : r.status === 'Pending' ? <span className="text-muted-foreground">Pending</span> : <span className="text-muted-foreground">Did not approve</span>}
              </div>
            </div>
            {v && <SignatureImage path={v.signaturePath} className="h-12 w-36" testId={`img-approval-signature-${s.id}`} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Pending and past certificate issuances for one shareholder. Transfers are shown by TransferRequestsList. */
export function IssuanceRequests({ shareholderId }: { shareholderId: string }) {
  const params = { shareholderId };
  const q = useListSignoffHistory(params, { query: { queryKey: getListSignoffHistoryQueryKey(params), refetchInterval: QUEUE_POLL, ...LIVE } });
  const rows = (q.data ?? []).filter((r) => r.kind === 'Issuance');
  return (
    <section className="mt-6 space-y-3" data-testid="issuance-requests-list">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg">Certificate issuance requests</h2>
        {rows.some((r) => r.status === 'Pending') && <span className="text-xs text-accent" data-testid="text-pending-issuance-count">{rows.filter((r) => r.status === 'Pending').length} pending</span>}
      </div>
      <p className="text-xs text-muted-foreground">A new certificate is numbered and counted only after every configured signer approves.</p>
      {q.isLoading ? <Skeleton className="h-14 w-full" /> : q.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">Issuance requests could not be loaded.
          <Button type="button" variant="outline" size="sm" onClick={() => q.refetch()} data-testid="button-retry-issuances"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button></div>
      ) : rows.length ? (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <StatusPill status={r.status} />
              <div className="min-w-0 flex-1">
                <Link href={`/sign-off-requests/${r.id}`} className="text-accent hover:underline" data-testid={`link-issuance-${r.id}`}>
                  {nf.format(r.issuance?.quantity ?? r.input.quantity)} {r.issuance?.shareClass ?? r.shareClass} shares · issue {fmtDay(r.issuance?.issueDate ?? r.input.transferDate)}
                </Link>
                <p className="text-xs text-muted-foreground">{r.status === 'Completed' && r.recipientCertificateId ? <>Issued as <span className="font-mono">{r.recipientCertificateId}</span></> : approvalTally(r)}{r.legacyApprovals ? ' · has previous-workflow signatures' : ''}</p>
              </div>
              <span className="text-xs text-muted-foreground">{r.status}</span>
            </li>
          ))}
        </ul>
      ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><History className="h-3.5 w-3.5" />No issuance requests for this shareholder.</p>}
    </section>
  );
}
