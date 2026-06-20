import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { excludeHiddenCatalogProducts, fetchCatalog, isHiddenCatalogCategory } from '../../lib/catalog';
import type { CatalogResponse } from '../../types/catalog';

export const OpenCatalogPage: React.FC = () => {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog();
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !catalog) {
    return (
      <div className="open-catalog-page">
        <div className="catalog-loading panel glass">
          <div className="loader-ring" />
          <p className="text-muted">Loading product catalog…</p>
        </div>
      </div>
    );
  }

  if (error && !catalog) {
    return (
      <div className="open-catalog-page">
        <div className="panel glass products-error">
          <AlertCircle size={36} />
          <h2>Catalog unavailable</h2>
          <p className="text-muted">{error}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="open-catalog-page">
      <CatalogBrowse
        variant="public"
        products={excludeHiddenCatalogProducts(catalog?.items ?? [], catalog?.categories ?? [])}
        categories={(catalog?.categories ?? []).filter(c => !isHiddenCatalogCategory(c))}
        isLoading={loading}
        title="Product Catalog"
        subtitle={
          catalog?.syncedAt
            ? `Updated ${new Date(catalog.syncedAt).toLocaleString('en-IN')}`
            : undefined
        }
        productsBasePath="/oc"
      />
    </div>
  );
};
