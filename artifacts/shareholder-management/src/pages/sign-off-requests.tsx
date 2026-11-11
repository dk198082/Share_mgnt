import { CertificatePdfList } from '@/components/certificate-pdfs';
import { useState } from 'react';
import { sourceLabel } from '@/lib/transfer-sources';
import { Link, useRoute } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTransferRequest, useDecideTransferRequest, useAttachRequestFiles, useListMySignoffRequests,
  getGetTransferRequestQueryKey, getListMySignoffRequestsQueryKey,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Paperclip, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { AppendAttachments, AttachmentList, StatusPill } from '@/components/attachments';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg, nf } from '@/lib/format';
import { approvalTally, SignerList } from '@/components/approval-signers';
import { LIVE, QUEUE_POLL, fmtDay, refreshRegistry } from '@/lib/registry-sync';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function SignOffRequests() {
  const [, a] = useRoute('/sign-off-requests/:requestId');
  const [, b] = useRoute('/transfer-requests/:requestId');
  const id = a?.requestId ?? b?.requestId;
  return id ? <RequestDetail key={id} id={id} /> : <MyQueue />;
}

function MyQueue() {
  const q = useListMySignoffRequests({ query: { queryKey: getListMySignoffRequestsQueryKey(), refetchInterval: QUEUE_POLL, ...LIVE } });
  return (
    <div>
      <PageHeader eyebrow="Your queue" title="Sign off requests" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-10">
        <p className="text-sm text-muted-foreground">Pending transfers and certificate issuances that list your verified sign-in email as a required signer and still need your approval. Requests you submitted are included when you are a listed signer. Refreshes every 15 seconds.</p>
        {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        : q.isError ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8 text-sm">
            <AlertCircle className="h-5 w-5 text-destructive" /><span className="text-destructive">{errMsg(q.error, 'Your queue could not be loaded.')}</span>
            <Button variant="outline" size="sm" onClick={() => q.refetch()} data-testid="button-retry-queue"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
          </div>
        ) : !q.data?.length ? (
          <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground" data-testid="text-queue-empty">
            Nothing is waiting on you.
            <p className="mt-1 text-xs">Only signers named in <Link href="/settings" className="text-accent hover:underline">Settings, Sign-offs</Link> receive requests here. Track all transfers in <Link href="/transfers" className="text-accent hover:underline">Transfer history</Link>.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card" data-testid="list-my-signoffs">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link href={`/sign-off-requests/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-secondary/40" data-testid={`link-signoff-${r.id}`}>
                  <span className="rounded-sm bg-primary/10 px-1.5 py-px text-[10px] uppercase tracking-[0.12em] text-primary">{r.kind}</span>
                  <div className="min-w-0 flex-1">
                    {r.kind === 'Issuance' ? <>
                      <div>New certificate · {nf.format(r.issuance?.quantity ?? r.input.quantity)} {r.issuance?.shareClass ?? r.shareClass}</div>
                      <div className="truncate text-xs text-muted-foreground">For {r.recipientName || r.originatorName} · issue {fmtDay(r.issuance?.issueDate ?? r.input.transferDate)}</div>
                    </> : <>
                      <div><span className="font-mono">{sourceLabel(r.sourceCertificateId, r.input.sources)}</span> · {nf.format(r.input.quantity)} {r.shareClass}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.originatorName} to {r.recipientName} · {fmtDay(r.input.transferDate)}</div>
                    </>}
                  </div>
                  {r.kind === 'Transfer' && (r.input.attachments?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="h-3 w-3" />{r.input.attachments?.length}</span>}
                  <span className="text-xs text-muted-foreground">{approvalTally(r)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const request = useGetTransferRequest(id, { query: { queryKey: getGetTransferRequestQueryKey(id), refetchInterval: QUEUE_POLL, ...LIVE } });
  const decide = useDecideTransferRequest();
  const attach = useAttachRequestFiles();
  const [message, setMessage] = useState('');
  const [attachErr, setAttachErr] = useState('');
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const [copied, setCopied] = useState(false);

  const kindLabel = request.data?.kind === 'Issuance' ? 'Certificate issuance' : 'Transfer request';
  const header = <PageHeader eyebrow={kindLabel} title="Sign off request" />;
  if (request.isLoading) return <div>{header}<div className="mx-auto max-w-3xl px-4 py-6 md:px-10"><Skeleton className="h-72 w-full" /></div></div>;
  if (request.isError || !request.data) return (
    <div>{header}<div role="alert" className="mx-auto mt-6 flex max-w-3xl flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-8 text-sm">
      <span className="text-destructive">{errMsg(request.error, 'Could not load request.')}</span>
      <Button variant="outline" size="sm" onClick={() => request.refetch()} data-testid="button-retry-request">Retry</Button>
    </div></div>
  );
  const r = request.data;
  const issuance = r.kind === 'Issuance';
  const pending = r.status === 'Pending';
  const isRequester = r.requestedBy === user?.id;
  const historicSigned = !!(r.ceoApprovedAt || r.cfoApprovedAt);
  const mayAttach = !issuance && pending && r.approvals.length === 0 && !historicSigned;
  const files = r.input.attachments ?? [];
  const approvalUrl = `${window.location.origin}${basePath}/sign-off-requests/${encodeURIComponent(id)}`;
  const noSigners = r.requiredSigners.length === 0;
  const myVote = r.approvals.find((a) => a.userId === user?.id);
  const remaining = r.requiredSigners.length - r.approvals.length;

  function submit() {
    if (!confirm || decide.isPending || !pending || !(confirm === 'approve' ? r.canApprove : r.canReject)) return;
    setDecisionError('');
    decide.mutate({ requestId: id, data: { decision: confirm } }, {
      onSuccess: (updated) => { setConfirm(null); qc.setQueryData(getGetTransferRequestQueryKey(id), updated); refreshRegistry(qc); },
      onError: (error) => {
        const stale = (error as { status?: number } | null)?.status === 409;
        setDecisionError(stale ? errMsg(error, 'The ledger changed and this request can no longer be executed as submitted. Your approval was not recorded. You can reject it, or reload and retry.') : errMsg(error, 'Decision could not be saved. Retrying is safe.'));
        request.refetch(); refreshRegistry(qc);
      },
    });
  }

  const fields: [string, string][] = issuance ? [
    ['Beneficiary', r.recipientName || r.originatorName], ['Share class', r.issuance?.shareClass ?? r.shareClass],
    ['Quantity', nf.format(r.issuance?.quantity ?? r.input.quantity)], ['Issue date', fmtDay(r.issuance?.issueDate ?? r.input.transferDate)],
    ['Vesting', r.issuance?.vestingSchedule ?? r.vestingSchedule],
    ['Requested by', r.requestedBy], ['Requested at', new Date(r.createdAt).toLocaleString()],
  ] : [
    ['Source certificates', `${sourceLabel(r.sourceCertificateId, r.input.sources)} (${r.shareClass})`],
    ['From', r.originatorName], ['To', r.recipientName + (r.input.newRecipient ? ' (new recipient)' : '')],
    ['Quantity', nf.format(r.input.quantity)], ['Transfer date', fmtDay(r.input.transferDate)],
    ['Vesting', r.vestingSchedule], ['Reason', r.input.reason || 'Not recorded'],
    ['Price per share', r.input.pricePerShare ?? 'Not recorded'],
    ['Requested by', r.requestedBy], ['Requested at', new Date(r.createdAt).toLocaleString()],
  ];
  const statusText = pending
    ? (issuance ? 'No certificate has been issued or numbered, and no balances have changed.' : 'No shares have moved. No certificate number has been allocated. Shares are not reserved; availability is checked again on final approval.')
    : r.status === 'Completed'
      ? (issuance ? 'All required signers approved. The certificate was issued and the ledger updated.' : 'All required signers approved. Holdings and certificate history were updated atomically.')
      : `Rejected. This request did not change holdings or allocate a certificate.`;

  return (
    <div>
      {header}
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-10">
        <Link href="/sign-off-requests" className="inline-flex items-center gap-1 text-sm text-accent hover:underline" data-testid="link-back-requests"><ArrowLeft className="h-3.5 w-3.5" />My sign off requests</Link>
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2" data-testid="approval-status"><StatusPill status={r.status} /><span className="text-xs text-muted-foreground">{r.status} · {kindLabel}</span></div>
          <p className="mt-3 text-sm">{statusText}</p>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
          </dl>
          {r.rejectedAt && <p className="mt-4 text-sm">Rejected by {r.rejectedBy} · {new Date(r.rejectedAt).toLocaleString()}</p>}
          {r.recipientCertificateId && <p className="mt-4 text-sm">{issuance ? 'Issued certificate' : 'New certificate'}: <strong className="font-mono" data-testid="approved-certificate-id">{r.recipientCertificateId}</strong></p>}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {issuance ? <Link href={`/shareholders/${r.recipientId ?? r.originatorId}`} className="text-accent hover:underline">Shareholder record</Link> : <>
              <Link href={`/shareholders/${r.originatorId}`} className="text-accent hover:underline">Source shareholder record</Link>
              {r.recipientId && <Link href={`/shareholders/${r.recipientId}`} className="text-accent hover:underline">Recipient shareholder record</Link>}
              {r.completedTransferId && <Link href={`/transfers/${r.completedTransferId}`} className="text-accent hover:underline" data-testid="link-completed-transfer">Executed transfer</Link>}
            </>}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Required signers</h2>
            <span className="text-xs text-muted-foreground" data-testid="text-approval-tally">{approvalTally(r)}</span>
          </div>
          {noSigners ? (
            <div className="rounded-md border border-accent/30 bg-accent/5 p-4 text-sm" data-testid="notice-no-signers">
              No signers are captured for this request yet, so it cannot be approved. Add signers in <Link href="/settings" className="text-accent hover:underline">Settings, Sign-offs</Link>; this request picks up that list on its next sign-off.
            </div>
          ) : <SignerList r={r} />}
          <p className="text-xs text-muted-foreground">Signers were captured from Settings when the request was submitted. Later Settings edits apply only to new requests. A signature image is shown only alongside a recorded approval; the image alone is not an approval.</p>
        </section>

        {(r.legacyApprovals || historicSigned) && (
          <section className="space-y-2 rounded-md border border-dashed border-border p-4 text-sm" data-testid="legacy-approvals">
            <h2 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Previous workflow, not counted toward current approvals</h2>
            {r.ceoApprovedAt && <p>CEO signature · {r.ceoApprovedBy} · {new Date(r.ceoApprovedAt).toLocaleString()}</p>}
            {r.cfoApprovedAt && <p>CFO signature · {r.cfoApprovedBy} · {new Date(r.cfoApprovedAt).toLocaleString()}</p>}
            {!historicSigned && <p className="text-muted-foreground">This request was opened under the previous approval workflow.</p>}
          </section>
        )}

        {!issuance && <section className="space-y-2">
          <h2 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Supporting documents ({files.length})</h2>
          <AttachmentList docs={files} empty="The requester attached no supporting documents." />
          {pending && <p className="text-xs text-muted-foreground">Review these before deciding. They carry forward to the executed transfer.</p>}
        </section>}
        {mayAttach && (
          <AppendAttachments existing={files.length} pending={attach.isPending} error={attachErr}
            note="Files can be added only until the first approval; after that the request is locked."
            onAttach={(docs, done) => {
              setAttachErr('');
              attach.mutate({ requestId: id, data: { attachments: docs } }, {
                onSuccess: (updated) => { done(); qc.setQueryData(getGetTransferRequestQueryKey(id), updated); refreshRegistry(qc); },
                onError: (e) => {
                  const locked = (e as { status?: number } | null)?.status === 409;
                  setAttachErr(locked ? 'An approval was recorded, so this request can no longer change. Your uploads were not attached.' : errMsg(e, 'Files could not be attached. Your uploads are kept; try again.'));
                  request.refetch();
                },
              });
            }} />
        )}

        {r.status === 'Completed' && <CertificatePdfList requestId={r.id} />}
        {pending && (
          <div className="space-y-2 rounded-md border border-border p-4 text-sm">
            <p>New requests notify the captured signers through the connected Outlook mailbox. This link remains available as a manual fallback. Signers must use a Microsoft account whose tenant sign-in address matches the signer list; the link does not grant access.</p>
            <label className="block text-xs text-muted-foreground" htmlFor="approval-link">Approval link</label>
            <input id="approval-link" readOnly value={approvalUrl} className="w-full min-w-0 rounded border border-border bg-background p-2 text-xs" onFocus={(e) => e.target.select()} data-testid="input-approval-link" />
            <Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(approvalUrl); setCopied(true); } catch { setMessage('Could not copy automatically. Select and copy the link above.'); } }} data-testid="button-copy-link">{copied ? 'Link copied' : 'Copy approval link'}</Button>
          </div>
        )}

        {pending && (r.canApprove || r.canReject) ? (
          <div className="space-y-3">
            <p className="text-sm" data-testid="text-decision-context">
              {r.canApprove
                ? (isRequester ? 'You submitted this request and are a required signer, so you may approve it yourself.' : 'Your approval is required as a named signer.')
                : myVote ? `You approved on ${new Date(myVote.approvedAt).toLocaleString()}. You can still reject while it is pending.` : 'You can reject this request while it is pending.'}
              {r.canApprove && remaining === 1 ? ' Yours is the final approval; it executes immediately.' : ''}
            </p>
            <div className="flex flex-wrap gap-3">
              {r.canApprove && <Button type="button" onClick={() => { setDecisionError(''); setConfirm('approve'); }} data-testid="button-approve-request">Approve request</Button>}
              {r.canReject && <Button type="button" variant="destructive" onClick={() => { setDecisionError(''); setConfirm('reject'); }} data-testid="button-reject-request">Reject request</Button>}
            </div>
          </div>
        ) : pending && <p className="text-sm text-muted-foreground" data-testid="text-not-signer">Only the named signers listed above can approve or reject, each signed in with the matching tenant sign-in address.</p>}
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !decide.isPending) setConfirm(null); }}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md" data-testid="dialog-confirm-decision">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'approve'
                ? `Confirm your approval of these exact details${issuance ? '' : ` and the ${files.length} attached document${files.length === 1 ? '' : 's'}`}. If every required signer has then approved, this immediately ${issuance ? 'issues the certificate' : 'transfers the shares'} and cannot be undone here.`
                : 'Reject this request? It will remain in history and nothing on the ledger will change.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">{nf.format(issuance ? r.issuance?.quantity ?? r.input.quantity : r.input.quantity)} {r.shareClass} shares · {issuance ? 'For' : `${r.originatorName} →`} {r.recipientName || r.originatorName}</p>
          {decisionError && <p role="alert" className="text-sm text-destructive" data-testid="text-decision-error">{decisionError}</p>}
          {(!pending || !(confirm === 'approve' ? r.canApprove : r.canReject)) && <p role="alert" className="text-sm text-muted-foreground">This request has changed and no longer allows this decision. Close this window to review its current status.</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decide.isPending} data-testid="button-cancel-decision">Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={decide.isPending || !pending || !(confirm === 'approve' ? r.canApprove : r.canReject)}
              onClick={(event) => { event.preventDefault(); submit(); }} data-testid="button-confirm-decision">
              {decide.isPending ? 'Saving…' : `Confirm ${confirm === 'approve' ? 'approval' : 'rejection'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
