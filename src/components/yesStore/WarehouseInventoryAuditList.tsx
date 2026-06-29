import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  buildInventoryAuditListRows,
  formatQtyDifference,
  type InventoryAuditLinkedGroup,
  type InventoryAuditListRow,
} from '../../lib/yesStore/inventoryAudit';
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
  loading?: boolean;
  onRefresh?: () => void;
  onItemClick?: (item: YesStoreItemDoc) => void;
  onGroupClick?: (group: InventoryAuditLinkedGroup) => void;
  emptyMessage?: string;
  className?: string;
  /** Admin audit — merge rack, row, bin into one column. */
  combinedLocation?: boolean;
  /** Admin audit — show linked / unlinked status and group linked rows. */
  showLinkStatus?: boolean;
}

function catalogMap(products: CatalogProduct[] | undefined): Map<string, CatalogProduct> | undefined {
  if (!products?.length) return undefined;
  return new Map(products.map(product => [product.id, product]));
}

export const WarehouseInventoryAuditList: React.FC<WarehouseInventoryAuditListProps> = ({
  items,
  catalogProducts,
  loading = false,
  onRefresh,
  onItemClick,
  onGroupClick,
  emptyMessage = 'No audits yet. Warehouse staff add items from the YesStore app.',
  className = '',
  combinedLocation = false,
  showLinkStatus = false,
}) => {
  const [page, setPage] = useState(1);
  const [linkFilter, setLinkFilter] = useState<InventoryAuditLinkFilter>('all');

  const listRows = useMemo(() => {
    if (!showLinkStatus) {
      return items.map(item => ({ kind: 'item', item } as InventoryAuditListRow));
    }
    return buildInventoryAuditListRows(items, linkFilter, catalogMap(catalogProducts));
  }, [items, linkFilter, showLinkStatus, catalogProducts]);

  const totalPages = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const pageStart = listRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, listRows.length);

  const pageRows = useMemo(
    () => listRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [listRows, page],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [listRows.length, linkFilter]);

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
          {(['unlinked', 'linked', 'all'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={linkFilter === option}
              className={`catalog-inventory-audit__filter-chip${linkFilter === option ? ' is-active' : ''}`}
              onClick={() => setLinkFilter(option)}
            >
              {option === 'all' ? 'All' : option === 'linked' ? 'Linked' : 'Unlinked'}
            </button>
          ))}
        </div>
      )}

      <div className="warehouse-app__list-toolbar">
        <span className="text-muted text-sm">
          {listRows.length} record{listRows.length === 1 ? '' : 's'}
          {listRows.length > 0 && ` · ${pageStart}–${pageEnd}`}
        </span>
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

      {listRows.length === 0 ? (
        <p className="text-muted warehouse-app__empty">{filterEmptyMessage}</p>
      ) : (
        <>
      <div className="wh-item-table-wrap">
        <table className="wh-item-table">
          <thead>
            <tr>
              <th>Img1</th>
              <th>Img2</th>
              <th>Qty</th>
              {combinedLocation ? (
                <th>Location</th>
              ) : (
                <>
                  <th>Rack</th>
                  <th>Row</th>
                  <th>Bin</th>
                </>
              )}
              {showLinkStatus && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(row => {
              if (row.kind === 'group') {
                const { group } = row;
                const firstPhotos = group.items[0]?.photos ?? [];
                const clickable = Boolean(onGroupClick);
                const locationLabel =
                  group.items.length === 1
                    ? formatItemLocationShort(
                        group.items[0].rackId,
                        group.items[0].rowNumber,
                        group.items[0].binNumber,
                      )
                    : `${group.items.length} locations`;
                const qtyLabel =
                  group.totals.mode === 'bundle'
                    ? `${group.totals.countedQty} (${group.totals.rawCountedQty} parts)`
                    : String(group.totals.countedQty);

                return (
                  <tr
                    key={group.catalogProductId}
                    className={clickable ? 'wh-item-table__row' : undefined}
                    onClick={clickable ? () => onGroupClick?.(group) : undefined}
                  >
                    <td>
                      {firstPhotos[0] ? (
                        <img src={firstPhotos[0].url} alt="" loading="lazy" />
                      ) : (
                        <span className="wh-item-table__empty">—</span>
                      )}
                    </td>
                    <td>
                      {firstPhotos[1] ? (
                        <img src={firstPhotos[1].url} alt="" loading="lazy" />
                      ) : (
                        <span className="wh-item-table__empty">—</span>
                      )}
                    </td>
                    <td className="wh-item-table__num" title={group.catalogProductName}>
                      {qtyLabel}
                    </td>
                    {combinedLocation ? (
                      <td className="wh-item-table__location">
                        <span className="wh-item-table__group-name">{group.catalogProductName}</span>
                        <span className="wh-item-table__group-meta text-muted">{locationLabel}</span>
                      </td>
                    ) : (
                      <>
                        <td colSpan={3} className="wh-item-table__location">
                          <span className="wh-item-table__group-name">{group.catalogProductName}</span>
                          <span className="wh-item-table__group-meta text-muted">{locationLabel}</span>
                        </td>
                      </>
                    )}
                    {showLinkStatus && (
                      <td>
                        <span className="wh-item-table__status wh-item-table__status--linked">
                          Linked
                          {group.totals.difference != null && group.totals.difference !== 0 && (
                            <span
                              className={`wh-item-table__diff wh-item-table__diff--${
                                group.totals.difference > 0 ? 'over' : 'under'
                              }`}
                            >
                              {formatQtyDifference(group.totals.difference)}
                            </span>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              }

              const item = row.item;
              const photos = item.photos ?? [];
              const clickable = Boolean(onItemClick);
              const locationLabel = formatItemLocationShort(
                item.rackId,
                item.rowNumber,
                item.binNumber,
              );
              return (
                <tr
                  key={item.id}
                  className={clickable ? 'wh-item-table__row' : undefined}
                  onClick={clickable ? () => onItemClick?.(item) : undefined}
                >
                  <td>
                    {photos[0] ? (
                      <img src={photos[0].url} alt="" loading="lazy" />
                    ) : (
                      <span className="wh-item-table__empty">—</span>
                    )}
                  </td>
                  <td>
                    {photos[1] ? (
                      <img src={photos[1].url} alt="" loading="lazy" />
                    ) : (
                      <span className="wh-item-table__empty">—</span>
                    )}
                  </td>
                  <td className="wh-item-table__num">{readItemQuantity(item)}</td>
                  {combinedLocation ? (
                    <td className="wh-item-table__location">{locationLabel}</td>
                  ) : (
                    <>
                      <td className="wh-item-table__num">{item.rackId.toUpperCase()}</td>
                      <td className="wh-item-table__num">{item.rowNumber}</td>
                      <td className="wh-item-table__num">{item.binNumber}</td>
                    </>
                  )}
                  {showLinkStatus && (
                    <td>
                      <span
                        className={`wh-item-table__status wh-item-table__status--${
                          isYesStoreItemLinked(item) ? 'linked' : 'unlinked'
                        }`}
                      >
                        {isYesStoreItemLinked(item) ? 'Linked' : 'Unlinked'}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
