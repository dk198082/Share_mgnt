import { useEffect, useState } from 'react';
import { useListCertificatePdfs, getListCertificatePdfsQueryKey, type ListCertificatePdfsParams } from '@workspace/api-client-react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { errMsg } from '@/lib/format';

export function PdfButton({ path, label, filename }: { path: string; label: string; filename: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let blobUrl = '';
    setError(''); setUrl('');
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api${path}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`The PDF could not be loaded (${res.status}).`);
        blobUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setUrl(blobUrl);
        else URL.revokeObjectURL(blobUrl);
      } catch (e) { if (!cancelled) setError(errMsg(e, 'PDF unavailable.')); }
    })();
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [open, path]);
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={`view-pdf-${filename}`}><FileText className="mr-1 h-4 w-4" />{label}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-5xl w-[95vw]">
        <DialogHeader><DialogTitle>{filename}</DialogTitle><DialogDescription>Private certificate document. Download if your browser does not display PDFs.</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-destructive">{error}</p> : !url ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <>
          <a href={url} download={filename} className="text-sm text-accent underline" data-testid="download-certificate-pdf">Download PDF</a>
          <iframe title={filename} src={url} className="h-[65vh] w-full rounded border border-border" />
        </>}
      </DialogContent>
    </Dialog>
  </>;
}

export function CertificatePdfList({ shareholderId, certificateId, transferId, requestId }: ListCertificatePdfsParams) {
  // Do not forward JSX instrumentation or other incidental component props to the API.
  const params = { shareholderId, certificateId, transferId, requestId };
  const query = useListCertificatePdfs(params, { query: { queryKey: getListCertificatePdfsQueryKey(params), staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 60_000 } });
  return <section className="mb-5 space-y-3 rounded-lg border border-border bg-card p-4" data-testid="certificate-pdf-history">
    <div><h2 className="font-display text-lg">Certificate PDFs</h2><p className="text-xs text-muted-foreground">Retained at completion using the request's template and recorded approval signatures.</p></div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading PDFs…</p> : query.isError ? <div role="alert" className="text-sm text-destructive">Certificate PDFs could not be loaded. <button className="underline" onClick={() => query.refetch()}>Retry</button></div> : !query.data?.length ? <p className="text-xs text-muted-foreground">No retained certificate PDFs. Earlier transactions are not recreated from today's information.</p> : <div className="space-y-2">
      {query.data.map(doc => <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <div><span className="font-mono text-sm">{doc.certificateId}</span><span className="ml-2 text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleString()}</span></div>
        <PdfButton path={`/certificate-pdfs/${doc.id}`} filename={`${doc.certificateId}.pdf`} label="View certificate" />
      </div>)}
    </div>}
  </section>;
}
