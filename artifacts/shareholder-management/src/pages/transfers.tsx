import { useMemo, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListTransfers, useListTransferRequests, useGetTransfer, useAttachTransferFiles,
  getListTransfersQueryKey, getListTransferRequestsQueryKey, getGetTransferQueryKey,
  type ShareTransfer, type TransferRequest,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, ArrowRight, Paperclip, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { AppendAttachments, AttachmentList, StatusPill } from '@/components/attachments';
import { CertificatePdfList } from '@/components/certificate-pdfs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errMsg, nf } from '@/lib/format';
import { LIVE, fmtDay, refreshRegistry } from '@/lib/registry-sync';
import { sourceLabel } from '@/lib/transfer-sources';

type Row = {
  key: string; href: string; status: 'Completed' | 'Pending' | 'Rejected';
  date: string; recorded: string; shareClass: string; quantity: number;
  fromId: string; fromName: string; toId: string | null; toName: string;
  source: string; dest: string | null; reason: string; files: number;
};

const fromTransfer = (t: ShareTransfer): Row => ({
  key: `t-${t.id}`, href: `/transfers/${t.id}`, status: 'Completed', date: t.transferDate, recorded: t.createdAt,
  shareClass: t.shareClass, quantity: t.quantity, fromId: t.originatorId, fromName: t.originatorName,
  toId: t.recipientId, toName: t.recipientName, source: sourceLabel(t.sourceCertificateId, t.sources), dest: t.recipientCertificateId,
  reason: t.reason, files: t.attachments?.length ?? 0,
});
const fromRequest = (r: TransferRequest): Row => ({
  key: `r-${r.id}`, href: r.completedTransferId ? `/transfers/${r.completedTransferId}` : `/sign-off-requests/${r.id}`,
  status: r.status, date: r.input.transferDate, recorded: r.createdAt, shareClass: r.shareClass, quantity: r.input.quantity,
  fromId: r.originatorId, fromName: r.originatorName, toId: r.recipientId, toName: r.recipientName,
  source: sourceLabel(r.sourceCertificateId, r.input.sources), dest: r.recipientCertificateId, reason: r.input.reason ?? '', files: r.input.attachments?.length ?? 0,
});

export default function Transfers() {
  const [, params] = useRoute('/transfers/:id');
  return params ? <TransferDetail key={params.id} id={params.id} /> : <TransferHistory />;
}

function TransferHistory() {
  const transfers = useListTransfers({ query: { queryKey: getListTransfersQueryKey(), ...LIVE } });
  const requests = useListTransferRequests(undefined, { query: { queryKey: getListTransferRequestsQueryKey(), ...LIVE } });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [cls, setCls] = useState('all');
  const [from, setFrom] = useState('all');
  const [to, setTo] = useState('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const rows = useMemo(() => {
    const t = transfers.data ?? [];
    const ids = new Set(t.map((x) => x.id));
    const out = t.map(fromTransfer);
    for (const r of requests.data ?? []) {
      if (r.status === 'Completed' && r.completedTransferId && ids.has(r.completedTransferId)) continue;
      out.push(fromRequest(r));
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.recorded.localeCompare(a.recorded));
  }, [transfers.data, requests.data]);

  const holders = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => { m.set(r.fromId, r.fromName); if (r.toId) m.set(r.toId, r.toName); });
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = rows.filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (cls !== 'all' && r.shareClass !== cls) return false;
    if (from !== 'all' && r.fromId !== from) return false;
    if (to !== 'all' && r.toId !== to) return false;
    if (start && r.date.slice(0, 10) < start) return false;
    if (end && r.date.slice(0, 10) > end) return false;
    const s = q.trim().toLowerCase();
    return !s || [r.source, r.dest ?? '', r.fromName, r.toName, r.reason].some((v) => v.toLowerCase().includes(s));
  });

  const loading = transfers.isLoading || requests.isLoading;
  const error = transfers.isError || requests.isError;
  const filtered = q || status !== 'all' || cls !== 'all' || from !== 'all' || to !== 'all' || start || end;
  const clear = () => { setQ(''); setStatus('all'); setCls('all'); setFrom('all'); setTo('all'); setStart(''); setEnd(''); };

  return (
    <div>
      <PageHeader eyebrow="Registry" title="Transfer History" />
      <div className="space-y-4 px-4 py-6 md:px-10">
        <p className="max-w-prose text-sm text-muted-foreground">Every transfer across the company, including requests still awaiting approval from every configured signer and those that were rejected. Only completed transfers moved shares. CEO and CFO signatures on older requests are kept as historical record.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Certificate ID, holder or reason" className="pl-9" data-testid="input-search-transfers" />
          </div>
          <Select value={status} onValueChange={setStatus}><SelectTrigger data-testid="select-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="Completed">Completed</SelectItem><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Rejected">Rejected</SelectItem></SelectContent></Select>
          <Select value={cls} onValueChange={setCls}><SelectTrigger data-testid="select-filter-class"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All classes</SelectItem><SelectItem value="Common">Common</SelectItem><SelectItem value="Preferred">Preferred</SelectItem></SelectContent></Select>
          <Select value={from} onValueChange={setFrom}><SelectTrigger data-testid="select-filter-from"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Any sender</SelectItem>{holders.map(([id, n]) => <SelectItem key={id} value={id}>From {n}</SelectItem>)}</SelectContent></Select>
          <Select value={to} onValueChange={setTo}><SelectTrigger data-testid="select-filter-to"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Any recipient</SelectItem>{holders.map(([id, n]) => <SelectItem key={id} value={id}>To {n}</SelectItem>)}</SelectContent></Select>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From date" data-testid="input-filter-start" />
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To date" data-testid="input-filter-end" />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tnum" data-testid="text-transfer-count">{loading ? 'Loading…' : `${shown.length} of ${rows.length}`}</span>
          {filtered && <button type="button" onClick={clear} className="text-accent hover:underline" data-testid="button-clear-filters">Clear filters</button>}
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8 text-sm">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">{errMsg(transfers.error ?? requests.error, 'Transfer history could not be loaded.')}</span>
            <Button variant="outline" size="sm" onClick={() => { transfers.refetch(); requests.refetch(); }} data-testid="button-retry-transfers"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            {rows.length ? 'No transfers match these filters.' : 'No transfers have been requested or recorded yet. Start one from a shareholder\'s holdings.'}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card" data-testid="list-global-transfers">
            {shown.map((r) => (
              <li key={r.key} className="rise">
                <Link href={r.href} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-secondary/40 md:grid-cols-[7rem_1fr_auto]" data-testid={`row-history-${r.key}`}>
                  <div className="flex items-center gap-2 md:block">
                    <StatusPill status={r.status} />
                    <div className="text-xs text-muted-foreground tnum md:mt-1">{fmtDay(r.date)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 font-mono text-[13px]">
                      {r.source}<ArrowRight className="h-3 w-3 text-muted-foreground" />{r.dest ?? <span className="font-sans italic text-muted-foreground">{r.status === 'Rejected' ? 'none allocated' : 'assigned on approval'}</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{r.fromName} to {r.toName} · {r.shareClass}{r.reason ? ` · ${r.reason}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs md:justify-end">
                    {r.files > 0 && <span className="inline-flex items-center gap-1 text-muted-foreground"><Paperclip className="h-3 w-3" />{r.files}</span>}
                    <span className="font-mono text-sm tnum">{nf.format(r.quantity)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TransferDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const t = useGetTransfer(id, { query: { queryKey: getGetTransferQueryKey(id), ...LIVE } });
  const requests = useListTransferRequests(undefined, { query: { queryKey: getListTransferRequestsQueryKey(), ...LIVE } });
  const attach = useAttachTransferFiles();
  const [err, setErr] = useState('');
  const origin = requests.data?.find((r) => r.completedTransferId === id);

  return (
    <div>
      <PageHeader eyebrow="Completed transfer" title={<span className="font-mono text-2xl md:text-3xl">{t.data ? `${t.data.sources?.length && t.data.sources.length > 1 ? 'Batch transfer' : t.data.sourceCertificateId} to ${t.data.recipientCertificateId}` : id}</span>} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-10">
        <Link href="/transfers" className="inline-flex items-center gap-1 text-sm text-accent hover:underline" data-testid="link-back-transfers"><ArrowLeft className="h-3.5 w-3.5" />Transfer history</Link>
        <CertificatePdfList transferId={id} />
        {t.isLoading ? <Skeleton className="h-64 w-full" /> : t.isError || !t.data ? (
          <div role="alert" className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8 text-sm">
            <span className="text-destructive">{errMsg(t.error, 'Transfer could not be loaded.')}</span>
            <Button variant="outline" size="sm" onClick={() => t.refetch()} data-testid="button-retry-transfer">Retry</Button>
          </div>
        ) : (() => {
          const d = t.data;
          return (
            <>
              <section className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2"><StatusPill status="Completed" /><span className="text-xs text-muted-foreground">Recorded {new Date(d.createdAt).toLocaleString()}</span></div>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2" data-testid="detail-transfer">
                  {([
                    ['Source certificates', <div key="s" className="space-y-1">{(d.sources?.length ? d.sources : [{ certificateId: d.sourceCertificateId, quantity: d.quantity }]).map(s =>
                      <div key={s.certificateId}><Link href={`/certificates?id=${encodeURIComponent(s.certificateId)}`} className="font-mono text-accent hover:underline">{s.certificateId}</Link> · {nf.format(s.quantity)} shares</div>)}</div>],
                    ['New certificate', <Link key="d" href={`/certificates?id=${encodeURIComponent(d.recipientCertificateId)}`} className="font-mono text-accent hover:underline">{d.recipientCertificateId}</Link>],
                    ['From', <Link key="f" href={`/shareholders/${d.originatorId}`} className="text-accent hover:underline">{d.originatorName}</Link>],
                    ['To', <Link key="t" href={`/shareholders/${d.recipientId}`} className="text-accent hover:underline">{d.recipientName}</Link>],
                    ['Shares', `${nf.format(d.quantity)} ${d.shareClass}`], ['Transfer date', fmtDay(d.transferDate)],
                    ['Reason', d.reason || 'Not recorded'], ['Price per share', d.pricePerShare ?? 'Not recorded'],
                  ] as const).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt><dd className="mt-1 break-words tnum">{v}</dd></div>)}
                </dl>
                {origin && <Link href={`/sign-off-requests/${origin.id}`} className="mt-4 inline-block text-sm text-accent hover:underline" data-testid="link-origin-request">View approval request and sign-offs</Link>}
              </section>
              <section className="space-y-2">
                <h2 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Supporting documents ({d.attachments.length})</h2>
                <AttachmentList docs={d.attachments} />
              </section>
              <AppendAttachments
                existing={d.attachments.length}
                pending={attach.isPending}
                error={err}
                note="Files added after completion are kept for the record only. They do not change the approved terms, quantities, or certificates."
                onAttach={(docs, done) => {
                  setErr('');
                  attach.mutate({ id, data: { attachments: docs } }, {
                    onSuccess: (updated) => { done(); qc.setQueryData(getGetTransferQueryKey(id), updated); refreshRegistry(qc); },
                    onError: (e) => setErr(errMsg(e, 'Files could not be attached. Your uploads are kept; try again.')),
                  });
                }}
              />
            </>
          );
        })()}
      </div>
    </div>
  );
}
