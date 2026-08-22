import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import { DecimalTextInput } from '../DecimalAmountInput';
import {
  dealerCatalogMrpErrorMessage,
  saveDealerCatalogMrp,
} from '../../lib/dealerCatalogMrp';

type Props = {
  productId: string;
  catalogMrp: number | null;
  dealerMrp: number | null;
};

export const DealerMrpEditButton: React.FC<Props> = ({
  productId,
  catalogMrp,
  dealerMrp,
}) => {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const current = dealerMrp ?? catalogMrp;
    setDraft(current != null ? String(current) : '');
    setError('');
    setSaving(false);
  }, [open, dealerMrp, catalogMrp]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving]);

  const save = async (next: number | null) => {
    setSaving(true);
    setError('');
    try {
      await saveDealerCatalogMrp(productId, next);
      setOpen(false);
    } catch (err) {
      setError(dealerCatalogMrpErrorMessage(err));
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const raw = draft.trim();
    if (!raw) {
      void save(null);
      return;
    }
    const mrp = Number(raw);
    if (!Number.isFinite(mrp) || mrp <= 0) {
      setError('Enter a valid MRP, or leave blank to use the catalog MRP.');
      return;
    }
    void save(Math.round(mrp * 100) / 100);
  };

  return (
    <>
      <button
        type="button"
        className="product-detail-page__mrp-edit"
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label="Set your MRP"
        title="Set your MRP"
      >
        <Pencil size={12} strokeWidth={2.4} aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              className="dealers-modal-backdrop"
              role="presentation"
              onClick={event => {
                if (event.target === event.currentTarget && !saving) setOpen(false);
              }}
            >
              <form
                className="dealers-modal panel dealer-mrp-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onSubmit={handleSubmit}
              >
                <header className="dealers-modal__header">
                  <h2 id={titleId}>Your MRP</h2>
                  <button
                    type="button"
                    className="dealers-modal__close"
                    onClick={() => { if (!saving) setOpen(false); }}
                    disabled={saving}
                    aria-label="Close"
                  >
                    <X size={18} aria-hidden />
                  </button>
                </header>
                <p className="text-muted text-sm dealer-mrp-dialog__hint">
                  Shown on this item and on your WhatsApp rate card. Leave blank to use the catalog price
                  {catalogMrp != null
                    ? ` (₹ ${catalogMrp.toLocaleString('en-IN', { maximumFractionDigits: 2 })}).`
                    : '.'}
                </p>
                <label className="dealers-modal__field">
                  <span>MRP (incl. GST)</span>
                  <DecimalTextInput
                    className="dealer-mrp-dialog__input"
                    value={draft}
                    onChange={setDraft}
                    disabled={saving}
                    autoFocus
                    aria-label="MRP including GST"
                    placeholder={catalogMrp != null ? String(catalogMrp) : '0'}
                  />
                </label>
                {error ? <p className="dealers-modal__error">{error}</p> : null}
                <div className="dealers-modal__actions">
                  {dealerMrp != null ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={saving}
                      onClick={() => void save(null)}
                    >
                      Use catalog MRP
                    </button>
                  ) : null}
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
