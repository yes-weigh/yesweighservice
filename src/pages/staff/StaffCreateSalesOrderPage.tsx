import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Cpu,
  Package,
  Search,
  ShoppingCart,
  Trash2,
  Wrench,
} from 'lucide-react';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { CatalogCategoryChips } from '../../components/catalog/CatalogCategoryChips';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { MultiSalesOrderSuccess } from '../../components/salesOrders/MultiSalesOrderSuccess';
import { ThemeSelect } from '../../components/ThemeSelect';
import { QuantityStepper } from '../../components/QuantityStepper';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useCart } from '../../context/useCart';
import { useCartFly } from '../../context/useCartFly';
import {
  excludeHiddenCatalogProducts,
  fetchCatalog,
  formatCurrency,
  getCategoriesForProducts,
  isHiddenCatalogCategory,
} from '../../lib/catalog';
import { combinedCartRate, newCartLineId } from '../../lib/gatcCart';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../lib/dealer-cache';
import {
  dealerOrderErrorMessage,
  type SegmentSalesOrderResult,
} from '../../lib/dealerOrders';
import {
  dealerMatchesLogisticsQuery,
  zohoDealerContactPerson,
  zohoDealerToSnapshot,
} from '../../lib/logisticsDealers';
import {
  classifyOrderLineSegment,
  isFreightOrderLine,
  segmentAllowsFreight,
  segmentLabel,
  staffAllowedOrderSegments,
  summarizeSegments,
  type OrderSegment,
} from '../../lib/salesOrderSegments';
import { FREIGHT_LINE_OPTIONS } from '../../constants/freightLines';
import { hasStaffPermission, isFullSuperAdmin } from '../../lib/staffAccess';
import { createStaffSalesOrder } from '../../lib/salesOrderWorkflow';
import {
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import {
  listZohoSalespersons,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type { ZohoDealer } from '../../types/dealers';
import type { User } from '../../types';
import type { CartItem } from '../../types/cart';

type FreightDraftLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  rate: number;
};

type WizardStep = 'segment' | 'catalog' | 'preview';

type SelectedDealer = {
  id: string;
  label: string;
  contactPerson: string | null;
  mobile: string | null;
};

const SEGMENT_OPTIONS: Array<{
  id: OrderSegment;
  title: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'product',
    title: 'Product',
    hint: 'Finished goods with a catalog category',
    icon: <Package size={28} aria-hidden />,
  },
  {
    id: 'spare',
    title: 'Spare',
    hint: 'Generic spare parts and uncategorized items',
    icon: <Wrench size={28} aria-hidden />,
  },
  {
    id: 'software',
    title: 'Software',
    hint: 'Software keys and Sanoft',
    icon: <Cpu size={28} aria-hidden />,
  },
];

function userHasLinkedSalesperson(user: User | null | undefined): boolean {
  if (!user) return false;
  if (String(user.zohoSalespersonId ?? '').trim()) return true;
  if (Array.isArray(user.zohoSalespersonIds)
    && user.zohoSalespersonIds.some(id => String(id ?? '').trim())) {
    return true;
  }
  if (Array.isArray(user.zohoSalespersonLinks)
    && user.zohoSalespersonLinks.some(link => String(link?.id ?? '').trim())) {
    return true;
  }
  return false;
}

function toSelectedDealer(dealer: ZohoDealer): SelectedDealer {
  const snapshot = zohoDealerToSnapshot(dealer);
  const label = snapshot.name;
  const contactPerson = zohoDealerContactPerson(dealer);
  return {
    id: dealer.id,
    label,
    contactPerson: contactPerson !== '—' && contactPerson !== label ? contactPerson : null,
    mobile: snapshot.mobile !== '—' ? snapshot.mobile : null,
  };
}

function progressClass(currentIndex: number, index: number): string {
  if (index < currentIndex) return 'is-done';
  if (index === currentIndex) return 'is-active';
  return '';
}

export const StaffCreateSalesOrderPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const confirm = useConfirm();
  const {
    items: cartItems,
    itemCount,
    setQuantity,
    removeItem,
    clearCart,
    remarks: cartRemarks,
    setRemarks: setCartRemarks,
  } = useCart();
  const { registerCartTarget, cartBump } = useCartFly();
  const cartBtnRef = useRef<HTMLButtonElement>(null);

  const canManage = hasStaffPermission(user, 'orders.manage');
  const listPath = pathname.startsWith('/super-admin')
    ? '/super-admin/sales-orders'
    : '/staff/sales-orders';

  const allowedSegments = useMemo(() => staffAllowedOrderSegments(user), [user]);
  /** Staff/admin pick one segment per SO (dealers may multi-SO). Skip picker only if a single allowed segment. */
  const showSegmentStep = allowedSegments.length > 1;

  const [step, setStep] = useState<WizardStep>(() => (
    allowedSegments.length > 1 ? 'segment' : 'catalog'
  ));
  const [selectedSegment, setSelectedSegment] = useState<OrderSegment | null>(
    () => (allowedSegments.length === 1 ? (allowedSegments[0] ?? null) : null),
  );

  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [browseCategoryId, setBrowseCategoryId] = useState('');

  const [dealerQuery, setDealerQuery] = useState('');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<SelectedDealer | null>(null);

  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);
  const [salespersonId, setSalespersonId] = useState('');
  const [salespersons, setSalespersons] = useState<ZohoSalespersonOption[]>([]);
  const [salespersonsLoading, setSalespersonsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [freightLines, setFreightLines] = useState<FreightDraftLine[]>([]);
  const [freightSku, setFreightSku] = useState<string>(FREIGHT_LINE_OPTIONS[0].sku);
  const [freightRateInput, setFreightRateInput] = useState('');

  const activeSegments = useMemo((): OrderSegment[] => (
    selectedSegment ? [selectedSegment] : []
  ), [selectedSegment]);

  const freightAllowed = segmentAllowsFreight(selectedSegment);

  const steps = useMemo((): WizardStep[] => (
    showSegmentStep ? ['segment', 'catalog', 'preview'] : ['catalog', 'preview']
  ), [showSegmentStep]);

  const stepIndex = Math.max(0, steps.indexOf(step));

  const stepTitle = step === 'segment'
    ? 'Select segment'
    : step === 'catalog'
      ? (selectedSegment ? `${segmentLabel(selectedSegment)} catalog` : 'Catalog')
      : 'Preview & submit';

  const goBackRef = useRef<() => void>(() => {
    navigate(listPath);
  });

  useCatalogPageHeader({
    title: createdOrders?.length ? 'Orders created' : 'New sales order',
    subtitle: createdOrders?.length ? null : stepTitle,
    showBack: true,
    onBack: () => {
      goBackRef.current();
    },
    mobileCompactHeader: true,
  }, true);

  useEffect(() => {
    if (!canManage) {
      navigate(listPath, { replace: true });
    }
  }, [canManage, navigate, listPath]);

  useEffect(() => {
    if (allowedSegments.length === 1) {
      setSelectedSegment(allowedSegments[0]);
      setStep(prev => (prev === 'segment' ? 'catalog' : prev));
    }
  }, [allowedSegments]);

  useEffect(() => {
    if (!freightAllowed && freightLines.length) {
      setFreightLines([]);
      setFreightRateInput('');
    }
  }, [freightAllowed, freightLines.length]);

  const productMatchesActiveSegments = useCallback(
    (product: { categoryId?: string | null; categoryName?: string | null; productId?: string | null; id?: string | null; sku?: string | null }) => {
      if (!activeSegments.length) return false;
      if (isFreightOrderLine({ productId: product.productId ?? product.id, sku: product.sku })) {
        return false;
      }
      const segment = classifyOrderLineSegment(product);
      return Boolean(segment && activeSegments.includes(segment));
    },
    [activeSegments],
  );

  const allowedItems = useMemo(
    () => cartItems.filter(item => productMatchesActiveSegments(item)),
    [cartItems, productMatchesActiveSegments],
  );

  const lines = useMemo(() => (
    allowedItems.map(item => {
      const override = rateOverrides[item.cartLineId];
      const catalogRate = override != null ? override : item.baseRate;
      return {
        ...item,
        catalogRate,
        rate: combinedCartRate(catalogRate, item.gatcFeePerUnit),
      };
    })
  ), [allowedItems, rateOverrides]);

  const submitLines = useMemo(() => ([
    ...lines.map(line => ({
      productId: line.productId,
      quantity: line.quantity,
      rate: line.catalogRate,
      gatcStampingPriceId: line.gatcStampingPriceId ?? null,
      name: line.name,
      sku: line.sku,
      categoryId: line.categoryId,
      categoryName: line.categoryName,
    })),
    ...(freightAllowed
      ? freightLines.map(line => ({
          productId: line.productId,
          quantity: 1,
          rate: line.rate,
          gatcStampingPriceId: null as string | null,
          name: line.name,
          sku: line.sku,
          categoryId: null as string | null,
          categoryName: null as string | null,
        }))
      : []),
  ]), [lines, freightLines, freightAllowed]);

  const hasProductLines = useMemo(
    () => lines.some(line => classifyOrderLineSegment(line) === 'product'),
    [lines],
  );
  const segmentPreview = useMemo(() => summarizeSegments(submitLines), [submitLines]);

  const freightSubtotal = useMemo(
    () => (freightAllowed ? freightLines.reduce((sum, line) => sum + line.rate, 0) : 0),
    [freightAllowed, freightLines],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.rate * line.quantity, 0) + freightSubtotal,
    [lines, freightSubtotal],
  );
  const needsSalespersonPicker = isFullSuperAdmin(user)
    && !userHasLinkedSalesperson(user)
    && hasProductLines;

  const shopProducts = useMemo(
    () => excludeHiddenCatalogProducts(catalogProducts, catalogCategories)
      .filter(productMatchesActiveSegments),
    [catalogProducts, catalogCategories, productMatchesActiveSegments],
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

  const spareOnlyCatalog = activeSegments.length === 1 && activeSegments[0] === 'spare';
  const showBrowseCategoryChips = !spareOnlyCatalog && shopCategories.length > 0;

  useEffect(() => {
    setBrowseCategoryId('');
  }, [activeSegments]);

  useEffect(() => {
    if (step !== 'catalog') {
      registerCartTarget(null);
      return;
    }
    registerCartTarget(cartBtnRef.current);
    return () => registerCartTarget(null);
  }, [registerCartTarget, step, itemCount]);

  useEffect(() => {
    if (step !== 'catalog' || activeSegments.length === 0) return;
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
          setCatalogError(err instanceof Error ? err.message : 'Could not load catalog.');
          setCatalogProducts([]);
          setCatalogCategories([]);
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, activeSegments]);

  useEffect(() => {
    if (!needsSalespersonPicker) return;
    let cancelled = false;
    setSalespersonsLoading(true);
    void listZohoSalespersons()
      .then(rows => {
        if (!cancelled) setSalespersons(rows.filter(row => row.active));
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load salespersons.');
          setSalespersons([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSalespersonsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsSalespersonPicker]);

  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedDealers();
    if (cached?.length) {
      setDealers(cached);
      setDealersLoading(false);
    } else {
      setDealersLoading(true);
    }

    const unsubscribe = subscribeDealerCache((list, complete) => {
      if (cancelled) return;
      setDealers(list);
      if (complete || list.length > 0) setDealersLoading(false);
    });

    void ensureDealersCached()
      .then(list => {
        if (!cancelled) {
          setDealers(list);
          setDealersLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled && !peekCachedDealers()?.length) {
          setDealers([]);
          setDealersLoading(false);
          setError(err instanceof Error ? err.message : 'Could not load dealers.');
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const filteredDealers = useMemo(() => {
    const q = dealerQuery.trim();
    if (q.length < 2) return [];
    return dealers
      .filter(dealer => dealerMatchesLogisticsQuery(dealer, q))
      .slice(0, 40);
  }, [dealers, dealerQuery]);

  const loadAddresses = useCallback(async (customerId: string) => {
    setAddressesLoading(true);
    setAddressError('');
    setShipping(null);
    try {
      const next = await listCustomerShippingAddresses(customerId);
      setAddresses(next);
    } catch (err) {
      setAddresses([]);
      setAddressError(err instanceof Error ? err.message : 'Could not load addresses.');
    } finally {
      setAddressesLoading(false);
    }
  }, []);

  const selectDealer = (dealer: ZohoDealer) => {
    setSelectedDealer(toSelectedDealer(dealer));
    setDealerQuery('');
    setError('');
    void loadAddresses(dealer.id);
  };

  const canSubmit = Boolean(
    lines.length
    && selectedDealer
    && shipping
    && (!needsSalespersonPicker || salespersonId.trim()),
  );

  const setLineBaseRate = (cartLineId: string, baseRate: number) => {
    const nextBase = Number.isFinite(baseRate) && baseRate >= 0
      ? Math.round(baseRate * 100) / 100
      : 0;
    setRateOverrides(prev => ({ ...prev, [cartLineId]: nextBase }));
  };

  const pruneCartToSegments = useCallback((segments: OrderSegment[]) => {
    const allowed = new Set(segments);
    const removeIds = cartItems
      .filter(item => {
        const segment = classifyOrderLineSegment(item);
        return !segment || !allowed.has(segment);
      })
      .map(item => item.cartLineId);
    for (const id of removeIds) removeItem(id);
  }, [cartItems, removeItem]);

  const addFreightLine = () => {
    if (!freightAllowed) {
      setError('Freight is not available for software sales orders.');
      return;
    }
    const option = FREIGHT_LINE_OPTIONS.find(row => row.sku === freightSku);
    if (!option) {
      setError('Select a freight charge.');
      return;
    }
    const rate = Math.round(Number(freightRateInput) * 100) / 100;
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter a freight rate ≥ 0.');
      return;
    }
    setError('');
    setFreightLines(prev => [
      ...prev,
      {
        id: newCartLineId(),
        productId: option.productId,
        sku: option.sku,
        name: option.name,
        rate,
      },
    ]);
    setFreightRateInput('');
  };

  const goToSegmentStep = useCallback(async () => {
    if (!showSegmentStep || step === 'segment') return;
    setError('');
    if (!(lines.length > 0 || freightLines.length > 0)) {
      setStep('segment');
      return;
    }
    const ok = await confirm({
      title: 'Change segment?',
      message:
        'Your cart has items for the current segment. Changing segment will clear the cart and freight lines. Continue?',
      confirmLabel: 'Clear cart & change',
      cancelLabel: 'Stay here',
      destructive: true,
    });
    if (!ok) return;
    clearCart();
    setRateOverrides({});
    setFreightLines([]);
    setFreightRateInput('');
    setStep('segment');
  }, [showSegmentStep, step, lines.length, freightLines.length, confirm, clearCart]);

  const goBack = useCallback(() => {
    setError('');
    if (step === 'preview') {
      setStep('catalog');
      return;
    }
    if (step === 'catalog' && showSegmentStep) {
      void goToSegmentStep();
      return;
    }
    navigate(listPath);
  }, [step, showSegmentStep, goToSegmentStep, navigate, listPath]);

  goBackRef.current = createdOrders?.length
    ? () => navigate(listPath)
    : goBack;

  const selectSegmentAndContinue = (segment: OrderSegment) => {
    setSelectedSegment(segment);
    pruneCartToSegments([segment]);
    if (!segmentAllowsFreight(segment)) {
      setFreightLines([]);
      setFreightRateInput('');
    }
    setError('');
    setStep('catalog');
  };

  const goToPreview = () => {
    if (!lines.length) {
      setError('Add at least one item from the catalog.');
      return;
    }
    setError('');
    setStep('preview');
  };

  const onProgressStepClick = (target: WizardStep) => {
    if (target === step) return;
    if (target === 'segment') {
      void goToSegmentStep();
      return;
    }
    if (target === 'catalog') {
      if (step === 'preview' || (step === 'segment' && selectedSegment)) {
        setError('');
        setStep('catalog');
      }
      return;
    }
    if (target === 'preview') {
      goToPreview();
    }
  };

  const save = async (stage: 'review' | 'ready_for_payment') => {
    if (!selectedDealer) {
      setError('Select a dealer.');
      return;
    }
    if (!lines.length) {
      setError('Add items from the catalog.');
      return;
    }
    if (!shipping) {
      setError('Select a shipping address.');
      return;
    }
    if (needsSalespersonPicker && !salespersonId.trim()) {
      setError('Select a salesperson for the product sales order.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createStaffSalesOrder({
        zohoCustomerId: selectedDealer.id,
        lines: submitLines.map(line => ({
          productId: line.productId,
          quantity: line.quantity,
          rate: line.rate,
          gatcStampingPriceId: line.gatcStampingPriceId ?? null,
        })),
        shipping,
        stage,
        remarks: cartRemarks.trim(),
        ...(needsSalespersonPicker
          ? { salespersonId: salespersonId.trim() }
          : {}),
      });
      clearCart();
      setRateOverrides({});
      setFreightLines([]);
      const salesOrders = Array.isArray(result.salesOrders) && result.salesOrders.length > 0
        ? result.salesOrders
        : (result.zohoSalesOrderId
          ? [{
              segment: 'product' as const,
              segmentLabel: 'Product',
              orderNumber: result.orderNumber,
              zohoSalesOrderId: result.zohoSalesOrderId,
              zohoSalesOrderNumber: result.zohoSalesOrderNumber,
              status: 'draft',
              subtotal: result.subtotal,
              itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
              salespersonId: null,
              salespersonName: null,
            }]
          : []);
      if (salesOrders.length > 1) {
        setCreatedOrders(salesOrders);
        return;
      }
      const soId = salesOrders[0]?.zohoSalesOrderId || result.zohoSalesOrderId;
      if (soId) navigate(`${listPath}/${soId}`);
      else navigate(listPath);
    } catch (err) {
      setError(dealerOrderErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (createdOrders && createdOrders.length > 0) {
    return (
      <div className="page-content fade-in staff-create-so-page">
        <MultiSalesOrderSuccess
          salesOrders={createdOrders}
          detailBasePath={listPath}
          listPath={listPath}
        />
      </div>
    );
  }

  const segmentChips = SEGMENT_OPTIONS.filter(option => allowedSegments.includes(option.id));

  return (
    <div className={`page-content fade-in staff-create-so-page staff-create-so-page--${step}`}>
      <nav className="staff-create-so-page__stepper" aria-label="Create sales order progress">
        {steps.map((id, index) => {
          const label = id === 'segment' ? 'Segment' : id === 'catalog' ? 'Catalog' : 'Preview';
          const clickable = id === 'segment'
            ? showSegmentStep && step !== 'segment'
            : id === 'catalog'
              ? step === 'preview' || (step === 'segment' && Boolean(selectedSegment))
              : id === 'preview' && step === 'catalog' && lines.length > 0;
          const stateClass = progressClass(stepIndex, index);
          return (
            <React.Fragment key={id}>
              {index > 0 ? (
                <span
                  className={`staff-create-so-page__stepper-line${
                    index <= stepIndex ? ' is-done' : ''
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
                <span className="staff-create-so-page__stepper-num">{index + 1}</span>
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

      {step === 'segment' ? (
        <section className="panel glass staff-create-so-page__section">
          <h2>Select segment</h2>
          <p className="text-muted text-sm">
            One sales order per segment. Choose Product, Spare, or Software to continue.
          </p>
          <div className="staff-create-so-page__segment-grid" role="list">
            {segmentChips.map(option => (
              <button
                key={option.id}
                type="button"
                className="staff-create-so-page__segment-card"
                onClick={() => selectSegmentAndContinue(option.id)}
              >
                <span className="staff-create-so-page__segment-icon">{option.icon}</span>
                <strong>{option.title}</strong>
                <span className="text-muted text-sm">{option.hint}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 'catalog' ? (
        <section className="staff-create-so-page__catalog">
          <div className="staff-create-so-page__catalog-bar panel glass">
            <p className="text-muted text-sm staff-create-so-page__catalog-hint">
              Tap the cart icon on an item to add it
            </p>
            <button
              ref={cartBtnRef}
              type="button"
              id="cart-fly-target"
              className={`btn btn-primary btn-sm staff-create-so-page__cart-btn${
                cartBump ? ' cart-header-btn--bump' : ''
              }`}
              disabled={!lines.length}
              onClick={goToPreview}
              aria-label={`Cart, ${itemCount} items`}
            >
              <ShoppingCart size={16} aria-hidden />
              <span>Cart</span>
              {lines.length > 0 ? (
                <span className="staff-create-so-page__cart-badge">{lines.length}</span>
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
              {showBrowseCategoryChips ? (
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
                isCartable={productMatchesActiveSegments}
                flatBrowse={spareOnlyCatalog}
                showCategoryGrid={!spareOnlyCatalog && !browseCategoryId}
                searchPlaceholder="Search catalog…"
                onProductSelect={() => undefined}
                managePageHeader={false}
                activeCategoryId={browseCategoryId}
                onActiveCategoryChange={setBrowseCategoryId}
                emptyTitle="No items in this segment"
                emptyHint="Try another segment or sync the catalog."
              />
            </>
          )}

          <div className="staff-create-so-page__catalog-footer panel glass">
            <span className="text-muted text-sm">
              {lines.length
                ? `${lines.length} line${lines.length === 1 ? '' : 's'} in cart`
                : 'Cart is empty'}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!lines.length}
              onClick={goToPreview}
            >
              Preview
              <ArrowRight size={16} aria-hidden />
            </button>
          </div>
        </section>
      ) : null}

      {step === 'preview' ? (
        <>
          <section className="panel glass staff-create-so-page__section">
            <div className="staff-create-so-page__section-head">
              <h2>Items</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={saving}
                onClick={() => setStep('catalog')}
              >
                Edit cart
              </button>
            </div>

            {lines.length === 0 ? (
              <div className="staff-create-so-page__cart-empty">
                <Package size={36} aria-hidden />
                <p>Cart is empty</p>
              </div>
            ) : (
              <ul className="staff-create-so-page__cart-list">
                {lines.map(item => (
                  <StaffCartLine
                    key={item.cartLineId}
                    item={item}
                    disabled={saving}
                    onQuantity={qty => setQuantity(item.cartLineId, qty)}
                    onRate={rate => setLineBaseRate(item.cartLineId, rate)}
                    onRemove={() => {
                      removeItem(item.cartLineId);
                      setRateOverrides(prev => {
                        const next = { ...prev };
                        delete next[item.cartLineId];
                        return next;
                      });
                    }}
                  />
                ))}
              </ul>
            )}

            {segmentPreview.length > 1 ? (
              <p className="text-muted text-sm staff-create-so-page__segment-hint">
                This will create {segmentPreview.length} draft sales orders:
                {' '}
                {segmentPreview.map(segmentLabel).join(', ')}.
              </p>
            ) : null}
          </section>

          {freightAllowed ? (
          <section className="panel glass staff-create-so-page__section">
            <h2>Freight</h2>
            <p className="text-muted text-sm">
              Optional courier freight — qty 1, enter the full charge as rate
              (ST / Trackon / Delhivery / Others).
            </p>
            {freightLines.length > 0 ? (
              <ul className="staff-create-so-page__freight-list">
                {freightLines.map(line => (
                  <li key={line.id} className="staff-create-so-page__freight-item">
                    <div className="staff-create-so-page__freight-info">
                      <strong>{line.name}</strong>
                      <span className="text-muted text-sm">{line.sku}</span>
                    </div>
                    <label className="staff-create-so-page__rate">
                      <span className="text-muted text-sm">Rate</span>
                      <input
                        type="number"
                        className="input-field"
                        min={0}
                        step={0.01}
                        value={line.rate}
                        disabled={saving}
                        onChange={e => {
                          const next = Math.round(Number(e.target.value) * 100) / 100;
                          setFreightLines(prev => prev.map(row => (
                            row.id === line.id
                              ? { ...row, rate: Number.isFinite(next) && next >= 0 ? next : 0 }
                              : row
                          )));
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={saving}
                      onClick={() => setFreightLines(prev => prev.filter(row => row.id !== line.id))}
                      aria-label={`Remove ${line.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="staff-create-so-page__freight-add">
              <label>
                <span className="text-muted text-sm">Freight type</span>
                <ThemeSelect
                  id="staff-so-freight-sku"
                  value={freightSku}
                  disabled={saving}
                  options={FREIGHT_LINE_OPTIONS.map(option => ({
                    value: option.sku,
                    label: option.name,
                    hint: option.sku,
                  }))}
                  onChange={setFreightSku}
                  aria-label="Freight type"
                />
              </label>
              <label className="staff-create-so-page__rate">
                <span className="text-muted text-sm">Rate</span>
                <input
                  type="number"
                  className="input-field"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={freightRateInput}
                  disabled={saving}
                  onChange={e => setFreightRateInput(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={saving}
                onClick={addFreightLine}
              >
                Add freight
              </button>
            </div>
          </section>
          ) : null}

          <section className="panel glass staff-create-so-page__section">
            <h2>Dealer</h2>
            {selectedDealer ? (
              <div className="staff-create-so-page__dealer-selected">
                <div>
                  <strong>{selectedDealer.label}</strong>
                  {selectedDealer.contactPerson ? (
                    <p className="text-muted text-sm">{selectedDealer.contactPerson}</p>
                  ) : null}
                  {selectedDealer.mobile ? (
                    <p className="text-muted text-sm">{selectedDealer.mobile}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={saving}
                  onClick={() => {
                    setSelectedDealer(null);
                    setAddresses([]);
                    setShipping(null);
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="staff-create-so-page__dealer-search">
                <div className="catalog-search">
                  <Search size={15} aria-hidden />
                  <input
                    type="search"
                    placeholder="Search dealer by name, code or mobile…"
                    value={dealerQuery}
                    onChange={e => setDealerQuery(e.target.value)}
                    aria-label="Search dealers"
                  />
                </div>
                {dealersLoading && dealers.length === 0 ? (
                  <p className="text-muted text-sm">Loading dealers…</p>
                ) : filteredDealers.length > 0 ? (
                  <ul className="staff-create-so-page__dealer-list" role="listbox">
                    {filteredDealers.map(dealer => {
                      const snapshot = zohoDealerToSnapshot(dealer);
                      return (
                        <li key={dealer.id}>
                          <button
                            type="button"
                            className="staff-create-so-page__dealer-option"
                            onClick={() => selectDealer(dealer)}
                          >
                            <strong>{snapshot.name}</strong>
                            <span className="text-muted text-sm">
                              {[
                                snapshot.contactPerson !== '—' ? snapshot.contactPerson : null,
                                snapshot.mobile !== '—' ? snapshot.mobile : null,
                                dealer.id,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : dealerQuery.trim().length >= 2 ? (
                  <p className="text-muted text-sm">
                    {dealersLoading
                      ? 'Still loading dealers…'
                      : `No dealers match “${dealerQuery.trim()}”.`}
                  </p>
                ) : (
                  <p className="text-muted text-sm">
                    Type at least 2 characters to search
                    {dealersLoading ? ' (loading dealer list…)' : ` (${dealers.length} dealers loaded)`}.
                  </p>
                )}
              </div>
            )}
          </section>

          {selectedDealer ? (
            <section className="panel glass staff-create-so-page__section">
              <ShippingAddressPicker
                addresses={addresses}
                loading={addressesLoading}
                error={addressError}
                disabled={saving}
                value={shipping}
                onChange={setShipping}
                onRefresh={() => void loadAddresses(selectedDealer.id)}
              />
            </section>
          ) : null}

          <section className="panel glass staff-create-so-page__section">
            <label htmlFor="staff-so-remarks">
              Remarks
              <textarea
                id="staff-so-remarks"
                className="input-field"
                rows={3}
                value={cartRemarks}
                disabled={saving}
                onChange={e => setCartRemarks(e.target.value)}
                placeholder="Optional notes for this sales order"
              />
            </label>

            {needsSalespersonPicker ? (
              <label className="staff-create-so-page__salesperson">
                <span>Salesperson</span>
                <ThemeSelect
                  id="staff-so-salesperson"
                  value={salespersonId}
                  disabled={saving || salespersonsLoading}
                  placeholder={
                    salespersonsLoading ? 'Loading salespersons…' : 'Select salesperson…'
                  }
                  options={salespersons.map(row => ({
                    value: row.id,
                    label: row.name,
                    hint: row.email || undefined,
                  }))}
                  onChange={setSalespersonId}
                  aria-label="Salesperson"
                />
                <span className="text-muted text-sm">
                  Required for the product sales order — your admin account has no linked Zoho salesperson.
                </span>
              </label>
            ) : null}

            <div className="staff-create-so-page__totals">
              <span className="text-muted">Estimated subtotal</span>
              <strong>{formatCurrency(subtotal)}</strong>
            </div>
            <div className="staff-create-so-page__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || !canSubmit}
                onClick={() => void save('review')}
              >
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !canSubmit}
                onClick={() => void save('ready_for_payment')}
              >
                {saving ? 'Saving…' : 'Ready for payment'}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};

function StaffCartLine({
  item,
  disabled,
  onQuantity,
  onRate,
  onRemove,
}: {
  item: CartItem & { catalogRate: number; rate: number };
  disabled?: boolean;
  onQuantity: (qty: number) => void;
  onRate: (rate: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="staff-create-so-page__cart-item">
      <div className="staff-create-so-page__cart-media">
        {item.imageUrl ? (
          <CategoryThumbnail src={item.imageUrl} knockout={false} />
        ) : (
          <Package size={24} aria-hidden />
        )}
      </div>
      <DocumentLineItemSpec
        className="staff-create-so-page__cart-info"
        name={item.name}
        sku={item.sku}
        description={item.description}
      >
        <label className="staff-create-so-page__rate">
          <span className="text-muted text-sm">Base rate</span>
          <input
            type="number"
            className="input-field"
            min={0}
            step={0.01}
            value={item.catalogRate}
            disabled={disabled}
            onChange={e => onRate(Number(e.target.value))}
          />
        </label>
        {item.gatcFeePerUnit > 0 ? (
          <span className="text-muted text-sm">
            + {item.gatcFeePerUnit.toLocaleString('en-IN')} stamping
            {item.gatcStampingRange ? ` (${item.gatcStampingRange})` : ''}
          </span>
        ) : null}
        <strong>{formatCurrency(item.rate * item.quantity)}</strong>
      </DocumentLineItemSpec>
      <div className="staff-create-so-page__cart-actions">
        <QuantityStepper
          value={item.quantity}
          onChange={onQuantity}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove from cart"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}
