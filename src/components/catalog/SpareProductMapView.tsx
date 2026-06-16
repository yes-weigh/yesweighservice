import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  IndianRupee,
  Link2,
  Package,
  Search,
  X,
} from 'lucide-react';
import {
  fetchCatalog,
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  formatCurrency,
  getUncategorizedProducts,
  saveCatalogProductSpareLinks,
} from '../../lib/catalog';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { CategoryThumbnail } from './CategoryThumbnail';
import { StockBadge } from './StockBadge';

function formatProductTitle(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function idsKey(ids: Iterable<string>): string {
  return [...ids].sort().join('|');
}

function SpareImageStage({
  src,
  size = 'card',
}: {
  src: string | null | undefined;
  alt: string;
  size?: 'hero' | 'card';
}) {
  return (
    <div className={`spare-product-map__image-stage spare-product-map__image-stage--${size}`}>
      {src ? (
        <CategoryThumbnail src={src} />
      ) : (
        <Package
          size={size === 'hero' ? 32 : 24}
          className="spare-product-map__placeholder"
          aria-hidden
        />
      )}
    </div>
  );
}

function SpareMapCard({
  item,
  selected = false,
  showStockQuantity = false,
  canManage = false,
  mode,
  onOpen,
  onToggle,
  onRemove,
}: {
  item: CatalogProduct;
  selected?: boolean;
  showStockQuantity?: boolean;
  canManage?: boolean;
  mode: 'mapped' | 'picker';
  onOpen?: () => void;
  onToggle?: () => void;
  onRemove?: () => void;
}) {
  const handleClick = () => {
    if (mode === 'mapped') onOpen?.();
    else onToggle?.();
  };

  return (
    <button
      type="button"
      className={`spare-product-map__card spare-product-map__card--${mode} ${selected ? 'spare-product-map__card--on' : ''}`}
      onClick={handleClick}
      disabled={mode === 'picker' && !canManage}
    >
      <div className="spare-product-map__card-media">
        <StockBadge status={item.stockStatus} overlay variant="tile" />
        <SpareImageStage src={item.imageUrl} alt={item.name} size="card" />
      </div>
      <div className="spare-product-map__card-body">
        <strong>{formatProductTitle(item.name)}</strong>
        {item.sku && <span className="spare-product-map__card-sku">{item.sku}</span>}
        <span className="spare-product-map__card-price">
          <IndianRupee size={13} />
          {item.rate.toLocaleString('en-IN')}
        </span>
        {showStockQuantity && (
          <span className="spare-product-map__card-stock text-muted text-sm">
            {item.stock} {item.unit}
          </span>
        )}
      </div>
      {mode === 'mapped' && canManage && onRemove && (
        <span
          role="button"
          tabIndex={0}
          className="spare-product-map__remove"
          aria-label={`Remove ${item.name}`}
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
        >
          <X size={14} />
        </span>
      )}
      {mode === 'picker' && canManage && (
        <span className={`spare-product-map__check ${selected ? 'spare-product-map__check--on' : ''}`}>
          {selected && <Check size={14} strokeWidth={3} />}
        </span>
      )}
    </button>
  );
}

export const SpareProductMapView: React.FC<{
  productId: string;
  backPath: string;
  backLabel?: string;
  preview?: CatalogProduct | null;
  canManage?: boolean;
  showStockQuantity?: boolean;
  sparesBasePath?: string;
}> = ({
  productId,
  backPath,
  backLabel = 'Back to spares',
  preview = null,
  canManage = false,
  showStockQuantity = false,
  sparesBasePath = '/staff/spares',
}) => {
  const navigate = useNavigate();
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct | null>(preview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<CatalogProduct[]>([]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const lastSavedRef = useRef('');
  const skipAutoSaveRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void fetchCatalogProductDetail(productId)
      .then(detail => {
        if (!active) return;
        if (!detail.imageUrl && preview?.imageUrl) {
          detail.imageUrl = preview.imageUrl;
        }
        setProduct(detail);
      })
      .catch(err => {
        if (!active) return;
        if (preview) setProduct(preview);
        else setError(err instanceof Error ? err.message : 'Could not load product.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [productId, preview]);

  const loadMappingData = useCallback(async () => {
    try {
      const [catalog, links] = await Promise.all([
        fetchCatalog(),
        fetchCatalogSpareLinks({ productId }),
      ]);
      const sparePool = getUncategorizedProducts(catalog.items);
      const linkedIds = links.items.map(item => item.id);
      setPool(sparePool);
      setPicked(new Set(linkedIds));
      lastSavedRef.current = idsKey(linkedIds);
      skipAutoSaveRef.current = true;
      window.setTimeout(() => {
        skipAutoSaveRef.current = false;
      }, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load spare mapping.');
    }
  }, [productId]);

  useEffect(() => {
    void loadMappingData();
  }, [loadMappingData]);

  const filteredPool = useMemo(() => {
    if (!search.trim()) return pool;
    const q = search.trim().toLowerCase();
    return pool.filter(
      item =>
        item.name.toLowerCase().includes(q)
        || (item.sku ?? '').toLowerCase().includes(q),
    );
  }, [pool, search]);

  const mappedItems = useMemo(
    () => pool.filter(item => picked.has(item.id)),
    [pool, picked],
  );

  const toggle = (id: string) => {
    if (!canManage) return;
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!canManage || !product || skipAutoSaveRef.current) return;

    const current = idsKey(picked);
    if (current === lastSavedRef.current) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveStatus('saving');

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void (async () => {
        try {
          await saveCatalogProductSpareLinks(product.id, [...picked]);
          lastSavedRef.current = current;
          setError(null);
          setSaveStatus('saved');
          window.setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (err) {
          setSaveStatus('idle');
          setError(err instanceof Error ? err.message : 'Could not save mapping.');
        }
      })();
    }, 450);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [picked, canManage, product]);

  if (loading && !product) {
    return (
      <div className="spare-product-map">
        <div className="spare-product-map__loading panel glass">
          <div className="loader-ring" />
          <p className="text-muted">Loading product…</p>
        </div>
      </div>
    );
  }

  if (error && !product) {
    return (
      <div className="spare-product-map">
        <button type="button" className="spare-product-map__back" onClick={() => navigate(backPath)}>
          <ArrowLeft size={18} />
          <span>{backLabel}</span>
        </button>
        <div className="spare-product-map__error panel glass">
          <Package size={40} />
          <h2>Product unavailable</h2>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!product) return null;

  return (
    <div className="spare-product-map">
      <button type="button" className="spare-product-map__back" onClick={() => navigate(backPath)}>
        <ArrowLeft size={18} />
        <span>{backLabel}</span>
      </button>

      {error && (
        <div className="products-inline-error panel glass">
          <span>{error}</span>
        </div>
      )}

      <section className="spare-product-map__hero panel glass">
        <div className="spare-product-map__hero-media">
          <SpareImageStage src={product.imageUrl} alt={product.name} size="hero" />
        </div>
        <div className="spare-product-map__hero-body">
          <p className="spare-product-map__eyebrow">
            <Link2 size={14} aria-hidden />
            <span>Map compatible spares</span>
          </p>
          <h1 className="spare-product-map__title">{formatProductTitle(product.name)}</h1>
          {product.sku && <p className="spare-product-map__sku">Model: {product.sku}</p>}
          {product.categoryName && (
            <p className="spare-product-map__category">{product.categoryName}</p>
          )}
          <p className="spare-product-map__price">{formatCurrency(product.rate)}</p>
        </div>
        <div className="spare-product-map__hero-stats">
          <strong>{picked.size}</strong>
          <span>spares mapped</span>
        </div>
      </section>

      {mappedItems.length > 0 && (
        <section className="spare-product-map__mapped panel glass">
          <h2>Mapped spares</h2>
          <ul className="spare-product-map__grid spare-product-map__grid--mapped">
            {mappedItems.map(item => (
              <li key={item.id}>
                <SpareMapCard
                  item={item}
                  selected
                  mode="mapped"
                  canManage={canManage}
                  showStockQuantity={showStockQuantity}
                  onOpen={() => navigate(`${sparesBasePath}/${item.id}`, { state: { preview: item } })}
                  onRemove={() => toggle(item.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="spare-product-map__picker panel glass">
        <header className="spare-product-map__picker-header">
          <div>
            <h2>{canManage ? 'Search & map spares' : 'Compatible spares'}</h2>
            <p className="text-muted text-sm">
              Ungrouped Zoho items — select spares that fit this product.
            </p>
          </div>
          <div className="spare-product-map__search catalog-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Search spare name or SKU…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </header>

        <p className="spare-product-map__count text-muted text-sm">
          {picked.size} selected · {filteredPool.length} shown
        </p>

        {filteredPool.length === 0 ? (
          <p className="spare-product-map__empty text-muted">No spares match your search.</p>
        ) : (
          <ul className="spare-product-map__grid">
            {filteredPool.map(item => (
              <li key={item.id}>
                <SpareMapCard
                  item={item}
                  selected={picked.has(item.id)}
                  mode="picker"
                  canManage={canManage}
                  showStockQuantity={showStockQuantity}
                  onToggle={() => toggle(item.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <footer className={`spare-product-map__footer spare-product-map__footer--${saveStatus}`}>
          <span className="spare-product-map__save-status text-sm">
            {saveStatus === 'saving' && 'Saving…'}
            {saveStatus === 'saved' && 'Mapping saved'}
            {saveStatus === 'idle' && `${picked.size} spares linked`}
          </span>
        </footer>
      )}
    </div>
  );
};
