import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ChevronRight, Rows3 } from 'lucide-react';
import { YesStorePhotoImg } from '../yesStore/YesStorePhotoImg';
import type { YesStoreItemDoc, YesStorePhoto } from '../../types/yes-store';
import { BIN_NUMBERS, ROW_NUMBERS, VALID_RACK_LETTERS, readItemQuantity } from '../../types/yes-store';

export interface SpareRackSkuChip {
  productId: string;
  sku: string;
  name?: string | null;
  quantity: number;
}

export interface SpareRackUnlinkedChip {
  itemId: string;
  quantity: number;
  photo: YesStorePhoto | null;
}

interface BinSlot {
  binNumber: number;
  skus: SpareRackSkuChip[];
  unlinked: SpareRackUnlinkedChip[];
}

interface RowTile {
  rowNumber: number;
  bins: BinSlot[];
}

type DisplayRow =
  | { kind: 'occupied'; rowNumber: number; bins: BinSlot[] }
  | { kind: 'empty'; rowNumber: number };

interface RackPage {
  letter: string;
  rows: DisplayRow[];
}

interface SparePartsRackViewProps {
  items: YesStoreItemDoc[];
  /** Catalog spare product ids — only linked audited bins for these show SKUs. */
  spareProductIds: Set<string>;
  /** Live catalog SKUs/names by product id (preferred over yesStore snapshots). */
  catalogByProductId?: Map<string, { sku: string; name?: string | null }>;
  loading?: boolean;
  /** Highlight this product after returning from detail. */
  highlightedProductId?: string | null;
  /** Highlight this unlinked audit item after returning from inventory audit. */
  highlightedAuditItemId?: string | null;
  /** Prefer opening this rack letter (e.g. restore after detail). */
  initialRackId?: string | null;
  onSkuClick: (productId: string, rackId: string) => void;
  onUnlinkedClick: (itemId: string, rackId: string) => void;
}

const ROW_ACCENTS = ['blue', 'green', 'amber', 'cyan'] as const;
/** SKUs longer than this span the full row width inside the 3-col grid. */
const LONG_SKU_SPAN_LEN = 12;

function binsThroughHighestOccupied(bins: BinSlot[]): BinSlot[] {
  let highest = 0;
  for (const bin of bins) {
    if ((bin.skus.length > 0 || bin.unlinked.length > 0) && bin.binNumber > highest) {
      highest = bin.binNumber;
    }
  }
  if (highest <= 0) return [];
  return bins.filter(bin => bin.binNumber <= highest);
}

/** Fill missing row numbers between the lowest and highest occupied (descending). */
function rowsWithMissingGaps(rows: RowTile[]): DisplayRow[] {
  if (rows.length === 0) return [];

  let highest = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.rowNumber > highest) highest = row.rowNumber;
    if (row.rowNumber < lowest) lowest = row.rowNumber;
  }

  const byNumber = new Map(rows.map(row => [row.rowNumber, row]));
  const display: DisplayRow[] = [];
  for (let n = highest; n >= lowest; n--) {
    const occupied = byNumber.get(n);
    if (occupied) {
      display.push({ kind: 'occupied', rowNumber: occupied.rowNumber, bins: occupied.bins });
    } else {
      display.push({ kind: 'empty', rowNumber: n });
    }
  }
  return display;
}

type RowCell =
  | { kind: 'sku'; binNumber: number; chip: SpareRackSkuChip; wide: boolean }
  | { kind: 'unlinked'; binNumber: number; chip: SpareRackUnlinkedChip }
  | { kind: 'empty'; binNumber: number };

function cellsForRow(bins: BinSlot[]): RowCell[] {
  const cells: RowCell[] = [];
  for (const bin of bins) {
    if (bin.skus.length === 0 && bin.unlinked.length === 0) {
      cells.push({ kind: 'empty', binNumber: bin.binNumber });
      continue;
    }
    for (const chip of bin.skus) {
      cells.push({
        kind: 'sku',
        binNumber: bin.binNumber,
        chip,
        wide: chip.sku.trim().length > LONG_SKU_SPAN_LEN,
      });
    }
    for (const chip of bin.unlinked) {
      cells.push({ kind: 'unlinked', binNumber: bin.binNumber, chip });
    }
  }
  return cells;
}

function normalizeRackId(rackId: string): string {
  return rackId.trim().toLowerCase();
}

function primaryPhoto(item: YesStoreItemDoc): YesStorePhoto | null {
  const photos = item.photos ?? [];
  return photos[0] ?? null;
}

