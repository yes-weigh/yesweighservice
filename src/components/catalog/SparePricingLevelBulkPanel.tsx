import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Layers, Loader2, X } from 'lucide-react';
import { DecimalAmountInput } from '../DecimalAmountInput';
import { isDefaultDealerPriceLevel, loadPriceLevels } from '../../lib/priceLevels';
import {
  buildDealerListRates,
  filterSpareLevelBulkRows,
  formatSpareLevelSees,
  formatSpareRuleSummary,
  getSpareCategoryRule,
  isSpareLevelAdjustDraftActive,
  previewSpareLevelAdjust,
  type SpareLevelAdjustDraft,
  type SpareLevelBulkRow,
  type SpareLevelPriceAdjust,
} from '../../lib/sparePriceLevelBulk';
import type { PriceLevel } from '../../types/priceLevels';
import type { PriceLevelRuleMode } from '../../types/priceLevels';

type Props = {
  open: boolean;
  onClose: () => void;
  rows: SpareLevelBulkRow[];
  /** Seed drafts when reopening (local, unsaved). */
  initialAdjusts?: SpareLevelPriceAdjust[];
  /** Local New sell = landing × (1 + dealerProfit%/100). Not Firestore. */
  onDealerListRatesApplied?: (updates: Array<{ productId: string; rate: number }>) => void;
  /** Local level discount/hike on New sell. Not Firestore until main Save. */
  onLevelsApplied?: (adjusts: SpareLevelPriceAdjust[]) => void;
};

