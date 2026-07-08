import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Barcode,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Keyboard,
  Link2,
  Mail,
  MapPin,
  Minus,
  Package,
  Pencil,
  Plus,
  ScanLine,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { fetchDealerById, fetchDealers } from '../../lib/dealers';
import { fetchCatalog } from '../../lib/catalog';
import {
  BOOK_COURIER_STEPS,
  PACKAGE_TYPES,
  SHIPMENT_MODES,
  bookStepProgressIndex,
  computeVolumetricWeight,
  emptyBookingDraft,
  packageTypeLabel,
  parseCourierBarcode,
  type BookCourierStep,
} from '../../lib/logisticsBooking';
import {
  dealerMatchesLogisticsQuery,
  resolveDeliveryAddress,
  zohoDealerToSnapshot,
} from '../../lib/logisticsDealers';
import { persistLogisticsBooking } from '../../lib/logisticsBookings';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import type { User } from '../../types';
import type { ZohoDealer } from '../../types/dealers';
import type {
  DeliveryAddressKind,
  LogisticsBooking,
  LogisticsBookingDraft,
  LogisticsDealerSnapshot,
  PackageType,
  ShipmentItem,
  ShipmentMode,
} from '../../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../../types/staff-logistics';
import { STAFF_LOGISTICS_SITES, STAFF_LOGISTICS_SITE_LABELS } from '../../types/staff-logistics';
import type { CatalogProduct } from '../../types/catalog';
import { BarcodeScanner } from './BarcodeScanner';

