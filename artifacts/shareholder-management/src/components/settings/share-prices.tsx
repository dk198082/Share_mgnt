import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSharePrices, useSaveSharePrices, getGetSharePricesQueryKey } from '@workspace/api-client-react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDate } from '@/lib/format';
import { LoadError, Note, PanelHead } from './common';
import { PriceHistory } from './price-history';

const DEC = /^[0-9]{1,18}(\.[0-9]{1,6})?$/;
function check(v: string) {
  const t = v.trim();
  if (!t) return 'Required.';
  if (!DEC.test(t)) return 'Use digits with an optional decimal point: up to 18 whole digits and 6 decimals, no signs, commas or symbols.';
  return '';
}

export function SharePricesPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetSharePrices({ query: { queryKey: getGetSharePricesQueryKey(), refetchInterval: 60000 } });
  const save = useSaveSharePrices();
  const [common, setCommon] = useState('');
  const [preferred, setPreferred] = useState('');
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const seeded = useRef(false);

  useEffect(() => {
    if (q.data && (!seeded.current || !dirty)) {
      seeded.current = true;
      setCommon(q.data.common ?? '');
      setPreferred(q.data.preferred ?? '');
    }
  }, [q.data, dirty]);

  const ce = check(common), pe = check(preferred);
  const showErr = touched || dirty;

  function submit() {
    setTouched(true); setErr('');
    if (ce || pe) return;
    if (!effectiveDate) { setErr('Choose an effective date.'); return; }
    if (effectiveDate < new Date().toISOString().slice(0, 10) && !reason.trim()) { setErr('A reason is required for a backdated price.'); return; }
    save.mutate({ data: { common: common.trim(), preferred: preferred.trim(), effectiveDate, reason: reason.trim() } }, {
      onSuccess: (p) => {
        qc.setQueryData(getGetSharePricesQueryKey(), p);
        qc.invalidateQueries({ queryKey: getGetSharePricesQueryKey() });
        qc.invalidateQueries({ queryKey: ['/api/share-prices/history'] });
        qc.invalidateQueries({ queryKey: ['/api/share-prices'] });
        setDirty(false); setTouched(false);
        setCommon(p.common ?? ''); setPreferred(p.preferred ?? '');
        setReason('');
        toast({ title: 'Price history saved', description: `USD prices effective ${effectiveDate}. Current prices may differ from scheduled or backdated entries.` });
      },
      onError: (e) => setErr(errMsg(e, 'Share prices could not be saved.')),
    });
  }

  return (
    <div className="space-y-6">
      <PanelHead n="02" title="Share prices" sub="Current reference prices in US Dollars (USD). New entries preserve exact decimal strings."
        actions={<Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh-prices"><RefreshCw className={`mr-2 h-3.5 w-3.5 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh</Button>} />
      <Note>Changing these values does not alter prices recorded on past transfers, and it does not change who must approve. Every signer listed under Settings, Sign-offs must still approve each transfer and issuance.</Note>
      {q.isLoading ? <Skeleton className="h-60 max-w-2xl" />
        : q.isError ? <LoadError message={errMsg(q.error, 'Share prices could not be loaded.')} onRetry={() => q.refetch()} testId="error-prices" />
        : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="max-w-2xl rounded-lg border border-card-border bg-card">
            <div className="grid gap-px overflow-hidden rounded-t-lg bg-border sm:grid-cols-2">
              {([['common', 'Common', common, setCommon, ce, q.data?.common], ['preferred', 'Preferred', preferred, setPreferred, pe, q.data?.preferred]] as const).map(([k, label, val, setVal, e, saved]) => (
                <div key={k} className="space-y-2 bg-card p-5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor={`price-${k}`} className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label} <span className="text-accent">*</span></Label>
                    <span className="text-[11px] text-muted-foreground" data-testid={`text-saved-${k}`}>{saved == null ? 'Not set' : <>On file <span className="font-mono text-foreground">{saved}</span></>}</span>
                  </div>
                  <Input id={`price-${k}`} disabled={save.isPending} inputMode="decimal" autoComplete="off" placeholder="0.00" value={val} maxLength={25}
                    onChange={(ev) => { setVal(ev.target.value); setDirty(true); }} className="h-12 font-mono text-xl tnum" aria-invalid={!!(showErr && e)} data-testid={`input-price-${k}`} />
                  <p className="text-[11px] text-muted-foreground">per share</p>
                  {showErr && e && <p className="text-xs text-destructive" data-testid={`error-price-${k}`}>{e}</p>}
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t p-5">
              <Label htmlFor="price-effective-date">Effective date (UTC)</Label>
              <Input id="price-effective-date" disabled={save.isPending} type="date" value={effectiveDate} onChange={e => { setEffectiveDate(e.target.value); setDirty(true); }} data-testid="input-price-effective-date" />
              <Label htmlFor="price-reason">Reason (required when backdating)</Label>
              <Input id="price-reason" disabled={save.isPending} maxLength={2000} value={reason} onChange={e => { setReason(e.target.value); setDirty(true); }} data-testid="input-price-reason" />
              <p className="text-xs text-muted-foreground">Today’s prices are shown above. Each save appends an immutable entry for both classes. Future entries take effect on their date; backdated entries change reference lookups only.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <div className="text-xs">
                {err ? <span className="text-destructive" data-testid="text-prices-error">{err}</span>
                  : dirty ? <span className="text-accent">Unsaved changes</span>
                  : <span className="text-muted-foreground">{q.data?.updatedAt ? `Recorded ${fmtDate(q.data.updatedAt)} · Effective ${q.data.effectiveDate ?? 'unknown (legacy)'}` : 'Prices have not been set yet. Enter both to save.'}</span>}
              </div>
              <div className="flex gap-2">
                {dirty && <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={() => { setDirty(false); setTouched(false); setErr(''); setCommon(q.data?.common ?? ''); setPreferred(q.data?.preferred ?? ''); setReason(''); setEffectiveDate(new Date().toISOString().slice(0, 10)); }} data-testid="button-reset-prices">Discard</Button>}
                <Button type="submit" size="sm" disabled={save.isPending || !dirty} data-testid="button-save-prices">{save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Save prices</Button>
              </div>
            </div>
          </form>
        )}
      <PriceHistory />
    </div>
  );
}
