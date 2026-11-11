import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  useIssueCertificate,
  getListCertificatesQueryKey,
  getGetShareholderQueryKey,
  getListShareholdersQueryKey,
  getGetSummaryQueryKey,
  getListActivityQueryKey,
  type Certificate,
  type TransferRequest,
  type CertificateLedger,
  type CertificateInputShareClass,
  type ShareTransfer,
} from '@workspace/api-client-react';
import { TransferDialog } from '@/components/transfer-dialog';
import { TransferRequestsList } from '@/components/transfer-requests-list';
import { IssuanceRequests } from '@/components/approval-signers';
import { EmailNotificationStatus } from '@/components/email-notification-status';
import { refreshRegistry } from '@/lib/registry-sync';
import { AlertCircle, ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, ArrowUpRight, ArrowRight, Clock, Copy, HelpCircle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, nf } from '@/lib/format';

const DEFAULT_VESTING = 'Fully vested upon grant';
const STATUS_HELP: Record<string, string> = {
  Outstanding: 'Currently held. Counts toward fully diluted totals.',
  'Partially Transferred': 'Some shares moved to another holder. Only the remaining balance counts here.',
  Transferred: 'All shares moved to another holder. Counts as 0 here.',
  Cancelled: 'Voided. Counts as 0.',
};
const pctFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const fmtIssue = (d: string | null) => {
  if (!d) return 'Not recorded';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function Help({ text, testId }: { text: string; testId?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground hover:text-foreground" aria-label={text} title={text} data-testid={testId}><HelpCircle className="h-3.5 w-3.5" /></button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

type Props = {
  shareholderId: string;
  ledger?: CertificateLedger;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
};

export function HoldingsShares({ shareholderId, ledger, isLoading, isError, error, onRetry }: Props) {
  const [sortAsc, setSortAsc] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [transferFor, setTransferFor] = useState<string | null>(null);
  // Always read the live certificate from the current ledger, never a stale snapshot.
  const detail = ledger?.certificates.find((c) => c.id === detailId) ?? null;
  const transfers = useMemo(() => [...(ledger?.transfers ?? [])].sort((a, b) => b.transferDate.localeCompare(a.transferDate) || b.createdAt.localeCompare(a.createdAt)), [ledger]);
  const canTransfer = (c: Certificate) => c.remainingQuantity > 0 && (c.status === 'Outstanding' || c.status === 'Partially Transferred');

  const rows = useMemo(() => {
    const list = [...(ledger?.certificates ?? [])];
    list.sort((a, b) => {
      if (!a.issueDate && !b.issueDate) return a.id.localeCompare(b.id);
      if (!a.issueDate) return 1;
      if (!b.issueDate) return -1;
      return sortAsc ? a.issueDate.localeCompare(b.issueDate) : b.issueDate.localeCompare(a.issueDate);
    });
    return list;
  }, [ledger, sortAsc]);

  const note = ledger?.calculationNote || 'Each remaining Common or Preferred share counts as 1. Partially transferred certificates count only their remaining balance; fully transferred and cancelled certificates count as 0. The company denominator is all remaining issued shares and does not change on transfer; no options or conversion assumptions are applied.';

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <details className="min-w-0 flex-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1 hover:text-foreground" data-testid="help-calculation">How fully diluted is calculated</summary>
          <p className="mt-2 max-w-prose leading-relaxed" data-testid="text-calculation-note">{note}</p>
        </details>
        <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setTransferFor('')} disabled={isLoading || isError || !ledger?.certificates.some(canTransfer)} data-testid="button-transfer-shares">
          <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />Transfer shares
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setIssueOpen(true)} disabled={isLoading || isError} data-testid="button-issue-certificate">
          <Plus className="mr-1 h-3.5 w-3.5" />Request issuance
        </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-6 text-center text-sm">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="text-destructive">Certificates couldn't be loaded. {errMsg(error)}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} data-testid="button-retry-certificates"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">No certificates issued yet.</div>
      ) : (
        <div className="-mx-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Certificate holdings; scroll horizontally to view all columns">
          <table className="w-full min-w-[640px] text-sm" data-testid="table-certificates">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="px-5 py-2 font-medium">Certificate</th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => setSortAsc((v) => !v)} className="inline-flex items-center gap-1 uppercase tracking-[0.16em] hover:text-foreground" data-testid="button-sort-issue-date">
                    Issue Date {sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Vesting Schedule</th>
                <th className="px-3 py-2 text-right font-medium">Fully Diluted</th>
                <th className="px-5 py-2 text-right font-medium">% Fully Diluted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id} className="rise" data-testid={`row-certificate-${c.id}`}>
                  <td className="px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button type="button" onClick={() => setDetailId(c.id)} className="font-mono text-accent hover:underline" data-testid={`link-certificate-${c.id}`}>
                      {c.id} <span className="font-sans text-muted-foreground">({c.shareClass})</span>
                    </button>
                    {canTransfer(c) && (
                      <button type="button" onClick={() => setTransferFor(c.id)} className="rounded-sm border border-border px-1.5 py-px text-[11px] text-muted-foreground hover:border-accent hover:text-accent" data-testid={`button-transfer-${c.id}`} aria-label={`Transfer shares from ${c.id}`}>Transfer</button>
                    )}
                    </div>
                  </td>
                  <td className={cn('px-3 py-2.5 tnum', !c.issueDate && 'italic text-muted-foreground')}>{fmtIssue(c.issueDate)}</td>
                  <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5">{c.status}<Help text={STATUS_HELP[c.status] ?? c.status} /></span></td>
                  <td className="px-3 py-2.5">{c.vestingSchedule}</td>
                  <td className="px-3 py-2.5 text-right font-mono tnum">{nf.format(c.fullyDiluted)}</td>
                  <td className="px-5 py-2.5 text-right font-mono tnum">{pctFmt.format(c.percentFullyDiluted)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-sm">
                <td colSpan={4} className="px-5 pt-3 text-muted-foreground">Total of {nf.format(ledger?.companyFullyDiluted ?? 0)} company fully diluted</td>
                <td className="px-3 pt-3 text-right font-mono tnum" data-testid="text-ledger-total">{nf.format(ledger?.totalShares ?? 0)}</td>
                <td className="px-5 pt-3 text-right font-mono tnum">
                  {pctFmt.format(rows.reduce((a, c) => a + c.percentFullyDiluted, 0))}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!isLoading && !isError && <TransferHistory transfers={transfers} shareholderId={shareholderId} onOpenCert={(id) => ledger?.certificates.some((c) => c.id === id) && setDetailId(id)} />}
      <IssuanceRequests shareholderId={shareholderId} />
      <TransferRequestsList shareholderId={shareholderId} />

      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto overflow-x-hidden">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Certificate <span className="font-mono">{detail.id}</span></DialogTitle>
                <DialogDescription>The original quantity is retained; transfers reduce the remaining balance and are listed below. Cancellations are not yet available here.</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm" data-testid="detail-certificate">
                {([
                  ['Share class', detail.shareClass], ['Original quantity', nf.format(detail.quantity)],
                  ['Transferred', nf.format(detail.transferredQuantity)], ['Remaining', nf.format(detail.remainingQuantity)],
                  ['Issue date', fmtIssue(detail.issueDate)], ['Status', detail.status],
                  ['Vesting schedule', detail.vestingSchedule], ['Fully diluted', nf.format(detail.fullyDiluted)],
                  ['% fully diluted', `${pctFmt.format(detail.percentFullyDiluted)}%`], ['Recorded', new Date(detail.createdAt).toLocaleString()],
                ] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words tnum">{v}</dd></div>
                ))}
              </dl>
              {(() => { const linked = transfers.filter((t) => t.sourceCertificateId === detail.id || t.sources?.some(s => s.certificateId === detail.id) || t.recipientCertificateId === detail.id); return linked.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Linked transfers</div>
                  <ul className="divide-y divide-border rounded-md border border-border text-xs" data-testid="detail-linked-transfers">
                    {linked.map((t) => <TransferLine key={t.id} t={t} shareholderId={shareholderId} />)}
                  </ul>
                </div>); })()}
              {canTransfer(detail) && <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => { setTransferFor(detail.id); setDetailId(null); }} data-testid="button-detail-transfer"><ArrowLeftRight className="mr-1 h-3.5 w-3.5" />Transfer from {detail.id}</Button>}
              {!detail.issueDate && <p className="text-xs text-muted-foreground">Imported from an earlier holding record; the original issue date was not captured.</p>}
            </>
          )}
        </DialogContent>
      </Dialog>

      {transferFor !== null && ledger && <TransferDialog shareholderId={shareholderId} ledger={ledger} initialCertId={transferFor || undefined} onClose={() => setTransferFor(null)} onConflict={onRetry} />}
      {issueOpen && <IssueDialog shareholderId={shareholderId} onClose={() => setIssueOpen(false)} />}
    </TooltipProvider>
  );
}

