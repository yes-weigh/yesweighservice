import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, Download, RefreshCw, Search, Tag, Wrench } from 'lucide-react';
import { useConfirm } from '../../../context/ConfirmContext';
import { isLocalhostDev } from '../../../lib/isLocalhost';
import {
  applyCatalogSkuRepairs,
  fetchAllCatalogProductsForSkuCorrection,
  groupCatalogProductsByDuplicateSku,
  proposeCorrectedSkus,
  skuHasNonUppercaseAlphanumericChars,
} from '../../../lib/catalog';
import type { CatalogProduct } from '../../../types/catalog';
import { fillSearchFromScan, SkuScanButton } from '../../../components/catalog/SkuScanButton';
import { BulkUpdateSkuSection } from './BulkUpdateSkuSection';

type SkuSubTab = 'all' | 'special' | 'duplicates' | 'bulk';

const SUB_TABS: { id: SkuSubTab; label: string }[] = [
  { id: 'all', label: 'All SKUs' },
  { id: 'special', label: 'Invalid chars' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'bulk', label: 'Bulk update SKU' },
];

const CSV_FILENAMES: Record<Exclude<SkuSubTab, 'bulk'>, string> = {
  all: 'sku-all.csv',
  special: 'sku-invalid-chars.csv',
  duplicates: 'sku-duplicates.csv',
};

function skuDisplay(sku: string | null | undefined): string {
  const value = sku ?? '';
  return value === '' ? '(blank)' : value;
}

