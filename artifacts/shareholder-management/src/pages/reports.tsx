import { useMemo, useState } from 'react';
import { useListShareholders } from '@workspace/api-client-react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ReportType = 'detailed-cap-table' | 'shareholder-information' | 'shareholder-transactions';

const REPORTS: { id: ReportType; name: string; code: string; summary: string; points: string[] }[] = [
  {
    id: 'detailed-cap-table',
    name: 'Detailed Cap Table',
    code: '01',
    summary: 'Ownership position of every shareholder as of a chosen date, from recorded certificates.',
    points: [
      'Sheets: Summary, Ownership, C-Common, PS-Preferred, Voting Ownership and Notes.',
      'Fully diluted figures count recorded shares only, one for one — no assumed options or conversions.',
      'Authorized limits, voting rights, options and capital contributions are not tracked; those columns stay blank and the Notes sheet explains why.',
    ],
  },
  {
    id: 'shareholder-information',
    name: 'Shareholder Information Report',
    code: '02',
    summary: 'Current profile for each shareholder — the latest recorded fields, not a historical view.',
    points: [
      'Includes full address and contact details as currently on file.',
      'SSNs are always masked; full numbers never leave the registry.',
      'Always generated as of today.',
    ],
  },
  {
    id: 'shareholder-transactions',
    name: 'Shareholder Transaction Report',
    code: '03',
    summary: 'Actual issued certificates and completed transfers in and out, with running balances.',
    points: [
      'Pending or rejected requests are excluded — only completed activity appears.',
      'Run for every shareholder, or narrow to one.',
      'Running balances are computed through the as-of date.',
    ],
  },
];

const todayUtc = () => new Date().toISOString().slice(0, 10);

function validateDate(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Enter a valid date (YYYY-MM-DD).';
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'That date does not exist.';
  if (v > todayUtc()) return 'The as-of date cannot be in the future.';
  return null;
}

function filenameFrom(header: string | null, fallback: string): string {
  if (header) {
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
    if (star) {
      try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
    if (plain) return plain[1].trim();
  }
  return fallback;
}

async function errorMessage(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      detail = String(j.error ?? j.message ?? j.detail ?? '').trim();
    } catch { detail = ''; }
  } catch { /* ignore */ }
  if (res.status === 401) return 'Your session has expired. Sign in again and retry.';
  if (res.status === 403) return detail || 'Only administrators can run reports.';
  if (res.status === 503) return detail || 'The report service is temporarily unavailable. Try again in a moment.';
  if (res.status === 400 || res.status === 422) return detail || 'The report options were rejected. Check the date and shareholder.';
  return detail || `Report failed (HTTP ${res.status}).`;
}

type Result = { kind: 'success'; filename: string; size: number } | { kind: 'error'; message: string } | null;

