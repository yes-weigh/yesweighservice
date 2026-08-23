import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { INDIA_STATE_NAMES } from '../../lib/indiaStates';
import { sanitizeRestrictedSalesStates } from '../../lib/catalogSalesRestriction';

export interface ProductSalesRestrictionSheetProps {
  open: boolean;
  productName: string;
  selectedStates: string[];
  saving?: boolean;
  onClose: () => void;
  onSave: (states: string[]) => void;
}

export const ProductSalesRestrictionSheet: React.FC<ProductSalesRestrictionSheetProps> = ({
  open,
  productName,
  selectedStates,
  saving = false,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(sanitizeRestrictedSalesStates(selectedStates)));
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(sanitizeRestrictedSalesStates(selectedStates)));
    setQuery('');
  }, [open, selectedStates]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, saving]);

  const visibleStates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return INDIA_STATE_NAMES;
    return INDIA_STATE_NAMES.filter(name => name.toLowerCase().includes(needle));
  }, [query]);

  const toggleState = useCallback((name: string) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    onSave(sanitizeRestrictedSalesStates([...draft]));
  }, [draft, onSave]);

  if (!open) return null;

  return createPortal(
    <div className="product-restriction-sheet" role="presentation">
      <button
        type="button"
        className="product-restriction-sheet__backdrop"
        aria-label="Close restriction picker"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div
        className="product-restriction-sheet__panel panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-restriction-sheet-title"
      >
        <div className="product-restriction-sheet__header">
          <div>
            <h2 id="product-restriction-sheet-title">Restriction</h2>
            <p className="product-restriction-sheet__subtitle">
              Block sales of “{productName}” in selected states
            </p>
          </div>
          <button
            type="button"
            className="product-restriction-sheet__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <label className="product-restriction-sheet__search">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search states"
            autoComplete="off"
            aria-label="Search states"
          />
        </label>

        <div className="product-restriction-sheet__toolbar">
          <button
            type="button"
            className="product-restriction-sheet__link"
            onClick={() => setDraft(new Set(INDIA_STATE_NAMES))}
            disabled={saving}
          >
            Select all
          </button>
          <button
            type="button"
            className="product-restriction-sheet__link"
            onClick={() => setDraft(new Set())}
            disabled={saving}
          >
            Clear
          </button>
          <span className="product-restriction-sheet__count">
            {draft.size} blocked
          </span>
        </div>

        <div className="product-restriction-sheet__options" role="listbox" aria-multiselectable="true">
          {visibleStates.map(name => {
            const active = draft.has(name);
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={active}
                className={`product-restriction-sheet__option ${active ? 'is-active' : ''}`}
                onClick={() => toggleState(name)}
                disabled={saving}
              >
                {name}
              </button>
            );
          })}
          {visibleStates.length === 0 && (
            <p className="product-restriction-sheet__empty">No matching states.</p>
          )}
        </div>

        <div className="product-restriction-sheet__footer">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