function buildRowTilesForRack(
  onRack: YesStoreItemDoc[],
  catalogByProductId?: Map<string, { sku: string; name?: string | null }>,
): DisplayRow[] {
  const byRow = new Map<number, Map<number, {
    skus: Map<string, SpareRackSkuChip>;
    unlinked: SpareRackUnlinkedChip[];
  }>>();

  for (const item of onRack) {
    const row = Number(item.rowNumber);
    const bin = Number(item.binNumber);
    if (!Number.isFinite(row) || !Number.isFinite(bin)) continue;
    if (!ROW_NUMBERS.includes(row as (typeof ROW_NUMBERS)[number])) continue;
    if (!BIN_NUMBERS.includes(bin as (typeof BIN_NUMBERS)[number])) continue;

    if (!byRow.has(row)) byRow.set(row, new Map());
    const binMap = byRow.get(row)!;
    if (!binMap.has(bin)) binMap.set(bin, { skus: new Map(), unlinked: [] });
    const slot = binMap.get(bin)!;
    const quantity = readItemQuantity(item);
    const productId = item.catalogProductId?.trim() || '';

    if (productId) {
      const live = catalogByProductId?.get(productId);
      const sku = (live?.sku?.trim()
        || item.catalogProductSku?.trim()
        || productId);
      const name = live?.name ?? item.catalogProductName;
      const existing = slot.skus.get(productId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        slot.skus.set(productId, { productId, sku, name, quantity });
      }
    } else {
      slot.unlinked.push({
        itemId: item.id,
        quantity,
        photo: primaryPhoto(item),
      });
    }
  }

  const occupied = [...byRow.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rowNumber, binMap]) => ({
      rowNumber,
      bins: BIN_NUMBERS.map(binNumber => {
        const slot = binMap.get(binNumber);
        return {
          binNumber,
          skus: [...(slot?.skus.values() ?? [])].sort((a, b) => a.sku.localeCompare(b.sku)),
          unlinked: slot?.unlinked ?? [],
        };
      }),
    }));

  return rowsWithMissingGaps(occupied);
}

function SkuCell({
  binNumber,
  chip,
  wide,
  rackLetter,
  highlightedProductId,
  onSkuClick,
}: {
  binNumber: number;
  chip: SpareRackSkuChip;
  wide?: boolean;
  rackLetter: string;
  highlightedProductId?: string | null;
  onSkuClick: (productId: string, rackId: string) => void;
}) {
  const focused = Boolean(highlightedProductId && chip.productId === highlightedProductId);
  const qtyLabel = `×${chip.quantity}`;
  const titleBase = chip.name ? `${chip.sku} · ${chip.name}` : `Bin ${binNumber}: ${chip.sku}`;
  return (
    <button
      type="button"
      data-product-id={chip.productId}
      className={[
        'spare-rack-cell',
        'spare-rack-cell--sku',
        wide ? 'spare-rack-cell--wide' : '',
        focused ? 'is-focus' : '',
      ].filter(Boolean).join(' ')}
      title={`${titleBase} · Qty ${chip.quantity}`}
      onClick={() => onSkuClick(chip.productId, rackLetter)}
    >
      <div className="spare-rack-cell__meta">
        <span className="spare-rack-cell__label">BIN {binNumber}</span>
        <span className="spare-rack-cell__dot" aria-hidden />
        <span className="spare-rack-cell__qty" aria-label={`Quantity ${chip.quantity}`}>
          {qtyLabel}
        </span>
      </div>
      <div className="spare-rack-cell__body">
        <Box className="spare-rack-cell__icon spare-rack-cell__icon--live" size={16} strokeWidth={1.75} aria-hidden />
        <span className="spare-rack-cell__sku">{chip.sku}</span>
        <ChevronRight className="spare-rack-cell__chevron" size={14} strokeWidth={2.25} aria-hidden />
      </div>
    </button>
  );
}

