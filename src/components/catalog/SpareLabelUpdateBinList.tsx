import React, { useMemo } from 'react';
import type { SkuLabelRackStatus } from '../../lib/catalog';
import type { YesStoreItemDoc } from '../../types/yes-store';
import { readItemQuantity, VALID_RACK_LETTERS } from '../../types/yes-store';

export interface SpareLabelUpdateBinRow {
  itemId: string;
  productId: string;
  rackId: string;
  rowNumber: number;
  binNumber: number;
  sku: string;
  name: string;
  quantity: number;
  labelStatus: 'changed' | 'relabel_printed';
}

function normalizeRackId(rackId: string | null | undefined): string {
  return String(rackId ?? '').trim().toLowerCase();
}

function compareBinRows(a: SpareLabelUpdateBinRow, b: SpareLabelUpdateBinRow): number {
  const rackDiff = a.rackId.localeCompare(b.rackId);
  if (rackDiff !== 0) return rackDiff;
  if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
  if (a.binNumber !== b.binNumber) return a.binNumber - b.binNumber;
  return a.sku.localeCompare(b.sku);
}

export function buildSpareLabelUpdateBinRows(
  items: YesStoreItemDoc[],
  catalogByProductId: Map<string, {
    sku: string;
    name?: string | null;
    labelStatus?: SkuLabelRackStatus;
  }>,
  statuses: ReadonlySet<'changed' | 'relabel_printed'>,
): SpareLabelUpdateBinRow[] {
  const rows: SpareLabelUpdateBinRow[] = [];
  for (const item of items) {
    const rackId = normalizeRackId(item.rackId);
    if (!VALID_RACK_LETTERS.includes(rackId)) continue;
    const productId = item.catalogProductId?.trim();
    if (!productId) continue;
    const catalog = catalogByProductId.get(productId);
    if (!catalog) continue;
    const labelStatus = catalog.labelStatus ?? 'unchanged';
    if (labelStatus !== 'changed' && labelStatus !== 'relabel_printed') continue;
    if (!statuses.has(labelStatus)) continue;
    rows.push({
      itemId: item.id,
      productId,
      rackId,
      rowNumber: item.rowNumber,
      binNumber: item.binNumber,
      sku: catalog.sku,
      name: (catalog.name ?? item.catalogProductName ?? '').trim(),
      quantity: readItemQuantity(item),
      labelStatus,
    });
  }
  return rows.sort(compareBinRows);
}

export const SpareLabelUpdateBinList: React.FC<{
  items: YesStoreItemDoc[];
  catalogByProductId: Map<string, {
    sku: string;
    name?: string | null;
    labelStatus?: SkuLabelRackStatus;
  }>;
  /** Which statuses to include. Empty = none. */
  statuses: ReadonlySet<'changed' | 'relabel_printed'>;
  loading?: boolean;
  onRowClick: (productId: string, rackId: string) => void;
}> = ({
  items,
  catalogByProductId,
  statuses,
  loading = false,
  onRowClick,
}) => {
  const rows = useMemo(
    () => buildSpareLabelUpdateBinRows(items, catalogByProductId, statuses),
    [items, catalogByProductId, statuses],
  );

  const needsPrint = useMemo(
    () => rows.filter(row => row.labelStatus === 'changed'),
    [rows],
  );
  const printed = useMemo(
    () => rows.filter(row => row.labelStatus === 'relabel_printed'),
    [rows],
  );

  const showNeeds = statuses.has('changed');
  const showPrinted = statuses.has('relabel_printed');
  const showBothSections = showNeeds && showPrinted;

  if (loading) {
    return <p className="text-muted text-sm spare-label-update-list__empty">Loading bin locations…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted text-sm spare-label-update-list__empty">
        No rack bins match the selected label update filters.
      </p>
    );
  }

  const renderSection = (title: string, sectionRows: SpareLabelUpdateBinRow[]) => (
    <section className="spare-label-update-list__section" key={title}>
      {showBothSections && (
        <h3 className="spare-label-update-list__section-title">
          {title}
          <span className="spare-label-update-list__section-count">{sectionRows.length}</span>
        </h3>
      )}
      {sectionRows.length === 0 ? (
        <p className="text-muted text-sm spare-label-update-list__empty">None</p>
      ) : (
        <ul className="spare-label-update-list__rows">
          {sectionRows.map(row => {
            const skuClass = row.labelStatus === 'changed'
              ? 'spare-label-update-list__sku--changed'
              : 'spare-label-update-list__sku--printed';
            return (
              <li key={row.itemId}>
                <button
                  type="button"
                  className="spare-label-update-list__row"
                  onClick={() => onRowClick(row.productId, row.rackId)}
                >
                  <span className="spare-label-update-list__loc">
                    {row.rackId.toUpperCase()}
                    <span aria-hidden>·</span>
                    R{row.rowNumber}
                    <span aria-hidden>·</span>
                    B{row.binNumber}
                  </span>
                  <span className={['spare-label-update-list__sku', skuClass].join(' ')}>
                    {row.sku}
                  </span>
                  <span className="spare-label-update-list__name">{row.name || '—'}</span>
                  <span className="spare-label-update-list__qty">{row.quantity} nos</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="spare-label-update-list">
      {showNeeds && renderSection('Updated · not printed', needsPrint)}
      {showPrinted && renderSection('Updated · printed', printed)}
    </div>
  );
};
