import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  UserCircle,
  Users,
} from 'lucide-react';
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
import { DecimalAmountInput } from '../../components/DecimalAmountInput';
import { QuantityStepper } from '../../components/QuantityStepper';
import { OrderFreightPanel } from '../../components/orders/OrderFreightPanel';
import { ShippingAddressPicker } from '../../components/orders/ShippingAddressPicker';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { useBlueDartPincode } from '../../hooks/useBlueDartPincode';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import {
  cartLinesForFreightEstimate,
  estimateStCourierCartFreight,
  type StCourierCartFreightEstimate,
} from '../../lib/stCourierCartFreight';
import { inferStCourierZone } from '../../lib/stCourierZone';
import type { LogisticsCourierRates } from '../../types/logistics-courier-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../types/logistics-delivery-rules';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { useAuth } from '../../context/AuthContext';
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
  summarizeSegmentSiteBuckets,
  type InventorySite,
  type OrderSegment,
} from '../../lib/salesOrderSegments';
import {
  CLOUD_CHARGES_SALESPERSON_ID,
  CLOUD_CHARGES_SALESPERSON_NAME,
} from '../../constants/cloudChargesSalesperson';
import { hasStaffPermission, isFullSuperAdmin } from '../../lib/staffAccess';
import { createStaffSalesOrder } from '../../lib/salesOrderWorkflow';
import {
  addressesFromDealerCache,
  listCustomerShippingAddresses,
  resolveShippingDestination,
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

type WizardStep = 'dealer' | 'catalog' | 'preview';

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
  /** Mixed cart like dealer — submit splits by segment×site; spare → Spare Incharge SP. */
  const [step, setStep] = useState<WizardStep>('dealer');

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
  const [segmentSpMap, setSegmentSpMap] = useState<Partial<Record<OrderSegment, SalespersonPreview>>>({});
  const [spLoading, setSpLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdOrders, setCreatedOrders] = useState<SegmentSalesOrderResult[] | null>(null);
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [spareFreightMinimumInr, setSpareFreightMinimumInr] = useState(0);
  const [courierBySite, setCourierBySite] = useState<Partial<Record<InventorySite, LogisticsPartnerId>>>({});

  const activeSegments = allowedSegments;

  const freightAllowed = activeSegments.some(segment => segmentAllowsFreight(segment));

  const steps = useMemo((): WizardStep[] => (
    ['dealer', 'catalog', 'preview']
  ), []);

  const stepIndex = Math.max(0, steps.indexOf(step));

  const dealerReady = Boolean(selectedDealer && shipping);

  const fullSA = isFullSuperAdmin(user);
  /** Super admins pick salesperson for product buckets when product orders are allowed. */
  const needsSalespersonPicker = fullSA && activeSegments.includes('product');

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
    if (!freightAllowed) return;
    let cancelled = false;
    void Promise.all([loadLogisticsCourierRates(), loadLogisticsSettings()])
      .then(([rates, settings]) => {
        if (cancelled) return;
        setCourierRates(rates);
        setDeliveryRules(settings.deliveryRules);
        setSpareFreightMinimumInr(settings.spareFreightMinimumInr);
      })
      .catch(() => { /* freight preview optional */ });
    return () => { cancelled = true; };
  }, [freightAllowed]);

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

  const segmentsRequiringSp = useMemo((): OrderSegment[] => {
    const inCart = summarizeSegments(lines.map(line => ({
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      productId: line.productId,
      sku: line.sku,
    })));
    if (inCart.length > 0) {
      return inCart.filter(segment => activeSegments.includes(segment));
    }
    // Before cart: don't block product shopping when Spare Incharge isn't configured yet.
    if (activeSegments.includes('product')) return ['product'];
    return [...activeSegments];
  }, [lines, activeSegments]);

  const segmentSpReady = (segment: OrderSegment): boolean => {
    if (segment === 'product' && needsSalespersonPicker) {
      return Boolean(salespersonId.trim());
    }
    const preview = segmentSpMap[segment];
    return Boolean(preview?.salespersonId) && !preview?.error;
  };

  const salespersonReady = !spLoading
    && segmentsRequiringSp.every(segmentSpReady);

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

  const submitLines = useMemo(() => (
    lines.map(line => {
      const catalog = catalogById[line.productId];
      return {
        productId: line.productId,
        quantity: line.quantity,
        rate: line.catalogRate,
        gatcStampingPriceId: line.gatcStampingPriceId ?? null,
        name: line.name,
        sku: line.sku,
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        warehouses: catalog?.warehouses ?? null,
      };
    })
  ), [lines, catalogById]);

  const shippingDestination = useMemo(
    () => resolveShippingDestination(shipping, addresses),
    [shipping, addresses],
  );
  const blueDartPin = useBlueDartPincode(shippingDestination?.zip);
  const inferredFreightZone = useMemo(
    () => inferStCourierZone(shippingDestination),
    [shippingDestination],
  );

  const freightEstimate = useMemo((): StCourierCartFreightEstimate | null => {
    if (!freightAllowed || !courierRates || !deliveryRules || lines.length === 0) return null;
    if (!shippingDestination || !inferredFreightZone) return null;
    return estimateStCourierCartFreight({
      lines: cartLinesForFreightEstimate(lines, catalogById),
      destination: shippingDestination,
      rates: courierRates,
      deliveryRules,
      spareFreightMinimumInr,
      courierBySite,
      blueDartPin,
    });
  }, [
    freightAllowed,
    courierRates,
    deliveryRules,
    spareFreightMinimumInr,
    lines,
    shippingDestination,
    catalogById,
    courierBySite,
    inferredFreightZone,
    blueDartPin,
  ]);

  const segmentPreview = useMemo(() => summarizeSegmentSiteBuckets(submitLines), [submitLines]);

  const freightSubtotal = useMemo(
    () => (freightAllowed && freightEstimate?.usable ? freightEstimate.totalInr : 0),
    [freightAllowed, freightEstimate],
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
    if (!activeSegments.length) {
      setSegmentSpMap({});
      setSpLoading(false);
      return;
    }

    setSpLoading(true);

    void (async () => {
      const next: Partial<Record<OrderSegment, SalespersonPreview>> = {};
      try {
        if (activeSegments.includes('software')) {
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
          next.software = {
            source: 'cloud',
            title: 'Cloud Charges',
            salespersonId: match?.id || CLOUD_CHARGES_SALESPERSON_ID,
            salespersonName: match?.name || CLOUD_CHARGES_SALESPERSON_NAME,
            staffName: CLOUD_CHARGES_SALESPERSON_NAME,
            hint: 'Software draft SOs use Cloud Charges.',
            error: null,
            loading: false,
          };
        }

        if (activeSegments.includes('spare')) {
          const settings = await loadSpareInchargeSettings();
          const member = settings.members[0];
          if (!member) {
            next.spare = {
              source: 'spare_incharge',
              title: 'Spare Incharge',
              salespersonId: null,
              salespersonName: null,
              staffName: null,
              hint: null,
              error: 'Spare Incharge is not configured. Assign one in HR → Spare Incharge.',
              loading: false,
            };
          } else {
            const resolved = await loadStaffSalesperson(member.uid);
            if (!resolved) {
              next.spare = {
                source: 'spare_incharge',
                title: 'Spare Incharge',
                salespersonId: null,
                salespersonName: null,
                staffName: member.displayName,
                hint: null,
                error: `${member.displayName} has no Zoho salesperson linked.`,
                loading: false,
              };
            } else {
              next.spare = {
                source: 'spare_incharge',
                title: 'Spare Incharge',
                salespersonId: resolved.salespersonId,
                salespersonName: resolved.salespersonName,
                staffName: resolved.staffName || member.displayName,
                hint: 'Spare draft SOs use Spare Incharge.',
                error: null,
                loading: false,
              };
            }
          }
        }

        if (activeSegments.includes('product')) {
          if (fullSA) {
            if (!selectedDealer) {
              next.product = {
                source: 'pick',
                title: 'Product salesperson',
                salespersonId: null,
                salespersonName: null,
                staffName: user?.displayName ?? null,
                hint: 'Select a dealer first.',
                error: 'Select a dealer first.',
                loading: false,
              };
              setSalespersonId('');
            } else {
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
                ? 'Product draft SOs default to your linked Zoho salesperson — change below if needed.'
                : 'No Zoho salesperson on your account — pick one below (or link one in Dealers → Salespersons).';

              if (!defaultId) {
                const kamUid = selectedDealer.assignedStaffUid?.trim() || '';
                if (kamUid) {
                  const kam = await loadStaffSalesperson(kamUid);
                  if (kam && (visibleIds.size === 0 || visibleIds.has(kam.salespersonId))) {
                    defaultId = kam.salespersonId;
                    defaultName = kam.salespersonName;
                    hint = `Product draft SOs default to dealer KAM (${kam.staffName || selectedDealer.assignedStaffName || 'staff'}) — change below if needed.`;
                  }
                }
              }

              next.product = {
                source: 'pick',
                title: 'Product salesperson',
                salespersonId: defaultId || null,
                salespersonName: defaultName,
                staffName: user?.displayName ?? null,
                hint,
                error: null,
                loading: false,
              };
              setSalespersonId(defaultId);
            }
          } else {
            const own = ownSalespersonFromUser(user);
            if (!own) {
              next.product = {
                source: 'self',
                title: 'Your salesperson',
                salespersonId: null,
                salespersonName: null,
                staffName: user?.displayName ?? null,
                hint: null,
                error: 'Link a Zoho salesperson to your staff account before creating product orders.',
                loading: false,
              };
            } else {
              next.product = {
                source: 'self',
                title: 'Your salesperson',
                salespersonId: own.salespersonId,
                salespersonName: own.salespersonName,
                staffName: user?.displayName ?? null,
                hint: 'Product draft SOs use your linked Zoho salesperson.',
                error: null,
                loading: false,
              };
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not resolve salesperson.';
        for (const segment of activeSegments) {
          if (next[segment]) continue;
          next[segment] = {
            source: segment === 'software' ? 'cloud' : segment === 'spare' ? 'spare_incharge' : 'self',
            title: 'Salesperson',
            salespersonId: null,
            salespersonName: null,
            staffName: null,
            hint: null,
            error: message,
            loading: false,
          };
        }
      }

      if (cancelled) return;
      setSegmentSpMap(next);
      setSpLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSegments, selectedDealer, fullSA, user]);

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
    navigate(listPath);
  }, [step, navigate, listPath]);

  goBackRef.current = createdOrders?.length
    ? () => navigate(listPath)
    : goBack;

  const goToCatalog = () => {
    if (!selectedDealer) {
      setError('Select a dealer.');
      return;
    }
    if (!shipping) {
      setError('Select a shipping address.');
      return;
    }
    if (!salespersonReady) {
      const firstError = segmentsRequiringSp
        .map(segment => segmentSpMap[segment]?.error)
        .find(Boolean);
      setError(firstError || 'Resolve salesperson before continuing.');
      return;
    }
    setError('');
    setStep('catalog');
  };

  const goToPreview = () => {
    if (!dealerReady) {
      setError('Select dealer and shipping address first.');
      setStep('dealer');
      return;
    }
    if (!lines.length) {
      setError('Add at least one item from the catalog.');
      return;
    }
    const cartSegments = summarizeSegments(lines);
    const missingSp = cartSegments.find(segment => !segmentSpReady(segment));
    if (missingSp) {
      setError(
        segmentSpMap[missingSp]?.error
        || `Salesperson is not resolved for ${segmentLabel(missingSp)}.`,
      );
      setStep('dealer');
      return;
    }
    setError('');
    setStep('preview');
  };

  const onProgressStepClick = (target: WizardStep) => {
    if (target === step) return;
    if (target === 'dealer') {
      setError('');
      setStep('dealer');
      return;
    }
    if (target === 'catalog') {
      if (!dealerReady || !salespersonReady) return;
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
    {
      const cartSegments = summarizeSegments(submitLines);
      const missingSp = cartSegments.find(segment => !segmentSpReady(segment));
      if (missingSp) {
        setError(
          segmentSpMap[missingSp]?.error
          || `Salesperson is not resolved for ${segmentLabel(missingSp)}.`,
        );
        return;
      }
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
        courierBySite: Object.fromEntries(
          (freightEstimate?.sites ?? []).map(site => [site.site, site.partnerId]),
        ),
        ...(inferredFreightZone ? { freightZone: inferredFreightZone } : {}),
        ...(needsSalespersonPicker
          ? { salespersonId: salespersonId.trim() }
          : {}),
      });
      clearCart();
      setRateOverrides({});
      setCourierBySite({});
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

  const cartSegmentLabels = useMemo(
    () => summarizeSegments(submitLines).map(segmentLabel),
    [submitLines],
  );

  return (
    <div className={`page-content fade-in staff-create-so-page staff-create-so-page--${step}`}>
      <nav className="staff-create-so-page__stepper" aria-label="Create sales order progress">
        {steps.map((id, index) => {
          const label = id === 'dealer'
            ? 'Dealer Details'
            : id === 'catalog'
              ? 'Items'
              : 'Review & Confirm';
          const clickable = id === 'dealer'
            ? step !== 'dealer'
            : id === 'catalog'
              ? dealerReady && salespersonReady && (step === 'preview' || step === 'dealer')
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
                allowManage
                customerId={selectedDealer.id}
              />
            </div>
          ) : null}

          <div className="staff-create-so-page__dealer-panel panel glass staff-create-so-page__salesperson-panel">
            <header className="staff-create-so-page__salesperson-head">
              <span className="staff-create-so-page__salesperson-icon" aria-hidden>
                <UserCircle size={22} />
              </span>
              <div>
                <h2>Salespersons by order type</h2>
                <p className="text-muted text-sm">
                  Mixed carts split into separate draft SOs. Spares go to Spare Incharge.
                </p>
              </div>
            </header>
            {spLoading ? (
              <p className="text-muted text-sm">Resolving salesperson…</p>
            ) : (
              <div className="staff-create-so-page__sp-list">
                {activeSegments.map(segment => {
                  const preview = segmentSpMap[segment];
                  if (!preview) return null;
                  return (
                    <div key={segment} className="staff-create-so-page__sp-block">
                      <p className="text-muted text-sm staff-create-so-page__sp-title">
                        {preview.title}
                        {' · '}
                        {segmentLabel(segment)}
                      </p>
                      {preview.hint ? (
                        <p className="text-muted text-sm">{preview.hint}</p>
                      ) : null}
                      {preview.error ? (
                        <p className="staff-create-so-page__sp-error" role="alert">{preview.error}</p>
                      ) : null}
                      {segment === 'product' && needsSalespersonPicker && selectedDealer ? (
                        <label className="staff-create-so-page__salesperson">
                          <span>Zoho salesperson (product SOs)</span>
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
                            aria-label="Product salesperson"
                          />
                        </label>
                      ) : preview.salespersonId || preview.salespersonName ? (
                        <DocumentKamStrip
                          salespersonId={preview.salespersonId}
                          salespersonName={preview.salespersonName || preview.staffName}
                          showMissing
                          missingHint={preview.error}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
                emptyTitle="No catalog items available"
                emptyHint="Sync the catalog or adjust category filters."
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
                {segmentPreview.map(bucket => bucket.label).join(', ')}.
              </p>
            ) : segmentPreview[0] ? (
              <p className="text-muted text-sm staff-create-so-page__order-type-hint">
                Branch: {segmentPreview[0].label}.
              </p>
            ) : null}
          </section>

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
              {(cartSegmentLabels.length
                ? summarizeSegments(submitLines)
                : activeSegments
              ).map(segment => {
                const preview = segmentSpMap[segment];
                if (!preview) return null;
                const isProductPick = segment === 'product' && needsSalespersonPicker;
                return (
                  <div key={segment} className="staff-create-so-page__sp-block">
                    <span className="text-muted text-sm">
                      {preview.title}
                      {' · '}
                      {segmentLabel(segment)}
                    </span>
                    <DocumentKamStrip
                      salespersonId={
                        isProductPick
                          ? salespersonId
                          : preview.salespersonId
                      }
                      salespersonName={
                        isProductPick
                          ? (salespersons.find(row => row.id === salespersonId)?.name ?? null)
                          : (preview.salespersonName || preview.staffName)
                      }
                      showMissing
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {freightAllowed ? (
            <section className="panel glass staff-create-so-page__section">
              <h2>Freight</h2>
              {freightEstimate?.usable ? (
                <>
                  <OrderFreightPanel
                    estimate={freightEstimate}
                    canEditPackage
                    catalogById={catalogById}
                    onCourierChange={(site, partnerId) => {
                      setCourierBySite(prev => ({ ...prev, [site]: partnerId }));
                    }}
                    onPackageInfoChange={(productId, info) => {
                      setCatalogProducts(prev => prev.map(product => (
                        product.id === productId
                          ? { ...product, packageInfo: info }
                          : product
                      )));
                    }}
                  />
                  <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
                    One freight line per draft SO. Amounts are calculated from rate cards and package data.
                  </p>
                </>
              ) : (
                <p className="text-muted text-sm">
                  {shipping
                    ? 'Freight will calculate once items and destination rates are available.'
                    : 'Select a shipping address to see freight and courier options.'}
                </p>
              )}
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
          <DecimalAmountInput
            className="input-field"
            value={item.catalogRate}
            min={0}
            decimals={2}
            disabled={disabled}
            onChange={next => {
              if (next == null) return;
              onRate(next);
            }}
            aria-label={`Base rate for ${item.name}`}
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
