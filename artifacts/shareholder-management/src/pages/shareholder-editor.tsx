import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateShareholder,
  useGetShareholder,
  useListCertificates,
  getListCertificatesQueryKey,
  useUpdateShareholder,
  getGetShareholderQueryKey,
  getListShareholdersQueryKey,
  getGetSummaryQueryKey,
  getListActivityQueryKey,
  type Document as Doc,
  type Shareholder,
  type ShareholderInput,
} from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, Camera, Eye, EyeOff, FileText, Loader2, Lock, RefreshCw, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errMsg, fileUrl, fmtBytes, initials, nf } from '@/lib/format';
import { HoldingsShares } from '@/components/holdings-shares';
import { ShareholderHistory } from '@/components/shareholder-history';
import { DOC_TYPES, IMAGE_TYPES, useUploader, validateFile } from '@/lib/upload';

type FormState = {
  name: string; email: string; dateOfBirth: string; dateOfPassing: string; address: string; phone: string;
  familyLine: string; generationNumber: string; financialNotes: string; picturePath: string;
  documents: Doc[];
};

const empty = (): FormState => ({
  name: '', email: '', dateOfBirth: '', dateOfPassing: '', address: '', phone: '', familyLine: '', generationNumber: '',
  financialNotes: '', picturePath: '', documents: [],
});
const fromRecord = (s: Shareholder): FormState => ({
  name: s.name, email: s.email ?? '', dateOfBirth: s.dateOfBirth?.slice(0, 10) ?? '', dateOfPassing: s.dateOfPassing?.slice(0, 10) ?? '',
  address: s.address ?? '', phone: s.phone ?? '', familyLine: s.familyLine ?? '', generationNumber: s.generationNumber ?? '',
  financialNotes: s.financialNotes ?? '', picturePath: s.picturePath ?? '', documents: s.documents,
});

const SECTIONS = [
  ['picture', 'Picture'], ['info', 'Shareholder information'], ['family', 'Family line'],
  ['financial', 'Shareholder Information'], ['shares', 'Holdings - Shares'], ['documents', 'Documents'],
] as const;

export default function ShareholderEditor() {
  const params = useParams<{ id?: string }>();
  const isNew = !params.id || params.id === 'new';
  const id = isNew ? '' : params.id!;
  const query = useGetShareholder(id, { query: { enabled: !isNew, queryKey: getGetShareholderQueryKey(id), staleTime: 30_000, refetchOnWindowFocus: true } });

  if (!isNew && query.isLoading) {
    return (
      <div className="space-y-4 p-10">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]"><Skeleton className="h-60" /><Skeleton className="h-[480px]" /></div>
      </div>
    );
  }
  if (!isNew && (query.isError || !query.data)) {
    const notFound = (query.error as { status?: number } | null)?.status === 404;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-10 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div className="font-display text-2xl">{notFound ? 'This record does not exist.' : "This record couldn't be loaded."}</div>
        <p className="text-sm text-muted-foreground">{notFound ? 'It may have been removed or the link is wrong.' : errMsg(query.error)}</p>
        <div className="flex gap-2">
          {!notFound && <Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>}
          <Link href="/shareholders" className="inline-flex items-center rounded-md px-4 py-2 text-sm text-accent hover:underline">Back to registry</Link>
        </div>
      </div>
    );
  }
  return <EditorForm key={id || 'new'} id={id} record={query.data} />;
}

