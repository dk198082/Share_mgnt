import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetPilotDataStatus, useImportPilotData, getGetPilotDataStatusQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg } from '@/lib/format';
import { PanelHead, Note, LoadError } from './common';

export function PilotDataPanel() {
  const query = useGetPilotDataStatus({ query: { queryKey: getGetPilotDataStatusQueryKey(), staleTime: 0, refetchOnWindowFocus: true } });
  const mutation = useImportPilotData();
  const cache = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const imported = query.data?.state === 'imported' || !!mutation.data;
  async function runImport() {
    if (!confirmed || mutation.isPending || imported || query.data?.state !== 'available') return;
    setMessage('');
    try {
      const result = await mutation.mutateAsync({ data: { confirmation: 'IMPORT FICTIONAL PILOT DATA' } });
      setMessage(result.alreadyImported ? 'The pilot data is already present. No duplicates were added.' : 'Imported 12 pilot Shareholders, 27 certificates and 3 example transfers. Existing records were preserved.');
      await cache.invalidateQueries();
    } catch (error) {
      setMessage(errMsg(error, 'Could not confirm the import. Refresh its status before trying again. Retrying is safe and will not add duplicates.'));
      await query.refetch();
    }
  }
  return (
    <div className="max-w-3xl space-y-6">
      <PanelHead n="05" title="Pilot data" sub="Add the original fictional Shareholder dataset to this app’s database without replacing existing records." />
      <Note tone="warn">
        This adds 12 fictional Shareholders, with both Common and Preferred holdings, 24 opening certificates and 3 example transfers (27 certificates in total).
        Their 21,450 shares are included in totals and reports. No SSNs, employee approvals, emails or legal certificate PDFs are created.
      </Note>
      <p className="text-sm text-muted-foreground">To make the samples visible to Kathy and other pilot participants, run this in the published app after republishing—not in Preview. Certificate numbers are allocated from that database’s current counters.</p>
      {query.isLoading ? <Skeleton className="h-28 w-full" /> : query.isError ?
        <LoadError message={errMsg(query.error, 'Could not check pilot-data status.')} onRetry={() => query.refetch()} testId="error-pilot-data" /> : (
        <div className="space-y-5 rounded-lg border border-border bg-card p-5">
          <p className="text-sm" data-testid="pilot-data-status">
            {imported ? 'All 12 pilot Shareholders are already present in this database. No import is needed.' :
              query.data?.state === 'conflict' ? `${query.data.pilotShareholders} pilot Shareholders were found, but the import record is incomplete or conflicting. Nothing will be overwritten; review the existing data before continuing.` :
              'The original pilot dataset has not been imported into this database.'}
          </p>
          {!imported && query.data?.state === 'available' && (
            <>
              <div className="flex items-start gap-3">
                <Checkbox id="confirm-pilot-data" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={mutation.isPending} data-testid="checkbox-pilot-data" />
                <label htmlFor="confirm-pilot-data" className="cursor-pointer text-sm leading-snug">I understand these records are fictional and their holdings will be included in totals and reports.</label>
              </div>
              <Button onClick={runImport} disabled={!confirmed || mutation.isPending} data-testid="button-import-pilot-data">
                {mutation.isPending ? 'Importing pilot data…' : 'Import 12 pilot Shareholders'}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={mutation.isPending || query.isFetching} data-testid="button-refresh-pilot-data">Refresh status</Button>
        </div>
      )}
      {message && <p className="text-sm" role="status" data-testid="pilot-data-result">{message}</p>}
    </div>
  );
}