function TransferLine({ t, shareholderId }: { t: ShareTransfer; shareholderId: string }) {
  const out = t.originatorId === shareholderId;
  const cpId = out ? t.recipientId : t.originatorId;
  const cpName = out ? t.recipientName : t.originatorName;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5" data-testid={`row-transfer-${t.id}`}>
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-[0.12em]', out ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary')}>
        {out ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}{out ? 'Outgoing' : 'Incoming'}
      </span>
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-mono">{t.sources?.map(s => `${s.certificateId} (${nf.format(s.quantity)})`).join('; ') || t.sourceCertificateId}</span> <span className="text-muted-foreground">to</span> <span className="font-mono">{t.recipientCertificateId}</span>
          <span className="text-muted-foreground"> · {out ? 'to' : 'from'} </span>
          <Link href={`/shareholders/${cpId}`} className="text-accent hover:underline" data-testid={`link-transfer-counterpart-${t.id}`}>{cpName}</Link>
        </div>
        <div className="mt-0.5 text-muted-foreground">
          {fmtIssue(t.transferDate)} · {t.shareClass}{t.reason ? ` · ${t.reason}` : ''}{t.pricePerShare ? ` · ${t.pricePerShare} per share` : ''} · recorded {new Date(t.createdAt).toLocaleDateString()}
        </div>
      </div>
      <Link href={`/transfers/${t.id}`} className="shrink-0 text-accent hover:underline" data-testid={`link-transfer-detail-${t.id}`}>
        {t.attachments?.length ? `${t.attachments.length} file${t.attachments.length === 1 ? '' : 's'} · ` : ''}Details
      </Link>
      <span className="ml-auto font-mono tnum">{out ? '-' : '+'}{nf.format(t.quantity)}</span>
    </li>
  );
}

