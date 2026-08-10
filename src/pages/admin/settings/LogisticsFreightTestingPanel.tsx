import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  FlaskConical,
  Package,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { DelhiveryQuoteStrip } from '../../../components/logistics/DelhiveryQuoteStrip';
import { OrderFreightPanel } from '../../../components/orders/OrderFreightPanel';
import { ShippingAddressPicker } from '../../../components/orders/ShippingAddressPicker';
import { QuantityStepper } from '../../../components/QuantityStepper';
import { fetchCatalog } from '../../../lib/catalog';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../../lib/dealer-cache';
import { selectedPartnerIsDelhivery } from '../../../lib/delhiveryCartFreight';
import {
  dealerMatchesLogisticsQuery,
  zohoDealerContactPerson,
  zohoDealerDisplayName,
  zohoDealerMobile,
} from '../../../lib/logisticsDealers';
import { loadLogisticsCourierRates } from '../../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../../lib/logisticsSettings';
import {
  cartLinesForFreightEstimate,
  estimateStCourierCartFreight,
  type StCourierCartFreightEstimate,
} from '../../../lib/stCourierCartFreight';
import {
  classifyOrderLineSegment,
  groupLinesBySegmentAndSite,
  inventorySiteLabel,
  resolveLineInventorySite,
  segmentLabel,
  segmentSiteLabel,
  type InventorySite,
} from '../../../lib/salesOrderSegments';
import {
  addressesFromDealerCache,
  listCustomerShippingAddresses,
  resolveShippingDestination,
  type ShippingAddress,
  type ShippingSelection,
} from '../../../lib/shippingAddresses';
import { useBlueDartPincode } from '../../../hooks/useBlueDartPincode';
import { useDelhiveryLiveFreightQuote } from '../../../hooks/useDelhiveryLiveFreightQuote';
import type { StaffLogisticsSite } from '../../../types/staff-logistics';
import { inferStCourierZone } from '../../../lib/stCourierZone';
import type { LogisticsPartnerId } from '../../../constants/logisticsPartners';
import type { LogisticsCourierRates } from '../../../types/logistics-courier-rates';
import type { LogisticsDeliveryRulesMatrix } from '../../../types/logistics-delivery-rules';
import type { LogisticsPartnerStatuses } from '../../../types/logistics-partner-status';
import type { CatalogProduct } from '../../../types/catalog';
import type { ZohoDealer } from '../../../types/dealers';
import { ST_COURIER_ZONE_LABELS } from '../../../types/logistics-courier-rates';

type TestLine = {
  key: string;
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  categoryId: string | null;
  categoryName: string | null;
  warehouses?: CatalogProduct['warehouses'];
  packageInfo?: CatalogProduct['packageInfo'];
};

type WizardStep = 'dealer' | 'address' | 'products' | 'results';

const STEPS: { id: WizardStep; label: string; hint: string }[] = [
  { id: 'dealer', label: 'Dealer', hint: 'Pick the customer' },
  { id: 'address', label: 'Address', hint: 'Ship-to for zone & partners' },
  { id: 'products', label: 'Products', hint: 'Add lines to quote' },
  { id: 'results', label: 'Split & freight', hint: 'SO buckets + partner ₹' },
];

