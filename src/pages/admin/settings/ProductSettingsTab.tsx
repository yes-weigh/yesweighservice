import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  loadMasterCartonQuantities,
  saveMasterCartonQuantities,
} from '../../../lib/catalogProductSettings';

export const ProductSettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [quantities, setQuantities] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newQty, setNewQty] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setQuantities(await loadMasterCartonQuantities());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load product settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const sortedQuantities = useMemo(
    () => [...quantities].sort((a, b) => a - b),
    [quantities],
  );

  const persist = async (next: number[], busy: string) => {
    setBusyKey(busy);
    setError('');
    try {
      const saved = await saveMasterCartonQuantities(next, user?.uid ?? null);
      setQuantities(saved);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save product settings.');
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleAdd = async () => {
    const trimmed = newQty.trim();
    if (!trimmed) {
      setError('Enter a quantity to add.');
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      setError('Quantity must be a whole number greater than zero.');
      return;
    }
    if (quantities.includes(value)) {
      setError(`${value} is already in the list.`);
      return;
    }

    const ok = await persist([...quantities, value], `add-${value}`);
    if (ok) setNewQty('');
  };

  const handleRemove = async (value: number) => {
    if (quantities.length <= 1) {
      setError('Keep at least one master carton quantity.');
      return;
    }
    await persist(
      quantities.filter(qty => qty !== value),
      `remove-${value}`,
    );
  };

  return (
    <section className="settings-locations panel glass">
      <header className="settings-locations__header">
        <div>
          <h3>Product settings</h3>
          <p className="text-muted text-sm">
            Configure master carton quantity options used when editing package information on catalog items.
          </p>
        </div>
      </header>

      {error && <p className="settings-locations__error text-sm">{error}</p>}

      <div className="settings-product-qty">
        <div className="settings-product-qty__section">
          <h4 className="settings-product-qty__title">Master carton qty</h4>
          <p className="settings-product-qty__hint text-muted text-sm">
            These values appear as a dropdown when staff set master carton quantity on an item&apos;s package info.
          </p>

          {loading ? (
            <div className="settings-locations__loading">
              <div className="loader-ring" />
            </div>
          ) : (
            <>
              <div className="settings-product-qty__chips" aria-label="Master carton quantities">
                {sortedQuantities.map(qty => (
                  <span key={qty} className="settings-product-qty__chip">
                    <span>{qty}</span>
                    <button
                      type="button"
                      className="settings-product-qty__chip-remove"
                      onClick={() => void handleRemove(qty)}
                      disabled={busyKey != null || sortedQuantities.length <= 1}
                      aria-label={`Remove ${qty}`}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>

              <div className="settings-locations__add-form settings-product-qty__add-form">
                <label className="settings-locations__field">
                  <span>Add quantity</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={newQty}
                    placeholder="e.g. 10"
                    onChange={e => setNewQty(e.target.value)}
                    disabled={busyKey != null}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAdd();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyKey != null || !newQty.trim()}
                  onClick={() => void handleAdd()}
                >
                  <Plus size={15} aria-hidden />
                  Add
                </button>
              </div>
            </>
          )}
        </div>

        {!loading && sortedQuantities.length === 0 && (
          <div className="settings-locations__empty">
            <Package size={28} aria-hidden />
            <p>No master carton quantities configured yet.</p>
          </div>
        )}
      </div>
    </section>
  );
};
