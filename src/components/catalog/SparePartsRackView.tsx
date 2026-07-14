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

interface SparePartsRackViewProps {
  items: YesStoreItemDoc[];
  /** Catalog spare product ids — only linked audited bins for these show SKUs. */
  spareProductIds: Set<string>;
  /** Live catalog SKUs/names by product id (preferred over yesStore snapshots). */
  catalogByProductId?: Map<string, { sku: string; name?: string | null }>;
  loading?: boolean;
  onSkuClick: (productId: string) => void;
}

function normalizeRackId(rackId: string): string {
  return rackId.trim().toLowerCase();
}

const SWIPE_MIN_DX = 56;
const SWIPE_DOMINANCE = 1.25;

/** Location-first spare map: racks → row×bin grid with audited SKUs only. */
export const SparePartsRackView: React.FC<SparePartsRackViewProps> = ({
  items,
  spareProductIds,
  catalogByProductId,
  loading = false,
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

  const rackLetters = useMemo(() => {
    const present = new Set(linkedItems.map(i => normalizeRackId(i.rackId)));
    return VALID_RACK_LETTERS.filter(letter => present.has(letter));
  }, [linkedItems]);

  const [rackFilter, setRackFilter] = useState<string | null>(null);
  const racksBarRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  useEffect(() => {
    if (rackLetters.length === 0) {
      setRackFilter(null);
      return;
    }
    setRackFilter(prev => (prev && rackLetters.includes(prev) ? prev : rackLetters[0]));
  }, [rackLetters]);

  useEffect(() => {
    if (!rackFilter || !racksBarRef.current) return;
    const chip = racksBarRef.current.querySelector<HTMLElement>(
      `[data-rack="${rackFilter}"]`,
    );
    chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [rackFilter]);

  const goAdjacentRack = useCallback((direction: -1 | 1) => {
    if (!rackFilter || rackLetters.length < 2) return;
    const index = rackLetters.indexOf(rackFilter);
    if (index < 0) return;
    const next = rackLetters[index + direction];
    if (next) setRackFilter(next);
  }, [rackFilter, rackLetters]);

  const onSwipeStart = (clientX: number, clientY: number) => {
    swipeRef.current = { x: clientX, y: clientY, active: true };
  };

  const onSwipeEnd = (clientX: number, clientY: number) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start?.active) return;
    const dx = clientX - start.x;
    const dy = clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_DX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return;
    // Swipe left → next rack; swipe right → previous rack
    goAdjacentRack(dx < 0 ? 1 : -1);
  };

  const rowTiles = useMemo((): RowTile[] => {
    if (!rackFilter) return [];
    const onRack = linkedItems.filter(i => normalizeRackId(i.rackId) === rackFilter);
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
      .sort((a, b) => a[0] - b[0])
      .map(([rowNumber, binMap]) => ({
        rowNumber,
        bins: BIN_NUMBERS.map(binNumber => ({
          binNumber,
          skus: [...(binMap.get(binNumber)?.values() ?? [])]
            .sort((a, b) => a.sku.localeCompare(b.sku)),
        })),
      }));
  }, [linkedItems, rackFilter, catalogByProductId]);

  const rackIndex = rackFilter ? rackLetters.indexOf(rackFilter) : -1;
  const canSwipePrev = rackIndex > 0;
  const canSwipeNext = rackIndex >= 0 && rackIndex < rackLetters.length - 1;

  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) onSwipeStart(t.clientX, t.clientY);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) onSwipeEnd(t.clientX, t.clientY);
    },
    onTouchCancel: () => {
      swipeRef.current = null;
    },
  };

  if (loading && linkedItems.length === 0) {
    return (
      <div className="spare-parts-rack-view">
        <p className="text-muted spare-parts-rack-view__empty">Loading rack locations…</p>
      </div>
    );
  }

  if (rackLetters.length === 0) {
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
        role="group"
        aria-label="Select rack"
      >
        {rackLetters.map(letter => {
          const active = rackFilter === letter;
          return (
            <button
              key={letter}
              type="button"
              data-rack={letter}
              className={`catalog-inventory-audit__rack-chip${active ? ' is-active' : ''}`}
              aria-pressed={active}
              title={`Rack ${letter.toUpperCase()}`}
              onClick={() => setRackFilter(letter)}
            >
              {letter.toUpperCase()}
            </button>
          );
        })}
      </div>

      {rowTiles.length === 0 ? (
        <p className="text-muted spare-parts-rack-view__empty">
          No audited SKUs on rack {rackFilter?.toUpperCase()}.
        </p>
      ) : (
        <div
          className="spare-parts-rack-view__rows-area"
          {...swipeHandlers}
          aria-label={`Rack ${rackFilter?.toUpperCase()} rows. Swipe left or right to change rack.`}
        >
          {(canSwipePrev || canSwipeNext) && (
            <p className="spare-parts-rack-view__swipe-hint text-muted">
              Swipe sideways to change rack
              {canSwipePrev ? ` · ← ${rackLetters[rackIndex - 1]?.toUpperCase()}` : ''}
              {canSwipeNext ? ` · ${rackLetters[rackIndex + 1]?.toUpperCase()} →` : ''}
            </p>
          )}

          {/* Mobile: vertical row cards — all bins 1–9, empty stay blank */}
          <div className="spare-parts-rack-view__mobile" role="list">
            {rowTiles.map(row => (
              <article
                key={`${rackFilter}-${row.rowNumber}`}
                className="spare-parts-rack-view__mobile-row"
                role="listitem"
              >
                <header className="spare-parts-rack-view__mobile-row-head">
                  Row {row.rowNumber}
                </header>
                <div className="spare-parts-rack-view__mobile-bins">
                  {row.bins.map(bin => (
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
                        {bin.skus.map(chip => (
                          <button
                            key={chip.productId}
                            type="button"
                            className="spare-parts-rack-view__sku"
                            title={chip.name ? `${chip.sku} · ${chip.name}` : chip.sku}
                            onClick={() => onSkuClick(chip.productId)}
                          >
                            {chip.sku}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {/* Desktop / wider: compact table — all bins 1–9, empty stay blank */}
          <div className="spare-parts-rack-view__grid-wrap">
            <div
              className="spare-parts-rack-view__grid"
              role="table"
              aria-label={`Rack ${rackFilter?.toUpperCase()} rows and bins`}
            >
              <div className="spare-parts-rack-view__grid-head" role="row">
                <div className="spare-parts-rack-view__cell spare-parts-rack-view__cell--row-head" role="columnheader">
                  Row
                </div>
                {BIN_NUMBERS.map(bin => (
                  <div
                    key={bin}
                    className="spare-parts-rack-view__cell spare-parts-rack-view__cell--bin-head"
                    role="columnheader"
                  >
                    Bin {bin}
                  </div>
                ))}
              </div>
              {rowTiles.map(row => (
                <div key={`${rackFilter}-${row.rowNumber}`} className="spare-parts-rack-view__grid-row" role="row">
                  <div
                    className="spare-parts-rack-view__cell spare-parts-rack-view__cell--row"
                    role="rowheader"
                  >
                    {row.rowNumber}
                  </div>
                  {row.bins.map(bin => (
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
                      {bin.skus.map(chip => (
                        <button
                          key={chip.productId}
                          type="button"
                          className="spare-parts-rack-view__sku"
                          title={chip.name ? `${chip.sku} · ${chip.name}` : chip.sku}
                          onClick={() => onSkuClick(chip.productId)}
                        >
                          {chip.sku}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
