import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAddSignoff, useRequestSignatureUpload, useUpdateSignoff, getListSignoffsQueryKey, type Signoff, type SignatureUploadInputContentType } from '@workspace/api-client-react';
import { Loader2, PenLine, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtBytes } from '@/lib/format';
import { SignatureImage } from './signature-image';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX = 2 * 1024 * 1024;

export function SignoffDialog({ open, editing, onClose }: { open: boolean; editing: Signoff | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const add = useAddSignoff();
  const update = useUpdateSignoff();
  const reqUpload = useRequestSignatureUpload();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState('');
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setName(editing?.name ?? ''); setEmail(editing?.email ?? ''); setFile(null); setFileErr(''); setErr(''); }
  }, [open, editing]);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const saving = add.isPending || update.isPending;
  const busy = saving || uploading;

  function pick(f?: File) {
    setFileErr('');
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setFileErr('Use a PNG, JPEG or WebP image.');
    if (f.size < 1) return setFileErr('That file is empty.');
    if (f.size > MAX) return setFileErr(`That image is ${fmtBytes(f.size)}; the limit is 2 MB.`);
    setFile(f);
  }

  async function submit() {
    setErr('');
    if (!name.trim()) return setErr('Name is required.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter a valid email address.');
    if (!editing && !file) return setErr('A signature image is required.');
    let signaturePath = editing?.signaturePath ?? '';
    if (file) {
      setUploading(true);
      try {
        const { uploadURL, objectPath } = await reqUpload.mutateAsync({ data: { name: file.name.slice(0, 255), size: file.size, contentType: file.type as SignatureUploadInputContentType } });
        const res = await fetch(uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!res.ok) throw new Error(`Storage rejected the image (${res.status}).`);
        signaturePath = objectPath;
      } catch (e) {
        setUploading(false);
        return setErr(errMsg(e, 'The signature could not be uploaded.'));
      }
      setUploading(false);
    }
    const data = { name: name.trim(), email: email.trim(), signaturePath,
      emailNotificationsEnabled: editing?.emailNotificationsEnabled ?? true };
    const opts = {
      onSuccess: (s: Signoff) => {
        qc.invalidateQueries({ queryKey: getListSignoffsQueryKey() });
        toast({ title: editing ? 'Sign-off updated' : 'Sign-off added', description: s.name });
        onClose();
      },
      onError: (e: unknown) => setErr(errMsg(e, 'The sign-off could not be saved.')),
    };
    if (editing) update.mutate({ id: editing.id, data }, opts);
    else add.mutate({ data }, opts);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">{editing ? 'Edit sign-off' : 'Add sign-off'}</DialogTitle>
          <DialogDescription>Adding someone here does not give them a login. Approval-request emails follow the checkbox setting in the sign-off list.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="so-name" className="text-xs text-muted-foreground">Name <span className="text-accent">*</span></Label>
              <Input id="so-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="input-signoff-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="so-email" className="text-xs text-muted-foreground">Email <span className="text-accent">*</span></Label>
              <Input id="so-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} data-testid="input-signoff-email" /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Digital signature {!editing && <span className="text-accent">*</span>}</Label>
            <div className="flex items-center gap-4 rounded-md border border-dashed border-border p-3">
              {preview ? <div className="flex h-20 w-44 items-center justify-center rounded border border-border bg-[hsl(44_45%_99%)]"><img src={preview} alt="New signature preview" className="max-h-full max-w-full object-contain p-1" data-testid="img-signature-preview" /></div>
                : editing ? <SignatureImage path={editing.signaturePath} className="h-20 w-44" />
                : <div className="flex h-20 w-44 items-center justify-center rounded bg-muted/60 text-muted-foreground"><PenLine className="h-5 w-5" /></div>}
              <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
                <p>PNG, JPEG or WebP up to 2 MB. Stored privately.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy} data-testid="button-pick-signature"><UploadCloud className="mr-1.5 h-3.5 w-3.5" />{file || editing ? 'Replace' : 'Choose image'}</Button>
                  {file && <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)} disabled={busy} data-testid="button-clear-signature">{editing ? 'Keep current' : 'Clear'}</Button>}
                </div>
                {file && <p className="truncate">{file.name} · {fmtBytes(file.size)}</p>}
              </div>
              <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-signature-file" />
            </div>
            {fileErr && <p className="text-xs text-destructive" data-testid="text-signature-file-error">{fileErr}</p>}
          </div>
          {err && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="text-signoff-error">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid="button-save-signoff">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{uploading ? 'Uploading…' : editing ? 'Save changes' : 'Add sign-off'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
