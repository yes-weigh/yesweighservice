import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, RefreshCw, Search } from 'lucide-react';
import { useConfirm } from '../../../context/ConfirmContext';
import { fetchCatalog, setCatalogProductHidden } from '../../../lib/catalog';
import type { CatalogProduct } from '../../../types/catalog';
import { fillSearchFromScan, SkuScanButton } from '../../../components/catalog/SkuScanButton';

type HiddenItemsView = 'hidden' | 'catalog';

const VIEWS: { id: HiddenItemsView; label: string }[] = [
  { id: 'hidden', label: 'Hidden' },
  { id: 'catalog', label: 'Browse catalog' },
];

function skuDisplay(sku: string | null | undefined): string {
  const value = sku ?? '';
  return value === '' ? '(blank)' : value;
}

export const HiddenItemsSection: React.FC = () => {
  const confirm = useConfirm();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [view, setView] = useState<HiddenItemsView>('hidden');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const catalog = await fetchCatalog();
      setProducts(catalog.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load catalog products.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const hiddenProducts = useMemo(
    () => products.filter(product => product.hiddenFromCatalog === true),
    [products],
  );

  const visibleProducts = useMemo(
    () => products.filter(product => product.hiddenFromCatalog !== true),
    [products],
  );

  const sourceRows = view === 'hidden' ? hiddenProducts : visibleProducts;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sourceRows;
    return sourceRows.filter(product => {
      const sku = (product.sku ?? '').toLowerCase();
      const name = product.name.toLowerCase();
      const category = (product.categoryName ?? '').toLowerCase();
      return sku.includes(q) || name.includes(q) || category.includes(q) || product.id.includes(q);
    });
  }, [sourceRows, search]);

  const tabCounts = useMemo(() => ({
    hidden: hiddenProducts.length,
    catalog: visibleProducts.length,
  }), [hiddenProducts.length, visibleProducts.length]);

  const handleToggleHidden = async (product: CatalogProduct, hidden: boolean) => {
    if (busyId) return;

    const actionLabel = hidden ? 'Hide from catalog' : 'Unhide';
    const ok = await confirm({
      title: `${actionLabel}?`,
      message: hidden
        ? `"${product.name}" will no longer appear in the dealer/public catalogue. The item stays active in Zoho.`
        : `"${product.name}" will appear in the catalogue again.`,
      confirmLabel: actionLabel,
      destructive: hidden,
    });
    if (!ok) return;

    setBusyId(product.id);
    setError('');
    setSuccess('');
    try {
      await setCatalogProductHidden(product.id, hidden);
      setProducts(prev => prev.map(item => (
        item.id === product.id ? { ...item, hiddenFromCatalog: hidden } : item
      )));
      setSuccess(hidden
        ? `${product.name} is now hidden from the catalogue.`
        : `${product.name} is visible in the catalogue again.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update catalogue visibility.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="settings-product-qty__section settings-sku-correction">
      <h4 className="settings-product-qty__title">Hidden items</h4>
      <p className="settings-product-qty__hint text-muted text-sm">
        Hide products from the dealer and public catalogue without changing Zoho status.
        Hidden items stay in Zoho and remain searchable here so you can unhide them later.
      </p>

      {error && <p className="settings-locations__error" role="alert">{error}</p>}
      {success && <p className="settings-locations__success" role="status">{success}</p>}

      <div className="settings-sku-correction__subtabs" role="tablist" aria-label="Hidden items views">
        {VIEWS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            className={`settings-sku-correction__subtab ${view === tab.id ? 'is-active' : ''}`}
            onClick={() => {
              setView(tab.id);
              setError('');
              setSuccess('');
            }}
          >
            {tab.label}
            <span className="settings-sku-correction__subtab-count">{tabCounts[tab.id]}</span>
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary btn-sm settings-sku-correction__refresh"
          onClick={() => void loadAll()}
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'spin-icon' : undefined} aria-hidden />
          Refresh
        </button>
      </div>

      <label className="settings-sku-correction__search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SKU, name, or category…"
          aria-label="Search catalog products"
        />
        <SkuScanButton
          onScan={raw => fillSearchFromScan(raw, setSearch)}
          hint="Point at the product or spare label QR code."
        />
      </label>

      {loading ? (
        <div className="settings-locations__loading">
          <div className="loader-ring" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="settings-locations__empty">
          {view === 'hidden' ? <EyeOff size={28} aria-hidden /> : <Eye size={28} aria-hidden />}
          <p>
            {search.trim()
              ? 'No products match your search.'
              : view === 'hidden'
                ? 'No hidden products yet.'
                : 'No visible catalog products found.'}
          </p>
        </div>
      ) : (
        <>
          <p className="settings-sku-correction__meta text-muted text-sm">
            Showing {filteredRows.length}
            {filteredRows.length !== sourceRows.length ? ` of ${sourceRows.length}` : ''}
          </p>
          <div className="settings-logistics__table-wrap settings-sku-correction__table-wrap">
            <table className="settings-logistics__table settings-sku-correction__table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(product => (
                  <tr key={product.id}>
                    <td>
                      <Link
                        to={`/super-admin/catalog/${product.id}`}
                        className="settings-logistics__staff-link settings-sku-correction__sku-link"
                      >
                        <code>{skuDisplay(product.sku)}</code>
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/super-admin/catalog/${product.id}`}
                        className="settings-sku-correction__name-link"
                      >
                        {product.name}
                      </Link>
                    </td>
                    <td>{product.categoryName?.trim() || '—'}</td>
                    <td>
                      {view === 'hidden' ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyId != null}
                          onClick={() => void handleToggleHidden(product, false)}
                        >
                          Unhide
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyId != null}
                          onClick={() => void handleToggleHidden(product, true)}
                        >
                          Hide
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