/** Issues for SKUs that are not only 0-9 and A-Z. */
function highlightSkuIssues(sku: string | null | undefined): string[] {
  const value = String(sku ?? '');
  const issues: string[] = [];
  if (/[a-z]/.test(value)) issues.push('Lowercase');
  if (/\s/.test(value)) issues.push('Space');
  if (/[^0-9A-Za-z\s]/.test(value)) issues.push('Special');
  return issues;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildSkuCorrectionCsv(
  tab: Exclude<SkuSubTab, 'bulk'>,
  rows: CatalogProduct[],
  duplicateCountBySku: Map<string, number>,
  proposedSkus: Map<string, string>,
): string {
  const headers = tab === 'special'
    ? ['Old SKU', 'New SKU', 'Issue', 'Name', 'Category', 'Status']
    : ['SKU', 'Name', 'Category', 'Status'];
  if (tab === 'duplicates') headers.push('Duplicate Count');

  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const product of rows) {
    const cells = tab === 'special'
      ? [
          product.sku ?? '',
          proposedSkus.get(product.id) ?? '',
          highlightSkuIssues(product.sku).join('; '),
          product.name ?? '',
          product.categoryName?.trim() ?? '',
          product.status ?? '',
        ]
      : [
          product.sku ?? '',
          product.name ?? '',
          product.categoryName?.trim() ?? '',
          product.status ?? '',
        ];
    if (tab === 'duplicates') {
      cells.push(String(duplicateCountBySku.get(product.sku ?? '') ?? 0));
    }
    lines.push(cells.map(cell => escapeCsvCell(String(cell))).join(','));
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

export const SkuCorrectionTab: React.FC = () => {
  const confirm = useConfirm();
  const allowed = isLocalhostDev();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subTab, setSubTab] = useState<SkuSubTab>('all');
  const [search, setSearch] = useState('');
  const [applying, setApplying] = useState(false);

  const loadAll = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const items = await fetchAllCatalogProductsForSkuCorrection();
      setProducts(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load catalog SKUs.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const specialProducts = useMemo(
    () => products.filter(p => skuHasNonUppercaseAlphanumericChars(p.sku)),
    [products],
  );

  const proposedSkus = useMemo(
    () => proposeCorrectedSkus(products),
    [products],
  );

  const duplicateGroups = useMemo(
    () => groupCatalogProductsByDuplicateSku(products),
    [products],
  );

  const duplicateProducts = useMemo(() => {
    const rows: CatalogProduct[] = [];
    const sortedKeys = [...duplicateGroups.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
    for (const key of sortedKeys) {
      const group = duplicateGroups.get(key) ?? [];
      rows.push(...group);
    }
    return rows;
  }, [duplicateGroups]);

  const duplicateCountBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, group] of duplicateGroups) {
      map.set(key, group.length);
    }
    return map;
  }, [duplicateGroups]);

  const tabCounts = useMemo(() => ({
    all: products.length,
    special: specialProducts.length,
    duplicates: duplicateGroups.size,
    bulk: 0,
  }), [products.length, specialProducts.length, duplicateGroups.size]);

  const sourceRows = useMemo(() => {
    if (subTab === 'bulk') return [];
    if (subTab === 'special') return specialProducts;
    if (subTab === 'duplicates') return duplicateProducts;
    return products;
  }, [subTab, products, specialProducts, duplicateProducts]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sourceRows;
    return sourceRows.filter(p => {
      const sku = (p.sku ?? '').toLowerCase();
      const name = p.name.toLowerCase();
      const category = (p.categoryName ?? '').toLowerCase();
      return sku.includes(q) || name.includes(q) || category.includes(q) || p.id.includes(q);
    });
  }, [sourceRows, search]);

  const handleDownloadCsv = () => {
    if (subTab === 'bulk' || sourceRows.length === 0) return;
    const csv = buildSkuCorrectionCsv(subTab, sourceRows, duplicateCountBySku, proposedSkus);
    downloadCsv(CSV_FILENAMES[subTab], csv);
  };

  const handleApplyAllRepairs = async () => {
    if (!allowed || applying || specialProducts.length === 0) return;

    const ok = await confirm({
      title: 'Apply all SKU repairs?',
      message:
        `This will update ${specialProducts.length} item SKU${specialProducts.length === 1 ? '' : 's'} on Zoho `
        + 'using the New SKU values, then refresh the Firestore catalog cache. '
        + 'Large batches run slowly (~1.5s per SKU) to avoid Zoho rate limits — leave this tab open. '
        + 'If Zoho blocks mid-run, wait a few minutes and Apply again for the rest. This cannot be undone from here.',
      confirmLabel: 'Apply all repairs',
      destructive: true,
    });
    if (!ok) return;

    setApplying(true);
    setError('');
    setSuccess('');
    try {
      const result = await applyCatalogSkuRepairs();
      await loadAll();
      const parts = [
        `Updated ${result.updatedCount} of ${result.total} SKU${result.total === 1 ? '' : 's'} on Zoho.`,
      ];
      if (result.skippedCount && result.skippedCount > 0) {
        parts.push(
          `${result.skippedCount} skipped after Zoho rate limit — wait a few minutes, then Apply again.`,
        );
      }
      if (result.failedCount > 0) {
        const sample = result.failed.slice(0, 3)
          .map(row => `${row.oldSku ?? '(blank)'} → ${row.newSku}: ${row.error}`)
          .join(' · ');
        parts.push(`${result.failedCount} failed${sample ? ` (${sample})` : ''}.`);
      }
      if (result.rateLimited || (result.failedCount > 0 && (result.skippedCount ?? 0) > 0)) {
        setError(parts.join(' '));
        setSuccess('');
      } else if (result.failedCount > 0) {
        setError(parts.join(' '));
        setSuccess('');
      } else {
        setSuccess(parts.join(' '));
        setError('');
      }
      setSubTab('special');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply SKU repairs.');
    } finally {
      setApplying(false);
    }
  };

  if (!allowed) {
    return (
      <section className="settings-locations panel glass">
        <p className="text-muted text-sm">SKU correction is only available on localhost.</p>
      </section>
    );
  }

  return (
    <section className="settings-locations panel glass settings-sku-correction">
      <header className="settings-locations__header">
        <div>
          <h3>SKU correction</h3>
          <p className="text-muted text-sm">
            Review Zoho-synced SKUs. Open an item to edit SKU (pushes to Zoho).
            Invalid chars lists SKUs that are not only <code>0-9</code> and <code>A-Z</code>
            (includes lowercase, spaces, hyphens, and other symbols).
            New SKU strips invalid characters, uppercases letters, and appends
            <code>2</code>, <code>3</code>, … when needed so proposals stay unique.
          </p>
        </div>
        <div className="settings-sku-correction__header-actions">
          {subTab === 'special' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleApplyAllRepairs()}
              disabled={loading || applying || specialProducts.length === 0}
            >
              {applying
                ? <RefreshCw size={15} className="spin-icon" aria-hidden />
                : <Wrench size={15} aria-hidden />}
              {applying ? 'Applying…' : 'Apply all repairs'}
            </button>
          )}
          {subTab !== 'bulk' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleDownloadCsv}
              disabled={loading || applying || sourceRows.length === 0}
            >
              <Download size={15} aria-hidden />
              Download CSV
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadAll()}
            disabled={loading || applying}
          >
            <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <p className="settings-locations__error" role="alert">{error}</p>
      )}
      {success && (
        <p className="settings-sku-correction__success" role="status">
          <CheckCircle2 size={16} aria-hidden />
          {success}
        </p>
      )}

      <div className="settings-sku-correction__subtabs" role="tablist" aria-label="SKU views">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            className={`settings-sku-correction__subtab ${subTab === tab.id ? 'is-active' : ''}`}
            onClick={() => setSubTab(tab.id)}
          >
            {tab.label}
            {tab.id !== 'bulk' && (
              <span className="settings-sku-correction__subtab-count">{tabCounts[tab.id]}</span>
            )}
          </button>
        ))}
      </div>

      {subTab === 'bulk' ? (
        <BulkUpdateSkuSection
          products={products}
          loading={loading}
          onRefresh={loadAll}
          onError={msg => { setError(msg); setSuccess(''); }}
          onSuccess={msg => { setSuccess(msg); setError(''); }}
          onClearMessages={() => { setError(''); setSuccess(''); }}
        />
      ) : (
        <>
      <label className="settings-sku-correction__search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SKU, name, or category…"
          aria-label="Search SKUs"
        />
        <SkuScanButton
          onScan={raw => fillSearchFromScan(raw, setSearch)}
          hint="Point at the product or spare label QR code."
        />
      </label>

      {loading ? (
        <div className="settings-locations__loading">
          <div className="loader-ring" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="settings-locations__empty">
          {subTab === 'duplicates' ? (
            <Copy size={28} aria-hidden />
          ) : subTab === 'special' ? (
            <AlertTriangle size={28} aria-hidden />
          ) : (
            <Tag size={28} aria-hidden />
          )}
          <p>
            {search.trim()
              ? 'No SKUs match your search.'
              : subTab === 'special'
                ? 'No SKUs with characters outside 0-9 and A-Z.'
                : subTab === 'duplicates'
                  ? 'No duplicate SKUs found.'
                  : 'No catalog products synced yet.'}
          </p>
        </div>
      ) : (
        <>
          <p className="settings-sku-correction__meta text-muted text-sm">
            Showing {filteredRows.length}
            {filteredRows.length !== sourceRows.length ? ` of ${sourceRows.length}` : ''}
            {subTab === 'duplicates' ? ` · ${duplicateGroups.size} duplicate SKU values` : ''}
          </p>
          <div className="settings-logistics__table-wrap settings-sku-correction__table-wrap">
            <table className="settings-logistics__table settings-sku-correction__table">
              <thead>
                <tr>
                  <th scope="col">{subTab === 'special' ? 'Old SKU' : 'SKU'}</th>
                  {subTab === 'special' && <th scope="col">New SKU</th>}
                  <th scope="col">Name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  {subTab === 'special' && <th scope="col">Issue</th>}
                  {subTab === 'duplicates' && <th scope="col">Count</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(product => {
                  const issues = highlightSkuIssues(product.sku);
                  const dupCount = duplicateCountBySku.get(product.sku ?? '') ?? 0;
                  const proposedSku = proposedSkus.get(product.id);
                  return (
                    <tr key={product.id}>
                      <td>
                        <Link
                          to={`/super-admin/catalog/${product.id}`}
                          className="settings-logistics__staff-link settings-sku-correction__sku-link"
                        >
                          <code>{skuDisplay(product.sku)}</code>
                        </Link>
                      </td>
                      {subTab === 'special' && (
                        <td>
                          <code className="settings-sku-correction__new-sku">
                            {proposedSku ?? '—'}
                          </code>
                        </td>
                      )}
                      <td>
                        <Link
                          to={`/super-admin/catalog/${product.id}`}
                          className="settings-sku-correction__name-link"
                        >
                          {product.name}
                        </Link>
                      </td>
                      <td>{product.categoryName?.trim() || '—'}</td>
                      <td>
                        <span
                          className={`settings-sku-correction__status ${
                            product.status === 'active' ? 'is-active' : 'is-inactive'
                          }`}
                        >
                          {product.status || '—'}
                        </span>
                      </td>
                      {subTab === 'special' && (
                        <td>
                          <span className="settings-sku-correction__issues">
                            {issues.join(' · ') || '—'}
                          </span>
                        </td>
                      )}
                      {subTab === 'duplicates' && (
                        <td>
                          <span className="settings-sku-correction__dup-count">{dupCount}</span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
        </>
      )}
    </section>
  );
};
