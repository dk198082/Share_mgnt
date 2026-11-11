import { useRef, useState } from 'react';
import type { Document } from '@workspace/api-client-react';
import { AlertCircle, Download, FileText, Loader2, Paperclip, RotateCcw, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DOC_TYPES, useUploader, validateFile } from '@/lib/upload';
import { errMsg, fileUrl, fmtBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export const MAX_ATTACHMENTS = 20;

type DraftItem = { key: string; file: File; status: 'uploading' | 'done' | 'error'; doc?: Document; error?: string };

/** Local, per-form attachment draft. Uploads start immediately; nothing is linked until the form submits. */
export function useAttachmentDraft(max: number, onEdit?: () => void) {
  const upload = useUploader();
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const [items, setItems] = useState<DraftItem[]>([]);
  const [notice, setNotice] = useState('');

  const patch = (key: string, p: Partial<DraftItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const run = (key: string, file: File) => {
    uploadRef.current(file)
      .then((objectPath) => patch(key, { status: 'done', error: undefined, doc: { name: file.name.slice(0, 255), objectPath, size: file.size } }))
      .catch((e) => patch(key, { status: 'error', error: errMsg(e, 'Upload failed.') }));
  };

  function add(files: FileList | File[]) {
    const msgs: string[] = [];
    const accepted: DraftItem[] = [];
    let room = max - items.length;
    for (const f of Array.from(files)) {
      const bad = validateFile(f, DOC_TYPES);
      if (bad) { msgs.push(bad); continue; }
      if (room <= 0) { msgs.push(`${f.name}: limit of ${max} more file${max === 1 ? '' : 's'} reached.`); continue; }
      room--;
      accepted.push({ key: crypto.randomUUID(), file: f, status: 'uploading' });
    }
    setNotice(msgs.join(' '));
    if (!accepted.length) return;
    setItems((l) => [...l, ...accepted]);
    accepted.forEach((i) => run(i.key, i.file));
    onEditRef.current?.();
  }
  function remove(key: string) { setItems((l) => l.filter((i) => i.key !== key)); setNotice(''); onEditRef.current?.(); }
  function retry(key: string) {
    const it = items.find((i) => i.key === key);
    if (!it) return;
    patch(key, { status: 'uploading', error: undefined });
    run(key, it.file);
    onEditRef.current?.();
  }
  function reset() { setItems([]); setNotice(''); }

  const docs = items.flatMap((i) => (i.status === 'done' && i.doc ? [i.doc] : []));
  return {
    items, notice, add, remove, retry, reset, docs, max,
    busy: items.some((i) => i.status === 'uploading'),
    failed: items.some((i) => i.status === 'error'),
  };
}
export type AttachmentDraft = ReturnType<typeof useAttachmentDraft>;

export function AttachmentDraftField({ draft, disabled, hint }: { draft: AttachmentDraft; disabled?: boolean; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = draft.items.length >= draft.max;
  return (
    <div className="space-y-2" data-testid="attachment-draft">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !full) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !full) draft.add(e.dataTransfer.files); }}
        className={cn('flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3 transition-colors', over ? 'border-accent bg-accent/5' : 'border-border bg-secondary/30')}
      >
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {hint ?? 'Supporting documents'} · PDF, JPEG, PNG, WebP or text, up to 10 MB each · {draft.items.length}/{draft.max}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled || full} onClick={() => input.current?.click()} data-testid="button-add-attachment">
          <Upload className="mr-1 h-3.5 w-3.5" />Add files
        </Button>
        <input ref={input} type="file" multiple hidden accept={DOC_TYPES.join(',')} onChange={(e) => { if (e.target.files) draft.add(e.target.files); e.target.value = ''; }} data-testid="input-attachment-file" />
      </div>
      {draft.notice && <p className="text-xs text-destructive" role="alert">{draft.notice}</p>}
      {draft.items.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-xs">
          {draft.items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 px-3 py-2" data-testid={`draft-attachment-${i.key}`}>
              {i.status === 'uploading' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                : i.status === 'error' ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                : <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <div className="truncate">{i.file.name}</div>
                <div className={cn('text-[11px]', i.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                  {i.status === 'uploading' ? 'Uploading…' : i.status === 'error' ? i.error : `${fmtBytes(i.file.size)} · uploaded, attaches on submit`}
                </div>
              </div>
              {i.status === 'error' && (
                <button type="button" disabled={disabled} onClick={() => draft.retry(i.key)} className="rounded p-1 text-muted-foreground hover:text-accent" aria-label={`Retry ${i.file.name}`} data-testid={`button-retry-attachment-${i.key}`}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="button" disabled={disabled} onClick={() => draft.remove(i.key)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove ${i.file.name}`} data-testid={`button-remove-attachment-${i.key}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DownloadButton({ doc }: { doc: Document }) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  async function go() {
    setError('');
    setPct(0);
    try {
      const res = await fetch(fileUrl(doc.objectPath), { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Not permitted.' : `Download failed (${res.status}).`);
      const total = Number(res.headers.get('content-length')) || doc.size || 0;
      let blob: Blob;
      if (res.body && total) {
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          setPct(Math.min(99, Math.round((got / total) * 100)));
        }
        blob = new Blob(chunks, { type: res.headers.get('content-type') ?? undefined });
      } else blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setPct(null);
    } catch (e) {
      setPct(null);
      setError(e instanceof Error ? e.message : 'Download failed.');
    }
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={go} disabled={pct !== null} data-testid={`button-download-${doc.objectPath}`}>
        {pct !== null ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{pct}%</> : <><Download className="mr-1 h-3.5 w-3.5" />{error ? 'Retry' : 'Download'}</>}
      </Button>
    </div>
  );
}

export function AttachmentList({ docs, empty = 'No supporting documents attached.' }: { docs: Document[]; empty?: string }) {
  if (!docs.length) return <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground" data-testid="attachments-empty">{empty}</div>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm" data-testid="list-attachments">
      {docs.map((d, i) => (
        <li key={d.objectPath + i} className="flex items-center gap-2 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate" title={d.name}>{d.name}</div>
            <div className="text-[11px] text-muted-foreground tnum">{fmtBytes(d.size)} · private</div>
          </div>
          <DownloadButton doc={d} />
        </li>
      ))}
    </ul>
  );
}

/** Append-only uploader for an existing record. */
export function AppendAttachments({ existing, onAttach, pending, error, note }: {
  existing: number; onAttach: (docs: Document[], done: () => void) => void; pending: boolean; error?: string; note: string;
}) {
  const draft = useAttachmentDraft(Math.max(0, MAX_ATTACHMENTS - existing));
  if (existing >= MAX_ATTACHMENTS) return <p className="text-xs text-muted-foreground">The limit of {MAX_ATTACHMENTS} files is reached.</p>;
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4" data-testid="append-attachments">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Append supporting files</div>
      <p className="text-xs text-muted-foreground">{note} Existing files cannot be removed.</p>
      <AttachmentDraftField draft={draft} disabled={pending} />
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="button" size="sm" disabled={pending || draft.busy || draft.failed || draft.docs.length === 0}
        onClick={() => onAttach(draft.docs, draft.reset)} data-testid="button-append-attachments">
        {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
        {draft.busy ? 'Waiting for uploads…' : draft.failed ? 'Retry or remove failed files' : `Attach ${draft.docs.length || ''} file${draft.docs.length === 1 ? '' : 's'}`}
      </Button>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = status === 'Pending' ? 'border-accent/40 bg-accent/10 text-accent'
    : status === 'Rejected' || status === 'Cancelled' ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : status === 'Transferred' ? 'border-border bg-muted text-muted-foreground'
    : 'border-primary/30 bg-primary/10 text-primary';
  return <span className={cn('inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-[10px] uppercase tracking-[0.12em]', tone)} data-testid={`status-${status}`}>{status}</span>;
}