interface BookCourierFlowProps {
  partnerId: LogisticsPartnerId;
  user: User;
  initialDraft?: Partial<LogisticsBookingDraft>;
  initialDealerQuery?: string;
  onClose: () => void;
  onComplete: (booking: LogisticsBooking) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function StepProgress({ step }: { step: BookCourierStep }) {
  const activeIndex = bookStepProgressIndex(step);
  return (
    <ol className="book-courier__progress" aria-label="Booking progress">
      {BOOK_COURIER_STEPS.map((item, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li
            key={item.id}
            className={[
              'book-courier__progress-item',
              done ? 'is-done' : '',
              current ? 'is-current' : '',
            ].filter(Boolean).join(' ')}
          >
            <span className="book-courier__progress-dot" aria-hidden>
              {done ? <Check size={15} strokeWidth={3} /> : index + 1}
            </span>
            <span className="book-courier__progress-label">{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const BookCourierFlow: React.FC<BookCourierFlowProps> = ({
  partnerId,
  user,
  initialDraft,
  initialDealerQuery,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<BookCourierStep>('scan');
  const [draft, setDraft] = useState<LogisticsBookingDraft>(() => ({
    ...emptyBookingDraft(partnerId),
    ...initialDraft,
    partnerId,
  }));
  const [booking, setBooking] = useState<LogisticsBooking | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dealerQuery, setDealerQuery] = useState(initialDealerQuery ?? '');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogHits, setCatalogHits] = useState<CatalogProduct[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [editingCourier, setEditingCourier] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const finalPhotoInputRef = useRef<HTMLInputElement>(null);

  const selectedDealer = useMemo<LogisticsDealerSnapshot | null>(() => {
    const dealer = dealers.find(item => item.id === draft.zohoCustomerId);
    return dealer ? zohoDealerToSnapshot(dealer) : null;
  }, [dealers, draft.zohoCustomerId]);

  const filteredDealers = useMemo(
    () => dealers.filter(dealer => dealerMatchesLogisticsQuery(dealer, dealerQuery)),
    [dealers, dealerQuery],
  );

  const volumetricWeight = useMemo(
    () => computeVolumetricWeight(
      draft.lengthCm ? Number.parseFloat(draft.lengthCm) : null,
      draft.widthCm ? Number.parseFloat(draft.widthCm) : null,
      draft.heightCm ? Number.parseFloat(draft.heightCm) : null,
    ),
    [draft.lengthCm, draft.widthCm, draft.heightCm],
  );

  useEffect(() => {
    const zohoId = initialDraft?.zohoCustomerId?.trim();
    if (!zohoId) return;
    let cancelled = false;
    void fetchDealerById(zohoId)
      .then(dealer => {
        if (!cancelled) {
          setDealers(prev => (prev.some(item => item.id === dealer.id) ? prev : [dealer, ...prev]));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [initialDraft?.zohoCustomerId]);

  useEffect(() => {
    if (step !== 'address') return;
    const q = dealerQuery.trim();
    // Don't list every dealer on open — only search once the user types something.
    if (!q) {
      setDealersLoading(false);
      // Keep only an already-selected dealer (e.g. from a prefilled invoice/support).
      setDealers(prev => prev.filter(dealer => dealer.id === draft.zohoCustomerId));
      return;
    }
    let cancelled = false;
    setDealersLoading(true);
    void fetchDealers({ q, limit: 30, page: 1 })
      .then(response => {
        if (!cancelled) setDealers(response.data);
      })
      .catch(() => {
        if (!cancelled) setDealers([]);
      })
      .finally(() => {
        if (!cancelled) setDealersLoading(false);
      });
    return () => { cancelled = true; };
  }, [step, dealerQuery, draft.zohoCustomerId]);

  useEffect(() => {
    void loadLogisticsSettings().then(settings => {
      const site = user.staffLogisticsSite ?? settings.defaultStaffLogisticsSite;
      setDraft(prev => ({ ...prev, shipFromSite: site }));
    });
  }, [user.staffLogisticsSite]);

  useEffect(() => {
    if (step !== 'box' || !showCatalog) return;
    const q = catalogQuery.trim().toLowerCase();
    if (!q) {
      setCatalogHits([]);
      return;
    }
    void fetchCatalog().then(response => {
      const hits = response.items.filter(product =>
        product.name.toLowerCase().includes(q)
          || (product.sku?.toLowerCase().includes(q) ?? false),
      ).slice(0, 8);
      setCatalogHits(hits);
    });
  }, [step, catalogQuery, showCatalog]);

  const updateDraft = useCallback(<K extends keyof LogisticsBookingDraft>(
    key: K,
    value: LogisticsBookingDraft[K],
  ) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyScannedCode = useCallback((raw: string) => {
    const parsed = parseCourierBarcode(raw, partnerId);
    setDraft(prev => ({
      ...prev,
      barcodeRaw: raw,
      consignmentNo: parsed.consignmentNo ?? prev.consignmentNo,
      branch: parsed.branch ?? prev.branch,
      serviceType: parsed.serviceType ?? prev.serviceType,
      bookingDate: parsed.bookingDate ?? prev.bookingDate,
    }));
  }, [partnerId]);

  const handleCameraDetected = useCallback((raw: string) => {
    applyScannedCode(raw);
    setCameraOpen(false);
  }, [applyScannedCode]);

  const handleScanContinue = useCallback(() => {
    applyScannedCode(draft.barcodeRaw);
    setStep('address');
  }, [applyScannedCode, draft.barcodeRaw]);

  const setItemPhoto = useCallback((itemId: string, photoUrl: string | null) => {
    setDraft(prev => ({
      ...prev,
      shipmentItems: prev.shipmentItems.map(item =>
        item.id === itemId ? { ...item, photoUrl } : item,
      ),
    }));
  }, []);

  const addCatalogItem = useCallback((product: CatalogProduct) => {
    setDraft(prev => ({
      ...prev,
      shipmentItems: [
        ...prev.shipmentItems,
        {
          id: `item-${product.id}-${Date.now()}`,
          name: product.name,
          sku: product.sku ?? null,
          catalogProductId: product.id,
          quantity: 1,
          serialNumbers: [],
          photoStoragePath: null,
          photoUrl: null,
        },
      ],
    }));
    setCatalogQuery('');
    setCatalogHits([]);
    setShowCatalog(false);
  }, []);

  const addTypedItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    const quantity = Math.max(1, Math.floor(newItemQty) || 1);
    setDraft(prev => ({
      ...prev,
      shipmentItems: [
        ...prev.shipmentItems,
        {
          id: `item-typed-${Date.now()}`,
          name,
          sku: null,
          catalogProductId: null,
          quantity,
          serialNumbers: [],
          photoStoragePath: null,
          photoUrl: null,
        },
      ],
    }));
    setNewItemName('');
    setNewItemQty(1);
  }, [newItemName, newItemQty]);

  const setShipmentMode = useCallback((mode: ShipmentMode) => {
    setDraft(prev => ({
      ...prev,
      shipmentMode: mode,
      numberOfBoxes: mode === 'envelope' ? 1 : prev.numberOfBoxes,
    }));
  }, []);

  const removeShipmentItem = useCallback((itemId: string) => {
    setDraft(prev => ({
      ...prev,
      shipmentItems: prev.shipmentItems.filter(item => item.id !== itemId),
    }));
  }, []);

  const handleItemPhotoChange = useCallback(async (itemId: string, file: File | undefined) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setItemPhoto(itemId, dataUrl);
  }, [setItemPhoto]);

  const handleFinalPhotoChange = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    updateDraft('finalPackagePhoto', dataUrl);
  }, [updateDraft]);

  const handleConfirmShipment = useCallback(async () => {
    if (!selectedDealer) return;
    setSaving(true);
    try {
      const created = await persistLogisticsBooking({
        draft,
        dealer: selectedDealer,
        createdBy: user,
      });
      setBooking(created);
      setStep('complete');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save shipment.');
    } finally {
      setSaving(false);
    }
  }, [draft, selectedDealer, user]);

  const handleFinish = useCallback(() => {
    if (booking) onComplete(booking);
  }, [booking, onComplete]);

  const adjustBoxes = useCallback((delta: number) => {
    setDraft(prev => ({ ...prev, numberOfBoxes: Math.max(1, prev.numberOfBoxes + delta) }));
  }, []);

  const isEnvelope = draft.shipmentMode === 'envelope';
  const allItemsPhotographed = draft.shipmentItems.length > 0
    && draft.shipmentItems.every(item => item.photoUrl || item.photoStoragePath);
  const canProceedScan = Boolean(draft.barcodeRaw.trim() || draft.consignmentNo.trim());
  const canProceedAddress = Boolean(draft.zohoCustomerId);
  const canProceedBox = Boolean(
    allItemsPhotographed &&
    (isEnvelope || (
      draft.numberOfBoxes >= 1 &&
      (Number.parseFloat(draft.actualWeightKg) || 0) > 0
    )),
  );

  const goBack = () => {
    switch (step) {
      case 'scan': onClose(); break;
      case 'address': setStep('scan'); break;
      case 'box': setStep('address'); break;
      case 'review': setStep('box'); break;
      case 'final_photo': setStep('review'); break;
      case 'complete': break;
      default: onClose();
    }
  };

  const stepNumberLabel = (() => {
    const idx = bookStepProgressIndex(step);
    if (idx < BOOK_COURIER_STEPS.length) return `Step ${idx + 1} of ${BOOK_COURIER_STEPS.length}`;
    if (step === 'final_photo') return 'Final package photo';
    return 'Completed';
  })();

  return createPortal(
    <div className="delivery-method-backdrop" role="presentation" onClick={onClose}>
      <div
        className="delivery-method-dialog delivery-method-dialog--form book-courier"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-courier-title"
        onClick={event => event.stopPropagation()}
      >
        <span className="delivery-method-dialog__glow delivery-method-dialog__glow--tl" aria-hidden />
        <span className="delivery-method-dialog__glow delivery-method-dialog__glow--br" aria-hidden />

        <header className="delivery-method-dialog__header">
          {step !== 'complete' ? (
            <button type="button" className="delivery-method-dialog__back" onClick={goBack} aria-label="Go back">
              <ChevronLeft size={22} aria-hidden />
            </button>
          ) : (
            <span className="delivery-method-dialog__header-spacer" aria-hidden />
          )}
          <div className="delivery-method-dialog__hero">
            <h2 id="book-courier-title" className="delivery-method-dialog__title">
              <span>BOOK</span>
              <span className="delivery-method-dialog__title-accent">COURIER</span>
            </h2>
            <p className="delivery-method-dialog__subtitle">
              {logisticsPartnerLabel(partnerId)} · {stepNumberLabel}
            </p>
          </div>
          <span className="delivery-method-dialog__header-spacer" aria-hidden />
        </header>

        {step !== 'complete' && <StepProgress step={step} />}

        <div className="book-courier__body">
          {/* SCREEN 1 — SCAN */}
          {step === 'scan' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <ScanLine size={18} aria-hidden />
                Scan <span className="accent">Courier</span> Barcode
              </h3>
              <p className="book-courier__hint text-muted text-sm">
                Scan the barcode on the courier slip or enter the code manually.
              </p>

              {cameraOpen ? (
                <BarcodeScanner onDetected={handleCameraDetected} onClose={() => setCameraOpen(false)} />
              ) : (
                <button
                  type="button"
                  className="book-courier__scan-visual book-courier__scan-visual--button"
                  onClick={() => setCameraOpen(true)}
                >
                  <Barcode size={44} strokeWidth={1.25} aria-hidden />
                  <span>Tap to scan barcode</span>
                </button>
              )}

              <div className="book-courier__actions">
                {!cameraOpen && (
                  <button type="button" className="btn btn-primary" onClick={() => setCameraOpen(true)}>
                    <Camera size={16} aria-hidden />
                    Scan with Camera
                  </button>
                )}
              </div>

              <div className="book-courier__manual">
                <span className="book-courier__manual-label">
                  <Keyboard size={14} aria-hidden />
                  Or enter manually
                </span>
                <label className="courier-dialog__field">
                  <span>Consignment / barcode number</span>
                  <input
                    type="text"
                    value={draft.barcodeRaw}
                    onChange={event => updateDraft('barcodeRaw', event.target.value)}
                    placeholder="Enter consignment / barcode"
                    autoComplete="off"
                    inputMode="text"
                  />
                </label>
              </div>

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedScan}
                onClick={handleScanContinue}
              >
                Confirm &amp; Next
              </button>
            </section>
          )}

          {/* SCREEN 2 — ADDRESS */}
          {step === 'address' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <MapPin size={18} aria-hidden />
                Select <span className="accent">Delivery</span> Address
              </h3>
              <label className="book-courier__search">
                <Search size={16} aria-hidden />
                <input
                  type="text"
                  value={dealerQuery}
                  onChange={event => setDealerQuery(event.target.value)}
                  placeholder="Search dealer by name, code or mobile"
                  autoComplete="off"
                />
              </label>
              <div className="book-courier__dealer-list" role="radiogroup" aria-label="Dealer">
                {dealersLoading && <p className="text-muted text-sm">Loading dealers…</p>}
                {filteredDealers.map(dealer => {
                  const snapshot = zohoDealerToSnapshot(dealer);
                  return (
                  <label
                    key={dealer.id}
                    className={`book-courier__dealer-card${draft.zohoCustomerId === dealer.id ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="dealer"
                      value={dealer.id}
                      checked={draft.zohoCustomerId === dealer.id}
                      onChange={() => {
                        updateDraft('zohoCustomerId', dealer.id);
                        updateDraft('dealerId', dealer.portalUserId?.trim() || dealer.id);
                      }}
                    />
                    <span className="book-courier__dealer-copy">
                      <strong>{snapshot.name}</strong>
                      <span className="book-courier__dealer-code">{snapshot.code}</span>
                      <span>{snapshot.contactPerson} · {snapshot.mobile}</span>
                      <span className="book-courier__address-block">
                        <strong>Shipping</strong>
                        {snapshot.shippingAddress}
                      </span>
                      <span className="book-courier__address-block">
                        <strong>Billing</strong>
                        {snapshot.billingAddress}
                      </span>
                    </span>
                  </label>
                  );
                })}
                {!dealersLoading && filteredDealers.length === 0 && (
                  <p className="text-muted text-sm">
                    {dealerQuery.trim()
                      ? `No dealers match “${dealerQuery}”.`
                      : 'Start typing to search for a dealer.'}
                  </p>
                )}
              </div>

              {draft.zohoCustomerId && (
                <fieldset className="book-courier__delivery-kind">
                  <legend>Deliver to</legend>
                  {(['shipping', 'billing'] as DeliveryAddressKind[]).map(kind => (
                    <label key={kind} className="book-courier__delivery-option">
                      <input
                        type="radio"
                        name="delivery-kind"
                        checked={draft.deliveryAddressKind === kind}
                        onChange={() => updateDraft('deliveryAddressKind', kind)}
                      />
                      <span>{kind === 'shipping' ? 'Shipping address' : 'Billing address'}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedAddress}
                onClick={() => setStep('box')}
              >
                Confirm &amp; Next
              </button>
            </section>
          )}

          {/* SCREEN 3 — BOX DETAILS */}
          {step === 'box' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <Package size={18} aria-hidden />
                {isEnvelope ? 'Envelope' : 'Package'} <span className="accent">Details</span>
              </h3>

              <div className="book-courier__mode" role="radiogroup" aria-label="Shipment type">
                {SHIPMENT_MODES.map(mode => (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.shipmentMode === mode.id}
                    className={`book-courier__mode-btn${draft.shipmentMode === mode.id ? ' is-selected' : ''}`}
                    onClick={() => setShipmentMode(mode.id)}
                  >
                    {mode.id === 'envelope' ? <Mail size={18} aria-hidden /> : <Package size={18} aria-hidden />}
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>

              {isEnvelope ? (
                <p className="book-courier__hint text-muted text-sm">
                  Envelope shipments don&apos;t need weight or dimensions. Just list the contents below.
                </p>
              ) : (
                <>
                  <div className="book-courier__stepper">
                    <span>Number of Boxes</span>
                    <div className="book-courier__stepper-controls">
                      <button type="button" onClick={() => adjustBoxes(-1)} aria-label="Decrease boxes">
                        <Minus size={16} aria-hidden />
                      </button>
                      <strong>{draft.numberOfBoxes}</strong>
                      <button type="button" onClick={() => adjustBoxes(1)} aria-label="Increase boxes">
                        <Plus size={16} aria-hidden />
                      </button>
                    </div>
                  </div>

                  <label className="courier-dialog__field">
                    <span>Actual Weight (kg)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.actualWeightKg}
                      onChange={event => updateDraft('actualWeightKg', event.target.value)}
                      placeholder="0.00"
                    />
                  </label>

                  <p className="book-courier__hint text-muted text-sm">Dimensions (cm)</p>
                  <div className="courier-dialog__field-row book-courier__dims">
                    <label className="courier-dialog__field">
                      <span>L</span>
                      <input type="number" min="0" value={draft.lengthCm}
                        onChange={event => updateDraft('lengthCm', event.target.value)} />
                    </label>
                    <label className="courier-dialog__field">
                      <span>W</span>
                      <input type="number" min="0" value={draft.widthCm}
                        onChange={event => updateDraft('widthCm', event.target.value)} />
                    </label>
                    <label className="courier-dialog__field">
                      <span>H</span>
                      <input type="number" min="0" value={draft.heightCm}
                        onChange={event => updateDraft('heightCm', event.target.value)} />
                    </label>
                  </div>

                  <div className="book-courier__volumetric">
                    <span>Volumetric Weight</span>
                    <strong>{volumetricWeight.toFixed(2)} kg</strong>
                  </div>

                  <label className="courier-dialog__field">
                    <span>Package Type</span>
                    <select
                      value={draft.packageType}
                      onChange={event => updateDraft('packageType', event.target.value as PackageType)}
                    >
                      {PACKAGE_TYPES.map(type => (
                        <option key={type.id} value={type.id}>{type.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className="courier-dialog__field">
                <span>Note (optional)</span>
                <textarea
                  rows={2}
                  value={draft.notes}
                  onChange={event => updateDraft('notes', event.target.value)}
                  placeholder="Enter notes…"
                />
              </label>

              <label className="courier-dialog__field">
                <span>Ship from site</span>
                <select
                  value={draft.shipFromSite}
                  onChange={event => updateDraft('shipFromSite', event.target.value as StaffLogisticsSite)}
                >
                  {STAFF_LOGISTICS_SITES.map(site => (
                    <option key={site} value={site}>{STAFF_LOGISTICS_SITE_LABELS[site]}</option>
                  ))}
                </select>
              </label>

              <div className="book-courier__add-item">
                <label className="courier-dialog__field book-courier__add-item-name">
                  <span>Add item</span>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={event => setNewItemName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTypedItem();
                      }
                    }}
                    placeholder="Type item name"
                    autoComplete="off"
                  />
                </label>
                <label className="courier-dialog__field book-courier__add-item-qty">
                  <span>Qty</span>
                  <input
                    type="number"
                    min="1"
                    value={newItemQty}
                    onChange={event => setNewItemQty(Math.max(1, Number.parseInt(event.target.value, 10) || 1))}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm book-courier__add-item-btn"
                  onClick={addTypedItem}
                  disabled={!newItemName.trim()}
                >
                  <Plus size={16} aria-hidden /> Add
                </button>
              </div>

              <div className="book-courier__catalog-toggle-wrap">
                <button
                  type="button"
                  className="book-courier__catalog-toggle"
                  onClick={() => setShowCatalog(v => !v)}
                  aria-expanded={showCatalog}
                >
                  <Link2 size={14} aria-hidden />
                  {showCatalog ? 'Hide catalogue search' : 'Link a catalogue product (optional)'}
                </button>
                {showCatalog && (
                  <div className="book-courier__catalog-search">
                    <label className="book-courier__search">
                      <Search size={16} aria-hidden />
                      <input
                        type="search"
                        value={catalogQuery}
                        onChange={event => setCatalogQuery(event.target.value)}
                        placeholder="Search catalogue products"
                      />
                    </label>
                    {catalogHits.length > 0 && (
                      <ul className="book-courier__catalog-hits">
                        {catalogHits.map(product => (
                          <li key={product.id}>
                            <button type="button" onClick={() => addCatalogItem(product)}>
                              <strong>{product.name}</strong>
                              <span className="text-muted">{product.sku}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {catalogQuery.trim() && catalogHits.length === 0 && (
                      <p className="text-muted text-sm">No catalogue products match “{catalogQuery}”.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="book-courier__items">
                <h4 className="book-courier__items-title">
                  Shipment Items
                  <span className={`book-courier__items-flag${allItemsPhotographed ? ' is-done' : ''}`}>
                    {draft.shipmentItems.filter(i => i.photoUrl || i.photoStoragePath).length}/{draft.shipmentItems.length} photographed
                  </span>
                </h4>
                <p className="book-courier__hint text-muted text-sm">
                  Photograph packed contents <strong>before closing the box</strong>. Required.
                </p>
                <ul className="book-courier__item-list">
                  {draft.shipmentItems.map(item => (
                    <ShipmentItemRow
                      key={item.id}
                      item={item}
                      onCapture={file => void handleItemPhotoChange(item.id, file)}
                      onClear={() => setItemPhoto(item.id, null)}
                      onPreview={() => item.photoUrl && setPreviewPhoto(item.photoUrl)}
                      onRemove={() => removeShipmentItem(item.id)}
                    />
                  ))}
                </ul>
              </div>

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedBox}
                onClick={() => setStep('review')}
              >
                Confirm &amp; Next
              </button>
            </section>
          )}

          {/* SCREEN 4 — REVIEW */}
          {step === 'review' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                Review &amp; <span className="accent">Confirm</span>
              </h3>

              <div className="book-courier__review-card">
                <div className="book-courier__review-head">
                  <h4>Courier Details</h4>
                  <button type="button" className="book-courier__edit" onClick={() => setEditingCourier(v => !v)}>
                    <Pencil size={13} aria-hidden /> {editingCourier ? 'Done' : 'Edit'}
                  </button>
                </div>
                {editingCourier ? (
                  <div className="book-courier__review-edit">
                    <label className="courier-dialog__field">
                      <span>Consignment / tracking no.</span>
                      <input type="text" value={draft.consignmentNo}
                        onChange={e => updateDraft('consignmentNo', e.target.value)} />
                    </label>
                    <div className="courier-dialog__field-row">
                      <label className="courier-dialog__field">
                        <span>Service type</span>
                        <input type="text" value={draft.serviceType}
                          onChange={e => updateDraft('serviceType', e.target.value)} />
                      </label>
                      <label className="courier-dialog__field">
                        <span>Branch</span>
                        <input type="text" value={draft.branch}
                          onChange={e => updateDraft('branch', e.target.value)} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <dl className="book-courier__kv">
                    <div><dt>Partner</dt><dd>{logisticsPartnerLabel(partnerId)}</dd></div>
                    <div><dt>Tracking No.</dt><dd>{draft.consignmentNo}</dd></div>
                    <div><dt>Service Type</dt><dd>{draft.serviceType}</dd></div>
                    <div><dt>Branch</dt><dd>{draft.branch}</dd></div>
                  </dl>
                )}
              </div>

              <div className="book-courier__review-card">
                <div className="book-courier__review-head">
                  <h4>Delivery Address</h4>
                  <button type="button" className="book-courier__edit" onClick={() => setStep('address')}>
                    <Pencil size={13} aria-hidden /> Edit
                  </button>
                </div>
                {selectedDealer && (
                  <p className="book-courier__review-address">
                    <strong>{selectedDealer.name}</strong>
                    <span className="book-courier__dealer-code">{selectedDealer.code}</span>
                    <span>{selectedDealer.contactPerson} · {selectedDealer.mobile}</span>
                    <span className="text-muted">{resolveDeliveryAddress(selectedDealer, draft.deliveryAddressKind)}</span>
                  </p>
                )}
              </div>

              <div className="book-courier__review-card">
                <div className="book-courier__review-head">
                  <h4>Package Details</h4>
                  <button type="button" className="book-courier__edit" onClick={() => setStep('box')}>
                    <Pencil size={13} aria-hidden /> Edit
                  </button>
                </div>
                <dl className="book-courier__kv">
                  <div><dt>Shipment Type</dt><dd>{isEnvelope ? 'Envelope' : 'Box'}</dd></div>
                  {!isEnvelope && (
                    <>
                      <div><dt>No. of Boxes</dt><dd>{draft.numberOfBoxes}</dd></div>
                      <div><dt>Actual Weight</dt><dd>{(Number.parseFloat(draft.actualWeightKg) || 0).toFixed(2)} kg</dd></div>
                      <div>
                        <dt>Dimensions (LxWxH)</dt>
                        <dd>{draft.lengthCm && draft.widthCm && draft.heightCm
                          ? `${draft.lengthCm} x ${draft.widthCm} x ${draft.heightCm} cm` : '—'}</dd>
                      </div>
                      <div><dt>Volumetric Weight</dt><dd>{volumetricWeight.toFixed(2)} kg</dd></div>
                      <div><dt>Package Type</dt><dd>{packageTypeLabel(draft.packageType)}</dd></div>
                    </>
                  )}
                </dl>
              </div>

              <div className="book-courier__review-card">
                <div className="book-courier__review-head">
                  <h4>Package Photos</h4>
                </div>
                <div className="book-courier__gallery">
                  {draft.shipmentItems.map(item => item.photoUrl && (
                    <div key={item.id} className="book-courier__thumb">
                      <button type="button" onClick={() => setPreviewPhoto(item.photoUrl!)} aria-label={`Preview ${item.name}`}>
                        <img src={item.photoUrl} alt={item.name} />
                      </button>
                      <button
                        type="button"
                        className="book-courier__thumb-del"
                        onClick={() => setItemPhoto(item.id, null)}
                        aria-label={`Delete ${item.name} photo`}
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                      <span>{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!allItemsPhotographed}
                onClick={() => setStep('final_photo')}
              >
                Next
              </button>
            </section>
          )}

          {/* SCREEN 5 — FINAL PACKAGE PHOTO */}
          {step === 'final_photo' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                Upload <span className="accent">Final</span> Package Photo
              </h3>
              <p className="book-courier__hint text-muted text-sm">
                Capture proof that the courier label is pasted correctly on the package.
              </p>

              {draft.finalPackagePhoto ? (
                <div className="book-courier__final-photo">
                  <img src={draft.finalPackagePhoto} alt="Final package" onClick={() => setPreviewPhoto(draft.finalPackagePhoto)} />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => finalPhotoInputRef.current?.click()}
                  >
                    <Camera size={14} aria-hidden /> Retake
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="book-courier__scan-visual book-courier__scan-visual--button"
                  onClick={() => finalPhotoInputRef.current?.click()}
                >
                  <Camera size={40} strokeWidth={1.25} aria-hidden />
                  <span>Tap to capture package photo</span>
                </button>
              )}
              <input
                ref={finalPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={event => void handleFinalPhotoChange(event.target.files?.[0])}
              />

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={saving || !draft.finalPackagePhoto}
                onClick={() => void handleConfirmShipment()}
              >
                <CheckCircle2 size={16} aria-hidden /> {saving ? 'Saving…' : 'Confirm Shipment'}
              </button>
            </section>
          )}

          {/* SCREEN 7 — COMPLETED */}
          {step === 'complete' && booking && (
            <section className="book-courier__section book-courier__success">
              <div className="book-courier__success-badge">
                <CheckCircle2 size={44} aria-hidden />
              </div>
              <h3 className="book-courier__success-title">Shipment Booked Successfully</h3>
              <div className="book-courier__success-track">
                <span>Tracking Number</span>
                <strong>{booking.trackingNo}</strong>
              </div>
              <dl className="book-courier__kv">
                <div><dt>Courier</dt><dd>{logisticsPartnerLabel(booking.partnerId)}</dd></div>
                <div><dt>Dealer</dt><dd>{booking.dealer.name}</dd></div>
                <div><dt>Boxes</dt><dd>{booking.numberOfBoxes}</dd></div>
                <div><dt>Weight</dt><dd>{booking.actualWeightKg.toFixed(2)} kg</dd></div>
              </dl>
              <div className="book-courier__success-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose}>Done</button>
                <button type="button" className="btn btn-primary" onClick={handleFinish}>View Shipment</button>
              </div>
            </section>
          )}
        </div>

        {previewPhoto && (
          <div className="book-courier__lightbox" role="dialog" aria-modal="true" onClick={() => setPreviewPhoto(null)}>
            <button type="button" className="book-courier__lightbox-close" aria-label="Close preview">
              <X size={20} aria-hidden />
            </button>
            <img src={previewPhoto} alt="Preview" onClick={event => event.stopPropagation()} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

interface ShipmentItemRowProps {
  item: ShipmentItem;
  onCapture: (file: File | undefined) => void;
  onClear: () => void;
  onPreview: () => void;
  onRemove?: () => void;
}

const ShipmentItemRow: React.FC<ShipmentItemRowProps> = ({
  item,
  onCapture,
  onClear,
  onPreview,
  onRemove,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className={`book-courier__item${item.photoUrl || item.photoStoragePath ? ' is-done' : ''}`}>
      <div className="book-courier__item-info">
        <strong>{item.name}</strong>
        <span className="text-muted">×{item.quantity}</span>
        {item.serialNumbers && item.serialNumbers.length > 0 && (
          <span className="book-courier__item-serials text-muted text-sm">
            S/N: {item.serialNumbers.join(', ')}
          </span>
        )}
      </div>
      {item.photoUrl || item.photoStoragePath ? (
        <div className="book-courier__item-actions">
          <button type="button" className="book-courier__item-thumb" onClick={onPreview} aria-label="Preview photo">
            <img src={item.photoUrl ?? ''} alt="" />
          </button>
          <button type="button" className="book-courier__item-clear" onClick={onClear} aria-label="Remove photo">
            <Trash2 size={14} aria-hidden />
          </button>
          {onRemove && (
            <button type="button" className="book-courier__item-clear" onClick={onRemove} aria-label="Remove item">
              <Minus size={14} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className="book-courier__item-actions">
          <button type="button" className="book-courier__item-upload" onClick={() => inputRef.current?.click()}>
            <Camera size={14} aria-hidden /> Upload Photo
          </button>
          {onRemove && (
            <button type="button" className="book-courier__item-clear" onClick={onRemove} aria-label="Remove item">
              <Minus size={14} aria-hidden />
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={event => onCapture(event.target.files?.[0])}
      />
    </li>
  );
};
