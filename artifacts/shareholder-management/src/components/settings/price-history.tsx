import { useState } from 'react';
import { useListSharePriceHistory, useLookupSharePrices, getListSharePriceHistoryQueryKey, getLookupSharePricesQueryKey } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errMsg, fmtDate } from '@/lib/format';
import { LoadError, Note } from './common';

export function PriceHistory() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const history = useListSharePriceHistory({ query: { queryKey: getListSharePriceHistoryQueryKey(), refetchInterval: 60000 } });
  const lookup = useLookupSharePrices({ date }, { query: { queryKey: getLookupSharePricesQueryKey({ date }), enabled: /^\d{4}-\d{2}-\d{2}$/.test(date), refetchInterval: 60000 } });
  return <section className="space-y-4" aria-label="Historical share prices">
    <h2 className="font-display text-xl">Price history · USD</h2>
    <Note>Reference only. Transfers, approvals by the named signers in Settings, and dilution calculations are unchanged. Dates use UTC calendar days. For multiple entries effective on the same day, the last recorded entry applies. Corrections are new entries; earlier entries cannot be edited or deleted.</Note>
    <div className="max-w-2xl space-y-3 rounded-lg border bg-card p-5">
      <Label htmlFor="lookup-price-date">Prices effective on</Label>
      <Input id="lookup-price-date" type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-lookup-price-date" />
      {!date ? <p>Choose a date.</p> : lookup.isFetching ? <p>Loading prices…</p> : lookup.isError
        ? <LoadError message={errMsg(lookup.error, 'Prices could not be looked up.')} onRetry={() => lookup.refetch()} testId="error-price-lookup" />
        : <div aria-live="polite" data-testid="text-price-lookup">
          {lookup.data?.effectiveDate ? <>
            <p>Common: <span className="font-mono">{lookup.data.common}</span> USD per share</p>
            <p>Preferred: <span className="font-mono">{lookup.data.preferred}</span> USD per share</p>
            <p className="text-xs text-muted-foreground">Effective {lookup.data.effectiveDate}</p>
          </> : <p>No dated price is known for this date. Undated legacy values are not used for historical lookups.</p>}
        </div>}
    </div>
    {history.isLoading ? <p>Loading history…</p> : history.isError
      ? <LoadError message={errMsg(history.error, 'History could not be loaded.')} onRetry={() => history.refetch()} testId="error-price-history" />
      : !history.data?.length ? <p className="text-sm text-muted-foreground">No prices have been recorded.</p>
      : <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm" data-testid="table-price-history">
          <thead className="bg-muted"><tr>{['Effective date', 'Common (USD)', 'Preferred (USD)', 'Recorded', 'Recorded by', 'Reason'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead>
          <tbody>{history.data.map(p => <tr key={p.id} className="border-t">
            <td className="whitespace-nowrap p-3">{p.effectiveDate ?? 'Unknown — legacy'}{p.effectiveDate && p.effectiveDate > new Date().toISOString().slice(0, 10) && <span className="block text-xs text-muted-foreground">Scheduled</span>}</td>
            <td className="p-3 font-mono">{p.common ?? 'Not set'}</td><td className="p-3 font-mono">{p.preferred ?? 'Not set'}</td>
            <td className="whitespace-nowrap p-3">{fmtDate(p.recordedAt)}</td><td className="p-3">{p.recordedBy}{p.legacy && <span className="block text-xs text-muted-foreground">Legacy identity; name not recorded</span>}</td>
            <td className="min-w-48 whitespace-pre-wrap break-words p-3">{p.reason ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
