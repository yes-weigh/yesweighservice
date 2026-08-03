import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Headset,
  MapPin,
  Package,
  Search,
  ShoppingCart,
  ShieldCheck,
  Store,
  Trash2,
  Truck,
  UserCircle,
  Users,
} from 'lucide-react';
import { orderSegmentIconNode } from '../../components/invoices/InvoiceCategoryVisual';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { CatalogBrowse } from '../../components/catalog/CatalogBrowse';
import { CatalogCategoryChips } from '../../components/catalog/CatalogCategoryChips';
import { CategoryThumbnail } from '../../components/catalog/CategoryThumbnail';
import {
  type GatcStampingChoice,
} from '../../components/catalog/GatcStampingChoiceDialog';
import { GatcStampingInlineControl } from '../../components/catalog/GatcStampingInlineControl';
import { DocumentLineItemSpec } from '../../components/invoices/DocumentLineItemSpec';
import { MultiSalesOrderSuccess } from '../../components/salesOrders/MultiSalesOrderSuccess';
import { ThemeSelect } from '../../components/ThemeSelect';
import { QuantityStepper } from '../../components/QuantityStepper';
import { FreightPartnerPicker } from '../../components/orders/FreightPartnerPicker';
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
import { combinedCartRate, productHasLinkedGatc } from '../../lib/gatcCart';
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
import { freightOptionBySku } from '../../constants/freightLines';
import type { FreightLineSku } from '../../constants/freightLines';
import {
  CLOUD_CHARGES_SALESPERSON_ID,
  CLOUD_CHARGES_SALESPERSON_NAME,
} from '../../constants/cloudChargesSalesperson';
import { hasStaffPermission, isFullSuperAdmin } from '../../lib/staffAccess';
import { createStaffSalesOrder } from '../../lib/salesOrderWorkflow';
import {
  addressesFromDealerCache,
  listCustomerShippingAddresses,
  type ShippingAddress,
  type ShippingSelection,
} from '../../lib/shippingAddresses';
import {
  loadSpareInchargeSettings,
  primaryZohoSalespersonForUser,
} from '../../lib/spareIncharge';
import {
  listZohoSalespersons,
  listZohoSalespersonsFromFirestore,
  type ZohoSalespersonOption,
} from '../../lib/zohoSalespersons';
import { normalizeZohoSalespersonLinks } from '../../lib/zohoSalespersonStaff';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
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

type WizardStep = 'orderType' | 'dealer' | 'catalog' | 'preview';

type SelectedDealer = {
  id: string;
  label: string;
  contactPerson: string | null;
  mobile: string | null;
  assignedStaffUid: string | null;
  assignedStaffName: string | null;
};

type SalespersonPreview = {
  source: 'cloud' | 'spare_incharge' | 'self' | 'kam' | 'pick';
  title: string;
  salespersonId: string | null;
  salespersonName: string | null;
  staffName: string | null;
  hint: string | null;
  error: string | null;
  loading: boolean;
};

function formatShippingSummary(
  shipping: ShippingSelection | null,
  addresses: ShippingAddress[],
): string {
  if (!shipping) return 'No address selected';
  if (shipping.mode === 'saved') {
    const match = addresses.find(addr => addr.addressId === shipping.addressId);
    return match?.formatted?.trim()
      || match?.label?.trim()
      || 'Saved address';
  }
  if (shipping.mode === 'kind') {
    return shipping.kind === 'billing' ? 'Billing address' : 'Shipping address';
  }
  const parts = [
    shipping.newAddress.attention,
    shipping.newAddress.address,
    shipping.newAddress.city,
    shipping.newAddress.state,
    shipping.newAddress.zip,
  ].map(part => String(part ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : 'New address';
}

async function loadStaffSalesperson(uid: string): Promise<{
  salespersonId: string;
  salespersonName: string | null;
  staffName: string;
} | null> {
  const id = uid.trim();
  if (!id) return null;
  const snap = await getDoc(doc(db, 'users', id));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.active === false) return null;
  const link = primaryZohoSalespersonForUser({
    zohoSalespersonLinks: data.zohoSalespersonLinks as { id: string; name: string | null }[] | null,
    zohoSalespersonIds: data.zohoSalespersonIds as string[] | null,
    zohoSalespersonId: data.zohoSalespersonId as string | null,
    zohoSalespersonName: data.zohoSalespersonName as string | null,
  });
  if (!link?.id) return null;
  return {
    salespersonId: link.id,
    salespersonName: link.name,
    staffName: String(data.displayName ?? 'Staff').trim() || 'Staff',
  };
}

function ownSalespersonFromUser(user: User | null | undefined): {
  salespersonId: string;
  salespersonName: string | null;
} | null {
  if (!user) return null;
  const link = normalizeZohoSalespersonLinks({
    zohoSalespersonLinks: user.zohoSalespersonLinks,
    zohoSalespersonIds: user.zohoSalespersonIds,
    zohoSalespersonId: user.zohoSalespersonId,
    zohoSalespersonName: user.zohoSalespersonName,
  })[0];
  if (!link?.id) return null;
  return { salespersonId: link.id, salespersonName: link.name };
}

const ORDER_TYPE_OPTIONS: Array<{
  id: OrderSegment;
  tone: 'product' | 'spare' | 'software';
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'product',
    tone: 'product',
    title: 'Finished Goods',
    subtitle: 'Buy complete weighing scales & systems',
    description: 'Browse our full range of weighing products with specifications and pricing.',
    icon: orderSegmentIconNode('product', 22),
  },
  {
    id: 'spare',
    tone: 'spare',
    title: 'Spare House',
    subtitle: 'Genuine Spare Parts',
    description: 'Find and order original spare parts for all our products.',
    icon: orderSegmentIconNode('spare', 22),
  },
  {
    id: 'software',
    tone: 'software',
    title: 'Software Solutions',
    subtitle: 'Licenses, Keys & Digital Products',
    description: 'Purchase software licenses, activation keys and digital services.',
    icon: orderSegmentIconNode('software', 22),
  },
];

