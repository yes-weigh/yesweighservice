import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Upload, Wrench } from 'lucide-react';
import { useConfirm } from '../../../context/ConfirmContext';
import {
  applyBulkCatalogSkuUpdates,
  newSkusWithDuplicatesInBatch,
  skuHasNonUppercaseAlphanumericChars,
} from '../../../lib/catalog';
import type { CatalogProduct } from '../../../types/catalog';

export interface BulkSkuRow {
  id: string;
  oldSku: string;
  newProposedSku: string;
  itemName: string;
  productId: string | null;
  matchError: string | null;
}

type BulkFilter = 'all' | 'invalid' | 'duplicates';

const BULK_FILTERS: { id: BulkFilter; label: string }[] = [
  { id: 'all', label: 'All rows' },
  { id: 'invalid', label: 'Invalid chars' },
  { id: 'duplicates', label: 'Duplicates' },
];

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseBulkSkuCsv(text: string): Omit<BulkSkuRow, 'productId' | 'matchError'>[] {
  const normalized = text.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const delimiter = (lines[0].match(/\t/g) ?? []).length >= (lines[0].match(/,/g) ?? []).length
    ? '\t'
    : ',';
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);

  const oldIdx = headers.findIndex(h => h === 'old sku' || h === 'oldsku');
  const newIdx = headers.findIndex(h =>
    h === 'new proposed sku' || h === 'new sku' || h === 'newproposedsku',
  );
  const nameIdx = headers.findIndex(h =>
    h === 'item name' || h === 'name' || h === 'itemname',
  );

  if (oldIdx < 0 || newIdx < 0 || nameIdx < 0) {
    throw new Error('CSV must include columns: Old SKU, New Proposed SKU, Item Name.');
  }

  const rows: Omit<BulkSkuRow, 'productId' | 'matchError'>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i], delimiter);
    const oldSku = String(cells[oldIdx] ?? '').trim();
    const newProposedSku = String(cells[newIdx] ?? '').trim();
    const itemName = String(cells[nameIdx] ?? '').trim();
    if (!oldSku && !newProposedSku && !itemName) continue;
    rows.push({
      id: `row-${i}`,
      oldSku,
      newProposedSku,
      itemName,
    });
  }
  return rows;
}

function resolveProductForRow(
  row: Pick<BulkSkuRow, 'oldSku' | 'itemName'>,
  products: CatalogProduct[],
): { productId: string | null; matchError: string | null } {
  const oldSku = row.oldSku.trim();
  if (!oldSku) {
    return { productId: null, matchError: 'Old SKU is empty.' };
  }

  const matches = products.filter(p => (p.sku ?? '').trim() === oldSku);
  if (matches.length === 0) {
    return { productId: null, matchError: 'No catalog item matches this Old SKU.' };
  }
  if (matches.length === 1) {
    return { productId: matches[0].id, matchError: null };
  }

  const itemName = row.itemName.trim().toLowerCase();
  if (itemName) {
    const nameMatches = matches.filter(p => p.name.trim().toLowerCase() === itemName);
    if (nameMatches.length === 1) {
      return { productId: nameMatches[0].id, matchError: null };
    }
    if (nameMatches.length > 1) {
      return { productId: null, matchError: 'Multiple catalog items match Old SKU and Item Name.' };
    }
  }

  return {
    productId: null,
    matchError: `Multiple catalog items share Old SKU "${oldSku}" — set Item Name to disambiguate.`,
  };
}

function attachCatalogMatches(
  rows: Omit<BulkSkuRow, 'productId' | 'matchError'>[],
  products: CatalogProduct[],
): BulkSkuRow[] {
  return rows.map(row => {
    const { productId, matchError } = resolveProductForRow(row, products);
    return { ...row, productId, matchError };
  });
}

