import { useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Lock, Upload, X } from 'lucide-react';
import {
  useGetLegacyImportStatus, useListLegacyImportRuns, useAnalyzeLegacyImport, useCommitLegacyImport,
  getGetLegacyImportStatusQueryKey, getListLegacyImportRunsQueryKey,
  type LegacyImportRun, type LegacyImportFile,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Note, LoadError, PanelHead } from './common';

const MAX_TOTAL = 5 * 1024 * 1024;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const errMsg = (e: unknown, fallback: string) => {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  return m || fallback;
};

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

const STATUS_STYLE: Record<string, string> = {
  ready: 'border-primary/25 bg-primary/[0.06] text-primary',
  blocked: 'border-destructive/30 bg-destructive/5 text-destructive',
  committed: 'border-border bg-muted text-foreground',
};
const STATUS_LABEL: Record<string, string> = { ready: 'Ready to commit', blocked: 'Blocked', committed: 'Committed' };

function StatusPill({ status }: { status: string }) {
  return <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium', STATUS_STYLE[status])} data-testid={`status-run-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function DataImportPanel() {
  const qc = useQueryClient();
  const status = useGetLegacyImportStatus({ query: { queryKey: getGetLegacyImportStatusQueryKey(), refetchInterval: 15000 } });
  const runs = useListLegacyImportRuns({ query: {
    enabled: status.data?.enabled === true,
    queryKey: getListLegacyImportRunsQueryKey(),
    refetchInterval: 15000,
  } });
  const analyze = useAnalyzeLegacyImport();
  const commit = useCommitLegacyImport();

  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [attest, setAttest] = useState(false);
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const enabled = status.data?.enabled === true;
  const syntheticOnly = status.data?.requiresSyntheticData !== false;
  const targetLabel = syntheticOnly ? "Preview" : "Azure production";
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const fileProblem = useMemo(() => {
    if (!files.length) return null;
    if (files.some((f) => !f.name.toLowerCase().endsWith('.xlsx'))) return 'Only .xlsx workbooks are accepted.';
    if (files.length < 3 || files.length > 7) return `Select 3 to 7 workbooks together (you selected ${files.length}). The standard Pulley export is six files.`;
    if (totalSize > MAX_TOTAL) return `Total size ${(totalSize / 1048576).toFixed(2)} MB exceeds the 5 MB limit.`;
    return null;
  }, [files, totalSize]);

  const runList = enabled ? (runs.data ?? []) : [];
  const selected = runList.find((r) => r.id === selectedId) ?? null;

  const onPick = (list: FileList | null) => {
    setFiles(list ? Array.from(list) : []);
    setAttest(false);
    setSelectedId(null); setAckWarnings(false); setLocalError(null); setCommitError(null); analyze.reset();
  };

  const stage = async () => {
    if (!enabled || fileProblem || !files.length || !attest || reading || analyze.isPending) return;
    setLocalError(null);
    setReading(true);
    let payload: LegacyImportFile[];
    try {
      payload = await Promise.all(files.map(async (f) => ({ name: f.name, base64: await readBase64(f) })));
    } catch (e) {
      setLocalError(errMsg(e, 'Could not read the selected files.')); setReading(false); return;
    }
    setReading(false);
    analyze.mutate({ data: { syntheticOnly, files: payload } }, {
      onSuccess: (run) => {
        qc.setQueryData<LegacyImportRun[]>(getListLegacyImportRunsQueryKey(), (old) => [run, ...(old ?? []).filter((r) => r.id !== run.id)]);
        qc.invalidateQueries({ queryKey: getListLegacyImportRunsQueryKey() });
        setSelectedId(run.id); setAckWarnings(false);
      },
    });
  };

  const doCommit = () => {
    if (!selected || commit.isPending) return;
    setCommitError(null);
    commit.mutate({ id: selected.id, data: { acknowledgeWarnings: true, syntheticOnly } }, {
      onSuccess: (run) => {
        setConfirmOpen(false);
        qc.setQueryData<LegacyImportRun[]>(getListLegacyImportRunsQueryKey(), (old) => (old ?? []).map((r) => (r.id === run.id ? run : r)));
        qc.invalidateQueries();
      },
      onError: (e) => { setConfirmOpen(false); setCommitError(errMsg(e, 'Commit failed. No changes were confirmed.')); },
    });
  };

  const busy = reading || analyze.isPending;

  return (
    <div className="space-y-8">
      <PanelHead n="05" title="Data import" sub="Stage Pulley exports, review validation and balance reconciliation, then explicitly confirm an add-only import."
        actions={enabled ? <Button variant="outline" size="sm" asChild><a href="/api/settings/data-import/template" download data-testid="link-import-template"><Download className="mr-2 h-3.5 w-3.5" />Optional history template</a></Button> : undefined} />

      <Note>
        <p className="font-medium text-foreground">How this import behaves</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>{syntheticOnly ? "Preview accepts fully anonymized samples only." : "Anyone signed into the Azure app can import. Source workbooks are retained privately in SharePoint; unresolved certificate owners block importing."}</li>
          <li>Staging creates a review run only. No live shareholder, certificate or transfer rows change until you commit.</li>
          <li>Securities whose owner cannot be identified are excluded and counted, not guessed.</li>
          <li>Incomplete transfer history is reported as an issue; missing transfers are never invented.</li>
          <li>Existing registry rows are preserved. There is no reset or delete from this screen.</li>
        </ul>
      </Note>

      {status.isLoading ? <Skeleton className="h-16 w-full" /> : status.isError ? (
        <LoadError message={errMsg(status.error, 'Could not load import availability.')} onRetry={() => qc.invalidateQueries({ queryKey: getGetLegacyImportStatusQueryKey() })} testId="error-import-status" />
      ) : (
        <div className={cn('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', enabled ? 'border-border bg-card' : 'border-accent/30 bg-accent/5')} data-testid="text-import-status">
          {enabled ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
          <div><span className="font-medium">{enabled ? 'Import available' : 'Import disabled'}</span><span className="ml-2 font-mono text-[11px] uppercase text-muted-foreground">{status.data?.environment}</span>
            <p className="text-foreground/75">{status.data?.message}</p></div>
        </div>
      )}

      {/* Step 1 */}
      <section className={cn('rounded-lg border border-card-border bg-card p-5 md:p-6', !enabled && 'opacity-60')} aria-disabled={!enabled}>
        <h3 className="font-display text-lg">1. Select workbooks</h3>
        <p className="mt-1 text-sm text-muted-foreground">Select all six Pulley exports at once (.xlsx, 3 to 7 files, 5 MB total).</p>
        <input ref={inputRef} type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
          disabled={!enabled || busy} onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} data-testid="input-import-files" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" disabled={!enabled || busy} onClick={() => inputRef.current?.click()} data-testid="button-choose-files"><FileSpreadsheet className="mr-2 h-4 w-4" />{files.length ? 'Choose different files' : 'Choose files'}</Button>
          {files.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => onPick(null)} data-testid="button-clear-files"><X className="mr-2 h-4 w-4" />Clear</Button>}
        </div>
        {files.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border text-sm" data-testid="list-selected-files">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2"><span className="min-w-0 truncate">{f.name}</span><span className="tnum shrink-0 font-mono text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span></li>
            ))}
            <li className="flex justify-between px-3 py-2 text-xs text-muted-foreground"><span>{files.length} files</span><span className="tnum font-mono">{(totalSize / 1048576).toFixed(2)} MB</span></li>
          </ul>
        )}
        {fileProblem && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive" data-testid="text-file-error"><AlertCircle className="h-4 w-4" />{fileProblem}</p>}
        <label className="mt-5 flex items-start gap-3 text-sm">
          <Checkbox checked={attest} disabled={!enabled || busy} onCheckedChange={(v) => setAttest(v === true)} className="mt-0.5" data-testid="checkbox-attest-anonymized" />
          <span>{syntheticOnly ? "I confirm these workbooks are fully anonymized synthetic data and contain no real personal information." : "I am authorized to process these legacy workbooks in Azure and have approval to stage this source data for review."}</span>
        </label>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button disabled={!enabled || !files.length || !!fileProblem || !attest || busy} onClick={stage} data-testid="button-stage-import">
            <Upload className="mr-2 h-4 w-4" />{reading ? 'Reading files…' : analyze.isPending ? 'Validating…' : 'Stage and validate'}
          </Button>
          <span className="text-xs text-muted-foreground">Creates a review run only.</span>
        </div>
        {(localError || analyze.isError) && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive" data-testid="text-stage-error"><AlertCircle className="h-4 w-4 shrink-0" />{localError ?? errMsg(analyze.error, 'Validation request failed.')}</p>}
      </section>

      {/* Step 2 */}
      {selected && (
        <RunDetail run={selected} ack={ackWarnings} setAck={setAckWarnings} enabled={enabled}
          committing={commit.isPending} commitError={commitError} onCommit={() => { setCommitError(null); setConfirmOpen(true); }} onClose={() => setSelectedId(null)} />
      )}

      {/* History */}
      <section>
        <h3 className="font-display text-lg">Run history</h3>
        <p className="mt-1 text-sm text-muted-foreground">Select a run to review its results.</p>
        <div className="mt-4">
          {!enabled ? <p className="text-sm text-muted-foreground">Import history is available only when importing is enabled and your account is authorized.</p>
            : runs.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            : runs.isError ? <LoadError message={errMsg(runs.error, 'Could not load import runs.')} onRetry={() => runs.refetch()} testId="error-import-runs" />
            : runList.length === 0 ? (
              <div className="ruled rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground" data-testid="empty-import-runs">No import runs yet. Staged runs will appear here and remain after reload.</div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-card-border bg-card">
                {runList.map((r) => {
                  const errs = r.issues.filter((i) => i.severity === 'error').length;
                  const warns = r.issues.length - errs;
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setSelectedId(r.id); setAckWarnings(false); setCommitError(null); }}
                        className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between', r.id === selectedId && 'bg-muted')}
                        data-testid={`row-import-run-${r.id}`}>
                        <span className="flex min-w-0 flex-wrap items-center gap-2"><StatusPill status={r.status} /><span className="truncate font-mono text-xs">{r.id}</span></span>
                        <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground"><span>{when(r.createdAt)}</span><span>{r.operator}</span><span className="tnum">{errs} errors, {warns} warnings</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !commit.isPending && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Commit this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected && <>This adds {fmt(selected.counts.shareholders)} shareholders, {fmt(selected.counts.certificates)} certificates and {fmt(selected.counts.transfers)} transfers to {targetLabel}. Existing rows are preserved. Confirm only if this production or sample load has been approved. This cannot be undone from this screen.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commit.isPending} data-testid="button-cancel-commit">Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={commit.isPending} onClick={(e) => { e.preventDefault(); doCommit(); }} data-testid="button-confirm-commit">{commit.isPending ? 'Committing…' : 'Commit import'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RunDetail({ run, ack, setAck, enabled, committing, commitError, onCommit, onClose }: {
  run: LegacyImportRun; ack: boolean; setAck: (v: boolean) => void; enabled: boolean; committing: boolean; commitError: string | null; onCommit: () => void; onClose: () => void;
}) {
  const errors = run.issues.filter((i) => i.severity === 'error');
  const warnings = run.issues.filter((i) => i.severity === 'warning');
  const mismatches = run.balances.filter((b) => !b.matches).length;
  const c = run.counts;
  const canCommit = enabled && run.status === 'ready' && errors.length === 0 && (warnings.length === 0 || ack) && !committing;

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `import-run-${run.id}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const stats: [string, number][] = [['Shareholders', c.shareholders], ['Certificates', c.certificates], ['Transfers', c.transfers], ['Common shares', c.commonShares], ['Preferred shares', c.preferredShares], ['Excluded securities', c.excludedSecurities]];

  return (
    <section className="rise rounded-lg border border-card-border bg-card p-5 md:p-6" data-testid="panel-run-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg">2. Review run</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusPill status={run.status} /><span className="font-mono">{run.id}</span><span>by {run.operator}</span><span>{when(run.createdAt)}</span>{run.committedAt && <span>committed {when(run.committedAt)}</span>}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadReport} data-testid="button-download-report"><Download className="mr-2 h-3.5 w-3.5" />Run report</Button>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close run" data-testid="button-close-run"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-3"><dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="tnum mt-1 font-display text-xl" data-testid={`text-count-${k.toLowerCase().replace(/\s/g, '-')}`}>{fmt(v)}</dd></div>
        ))}
      </dl>

      <div className="mt-6">
        <h4 className="text-sm font-semibold">Validation</h4>
        {run.issues.length === 0 ? <p className="mt-2 flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="h-4 w-4 text-primary" />No issues found.</p> : (
          <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
            {[...errors, ...warnings].map((i, idx) => (
              <li key={idx} className="flex gap-3 px-3 py-2.5" data-testid={`row-issue-${idx}`}>
                {i.severity === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
                <div className="min-w-0"><p>{i.message}</p><p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{i.code} · {i.location}</p></div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold">Balance reconciliation <span className="font-normal text-muted-foreground">({run.balances.length - mismatches} of {run.balances.length} match)</span></h4>
        {run.balances.length > 0 && (
          <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Holder ID</th><th className="px-3 py-2">Class</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Calculated</th><th className="px-3 py-2">Result</th></tr></thead>
              <tbody className="divide-y divide-border">
                {run.balances.map((b, i) => (
                  <tr key={i} className={cn(!b.matches && 'bg-destructive/5')} data-testid={`row-balance-${i}`}>
                    <td className="px-3 py-2 font-mono text-xs">{b.externalId}</td><td className="px-3 py-2">{b.shareClass}</td>
                    <td className="tnum px-3 py-2 text-right">{fmt(b.expected)}</td><td className="tnum px-3 py-2 text-right">{fmt(b.calculated)}</td>
                    <td className="px-3 py-2">{b.matches ? 'Match' : <span className="font-medium text-destructive">Differs by {fmt(b.calculated - b.expected)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Source files ({run.sources.length})</summary>
        <ul className="mt-2 space-y-1">{run.sources.map((s) => <li key={s.sha256 + s.name} className="flex flex-col sm:flex-row sm:gap-3"><span>{s.name}</span><span className="break-all font-mono text-[11px] text-muted-foreground">{s.sha256}</span></li>)}</ul>
      </details>

      {run.status === 'committed' ? (
        <div className="mt-6">
          <h4 className="text-sm font-semibold">Imported shareholders</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {run.shareholderIds.map((id) => <Link key={id} href={`/shareholders/${id}`} className="rounded border border-border px-2 py-1 font-mono text-xs hover:bg-muted" data-testid={`link-shareholder-${id}`}>{id}</Link>)}
            {run.shareholderIds.length === 0 && <span className="text-sm text-muted-foreground">No shareholders were added.</span>}
          </div>
        </div>
      ) : (
        <div className="mt-6 border-t border-border pt-5">
          <h4 className="font-display text-lg">3. Commit</h4>
          {run.status === 'blocked' || errors.length > 0 ? (
            <Note tone="warn" className="mt-2">This run is blocked by {errors.length} error{errors.length === 1 ? '' : 's'}. Correct the source workbooks and stage a new run.</Note>
          ) : (
            <>
              {warnings.length > 0 && (
                <label className="mt-3 flex items-start gap-3 text-sm">
                  <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} disabled={committing} className="mt-0.5" data-testid="checkbox-ack-warnings" />
                  <span>I have reviewed the {warnings.length} warning{warnings.length === 1 ? '' : 's'} above and accept them.</span>
                </label>
              )}
              <Button className="mt-4 w-full sm:w-auto" disabled={!canCommit} onClick={onCommit} data-testid="button-commit-import">{committing ? 'Committing…' : 'Commit import'}</Button>
            </>
          )}
          {commitError && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive" data-testid="text-commit-error"><AlertCircle className="h-4 w-4 shrink-0" />{commitError}</p>}
        </div>
      )}
    </section>
  );
}
