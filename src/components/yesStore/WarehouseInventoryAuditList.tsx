import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  GitCompare,
  LayoutGrid,
  Link2,
  List,
  Printer,
  RefreshCw,
  Unlink,
  User,
  X,
} from 'lucide-react';
import { AuditTileStockLocation } from './AuditTileStockLocation';
import { AuditIconPanel, AuditIconRow, AuditAttributionRow } from './AuditIconRow';
import {
  BinLabelPrintDialog,
  binLabelFieldsFromStoreItem,
} from '../catalog/BinLabelPrintDialog';
import type { BinLabelFields } from '../../lib/localPrinterLabel';
import {
  buildInventoryAuditListRows,
  formatQtyDifference,
  readItemCountedAt,
  readItemCountedByName,
  resolveAuditorDisplayName,
  type InventoryAuditLinkedGroup,
  type InventoryAuditListRow,
} from '../../lib/yesStore/inventoryAudit';
import {
  formatItemLocationShort,
  isYesStoreItemLinked,
  readItemQuantity,
  VALID_RACK_LETTERS,
  ROW_NUMBERS,
  type YesStoreItemDoc,
} from '../../types/yes-store';
import type { CatalogProduct } from '../../types/catalog';

const PAGE_SIZE = 25;

type InventoryAuditViewMode = 'grid' | 'list';

export type InventoryAuditLinkFilter = 'all' | 'linked' | 'unlinked';

const AUDIT_LIST_FILTERS_KEY = 'yesweigh.inventoryAudit.listFilters';

type StoredAuditListFilters = {
  rackFilter: string | null;
  rowFilter: number | null;
  linkFilter: InventoryAuditLinkFilter;
};