function EditorForm({ id, record }: { id: string; record?: Shareholder }) {
  const isNew = !record;
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateShareholder();
  const update = useUpdateShareholder();
  const upload = useUploader();

  const [f, setF] = useState<FormState>(() => (record ? fromRecord(record) : empty()));
  const [ssn, setSsn] = useState('');
  const [showSsn, setShowSsn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [docBusy, setDocBusy] = useState<string[]>([]);
  const [docErrors, setDocErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [tab, setTab] = useState<'record' | 'history'>('record');
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  // Clear SSN from memory on unmount; it is never persisted anywhere in the browser.
  useEffect(() => () => setSsn(''), []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  // Form state is seeded once from the record; refetches below only feed share totals, never the form.
  const certs = useListCertificates(id, { query: { enabled: !isNew, queryKey: getListCertificatesQueryKey(id), staleTime: 30_000, refetchOnWindowFocus: true } });
  const total = certs.data?.totalShares ?? (record ? record.shares.reduce((a, h) => a + h.quantity, 0) : 0);
  const saving = create.isPending || update.isPending;
  const busy = saving || photoBusy || docBusy.length > 0;

  async function onPhoto(file?: File) {
    if (!file) return;
    setPhotoError('');
    const err = validateFile(file, IMAGE_TYPES);
    if (err) return setPhotoError(err);
    setPhotoBusy(true);
    try { set('picturePath', await upload(file)); }
    catch (e) { setPhotoError(errMsg(e, 'Photo upload failed.')); }
    finally { setPhotoBusy(false); }
  }

  async function onDocs(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files);
    const errs: string[] = [];
    const valid = list.filter((file) => { const e = validateFile(file, DOC_TYPES); if (e) errs.push(e); return !e; });
    setDocErrors(errs);
    setDocBusy((b) => [...b, ...valid.map((v) => v.name)]);
    await Promise.all(valid.map(async (file) => {
      try {
        const objectPath = await upload(file);
        setF((p) => ({ ...p, documents: [...p.documents, { name: file.name.slice(0, 255), objectPath, size: file.size }] }));
        setDirty(true);
      } catch (e) {
        setDocErrors((x) => [...x, `${file.name}: ${errMsg(e, 'upload failed')}`]);
      } finally {
        setDocBusy((b) => { const i = b.indexOf(file.name); return b.filter((_, j) => j !== i); });
      }
    }));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Name is required.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email.';
    if (ssn && !/^\d{3}-?\d{2}-?\d{4}$/.test(ssn.trim())) e.ssn = 'Use 9 digits, e.g. 123-45-6789.';
    if (f.dateOfBirth && f.dateOfPassing && f.dateOfPassing < f.dateOfBirth) e.dateOfPassing = 'Passing date is before birth date.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function save() {
    setSaveError('');
    if (!validate()) { toast({ title: 'Check the highlighted fields', variant: 'destructive' }); return; }
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const data: ShareholderInput = {
      name: f.name.trim(), email: opt(f.email), dateOfBirth: opt(f.dateOfBirth), dateOfPassing: opt(f.dateOfPassing),
      ssn: ssn.trim() || undefined, address: opt(f.address), phone: opt(f.phone), familyLine: opt(f.familyLine),
      generationNumber: opt(f.generationNumber), financialNotes: opt(f.financialNotes), picturePath: opt(f.picturePath),
      documents: f.documents,
    };
    const done = (s: Shareholder) => {
      setSsn('');
      setDirty(false);
      qc.setQueryData(getGetShareholderQueryKey(s.id), s);
      qc.invalidateQueries({ queryKey: getListShareholdersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetShareholderQueryKey(s.id) });
      qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].includes('/history') });
      toast({ title: isNew ? 'Shareholder created' : 'Changes saved', description: s.name });
      if (isNew) setLocation(`/shareholders/${s.id}`);
    };
    const fail = (e: unknown) => setSaveError(errMsg(e, 'The record could not be saved.'));
    if (isNew) create.mutate({ data }, { onSuccess: done, onError: fail });
    else update.mutate({ id, data }, { onSuccess: done, onError: fail });
  }

  return (
    <div className="pb-24">
      <div className="border-b border-border px-6 pb-5 pt-6 md:px-10">
        <Link href="/shareholders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="link-back"><ArrowLeft className="h-3.5 w-3.5" />Registry</Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-accent">{isNew ? 'New record' : `Gen. ${record.generationNumber || '—'} · ${record.familyLine || 'No family line'}`}</div>
            <h1 className="font-display text-3xl md:text-[34px]" data-testid="text-shareholder-name">{f.name || (isNew ? 'Untitled shareholder' : record.name)}</h1>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Total holding</div>
            <div className="font-display text-2xl tnum">{nf.format(total)} <span className="text-sm text-muted-foreground">shares</span></div>
          </div>
        </div>
        <div role="tablist" aria-label="Record views" className="-mb-5 mt-5 flex gap-6"
          onKeyDown={(e) => { if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !isNew) { const n = tab === 'record' ? 'history' : 'record'; setTab(n); document.getElementById(`tab-${n}`)?.focus(); } }}>
          {(['record', 'history'] as const).map((t) => {
            const sel = tab === t; const dis = t === 'history' && isNew;
            return (
              <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={sel} aria-controls={`panel-${t}`} tabIndex={sel ? 0 : -1}
                disabled={dis} title={dis ? 'Save the record first to see its history.' : undefined} onClick={() => setTab(t)}
                className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  sel ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} data-testid={`tab-${t}`}>
                {t === 'record' ? 'Record' : 'History'}
                {t === 'record' && dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="unsaved changes" />}
              </button>
            );
          })}
        </div>
        {isNew && <p className="mt-6 text-[11px] text-muted-foreground" data-testid="text-history-save-first">History becomes available after the record is created.</p>}
      </div>

      {tab === 'history' && !isNew && (
        <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="px-6 py-8 md:px-10">
          {dirty && (
            <div className="mb-5 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-4 py-3 text-sm" data-testid="banner-unsaved-draft">
              <span>You have unsaved edits on the record. They are kept as a draft and are not shown in history until saved.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setTab('record')} data-testid="button-back-to-record">Back to record</Button>
            </div>
          )}
          <ShareholderHistory shareholderId={id} active={tab === 'history'} />
        </div>
      )}

      <div id="panel-record" role="tabpanel" aria-labelledby="tab-record" hidden={tab !== 'record'} className="grid [&[hidden]]:hidden grid-cols-1 gap-8 px-6 py-8 md:px-10 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ol className="sticky top-8 space-y-1 border-l border-border">
            {SECTIONS.map(([k, label], i) => (
              <li key={k}>
                <a href={`#${k}`} onClick={(e) => { e.preventDefault(); document.getElementById(k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className="-ml-px flex gap-2 border-l-2 border-transparent py-1.5 pl-3 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground">
                  <span className="font-mono text-[11px] text-muted-foreground/70">0{i + 1}</span>{label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-6">
          <Section id="picture" n={1} title="Picture">
            <div className="flex items-center gap-5">
              <button type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy}
                className="group relative h-28 w-28 shrink-0 overflow-hidden rounded-full bg-primary/10 ring-1 ring-border transition hover:ring-2 hover:ring-accent" data-testid="button-upload-photo">
                {f.picturePath ? <img src={fileUrl(f.picturePath)} alt="Shareholder portrait" className="h-full w-full object-cover" data-testid="img-photo" />
                  : <span className="font-display text-3xl text-primary">{initials(f.name) || <Camera className="mx-auto h-7 w-7" />}</span>}
                <span className="absolute inset-0 flex items-center justify-center bg-primary/60 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {photoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                </span>
                {photoBusy && <span className="absolute inset-0 flex items-center justify-center bg-primary/60 text-primary-foreground"><Loader2 className="h-5 w-5 animate-spin" /></span>}
              </button>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">JPEG, PNG, or WebP up to 10 MB. Stored privately.</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => photoInput.current?.click()} disabled={photoBusy}>{f.picturePath ? 'Replace' : 'Upload photo'}</Button>
                  {f.picturePath && <Button type="button" variant="ghost" size="sm" onClick={() => set('picturePath', '')} data-testid="button-remove-photo">Remove</Button>}
                </div>
                {photoError && <p className="text-xs text-destructive" data-testid="text-photo-error">{photoError}</p>}
              </div>
              <input ref={photoInput} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Section>

          <Section id="info" n={2} title="Shareholder information">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={errors.name} className="sm:col-span-2">
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={200} data-testid="input-name" />
              </Field>
              <Field label="Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} data-testid="input-email" /></Field>
              <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={50} data-testid="input-phone" /></Field>
              <Field label="Date of birth"><Input type="date" value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} data-testid="input-dob" /></Field>
              <Field label="Date of passing" error={errors.dateOfPassing}><Input type="date" value={f.dateOfPassing} onChange={(e) => set('dateOfPassing', e.target.value)} data-testid="input-dop" /></Field>
              <Field label="Social Security Number" error={errors.ssn} className="sm:col-span-2"
                hint={record?.ssnMasked ? `On file: ${record.ssnMasked}. Leave blank to keep it.` : 'Encrypted on save. Only a masked value is ever shown.'}>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input type={showSsn ? 'text' : 'password'} value={ssn} onChange={(e) => { setSsn(e.target.value); setDirty(true); }}
                    autoComplete="off" name="ssn-entry" spellCheck={false} placeholder={record?.ssnMasked || '•••-••-••••'} className="pl-9 pr-10 font-mono" data-testid="input-ssn" />
                  <button type="button" onClick={() => setShowSsn((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Toggle SSN visibility">
                    {showSsn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Address" className="sm:col-span-2"><Textarea rows={3} value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={1000} data-testid="input-address" /></Field>
            </div>
          </Section>

          <Section id="family" n={3} title="Family line">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Family line"><Input value={f.familyLine} onChange={(e) => set('familyLine', e.target.value)} maxLength={200} data-testid="input-family-line" /></Field>
              <Field label="Generation number" hint="External ID"><Input value={f.generationNumber} onChange={(e) => set('generationNumber', e.target.value)} maxLength={100} className="font-mono" data-testid="input-generation" /></Field>
            </div>
          </Section>

          <Section id="financial" n={4} title="Shareholder Information">
            <Field label="Financial notes" hint={`${f.financialNotes.length} / 5000`}>
              <Textarea rows={5} value={f.financialNotes} onChange={(e) => set('financialNotes', e.target.value)} maxLength={5000} className="ruled leading-7" data-testid="input-financial-notes" />
            </Field>
          </Section>

          <Section id="shares" n={5} title="Holdings - Shares">
            {isNew ? (
              <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">Create the shareholder first, then issue certificates here.</div>
            ) : (
              <HoldingsShares shareholderId={id} ledger={certs.data} isLoading={certs.isLoading} isError={certs.isError} error={certs.error} onRetry={() => certs.refetch()} />
            )}
          </Section>

          <Section id="documents" n={6} title="Documents">
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onDocs(e.dataTransfer.files); }}
              onClick={() => docInput.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
                drag ? 'border-accent bg-accent/5' : 'border-border hover:border-primary/40 hover:bg-secondary/40')}
              data-testid="dropzone-documents"
            >
              <UploadCloud className={cn('h-7 w-7 transition-transform', drag ? '-translate-y-1 text-accent' : 'text-muted-foreground')} />
              <div className="mt-2 text-sm font-medium">Drop files here or click to browse</div>
              <div className="text-xs text-muted-foreground">PDF, JPEG, PNG, WebP, or plain text · 10 MB each</div>
              <input ref={docInput} type="file" multiple accept={DOC_TYPES.join(',')} className="hidden" onChange={(e) => { onDocs(e.target.files); e.target.value = ''; }} />
            </div>
            {docErrors.length > 0 && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <div className="flex justify-between"><span className="font-medium">Some files were not added</span><button onClick={() => setDocErrors([])}><X className="h-3.5 w-3.5" /></button></div>
                <ul className="mt-1 list-disc pl-4">{docErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <ul className="mt-3 divide-y divide-border">
              {docBusy.map((n, i) => (
                <li key={`busy-${i}`} className="flex items-center gap-3 py-2.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{n}<span className="ml-auto text-xs">Uploading</span></li>
              ))}
              {f.documents.map((d, i) => (
                <li key={d.objectPath} className="flex items-center gap-3 py-2.5 text-sm" data-testid={`doc-${i}`}>
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <a href={fileUrl(d.objectPath)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent hover:underline">{d.name}</a>
                  <span className="text-xs text-muted-foreground tnum">{fmtBytes(d.size)}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => set('documents', f.documents.filter((x) => x.objectPath !== d.objectPath))} aria-label="Remove document" data-testid={`button-remove-doc-${i}`}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
              {f.documents.length === 0 && docBusy.length === 0 && <li className="py-3 text-center text-xs text-muted-foreground">No documents attached.</li>}
            </ul>
          </Section>
        </div>
      </div>

      {tab === 'record' && <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur md:left-64">
        <div className="flex items-center justify-between gap-3 px-6 py-3 md:px-10">
          <div className="min-w-0 text-xs">
            {saveError ? <span className="text-destructive" data-testid="text-save-error">{saveError}</span>
              : busy && !saving ? <span className="text-muted-foreground">Waiting for uploads to finish…</span>
              : dirty ? <span className="flex items-center gap-2 text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Unsaved changes</span>
              : <span className="text-muted-foreground">{isNew ? 'Fill in at least a name to create the record.' : 'All changes saved.'}</span>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setLocation('/shareholders')} data-testid="button-cancel">Cancel</Button>
            <Button type="button" onClick={save} disabled={busy || (!dirty && !isNew)} data-testid="button-save">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isNew ? 'Create shareholder' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>}
    </div>
  );
}

function Section({ id, n, title, action, children }: { id: string; n: number; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-6 rounded-lg border border-card-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="flex items-baseline gap-3"><span className="font-mono text-[11px] text-accent">0{n}</span><span className="font-display text-lg">{title}</span></h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, error, required, className, children }: { label: string; hint?: string; error?: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-accent"> *</span>}</Label>
        {hint && !error && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
