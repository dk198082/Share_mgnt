import { useState } from 'react';
import { ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { useProtectedObject } from '@/lib/protected-object';
import { cn } from '@/lib/utils';

export function SignatureImage({ path, className, testId }: { path: string; className?: string; testId?: string }) {
  const [nonce, setNonce] = useState(0);
  const { url, loading, error } = useProtectedObject(path, nonce);
  return (
    <div className={cn('flex items-center justify-center overflow-hidden rounded border border-border bg-[hsl(44_45%_99%)]', className)} data-testid={testId}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        : error ? (
          <button type="button" onClick={() => setNonce((n) => n + 1)} title={`${error} Click to retry.`} className="flex items-center gap-1.5 px-2 text-[11px] text-destructive">
            <ImageOff className="h-3.5 w-3.5" /><RefreshCw className="h-3 w-3" />
          </button>
        ) : url ? <img src={url} alt="Digital signature" className="max-h-full max-w-full object-contain p-1" /> : null}
    </div>
  );
}
