import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileUp, Upload } from 'lucide-react';
import { useConfirm } from '../../context/ConfirmContext';
import {
  applyInvoiceCsvUpsert,
  downloadInvoiceCsvTemplate,
  parseInvoiceUpsertCsv,
  previewInvoiceCsvUpsert,
  type InvoiceCsvApplyBatchResult,
  type InvoiceCsvGrouped,
  type InvoiceCsvPreviewRow,
} from '../../lib/invoiceCsvUpsert';

type Phase = 'idle' | 'parsed' | 'preview' | 'applying' | 'done';

export const InvoiceCsvUpsertPanel: React.FC = () => {
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [groups, setGroups] = useState<InvoiceCsvGrouped[]>([]);
  const [rawRowCount, setRawRowCount] = useState(0);
  const [preview, setPreview] = useState<InvoiceCsvPreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<InvoiceCsvApplyBatchResult | null>(null);

  const counts = useMemo(() => {
    const summary = { create: 0, update: 0, error: 0, skip: 0 };
    for (const row of preview) {
      summary[row.action] += 1;
    }
    return summary;
  }, [preview]);

  const reset = () => {
    setPhase('idle');
    setError('');
    setFileName('');
    setGroups([]);
    setRawRowCount(0);
    setPreview([]);
    setProgress(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError('');
    setResult(null);
    setPreview([]);
    setProgress(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseInvoiceUpsertCsv(text);
      if (!parsed.groups.length) {
        throw new Error('CSV has no invoice rows.');
      }
      setGroups(parsed.groups);
      setRawRowCount(parsed.rawRowCount);
      setPhase('parsed');
    } catch (err) {
      reset();
      setError(err instanceof Error ? err.message : 'Could not parse CSV.');
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError('');
    try {
      const rows = await previewInvoiceCsvUpsert(groups);
      setPreview(rows);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry-run failed.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApply = async () => {
    const actionable = preview.filter(row => row.action === 'create' || row.action === 'update');
    if (!actionable.length) {
      setError('Nothing to apply — fix CSV errors first.');
      return;
    }
    const ok = await confirm({
      title: 'Apply invoice CSV upsert?',
      message: `This will create ${counts.create.toLocaleString()} and update ${counts.update.toLocaleString()} invoice(s) in Firestore. Line items are replaced when the CSV includes item columns. No Zoho API calls.`,
      confirmLabel: 'Apply upsert',
    });
    if (!ok) return;

    const applyGroups = groups.filter(group => {
      const row = preview.find(p => p.key === group.key);
      return row?.action === 'create' || row?.action === 'update';
    });

    setPhase('applying');
    setError('');
    setProgress({ done: 0, total: applyGroups.length });
    try {
      const totals = await applyInvoiceCsvUpsert(applyGroups, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(totals);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed.');
      setPhase('preview');
    }
  };

  const previewSample = preview.slice(0, 40);

  return (
    <div className="panel glass mb-6">
      <h2 className="mb-2">CSV upsert (no Zoho API)</h2>
      <p className="text-muted text-sm mb-4">
        Upload a Zoho-style export: <strong>one row per line item</strong>, with Invoice ID and
        Customer ID on every row. Existing invoices are updated; missing ones are created.
        Download the template for the exact column names we accept.
      </p>

      <div className="flex gap-3 flex-wrap mb-4">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => downloadInvoiceCsvTemplate()}
        >
          <Download size={14} />
          Download template
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={phase === 'applying'}
        >
          <Upload size={14} />
          {fileName ? 'Replace CSV' : 'Upload CSV'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain,.tsv,text/tab-separated-values"
          hidden
          onChange={e => {
            void handleFile(e.target.files?.[0] ?? null);
          }}
        />
        {(phase === 'parsed' || phase === 'preview' || phase === 'done') && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="products-inline-error mb-4" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {phase !== 'idle' && (
        <p className="text-sm mb-3">
          <FileUp size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {fileName || 'CSV'} — {rawRowCount.toLocaleString()} row(s),{' '}
          {groups.length.toLocaleString()} invoice(s)
        </p>
      )}

      {phase === 'parsed' && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={previewLoading}
          onClick={() => { void handlePreview(); }}
        >
          {previewLoading ? 'Checking…' : 'Dry-run preview'}
        </button>
      )}

      {(phase === 'preview' || phase === 'applying' || phase === 'done') && preview.length > 0 && (
        <>
          <div className="stats-grid stats-grid--4 mb-4 mt-4">
            <div className="stat-card glass">
              <h3>Create</h3>
              <div className="stat-value">{counts.create.toLocaleString()}</div>
            </div>
            <div className="stat-card glass">
              <h3>Update</h3>
              <div className="stat-value">{counts.update.toLocaleString()}</div>
            </div>
            <div className="stat-card glass">
              <h3>Errors</h3>
              <div className="stat-value">{counts.error.toLocaleString()}</div>
            </div>
            <div className="stat-card glass">
              <h3>Invoices</h3>
              <div className="stat-value">{preview.length.toLocaleString()}</div>
            </div>
          </div>

          <div className="table-wrap mb-4" style={{ maxHeight: 280, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Invoice #</th>
                  <th>Invoice ID</th>
                  <th>Customer ID</th>
                  <th>Lines</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {previewSample.map(row => (
                  <tr key={row.key}>
                    <td>{row.action}</td>
                    <td>{row.invoiceNumber ?? '—'}</td>
                    <td className="text-muted text-sm">{row.invoiceId ?? '—'}</td>
                    <td className="text-muted text-sm">{row.customerId ?? '—'}</td>
                    <td>{row.lineItemCount}</td>
                    <td className="text-muted text-sm">{row.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > previewSample.length && (
              <p className="text-muted text-sm mt-2 mb-0">
                Showing first {previewSample.length} of {preview.length.toLocaleString()} invoices.
              </p>
            )}
          </div>

          {phase === 'preview' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={counts.create + counts.update === 0}
              onClick={() => { void handleApply(); }}
            >
              Apply upsert
            </button>
          )}
        </>
      )}

      {phase === 'applying' && progress && (
        <p className="text-muted mt-3" role="status">
          Applying… {progress.done.toLocaleString()} / {progress.total.toLocaleString()} invoices
        </p>
      )}

      {phase === 'done' && result && (
        <div className="mt-4" role="status">
          <p className="mb-2">
            Done — created {result.created.toLocaleString()}, updated {result.updated.toLocaleString()}
            {result.failed ? `, failed ${result.failed.toLocaleString()}` : ''}.
          </p>
          {result.errors.length > 0 && (
            <ul className="text-muted text-sm" style={{ maxHeight: 160, overflow: 'auto' }}>
              {result.errors.slice(0, 30).map((err, idx) => (
                <li key={`${err.invoiceId}-${idx}`}>
                  {err.invoiceId ?? '—'} ({err.customerId ?? '—'}): {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