const ORDER_TYPE_TRUST_ITEMS: Array<{
  title: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    title: '100% Genuine',
    hint: 'Original quality you can trust',
    icon: <ShieldCheck size={18} aria-hidden />,
  },
  {
    title: 'Fast Dispatch',
    hint: 'Quick processing & timely delivery',
    icon: <Truck size={18} aria-hidden />,
  },
  {
    title: 'Secure Ordering',
    hint: 'Safe, reliable & verified orders',
    icon: <BadgeCheck size={18} aria-hidden />,
  },
  {
    title: 'Dealer Support',
    hint: 'We are here to assist you 24/7',
    icon: <Headset size={18} aria-hidden />,
  },
];

function toSelectedDealer(dealer: ZohoDealer): SelectedDealer {
  const snapshot = zohoDealerToSnapshot(dealer);
  const label = snapshot.name;
  const contactPerson = zohoDealerContactPerson(dealer);
  return {
    id: dealer.id,
    label,
    contactPerson: contactPerson !== '—' && contactPerson !== label ? contactPerson : null,
    mobile: snapshot.mobile !== '—' ? snapshot.mobile : null,
    assignedStaffUid: dealer.assignedStaffUid?.trim() || null,
    assignedStaffName: dealer.assignedStaffName?.trim() || null,
  };
}

function progressClass(currentIndex: number, index: number): string {
  if (index < currentIndex) return 'is-done';
  if (index === currentIndex) return 'is-active';
  return '';
}

