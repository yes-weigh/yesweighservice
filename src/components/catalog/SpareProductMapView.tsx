import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  IndianRupee,
  Link2,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  fetchCatalog,
  fetchCatalogProductDetail,
  fetchCatalogSpareLinks,
  formatCurrency,
  getFinishedGoodsForSpareMapping,
  getSparesForSpareMapping,
  saveCatalogProductSpareLinks,
} from '../../lib/catalog';
import type { CatalogProduct, CatalogProductDetail } from '../../types/catalog';
import { buildSpareNavState } from '../../lib/catalogNav';
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

function SpareSuggestionRow({
  item,
  showStockQuantity = false,
  onSelect,
}: {
  item: CatalogProduct;
  showStockQuantity?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="spare-product-map__suggestion"
      onClick={onSelect}
    >
      <div className="spare-product-map__suggestion-media">
        <SpareImageStage src={item.imageUrl} alt={item.name} size="card" />
      </div>
      <div className="spare-product-map__suggestion-body">
        <strong>{formatProductTitle(item.name)}</strong>
        <div className="spare-product-map__suggestion-meta">
          {item.sku && <span className="spare-product-map__suggestion-sku">{item.sku}</span>}
          <StockBadge status={item.stockStatus} variant="tile" />
        </div>
        <div className="spare-product-map__suggestion-meta spare-product-map__suggestion-meta--price">
          <span className="spare-product-map__suggestion-price">
            <IndianRupee size={13} />
            {item.rate.toLocaleString('en-IN')}
          </span>
          {showStockQuantity && (
            <span className="spare-product-map__suggestion-stock">
              {item.stock} {item.unit}
            </span>
          )}
        </div>
      </div>
      <span className="spare-product-map__suggestion-add" aria-hidden>
        <Plus size={16} />
      </span>
    </button>
  );
}