function buildBulkUpdateCsv(rows: BulkSkuRow[]): string {
  const headers = ['Old SKU', 'New Proposed SKU', 'Item Name'];
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.oldSku,
      row.newProposedSku,
      row.itemName,
    ].map(escapeCsvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BulkUpdateSkuSectionProps {
  products: CatalogProduct[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onClearMessages: () => void;
}

export const BulkUpdateSkuSection: React.FC<BulkUpdateSkuSectionProps> = ({
  products,
  loading,
  onRefresh,
  onError,
  onSuccess,
  onClearMessages,
}) => {
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [baseRows, setBaseRows] = useState<Omit<BulkSkuRow, 'productId' | 'matchError'>[]>([]);
  const [filter, setFilter] = useState<BulkFilter>('all');
  const [uploadError, setUploadError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState('');

  const rows = useMemo(
    () => (baseRows.length > 0 ? attachCatalogMatches(baseRows, products) : []),
    [baseRows, products],
  );

  const duplicateNewSkus = useMemo(
    () => newSkusWithDuplicatesInBatch(rows.map(r => r.newProposedSku)),
    [rows],
  );

  const invalidCount = useMemo(
    () => rows.filter(r =>
      r.newProposedSku.trim() !== '' && skuHasNonUppercaseAlphanumericChars(r.newProposedSku),
    ).length,
    [rows],
  );

  const duplicateCount = useMemo(() => duplicateNewSkus.size, [duplicateNewSkus]);

  const unmatchedCount = useMemo(
    () => rows.filter(r => !r.productId || r.matchError).length,
    [rows],
  );

  const rowsNeedingUpdate = useMemo(
    () => rows.filter(r =>
      r.productId
      && !r.matchError
      && r.oldSku.trim() !== r.newProposedSku.trim()
      && r.newProposedSku.trim() !== ''
      && !skuHasNonUppercaseAlphanumericChars(r.newProposedSku)
      && !duplicateNewSkus.has(r.newProposedSku.trim()),
    ),
    [rows, duplicateNewSkus],
  );

  const filterCounts = useMemo(() => ({
    all: rows.length,
    invalid: invalidCount,
    duplicates: rows.filter(r => duplicateNewSkus.has(r.newProposedSku.trim())).length,
  }), [rows.length, invalidCount, duplicateNewSkus, rows]);

  const filteredRows = useMemo(() => {
    if (filter === 'invalid') {
      return rows.filter(r =>
        r.newProposedSku.trim() !== '' && skuHasNonUppercaseAlphanumericChars(r.newProposedSku),
      );
    }
    if (filter === 'duplicates') {
      return rows.filter(r => duplicateNewSkus.has(r.newProposedSku.trim()));
    }
    return rows;
  }, [rows, filter, duplicateNewSkus]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    onClearMessages();
    setUploadError('');
    try {
      const text = await file.text();
      const parsed = parseBulkSkuCsv(text);
      if (parsed.length === 0) {
        setUploadError('CSV has no data rows.');
        setBaseRows([]);
        return;
      }
      setBaseRows(parsed);
      setFilter('all');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not parse CSV.');
      setBaseRows([]);
    }
  }, [onClearMessages]);

  const updateRow = useCallback((id: string, patch: Partial<Pick<BulkSkuRow, 'oldSku' | 'newProposedSku' | 'itemName'>>) => {
    setBaseRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)));
    onClearMessages();
  }, [onClearMessages]);

  const handleBulkUpdate = async () => {
    if (updating || rows.length === 0) return;

    if (invalidCount > 0) {
      onError(`${invalidCount} row${invalidCount === 1 ? '' : 's'} have invalid characters in New Proposed SKU. Fix them before updating.`);
      return;
    }
    if (duplicateCount > 0) {
      onError(`${duplicateCount} duplicate New Proposed SKU value${duplicateCount === 1 ? '' : 's'} in the batch. Fix them before updating.`);
      return;
    }
    if (unmatchedCount > 0) {
      onError(`${unmatchedCount} row${unmatchedCount === 1 ? '' : 's'} could not be matched to a catalog item. Fix Old SKU / Item Name first.`);
      return;
    }
    if (rowsNeedingUpdate.length === 0) {
      onError('No rows need a SKU change — Old SKU and New Proposed SKU are the same for every row.');
      return;
    }

    const ok = await confirm({
      title: 'Bulk update SKUs?',
      message:
        `This will download a backup CSV, then update ${rowsNeedingUpdate.length} item SKU${rowsNeedingUpdate.length === 1 ? '' : 's'} on Zoho `
        + '(~1.5s per SKU to avoid rate limits). Leave this tab open. '
        + 'If Zoho blocks mid-run, wait a few minutes and run bulk update again for the rest.',
      confirmLabel: 'Bulk update',
      destructive: true,
    });
    if (!ok) return;

    setUpdating(true);
    onClearMessages();
    setUpdateProgress('Downloading backup CSV…');

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadCsv(`bulk-sku-update-${timestamp}.csv`, buildBulkUpdateCsv(rows));

    await sleep(400);
    setUpdateProgress(`Updating 0 of ${rowsNeedingUpdate.length}…`);

    try {
      const result = await applyBulkCatalogSkuUpdates(
        rowsNeedingUpdate.map(row => ({
          productId: row.productId!,
          name: row.itemName.trim() || products.find(p => p.id === row.productId)?.name || '',
          newSku: row.newProposedSku.trim(),
          oldSku: row.oldSku.trim(),
        })),
      );

      await onRefresh();

      const parts = [
        `Updated ${result.updatedCount} of ${result.total} SKU${result.total === 1 ? '' : 's'} on Zoho.`,
      ];
      if (result.skippedCount && result.skippedCount > 0) {
        parts.push(
          `${result.skippedCount} skipped after Zoho rate limit — wait a few minutes, then bulk update again.`,
        );
      }
      if (result.failedCount > 0) {
        const sample = result.failed.slice(0, 3)
          .map(row => `${row.oldSku ?? '(blank)'} → ${row.newSku}: ${row.error}`)
          .join(' · ');
        parts.push(`${result.failedCount} failed${sample ? ` (${sample})` : ''}.`);
      }

      if (result.rateLimited || result.failedCount > 0) {
        onError(parts.join(' '));
      } else {
        onSuccess(parts.join(' '));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not apply bulk SKU updates.');
    } finally {
      setUpdating(false);
      setUpdateProgress('');
    }
  };

  return (
    <div className="settings-sku-bulk">
      <p className="text-muted text-sm settings-sku-bulk__intro">
        Upload a CSV with columns <code>Old SKU</code>, <code>New Proposed SKU</code>, and <code>Item Name</code>.
        Review invalid characters and duplicate values on the proposed SKUs, edit rows as needed, then bulk update.
      </p>

      <div className="settings-sku-bulk__upload-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="settings-sku-bulk__file-input"
          onChange={e => void handleFileChange(e)}
          disabled={loading || updating}
        />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading || updating}
        >
          <Upload size={15} aria-hidden />
          Upload CSV
        </button>
        {rows.length > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleBulkUpdate()}
            disabled={loading || updating || rowsNeedingUpdate.length === 0}
          >
            {updating
              ? <RefreshCw size={15} className="spin-icon" aria-hidden />
              : <Wrench size={15} aria-hidden />}
            {updating ? 'Updating…' : 'Bulk update'}
          </button>
        )}
      </div>

      {uploadError && (
        <p className="settings-locations__error" role="alert">{uploadError}</p>
      )}
      {updateProgress && (
        <p className="settings-sku-bulk__progress text-muted text-sm" role="status">{updateProgress}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="settings-sku-correction__subtabs" role="tablist" aria-label="Bulk SKU filters">
            {BULK_FILTERS.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={`settings-sku-correction__subtab ${filter === tab.id ? 'is-active' : ''}`}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
                <span className="settings-sku-correction__subtab-count">{filterCounts[tab.id]}</span>
              </button>
            ))}
          </div>

          <p className="settings-sku-correction__meta text-muted text-sm">
            {rows.length} row{rows.length === 1 ? '' : 's'}
            {rowsNeedingUpdate.length > 0 ? ` · ${rowsNeedingUpdate.length} to update` : ''}
            {unmatchedCount > 0 ? ` · ${unmatchedCount} unmatched` : ''}
          </p>

          <div className="settings-logistics__table-wrap settings-sku-correction__table-wrap">
            <table className="settings-logistics__table settings-sku-correction__table settings-sku-bulk__table">
              <thead>
                <tr>
                  <th scope="col">Old SKU</th>
                  <th scope="col">New Proposed SKU</th>
                  <th scope="col">Item Name</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const hasInvalid = row.newProposedSku.trim() !== ''
                    && skuHasNonUppercaseAlphanumericChars(row.newProposedSku);
                  const isDuplicate = duplicateNewSkus.has(row.newProposedSku.trim());
                  const noChange = row.oldSku.trim() === row.newProposedSku.trim();
                  return (
                    <tr
                      key={row.id}
                      className={
                        row.matchError
                          ? 'settings-sku-bulk__row--error'
                          : hasInvalid || isDuplicate
                            ? 'settings-sku-bulk__row--warn'
                            : undefined
                      }
                    >
                      <td>
                        <input
                          type="text"
                          className="settings-sku-bulk__cell-input"
                          value={row.oldSku}
                          onChange={e => updateRow(row.id, { oldSku: e.target.value })}
                          disabled={updating}
                          aria-label="Old SKU"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className={`settings-sku-bulk__cell-input ${
                            hasInvalid ? 'settings-sku-bulk__cell-input--invalid' : ''
                          } ${isDuplicate ? 'settings-sku-bulk__cell-input--duplicate' : ''}`}
                          value={row.newProposedSku}
                          onChange={e => updateRow(row.id, { newProposedSku: e.target.value })}
                          disabled={updating}
                          aria-label="New Proposed SKU"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="settings-sku-bulk__cell-input"
                          value={row.itemName}
                          onChange={e => updateRow(row.id, { itemName: e.target.value })}
                          disabled={updating}
                          aria-label="Item Name"
                        />
                      </td>
                      <td>
                        {row.matchError ? (
                          <span className="settings-sku-bulk__status settings-sku-bulk__status--error">
                            {row.matchError}
                          </span>
                        ) : hasInvalid ? (
                          <span className="settings-sku-bulk__status settings-sku-bulk__status--warn">
                            Invalid chars
                          </span>
                        ) : isDuplicate ? (
                          <span className="settings-sku-bulk__status settings-sku-bulk__status--warn">
                            Duplicate
                          </span>
                        ) : noChange ? (
                          <span className="settings-sku-bulk__status text-muted">No change</span>
                        ) : (
                          <span className="settings-sku-bulk__status settings-sku-bulk__status--ok">
                            <CheckCircle2 size={14} aria-hidden />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 && (
            <div className="settings-locations__empty">
              <AlertTriangle size={28} aria-hidden />
              <p>No rows match this filter.</p>
            </div>
          )}
        </>
      )}

      {rows.length === 0 && !uploadError && (
        <div className="settings-sku-bulk__dropzone">
          <Upload size={32} aria-hidden />
          <p>Upload a CSV to preview SKU changes before applying them to Zoho.</p>
        </div>
      )}
    </div>
  );
};