export default function Reports() {
  const [selected, setSelected] = useState<ReportType>('detailed-cap-table');
  const [asOf, setAsOf] = useState(todayUtc);
  const [shareholderId, setShareholderId] = useState('all');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const report = REPORTS.find((r) => r.id === selected)!;
  const usesDate = selected !== 'shareholder-information';
  const dateError = usesDate ? validateDate(asOf) : null;

  async function run() {
    if (pending || dateError) return;
    setPending(true);
    setResult(null);
    const date = usesDate ? asOf : todayUtc();
    const body: { asOfDate?: string; shareholderId?: string } = { asOfDate: date };
    if (selected === 'shareholder-transactions' && shareholderId !== 'all') body.shareholderId = shareholderId;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json' };
      const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/reports/${selected}/export`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
      if (!res.ok) { setResult({ kind: 'error', message: await errorMessage(res) }); return; }
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct.includes('json') || ct.startsWith('text/')) { setResult({ kind: 'error', message: 'The server did not return a spreadsheet. Try again.' }); return; }
      const blob = await res.blob();
      if (blob.size === 0) { setResult({ kind: 'error', message: 'The server returned an empty file. Try again.' }); return; }
      const sig = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      if (sig[0] !== 0x50 || sig[1] !== 0x4b) { setResult({ kind: 'error', message: 'The downloaded file is not a valid Excel workbook.' }); return; }
      const filename = filenameFrom(res.headers.get('content-disposition'), `${selected}-${date}.xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setResult({ kind: 'success', filename, size: blob.size });
    } catch {
      setResult({ kind: 'error', message: 'Network error — the report could not be reached. Check your connection and retry.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Registry exports" title="Reports" />
      <div className="grid gap-8 px-6 pt-8 md:px-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Report type" className="space-y-3" data-testid="list-reports">
          <p className="max-w-xl text-sm text-muted-foreground">Each report is built from a single consistent snapshot of the registry and downloads as an Excel workbook stamped with who generated it and when.</p>
          {REPORTS.map((r) => {
            const on = r.id === selected;
            return (
              <button key={r.id} type="button" onClick={() => { setSelected(r.id); setResult(null); }} aria-pressed={on}
                data-testid={`button-report-${r.id}`}
                className={cn('group flex w-full gap-5 rounded-lg border p-5 text-left transition-colors', on ? 'border-primary/60 bg-card shadow-sm' : 'border-border bg-card/50 hover:border-primary/30 hover:bg-card')}>
                <span className={cn('font-display text-2xl tabular-nums', on ? 'text-accent' : 'text-muted-foreground/60')}>{r.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-xl text-foreground">{r.name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{r.summary}</span>
                  {on && (
                    <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[13px] text-foreground/80">
                      {r.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />{p}</li>)}
                    </ul>
                  )}
                </span>
                <FileSpreadsheet className={cn('h-5 w-5 shrink-0', on ? 'text-primary' : 'text-muted-foreground/50')} />
              </button>
            );
          })}
        </section>

        <aside className="h-fit rounded-lg border border-border bg-card p-6 lg:sticky lg:top-8" data-testid="panel-report-options">
          <div className="text-[11px] uppercase tracking-[0.2em] text-accent">Options</div>
          <div className="mt-1 font-display text-xl" data-testid="text-selected-report">{report.name}</div>

          <div className="mt-5 space-y-5">
            {usesDate ? (
              <label className="block">
                <span className="text-sm font-medium">As of date</span>
                <input type="date" value={asOf} max={todayUtc()} onChange={(e) => setAsOf(e.target.value)}
                  className={cn('mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring', dateError ? 'border-destructive' : 'border-input')}
                  data-testid="input-as-of-date" aria-invalid={!!dateError} />
                {dateError ? <span className="mt-1 block text-xs text-destructive" data-testid="text-date-error">{dateError}</span>
                  : <span className="mt-1 block text-xs text-muted-foreground">Dates are in UTC. Today or earlier.</span>}
              </label>
            ) : (
              <div className="rounded-md bg-muted/60 px-3 py-2.5 text-sm" data-testid="text-info-date">
                Current profiles as of <span className="font-medium tabular-nums">{todayUtc()}</span> (UTC). Historical profiles aren't available.
              </div>
            )}

            {selected === 'shareholder-transactions' && <ShareholderSelect value={shareholderId} onChange={setShareholderId} />}
          </div>

          <button type="button" onClick={run} disabled={pending || !!dateError}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-run-report">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {pending ? 'Generating workbook…' : 'Run & download .xlsx'}
          </button>

          {result?.kind === 'success' && (
            <div className="mt-4 flex gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm" data-testid="status-report-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0"><div className="font-medium">Downloaded</div><div className="truncate text-xs text-muted-foreground" data-testid="text-report-filename">{result.filename} · {(result.size / 1024).toFixed(1)} KB</div></div>
            </div>
          )}
          {result?.kind === 'error' && (
            <div className="mt-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert" data-testid="status-report-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1">{result.message}</div>
              <button type="button" onClick={run} disabled={pending || !!dateError} className="text-xs text-accent hover:underline" data-testid="button-retry-report">Retry</button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ShareholderSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useListShareholders();
  const sorted = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [q.data]);
  return (
    <label className="block">
      <span className="text-sm font-medium">Shareholder</span>
      {q.isLoading ? <Skeleton className="mt-1.5 h-9 w-full" data-testid="skeleton-shareholders" />
        : q.isError ? (
          <div className="mt-1.5 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs" data-testid="error-shareholders">
            Couldn't load shareholders. Report will include all.
            <button type="button" onClick={() => q.refetch()} className="flex items-center gap-1 text-accent hover:underline" data-testid="button-retry-shareholders"><RotateCw className="h-3 w-3" />Retry</button>
          </div>
        ) : (
          <>
            <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" data-testid="select-shareholder">
              <option value="all">All shareholders</option>
              {sorted.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {sorted.length === 0 && <span className="mt-1 block text-xs text-muted-foreground" data-testid="text-shareholders-empty">No shareholders recorded yet.</span>}
          </>
        )}
    </label>
  );
}
