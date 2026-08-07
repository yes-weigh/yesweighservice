import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  SPARE_PRICING_FILTER_GROUPS,
  type SparePricingFilterKey,
} from '../../lib/sparePricingFilters';

export type SparePricingFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  selected: ReadonlySet<SparePricingFilterKey>;
  counts: Record<SparePricingFilterKey, number>;
  onApply: (next: Set<SparePricingFilterKey>) => void;
};

export const SparePricingFilterSheet: React.FC<SparePricingFilterSheetProps> = ({
  open,
  onClose,
  selected,
  counts,
  onApply,
}) => {
  const [draft, setDraft] = useState<Set<SparePricingFilterKey>>(() => new Set(selected));

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const toggle = useCallback((key: SparePricingFilterKey) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const draftCount = draft.size;
  const hasDraft = draftCount > 0;

  const applyLabel = useMemo(
    () => (draftCount > 0 ? `Apply Filters (${draftCount})` : 'Apply Filters'),
    [draftCount],
  );

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="catalog-filter-dropdown__backdrop"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div
        className="catalog-filter-dropdown panel glass"
        role="dialog"
        aria-modal="true"
        aria-label="Filter spare pricing"
      >
        <div className="catalog-spares-multi-filters catalog-spares-multi-filters--dropdown">
          <div className="catalog-spares-multi-filters__header">
            <span className="catalog-spares-multi-filters__title">Filters</span>
            <div className="catalog-spares-multi-filters__header-actions">
              <button
                type="button"
                className="catalog-spares-multi-filters__close"
                onClick={onClose}
                aria-label="Close filters"
              >
                <X size={18} strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          </div>

          <div className="catalog-spares-multi-filters__body">
            {SPARE_PRICING_FILTER_GROUPS.map(group => (
              <div key={group.id} className="catalog-spares-multi-filters__group">
                <span className="catalog-spares-multi-filters__label">{group.label}</span>
                <div
                  className="catalog-spares-multi-filters__options"
                  role="group"
                  aria-label={`${group.label} filters`}
                >
                  {group.options.map(option => {
                    const checked = draft.has(option.key);
                    const id = `spare-pricing-filter-${option.key}`;
                    return (
                      <label
                        key={option.key}
                        className="catalog-spares-multi-filters__option"
                        htmlFor={id}
                      >
                        <input
                          id={id}
                          type="checkbox"
                          className="catalog-spares-multi-filters__checkbox"
                          checked={checked}
                          onChange={() => toggle(option.key)}
                        />
                        <span className="catalog-spares-multi-filters__option-label">
                          {option.label}
                        </span>
                        <span
                          className={`catalog-spares-multi-filters__option-count${checked ? ' is-active' : ''}`}
                        >
                          {counts[option.key] ?? 0}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="catalog-spares-multi-filters__footer">
            <button
              type="button"
              className="catalog-spares-multi-filters__apply"
              onClick={() => {
                onApply(new Set(draft));
                onClose();
              }}
            >
              {applyLabel}
            </button>
            <button
              type="button"
              className="catalog-spares-multi-filters__clear-btn"
              disabled={!hasDraft}
              onClick={() => setDraft(new Set())}
            >
              Clear all
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};