function dealerLocationLabel(dealer: ZohoDealer): string | null {
  const city = (
    dealer.zohoShippingAddressRaw?.city
    || dealer.zohoBillingAddressRaw?.city
    || dealer.district
    || ''
  ).trim();
  const state = (
    dealer.zohoShippingAddressRaw?.state
    || dealer.zohoBillingAddressRaw?.state
    || dealer.billingState
    || ''
  ).trim();
  const parts = [city, state].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
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
    addItem,
    updateStamping,
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
    allowedSegments.length > 1 ? 'orderType' : 'dealer'
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
  const [spPreview, setSpPreview] = useState<SalespersonPreview>({
    source: 'self',
    title: 'Salesperson',
    salespersonId: null,
    salespersonName: null,
    staffName: null,
    hint: null,
    error: null,
    loading: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [freightLines, setFreightLines] = useState<FreightDraftLine[]>([]);
  const [freightSku, setFreightSku] = useState<string | null>(null);
  const [freightRateInput, setFreightRateInput] = useState('');

  const activeSegments = useMemo((): OrderSegment[] => (
    selectedSegment ? [selectedSegment] : []
  ), [selectedSegment]);

  const freightAllowed = segmentAllowsFreight(selectedSegment);

  const steps = useMemo((): WizardStep[] => (
    showSegmentStep
      ? ['orderType', 'dealer', 'catalog', 'preview']
      : ['dealer', 'catalog', 'preview']
  ), [showSegmentStep]);

  const stepIndex = Math.max(0, steps.indexOf(step));

  const dealerReady = Boolean(selectedDealer && shipping);

  const fullSA = isFullSuperAdmin(user);
  /** Super admins always pick salesperson for product SOs — defaulted to theirs, changeable. */
  const needsSalespersonPicker = selectedSegment === 'product' && fullSA;

  const salespersonReady = !spPreview.loading
    && !spPreview.error
    && (
      needsSalespersonPicker
        ? Boolean(salespersonId.trim())
        : Boolean(spPreview.salespersonId)
    );

  const stepTitle = `Step ${stepIndex + 1} of ${steps.length}`;

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
    accentTitle: !createdOrders?.length,
    mobileCompactHeader: false,
  }, true);

  useEffect(() => {
    if (!canManage) {
      navigate(listPath, { replace: true });
    }
  }, [canManage, navigate, listPath]);

  useEffect(() => {
    if (allowedSegments.length === 1) {
      setSelectedSegment(allowedSegments[0]);
      setStep(prev => (prev === 'orderType' ? 'dealer' : prev));
    }
  }, [allowedSegments]);

  useEffect(() => {
    if (!freightAllowed && freightLines.length) {
      setFreightLines([]);
      setFreightSku(null);
      setFreightRateInput('');
    }
  }, [freightAllowed, freightLines.length]);

  const syncFreightLine = useCallback((sku: string | null, rateRaw: string) => {
    const option = freightOptionBySku(sku);
    const trimmed = rateRaw.trim();
    const rate = Math.round(Number(trimmed) * 100) / 100;
    if (!option || trimmed === '' || !Number.isFinite(rate) || rate < 0) {
      setFreightLines([]);
      return;
    }
    setFreightLines([{
      id: 'freight-line',
      productId: option.productId,
      sku: option.sku,
      name: option.name,
      rate,
    }]);
  }, []);

  const selectFreightPartner = (sku: FreightLineSku) => {
    setError('');
    setFreightSku(sku);
    syncFreightLine(sku, freightRateInput);
  };

  const onFreightAmountChange = (value: string) => {
    setFreightRateInput(value);
    syncFreightLine(freightSku, value);
  };

  const clearFreight = () => {
    setFreightSku(null);
    setFreightRateInput('');
    setFreightLines([]);
  };

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

  const catalogById = useMemo(() => {
    const map: Record<string, CatalogProduct> = {};
    for (const product of catalogProducts) map[product.id] = product;
    return map;
  }, [catalogProducts]);

  const stampableWithoutStamping = useMemo(() => (
    lines.filter(item => {
      if (item.gatcStampingPriceId) return false;
      const catalogProduct = catalogById[item.productId];
      return catalogProduct ? productHasLinkedGatc(catalogProduct) : false;
    })
  ), [lines, catalogById]);

  const applyLineStamping = useCallback((cartLineId: string, choice: GatcStampingChoice) => {
    updateStamping(cartLineId, {
      withStamping: choice.withStamping,
      gatcStampingPriceId: choice.gatcStampingPriceId,
      gatcFeePerUnit: choice.gatcFeePerUnit,
      gatcStampingRange: choice.gatcStampingRange,
    });
  }, [updateStamping]);

  useEffect(() => {
    setRateOverrides(prev => {
      const ids = new Set(cartItems.map(item => item.cartLineId));
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (!ids.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cartItems]);

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

  const segmentPreview = useMemo(() => summarizeSegments(submitLines), [submitLines]);

  const freightSubtotal = useMemo(
    () => (freightAllowed ? freightLines.reduce((sum, line) => sum + line.rate, 0) : 0),
    [freightAllowed, freightLines],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + line.rate * line.quantity, 0) + freightSubtotal,
    [lines, freightSubtotal],
  );

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
    const segment = selectedSegment;

    if (!segment) {
      setSpPreview({
        source: 'self',
        title: 'Salesperson',
        salespersonId: null,
        salespersonName: null,
        staffName: null,
        hint: null,
        error: null,
        loading: false,
      });
      return;
    }

    setSpPreview(prev => ({
      ...prev,
      loading: true,
      hint: null,
      error: null,
    }));

    void (async () => {
      try {
        if (segment === 'software') {
          let match: ZohoSalespersonOption | null = null;
          try {
            const rows = await listZohoSalespersonsFromFirestore();
            match = rows.find(row => (
              row.active
              && row.name.trim().toLowerCase() === CLOUD_CHARGES_SALESPERSON_NAME.toLowerCase()
            )) ?? null;
          } catch {
            // Staff without HR view may be denied Firestore salesperson cache — use known id.
          }
          if (cancelled) return;
          setSpPreview({
            source: 'cloud',
            title: 'Cloud Charges',
            salespersonId: match?.id || CLOUD_CHARGES_SALESPERSON_ID,
            salespersonName: match?.name || CLOUD_CHARGES_SALESPERSON_NAME,
            staffName: CLOUD_CHARGES_SALESPERSON_NAME,
            hint: 'Software sales orders go to Cloud Charges.',
            error: null,
            loading: false,
          });
          return;
        }

        if (segment === 'spare') {
          const settings = await loadSpareInchargeSettings();
          const member = settings.members[0];
          if (!member) {
            if (cancelled) return;
            setSpPreview({
              source: 'spare_incharge',
              title: 'Spare Incharge',
              salespersonId: null,
              salespersonName: null,
              staffName: null,
              hint: null,
              error: 'Spare Incharge is not configured. Assign one in HR → Spare Incharge.',
              loading: false,
            });
            return;
          }
          const resolved = await loadStaffSalesperson(member.uid);
          if (cancelled) return;
          if (!resolved) {
            setSpPreview({
              source: 'spare_incharge',
              title: 'Spare Incharge',
              salespersonId: null,
              salespersonName: null,
              staffName: member.displayName,
              hint: null,
              error: `${member.displayName} has no Zoho salesperson linked.`,
              loading: false,
            });
            return;
          }
          setSpPreview({
            source: 'spare_incharge',
            title: 'Spare Incharge',
            salespersonId: resolved.salespersonId,
            salespersonName: resolved.salespersonName,
            staffName: resolved.staffName || member.displayName,
            hint: 'Spare sales orders go to Spare Incharge.',
            error: null,
            loading: false,
          });
          return;
        }

        // product — super admin: default to their Zoho salesperson, allow change
        if (fullSA) {
          if (!selectedDealer) {
            if (cancelled) return;
            setSpPreview({
              source: 'pick',
              title: 'Select salesperson',
              salespersonId: null,
              salespersonName: null,
              staffName: user?.displayName ?? null,
              hint: 'Select a dealer first.',
              error: 'Select a dealer first.',
              loading: false,
            });
            setSalespersonId('');
            return;
          }

          // Prefer creator’s linked Zoho SP that is still visible in portal (not hidden).
          let visibleRows: ZohoSalespersonOption[] = [];
          try {
            visibleRows = await listZohoSalespersons({ includeHidden: false });
          } catch {
            visibleRows = [];
          }
          const visibleIds = new Set(visibleRows.map(row => row.id));
          const ownLinks = normalizeZohoSalespersonLinks({
            zohoSalespersonLinks: user?.zohoSalespersonLinks,
            zohoSalespersonIds: user?.zohoSalespersonIds,
            zohoSalespersonId: user?.zohoSalespersonId,
            zohoSalespersonName: user?.zohoSalespersonName,
          }).filter(link => visibleIds.has(link.id) || visibleIds.size === 0);
          const own = ownLinks[0]
            ? { salespersonId: ownLinks[0].id, salespersonName: ownLinks[0].name }
            : null;

          let defaultId = own?.salespersonId ?? '';
          let defaultName = own?.salespersonName ?? null;
          let hint = own
            ? 'Defaults to your linked Zoho salesperson — change below if needed.'
            : 'No Zoho salesperson on your account — pick one below (or link one in Dealers → Salespersons).';

          if (!defaultId) {
            const kamUid = selectedDealer.assignedStaffUid?.trim() || '';
            if (kamUid) {
              const kam = await loadStaffSalesperson(kamUid);
              if (kam && (visibleIds.size === 0 || visibleIds.has(kam.salespersonId))) {
                defaultId = kam.salespersonId;
                defaultName = kam.salespersonName;
                hint = `Defaults to dealer KAM (${kam.staffName || selectedDealer.assignedStaffName || 'staff'}) — change below if needed.`;
              }
            }
          }

          if (cancelled) return;
          setSpPreview({
            source: 'pick',
            title: 'Select salesperson',
            salespersonId: defaultId || null,
            salespersonName: defaultName,
            staffName: user?.displayName ?? null,
            hint,
            error: null,
            loading: false,
          });
          setSalespersonId(defaultId);
          return;
        }

        const own = ownSalespersonFromUser(user);
        if (cancelled) return;
        if (!own) {
          setSpPreview({
            source: 'self',
            title: 'Your salesperson',
            salespersonId: null,
            salespersonName: null,
            staffName: user?.displayName ?? null,
            hint: null,
            error: 'Link a Zoho salesperson to your staff account before creating product orders.',
            loading: false,
          });
          return;
        }
        setSpPreview({
          source: 'self',
          title: 'Your salesperson',
          salespersonId: own.salespersonId,
          salespersonName: own.salespersonName,
          staffName: user?.displayName ?? null,
          hint: 'Product sales order will use your linked Zoho salesperson.',
          error: null,
          loading: false,
        });
      } catch (err) {
        if (cancelled) return;
        setSpPreview({
          source: segment === 'software' ? 'cloud' : segment === 'spare' ? 'spare_incharge' : 'self',
          title: 'Salesperson',
          salespersonId: null,
          salespersonName: null,
          staffName: null,
          hint: null,
          error: err instanceof Error ? err.message : 'Could not resolve salesperson.',
          loading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSegment, selectedDealer, fullSA, user]);

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

  const loadAddresses = useCallback(async (customerId: string, dealerHint?: ZohoDealer | null) => {
    setAddressesLoading(true);
    setAddressError('');
    setShipping(null);
    const cachedDealer = dealerHint
      ?? dealers.find(dealer => dealer.id === customerId)
      ?? null;
    try {
      const next = await listCustomerShippingAddresses(customerId);
      setAddresses(next);
    } catch (err) {
      const fallback = addressesFromDealerCache(cachedDealer);
      if (fallback.length) {
        setAddresses(fallback);
        setAddressError('');
      } else {
        setAddresses([]);
        setAddressError(err instanceof Error ? err.message : 'Could not load addresses.');
      }
    } finally {
      setAddressesLoading(false);
    }
  }, [dealers]);

  const selectDealer = (dealer: ZohoDealer) => {
    setSelectedDealer(toSelectedDealer(dealer));
    setDealerQuery('');
    setError('');
    void loadAddresses(dealer.id, dealer);
  };

  const canSubmit = Boolean(
    lines.length
    && selectedDealer
    && shipping
    && salespersonReady,
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

  const goToSegmentStep = useCallback(async () => {
    if (!showSegmentStep || step === 'orderType') return;
    setError('');
    if (!(lines.length > 0 || freightLines.length > 0)) {
      setStep('orderType');
      return;
    }
    const ok = await confirm({
      title: 'Change order type?',
      message:
        'Your cart has items for the current order type. Changing order type will clear the cart and freight lines. Continue?',
      confirmLabel: 'Clear cart & change',
      cancelLabel: 'Stay here',
      destructive: true,
    });
    if (!ok) return;
    clearCart();
    setRateOverrides({});
    setFreightLines([]);
    setFreightSku(null);
    setFreightRateInput('');
    setStep('orderType');
  }, [showSegmentStep, step, lines.length, freightLines.length, confirm, clearCart]);

  const goBack = useCallback(() => {
    setError('');
    if (step === 'preview') {
      setStep('catalog');
      return;
    }
    if (step === 'catalog') {
      setStep('dealer');
      return;
    }
    if (step === 'dealer' && showSegmentStep) {
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
      setFreightSku(null);
      setFreightRateInput('');
    }
    setError('');
    setStep('dealer');
  };

  const goToCatalog = () => {
    if (!selectedSegment) {
      setError('Select an order type first.');
      return;
    }
    if (!selectedDealer) {
      setError('Select a dealer.');
      return;
    }
    if (!shipping) {
      setError('Select a shipping address.');
      return;
    }
    if (!salespersonReady) {
      setError(spPreview.error || 'Resolve salesperson before continuing.');
      return;
    }
    setError('');
    setStep('catalog');
  };

  const goToPreview = () => {
    if (!dealerReady || !salespersonReady) {
      setError('Select dealer, shipping address, and salesperson first.');
      setStep('dealer');
      return;
    }
    if (!lines.length) {
      setError('Add at least one item from the catalog.');
      return;
    }
    setError('');
    setStep('preview');
  };

  const onProgressStepClick = (target: WizardStep) => {
    if (target === step) return;
    if (target === 'orderType') {
      void goToSegmentStep();
      return;
    }
    if (target === 'dealer') {
      if (step === 'orderType' && !selectedSegment) return;
      setError('');
      setStep('dealer');
      return;
    }
    if (target === 'catalog') {
      if (!dealerReady || !salespersonReady || !selectedSegment) return;
      setError('');
      setStep('catalog');
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
    if (!salespersonReady) {
      setError(spPreview.error || 'Salesperson is not resolved for this order type.');
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
      setFreightSku(null);
      setFreightRateInput('');
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

  const orderTypeOptions = ORDER_TYPE_OPTIONS.filter(option => (
    allowedSegments.includes(option.id)
  ));

  return (
    <div className={`page-content fade-in staff-create-so-page staff-create-so-page--${step}`}>
      <nav className="staff-create-so-page__stepper" aria-label="Create sales order progress">
        {steps.map((id, index) => {
          const label = id === 'orderType'
            ? 'Order Type'
            : id === 'dealer'
              ? 'Dealer Details'
              : id === 'catalog'
                ? 'Items'
                : 'Review & Confirm';
          const clickable = id === 'orderType'
            ? showSegmentStep && step !== 'orderType'
            : id === 'dealer'
              ? step !== 'dealer' && (step !== 'orderType' || Boolean(selectedSegment))
              : id === 'catalog'
                ? dealerReady && salespersonReady && Boolean(selectedSegment)
                  && (step === 'preview' || step === 'dealer')
                : id === 'preview' && dealerReady && salespersonReady
                  && step === 'catalog' && lines.length > 0;
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

      {step === 'orderType' ? (
        <section className="staff-create-so-page__order-type-stage">
          <div className="staff-create-so-page__order-type-panel">
            <header className="staff-create-so-page__order-type-head">
              <span className="staff-create-so-page__order-type-head-icon" aria-hidden>
                <ClipboardList size={22} />
              </span>
              <div>
                <h2>Choose Order Type</h2>
                <p>
                  Each sales order must belong to one type. Select the category that matches your
                  requirement.
                </p>
              </div>
            </header>

            <div className="staff-create-so-page__order-type-list" role="list">
              {orderTypeOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={`staff-create-so-page__order-type-card staff-create-so-page__order-type-card--${option.tone}`}
                  onClick={() => selectSegmentAndContinue(option.id)}
                >
                  <span className="staff-create-so-page__order-type-icon" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="staff-create-so-page__order-type-copy">
                    <strong>{option.title}</strong>
                    <span className="staff-create-so-page__order-type-subtitle">{option.subtitle}</span>
                    <span className="staff-create-so-page__order-type-desc">{option.description}</span>
                  </span>
                  <ChevronRight
                    size={20}
                    className="staff-create-so-page__order-type-chevron"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </div>

          <ul className="staff-create-so-page__order-type-trust" aria-label="Ordering benefits">
            {ORDER_TYPE_TRUST_ITEMS.map(item => (
              <li key={item.title}>
                <span className="staff-create-so-page__order-type-trust-icon" aria-hidden>
                  {item.icon}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <span>{item.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {step === 'dealer' ? (
        <>
          <section className="staff-create-so-page__dealer-stage">
            <header className="staff-create-so-page__dealer-hero">
              <span className="staff-create-so-page__dealer-hero-icon" aria-hidden>
                <Store size={22} />
              </span>
              <div className="staff-create-so-page__dealer-hero-copy">
                <h2>Select Dealer &amp; Shipping Address</h2>
                <p>
                  Choose the dealer and shipping address to continue with the catalog.
                </p>
              </div>
              <span className="staff-create-so-page__dealer-hero-art" aria-hidden>
                <MapPin size={28} />
                <Package size={24} />
              </span>
            </header>

            <div className="staff-create-so-page__dealer-panel panel glass">
              <h3 className="staff-create-so-page__dealer-panel-title">Dealer details</h3>
              <p className="text-muted text-sm staff-create-so-page__dealer-panel-hint">
                Pick the dealer and shipping address before browsing the catalog.
              </p>
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
                <div className="catalog-search staff-create-so-page__dealer-search-input">
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
                      const location = dealerLocationLabel(dealer);
                      const phone = snapshot.mobile !== '—' ? snapshot.mobile : null;
                      const meta = [snapshot.code, phone].filter(Boolean).join(' • ');
                      return (
                        <li key={dealer.id}>
                          <button
                            type="button"
                            className="staff-create-so-page__dealer-option"
                            onClick={() => selectDealer(dealer)}
                          >
                            <span className="staff-create-so-page__dealer-option-main">
                              <strong>{snapshot.name}</strong>
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
                ) : dealerQuery.trim().length >= 2 ? (
                  <p className="text-muted text-sm">
                    {dealersLoading
                      ? 'Still loading dealers…'
                      : `No dealers match “${dealerQuery.trim()}”.`}
                  </p>
                ) : (
                  <p className="text-muted text-sm">
                    Type at least 2 characters to search
                    {dealersLoading ? ' (loading dealer list…)' : '.'}
                  </p>
                )}
                <p className="staff-create-so-page__dealer-loaded">
                  <Users size={14} aria-hidden />
                  <span>
                    {dealersLoading && dealers.length === 0
                      ? 'Loading dealers…'
                      : `${dealers.length.toLocaleString('en-IN')} dealers loaded`}
                  </span>
                </p>
              </div>
            )}
            </div>

          {selectedDealer ? (
            <div className="staff-create-so-page__dealer-panel panel glass">
              <ShippingAddressPicker
                addresses={addresses}
                loading={addressesLoading}
                error={addressError}
                value={shipping}
                onChange={setShipping}
                onRefresh={() => void loadAddresses(selectedDealer.id)}
              />
            </div>
          ) : null}

          <div className="staff-create-so-page__dealer-panel panel glass staff-create-so-page__salesperson-panel">
            <header className="staff-create-so-page__salesperson-head">
              <span className="staff-create-so-page__salesperson-icon" aria-hidden>
                <UserCircle size={22} />
              </span>
              <div>
                <h2>Salesperson for this SO</h2>
                <p className="text-muted text-sm">Assign a salesperson to this order</p>
              </div>
            </header>
            {spPreview.loading ? (
              <p className="text-muted text-sm">Resolving salesperson…</p>
            ) : (
              <>
                <p className="text-muted text-sm staff-create-so-page__sp-title">
                  {spPreview.title}
                  {selectedSegment ? ` · ${segmentLabel(selectedSegment)}` : ''}
                </p>
                {spPreview.hint ? (
                  <p className="text-muted text-sm">{spPreview.hint}</p>
                ) : null}
                {spPreview.error ? (
                  <p className="staff-create-so-page__sp-error" role="alert">{spPreview.error}</p>
                ) : null}
                {spPreview.source !== 'pick' && (spPreview.salespersonId || spPreview.salespersonName) ? (
                  <DocumentKamStrip
                    salespersonId={spPreview.salespersonId}
                    salespersonName={spPreview.salespersonName || spPreview.staffName}
                    showMissing
                    missingHint={spPreview.error}
                  />
                ) : null}
                {spPreview.source === 'pick' && selectedDealer ? (
                  <label className="staff-create-so-page__salesperson">
                    <span>Zoho salesperson</span>
                    <ThemeSelect
                      id="staff-so-salesperson"
                      value={salespersonId}
                      disabled={salespersonsLoading}
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
                  </label>
                ) : null}
              </>
            )}
          </div>
          </section>

          <div className="staff-create-so-page__dealer-continue staff-create-so-page__dealer-continue--sticky">
            <button
              type="button"
              className="btn btn-primary staff-create-so-page__dealer-continue-btn"
              disabled={!dealerReady || !salespersonReady}
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
                emptyTitle="No items for this order type"
                emptyHint="Try another order type or sync the catalog."
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
              Review & confirm
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

            {stampableWithoutStamping.length > 0 && (
              <div className="orders-page__stamp-reminder staff-create-so-page__stamp-reminder" role="status">
                <p>
                  {stampableWithoutStamping.length === 1
                    ? '1 item can have stamping added.'
                    : `${stampableWithoutStamping.length} items can have stamping added.`}
                  {' '}
                  Use the stamping control on the line, or <strong>+ Add with stamping</strong> for a separate stamped line.
                </p>
              </div>
            )}

            {lines.length === 0 ? (
              <div className="staff-create-so-page__cart-empty">
                <Package size={36} aria-hidden />
                <p>Cart is empty</p>
              </div>
            ) : (
              <ul className="staff-create-so-page__cart-list">
                {lines.map(item => {
                  const catalogProduct = catalogById[item.productId];
                  const canEditStamp = catalogProduct
                    ? productHasLinkedGatc(catalogProduct)
                    : Boolean(item.gatcStampingPriceId);
                  const hasStamping = Boolean(item.gatcStampingPriceId);
                  const usedGatcIds = lines
                    .filter(other => other.productId === item.productId && other.gatcStampingPriceId)
                    .map(other => String(other.gatcStampingPriceId));
                  const hasUnstampedSibling = lines.some(
                    other => other.productId === item.productId && !other.gatcStampingPriceId,
                  );

                  return (
                    <StaffCartLine
                      key={item.cartLineId}
                      item={item}
                      catalogProduct={catalogProduct}
                      canEditStamp={canEditStamp}
                      hasStamping={hasStamping}
                      usedGatcIds={usedGatcIds}
                      hasUnstampedSibling={hasUnstampedSibling}
                      disabled={saving}
                      onQuantity={qty => setQuantity(item.cartLineId, qty)}
                      onRate={rate => setLineBaseRate(item.cartLineId, rate)}
                      onStamping={choice => applyLineStamping(item.cartLineId, choice)}
                      onAddSibling={choice => {
                        if (!catalogProduct) return;
                        if (!choice.withStamping) {
                          addItem(catalogProduct, {
                            quantity: 1,
                            insertAfterCartLineId: item.cartLineId,
                          });
                          return;
                        }
                        addItem(catalogProduct, {
                          quantity: 1,
                          insertAfterCartLineId: item.cartLineId,
                          gatcStampingPriceId: choice.gatcStampingPriceId,
                          gatcFeePerUnit: choice.gatcFeePerUnit,
                          gatcStampingRange: choice.gatcStampingRange,
                        });
                      }}
                      onRemove={() => {
                        removeItem(item.cartLineId);
                        setRateOverrides(prev => {
                          const next = { ...prev };
                          delete next[item.cartLineId];
                          return next;
                        });
                      }}
                    />
                  );
                })}
              </ul>
            )}

            {segmentPreview.length > 1 ? (
              <p className="text-muted text-sm staff-create-so-page__order-type-hint">
                This will create {segmentPreview.length} draft sales orders:
                {' '}
                {segmentPreview.map(segmentLabel).join(', ')}.
              </p>
            ) : null}
          </section>

          {freightAllowed ? (
          <section className="panel glass staff-create-so-page__section">
            <h2>Freight</h2>
            <FreightPartnerPicker
              selectedSku={freightSku}
              amount={freightRateInput}
              disabled={saving}
              onSelect={selectFreightPartner}
              onAmountChange={onFreightAmountChange}
              onClear={clearFreight}
            />
          </section>
          ) : null}

          <section className="panel glass staff-create-so-page__section">
            <div className="staff-create-so-page__section-head">
              <h2>Dealer & shipping</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={saving}
                onClick={() => {
                  setError('');
                  setStep('dealer');
                }}
              >
                Change
              </button>
            </div>
            {selectedDealer ? (
              <div className="staff-create-so-page__dealer-summary">
                <div>
                  <strong>{selectedDealer.label}</strong>
                  {selectedDealer.contactPerson ? (
                    <p className="text-muted text-sm">{selectedDealer.contactPerson}</p>
                  ) : null}
                  {selectedDealer.mobile ? (
                    <p className="text-muted text-sm">{selectedDealer.mobile}</p>
                  ) : null}
                </div>
                <p className="text-muted text-sm staff-create-so-page__ship-summary">
                  {formatShippingSummary(shipping, addresses)}
                </p>
              </div>
            ) : (
              <p className="text-muted text-sm">No dealer selected.</p>
            )}
            <div className="staff-create-so-page__sp-summary">
              <span className="text-muted text-sm">{spPreview.title}</span>
              <DocumentKamStrip
                salespersonId={
                  needsSalespersonPicker
                    ? salespersonId
                    : spPreview.salespersonId
                }
                salespersonName={
                  needsSalespersonPicker
                    ? (salespersons.find(row => row.id === salespersonId)?.name ?? null)
                    : (spPreview.salespersonName || spPreview.staffName)
                }
                showMissing
              />
            </div>
          </section>

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
  catalogProduct,
  canEditStamp,
  hasStamping,
  usedGatcIds,
  hasUnstampedSibling,
  disabled,
  onQuantity,
  onRate,
  onStamping,
  onAddSibling,
  onRemove,
}: {
  item: CartItem & { catalogRate: number; rate: number };
  catalogProduct?: CatalogProduct;
  canEditStamp: boolean;
  hasStamping: boolean;
  usedGatcIds: string[];
  hasUnstampedSibling: boolean;
  disabled?: boolean;
  onQuantity: (qty: number) => void;
  onRate: (rate: number) => void;
  onStamping: (choice: GatcStampingChoice) => void;
  onAddSibling: (choice: GatcStampingChoice) => void;
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
          <span className="staff-create-so-page__stamp-breakdown text-muted text-sm">
            + {item.gatcFeePerUnit.toLocaleString('en-IN')} stamping
            {item.gatcStampingRange ? ` (${item.gatcStampingRange})` : ''}
          </span>
        ) : canEditStamp ? null : (
          <span className="staff-create-so-page__stamp-breakdown text-muted text-sm">
            Without stamping
          </span>
        )}
        {canEditStamp && catalogProduct ? (
          <GatcStampingInlineControl
            product={catalogProduct}
            valueId={item.gatcStampingPriceId}
            hasStamping={hasStamping}
            usedGatcIds={usedGatcIds}
            hasUnstampedSibling={hasUnstampedSibling}
            disabled={disabled}
            onChange={onStamping}
            onAddSibling={onAddSibling}
          />
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
