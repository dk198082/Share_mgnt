import { type ReactNode } from 'react';
import { AlertCircle, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ROLE_INFO: Record<string, { label: string; desc: string }> = {
  admin: { label: 'Administrator', desc: 'Full registry access plus Settings. Approves requests only when their verified email is a named signer in Settings, Sign-offs.' },
};
export const ROLE_ORDER = ['admin'] as const;
const LEGACY_ROLES = ['hr', 'finance', 'ceo', 'cfo'];
export const roleLabel = (r: string | null) => (r ? (r === 'admin' || LEGACY_ROLES.includes(r) ? 'Administrator' : r) : 'None');

export function Note({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warn'; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-md border px-4 py-3 text-[13px] leading-relaxed',
      tone === 'warn' ? 'border-accent/30 bg-accent/5' : 'border-primary/15 bg-primary/[0.04]', className)}>
      <Info className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-accent' : 'text-primary')} />
      <div className="text-foreground/80">{children}</div>
    </div>
  );
}

export function LoadError({ message, onRetry, testId }: { message: string; onRetry: () => void; testId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-6 py-10 text-center" data-testid={testId}>
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="max-w-md text-sm text-foreground/80">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} data-testid={`${testId}-retry`}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
    </div>
  );
}

export function PanelHead({ n, title, sub, actions }: { n: string; title: string; sub: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <div className="flex items-baseline gap-3"><span className="font-mono text-[11px] text-accent">{n}</span><h2 className="font-display text-2xl">{title}</h2></div>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
