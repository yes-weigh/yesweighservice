import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  formatItemLocationShort,
  isYesStoreItemLinked,
  readItemQuantity,
  type YesStoreItemDoc,
} from '../../types/yes-store';

const PAGE_SIZE = 25;

export interface WarehouseInventoryAuditListProps {
  items: YesStoreItemDoc[];
  loading?: boolean;
  onRefresh?: () => void;
  onItemClick?: (item: YesStoreItemDoc) => void;
  emptyMessage?: string;
  className?: string;
  /** Admin audit — merge rack, row, bin into one column. */
  combinedLocation?: boolean;
  /** Admin audit — show linked / unlinked status. */
  showLinkStatus?: boolean;
}

export const WarehouseInventoryAuditList: React.FC<WarehouseInventoryAuditListProps> = ({
  items,
  loading = false,
  onRefresh,
  onItemClick,
  emptyMessage = 'No audits yet. Warehouse staff add items from the YesStore app.',
  className = '',
  combinedLocation = false,
  showLinkStatus = false,
}) => {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageStart = items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, items.length);

  const pageItems = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [items.length]);

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

  return (
    <div className={`catalog-inventory-audit ${className}`.trim()}>
      <div className="warehouse-app__list-toolbar">
        <span className="text-muted text-sm">
          {items.length} record{items.length === 1 ? '' : 's'}
          {items.length > 0 && ` · ${pageStart}–${pageEnd}`}
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
            {pageItems.map(item => {
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
    </div>
  );
};