function UnlinkedCell({
  binNumber,
  chip,
  rackLetter,
  highlightedAuditItemId,
  onUnlinkedClick,
}: {
  binNumber: number;
  chip: SpareRackUnlinkedChip;
  rackLetter: string;
  highlightedAuditItemId?: string | null;
  onUnlinkedClick: (itemId: string, rackId: string) => void;
}) {
  const focused = Boolean(highlightedAuditItemId && chip.itemId === highlightedAuditItemId);
  const qtyLabel = `×${chip.quantity}`;
  return (
    <button
      type="button"
      data-audit-item-id={chip.itemId}
      className={[
        'spare-rack-cell',
        'spare-rack-cell--unlinked',
        focused ? 'is-focus' : '',
      ].filter(Boolean).join(' ')}
      title={`Bin ${binNumber}: unlinked audit · Qty ${chip.quantity}`}
      aria-label={`Bin ${binNumber}, unlinked audit item, quantity ${chip.quantity}`}
      onClick={() => onUnlinkedClick(chip.itemId, rackLetter)}
    >
      <div className="spare-rack-cell__meta">
        <span className="spare-rack-cell__label">BIN {binNumber}</span>
        <span className="spare-rack-cell__dot" aria-hidden />
        <span className="spare-rack-cell__qty" aria-label={`Quantity ${chip.quantity}`}>
          {qtyLabel}
        </span>
      </div>
      <div className="spare-rack-cell__body spare-rack-cell__body--unlinked">
        <span className="spare-rack-cell__thumb" aria-hidden>
          {chip.photo ? (
            <YesStorePhotoImg
              photo={chip.photo}
              alt=""
              className="spare-rack-cell__thumb-img"
              emptyClassName="spare-rack-cell__thumb-empty"
            />
          ) : (
            <Box className="spare-rack-cell__icon spare-rack-cell__icon--unlinked" size={16} strokeWidth={1.75} />
          )}
        </span>
        <span className="spare-rack-cell__sku spare-rack-cell__sku--unlinked">Unlinked</span>
        <ChevronRight className="spare-rack-cell__chevron" size={14} strokeWidth={2.25} aria-hidden />
      </div>
    </button>
  );
}

function EmptyBinCell({ binNumber }: { binNumber: number }) {
  return (
    <div className="spare-rack-cell spare-rack-cell--empty" aria-label={`Bin ${binNumber}, empty`}>
      <div className="spare-rack-cell__meta">
        <span className="spare-rack-cell__label">BIN {binNumber}</span>
      </div>
      <div className="spare-rack-cell__body">
        <Box className="spare-rack-cell__icon" size={16} strokeWidth={1.75} aria-hidden />
        <span className="spare-rack-cell__sku spare-rack-cell__sku--empty">Empty</span>
      </div>
    </div>
  );
}

function EmptyRowCard({ rowNumber }: { rowNumber: number }) {
  return (
    <article
      className="spare-rack-row spare-rack-row--empty"
      role="listitem"
      aria-label={`Row ${rowNumber}, empty`}
    >
      <header className="spare-rack-row__head">
        <div className="spare-rack-row__title">
          <Rows3 className="spare-rack-row__icon" size={16} strokeWidth={2.25} aria-hidden />
          <span>ROW {rowNumber}</span>
        </div>
        <span className="spare-rack-row__meta">EMPTY</span>
      </header>
      <div className="spare-rack-row__empty-body">
        <Box className="spare-rack-row__empty-icon" size={16} strokeWidth={1.75} aria-hidden />
        <span className="spare-rack-row__empty-label">No bins on this row</span>
      </div>
    </article>
  );
}