function TransferHistory({ transfers, shareholderId, onOpenCert }: { transfers: ShareTransfer[]; shareholderId: string; onOpenCert: (id: string) => void }) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Transfer history</h3>
        <span className="text-[11px] text-muted-foreground tnum">{transfers.length} recorded</span>
      </div>
      {transfers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-5 text-center text-xs text-muted-foreground">No transfers in or out of this record yet.</div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-xs" data-testid="list-transfers" onClick={(e) => { const id = (e.target as HTMLElement).closest('[data-cert]')?.getAttribute('data-cert'); if (id) onOpenCert(id); }}>
          {transfers.map((t) => <TransferLine key={t.id} t={t} shareholderId={shareholderId} />)}
        </ul>
      )}
    </div>
  );
}

function IssueDialog({ shareholderId, onClose }: { shareholderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const issue = useIssueCertificate();
  const [shareClass, setShareClass] = useState<CertificateInputShareClass>('Common');
  const [quantity, setQuantity] = useState('');
  const [issueDate, setIssueDate] = useState(todayISO());
  const [vesting, setVesting] = useState(DEFAULT_VESTING);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitted, setSubmitted] = useState<TransferRequest | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per intended submission: kept across retries, replaced when the payload changes.
  const requestId = useRef<string | null>(null);
  const edit = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); requestId.current = null; setSubmitError(''); };

  function validate() {
    const e: Record<string, string> = {};
    const q = Number(quantity);
    if (!/^\d+$/.test(quantity.trim()) || !Number.isSafeInteger(q) || q < 1) e.quantity = 'Enter a positive whole number.';
    else if (q > 1e12) e.quantity = 'Too large.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) e.issueDate = 'Enter a date.';
    else if (issueDate > todayISO()) e.issueDate = 'Issue date cannot be in the future.';
    if (!vesting.trim()) e.vesting = 'Vesting schedule is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (issue.isPending) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setSubmitError('');
    issue.mutate(
      { id: shareholderId, data: { shareClass, quantity: Number(quantity), issueDate, vestingSchedule: vesting.trim(), requestId: requestId.current } },
      {
        onSuccess: (r) => {
          requestId.current = null;
          setSubmitted(r);
          [getListCertificatesQueryKey(shareholderId), getGetShareholderQueryKey(shareholderId), getListShareholdersQueryKey(), getGetSummaryQueryKey(), getListActivityQueryKey()]
            .forEach((queryKey) => qc.invalidateQueries({ queryKey }));
          refreshRegistry(qc);
          toast({ title: 'Issuance submitted for approval', description: 'No certificate is issued until every configured signer approves.' });
        },
        onError: (err) => setSubmitError(errMsg(err, 'The issuance request could not be submitted. Retrying is safe and will not duplicate it.')),
      },
    );
  }

  const link = submitted ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-off-requests/${encodeURIComponent(submitted.id)}` : '';

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !issue.isPending) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{submitted ? 'Awaiting all signers' : step === 'review' ? 'Review issuance request' : 'Request certificate issuance'}</DialogTitle>
          <DialogDescription>
            {submitted ? 'Request saved. No certificate number was allocated and holdings are unchanged.' : 'Every signer configured in Settings must approve before the certificate is issued. Unsaved edits on this record are kept.'}
          </DialogDescription>
        </DialogHeader>
        {submitted ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/40 p-4">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Pending approval</div>
                <div className="text-muted-foreground" data-testid="text-issuance-pending">{nf.format(submitted.issuance?.quantity ?? submitted.input.quantity)} {submitted.issuance?.shareClass ?? submitted.shareClass} shares · issue date {fmtIssue(submitted.issuance?.issueDate ?? submitted.input.transferDate)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{submitted.requiredSigners.length} signer{submitted.requiredSigners.length === 1 ? '' : 's'} required: {submitted.requiredSigners.map((x) => x.name).join(', ') || 'none captured'}</div>
                <Link href={`/sign-off-requests/${submitted.id}`} className="mt-2 inline-flex items-center gap-1 text-accent hover:underline" data-testid="link-issuance-approval">Open approval request<ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
            </div>
            {submitted.emailNotificationSummary && <EmailNotificationStatus requestId={submitted.id} initialSummary={submitted.emailNotificationSummary} />}
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 text-xs" data-testid="input-issuance-link" />
              <Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }} data-testid="button-copy-issuance-link"><Copy className="mr-1 h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy link'}</Button>
            </div>
            <p className="text-xs text-muted-foreground">If you are a listed signer, you can approve the request yourself.</p>
          </div>
        ) : step === 'review' ? (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-border p-4" data-testid="review-issuance">
              {([['Share class', shareClass], ['Quantity', nf.format(Number(quantity))], ['Issue date', fmtIssue(issueDate)], ['Vesting', vesting.trim()]] as const).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words tnum">{v}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">After all configured signers approve, a new Outstanding {shareClass === 'Common' ? 'C-' : 'P-'} certificate is numbered and counted. Until then nothing changes on the ledger.</p>
            {submitError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="text-issue-error">{submitError}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Share class</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['Common', 'Preferred'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => edit(setShareClass)(s)}
                    className={cn('rounded-md border px-3 py-2 text-left text-sm transition-colors', shareClass === s ? 'border-accent bg-accent/5' : 'border-border hover:border-primary/40')}
                    data-testid={`button-class-${s.toLowerCase()}`}>
                    {s} <span className="ml-1 font-mono text-xs text-muted-foreground">{s === 'Common' ? 'C-' : 'P-'}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">The ID is assigned by the server only after final approval. Common (C-) and Preferred (P-) use independent counters.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Quantity<span className="text-accent"> *</span></Label>
                <Input inputMode="numeric" value={quantity} onChange={(e) => edit(setQuantity)(e.target.value)} placeholder="0"
                  className={cn('text-right font-mono', errors.quantity && 'border-destructive')} data-testid="input-cert-quantity" />
                {errors.quantity && <p className="text-xs text-destructive">{errors.quantity}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Issue date<span className="text-accent"> *</span></Label>
                <Input type="date" max={todayISO()} value={issueDate} onChange={(e) => edit(setIssueDate)(e.target.value)}
                  className={cn(errors.issueDate && 'border-destructive')} data-testid="input-cert-issue-date" />
                {errors.issueDate && <p className="text-xs text-destructive">{errors.issueDate}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Vesting schedule<span className="text-accent"> *</span></Label>
              <Input value={vesting} maxLength={500} onChange={(e) => edit(setVesting)(e.target.value)}
                className={cn(errors.vesting && 'border-destructive')} data-testid="input-cert-vesting" />
              {errors.vesting && <p className="text-xs text-destructive">{errors.vesting}</p>}
            </div>
            {submitError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="text-issue-error">{submitError}</p>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {submitted ? (
            <Button type="button" onClick={onClose} data-testid="button-issue-done">Done</Button>
          ) : step === 'review' ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep('form')} disabled={issue.isPending} data-testid="button-issue-back">Back to edit</Button>
              <Button type="button" onClick={submit} disabled={issue.isPending} data-testid="button-issue-submit">
                {issue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{submitError ? 'Retry submission' : 'Submit for approval'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={() => validate() && setStep('review')} data-testid="button-issue-review">Review issuance</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
