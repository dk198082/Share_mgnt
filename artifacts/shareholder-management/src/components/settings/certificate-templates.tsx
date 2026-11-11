import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListCertificateTemplates, useSaveCertificateTemplate, getListCertificateTemplatesQueryKey } from '@workspace/api-client-react';
import { FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUploader, validateFile } from '@/lib/upload';
import { errMsg } from '@/lib/format';
import { PdfButton } from '@/components/certificate-pdfs';

export function CertificateTemplatesPanel() {
  const templates = useListCertificateTemplates({ query: { queryKey: getListCertificateTemplatesQueryKey(), staleTime: 0, refetchOnWindowFocus: true } });
  const save = useSaveCertificateTemplate();
  const upload = useUploader();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function replace(shareClass: 'Common' | 'Preferred', file?: File) {
    if (!file) return;
    setError('');
    const invalid = validateFile(file, ['application/pdf']);
    if (invalid) { setError(invalid); return; }
    setBusy(shareClass);
    try {
      const objectPath = await upload(file);
      await save.mutateAsync({ data: { shareClass, objectPath, name: file.name } });
      await qc.invalidateQueries({ queryKey: getListCertificateTemplatesQueryKey() });
    } catch (e) { setError(errMsg(e, 'Template could not be saved. The previous version is still active.')); }
    finally { setBusy(''); }
  }
  return <div className="max-w-5xl space-y-6" data-testid="certificate-templates-panel">
    <div><h2 className="font-display text-2xl">Certificate templates</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Upload a blank, editable PDF for each share class. New requests capture the active template version. Completed PDFs include recorded approval signatures and are retained in transaction and shareholder history. Replacements never overwrite earlier templates or completed certificates.</p></div>
    <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">The supplied templates preserve Common's $100 par value and Preferred's $80 par value and reverse-side terms. Par value is not the Settings share price. Original holders, dates, certificate numbers and signatures have been removed. Signer titles are not inferred.</p>
    {error && <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {templates.isError ? <div role="alert">Templates could not be loaded. <Button variant="outline" onClick={() => templates.refetch()}>Retry</Button></div> : <div className="grid gap-5 md:grid-cols-2">
      {(['Common', 'Preferred'] as const).map(shareClass => {
        const current = templates.data?.find(t => t.shareClass === shareClass && t.active);
        return <section key={shareClass} className="space-y-4 rounded-lg border border-border bg-card p-5" data-testid={`template-${shareClass}`}>
          <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-accent" /><h3 className="font-display text-xl">{shareClass}</h3></div>
          {templates.isLoading ? <p>Loading…</p> : current ? <div className="space-y-2"><p className="break-words text-sm font-medium">{current.name}</p><p className="text-xs text-muted-foreground">Active · uploaded {new Date(current.createdAt).toLocaleString()}</p><PdfButton path={`/settings/certificate-templates/${current.id}/pdf`} filename={`${shareClass}-blank.pdf`} label="View / download blank PDF" /></div> : <p className="text-sm text-muted-foreground">No active template. Upload one before submitting new {shareClass} issuance or transfer requests.</p>}
          <label className="block cursor-pointer rounded-md border border-dashed border-border p-4 text-sm hover:bg-secondary/40">
            <span className="mb-2 flex items-center gap-2"><Upload className="h-4 w-4" />{busy === shareClass ? 'Uploading and validating…' : current ? 'Upload replacement PDF' : 'Upload blank PDF'}</span>
            <input type="file" accept="application/pdf" disabled={!!busy || templates.isLoading} data-testid={`upload-template-${shareClass}`} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void replace(shareClass, file); }} className="block w-full text-xs" />
          </label>
        </section>;
      })}
    </div>}
    <details className="rounded-md border border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Editable PDF field requirements</summary><p className="mt-3">PDF only, up to 10 MB and 10 pages. Clear all form values first. Use standard text fields named certificateId, quantity, holderName (or certificateIntro), issueDate (or witnessText), signature1 and signer1Name. Optional shareClass, signature2 and signer2Name are supported; additional approved signers receive an appendix. Download the supplied blank templates as a starting point. Keep each class's legal terms in its own template.</p></details>
    {!!templates.data?.some(t => !t.active) && <section className="space-y-3"><h3 className="font-display text-lg">Retained earlier versions</h3>{templates.data.filter(t => !t.active).map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3 text-sm"><span>{t.shareClass} · {t.name} · {new Date(t.createdAt).toLocaleString()}</span><PdfButton path={`/settings/certificate-templates/${t.id}/pdf`} filename={`${t.shareClass}-earlier-blank.pdf`} label="View earlier version" /></div>)}</section>}
  </div>;
}
