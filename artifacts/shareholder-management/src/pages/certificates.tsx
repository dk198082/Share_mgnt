import { CertificatePdfList } from '@/components/certificate-pdfs';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useListAllCertificates, getListAllCertificatesQueryKey, type CertificateDirectoryEntry } from '@workspace/api-client-react';
import { AlertCircle, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { StatusPill } from '@/components/attachments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errMsg, nf } from '@/lib/format';
import { LIVE, fmtDay } from '@/lib/registry-sync';

function Holder({ c }: { c: CertificateDirectoryEntry }) {
  if (c.currentHolderId) return <Link href={`/shareholders/${c.currentHolderId}`} className="text-accent hover:underline">{c.currentHolderName}</Link>;
  return <span className="italic text-muted-foreground">No remaining holder</span>;
}

export default function Certificates() {
  const certs = useListAllCertificates({ query: { queryKey: getListAllCertificatesQueryKey(), ...LIVE } });
  const search = useSearch();
  const [, setLocation] = useLocation();
  const openId = new URLSearchParams(search).get('id');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [cls, setCls] = useState('all');

  const rows = useMemo(() => [...(certs.data ?? [])].sort((a, b) => a.shareClass.localeCompare(b.shareClass) || a.id.localeCompare(b.id, undefined, { numeric: true })), [certs.data]);
  const shown = rows.filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    if (cls !== 'all' && c.shareClass !== cls) return false;
    const s = q.trim().toLowerCase();
    if (/^[cp]-[1-9]\d*$/.test(s)) return c.id.toLowerCase() === s;
    return !s || [c.id, c.currentHolderName ?? '', c.currentHolderId ?? '', c.originalHolderName, c.originalHolderId, ...c.successors.map((x) => x.certificateId + ' ' + x.shareholderName)]
      .some((v) => v.toLowerCase().includes(s));
  });
  const detail = openId ? rows.find((c) => c.id === openId) : undefined;
  const open = (id: string | null) => setLocation(id ? `/certificates?id=${encodeURIComponent(id)}` : '/certificates', { replace: !id });

  return (
    <div>
      <PageHeader eyebrow="Registry" title="Certificates" />
      <div className="space-y-4 px-4 py-6 md:px-10">
        <p className="max-w-prose text-sm text-muted-foreground">Every Common (C-) and Preferred (P-) certificate ever issued, including transferred and cancelled ones. Fully transferred certificates have no remaining holder; follow the successor IDs to where the shares went.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Certificate ID or holder name" className="pl-9" data-testid="input-search-certificates" />
          </div>
          <Select value={status} onValueChange={setStatus}><SelectTrigger data-testid="select-cert-status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{['Outstanding', 'Partially Transferred', 'Transferred', 'Cancelled'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
          <Select value={cls} onValueChange={setCls}><SelectTrigger data-testid="select-cert-class"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All classes</SelectItem><SelectItem value="Common">Common</SelectItem><SelectItem value="Preferred">Preferred</SelectItem></SelectContent></Select>
        </div>
        <div className="text-xs text-muted-foreground tnum" data-testid="text-cert-count">{certs.isLoading ? 'Loading…' : `${shown.length} of ${rows.length} certificates`}</div>

        {certs.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        : certs.isError ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 py-8 text-sm">
            <AlertCircle className="h-5 w-5 text-destructive" /><span className="text-destructive">{errMsg(certs.error, 'Certificates could not be loaded.')}</span>
            <Button variant="outline" size="sm" onClick={() => certs.refetch()} data-testid="button-retry-certificates"><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{rows.length ? 'No certificates match these filters.' : 'No certificates have been issued yet.'}</div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card" role="region" aria-label="Certificate directory" tabIndex={0}>
            <table className="w-full min-w-[720px] text-sm" data-testid="table-all-certificates">
              <thead><tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                <th className="px-4 py-2 font-medium">Certificate</th><th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Current holder</th><th className="px-3 py-2 font-medium">Original holder</th>
                <th className="px-3 py-2 text-right font-medium">Remaining / original</th><th className="px-4 py-2 font-medium">Successors</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {shown.map((c) => (
                  <tr key={c.id} className="rise align-top" data-testid={`row-dir-${c.id}`}>
                    <td className="px-4 py-2.5"><button type="button" onClick={() => open(c.id)} className="font-mono text-accent hover:underline" data-testid={`button-open-cert-${c.id}`}>{c.id}</button><div className="text-[11px] text-muted-foreground">{c.shareClass} · {fmtDay(c.issueDate)}</div></td>
                    <td className="px-3 py-2.5"><StatusPill status={c.status} /></td>
                    <td className="px-3 py-2.5"><Holder c={c} /></td>
                    <td className="px-3 py-2.5"><Link href={`/shareholders/${c.originalHolderId}`} className="text-accent hover:underline">{c.originalHolderName}</Link></td>
                    <td className="px-3 py-2.5 text-right font-mono tnum">{nf.format(c.remainingQuantity)} / {nf.format(c.quantity)}</td>
                    <td className="px-4 py-2.5">
                      {c.successors.length ? <div className="flex flex-wrap gap-1.5">{c.successors.map((s) => (
                        <button key={s.certificateId} type="button" onClick={() => open(s.certificateId)} className="rounded-sm border border-border px-1.5 py-px font-mono text-[11px] hover:border-accent hover:text-accent" data-testid={`button-successor-${c.id}-${s.certificateId}`}>{s.certificateId}</button>
                      ))}</div> : <span className="text-xs text-muted-foreground">None</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!openId} onOpenChange={(o) => !o && open(null)}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Certificate <span className="font-mono">{openId}</span></DialogTitle>
            <DialogDescription>{detail ? 'Original quantity is retained; transfers reduce only the remaining balance.' : certs.isLoading ? 'Loading…' : 'This certificate is not in the directory.'}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm" data-testid="detail-directory-certificate">
              <CertificatePdfList certificateId={detail.id} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {([
                  ['Status', <StatusPill key="s" status={detail.status} />], ['Share class', detail.shareClass],
                  ['Original quantity', nf.format(detail.quantity)], ['Remaining', nf.format(detail.remainingQuantity)],
                  ['Transferred', nf.format(detail.transferredQuantity)], ['Issue date', fmtDay(detail.issueDate)],
                  ['Current holder', <Holder key="h" c={detail} />],
                  ['Original holder', <Link key="o" href={`/shareholders/${detail.originalHolderId}`} className="text-accent hover:underline">{detail.originalHolderName}</Link>],
                  ['Vesting', detail.vestingSchedule], ['Recorded', new Date(detail.createdAt).toLocaleDateString()],
                ] as const).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words tnum">{v}</dd></div>)}
              </dl>
              {detail.status === 'Partially Transferred' && detail.currentHolderName && <p className="text-xs text-muted-foreground">{detail.currentHolderName} holds the remaining {nf.format(detail.remainingQuantity)} shares on this certificate.</p>}
              {!detail.currentHolderId && detail.status === 'Transferred' && <p className="text-xs text-muted-foreground">All shares left this certificate. It is no longer held by {detail.originalHolderName} or anyone else.</p>}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Successor certificates</div>
                {detail.successors.length ? (
                  <ul className="divide-y divide-border rounded-md border border-border text-xs">
                    {detail.successors.map((s) => (
                      <li key={s.certificateId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <button type="button" onClick={() => open(s.certificateId)} className="font-mono text-accent hover:underline">{s.certificateId}</button>
                        <Link href={`/shareholders/${s.shareholderId}`} className="min-w-0 flex-1 truncate hover:underline">{s.shareholderName}</Link>
                        <span className="font-mono tnum">{nf.format(s.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-muted-foreground">No shares have been transferred from this certificate.</p>}
              </div>
              <Link href={`/transfers`} className="text-xs text-accent hover:underline">Search transfer history</Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