function ProductCopySuggestionRow({
  item,
  onSelect,
  disabled = false,
}: {
  item: CatalogProduct;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="spare-product-map__suggestion spare-product-map__suggestion--product"
      disabled={disabled}
      onClick={onSelect}
    >
      <div className="spare-product-map__suggestion-media">
        <SpareImageStage src={item.imageUrl} alt={item.name} size="card" />
      </div>
      <div className="spare-product-map__suggestion-body">
        <strong>{formatProductTitle(item.name)}</strong>
        <div className="spare-product-map__suggestion-meta">
          {item.sku && <span className="spare-product-map__suggestion-sku">{item.sku}</span>}
          {item.categoryName && (
            <span className="spare-product-map__suggestion-category">{item.categoryName}</span>
          )}
        </div>
      </div>
      <span className="spare-product-map__suggestion-add" aria-hidden>
        <Copy size={15} />
      </span>
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
  sparesBasePath = '/staff/catalog/spare',
}) => {
  const navigate = useNavigate();
  const [product, setProduct] = useState<CatalogProductDetail | CatalogProduct | null>(preview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<CatalogProduct[]>([]);
  const [productPool, setProductPool] = useState<CatalogProduct[]>([]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [copySearch, setCopySearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const lastSavedRef = useRef('');
  const skipAutoSaveRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const copySearchInputRef = useRef<HTMLInputElement>(null);

  const listBackPath = useMemo(() => {
    if (backPath.includes('category=')) return backPath;
    const categoryId = product?.categoryId;
    if (!categoryId) return backPath;
    const base = backPath.split('?')[0] ?? backPath;
    const params = new URLSearchParams(backPath.includes('?') ? backPath.split('?')[1] : '');
    if (!params.has('section')) params.set('section', 'map');
    params.set('category', categoryId);
    return `${base}?${params.toString()}`;
  }, [backPath, product?.categoryId]);

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
      const categories = catalog.categories ?? [];
      const sparePool = getSparesForSpareMapping(catalog.items, categories);
      const linkedIds = links.items.map(item => item.id);
      const catalogProducts = getFinishedGoodsForSpareMapping(catalog.items, categories)
        .filter(item => item.id !== productId);
      setPool(sparePool);
      setProductPool(catalogProducts);
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

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return pool
      .filter(item => !picked.has(item.id))
      .filter(
        item =>
          item.name.toLowerCase().includes(q)
          || (item.sku ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [pool, search, picked]);

  const productSuggestions = useMemo(() => {
    const q = copySearch.trim().toLowerCase();
    if (!q) return [];
    return productPool
      .filter(
        item =>
          item.name.toLowerCase().includes(q)
          || (item.sku ?? '').toLowerCase().includes(q)
          || (item.categoryName ?? '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [productPool, copySearch]);

  const mappedItems = useMemo(
    () => pool.filter(item => picked.has(item.id)),
    [pool, picked],
  );

  const openPicker = () => {
    setCopyPickerOpen(false);
    setCopySearch('');
    setPickerOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const closePicker = () => {
    setPickerOpen(false);
    setSearch('');
  };

  const openCopyPicker = () => {
    setPickerOpen(false);
    setSearch('');
    setCopyPickerOpen(true);
    window.setTimeout(() => copySearchInputRef.current?.focus(), 0);
  };

  const closeCopyPicker = () => {
    setCopyPickerOpen(false);
    setCopySearch('');
  };

  const copyFromProduct = async (source: CatalogProduct) => {
    if (!canManage || source.id === productId) return;
    setCopyLoading(true);
    setError(null);
    try {
      const links = await fetchCatalogSpareLinks({ productId: source.id });
      const spareIds = links.items.map(item => item.id);
      if (spareIds.length === 0) {
        setError(`${formatProductTitle(source.name)} has no mapped spares.`);
        return;
      }
      let added = 0;
      setPicked(prev => {
        const next = new Set(prev);
        for (const id of spareIds) {
          if (!next.has(id)) added += 1;
          next.add(id);
        }
        return next;
      });
      if (added === 0) {
        setError('All spares from that product are already mapped here.');
      } else {
        closeCopyPicker();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy spare mapping.');
    } finally {
      setCopyLoading(false);
    }
  };

  const addSpare = (id: string) => {
    if (!canManage) return;
    setPicked(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSearch('');
    searchInputRef.current?.focus();
  };

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
        <button type="button" className="spare-product-map__back" onClick={() => navigate(listBackPath)}>
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
      <button type="button" className="spare-product-map__back" onClick={() => navigate(listBackPath)}>
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

      <section className="spare-product-map__mapped panel glass">
        <h2>Mapped spares</h2>

        {mappedItems.length > 0 ? (
          <ul className="spare-product-map__grid spare-product-map__grid--mapped">
            {mappedItems.map(item => (
              <li key={item.id}>
                <SpareMapCard
                  item={item}
                  selected
                  mode="mapped"
                  canManage={canManage}
                  showStockQuantity={showStockQuantity}
                  onOpen={() => navigate(`${sparesBasePath}/${item.id}`, {
                    state: buildSpareNavState(item, {
                      origin: 'map',
                      parentProduct: product,
                      returnCategoryId: product.categoryId ?? undefined,
                    }),
                  })}
                  onRemove={() => toggle(item.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="spare-product-map__empty-mapped text-muted text-sm">
            No spares mapped yet.
          </p>
        )}

        {canManage && !pickerOpen && !copyPickerOpen && (
          <div className="spare-product-map__actions">
            <button
              type="button"
              className="spare-product-map__map-btn btn btn-secondary"
              onClick={openPicker}
            >
              <Plus size={16} aria-hidden />
              <span>Map spare</span>
            </button>
            <button
              type="button"
              className="spare-product-map__map-btn btn btn-secondary"
              onClick={openCopyPicker}
            >
              <Copy size={16} aria-hidden />
              <span>Copy from product</span>
            </button>
          </div>
        )}

        {canManage && pickerOpen && (
          <div className="spare-product-map__picker-inline">
            <div className="spare-product-map__search-row">
              <div className="spare-product-map__search catalog-search">
                <Search size={16} />
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search spare name or SKU…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="spare-product-map__picker-cancel"
                aria-label="Cancel search"
                onClick={closePicker}
              >
                <X size={18} />
              </button>
            </div>

            {search.trim() && (
              <div className="spare-product-map__suggestions" role="listbox" aria-label="Spare suggestions">
                {suggestions.length === 0 ? (
                  <p className="spare-product-map__suggestions-empty text-muted text-sm">
                    No matching spares found.
                  </p>
                ) : (
                  suggestions.map(item => (
                    <SpareSuggestionRow
                      key={item.id}
                      item={item}
                      showStockQuantity={showStockQuantity}
                      onSelect={() => addSpare(item.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {canManage && copyPickerOpen && (
          <div className="spare-product-map__picker-inline">
            <p className="spare-product-map__picker-hint text-muted text-sm">
              Search a product — its mapped spares will be added here (existing links kept).
            </p>
            <div className="spare-product-map__search-row">
              <div className="spare-product-map__search catalog-search">
                <Search size={16} />
                <input
                  ref={copySearchInputRef}
                  type="search"
                  placeholder="Search product name, SKU, or category…"
                  value={copySearch}
                  disabled={copyLoading}
                  onChange={e => setCopySearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="spare-product-map__picker-cancel"
                aria-label="Cancel copy"
                disabled={copyLoading}
                onClick={closeCopyPicker}
              >
                <X size={18} />
              </button>
            </div>

            {copySearch.trim() && (
              <div className="spare-product-map__suggestions" role="listbox" aria-label="Product suggestions">
                {copyLoading ? (
                  <p className="spare-product-map__suggestions-empty text-muted text-sm">
                    Copying spares…
                  </p>
                ) : productSuggestions.length === 0 ? (
                  <p className="spare-product-map__suggestions-empty text-muted text-sm">
                    No matching products found.
                  </p>
                ) : (
                  productSuggestions.map(item => (
                    <ProductCopySuggestionRow
                      key={item.id}
                      item={item}
                      disabled={copyLoading}
                      onSelect={() => void copyFromProduct(item)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
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