function productSearchHaystack(product: CatalogProduct): string {
  return [
    product.name,
    product.sku,
    product.categoryName,
    product.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

export const LogisticsFreightTestingPanel: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('dealer');

  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(true);
  const [dealerQuery, setDealerQuery] = useState('');
  const [selectedDealer, setSelectedDealer] = useState<ZohoDealer | null>(null);

  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [shipping, setShipping] = useState<ShippingSelection | null>(null);

  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [lines, setLines] = useState<TestLine[]>([]);
  const [catalogById, setCatalogById] = useState<Record<string, CatalogProduct>>({});

  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [deliveryRules, setDeliveryRules] = useState<LogisticsDeliveryRulesMatrix | null>(null);
  const [partnerStatuses, setPartnerStatuses] = useState<LogisticsPartnerStatuses | null>(null);
  const [ratesError, setRatesError] = useState('');
  const [courierBySite, setCourierBySite] = useState<Partial<Record<InventorySite, LogisticsPartnerId>>>({});
  const [manualFreightAmount, setManualFreightAmount] = useState<number | null>(null);
  const [fromAddresses, setFromAddresses] = useState<Partial<Record<StaffLogisticsSite, string>>>({});

  const shippingDestination = useMemo(
    () => resolveShippingDestination(shipping, addresses),
    [shipping, addresses],
  );
  const blueDartPin = useBlueDartPincode(shippingDestination?.zip);
  const inferredZone = useMemo(
    () => inferStCourierZone(shippingDestination),
    [shippingDestination],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedDealers();
    if (cached?.length) {
      setDealers(cached);
      setDealersLoading(false);
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
      .catch(() => {
        if (!cancelled && !peekCachedDealers()?.length) {
          setDealers([]);
          setDealersLoading(false);
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadLogisticsCourierRates(), loadLogisticsSettings()])
      .then(([rates, settings]) => {
        if (cancelled) return;
        setCourierRates(rates);
        setDeliveryRules(settings.deliveryRules);
        setPartnerStatuses(settings.partnerStatuses);
        setFromAddresses(settings.fromAddresses || {});
        setRatesError('');
      })
      .catch(err => {
        if (!cancelled) {
          setRatesError(err instanceof Error ? err.message : 'Could not load freight rates.');
        }
      });
    return () => { cancelled = true; };
  }, []);

  const loadAddresses = useCallback(async (dealer: ZohoDealer) => {
    setAddressesLoading(true);
    setAddressError('');
    setShipping(null);
    try {
      const next = await listCustomerShippingAddresses(dealer.id);
      setAddresses(next);
    } catch (err) {
      const fallback = addressesFromDealerCache(dealer);
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
  }, []);

  const loadCatalog = useCallback(async () => {
    if (catalog.length > 0 || catalogLoading) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const res = await fetchCatalog();
      setCatalog(res.items);
      const byId: Record<string, CatalogProduct> = {};
      for (const product of res.items) byId[product.id] = product;
      setCatalogById(byId);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : 'Could not load catalog.');
    } finally {
      setCatalogLoading(false);
    }
  }, [catalog.length, catalogLoading]);

  useEffect(() => {
    if (step === 'products' || step === 'results') {
      void loadCatalog();
    }
  }, [step, loadCatalog]);

  const filteredDealers = useMemo(() => {
    const q = dealerQuery.trim();
    if (q.length < 2) return [];
    return dealers
      .filter(dealer => dealerMatchesLogisticsQuery(dealer, q))
      .slice(0, 40);
  }, [dealers, dealerQuery]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalog
      .filter(product => productSearchHaystack(product).includes(q))
      .slice(0, 30);
  }, [catalog, productQuery]);

  const selectDealer = (dealer: ZohoDealer) => {
    setSelectedDealer(dealer);
    setDealerQuery(zohoDealerDisplayName(dealer));
    void loadAddresses(dealer);
    setStep('address');
  };

  const clearDealer = () => {
    setSelectedDealer(null);
    setDealerQuery('');
    setAddresses([]);
    setShipping(null);
    setAddressError('');
    setStep('dealer');
  };

  const addProduct = (product: CatalogProduct) => {
    setLines(prev => {
      const existing = prev.find(line => line.productId === product.id);
      if (existing) {
        return prev.map(line => (
          line.productId === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line
        ));
      }
      return [
        ...prev,
        {
          key: `${product.id}-${Date.now()}`,
          productId: product.id,
          name: product.name,
          sku: product.sku?.trim() || null,
          quantity: 1,
          categoryId: product.categoryId ?? null,
          categoryName: product.categoryName ?? null,
          warehouses: product.warehouses,
          packageInfo: product.packageInfo,
        },
      ];
    });
    setCatalogById(prev => ({ ...prev, [product.id]: product }));
  };

  const updateQty = (key: string, quantity: number) => {
    setLines(prev => prev
      .map(line => (line.key === key ? { ...line, quantity } : line))
      .filter(line => line.quantity > 0));
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.filter(line => line.key !== key));
  };

  const splitBuckets = useMemo(
    () => groupLinesBySegmentAndSite(lines).filter(bucket => bucket.lines.length > 0),
    [lines],
  );

  const goodsSubtotal = useMemo(
    () => lines.reduce((sum, line) => {
      const rate = Number(catalogById[line.productId]?.rate) || 0;
      return sum + rate * line.quantity;
    }, 0),
    [lines, catalogById],
  );

  const freightEstimateBase = useMemo((): StCourierCartFreightEstimate | null => {
    if (!courierRates || !deliveryRules || !partnerStatuses || lines.length === 0) return null;
    if (!shippingDestination || !inferredZone) return null;
    return estimateStCourierCartFreight({
      lines: cartLinesForFreightEstimate(lines, catalogById),
      destination: shippingDestination,
      rates: courierRates,
      deliveryRules,
      partnerStatuses,
      courierBySite,
      blueDartPin,
      invoiceValueInr: goodsSubtotal,
    });
  }, [
    courierRates,
    deliveryRules,
    partnerStatuses,
    lines,
    catalogById,
    shippingDestination,
    courierBySite,
    inferredZone,
    blueDartPin,
    goodsSubtotal,
  ]);

  const delhiveryLive = useDelhiveryLiveFreightQuote({
    estimate: freightEstimateBase,
    originAddress: fromAddresses.cochin || fromAddresses.head_office || '',
    destinationPin: shippingDestination?.zip,
    invoiceValueInr: goodsSubtotal,
    freightBillingMode: 'btc',
  });

  const freightEstimate = delhiveryLive.estimateWithLive ?? freightEstimateBase;

  useEffect(() => {
    if (!selectedPartnerIsDelhivery(freightEstimate)) return;
    if (delhiveryLive.preTaxInr == null) return;
    const next = Math.ceil(delhiveryLive.preTaxInr);
    setManualFreightAmount(prev => (prev === next ? prev : next));
  }, [delhiveryLive.preTaxInr, freightEstimate]);

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const canGoAddress = Boolean(selectedDealer);
  const canGoProducts = Boolean(selectedDealer && shipping && shippingDestination);
  const canGoResults = canGoProducts && lines.length > 0;

  const goNext = () => {
    if (step === 'dealer' && canGoAddress) setStep('address');
    else if (step === 'address' && canGoProducts) setStep('products');
    else if (step === 'products' && canGoResults) setStep('results');
  };

  const resetSandbox = () => {
    clearDealer();
    setLines([]);
    setProductQuery('');
    setCourierBySite({});
    setManualFreightAmount(null);
  };

  return (
    <div className="settings-logistics__section panel settings-logistics-testing">
      <div className="settings-logistics__default-head">
        <div>
          <h4 className="settings-logistics__title">
            <FlaskConical size={18} aria-hidden />
            {' '}
            Freight testing
          </h4>
          <p className="text-muted text-sm">
            Sandbox only — pick a dealer, ship-to, and products to preview SO splits
            (sector × billing branch) and freight quotes for every selectable partner.
            Nothing is saved to Zoho.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={resetSandbox}>
          Reset
        </button>
      </div>

      {ratesError ? (
        <p className="settings-locations__error text-sm" role="alert">{ratesError}</p>
      ) : null}

      <ol className="settings-logistics-testing__steps" aria-label="Testing steps">
        {STEPS.map((item, index) => {
          const locked = (
            (item.id === 'address' && !canGoAddress)
            || (item.id === 'products' && !canGoProducts)
            || (item.id === 'results' && !canGoResults)
          );
          const done = index < stepIndex;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={[
                  'settings-logistics-testing__step',
                  step === item.id ? 'is-active' : '',
                  done ? 'is-done' : '',
                  locked ? 'is-locked' : '',
                ].filter(Boolean).join(' ')}
                disabled={locked && item.id !== step}
                onClick={() => {
                  if (!locked || item.id === step) setStep(item.id);
                }}
              >
                <span className="settings-logistics-testing__step-num">{index + 1}</span>
                <span className="settings-logistics-testing__step-copy">
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 'dealer' ? (
        <section className="settings-logistics-testing__panel">
          <label className="settings-logistics-testing__search">
            <Search size={16} aria-hidden />
            <input
              className="input-field"
              value={dealerQuery}
              onChange={e => {
                setDealerQuery(e.target.value);
                if (selectedDealer) setSelectedDealer(null);
              }}
              placeholder="Search dealer name, code, phone…"
              autoComplete="off"
            />
          </label>
          <p className="text-muted text-sm settings-logistics-testing__meta">
            <Users size={14} aria-hidden />
            {dealersLoading && dealers.length === 0
              ? 'Loading dealers…'
              : `${dealers.length.toLocaleString('en-IN')} dealers loaded`}
          </p>
          {selectedDealer ? (
            <div className="settings-logistics-testing__selected">
              <div>
                <strong>{zohoDealerDisplayName(selectedDealer)}</strong>
                {zohoDealerContactPerson(selectedDealer) ? (
                  <p className="text-muted text-sm">{zohoDealerContactPerson(selectedDealer)}</p>
                ) : null}
                {zohoDealerMobile(selectedDealer) ? (
                  <p className="text-muted text-sm">{zohoDealerMobile(selectedDealer)}</p>
                ) : null}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearDealer}>
                Change
              </button>
            </div>
          ) : null}
          {!selectedDealer && dealerQuery.trim().length >= 2 ? (
            <ul className="settings-logistics-testing__list">
              {filteredDealers.map(dealer => (
                <li key={dealer.id}>
                  <button
                    type="button"
                    className="settings-logistics-testing__list-btn"
                    onClick={() => selectDealer(dealer)}
                  >
                    <strong>{zohoDealerDisplayName(dealer)}</strong>
                    <span className="text-muted text-sm">
                      {[zohoDealerContactPerson(dealer), zohoDealerMobile(dealer)]
                        .filter(Boolean)
                        .join(' · ') || dealer.id}
                    </span>
                  </button>
                </li>
              ))}
              {filteredDealers.length === 0 ? (
                <li className="text-muted text-sm">No dealers match.</li>
              ) : null}
            </ul>
          ) : null}
          {!selectedDealer && dealerQuery.trim().length < 2 ? (
            <p className="text-muted text-sm">Type at least 2 characters to search.</p>
          ) : null}
        </section>
      ) : null}

      {step === 'address' && selectedDealer ? (
        <section className="settings-logistics-testing__panel">
          <div className="settings-logistics-testing__selected">
            <div>
              <strong>{zohoDealerDisplayName(selectedDealer)}</strong>
              <p className="text-muted text-sm">Choose shipping address for freight zone.</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep('dealer')}>
              Back
            </button>
          </div>
          <ShippingAddressPicker
            addresses={addresses}
            loading={addressesLoading}
            error={addressError}
            value={shipping}
            onChange={setShipping}
            onRefresh={() => void loadAddresses(selectedDealer)}
            allowManage
            customerId={selectedDealer.id}
          />
          {shippingDestination && inferredZone ? (
            <p className="text-muted text-sm settings-logistics-testing__zone">
              Freight plan:
              {' '}
              <strong>{ST_COURIER_ZONE_LABELS[inferredZone]}</strong>
              {shippingDestination.state || shippingDestination.city
                ? ` · ${[shippingDestination.city, shippingDestination.state].filter(Boolean).join(', ')}`
                : ''}
              {shippingDestination.zip ? ` · ${shippingDestination.zip}` : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 'products' ? (
        <section className="settings-logistics-testing__panel">
          <div className="settings-logistics-testing__selected">
            <div>
              <strong>Add catalog lines</strong>
              <p className="text-muted text-sm">
                Sector (product / spare / software) and warehouse stock decide SO splits.
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep('address')}>
              Back
            </button>
          </div>

          <label className="settings-logistics-testing__search">
            <Search size={16} aria-hidden />
            <input
              className="input-field"
              value={productQuery}
              onChange={e => setProductQuery(e.target.value)}
              placeholder="Search SKU or product name…"
              autoComplete="off"
            />
          </label>
          {catalogLoading ? <p className="text-muted text-sm">Loading catalog…</p> : null}
          {catalogError ? (
            <p className="settings-locations__error text-sm" role="alert">{catalogError}</p>
          ) : null}

          {productQuery.trim().length >= 2 && !catalogLoading ? (
            <ul className="settings-logistics-testing__list">
              {filteredProducts.map(product => {
                const segment = classifyOrderLineSegment(product);
                const site = segment
                  ? resolveLineInventorySite(segment, product.warehouses)
                  : null;
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      className="settings-logistics-testing__list-btn"
                      onClick={() => addProduct(product)}
                    >
                      <span className="settings-logistics-testing__list-main">
                        <strong>{product.name}</strong>
                        <span className="text-muted text-sm">
                          {[product.sku, product.categoryName].filter(Boolean).join(' · ')}
                        </span>
                        {segment && site ? (
                          <span className="settings-logistics-testing__chip">
                            {segmentSiteLabel(segment, site)}
                          </span>
                        ) : null}
                      </span>
                      <Plus size={16} aria-hidden />
                    </button>
                  </li>
                );
              })}
              {filteredProducts.length === 0 ? (
                <li className="text-muted text-sm">No products match.</li>
              ) : null}
            </ul>
          ) : null}

          {lines.length > 0 ? (
            <ul className="settings-logistics-testing__cart">
              {lines.map(line => {
                const segment = classifyOrderLineSegment(line);
                const site = segment
                  ? resolveLineInventorySite(segment, line.warehouses)
                  : null;
                return (
                  <li key={line.key} className="settings-logistics-testing__cart-row">
                    <div className="settings-logistics-testing__cart-copy">
                      <strong>{line.name}</strong>
                      <span className="text-muted text-sm">
                        {[line.sku, segment ? segmentLabel(segment) : null, site ? inventorySiteLabel(site) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <QuantityStepper
                      value={line.quantity}
                      min={1}
                      onChange={qty => updateQty(line.key, qty)}
                      aria-label={`Quantity for ${line.name}`}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted text-sm">
              <Package size={14} aria-hidden />
              {' '}
              No lines yet — search and add products or spares.
            </p>
          )}
        </section>
      ) : null}

      {step === 'results' ? (
        <section className="settings-logistics-testing__panel settings-logistics-testing__results">
          <div className="settings-logistics-testing__selected">
            <div>
              <strong>Auto SO split & freight</strong>
              <p className="text-muted text-sm">
                {zohoDealerDisplayName(selectedDealer!)}
                {shippingDestination
                  ? ` → ${[shippingDestination.city, shippingDestination.state, shippingDestination.zip]
                    .filter(Boolean)
                    .join(', ')}`
                  : ''}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep('products')}>
              Edit products
            </button>
          </div>

          <div className="settings-logistics-testing__split">
            <h5 className="settings-logistics-testing__block-title">
              Draft sales orders (
              {splitBuckets.length}
              )
            </h5>
            <p className="text-muted text-sm">
              Checkout splits one draft SO per sector × billing branch (inventory site).
            </p>
            <ul className="settings-logistics-testing__split-list">
              {splitBuckets.map(bucket => (
                <li key={bucket.key} className="settings-logistics-testing__split-card">
                  <header>
                    <strong>{segmentSiteLabel(bucket.segment, bucket.site)}</strong>
                    <span className="settings-logistics-testing__chip">
                      {bucket.lines.length}
                      {' '}
                      line
                      {bucket.lines.length === 1 ? '' : 's'}
                    </span>
                  </header>
                  <ul>
                    {bucket.lines.map(line => (
                      <li key={line.key}>
                        <span>{line.name}</span>
                        <span className="text-muted">×{line.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          {freightEstimate?.usable ? (
            <>
              <OrderFreightPanel
                estimate={freightEstimate}
                canEditPackage
                allowManualFreightEntry
                showLineDetails
                manualFreightAmount={manualFreightAmount}
                catalogById={catalogById}
                destinationLabel={[
                  shippingDestination?.city,
                  shippingDestination?.state,
                ].filter(Boolean).join(', ') || null}
                footerNote="Testing sandbox — Delhivery uses live B2B estimate; selecting a partner only updates this preview."
                onManualFreightAmountChange={setManualFreightAmount}
                onCourierChange={(site, partnerId) => {
                  setCourierBySite(prev => ({ ...prev, [site]: partnerId }));
                }}
                onPackageInfoChange={(productId, info) => {
                  setCatalogById(prev => {
                    const current = prev[productId];
                    if (!current) return prev;
                    return {
                      ...prev,
                      [productId]: { ...current, packageInfo: info },
                    };
                  });
                  setLines(prev => prev.map(line => (
                    line.productId === productId
                      ? { ...line, packageInfo: info }
                      : line
                  )));
                }}
              />
              {delhiveryLive.showStrip && selectedPartnerIsDelhivery(freightEstimate) ? (
                <DelhiveryQuoteStrip
                  originPin={delhiveryLive.originPin || null}
                  destinationPin={delhiveryLive.destinationPin}
                  weightKg={freightEstimate.totalChargeableKg || 5}
                  invAmount={goodsSubtotal}
                  freightBillingMode="btc"
                  includeEstimate={false}
                  compact
                />
              ) : null}
            </>
          ) : (
            <p className="text-muted text-sm">
              Freight needs a destination with a resolvable zone and at least one quotable line.
              Check shipping address and package data on products.
            </p>
          )}
        </section>
      ) : null}

      {(step === 'dealer' && canGoAddress)
        || (step === 'address' && canGoProducts)
        || (step === 'products' && canGoResults) ? (
          <div className="settings-logistics-testing__footer">
            <button type="button" className="btn btn-primary" onClick={goNext}>
              {step === 'products' ? 'Show split & freight' : 'Next'}
              <ArrowRight size={16} aria-hidden />
            </button>
            {step === 'address' && !canGoProducts ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled
                title="Select a shipping address first"
              >
                Select address to continue
              </button>
            ) : null}
          </div>
        ) : null}

      {step !== 'dealer' && step !== 'results' ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm settings-logistics-testing__clear-step"
          onClick={() => {
            if (step === 'address') setStep('dealer');
            if (step === 'products') setStep('address');
          }}
        >
          <X size={14} aria-hidden />
          Previous step
        </button>
      ) : null}
    </div>
  );
};