function RackRows({
  page,
  highlightedProductId,
  highlightedAuditItemId,
  onSkuClick,
  onUnlinkedClick,
}: {
  page: RackPage;
  highlightedProductId?: string | null;
  highlightedAuditItemId?: string | null;
  onSkuClick: (productId: string, rackId: string) => void;
  onUnlinkedClick: (itemId: string, rackId: string) => void;
}) {
  if (page.rows.length === 0) {
    return (
      <p className="text-muted spare-parts-rack-view__empty">
        No audited items on rack {page.letter.toUpperCase()}.
      </p>
    );
  }

  let occupiedIndex = 0;

  return (
    <div className="spare-rack-rows" role="list">
      {page.rows.map(row => {
        if (row.kind === 'empty') {
          return (
            <EmptyRowCard
              key={`${page.letter}-empty-${row.rowNumber}`}
              rowNumber={row.rowNumber}
            />
          );
        }

        const visibleBins = binsThroughHighestOccupied(row.bins);
        const cells = cellsForRow(visibleBins);
        const accent = ROW_ACCENTS[occupiedIndex % ROW_ACCENTS.length];
        occupiedIndex += 1;
        return (
          <article
            key={`${page.letter}-${row.rowNumber}`}
            className={`spare-rack-row spare-rack-row--${accent}`}
            role="listitem"
          >
            <header className="spare-rack-row__head">
              <div className="spare-rack-row__title">
                <Rows3 className="spare-rack-row__icon" size={16} strokeWidth={2.25} aria-hidden />
                <span>ROW {row.rowNumber}</span>
              </div>
              <span className="spare-rack-row__meta">
                {visibleBins.length} BIN{visibleBins.length === 1 ? '' : 'S'} PER ROW
              </span>
            </header>
            <div className="spare-rack-row__cells">
              {cells.map(cell => {
                if (cell.kind === 'empty') {
                  return <EmptyBinCell key={`empty-${cell.binNumber}`} binNumber={cell.binNumber} />;
                }
                if (cell.kind === 'unlinked') {
                  return (
                    <UnlinkedCell
                      key={`unlinked-${cell.binNumber}-${cell.chip.itemId}`}
                      binNumber={cell.binNumber}
                      chip={cell.chip}
                      rackLetter={page.letter}
                      highlightedAuditItemId={highlightedAuditItemId}
                      onUnlinkedClick={onUnlinkedClick}
                    />
                  );
                }
                return (
                  <SkuCell
                    key={`${cell.binNumber}-${cell.chip.productId}`}
                    binNumber={cell.binNumber}
                    chip={cell.chip}
                    wide={cell.wide}
                    rackLetter={page.letter}
                    highlightedProductId={highlightedProductId}
                    onSkuClick={onSkuClick}
                  />
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Location-first spare map: racks → row×bin cards with linked SKUs + unlinked audits. */
export const SparePartsRackView: React.FC<SparePartsRackViewProps> = ({
  items,
  spareProductIds,
  catalogByProductId,
  loading = false,
  highlightedProductId = null,
  highlightedAuditItemId = null,
  initialRackId = null,
  onSkuClick,
  onUnlinkedClick,
}) => {
  const rackItems = useMemo(() => {
    return items.filter(item => {
      const rack = normalizeRackId(item.rackId);
      if (!VALID_RACK_LETTERS.includes(rack)) return false;
      const pid = item.catalogProductId?.trim();
      if (!pid) return true;
      return spareProductIds.has(pid);
    });
  }, [items, spareProductIds]);

  const rackPages = useMemo((): RackPage[] => {
    const byRack = new Map<string, YesStoreItemDoc[]>();
    for (const item of rackItems) {
      const letter = normalizeRackId(item.rackId);
      if (!byRack.has(letter)) byRack.set(letter, []);
      byRack.get(letter)!.push(item);
    }
    return VALID_RACK_LETTERS
      .filter(letter => byRack.has(letter))
      .map(letter => ({
        letter,
        rows: buildRowTilesForRack(byRack.get(letter)!, catalogByProductId),
      }));
  }, [rackItems, catalogByProductId]);

  const rackLetters = useMemo(() => rackPages.map(p => p.letter), [rackPages]);

  const [rackFilter, setRackFilter] = useState<string | null>(null);
  const racksBarRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollingFromChipRef = useRef(false);
  const scrollSyncTimerRef = useRef<number | null>(null);
  const pagesKey = rackLetters.join(',');

  useEffect(() => {
    if (rackLetters.length === 0) {
      setRackFilter(null);
      return;
    }
    setRackFilter(prev => {
      if (prev && rackLetters.includes(prev)) return prev;
      if (initialRackId && rackLetters.includes(initialRackId)) return initialRackId;
      return rackLetters[0];
    });
  }, [rackLetters, initialRackId]);

  useEffect(() => {
    if (!rackFilter || !racksBarRef.current) return;
    const chip = racksBarRef.current.querySelector<HTMLElement>(
      `[data-rack="${rackFilter}"]`,
    );
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [rackFilter]);

  const scrollCarouselToRack = useCallback((letter: string, smooth: boolean) => {
    const root = carouselRef.current;
    if (!root) return;
    const page = root.querySelector<HTMLElement>(`[data-rack-page="${letter}"]`);
    if (!page) return;
    scrollingFromChipRef.current = true;
    root.scrollTo({
      left: page.offsetLeft,
      behavior: smooth ? 'smooth' : 'auto',
    });
    window.setTimeout(() => {
      scrollingFromChipRef.current = false;
    }, smooth ? 450 : 40);
  }, []);

  const selectRack = useCallback((letter: string) => {
    setRackFilter(letter);
    scrollCarouselToRack(letter, true);
  }, [scrollCarouselToRack]);

  useEffect(() => {
    if (!initialRackId || !rackLetters.includes(initialRackId)) return;
    setRackFilter(initialRackId);
    scrollCarouselToRack(initialRackId, false);
  }, [initialRackId, rackLetters, scrollCarouselToRack]);

  useEffect(() => {
    if (!highlightedProductId && !highlightedAuditItemId) return;
    const timer = window.setTimeout(() => {
      const selector = highlightedProductId
        ? `.spare-parts-rack-view [data-product-id="${CSS.escape(highlightedProductId)}"]`
        : `.spare-parts-rack-view [data-audit-item-id="${CSS.escape(highlightedAuditItemId!)}"]`;
      const el = document.querySelector<HTMLElement>(selector);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [highlightedProductId, highlightedAuditItemId, rackFilter, rackPages]);

  useEffect(() => {
    if (!rackFilter || rackPages.length === 0) return;
    scrollCarouselToRack(rackFilter, false);
  }, [pagesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncRackFromScroll = useCallback(() => {
    const root = carouselRef.current;
    if (!root || scrollingFromChipRef.current || rackPages.length === 0) return;
    const width = root.clientWidth || 1;
    const index = Math.round(root.scrollLeft / width);
    const clamped = Math.max(0, Math.min(rackPages.length - 1, index));
    const letter = rackPages[clamped]?.letter;
    if (letter) setRackFilter(prev => (prev === letter ? prev : letter));
  }, [rackPages]);

  const onCarouselScroll = () => {
    if (scrollSyncTimerRef.current) window.clearTimeout(scrollSyncTimerRef.current);
    syncRackFromScroll();
    scrollSyncTimerRef.current = window.setTimeout(() => {
      syncRackFromScroll();
    }, 60);
  };

  useEffect(() => () => {
    if (scrollSyncTimerRef.current) window.clearTimeout(scrollSyncTimerRef.current);
  }, []);

  const activePage = rackPages.find(p => p.letter === rackFilter) ?? rackPages[0] ?? null;
  const canScrollRacks = rackLetters.length > 4;

  if (loading && rackItems.length === 0) {
    return (
      <div className="spare-parts-rack-view">
        <p className="text-muted spare-parts-rack-view__empty">Loading rack locations…</p>
      </div>
    );
  }

  if (rackPages.length === 0) {
    return (
      <div className="spare-parts-rack-view">
        <p className="text-muted spare-parts-rack-view__empty">
          No audited spare SKUs or unlinked items in warehouse locations yet.
        </p>
      </div>
    );
  }

  return (
    <div className="spare-parts-rack-view">
      <div className="spare-rack-selector">
        <span className="spare-rack-selector__label">RACK</span>
        <div
          ref={racksBarRef}
          className="spare-rack-selector__chips"
          role="tablist"
          aria-label="Select rack"
        >
          {rackLetters.map(letter => {
            const active = rackFilter === letter;
            return (
              <button
                key={letter}
                type="button"
                role="tab"
                data-rack={letter}
                className={`spare-rack-selector__chip${active ? ' is-active' : ''}`}
                aria-selected={active}
                title={`Rack ${letter.toUpperCase()}`}
                onClick={() => selectRack(letter)}
              >
                {letter.toUpperCase()}
              </button>
            );
          })}
        </div>
        {canScrollRacks ? (
          <span className="spare-rack-selector__more" aria-hidden>
            <ChevronRight size={16} strokeWidth={2.25} />
          </span>
        ) : null}
      </div>

      <div
        ref={carouselRef}
        className="spare-parts-rack-view__carousel"
        onScroll={onCarouselScroll}
        aria-label="Swipe between racks"
      >
        {rackPages.map(page => (
          <section
            key={page.letter}
            data-rack-page={page.letter}
            className="spare-parts-rack-view__carousel-page"
            aria-label={`Rack ${page.letter.toUpperCase()}`}
          >
            <RackRows
              page={page}
              highlightedProductId={highlightedProductId}
              highlightedAuditItemId={highlightedAuditItemId}
              onSkuClick={onSkuClick}
              onUnlinkedClick={onUnlinkedClick}
            />
          </section>
        ))}
      </div>

      {activePage && (
        <div className="spare-parts-rack-view__desktop">
          <RackRows
            page={activePage}
            highlightedProductId={highlightedProductId}
            highlightedAuditItemId={highlightedAuditItemId}
            onSkuClick={onSkuClick}
            onUnlinkedClick={onUnlinkedClick}
          />
        </div>
      )}
    </div>
  );
};
