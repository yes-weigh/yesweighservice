import React, { useMemo, useState } from 'react';
import { Link2, Search, X } from 'lucide-react';
import type { CatalogProduct } from '../../types/catalog';
import { fillSearchFromScan, SkuScanButton } from './SkuScanButton';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const SpareLinkEditor: React.FC<{
  mode: 'product' | 'spare';
  itemName: string;
  pool: CatalogProduct[];
  selectedIds: string[];
  saving?: boolean;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}> = ({ mode, itemName, pool, selectedIds, saving = false, onClose, onSave }) => {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedIds));

  const filteredPool = useMemo(() => {
    if (!search.trim()) return pool;
    const q = search.trim().toLowerCase();
    return pool.filter(
      item =>
        item.name.toLowerCase().includes(q)
        || (item.sku ?? '').toLowerCase().includes(q)
        || (item.categoryName ?? '').toLowerCase().includes(q),
    );
  }, [pool, search]);

  const toggle = (id: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const title = mode === 'product' ? 'Map spares to product' : 'Map products to spare';
  const subtitle =
    mode === 'product'
      ? `Select compatible spares for ${formatProductTitle(itemName)}`
      : `Select products that use ${formatProductTitle(itemName)}`;

  return (
    <div className="spare-link-editor-backdrop" role="presentation" onClick={onClose}>
      <div
        className="spare-link-editor panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spare-link-editor-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="spare-link-editor__header">
          <div>
            <p className="spare-link-editor__eyebrow">
              <Link2 size={14} aria-hidden />
              <span>Catalog mapping</span>
            </p>
            <h2 id="spare-link-editor-title">{title}</h2>
            <p className="text-muted text-sm">{subtitle}</p>
          </div>
          <button type="button" className="spare-link-editor__close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="spare-link-editor__search catalog-search">
          <Search size={16} />
          <input
            type="search"
            placeholder={mode === 'product' ? 'Search spares…' : 'Search products…'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <SkuScanButton
            onScan={raw => fillSearchFromScan(raw, setSearch)}
            hint={mode === 'product'
              ? 'Point at the spare label QR code.'
              : 'Point at the product label QR code.'}
          />
        </div>

        <p className="spare-link-editor__count text-muted text-sm">
          {picked.size} selected · {filteredPool.length} shown
        </p>

        <ul className="spare-link-editor__list">
          {filteredPool.length === 0 ? (
            <li className="spare-link-editor__empty text-muted text-sm">No matches found.</li>
          ) : (
            filteredPool.map(item => {
              const checked = picked.has(item.id);
              return (
                <li key={item.id}>
                  <label className={`spare-link-editor__row ${checked ? 'spare-link-editor__row--on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.id)}
                    />
                    <span className="spare-link-editor__row-main">
                      <strong>{formatProductTitle(item.name)}</strong>
                      <span className="text-muted text-sm">
                        {[item.sku, item.categoryName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="spare-link-editor__row-price">
                      ₹ {item.rate.toLocaleString('en-IN')}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>

        <footer className="spare-link-editor__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void onSave([...picked])}
          >
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </footer>
      </div>
    </div>
  );
};
