import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, MapPin, RefreshCw, User, Calendar, GitCompare } from 'lucide-react';
import { AuditIconPanel, AuditIconRow } from './AuditIconRow';
import {
  buildInventoryAuditListRows,
  formatQtyDifference,
  readItemCountedAt,
  readItemCountedByName,
  resolveAuditorDisplayName,
  type InventoryAuditLinkedGroup,
  type InventoryAuditListRow,
} from '../../lib/yesStore/inventoryAudit';
import { formatAuditDateTime } from '../../lib/yesStore/format';
import {
  formatItemLocationShort,
  isYesStoreItemLinked,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';
import type { CatalogProduct } from '../../types/catalog';

const PAGE_SIZE = 25;

export type InventoryAuditLinkFilter = 'all' | 'linked' | 'unlinked';

export interface WarehouseInventoryAuditListProps {
  items: YesStoreItemDoc[];
  catalogProducts?: CatalogProduct[];
  auditorNamesByUid?: Map<string, string>;
  loading?: boolean;
  onRefresh?: () => void;
  onItemClick?: (item: YesStoreItemDoc) => void;
  onGroupClick?: (group: InventoryAuditLinkedGroup) => void;
  onBatchLink?: (items: YesStoreItemDoc[]) => void;
  emptyMessage?: string;
  className?: string;
  showLinkStatus?: boolean;
  batchLinkEnabled?: boolean;
}

function catalogMap(products: CatalogProduct[] | undefined): Map<string, CatalogProduct> | undefined {
  if (!products?.length) return undefined;
  return new Map(products.map(product => [product.id, product]));
}

function isSelectableRow(row: InventoryAuditListRow): row is { kind: 'item'; item: YesStoreItemDoc } {
  return row.kind === 'item' && !isYesStoreItemLinked(row.item);
}

function AuditTilePhotos({ photos }: { photos: YesStoreItemDoc['photos'] }) {
  const slots = [photos[0], photos[1]];
  return (
    <div className="wh-audit-tile__photos">
      {slots.map((photo, index) => (
        <div key={index} className="wh-audit-tile__photo">
          {photo ? (
            <img src={photo.url} alt="" loading="lazy" />
          ) : (
            <span className="wh-audit-tile__photo-empty text-muted">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditStatusBadge({ linked }: { linked: boolean }) {
  return (
    <span
      className={`wh-item-table__status wh-item-table__status--${
        linked ? 'linked' : 'unlinked'
      }`}
    >
      {linked ? 'Linked' : 'Unlinked'}
    </span>
  );
}

function AuditTileStockLocation({
  rackId,
  rowNumber,
  binNumber,
  index,
  total,
}: {
  rackId: string;
  rowNumber: number;
  binNumber: number;
  index?: number;
  total?: number;
}) {
  const cells = [
    { label: 'Rack', value: rackId.toUpperCase() },
    { label: 'Row', value: String(rowNumber) },
    { label: 'Bin', value: String(binNumber) },
  ];
  const showIndex = total != null && total > 1 && index != null;

  return (
    <div className="wh-audit-tile__stock-location">
      <div className="wh-audit-tile__stock-location-head">
        <span className="audit-icon-row__icon audit-icon-row__icon--indigo" aria-hidden>
          <MapPin size={15} strokeWidth={2.1} />
        </span>
        <span>
          Stock Location
          {showIndex ? ` ${index + 1} of ${total}` : ''}
        </span>
      </div>
      <div className="wh-audit-tile__stock-location-cells">
        {cells.map(cell => (
          <div key={cell.label} className="wh-audit-tile__stock-location-cell">
            <span className="wh-audit-tile__stock-location-label">{cell.label}</span>
            <span className="wh-audit-tile__stock-location-value">{cell.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const WarehouseInventoryAuditList: React.FC<WarehouseInventoryAuditListProps> = ({
  items,
  catalogProducts,
  auditorNamesByUid,
  loading = false,
  onRefresh,
  onItemClick,
  onGroupClick,
  onBatchLink,
  emptyMessage = 'No audits yet. Warehouse staff add items from the YesStore app.',
  className = '',
  showLinkStatus = false,
  batchLinkEnabled = false,
}) => {
  const [page, setPage] = useState(1);
  const [linkFilter, setLinkFilter] = useState<InventoryAuditLinkFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const showBatchSelect = batchLinkEnabled && linkFilter !== 'linked';

  const listRows = useMemo(() => {
    if (!showLinkStatus) {
      return items.map(item => ({ kind: 'item', item } as InventoryAuditListRow));
    }
    return buildInventoryAuditListRows(items, linkFilter, catalogMap(catalogProducts));
  }, [items, linkFilter, showLinkStatus, catalogProducts]);

  const linkFilterCounts = useMemo(() => {
    if (!showLinkStatus) {
      return { all: items.length, linked: 0, unlinked: items.length };
    }
    const catalog = catalogMap(catalogProducts);
    return {
      unlinked: buildInventoryAuditListRows(items, 'unlinked', catalog).length,
      linked: buildInventoryAuditListRows(items, 'linked', catalog).length,
      all: buildInventoryAuditListRows(items, 'all', catalog).length,
    };
  }, [items, showLinkStatus, catalogProducts]);

  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  const totalPages = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const pageStart = listRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, listRows.length);

  const pageRows = useMemo(
    () => listRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [listRows, page],
  );

  const pageSelectableIds = useMemo(
    () => pageRows.filter(isSelectableRow).map(row => row.item.id),
    [pageRows],
  );

  const allPageSelected =
    pageSelectableIds.length > 0 && pageSelectableIds.every(id => selectedIds.has(id));

  const somePageSelected = pageSelectableIds.some(id => selectedIds.has(id));

  const selectedItems = useMemo(
    () => [...selectedIds].map(id => itemsById.get(id)).filter((item): item is YesStoreItemDoc => Boolean(item)),
    [selectedIds, itemsById],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [listRows.length, linkFilter]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [linkFilter]);

  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => {
        const item = itemsById.get(id);
        return item && !isYesStoreItemLinked(item);
      }));
      return next.size === prev.size ? prev : next;
    });
  }, [itemsById]);

  const toggleItem = (itemId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const togglePageSelection = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageSelectableIds.forEach(id => next.delete(id));
      } else {
        pageSelectableIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  if (loading && items.length === 0) {
    return (
      <div className={`warehouse-app__loading ${className}`.trim()}>
        <div className="loader-ring" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className={`text-muted warehouse-app__empty ${className}`.trim()}>
        {emptyMessage}
      </p>
    );
  }

  const filterEmptyMessage =
    linkFilter === 'linked'
      ? 'No linked audit items yet.'
      : linkFilter === 'unlinked'
        ? 'No unlinked audit items.'
        : emptyMessage;

  return (
    <div className={`catalog-inventory-audit ${className}`.trim()}>
      {showLinkStatus && (
        <div className="catalog-inventory-audit__filters" role="tablist" aria-label="Link status filter">
          {(['unlinked', 'linked', 'all'] as const).map(option => {
            const count = linkFilterCounts[option];
            const label =
              option === 'all' ? 'All' : option === 'linked' ? 'Linked' : 'Unlinked';
            return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={linkFilter === option}
              className={`catalog-inventory-audit__filter-chip${linkFilter === option ? ' is-active' : ''}`}
              onClick={() => setLinkFilter(option)}
            >
              {label}
              <span className="catalog-inventory-audit__filter-chip-count">{count}</span>
            </button>
            );
          })}
        </div>
      )}

      <div className="warehouse-app__list-toolbar">
        <span className="text-muted text-sm">
          {listRows.length} record{listRows.length === 1 ? '' : 's'}
          {listRows.length > 0 && ` · ${pageStart}–${pageEnd}`}
          {showBatchSelect && selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <div className="catalog-inventory-audit__toolbar-actions">
          {showBatchSelect && pageSelectableIds.length > 0 && (
            <label className="wh-audit-tile__select-all text-sm">
              <input
                type="checkbox"
                aria-label="Select all unlinked items on this page"
                checked={allPageSelected}
                ref={input => {
                  if (input) input.indeterminate = !allPageSelected && somePageSelected;
                }}
                onChange={togglePageSelection}
              />
              Select page
            </label>
          )}
          {showBatchSelect && selectedIds.size > 0 && onBatchLink && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onBatchLink(selectedItems)}
            >
              <Link2 size={14} aria-hidden />
              Link to Zoho ({selectedIds.size})
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void onRefresh()}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : undefined} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {listRows.length === 0 ? (
        <p className="text-muted warehouse-app__empty">{filterEmptyMessage}</p>
      ) : (
        <>
          <div className="wh-audit-tile-list">
            {pageRows.map(row => {
              if (row.kind === 'group') {
                const { group } = row;
                const firstPhotos = group.items[0]?.photos ?? [];
                const clickable = Boolean(onGroupClick);
                const countedQty = group.totals.countedQty;
                const qtySub =
                  group.totals.mode === 'bundle'
                    ? `${group.totals.rawCountedQty} parts`
                    : undefined;
                const auditedBy = group.countedByName;
                const linkedBy = resolveAuditorDisplayName(
                  group.linkedByName,
                  group.linkedByUid,
                  auditorNamesByUid,
                );

                return (
                  <article
                    key={group.catalogProductId}
                    className={`wh-audit-tile wh-audit-tile--item wh-audit-tile--group${clickable ? ' wh-audit-tile--clickable' : ''}`}
                    onClick={clickable ? () => onGroupClick?.(group) : undefined}
                  >
                    <div className="wh-audit-tile__hero">
                      <AuditTilePhotos photos={firstPhotos} />
                      <div className="wh-audit-tile__qty-block">
                        <span className="wh-audit-tile__qty-label">Qty</span>
                        <span
                          className="wh-audit-tile__qty-value"
                          aria-label={`Counted quantity ${countedQty}`}
                        >
                          {countedQty}
                        </span>
                        {qtySub ? (
                          <span className="wh-audit-tile__qty-sub text-muted">{qtySub}</span>
                        ) : null}
                      </div>
                      <div className="wh-audit-tile__status">
                        <AuditStatusBadge linked />
                      </div>
                    </div>

                    <div className="wh-audit-tile__product-head">
                      <h3 className="wh-audit-tile__product-name">{group.catalogProductName}</h3>
                      {group.items.length > 1 && (
                        <p className="wh-audit-tile__product-meta text-muted">
                          {group.items.length} stock locations
                        </p>
                      )}
                    </div>

                    <AuditIconPanel>
                      <AuditIconRow
                        icon={Calendar}
                        tone="teal"
                        label="Last audited"
                        value={formatAuditDateTime(group.lastCountedAt)}
                      />
                      <AuditIconRow
                        icon={User}
                        tone="orange"
                        label="Audited by"
                        value={auditedBy}
                      />
                    </AuditIconPanel>

                    <AuditIconPanel>
                      <AuditIconRow
                        icon={Link2}
                        tone="purple"
                        label="Linked by"
                        value={linkedBy}
                      />
                      {group.totals.difference != null && (
                        <AuditIconRow
                          icon={GitCompare}
                          tone="amber"
                          label="Difference"
                          value={formatQtyDifference(group.totals.difference)}
                          valueClassName={
                            group.totals.difference !== 0
                              ? `is-audit-diff ${group.totals.difference > 0 ? 'is-over' : 'is-under'}`
                              : 'is-audit-diff'
                          }
                        />
                      )}
                    </AuditIconPanel>

                    {group.items.map((binItem, index) => (
                      <AuditTileStockLocation
                        key={binItem.id}
                        rackId={binItem.rackId}
                        rowNumber={binItem.rowNumber}
                        binNumber={binItem.binNumber}
                        index={index}
                        total={group.items.length}
                      />
                    ))}
                  </article>
                );
              }

              const item = row.item;
              const photos = item.photos ?? [];
              const linked = isYesStoreItemLinked(item);
              const selectable = showBatchSelect && !linked;
              const clickable = Boolean(onItemClick);
              const locationLabel = formatItemLocationShort(
                item.rackId,
                item.rowNumber,
                item.binNumber,
              );
              const auditedAt = readItemCountedAt(item);
              const auditedBy = readItemCountedByName(item);
              const quantity = readItemQuantity(item);

              return (
                <article
                  key={item.id}
                  className={`wh-audit-tile wh-audit-tile--item${clickable ? ' wh-audit-tile--clickable' : ''}${
                    selectedIds.has(item.id) ? ' wh-audit-tile--selected' : ''
                  }`}
                  onClick={clickable ? () => onItemClick?.(item) : undefined}
                >
                  <div className="wh-audit-tile__hero">
                    {showBatchSelect && (
                      <div
                        className="wh-audit-tile__select"
                        onClick={event => event.stopPropagation()}
                      >
                        {selectable ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${locationLabel}`}
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                          />
                        ) : null}
                      </div>
                    )}
                    <AuditTilePhotos photos={photos} />
                    <div className="wh-audit-tile__qty-block">
                      <span className="wh-audit-tile__qty-label">Qty</span>
                      <span className="wh-audit-tile__qty-value" aria-label={`Quantity ${quantity}`}>
                        {quantity}
                      </span>
                    </div>
                    {showLinkStatus && (
                      <div className="wh-audit-tile__status">
                        <AuditStatusBadge linked={linked} />
                      </div>
                    )}
                  </div>

                  <AuditIconPanel>
                    <AuditIconRow
                      icon={Calendar}
                      tone="teal"
                      label="Last audited"
                      value={formatAuditDateTime(auditedAt)}
                    />
                    <AuditIconRow
                      icon={User}
                      tone="orange"
                      label="Audited by"
                      value={auditedBy}
                    />
                  </AuditIconPanel>

                  <AuditTileStockLocation
                    rackId={item.rackId}
                    rowNumber={item.rowNumber}
                    binNumber={item.binNumber}
                  />
                </article>
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav className="wh-pagination" aria-label="Item list pagination">
              <button
                type="button"
                className="wh-pagination__btn"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="wh-pagination__info">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="wh-pagination__btn"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
};
