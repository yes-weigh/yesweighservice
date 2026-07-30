import React, { useEffect, useMemo, useState } from 'react';
import {
  formatGatcOptionLabel,
  resolveGatcOptionsForProduct,
} from '../../lib/gatcCart';
import { loadGatcStampingPrices } from '../../lib/catalogProductSettings';
import type { CatalogGatcStampingPriceEntry } from '../../constants/catalogProductSettings';
import type { CatalogProduct } from '../../types/catalog';
import type { GatcStampingChoice } from './GatcStampingChoiceDialog';
import { ThemeSelect } from '../ThemeSelect';

const NONE_VALUE = '__none__';

export const GatcStampingInlineControl: React.FC<{
  product: CatalogProduct;
  /** Current line’s linked stamping price id, or null/undefined if without. */
  valueId?: string | null;
  disabled?: boolean;
  onChange: (choice: GatcStampingChoice) => void;
  /** Compact sibling action for the opposite / missing variant. */
  onAddSibling?: (choice: GatcStampingChoice) => void;
  hasStamping?: boolean;
  /** Stamp price ids already used on other lines of this product in the order/cart. */
  usedGatcIds?: string[];
  /** True when an unstamped line for this product already exists. */
  hasUnstampedSibling?: boolean;
}> = ({
  product,
  valueId = null,
  disabled = false,
  onChange,
  onAddSibling,
  hasStamping = Boolean(valueId),
  usedGatcIds = [],
  hasUnstampedSibling = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<CatalogGatcStampingPriceEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [pickingAddRange, setPickingAddRange] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void loadGatcStampingPrices()
      .then(entries => {
        if (!active) return;
        setOptions(resolveGatcOptionsForProduct(product, entries));
      })
      .catch(err => {
        if (!active) return;
        setOptions([]);
        setLoadError(err instanceof Error ? err.message : 'Could not load stamping.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [product]);

  useEffect(() => {
    setPickingAddRange(false);
  }, [valueId, product.id]);

  const selectValue = valueId?.trim() || NONE_VALUE;

  const usedIdSet = useMemo(() => (
    new Set(usedGatcIds.map(id => id.trim()).filter(Boolean))
  ), [usedGatcIds]);

  const unusedStampOptions = useMemo(
    () => options.filter(opt => !usedIdSet.has(opt.id)),
    [options, usedIdSet],
  );

  const showAddSibling = Boolean(onAddSibling) && (
    hasStamping
      ? !hasUnstampedSibling
      : unusedStampOptions.length > 0
  );

  const choiceFromId = (id: string | null): GatcStampingChoice => {
    if (!id) {
      return {
        withStamping: false,
        gatcStampingPriceId: null,
        gatcFeePerUnit: 0,
        gatcStampingRange: null,
      };
    }
    const opt = options.find(entry => entry.id === id);
    return {
      withStamping: true,
      gatcStampingPriceId: id,
      gatcFeePerUnit: opt?.price ?? 0,
      gatcStampingRange: opt?.stampingRange ?? null,
    };
  };

  const handleSelectChange = (raw: string) => {
    if (raw === NONE_VALUE) {
      onChange(choiceFromId(null));
      return;
    }
    onChange(choiceFromId(raw));
  };

  const handleAddSibling = () => {
    if (!onAddSibling || !showAddSibling) return;
    if (hasStamping) {
      onAddSibling(choiceFromId(null));
      return;
    }
    if (unusedStampOptions.length === 1) {
      onAddSibling(choiceFromId(unusedStampOptions[0].id));
      return;
    }
    if (unusedStampOptions.length > 1) {
      setPickingAddRange(true);
    }
  };

  const lineOptions = useMemo(
    () => [
      { value: NONE_VALUE, label: 'Without stamping' },
      ...options.map(opt => ({
        value: opt.id,
        label: formatGatcOptionLabel(opt),
      })),
    ],
    [options],
  );

  const addOptions = useMemo(
    () => unusedStampOptions.map(opt => ({
      value: opt.id,
      label: formatGatcOptionLabel(opt),
    })),
    [unusedStampOptions],
  );

  if (loading) {
    return <p className="gatc-stamp-inline__status text-muted text-sm">Loading stamping…</p>;
  }
  if (loadError) {
    return <p className="gatc-stamp-inline__status gatc-stamp-inline__status--error text-sm">{loadError}</p>;
  }
  if (options.length === 0) {
    return <p className="gatc-stamp-inline__status text-muted text-sm">No stamping options linked.</p>;
  }

  return (
    <div className="gatc-stamp-inline">
      <div className="gatc-stamp-inline__field">
        <span className="gatc-stamp-inline__label">Stamping</span>
        <ThemeSelect
          compact
          className="gatc-stamp-inline__theme-select"
          value={selectValue}
          options={lineOptions}
          disabled={disabled}
          onChange={handleSelectChange}
          aria-label="Stamping for this line"
        />
      </div>

      {showAddSibling ? (
        <div className="gatc-stamp-inline__sibling">
          {pickingAddRange ? (
            <>
              <ThemeSelect
                compact
                className="gatc-stamp-inline__theme-select gatc-stamp-inline__theme-select--add"
                value=""
                options={addOptions}
                disabled={disabled}
                placeholder="Pick range to add…"
                onChange={id => {
                  if (!id.trim() || !onAddSibling) return;
                  onAddSibling(choiceFromId(id));
                  setPickingAddRange(false);
                }}
                aria-label="Add stamped line with range"
              />
              <button
                type="button"
                className="gatc-stamp-inline__cancel-btn"
                disabled={disabled}
                onClick={() => setPickingAddRange(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="gatc-stamp-inline__add-btn"
              disabled={disabled}
              onClick={handleAddSibling}
            >
              {hasStamping ? '+ Add without stamping' : '+ Add with stamping'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};
