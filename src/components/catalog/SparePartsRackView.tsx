import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { YesStoreItemDoc } from '../../types/yes-store';
import { BIN_NUMBERS, VALID_RACK_LETTERS } from '../../types/yes-store';

export interface SpareRackSkuChip {
  productId: string;
  sku: string;
  name?: string | null;
}

interface BinSlot {
  binNumber: number;
  skus: SpareRackSkuChip[];
}

interface RowTile {
  rowNumber: number;
  bins: BinSlot[];
}

interface RackPage {
  letter: string;
  rows: RowTile[];
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
  /** Prefer opening this rack letter (e.g. restore after detail). */
  initialRackId?: string | null;
  onSkuClick: (productId: string, rackId: string) => void;
}

function binsThroughHighestOccupied(bins: BinSlot[]): BinSlot[] {
  let highest = 0;
  for (const bin of bins) {
    if (bin.skus.length > 0 && bin.binNumber > highest) highest = bin.binNumber;
  }
  if (highest <= 0) return [];
  return bins.filter(bin => bin.binNumber <= highest);
}

function highestOccupiedBin(rows: RowTile[]): number {
  let highest = 0;
  for (const row of rows) {
    for (const bin of row.bins) {
      if (bin.skus.length > 0 && bin.binNumber > highest) highest = bin.binNumber;
    }
  }
  return highest;
}

function normalizeRackId(rackId: string): string {
  return rackId.trim().toLowerCase();
}

function buildRowTilesForRack(
  onRack: YesStoreItemDoc[],
  catalogByProductId?: Map<string, { sku: string; name?: string | null }>,
): RowTile[] {
  const byRow = new Map<number, Map<number, Map<string, SpareRackSkuChip>>>();

  for (const item of onRack) {
    const row = Number(item.rowNumber);
    const bin = Number(item.binNumber);
    if (!Number.isFinite(row) || !Number.isFinite(bin)) continue;
    if (!BIN_NUMBERS.includes(bin as (typeof BIN_NUMBERS)[number])) continue;
    const productId = item.catalogProductId!.trim();
    const live = catalogByProductId?.get(productId);
    const sku = (live?.sku?.trim()
      || item.catalogProductSku?.trim()
      || productId);
    const name = live?.name ?? item.catalogProductName;
    if (!byRow.has(row)) byRow.set(row, new Map());
    const binMap = byRow.get(row)!;
    if (!binMap.has(bin)) binMap.set(bin, new Map());
    const skuMap = binMap.get(bin)!;
    if (!skuMap.has(productId)) {
      skuMap.set(productId, { productId, sku, name });
    }
  }

  return [...byRow.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rowNumber, binMap]) => ({
      rowNumber,
      bins: BIN_NUMBERS.map(binNumber => ({
        binNumber,
        skus: [...(binMap.get(binNumber)?.values() ?? [])]
          .sort((a, b) => a.sku.localeCompare(b.sku)),
      })),
    }));
}

function SkuButtons({
  skus,
  highlightedProductId,
  onSkuClick,
}: {
  skus: SpareRackSkuChip[];
  highlightedProductId?: string | null;
  onSkuClick: (productId: string) => void;
}) {
  return (
    <>
      {skus.map(chip => {
        const focused = Boolean(highlightedProductId && chip.productId === highlightedProductId);
        return (
          <button
            key={chip.productId}
            type="button"
            data-product-id={chip.productId}
            className={[
              'spare-parts-rack-view__sku',
              focused ? 'is-focus' : '',
            ].filter(Boolean).join(' ')}
            title={chip.name ? `${chip.sku} · ${chip.name}` : chip.sku}
            onClick={() => onSkuClick(chip.productId)}
          >
            {chip.sku}
          </button>
        );
      })}
    </>
  );
}

