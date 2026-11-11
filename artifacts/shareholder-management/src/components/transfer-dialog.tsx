import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useTransferShares,
  useListShareholders,
  useGetShareholder,
  useGetCurrentSharePrices,
  getGetCurrentSharePricesQueryKey,
  getListCertificatesQueryKey,
  getGetShareholderQueryKey,
  getListShareholdersQueryKey,
  getGetSummaryQueryKey,
  getListActivityQueryKey,
  type CertificateLedger,
  type TransferRequest,
  type TransferInput,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { AttachmentDraftField, AttachmentList, MAX_ATTACHMENTS, useAttachmentDraft } from '@/components/attachments';
import { EmailNotificationStatus } from '@/components/email-notification-status';
import { refreshRegistry } from '@/lib/registry-sync';
import { cn } from '@/lib/utils';
import { errMsg, nf } from '@/lib/format';

const REASONS = ['Death', 'Divorce', 'Donation', 'Gift', 'Secondary Sale', 'Transfer to Affiliate', 'Other'];
const PRICE_RE = /^[0-9]{1,18}(\.[0-9]{1,6})?$/;
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtD = (d: string | null) => {
  if (!d) return 'Not recorded';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type Props = { shareholderId: string; shareholderName?: string; ledger: CertificateLedger; initialCertId?: string; onClose: () => void; onConflict: () => void };

export function TransferDialog({ shareholderId, shareholderName, ledger, initialCertId, onClose, onConflict }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const transfer = useTransferShares();
  const holders = useListShareholders();
  const settingsPrices = useGetCurrentSharePrices({ query: { queryKey: getGetCurrentSharePricesQueryKey(), staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const transferable = ledger.certificates.filter((c) => c.remainingQuantity > 0 && (c.status === 'Outstanding' || c.status === 'Partially Transferred'));

  const [certId, setCertId] = useState(initialCertId && transferable.some((c) => c.id === initialCertId) ? initialCertId : transferable[0]?.id ?? '');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [recipientId, setRecipientId] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState(false);
  const [batchAmounts, setBatchAmounts] = useState<Record<string, string>>({});
  const [priceSelection, setPriceSelection] = useState<{ shareClass: string; value: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [done, setDone] = useState<TransferRequest | null>(null);
  const requestId = useRef<string | null>(null);
  const pending = transfer.isPending;
  const draft = useAttachmentDraft(MAX_ATTACHMENTS, () => { requestId.current = null; setSubmitError(''); });

  const src = ledger.certificates.find((c) => c.id === certId);
  const allocations = Object.entries(batchAmounts).map(([certificateId, value]) => ({ certificateId, quantity: Number(value) }));
  const totalQuantity = batch ? allocations.reduce((sum, s) => sum + s.quantity, 0) : Number(qty);
  const sourceLabel = batch ? allocations.map(s => `${s.certificateId}: ${nf.format(s.quantity)}`).join('; ') : src?.id ?? '';
  const minimumDate = batch ? ledger.certificates.filter(c => c.id in batchAmounts).map(c => c.issueDate ?? '').sort().at(-1) : src?.issueDate;
  const currentHolder = useGetShareholder(src?.shareholderId ?? shareholderId);
  const holderName = currentHolder.data?.name || holders.data?.find((s) => s.id === (src?.shareholderId ?? shareholderId))?.name || shareholderName || shareholderId;
  const price = priceSelection?.shareClass === src?.shareClass ? priceSelection?.value ?? '' : '';
  const waitingForPrice = (settingsPrices.isLoading || settingsPrices.isFetching) && priceSelection?.shareClass !== src?.shareClass;
  // Seed once per share class. Background refreshes must not replace an edited
  // or reviewed price, including an intentionally blank or zero price.
  useEffect(() => {
    if (!src || !settingsPrices.data || settingsPrices.isFetching || settingsPrices.isError || pending || step !== 'form' || priceSelection?.shareClass === src.shareClass) return;
    setPriceSelection({ shareClass: src.shareClass, value: (src.shareClass === 'Common' ? settingsPrices.data.common : settingsPrices.data.preferred) ?? '' });
    requestId.current = null;
  }, [src?.shareClass, settingsPrices.data, settingsPrices.isFetching, settingsPrices.isError, priceSelection?.shareClass, pending, step]);
  const recipients = useMemo(() => (holders.data ?? []).filter((s) => s.id !== shareholderId).sort((a, b) => a.name.localeCompare(b.name)), [holders.data, shareholderId]);
  const recipientName = mode === 'new' ? newName.trim() : recipients.find((r) => r.id === recipientId)?.name ?? '';
  const sourceFamily = holders.data?.find((s) => s.id === shareholderId)?.familyLine?.trim() ?? '';
  const recipientFamily = mode === 'existing' ? recipients.find((r) => r.id === recipientId)?.familyLine?.trim() ?? '' : '';
  const normalizeFamily = (line: string) => line.replace(/\s+/g, ' ').toLocaleLowerCase();
  const crossesFamilyLines = Boolean(sourceFamily && recipientFamily && normalizeFamily(sourceFamily) !== normalizeFamily(recipientFamily));
  const familyNotice = crossesFamilyLines ? (
    <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950" data-testid="notice-cross-family-transfer">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <div>
        <p className="font-medium">Transfer across family lines</p>
        <p className="mt-1">Recorded family lines: <strong>{sourceFamily}</strong> → <strong>{recipientFamily}</strong>. You can continue with this transfer; this notice does not restrict processing.</p>
      </div>
    </div>
  ) : null;
  const edit = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); requestId.current = null; setSubmitError(''); };

  function validate() {
    const e: Record<string, string> = {};
    if (!src) e.cert = 'Choose a source certificate.';
    if (mode === 'existing' && !recipientId) e.recipient = 'Choose a recipient.';
    if (mode === 'new') {
      if (!newName.trim()) e.newName = 'Name is required.';
      if (newEmail.trim() && !/^\S+@\S+\.\S+$/.test(newEmail.trim())) e.newEmail = 'Enter a valid email.';
    }
    const q = totalQuantity;
    if (batch) {
      if (allocations.length < 2) e.qty = 'Select at least two source certificates for a batch.';
      else if (allocations.length > 100) e.qty = 'Select no more than 100 source certificates.';
      else for (const allocation of allocations) {
        const c = transferable.find(c => c.id === allocation.certificateId);
        if (!c || c.shareClass !== src?.shareClass || c.vestingSchedule !== src?.vestingSchedule) e.qty = 'Select available certificates of the same share class and vesting schedule.';
        else if (!/^\d+$/.test(batchAmounts[c.id].trim()) || !Number.isSafeInteger(allocation.quantity) || allocation.quantity < 1 || allocation.quantity > c.remainingQuantity)
          e.qty = `Enter 1–${nf.format(c.remainingQuantity)} whole shares for ${c.id}.`;
      }
    } else if (!/^\d+$/.test(qty.trim()) || !Number.isSafeInteger(q) || q < 1) e.qty = 'Enter a positive whole number.';
    else if (src && q > src.remainingQuantity) e.qty = `At most ${nf.format(src.remainingQuantity)} shares remain on ${src.id}.`;
    if (!Number.isSafeInteger(q) || q < 1 || q > 1e12) e.qty = 'The total must be between 1 and 1,000,000,000,000 whole shares.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Enter a date.';
    else if (date > todayISO()) e.date = 'Transfer date cannot be in the future.';
    else if (minimumDate && date < minimumDate.slice(0, 10)) e.date = `Must be on or after the latest source issue date (${fmtD(minimumDate)}).`;
    if (price.trim() && !PRICE_RE.test(price.trim())) e.price = 'Use a number with up to 6 decimal places.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    if (pending || !src || draft.busy || draft.failed || !validate()) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const data: TransferInput = {
      quantity: totalQuantity, transferDate: date, requestId: requestId.current,
      ...(batch ? { sources: allocations } : {}),
      ...(mode === 'existing' ? { recipientId } : { newRecipient: { name: newName.trim(), ...(newEmail.trim() ? { email: newEmail.trim() } : {}) } }),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(price.trim() ? { pricePerShare: price.trim() } : {}),
      ...(draft.docs.length ? { attachments: draft.docs } : {}),
    };
    setSubmitError('');
    transfer.mutate({ id: shareholderId, certificateId: src.id, data }, {
      onSuccess: (t) => {
        requestId.current = null;
        setDone(t);
        // Broad refresh: every shareholder detail/ledger key lives under /api/shareholders.
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/shareholders') });
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0].startsWith('/api/transfer-requests') || q.queryKey[0].startsWith('/api/sign-off')) });
        [getListCertificatesQueryKey(shareholderId), getGetShareholderQueryKey(shareholderId), getListShareholdersQueryKey(), getGetSummaryQueryKey(), getListActivityQueryKey()]
          .forEach((queryKey) => qc.invalidateQueries({ queryKey }));
        refreshRegistry(qc);
        toast({ title: 'Transfer submitted for approval', description: 'All configured signers must approve. Holdings are unchanged.' });
      },
      onError: (err) => {
        if ((err as { status?: number } | null)?.status === 409) {
          onConflict();
          requestId.current = null;
          setStep('form');
          setSubmitError(errMsg(err, 'The certificate changed since you opened this form. The ledger has been refreshed; review the remaining balance and try again.'));
        } else setSubmitError(errMsg(err, 'The transfer could not be recorded. Retrying is safe and will not duplicate it.'));
      },
    });
  }

  const lbl = 'text-xs font-medium text-muted-foreground';
  const req = <span className="text-accent"> *</span>;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto overflow-x-hidden"
        onEscapeKeyDown={(e) => pending && e.preventDefault()} onInteractOutside={(e) => pending && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{done ? 'Awaiting all signers' : step === 'review' ? 'Review transfer request' : 'Request share transfer'}</DialogTitle>
          <DialogDescription>
            {done ? 'Request saved. No shares moved and no certificate number was allocated.' : 'Every signer configured in Settings must approve before shares move. Pending requests do not reserve shares. Unsaved edits on this record are kept.'}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 rounded-md border border-border bg-secondary/40 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Pending approval</div>
                <div className="text-muted-foreground">
                  {nf.format(done.input.quantity)} {done.shareClass} shares from <span className="font-mono">{done.input.sources?.map(s => `${s.certificateId}: ${nf.format(s.quantity)}`).join('; ') || done.sourceCertificateId}</span> · {fmtD(done.input.transferDate)}
                </div>
                <Link href={`/sign-off-requests/${done.id}`} className="mt-2 inline-flex items-center gap-1 text-accent hover:underline" data-testid="link-transfer-approval">
                  Open approval request<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
            {done.emailNotificationSummary && <EmailNotificationStatus requestId={done.id} initialSummary={done.emailNotificationSummary} />}
            <p className="text-xs text-muted-foreground">A new recipient record is created only after all signers approve.</p>
          </div>
        ) : step === 'review' && src ? (
          <div className="space-y-3 text-sm">
            {familyNotice}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-border p-4" data-testid="review-transfer">
              {([
                ['Current holder', holderName], ['From certificates', `${sourceLabel} (${src.shareClass})`], ['To', recipientName + (mode === 'new' ? ' (new shareholder)' : '')],
                ['Shares on one new certificate', nf.format(totalQuantity)],
                ['Source balances after transfer', batch ? allocations.map(s => `${s.certificateId}: ${nf.format((ledger.certificates.find(c => c.id === s.certificateId)?.remainingQuantity ?? 0) - s.quantity)}`).join('; ') : nf.format(src.remainingQuantity - totalQuantity)],
                ['Transfer date', fmtD(date)], ['Price per share', price.trim() || 'Not recorded'],
                ['Reason', reason.trim() || 'Not recorded'], ['Vesting', src.vestingSchedule],
              ] as const).map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words tnum">{v}</dd></div>
              ))}
            </dl>
            <div className="space-y-1.5" data-testid="review-attachments">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Supporting documents ({draft.docs.length})</div>
              <AttachmentList docs={draft.docs} empty="No supporting documents attached." />
            </div>
            <p className="text-xs text-muted-foreground">
              After all configured signers approve, each source certificate will be marked Transferred or Partially Transferred according to its remaining balance. Exactly one new Outstanding {src.shareClass === 'Common' ? 'C-' : 'P-'} certificate for {nf.format(totalQuantity)} shares is numbered only then. If any source balance is no longer available, no part of the transfer is processed.
            </p>
            {submitError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="text-transfer-error">{submitError}</p>}
          </div>
        ) : transferable.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">No certificate on this record has shares remaining to transfer.</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tr-current-holder" className={lbl}>Current holder</Label>
              <Input id="tr-current-holder" readOnly value={holderName} className="bg-muted/60" data-testid="input-transfer-current-holder" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-source" className={lbl}>{batch ? 'First source certificate / share class' : 'Source certificate'}{req}</Label>
              <Select value={certId} onValueChange={(id) => { edit(setCertId)(id); setBatchAmounts({ [id]: '' }); }} disabled={pending}>
                <SelectTrigger id="tr-source" className={cn(errors.cert && 'border-destructive')} data-testid="select-transfer-source"><SelectValue placeholder="Select a certificate" /></SelectTrigger>
                <SelectContent>
                  {transferable.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.id} · {c.shareClass} · {nf.format(c.remainingQuantity)} remaining</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.cert && <p className="text-xs text-destructive">{errors.cert}</p>}
            </div>
            <div className="space-y-3 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={batch} disabled={pending} data-testid="toggle-batch-transfer"
                  onChange={e => { edit(setBatch)(e.target.checked); setBatchAmounts({ [certId]: qty }); setErrors({}); }} />
                Batch transfer from multiple certificates
              </label>
              {batch && <>
                <p className="text-xs text-muted-foreground">Choose certificates from this shareholder. Only {src?.shareClass} shares with the same vesting schedule can be consolidated. The recipient receives one certificate.</p>
                <div className="space-y-2" data-testid="batch-source-allocations">
                  {transferable.filter(c => c.shareClass === src?.shareClass).map(c => {
                    const selected = c.id in batchAmounts;
                    const compatible = c.vestingSchedule === src?.vestingSchedule;
                    return <div key={c.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={selected} disabled={pending || c.id === certId || !compatible}
                          data-testid={`batch-source-${c.id}`} onChange={e => {
                            const next = { ...batchAmounts };
                            if (e.target.checked) next[c.id] = String(c.remainingQuantity); else delete next[c.id];
                            edit(setBatchAmounts)(next);
                          }} />
                        <span>{c.id} · {nf.format(c.remainingQuantity)} available{!compatible && ' · Different vesting schedule'}</span>
                      </label>
                      <Input aria-label={`Shares from ${c.id}`} inputMode="numeric" value={batchAmounts[c.id] ?? ''}
                        disabled={pending || !selected || !compatible} placeholder="Shares" data-testid={`batch-quantity-${c.id}`}
                        onChange={e => edit(setBatchAmounts)({ ...batchAmounts, [c.id]: e.target.value })} />
                    </div>;
                  })}
                </div>
                <p className="text-sm font-medium" data-testid="batch-transfer-total">Total: {nf.format(totalQuantity || 0)} {src?.shareClass} shares → one certificate</p>
                {errors.qty && <p className="text-xs text-destructive">{errors.qty}</p>}
              </>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor={mode === 'existing' ? 'tr-recipient' : 'tr-new-name'} className={lbl}>Recipient{req}</Label>
              </div>
              {mode === 'existing' ? (
                <>
                  <Select value={recipientId} onValueChange={edit(setRecipientId)} disabled={pending || holders.isLoading}>
                    <SelectTrigger id="tr-recipient" className={cn(errors.recipient && 'border-destructive')} data-testid="select-transfer-recipient">
                      <SelectValue placeholder={holders.isLoading ? 'Loading registry…' : holders.isError ? 'Registry unavailable' : 'Select…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {recipients.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.email ? ` · ${r.email}` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.recipient && <p className="text-xs text-destructive">{errors.recipient}</p>}
                  <button type="button" onClick={() => edit(setMode)('new')} disabled={pending} className="text-xs text-accent hover:underline" data-testid="button-add-new-recipient">Add New Recipient</button>
                </>
              ) : (
                <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tr-new-name" className="sr-only">New recipient name</Label>
                    <Input id="tr-new-name" placeholder="Full name" maxLength={200} value={newName} onChange={(e) => edit(setNewName)(e.target.value)} disabled={pending}
                      className={cn('bg-card', errors.newName && 'border-destructive')} data-testid="input-new-recipient-name" />
                    {errors.newName && <p className="text-xs text-destructive">{errors.newName}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tr-new-email" className={lbl}>Email (optional)</Label>
                    <Input id="tr-new-email" type="email" maxLength={254} value={newEmail} onChange={(e) => edit(setNewEmail)(e.target.value)} disabled={pending}
                      className={cn('bg-card', errors.newEmail && 'border-destructive')} data-testid="input-new-recipient-email" />
                    {errors.newEmail && <p className="text-xs text-destructive">{errors.newEmail}</p>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">The shareholder record is created together with the transfer, never on its own.</p>
                  <button type="button" onClick={() => edit(setMode)('existing')} disabled={pending} className="text-xs text-accent hover:underline" data-testid="button-choose-existing-recipient">Choose an existing shareholder instead</button>
                </div>
              )}
            </div>

            {familyNotice}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="tr-class" className={lbl}>Share class</Label>
                <Input id="tr-class" readOnly value={src?.shareClass ?? ''} className="bg-muted/60" data-testid="text-transfer-class" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-prefix" className={lbl}>Prefix</Label>
                <Input id="tr-prefix" readOnly value={src ? (src.shareClass === 'Common' ? 'C' : 'P') : ''} className="w-16 bg-muted/60 text-center font-mono" data-testid="text-transfer-prefix" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-newid" className={lbl}>Certificate ID</Label>
                <Input id="tr-newid" readOnly value="Assigned on record" className="bg-muted/60 italic text-muted-foreground" data-testid="text-transfer-new-id-pending" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tr-date" className={lbl}>Transfer date{req}</Label>
                <Input id="tr-date" type="date" min={minimumDate?.slice(0, 10)} max={todayISO()} value={date} onChange={(e) => edit(setDate)(e.target.value)} disabled={pending}
                  className={cn(errors.date && 'border-destructive')} data-testid="input-transfer-date" />
                {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
              </div>
              {!batch && <div className="space-y-1.5">
                <Label htmlFor="tr-qty" className={lbl}># of shares{src ? ` (max. ${nf.format(src.remainingQuantity)})` : ''}{req}</Label>
                <Input id="tr-qty" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => edit(setQty)(e.target.value)} disabled={pending}
                  className={cn('text-right font-mono', errors.qty && 'border-destructive')} data-testid="input-transfer-quantity" />
                {errors.qty && <p className="text-xs text-destructive">{errors.qty}</p>}
              </div>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tr-reason" className={lbl}>Transfer reason</Label>
              <Select value={reason || 'not-recorded'} onValueChange={(value) => edit(setReason)(value === 'not-recorded' ? '' : value)} disabled={pending}>
                <SelectTrigger id="tr-reason" data-testid="input-transfer-reason">
                  <SelectValue placeholder="Please select a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not-recorded">Please select a reason</SelectItem>
                  {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tr-price" className={lbl}>Price per share</Label>
              <Input id="tr-price" inputMode="decimal" placeholder={waitingForPrice ? 'Loading Settings price…' : 'Not set — optional'} maxLength={25} value={price} onChange={(e) => { if (src) edit(setPriceSelection)({ shareClass: src.shareClass, value: e.target.value }); }} disabled={pending}
                className={cn('text-right font-mono', errors.price && 'border-destructive')} data-testid="input-transfer-price" />
              {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
              {settingsPrices.isError ? <p role="status" className="text-xs text-destructive">Settings prices could not be loaded. Enter a price manually or <button type="button" className="underline" onClick={() => settingsPrices.refetch()}>retry</button>.</p>
                : waitingForPrice ? <p role="status" className="text-[11px] text-muted-foreground">Loading the current price from Settings…</p>
                : <p className="text-[11px] text-muted-foreground">USD · Defaults to the current {src?.shareClass ?? 'share'} price in Settings. You can edit it for this transfer. Up to 6 decimal places.{settingsPrices.data && !(src?.shareClass === 'Common' ? settingsPrices.data.common : settingsPrices.data.preferred) ? ' No price is currently set for this class.' : ''}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className={lbl}>Supporting documents</Label>
              <AttachmentDraftField draft={draft} disabled={pending} hint="Signed forms, court orders, gift letters" />
              <p className="text-[11px] text-muted-foreground">Signers can read these before approving. They carry forward to the executed transfer.</p>
            </div>

            {src && <p className="text-[11px] text-muted-foreground">Vesting carries over from {src.id}: {src.vestingSchedule}</p>}
            {submitError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="text-transfer-error">{submitError}</p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          {done ? (
            <Button type="button" onClick={onClose} data-testid="button-transfer-done">Done</Button>
          ) : step === 'review' ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep('form')} disabled={pending} data-testid="button-transfer-back">Back to edit</Button>
              <Button type="button" onClick={submit} disabled={pending || draft.busy || draft.failed} data-testid="button-transfer-record">
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{submitError ? 'Retry submission' : 'Submit for approval'}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose} data-testid="button-transfer-cancel">Cancel</Button>
              <Button type="button" onClick={() => validate() && setStep('review')} disabled={transferable.length === 0 || draft.busy || draft.failed || waitingForPrice} data-testid="button-transfer-review">{draft.busy ? 'Waiting for uploads…' : draft.failed ? 'Fix failed uploads' : waitingForPrice ? 'Loading Settings price…' : 'Review transfer'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