function loadStoredAuditListFilters(): StoredAuditListFilters {
  const defaults: StoredAuditListFilters = {
    rackFilter: null,
    rowFilter: null,
    linkFilter: 'all',
  };
  try {
    const raw = sessionStorage.getItem(AUDIT_LIST_FILTERS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredAuditListFilters>;
    const linkFilter =
      parsed.linkFilter === 'linked' || parsed.linkFilter === 'unlinked' || parsed.linkFilter === 'all'
        ? parsed.linkFilter
        : 'all';
    const rackFilter =
      typeof parsed.rackFilter === 'string' && parsed.rackFilter.trim()
        ? parsed.rackFilter.trim().toLowerCase()
        : null;
    const rowRaw = parsed.rowFilter as unknown;
    const rowFilter =
      typeof rowRaw === 'number' && Number.isFinite(rowRaw)
        ? rowRaw
        : typeof rowRaw === 'string' && rowRaw.trim() && Number.isFinite(Number(rowRaw))
          ? Number(rowRaw)
          : null;
    return { rackFilter, rowFilter, linkFilter };
  } catch {
    return defaults;
  }
}

function saveStoredAuditListFilters(filters: StoredAuditListFilters): void {
  try {
    sessionStorage.setItem(AUDIT_LIST_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota / private mode
  }
}

function useMinWidth(minWidthPx: number): boolean {
  const query = `(min-width: ${minWidthPx}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setMatches(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export interface WarehouseInventoryAuditListProps {
  items: YesStoreItemDoc[];
  catalogProducts?: CatalogProduct[];
  auditorNamesByUid?: Map<string, string>;
  loading?: boolean;
  onRefresh?: () => void;
  onItemClick?: (item: YesStoreItemDoc) => void;
  onGroupClick?: (group: InventoryAuditLinkedGroup) => void;
  onUnlinkGroup?: (group: InventoryAuditLinkedGroup) => void;
  unlinkingGroupId?: string | null;
  onBatchLink?: (items: YesStoreItemDoc[]) => void;
  emptyMessage?: string;
  className?: string;
  showLinkStatus?: boolean;
  batchLinkEnabled?: boolean;
  showViewToggle?: boolean;
  /** Open Head Office cycle id — shows counted / needs-count badges on linked groups. */
  openCycleId?: string | null;
}

function catalogMap(products: CatalogProduct[] | undefined): Map<string, CatalogProduct> | undefined {
  if (!products?.length) return undefined;
  return new Map(products.map(product => [product.id, product]));
}

import { YesStorePhotoImg } from './YesStorePhotoImg';

function AuditTilePhotos({ photos }: { photos: YesStoreItemDoc['photos'] }) {
  const slots = [photos[0], photos[1]];
  return (
    <div className="wh-audit-tile__photos">
      {slots.map((photo, index) => (
        <div key={index} className="wh-audit-tile__photo">
          {photo ? (
            <YesStorePhotoImg photo={photo} />
          ) : (
            <span className="wh-audit-tile__photo-empty text-muted">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTileGridPhoto({ photos }: { photos: YesStoreItemDoc['photos'] }) {
  const photo = photos[0];
  return (
    <div className="wh-audit-tile__grid-photo">
      {photo ? (
        <YesStorePhotoImg photo={photo} />
      ) : (
        <span className="wh-audit-tile__photo-empty text-muted">—</span>
      )}
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

function CycleCountBadge({ counted }: { counted: boolean }) {
  return (
    <span
      className={`wh-audit-cycle-badge ${counted ? 'wh-audit-cycle-badge--counted' : 'wh-audit-cycle-badge--needs'}`}
    >
      {counted ? 'Counted' : 'Needs count'}
    </span>
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
  onUnlinkGroup,
  unlinkingGroupId = null,
  onBatchLink,
  emptyMessage = 'No audits yet. Warehouse staff add items from the YesStore app.',
  className = '',
  showLinkStatus = false,
  batchLinkEnabled = false,
  showViewToggle = false,
  openCycleId = null,
}) => {
  const storedFilters = useMemo(() => loadStoredAuditListFilters(), []);
  const [page, setPage] = useState(1);
  const [linkFilter, setLinkFilter] = useState<InventoryAuditLinkFilter>(storedFilters.linkFilter);
  const [rackFilter, setRackFilter] = useState<string | null>(storedFilters.rackFilter);
  const [rowFilter, setRowFilter] = useState<number | null>(storedFilters.rowFilter);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<InventoryAuditViewMode>('grid');
  const [printFields, setPrintFields] = useState<BinLabelFields | null>(null);
  const isDesktopWeb = useMinWidth(768);
  const catalogById = useMemo(() => catalogMap(catalogProducts), [catalogProducts]);

  const labelProductForGroup = (group: InventoryAuditLinkedGroup) => {
    const fromCatalog = catalogById?.get(group.catalogProductId);
    if (fromCatalog) return fromCatalog;
    return {
      id: group.catalogProductId,
      name: group.catalogProductName,
      sku: group.catalogProductSku,
    };
  };
  const layoutMode: InventoryAuditViewMode =
    showViewToggle && isDesktopWeb ? viewMode : 'list';
  const useGridCards = layoutMode === 'grid';

  const showBatchSelect = batchLinkEnabled && linkFilter !== 'linked';

  const rackChips = useMemo(() => {
    const present = new Set(
      items
        .map(item => item.rackId?.trim().toLowerCase())
        .filter((rack): rack is string => Boolean(rack)),
    );
    return VALID_RACK_LETTERS.filter(letter => present.has(letter));
  }, [items]);

  const itemsOnSelectedRack = useMemo(() => {
    if (!rackFilter) return [];
    return items.filter(item => item.rackId?.trim().toLowerCase() === rackFilter);
  }, [items, rackFilter]);

  const rowChips = useMemo(() => {
    if (!rackFilter) return [];
    const present = new Set(
      itemsOnSelectedRack
        .map(item => Number(item.rowNumber))
        .filter(n => Number.isFinite(n)),
    );
    return ROW_NUMBERS.filter(n => present.has(n));
  }, [rackFilter, itemsOnSelectedRack]);

  const locationScopedItems = useMemo(() => {
    if (!rackFilter) return items;
    let next = itemsOnSelectedRack;
    if (rowFilter != null) {
      next = next.filter(item => Number(item.rowNumber) === rowFilter);
      // Rack + row selected: show bins in ascending order
      next = [...next].sort((a, b) => Number(a.binNumber) - Number(b.binNumber));
    }
    return next;
  }, [items, rackFilter, rowFilter, itemsOnSelectedRack]);

  const listRows = useMemo(() => {
    if (!showLinkStatus) {
      return locationScopedItems.map(item => ({ kind: 'item', item } as InventoryAuditListRow));
    }
    return buildInventoryAuditListRows(locationScopedItems, linkFilter, catalogMap(catalogProducts));
  }, [locationScopedItems, linkFilter, showLinkStatus, catalogProducts]);

  const linkFilterCounts = useMemo(() => {
    if (!showLinkStatus) {
      return { all: locationScopedItems.length, linked: 0, unlinked: locationScopedItems.length };
    }
    const catalog = catalogMap(catalogProducts);
    return {
      unlinked: buildInventoryAuditListRows(locationScopedItems, 'unlinked', catalog).length,
      linked: buildInventoryAuditListRows(locationScopedItems, 'linked', catalog).length,
      all: buildInventoryAuditListRows(locationScopedItems, 'all', catalog).length,
    };
  }, [locationScopedItems, showLinkStatus, catalogProducts]);

  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  const totalPages = Math.max(1, Math.ceil(listRows.length / PAGE_SIZE));
  const pageStart = listRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, listRows.length);

  const pageRows = useMemo(
    () => listRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [listRows, page],
  );

  const selectedItems = useMemo(
    () => [...selectedIds].map(id => itemsById.get(id)).filter((item): item is YesStoreItemDoc => Boolean(item)),
    [selectedIds, itemsById],
  );

  useEffect(() => {
    saveStoredAuditListFilters({ rackFilter, rowFilter, linkFilter });
  }, [rackFilter, rowFilter, linkFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [listRows.length, linkFilter, rackFilter, rowFilter]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [linkFilter, rackFilter, rowFilter]);

  useEffect(() => {
    // Wait until items are loaded — empty chips during load must not wipe restored filters.
    if (loading || items.length === 0) return;
    if (rackFilter && !rackChips.includes(rackFilter)) {
      setRackFilter(null);
      setRowFilter(null);
    }
  }, [rackChips, rackFilter, loading, items.length]);

  useEffect(() => {
    if (loading || !rackFilter || itemsOnSelectedRack.length === 0) return;
    if (rowFilter != null && !rowChips.includes(rowFilter as typeof ROW_NUMBERS[number])) {
      setRowFilter(null);
    }
  }, [rowChips, rowFilter, loading, rackFilter, itemsOnSelectedRack.length]);

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
    rowFilter != null && rackFilter
      ? `No audit items on rack ${rackFilter.toUpperCase()} row ${rowFilter}.`
      : rackFilter
        ? `No audit items on rack ${rackFilter.toUpperCase()}.`
        : linkFilter === 'linked'
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

      {rackChips.length > 0 && (
        <div className="catalog-inventory-audit__location-chips">
          <div className="catalog-inventory-audit__rack-chips" role="group" aria-label="Filter by rack">
            <button
              type="button"
              className={`catalog-inventory-audit__rack-chip catalog-inventory-audit__rack-chip--all${!rackFilter ? ' is-active' : ''}`}
              aria-pressed={!rackFilter}
              title="Show all racks"
              onClick={() => {
                setRackFilter(null);
                setRowFilter(null);
              }}
            >
              All
            </button>
            {rackChips.map(letter => {
              const active = rackFilter === letter;
              return (
                <button
                  key={letter}
                  type="button"
                  className={`catalog-inventory-audit__rack-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={active ? `Clear rack ${letter.toUpperCase()} filter` : `Show rack ${letter.toUpperCase()}`}
                  onClick={() => {
                    if (active) {
                      setRackFilter(null);
                      setRowFilter(null);
                      return;
                    }
                    setRackFilter(letter);
                    setRowFilter(null);
                  }}
                >
                  {letter.toUpperCase()}
                </button>
              );
            })}
            {(rackFilter || rowFilter != null) && (
              <button
                type="button"
                className="catalog-inventory-audit__clear-location"
                title="Clear rack and row filters"
                onClick={() => {
                  setRackFilter(null);
                  setRowFilter(null);
                }}
              >
                <X size={14} aria-hidden />
                Clear
              </button>
            )}
          </div>

          {rackFilter && rowChips.length > 0 && (
            <div className="catalog-inventory-audit__row-chips" role="group" aria-label={`Filter by row on rack ${rackFilter.toUpperCase()}`}>
              <span className="catalog-inventory-audit__chip-label">Row</span>
              <button
                type="button"
                className={`catalog-inventory-audit__rack-chip catalog-inventory-audit__row-chip${rowFilter == null ? ' is-active' : ''}`}
                aria-pressed={rowFilter == null}
                title="Show all rows on this rack"
                onClick={() => setRowFilter(null)}
              >
                All
              </button>
              {rowChips.map(row => {
                const active = rowFilter === row;
                return (
                  <button
                    key={row}
                    type="button"
                    className={`catalog-inventory-audit__rack-chip catalog-inventory-audit__row-chip${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    title={active ? `Clear row ${row} filter` : `Show row ${row}`}
                    onClick={() => setRowFilter(active ? null : row)}
                  >
                    {row}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="warehouse-app__list-toolbar">
        <span className="text-muted text-sm">
          {listRows.length} record{listRows.length === 1 ? '' : 's'}
          {listRows.length > 0 && ` · ${pageStart}–${pageEnd}`}
          {showBatchSelect && selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
        </span>
        <div className="catalog-inventory-audit__toolbar-actions">
          {showViewToggle && (
            <div
              className="catalog-inventory-audit__view-toggle catalog-view-toggle"
              role="group"
              aria-label="Inventory audit view"
            >
              <button
                type="button"
                className={viewMode === 'grid' ? 'active' : ''}
                onClick={() => setViewMode('grid')}
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={viewMode === 'list' ? 'active' : ''}
                onClick={() => setViewMode('list')}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
              >
                <List size={15} />
              </button>
            </div>
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
          <div className={`wh-audit-tile-list wh-audit-tile-list--${layoutMode}`}>
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
                const catalogProduct = catalogById?.get(group.catalogProductId);
                const countedThisCycle = Boolean(
                  openCycleId
                  && (
                    catalogProduct?.auditSnapshot?.lastHeadOfficeAuditCycleId === openCycleId
                    || (
                      !catalogProduct?.auditSnapshot?.lastHeadOfficeAuditCycleId
                      && catalogProduct?.auditSnapshot?.lastAuditCycleId === openCycleId
                    )
                  ),
                );

                return (
                  <article
                    key={group.catalogProductId}
                    className={`wh-audit-tile wh-audit-tile--item wh-audit-tile--group${
                      useGridCards ? ' wh-audit-tile--grid-card' : ''
                    }${clickable ? ' wh-audit-tile--clickable' : ''}`}
                    onClick={clickable ? () => onGroupClick?.(group) : undefined}
                  >
                    {useGridCards ? (
                      <>
                        <div className="wh-audit-tile__grid-top">
                          <AuditTileGridPhoto photos={firstPhotos} />
                          <div className="wh-audit-tile__grid-badge">
                            <AuditStatusBadge linked />
                            {openCycleId && <CycleCountBadge counted={countedThisCycle} />}
                          </div>
                        </div>
                        <h3 className="wh-audit-tile__grid-title">{group.catalogProductName}</h3>
                        <p className="wh-audit-tile__grid-details">
                          <span className="wh-audit-tile__grid-qty">Qty {countedQty}</span>
                          {group.items.length > 1 && (
                            <span className="wh-audit-tile__grid-location">
                              {group.items.length} locations
                            </span>
                          )}
                        </p>
                        <AuditAttributionRow
                          icon={User}
                          tone="orange"
                          auditedBy={auditedBy}
                          auditedAt={group.lastCountedAt}
                          bare
                        />
                      </>
                    ) : (
                      <>
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
                        {openCycleId && <CycleCountBadge counted={countedThisCycle} />}
                      </div>
                    </div>

                    <div className="wh-audit-tile__product-head">
                      <div className="wh-audit-tile__product-head-main">
                        <h3 className="wh-audit-tile__product-name">{group.catalogProductName}</h3>
                        {group.items.length > 1 && (
                          <p className="wh-audit-tile__product-meta text-muted">
                            {group.items.length} stock locations
                          </p>
                        )}
                      </div>
                      <div className="wh-audit-tile__product-head-actions">
                        {group.items.length === 1 && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm wh-audit-tile__print"
                            onClick={event => {
                              event.stopPropagation();
                              setPrintFields(
                                binLabelFieldsFromStoreItem(
                                  labelProductForGroup(group),
                                  group.items[0],
                                ),
                              );
                            }}
                          >
                            <Printer size={14} aria-hidden />
                            Print Label
                          </button>
                        )}
                        {onUnlinkGroup && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm wh-audit-tile__unlink"
                            disabled={unlinkingGroupId === group.catalogProductId}
                            onClick={event => {
                              event.stopPropagation();
                              onUnlinkGroup(group);
                            }}
                          >
                            <Unlink size={14} aria-hidden />
                            {unlinkingGroupId === group.catalogProductId ? 'Unlinking…' : 'Unlink'}
                          </button>
                        )}
                      </div>
                    </div>

                    <AuditAttributionRow
                      icon={User}
                      tone="orange"
                      auditedBy={auditedBy}
                      auditedAt={group.lastCountedAt}
                    />

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
                      <div key={binItem.id} className="wh-audit-tile__stock-location-row">
                        <AuditTileStockLocation
                          rackId={binItem.rackId}
                          rowNumber={binItem.rowNumber}
                          binNumber={binItem.binNumber}
                          index={index}
                          total={group.items.length}
                        />
                        {group.items.length > 1 && (
                          <button
                            type="button"
                            className="product-site-stock__print-btn wh-audit-tile__print-icon"
                            onClick={event => {
                              event.stopPropagation();
                              setPrintFields(
                                binLabelFieldsFromStoreItem(
                                  labelProductForGroup(group),
                                  binItem,
                                ),
                              );
                            }}
                            aria-label="Print label"
                            title="Print label"
                          >
                            <Printer size={16} aria-hidden />
                          </button>
                        )}
                      </div>
                    ))}
                      </>
                    )}
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
                  className={`wh-audit-tile wh-audit-tile--item${
                    useGridCards ? ' wh-audit-tile--grid-card' : ' wh-audit-tile--dense'
                  }${clickable ? ' wh-audit-tile--clickable' : ''}${
                    selectedIds.has(item.id) ? ' wh-audit-tile--selected' : ''
                  }`}
                  onClick={clickable ? () => onItemClick?.(item) : undefined}
                >
                  {useGridCards ? (
                    <>
                      <div className="wh-audit-tile__grid-top">
                        {showBatchSelect && selectable && (
                          <label
                            className="wh-audit-tile__grid-select"
                            onClick={event => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${locationLabel}`}
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleItem(item.id)}
                            />
                          </label>
                        )}
                        <AuditTileGridPhoto photos={photos} />
                        {showLinkStatus && (
                          <div className="wh-audit-tile__grid-badge">
                            <AuditStatusBadge linked={linked} />
                          </div>
                        )}
                      </div>
                      <p className="wh-audit-tile__grid-details">
                        <span className="wh-audit-tile__grid-qty">Qty {quantity}</span>
                        <span className="wh-audit-tile__grid-location">{locationLabel}</span>
                      </p>
                      <AuditAttributionRow
                        icon={User}
                        tone="orange"
                        auditedBy={auditedBy}
                        auditedAt={auditedAt}
                        bare
                      />
                    </>
                  ) : (
                    <>
                      <div className="wh-audit-tile__dense-row">
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
                        <div className="wh-audit-tile__qty-inline">
                          <span
                            className="wh-audit-tile__qty-value"
                            aria-label={`Quantity ${quantity}`}
                          >
                            {quantity}
                          </span>
                          <span className="wh-audit-tile__qty-label">Qty</span>
                        </div>
                        <AuditTileStockLocation
                          rackId={item.rackId}
                          rowNumber={item.rowNumber}
                          binNumber={item.binNumber}
                          variant="strip"
                          className="wh-audit-tile__dense-location"
                        />
                      </div>

                      <div className="wh-audit-tile__dense-meta">
                        <div className="wh-audit-tile__dense-audit">
                          <AuditAttributionRow
                            icon={User}
                            tone="orange"
                            auditedBy={auditedBy}
                            auditedAt={auditedAt}
                            bare
                          />
                        </div>
                        {showLinkStatus && (
                          <div className="wh-audit-tile__status">
                            <AuditStatusBadge linked={linked} />
                          </div>
                        )}
                      </div>
                    </>
                  )}
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

      {printFields && (
        <BinLabelPrintDialog
          fields={printFields}
          layoutId="genuine-spare"
          onClose={() => setPrintFields(null)}
        />
      )}
    </div>
  );
};