/** Location-first spare map: racks → row×bin grid with audited SKUs only. */
export const SparePartsRackView: React.FC<SparePartsRackViewProps> = ({
  items,
  spareProductIds,
  catalogByProductId,
  loading = false,
  highlightedProductId = null,
  initialRackId = null,
  onSkuClick,
}) => {
  const linkedItems = useMemo(() => {
    return items.filter(item => {
      const pid = item.catalogProductId?.trim();
      if (!pid || !spareProductIds.has(pid)) return false;
      const rack = normalizeRackId(item.rackId);
      return VALID_RACK_LETTERS.includes(rack);
    });
  }, [items, spareProductIds]);

  const rackPages = useMemo((): RackPage[] => {
    const byRack = new Map<string, YesStoreItemDoc[]>();
    for (const item of linkedItems) {
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
  }, [linkedItems, catalogByProductId]);

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

  // Apply restored rack once when returning from detail.
  useEffect(() => {
    if (!initialRackId || !rackLetters.includes(initialRackId)) return;
    setRackFilter(initialRackId);
    scrollCarouselToRack(initialRackId, false);
  }, [initialRackId, rackLetters, scrollCarouselToRack]);

  // Scroll highlighted SKU into view after returning from detail.
  useEffect(() => {
    if (!highlightedProductId) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `.spare-parts-rack-view [data-product-id="${CSS.escape(highlightedProductId)}"]`,
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [highlightedProductId, rackFilter, rackPages]);

  // Align carousel when rack list changes (not on every swipe-driven chip sync).
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

  if (loading && linkedItems.length === 0) {
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
          No audited spare SKUs in warehouse locations yet.
        </p>
      </div>
    );
  }

  return (
    <div className="spare-parts-rack-view">
      <div
        ref={racksBarRef}
        className="spare-parts-rack-view__racks"
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
              className={`catalog-inventory-audit__rack-chip${active ? ' is-active' : ''}`}
              aria-selected={active}
              title={`Rack ${letter.toUpperCase()}`}
              onClick={() => selectRack(letter)}
            >
              {letter.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Mobile carousel: swipe reveals next/prev rack gradually */}
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
            {page.rows.length === 0 ? (
              <p className="text-muted spare-parts-rack-view__empty">
                No audited SKUs on rack {page.letter.toUpperCase()}.
              </p>
            ) : (
              <div className="spare-parts-rack-view__mobile" role="list">
                {page.rows.map(row => {
                  const visibleBins = binsThroughHighestOccupied(row.bins);
                  return (
                    <article
                      key={`${page.letter}-${row.rowNumber}`}
                      className="spare-parts-rack-view__mobile-row"
                      role="listitem"
                    >
                      <header className="spare-parts-rack-view__mobile-row-head">
                        Row {row.rowNumber}
                      </header>
                      <div className="spare-parts-rack-view__mobile-bins">
                        {visibleBins.map(bin => (
                          <div
                            key={bin.binNumber}
                            className={[
                              'spare-parts-rack-view__mobile-bin',
                              bin.skus.length === 0 ? 'is-empty' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <div className="spare-parts-rack-view__mobile-bin-label">
                              Bin {bin.binNumber}
                            </div>
                            <div className="spare-parts-rack-view__mobile-skus">
                              <SkuButtons
                                skus={bin.skus}
                                highlightedProductId={highlightedProductId}
                                onSkuClick={productId => onSkuClick(productId, page.letter)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Desktop table for active rack */}
      {activePage && (
        <div className="spare-parts-rack-view__grid-wrap">
          {activePage.rows.length === 0 ? (
            <p className="text-muted spare-parts-rack-view__empty">
              No audited SKUs on rack {activePage.letter.toUpperCase()}.
            </p>
          ) : (() => {
            const maxBin = highestOccupiedBin(activePage.rows);
            const visibleBinNumbers = BIN_NUMBERS.filter(n => n <= maxBin);
            const gridStyle = {
              gridTemplateColumns: `2.5rem repeat(${visibleBinNumbers.length}, minmax(0, 1fr))`,
            } as const;
            return (
              <div
                className="spare-parts-rack-view__grid"
                role="table"
                aria-label={`Rack ${activePage.letter.toUpperCase()} rows and bins`}
              >
                <div className="spare-parts-rack-view__grid-head" role="row" style={gridStyle}>
                  <div className="spare-parts-rack-view__cell spare-parts-rack-view__cell--row-head" role="columnheader">
                    Row
                  </div>
                  {visibleBinNumbers.map(bin => (
                    <div
                      key={bin}
                      className="spare-parts-rack-view__cell spare-parts-rack-view__cell--bin-head"
                      role="columnheader"
                    >
                      Bin {bin}
                    </div>
                  ))}
                </div>
                {activePage.rows.map(row => (
                  <div
                    key={`${activePage.letter}-${row.rowNumber}`}
                    className="spare-parts-rack-view__grid-row"
                    role="row"
                    style={gridStyle}
                  >
                    <div
                      className="spare-parts-rack-view__cell spare-parts-rack-view__cell--row"
                      role="rowheader"
                    >
                      {row.rowNumber}
                    </div>
                    {row.bins
                      .filter(bin => bin.binNumber <= maxBin)
                      .map(bin => (
                        <div
                          key={bin.binNumber}
                          className={[
                            'spare-parts-rack-view__cell',
                            'spare-parts-rack-view__cell--bin',
                            bin.skus.length === 0 ? 'is-empty' : '',
                          ].filter(Boolean).join(' ')}
                          role="cell"
                          aria-label={`Row ${row.rowNumber} bin ${bin.binNumber}`}
                        >
                          <SkuButtons
                            skus={bin.skus}
                            highlightedProductId={highlightedProductId}
                            onSkuClick={productId => onSkuClick(productId, activePage.letter)}
                          />
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
