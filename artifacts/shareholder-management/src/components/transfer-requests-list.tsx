import { Link } from 'wouter';
import { useListTransferRequests, getListTransferRequestsQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { nf } from '@/lib/format';

export function TransferRequestsList({ shareholderId }: { shareholderId?: string }) {
  const filter = shareholderId ? { shareholderId } : undefined;
  const requests = useListTransferRequests(filter, { query: { queryKey: getListTransferRequestsQueryKey(filter), refetchInterval: 15000, staleTime: 15000, refetchOnWindowFocus: true } });
  return (
    <section className="mt-6 space-y-3" data-testid="transfer-requests-list">
      <h2 className="font-display text-lg">Transfer approval requests</h2>
      <p className="text-xs text-muted-foreground">Pending requests do not reserve shares. Every signer configured in Settings must approve before holdings change.</p>
      {requests.isLoading ? <p>Loading requests…</p> : requests.isError ? (
        <div role="alert">Could not load requests. <Button type="button" variant="outline" onClick={() => requests.refetch()}>Retry</Button></div>
      ) : requests.data?.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {requests.data.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <Link href={`/sign-off-requests/${r.id}`} className="text-accent underline" data-testid={`link-approval-${r.id}`}>
                  {r.input.sources?.map(s => `${s.certificateId} (${nf.format(s.quantity)})`).join('; ') || r.sourceCertificateId} · {nf.format(r.input.quantity)} {r.shareClass} shares
                </Link>
                <p className="text-xs text-muted-foreground">{r.originatorName} → {r.recipientName} · {r.input.transferDate}</p>
                <p className="text-xs text-muted-foreground">{r.approvals.length} of {r.requiredSigners.length} signers approved</p>
              </div>
              <span className="text-xs text-muted-foreground">{r.input.attachments?.length ? `${r.input.attachments.length} file${r.input.attachments.length === 1 ? '' : 's'} · ` : ''}{r.status}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No approval requests yet.</p>}
    </section>
  );
}
