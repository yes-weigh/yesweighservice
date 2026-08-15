import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  MapPin,
  Package,
  Search,
  ShoppingCart,
  Store,
  Trash2,
} from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { CatalogCategoryChips } from '../../components/catalog/CatalogCategoryChips';
import { ProductImageFrame } from '../../components/catalog/ProductImageFrame';
import { StaffSoProductPeek } from '../../components/salesOrders/StaffSoProductPeek';
import { QuantityStepper } from '../../components/QuantityStepper';
import { CartProvider } from '../../context/CartProvider';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import {
  excludeHiddenCatalogProducts,
  fetchCatalog,
  fetchSpareLinkIndex,
  formatCurrency,
  getCategoriesForProducts,
  isHiddenCatalogCategory,
} from '../../lib/catalog';
import { canViewCatalogStock } from '../../lib/dealerAccess';
import {
  loadLatestPurchaseCostsByItemId,
  type PurchaseItemCost,
  type PurchaseItemCostSet,
} from '../../lib/sparePurchaseCosts';
import { canUpdatePurchaseOrders } from '../../lib/staffAccess';
import { searchZohoVendors, type ZohoVendorOption } from '../../lib/zoho-vendors';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';

const LIST_PATH = '/super-admin/purchase-orders';
const STEPS = ['vendor', 'catalog', 'preview'] as const;
type WizardStep = (typeof STEPS)[number];

function progressClass(stepIndex: number, index: number): string {
  if (index < stepIndex) return 'is-done';
  if (index === stepIndex) return 'is-active';
  return '';
}

