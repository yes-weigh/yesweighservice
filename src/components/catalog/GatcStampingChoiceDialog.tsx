import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  formatGatcOptionLabel,
  productHasLinkedGatc,
  resolveGatcOptionsForProduct,
} from '../../lib/gatcCart';
import { loadGatcStampingPrices } from '../../lib/catalogProductSettings';
import { formatCurrency } from '../../lib/catalog';
import type { CatalogGatcStampingPriceEntry } from '../../constants/catalogProductSettings';
import type { CatalogProduct } from '../../types/catalog';

export type GatcStampingChoice = {
  withStamping: boolean;
  gatcStampingPriceId: string | null;
  gatcFeePerUnit: number;
  gatcStampingRange: string | null;
};

type Mode = 'add' | 'edit';

export const GatcStampingChoiceDialog: React.FC<{
  product: CatalogProduct;
  open: boolean;
  onClose: () => void;
  onConfirm: (choice: GatcStampingChoice) => void;
  mode?: Mode;
  /** Preselect when editing an existing cart/SO line. */
  initialGatcStampingPriceId?: string | null;
  /** Prefer “With stamping” when opening (e.g. cart “Add with stamping”). */
  preferWithStamping?: boolean;
  title?: string;
  confirmLabel?: string;
}> = ({
  product,
  open,
  onClose,
  onConfirm,
  mode = 'add',
  initialGatcStampingPriceId = null,
  preferWithStamping = false,
  title,
  confirmLabel,
}) => {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<CatalogGatcStampingPriceEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [withStamping, setWithStamping] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    void loadGatcStampingPrices()
      .then(entries => {
        if (!active) return;
        const next = resolveGatcOptionsForProduct(product, entries);
        setOptions(next);
        const initial = initialGatcStampingPriceId?.trim() || null;
        const defaultSelected = next.length === 1 ? next[0].id : null;
        if (initial && next.some(opt => opt.id === initial)) {
          setWithStamping(true);
          setSelectedId(initial);
        } else if (mode === 'edit' && !initial) {
          setWithStamping(false);
          setSelectedId(defaultSelected);
        } else if (preferWithStamping) {
          setWithStamping(true);
          setSelectedId(defaultSelected);
        } else {
          setWithStamping(false);
          setSelectedId(defaultSelected);
        }
      })
      .catch(err => {
        if (!active) return;
        setOptions([]);
        setLoadError(err instanceof Error ? err.message : 'Could not load stamping options.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, product, initialGatcStampingPriceId, mode, preferWithStamping]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selected = useMemo(
    () => options.find(opt => opt.id === selectedId) ?? null,
    [options, selectedId],
  );

  if (!open) return null;

  const baseRate = Math.round(Number(product.rate) * 100) / 100;
  const fee = withStamping && selected ? selected.price : 0;
  const unitRate = Math.round((baseRate + fee) * 100) / 100;
  const canConfirm = !loading
    && !loadError
    && options.length > 0
    && (!withStamping || Boolean(selected));

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (!withStamping) {
      onConfirm({
        withStamping: false,
        gatcStampingPriceId: null,
        gatcFeePerUnit: 0,
        gatcStampingRange: null,
      });
      return;
    }
    if (!selected) return;
    onConfirm({
      withStamping: true,
      gatcStampingPriceId: selected.id,
      gatcFeePerUnit: selected.price,
      gatcStampingRange: selected.stampingRange,
    });
  };

  return (
    <div
      className="dealers-modal-backdrop gatc-stamp-dialog__backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="dealers-modal panel glass gatc-stamp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gatc-stamp-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <h2 id="gatc-stamp-dialog-title">
            {title ?? (mode === 'edit' ? 'Change stamping' : 'Stamping')}
          </h2>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <p className="gatc-stamp-dialog__product text-muted text-sm">{product.name}</p>

        {loading ? (
          <p className="text-muted text-sm">Loading stamping options…</p>
        ) : loadError ? (
          <p className="dealers-modal__error text-sm">{loadError}</p>
        ) : options.length === 0 ? (
          <p className="text-muted text-sm">No stamping options linked to this product.</p>
        ) : (
          <>
            <div className="gatc-stamp-dialog__choices" role="radiogroup" aria-label="Stamping">
              <button
                type="button"
                className={`gatc-stamp-dialog__choice${!withStamping ? ' is-selected' : ''}`}
                aria-pressed={!withStamping}
                onClick={() => setWithStamping(false)}
              >
                <strong>Without stamping</strong>
                <span>{formatCurrency(baseRate)} / unit</span>
              </button>
              <button
                type="button"
                className={`gatc-stamp-dialog__choice${withStamping ? ' is-selected' : ''}`}
                aria-pressed={withStamping}
                onClick={() => {
                  setWithStamping(true);
                  if (!selectedId && options.length === 1) {
                    setSelectedId(options[0].id);
                  }
                }}
              >
                <strong>With stamping</strong>
                <span>
                  {selected
                    ? `${formatCurrency(baseRate)} + ${formatCurrency(selected.price)}`
                    : 'Select a range below'}
                </span>
              </button>
            </div>

            {withStamping && (
              <div className="gatc-stamp-dialog__ranges" role="radiogroup" aria-label="Stamping range">
                {options.map(opt => {
                  const selectedOpt = selectedId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`gatc-stamp-dialog__range${selectedOpt ? ' is-selected' : ''}`}
                      aria-pressed={selectedOpt}
                      onClick={() => setSelectedId(opt.id)}
                    >
                      {formatGatcOptionLabel(opt)}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="gatc-stamp-dialog__summary text-sm">
              Unit price: <strong>{formatCurrency(unitRate)}</strong>
              {withStamping && selected ? (
                <span className="text-muted">
                  {' '}({formatCurrency(baseRate)} + {formatCurrency(selected.price)} stamping)
                </span>
              ) : null}
            </p>
          </>
        )}

        <div className="dealers-modal__actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {confirmLabel ?? (mode === 'edit' ? 'Update' : 'Add to cart')}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Returns true if caller should open the GATC dialog instead of adding directly. */
export function shouldPromptGatcStamping(product: CatalogProduct): boolean {
  return productHasLinkedGatc(product);
}