export const SparePricingLevelBulkPanel: React.FC<Props> = ({
  open,
  onClose,
  rows,
  initialAdjusts = [],
  onDealerListRatesApplied,
  onLevelsApplied,
}) => {
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dealerProfitPercent, setDealerProfitPercent] = useState<number | null>(35);
  const [drafts, setDrafts] = useState<Record<string, SpareLevelAdjustDraft>>({});
  const [dealerPricesApplied, setDealerPricesApplied] = useState(false);

  const initialAdjustsRef = React.useRef(initialAdjusts);
  initialAdjustsRef.current = initialAdjusts;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDealerProfitPercent(35);
    setDealerPricesApplied(false);
    void loadPriceLevels()
      .then(docData => {
        if (cancelled) return;
        const sorted = [...docData.levels].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
        setLevels(sorted);
        const byId = new Map(initialAdjustsRef.current.map(a => [a.levelId, a]));
        const next: Record<string, SpareLevelAdjustDraft> = {};
        for (const level of sorted) {
          if (isDefaultDealerPriceLevel(level)) {
            next[level.id] = { levelId: level.id, mode: 'discount', percent: 0 };
            continue;
          }
          const existing = byId.get(level.id);
          next[level.id] = existing
            ? { levelId: level.id, mode: existing.mode, percent: existing.percent }
            : { levelId: level.id, mode: null, percent: null };
        }
        setDrafts(next);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load price levels.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { eligible: eligibleRows, skippedZeroPurchase } = useMemo(
    () => filterSpareLevelBulkRows(rows),
    [rows],
  );

  const adjustableLevels = useMemo(
    () => levels.filter(level => !isDefaultDealerPriceLevel(level)),
    [levels],
  );

  const activeAdjusts = useMemo((): SpareLevelPriceAdjust[] => {
    const out: SpareLevelPriceAdjust[] = [];
    for (const level of adjustableLevels) {
      const draft = drafts[level.id];
      if (!isSpareLevelAdjustDraftActive(draft) || draft.mode == null || draft.percent == null) {
        continue;
      }
      if (draft.percent <= 0) continue;
      out.push({
        levelId: level.id,
        levelName: level.name,
        mode: draft.mode,
        percent: draft.percent,
      });
    }
    return out;
  }, [adjustableLevels, drafts]);

  const applyDealerPricesLocally = useCallback(() => {
    if (dealerProfitPercent == null || !eligibleRows.length) return false;
    const listUpdates = buildDealerListRates(rows, dealerProfitPercent);
    if (!listUpdates.length) return false;
    onDealerListRatesApplied?.(listUpdates);
    setDealerPricesApplied(true);
    return true;
  }, [dealerProfitPercent, eligibleRows.length, rows, onDealerListRatesApplied]);

  const handleClose = useCallback(() => {
    applyDealerPricesLocally();
    onClose();
  }, [applyDealerPricesLocally, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  const patchDraft = (
    levelId: string,
    patch: Partial<Pick<SpareLevelAdjustDraft, 'mode' | 'percent'>>,
  ) => {
    setDrafts(prev => {
      const cur = prev[levelId] ?? { levelId, mode: null, percent: null };
      return {
        ...prev,
        [levelId]: { ...cur, ...patch },
      };
    });
  };

  const handleApplyDealerPrice = () => {
    if (dealerProfitPercent == null || !eligibleRows.length) return;
    applyDealerPricesLocally();
  };

  const handleApplyLevels = () => {
    if (dealerProfitPercent == null || !eligibleRows.length) return;
    applyDealerPricesLocally();
    onLevelsApplied?.(activeAdjusts);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="catalog-modal-backdrop"
      role="presentation"
      onClick={handleClose}
    >
      <div
        className="catalog-modal panel glass spare-pricing-levels"
        role="dialog"
        aria-modal="true"
        aria-label="Bulk spare level pricing"
        onClick={event => event.stopPropagation()}
      >
        <header className="spare-pricing-levels__header">
          <div className="spare-pricing-levels__title">
            <Layers size={18} aria-hidden />
            <div>
              <h2>Bulk level pricing</h2>
              <p>
                {eligibleRows.length}
                {' '}
                spare
                {eligibleRows.length === 1 ? '' : 's'}
                {' '}
                with purchase {'>'} 0
                {skippedZeroPurchase > 0
                  ? ` · ${skippedZeroPurchase} with purchase 0 skipped`
                  : ''}
                . Nothing is saved until toolbar Save.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="spare-pricing-levels__close"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="spare-pricing-levels__body">
          <section className="spare-pricing-levels__dealer-price" aria-label="Dealer price">
            <div className="spare-pricing-levels__dealer-price-head">
              <h3>Dealer price</h3>
              <p>
                Landing + profit % → New sell (local). Closing also applies it. Toolbar Save persists.
              </p>
            </div>
            <div className="spare-pricing-levels__dealer-price-row">
              <label className="spare-pricing-levels__dealer-profit">
                <span>Profit %</span>
                <div className="spare-pricing-levels__profit">
                  <DecimalAmountInput
                    className="spare-pricing__input"
                    value={dealerProfitPercent}
                    onChange={next => {
                      setDealerProfitPercent(next);
                      setDealerPricesApplied(false);
                    }}
                    min={0}
                    decimals={1}
                    allowEmpty
                    aria-label="Dealer profit percent on landing"
                    placeholder="e.g. 35"
                  />
                  <span aria-hidden>%</span>
                </div>
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm spare-pricing-levels__dealer-apply"
                onClick={handleApplyDealerPrice}
                disabled={dealerProfitPercent == null || eligibleRows.length === 0}
              >
                {dealerPricesApplied ? <Check size={14} aria-hidden /> : null}
                {dealerPricesApplied ? 'New sell updated' : 'Apply to New sell'}
              </button>
            </div>
          </section>

          {loading ? (
            <div className="spare-pricing-levels__loading">
              <Loader2 size={18} className="spin-icon" aria-hidden />
              Loading levels…
            </div>
          ) : levels.length === 0 ? (
            <p className="text-muted">
              No price levels yet. Create them under Dealers → Price level.
            </p>
          ) : (
            <table className="spare-pricing-levels__table">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Dealers</th>
                  <th scope="col">Current spare rule</th>
                  <th scope="col">On New sell</th>
                  <th scope="col">Dealer sees</th>
                </tr>
              </thead>
              <tbody>
                {levels.map(level => {
                  const isDefault = isDefaultDealerPriceLevel(level);
                  const draft = drafts[level.id];
                  const rule = getSpareCategoryRule(level);
                  const preview = isDefault
                    ? (
                      dealerProfitPercent != null
                        ? {
                          mode: 'list' as const,
                          percent: 0,
                          eligibleCount: eligibleRows.length,
                          skippedZeroPurchase,
                        }
                        : null
                    )
                    : previewSpareLevelAdjust(rows, draft?.mode ?? null, draft?.percent ?? null);
                  const sees = isDefault
                    ? (
                      dealerProfitPercent != null
                        ? `New sell (list) · ${eligibleRows.length}`
                        : '—'
                    )
                    : formatSpareLevelSees(preview);

                  return (
                    <tr key={level.id}>
                      <td>
                        <strong>{level.name}</strong>
                        {isDefault ? (
                          <span className="spare-pricing-levels__default-tag">Default</span>
                        ) : null}
                      </td>
                      <td>{isDefault ? 'All others' : level.dealerIds.length}</td>
                      <td className="spare-pricing-levels__rule">
                        {formatSpareRuleSummary(rule)}
                      </td>
                      <td>
                        {isDefault ? (
                          <span className="spare-pricing-levels__list-fixed">
                            = New sell
                          </span>
                        ) : (
                          <div className="spare-pricing-levels__adjust">
                            <div
                              className="spare-pricing-levels__mode-toggle"
                              role="group"
                              aria-label={`Discount or hike for ${level.name}`}
                            >
                              <button
                                type="button"
                                className={draft?.mode === 'discount' ? 'is-active' : ''}
                                onClick={() => patchDraft(level.id, {
                                  mode: 'discount',
                                  percent: draft?.percent ?? 0,
                                })}
                              >
                                Discount
                              </button>
                              <button
                                type="button"
                                className={draft?.mode === 'increment' ? 'is-active' : ''}
                                onClick={() => patchDraft(level.id, {
                                  mode: 'increment',
                                  percent: draft?.percent ?? 0,
                                })}
                              >
                                Hike
                              </button>
                            </div>
                            <div className="spare-pricing-levels__profit">
                              <DecimalAmountInput
                                className="spare-pricing__input"
                                value={draft?.percent ?? null}
                                onChange={next => patchDraft(level.id, {
                                  percent: next,
                                  mode: next == null
                                    ? null
                                    : ((draft?.mode ?? 'discount') as PriceLevelRuleMode),
                                })}
                                min={0}
                                decimals={2}
                                allowEmpty
                                aria-label={`${draft?.mode === 'increment' ? 'Hike' : 'Discount'} percent for ${level.name}`}
                                placeholder="Skip"
                              />
                              <span aria-hidden>%</span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            preview?.mode === 'discount'
                              ? 'spare-pricing-levels__sees is-discount'
                              : preview?.mode === 'increment'
                                ? 'spare-pricing-levels__sees is-hike'
                                : 'spare-pricing-levels__sees'
                          }
                        >
                          {sees}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <p className="spare-pricing-levels__hint">
            Discount / hike is on New sell (dealer list). Apply levels keeps a local draft —
            toolbar Save writes catalog rates and level rules.
          </p>

          {error ? (
            <p className="spare-pricing-levels__error" role="alert">{error}</p>
          ) : null}
        </div>

        <footer className="spare-pricing-levels__footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApplyLevels}
            disabled={
              loading
              || dealerProfitPercent == null
              || eligibleRows.length === 0
            }
          >
            <Layers size={16} aria-hidden />
            Apply
            {activeAdjusts.length ? ` (${activeAdjusts.length} level${activeAdjusts.length === 1 ? '' : 's'})` : ''}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
};