function vendorLocation(vendor: ZohoVendorOption): string | null {
  const parts = [vendor.city, vendor.state].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function lastPurchaseCost(set: PurchaseItemCostSet | undefined): PurchaseItemCost | null {
  return set?.latest ?? null;
}

const CreatePurchaseOrderWizard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, itemCount, setQuantity, removeItem } = useCart();
  const { registerCartTarget, cartBump } = useCartFly();
  const cartBtnRef = useRef<HTMLButtonElement>(null);
  const goBackRef = useRef<() => void>(() => navigate(LIST_PATH));
  const searchSeq = useRef(0);

  const [step, setStep] = useState<WizardStep>('vendor');
  const [error, setError] = useState('');

  const [vendorQuery, setVendorQuery] = useState('');
  const [vendors, setVendors] = useState<ZohoVendorOption[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<ZohoVendorOption | null>(null);

  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [browseCategoryId, setBrowseCategoryId] = useState('');
  const [spareCountByProductId, setSpareCountByProductId] = useState<Map<string, number> | null>(null);
  const [peekProduct, setPeekProduct] = useState<CatalogProduct | null>(null);

  const [poCosts, setPoCosts] = useState<Map<string, PurchaseItemCostSet>>(new Map());
  const [costsLoading, setCostsLoading] = useState(false);

  const canCreate = canUpdatePurchaseOrders(user);
  const showStockQuantity = canViewCatalogStock(user);
  const stepIndex = STEPS.indexOf(step);
  const vendorReady = Boolean(selectedVendor);

  useCatalogPageHeader({
    title: 'New purchase order',
    subtitle: `Step ${stepIndex + 1} of ${STEPS.length}`,
    showBack: true,
    onBack: () => {
      goBackRef.current();
    },
    accentTitle: true,
    mobileCompactHeader: false,
  }, true);

  useEffect(() => {
    if (!canCreate) navigate(LIST_PATH, { replace: true });
  }, [canCreate, navigate]);

  const goBack = useCallback(() => {
    setError('');
    if (step === 'preview') {
      setStep('catalog');
      return;
    }
    if (step === 'catalog') {
      setStep('vendor');
      return;
    }
    navigate(LIST_PATH);
  }, [step, navigate]);

  goBackRef.current = goBack;

  useEffect(() => {
    if (selectedVendor) return;
    const q = vendorQuery.trim();
    if (q.length > 0 && q.length < 2) {
      setVendors([]);
      setVendorsLoading(false);
      return;
    }

    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      setVendorsLoading(true);
      void searchZohoVendors(q)
        .then(rows => {
          if (searchSeq.current !== seq) return;
          setVendors(rows);
          setError('');
        })
        .catch(err => {
          if (searchSeq.current !== seq) return;
          setVendors([]);
          setError(err instanceof Error ? err.message : 'Could not search vendors.');
        })
        .finally(() => {
          if (searchSeq.current === seq) setVendorsLoading(false);
        });
    }, q ? 280 : 0);

    return () => window.clearTimeout(timer);
  }, [vendorQuery, selectedVendor]);

  const shopProducts = useMemo(
    () => excludeHiddenCatalogProducts(catalogProducts, catalogCategories),
    [catalogProducts, catalogCategories],
  );

  const shopCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of shopProducts) {
      if (!product.categoryId) continue;
      counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    }
    return getCategoriesForProducts(catalogCategories, shopProducts)
      .filter(c => c.id && !isHiddenCatalogCategory(c) && (counts.get(c.id) ?? 0) > 0)
      .map(c => ({
        ...c,
        productCount: counts.get(c.id) ?? c.productCount,
      }))
      .sort((a, b) => {
        const orderDiff = a.displayOrder - b.displayOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });
  }, [catalogCategories, shopProducts]);

  useEffect(() => {
    if (step !== 'catalog') {
      registerCartTarget(null);
      return;
    }
    registerCartTarget(cartBtnRef.current);
    return () => registerCartTarget(null);
  }, [registerCartTarget, step, itemCount]);

  useEffect(() => {
    if (step !== 'catalog') return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError('');
    void fetchCatalog()
      .then(data => {
        if (cancelled) return;
        setCatalogProducts(data.items);
        setCatalogCategories(data.categories);
      })
      .catch(err => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : 'Could not load products.');
          setCatalogProducts([]);
          setCatalogCategories([]);
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    void fetchSpareLinkIndex()
      .then(index => {
        if (!cancelled) setSpareCountByProductId(index.spareCountByProductId);
      })
      .catch(() => {
        if (!cancelled) setSpareCountByProductId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (step !== 'catalog') setPeekProduct(null);
  }, [step]);

  useEffect(() => {
    if (step !== 'preview' || items.length === 0) return;
    let cancelled = false;
    setCostsLoading(true);
    void loadLatestPurchaseCostsByItemId()
      .then(map => {
        if (!cancelled) setPoCosts(map);
      })
      .catch(() => {
        if (!cancelled) setPoCosts(new Map());
      })
      .finally(() => {
        if (!cancelled) setCostsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, items.length]);

  const goToCatalog = () => {
    if (!selectedVendor) {
      setError('Select a vendor.');
      return;
    }
    setError('');
    setStep('catalog');
  };

  const goToPreview = () => {
    if (!selectedVendor) {
      setError('Select a vendor first.');
      setStep('vendor');
      return;
    }
    if (!items.length) {
      setError('Add at least one item from the catalog.');
      return;
    }
    setError('');
    setStep('preview');
  };

  const onProgressStepClick = (target: WizardStep) => {
    if (target === step) return;
    if (target === 'vendor') {
      setError('');
      setStep('vendor');
      return;
    }
    if (target === 'catalog') {
      if (!vendorReady) return;
      setError('');
      setStep('catalog');
      return;
    }
    goToPreview();
  };

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const cost = lastPurchaseCost(poCosts.get(item.productId));
      if (!cost) continue;
      const code = (cost.currencyCode || 'INR').toUpperCase();
      map.set(code, (map.get(code) ?? 0) + cost.amount * item.quantity);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'INR') return -1;
      if (b === 'INR') return 1;
      return a.localeCompare(b);
    });
  }, [items, poCosts]);

  return (
    <div className={`page-content fade-in staff-create-so-page staff-create-so-page--${step === 'vendor' ? 'dealer' : step}`}>
      <nav className="staff-create-so-page__stepper" aria-label="Create purchase order progress">
        {STEPS.map((id, index) => {
          const label = id === 'vendor' ? 'Vendor' : id === 'catalog' ? 'Items' : 'Review';
          const clickable = id === 'vendor'
            ? step !== 'vendor'
            : id === 'catalog'
              ? vendorReady && step !== 'catalog'
              : vendorReady && items.length > 0 && step === 'catalog';
          const stateClass = progressClass(stepIndex, index);
          return (
            <React.Fragment key={id}>
              {index > 0 ? (
                <span
                  className={`staff-create-so-page__stepper-line${
                    index <= stepIndex + 1 ? ' is-done' : ''
                  }`}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                className={`staff-create-so-page__stepper-item ${stateClass}${
                  clickable ? ' is-clickable' : ''
                }`}
                disabled={!clickable}
                aria-current={step === id ? 'step' : undefined}
                onClick={() => onProgressStepClick(id)}
              >
                <span className="staff-create-so-page__stepper-num">
                  {stateClass === 'is-done' ? (
                    <Check size={14} strokeWidth={3} aria-hidden />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="staff-create-so-page__stepper-label">{label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {error ? (
        <div className="products-inline-error panel glass" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'vendor' ? (
        <>
          <section className="staff-create-so-page__dealer-stage">
            <header className="staff-create-so-page__dealer-hero">
              <span className="staff-create-so-page__dealer-hero-icon" aria-hidden>
                <Store size={22} />
              </span>
              <div className="staff-create-so-page__dealer-hero-copy">
                <h2>Select vendor</h2>
                <p>Search Zoho vendors, then continue to the catalog.</p>
              </div>
              <span className="staff-create-so-page__dealer-hero-art" aria-hidden>
                <Package size={24} />
              </span>
            </header>

            <div className="staff-create-so-page__dealer-panel panel glass">
              <h3 className="staff-create-so-page__dealer-panel-title">Vendor</h3>
              <p className="text-muted text-sm staff-create-so-page__dealer-panel-hint">
                Type a name to search Zoho, or pick from the first page of active vendors.
              </p>
              {selectedVendor ? (
                <div className="staff-create-so-page__dealer-selected">
                  <div>
                    <strong>{selectedVendor.name}</strong>
                    {selectedVendor.companyName && selectedVendor.companyName !== selectedVendor.name ? (
                      <p className="text-muted text-sm">{selectedVendor.companyName}</p>
                    ) : null}
                    {selectedVendor.phone ? (
                      <p className="text-muted text-sm">{selectedVendor.phone}</p>
                    ) : null}
                    {selectedVendor.gstNo ? (
                      <p className="text-muted text-sm">GST {selectedVendor.gstNo}</p>
                    ) : null}
                    {vendorLocation(selectedVendor) ? (
                      <p className="text-muted text-sm">{vendorLocation(selectedVendor)}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSelectedVendor(null);
                      setVendorQuery('');
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="staff-create-so-page__dealer-search">
                  <div className="catalog-search staff-create-so-page__dealer-search-input">
                    <Search size={15} aria-hidden />
                    <input
                      type="search"
                      placeholder="Search vendor by name…"
                      value={vendorQuery}
                      onChange={e => setVendorQuery(e.target.value)}
                      aria-label="Search vendors"
                      autoComplete="off"
                    />
                  </div>
                  {vendorsLoading && vendors.length === 0 ? (
                    <p className="text-muted text-sm">Searching Zoho vendors…</p>
                  ) : vendors.length > 0 ? (
                    <ul className="staff-create-so-page__dealer-list" role="listbox">
                      {vendors.map(vendor => {
                        const location = vendorLocation(vendor);
                        const meta = [vendor.currencyCode, vendor.phone].filter(Boolean).join(' • ');
                        return (
                          <li key={vendor.id}>
                            <button
                              type="button"
                              className="staff-create-so-page__dealer-option"
                              onClick={() => {
                                setSelectedVendor(vendor);
                                setVendorQuery('');
                                setError('');
                              }}
                            >
                              <span className="staff-create-so-page__dealer-option-main">
                                <strong>{vendor.name}</strong>
                                {meta ? (
                                  <span className="staff-create-so-page__dealer-option-meta">{meta}</span>
                                ) : null}
                              </span>
                              <span className="staff-create-so-page__dealer-option-side">
                                {location ? (
                                  <span className="staff-create-so-page__dealer-option-location">
                                    <MapPin size={13} aria-hidden />
                                    {location}
                                  </span>
                                ) : null}
                                <ChevronRight size={18} className="staff-create-so-page__dealer-option-chevron" aria-hidden />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : vendorQuery.trim().length >= 2 ? (
                    <p className="text-muted text-sm">
                      {vendorsLoading ? 'Searching…' : `No vendors match “${vendorQuery.trim()}”.`}
                    </p>
                  ) : (
                    <p className="text-muted text-sm">
                      {vendorsLoading
                        ? 'Loading vendors from Zoho…'
                        : 'Type at least 2 characters to search, or wait for the first vendors to load.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="staff-create-so-page__dealer-continue staff-create-so-page__dealer-continue--sticky">
            <button
              type="button"
              className="btn btn-primary staff-create-so-page__dealer-continue-btn"
              disabled={!vendorReady}
              onClick={goToCatalog}
            >
              Continue to Catalog
              <ArrowRight size={16} aria-hidden />
            </button>
          </div>
        </>
      ) : null}

      {step === 'catalog' ? (
        <section className="staff-create-so-page__catalog">
          <div className="staff-create-so-page__catalog-bar panel glass">
            <p className="text-muted text-sm staff-create-so-page__catalog-hint">
              {selectedVendor
                ? `Vendor: ${selectedVendor.name}. Tap an item for details, or the cart icon to add it.`
                : 'Tap an item for details, or the cart icon to add it.'}
            </p>
            <button
              ref={cartBtnRef}
              type="button"
              id="cart-fly-target"
              className={`btn btn-primary btn-sm staff-create-so-page__cart-btn${
                cartBump ? ' cart-header-btn--bump' : ''
              }`}
              disabled={!items.length}
              onClick={goToPreview}
              aria-label={`Cart, ${itemCount} items`}
            >
              <ShoppingCart size={16} aria-hidden />
              <span>Cart</span>
              {items.length > 0 ? (
                <span className="staff-create-so-page__cart-badge">{items.length}</span>
              ) : null}
            </button>
          </div>

          {catalogError ? (
            <div className="products-inline-error panel glass" role="alert">
              <AlertCircle size={18} />
              <span>{catalogError}</span>
            </div>
          ) : (
            <>
              {shopCategories.length > 0 ? (
                <div className="staff-create-so-page__category-chips panel glass">
                  <CatalogCategoryChips
                    categories={shopCategories}
                    activeCategoryId={browseCategoryId}
                    onSelect={setBrowseCategoryId}
                  />
                </div>
              ) : null}
              <CatalogBrowse
                products={shopProducts}
                categories={shopCategories}
                isLoading={catalogLoading}
                title=""
                showToolbar={false}
                filterMode="minimal"
                dealerView
                enableCart
                flatBrowse={false}
                showCategoryGrid={!browseCategoryId}
                searchPlaceholder="Search products…"
                showStockQuantity={showStockQuantity}
                spareLinkCountByProductId={spareCountByProductId ?? undefined}
                onProductSelect={setPeekProduct}
                managePageHeader={false}
                activeCategoryId={browseCategoryId}
                onActiveCategoryChange={setBrowseCategoryId}
                emptyTitle="No catalog items available"
                emptyHint="Sync the catalog or adjust category filters."
              />
            </>
          )}

          <StaffSoProductPeek
            product={peekProduct}
            categories={catalogCategories}
            showStockQuantity={showStockQuantity}
            isCartable={() => true}
            onClose={() => setPeekProduct(null)}
          />

          <div className="staff-create-so-page__catalog-footer panel glass">
            <span className="text-muted text-sm">
              {items.length
                ? `${items.length} line${items.length === 1 ? '' : 's'} in cart`
                : 'Cart is empty'}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!items.length}
              onClick={goToPreview}
            >
              Review cart
              <ArrowRight size={16} aria-hidden />
            </button>
          </div>
        </section>
      ) : null}

      {step === 'preview' ? (
        <>
          <section className="panel glass staff-create-so-page__section">
            <div className="staff-create-so-page__section-head">
              <h2>Vendor</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setStep('vendor')}
              >
                Change
              </button>
            </div>
            {selectedVendor ? (
              <div className="staff-create-so-page__dealer-summary">
                <strong>{selectedVendor.name}</strong>
                {vendorLocation(selectedVendor) ? (
                  <p className="text-muted text-sm">{vendorLocation(selectedVendor)}</p>
                ) : null}
                {selectedVendor.currencyCode ? (
                  <p className="text-muted text-sm">Currency {selectedVendor.currencyCode}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel glass staff-create-so-page__section">
            <div className="staff-create-so-page__section-head">
              <h2>Items</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setStep('catalog')}
              >
                Edit cart
              </button>
            </div>

            {items.length === 0 ? (
              <div className="staff-create-so-page__cart-empty">
                <Package size={36} aria-hidden />
                <p>Cart is empty</p>
              </div>
            ) : (
              <ul className="staff-create-so-page__cart-list">
                {items.map(item => {
                  const cost = lastPurchaseCost(poCosts.get(item.productId));
                  return (
                    <li key={item.cartLineId} className="staff-create-so-page__cart-item">
                      <div className="staff-create-so-page__cart-media">
                        <ProductImageFrame src={item.imageUrl} alt="" variant="row" />
                      </div>
                      <div className="staff-create-so-page__cart-info">
                        <strong>{item.name}</strong>
                        {item.sku ? (
                          <p className="text-muted text-sm">{item.sku}</p>
                        ) : null}
                        <p className="text-muted text-sm create-po-page__last-cost">
                          {costsLoading
                            ? 'Loading last purchase cost…'
                            : cost
                              ? `Last purchase ${formatCurrency(cost.amount, cost.currencyCode)}${
                                cost.purchaseOrderNumber ? ` · ${cost.purchaseOrderNumber}` : ''
                              }`
                              : 'No previous purchase cost'}
                        </p>
                        <QuantityStepper
                          value={item.quantity}
                          onChange={qty => setQuantity(item.cartLineId, qty)}
                          aria-label={`Quantity for ${item.name}`}
                        />
                      </div>
                      <div className="staff-create-so-page__cart-actions">
                        <strong>
                          {cost
                            ? formatCurrency(cost.amount * item.quantity, cost.currencyCode)
                            : '—'}
                        </strong>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => removeItem(item.cartLineId)}
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {totalsByCurrency.length > 0 ? (
              <div className="create-po-page__totals">
                {totalsByCurrency.map(([code, total]) => (
                  <p key={code}>
                    <span className="text-muted">Last-cost total ({code})</span>
                    <strong>{formatCurrency(total, code)}</strong>
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
};

export const AdminCreatePurchaseOrderPage: React.FC = () => (
  <CartProvider persist={false}>
    <CreatePurchaseOrderWizard />
  </CartProvider>
);
