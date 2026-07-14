import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Barcode,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Keyboard,
  Lock,
  Mail,
  MapPin,
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
import {
  BOOK_COURIER_STEPS,
  SHIPMENT_MODES,
  bookStepProgressIndex,
  computeVolumetricWeight,
  emptyBookingDraft,
  emptyShipmentBoxDraft,
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
  ShipmentBoxDraft,
  ShipmentMode,
} from '../../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../../types/staff-logistics';
import { STAFF_LOGISTICS_SITES, STAFF_LOGISTICS_SITE_LABELS } from '../../types/staff-logistics';
import { BarcodeScanner } from './BarcodeScanner';

type BoxNumberField = 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg';

function newPhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function boxVolumetric(box: ShipmentBoxDraft): number {
  return computeVolumetricWeight(
    box.lengthCm ? Number.parseFloat(box.lengthCm) : null,
    box.widthCm ? Number.parseFloat(box.widthCm) : null,
    box.heightCm ? Number.parseFloat(box.heightCm) : null,
  );
}

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
  const [saving, setSaving] = useState(false);
  const [editingCourier, setEditingCourier] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [shipFromOpen, setShipFromOpen] = useState(false);
  const [fromAddresses, setFromAddresses] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const shipFromRef = useRef<HTMLDivElement>(null);
  const finalPhotoInputRef = useRef<HTMLInputElement>(null);

  const selectedDealer = useMemo<LogisticsDealerSnapshot | null>(() => {
    const dealer = dealers.find(item => item.id === draft.zohoCustomerId);
    return dealer ? zohoDealerToSnapshot(dealer) : null;
  }, [dealers, draft.zohoCustomerId]);

  const filteredDealers = useMemo(
    () => dealers.filter(dealer => dealerMatchesLogisticsQuery(dealer, dealerQuery)),
    [dealers, dealerQuery],
  );

  const addressTiles = useMemo(() => {
    if (!selectedDealer) return [] as Array<{ kind: DeliveryAddressKind; address: string }>;
    const shipping = selectedDealer.shippingAddress?.trim() ?? '';
    const billing = selectedDealer.billingAddress?.trim() ?? '';
    const tiles: Array<{ kind: DeliveryAddressKind; address: string }> = [];
    if (shipping) tiles.push({ kind: 'shipping', address: shipping });
    // Only add billing when it exists and differs from shipping.
    if (billing && billing !== shipping) tiles.push({ kind: 'billing', address: billing });
    return tiles;
  }, [selectedDealer]);

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
      setFromAddresses(settings.fromAddresses);
    });
  }, [user.staffLogisticsSite]);

  useEffect(() => {
    if (!shipFromOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!shipFromRef.current?.contains(event.target as Node)) {
        setShipFromOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [shipFromOpen]);

  useEffect(() => {
    if (step !== 'box') setShipFromOpen(false);
  }, [step]);

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

  const selectDealer = useCallback((dealer: ZohoDealer) => {
    const snapshot = zohoDealerToSnapshot(dealer);
    setDealers(prev => (prev.some(item => item.id === dealer.id) ? prev : [dealer, ...prev]));
    setDraft(prev => ({
      ...prev,
      zohoCustomerId: dealer.id,
      dealerId: dealer.portalUserId?.trim() || dealer.id,
      deliveryAddressKind: snapshot.shippingAddress?.trim() ? 'shipping' : 'billing',
    }));
    setDealerQuery('');
  }, []);

  const clearDealer = useCallback(() => {
    setDraft(prev => ({ ...prev, zohoCustomerId: '', dealerId: '' }));
    setDealerQuery('');
  }, []);

  const setShipmentMode = useCallback((mode: ShipmentMode) => {
    setDraft(prev => ({
      ...prev,
      shipmentMode: mode,
      boxes: mode === 'envelope'
        ? prev.boxes.slice(0, 1)
        : (prev.boxes.length ? prev.boxes : [emptyShipmentBoxDraft()]),
    }));
  }, []);

  const updateBoxField = useCallback((boxId: string, key: BoxNumberField, value: string) => {
    setDraft(prev => ({
      ...prev,
      boxes: prev.boxes.map(box => (box.id === boxId ? { ...box, [key]: value } : box)),
    }));
  }, []);

  const addBox = useCallback(() => {
    setDraft(prev => ({ ...prev, boxes: [...prev.boxes, emptyShipmentBoxDraft()] }));
  }, []);

  const removeBox = useCallback((boxId: string) => {
    setDraft(prev => (prev.boxes.length <= 1
      ? prev
      : { ...prev, boxes: prev.boxes.filter(box => box.id !== boxId) }));
  }, []);

  const addBoxPhoto = useCallback(async (boxId: string, file: File | undefined) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setDraft(prev => ({
      ...prev,
      boxes: prev.boxes.map(box => (box.id === boxId
        ? { ...box, photos: [...box.photos, { id: newPhotoId(), url: dataUrl }] }
        : box)),
    }));
  }, []);

  const removeBoxPhoto = useCallback((boxId: string, photoId: string) => {
    setDraft(prev => ({
      ...prev,
      boxes: prev.boxes.map(box => (box.id === boxId
        ? { ...box, photos: box.photos.filter(photo => photo.id !== photoId) }
        : box)),
    }));
  }, []);

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

  const isEnvelope = draft.shipmentMode === 'envelope';
  const canProceedScan = Boolean(draft.barcodeRaw.trim() || draft.consignmentNo.trim());
  const boxesValid = draft.boxes.length > 0 && draft.boxes.every(box => {
    const hasInsidePhoto = box.photos.length > 0;
    if (isEnvelope) return hasInsidePhoto;
    return hasInsidePhoto && (Number.parseFloat(box.weightKg) || 0) > 0;
  });
  const canProceedBox = boxesValid;
  const totalActualWeight = draft.boxes.reduce(
    (total, box) => total + (Number.parseFloat(box.weightKg) || 0),
    0,
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
              {!selectedDealer ? (
                <div className="book-courier__autosuggest">
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
                  {dealerQuery.trim() && (
                    <div className="book-courier__suggest" role="listbox" aria-label="Dealer suggestions">
                      {dealersLoading && (
                        <p className="book-courier__suggest-empty text-muted text-sm">Searching…</p>
                      )}
                      {!dealersLoading && filteredDealers.map(dealer => {
                        const snapshot = zohoDealerToSnapshot(dealer);
                        const addressRaw = (snapshot.shippingAddress?.trim()
                          || snapshot.billingAddress?.trim()
                          || '');
                        const address = addressRaw && addressRaw !== '—' ? addressRaw : '';
                        return (
                          <button
                            key={dealer.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="book-courier__suggest-item"
                            onClick={() => selectDealer(dealer)}
                          >
                            <strong>{snapshot.name}</strong>
                            <span className="book-courier__dealer-code">{snapshot.code}</span>
                            <span className="text-muted">{snapshot.contactPerson} · {snapshot.mobile}</span>
                            {address ? (
                              <span className="book-courier__suggest-address">{address}</span>
                            ) : (
                              <span className="book-courier__suggest-address book-courier__suggest-address--empty">
                                No address on file
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {!dealersLoading && filteredDealers.length === 0 && (
                        <p className="book-courier__suggest-empty text-muted text-sm">
                          No dealers match “{dealerQuery}”.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="book-courier__selected-dealer">
                  <div className="book-courier__selected-head">
                    <span className="book-courier__selected-copy">
                      <strong>{selectedDealer.name}</strong>
                      <span className="book-courier__dealer-code">{selectedDealer.code}</span>
                      <span className="text-muted">
                        {selectedDealer.contactPerson} · {selectedDealer.mobile}
                      </span>
                    </span>
                    <button type="button" className="book-courier__change" onClick={clearDealer}>
                      <Pencil size={13} aria-hidden /> Change
                    </button>
                  </div>

                  <p className="book-courier__address-heading">Deliver to</p>
                  <div className="book-courier__address-tiles">
                    {addressTiles.map(tile => {
                      const selected = draft.deliveryAddressKind === tile.kind;
                      return (
                        <div
                          key={tile.kind}
                          className={`book-courier__address-tile${selected ? ' is-selected' : ''}`}
                        >
                          <button
                            type="button"
                            className="book-courier__address-tile-main"
                            onClick={() => updateDraft('deliveryAddressKind', tile.kind)}
                          >
                            <span className="book-courier__address-tile-head">
                              <span className="book-courier__address-tile-label">
                                {tile.kind === 'shipping' ? 'Shipping address' : 'Billing address'}
                              </span>
                              {selected && <Check size={15} strokeWidth={3} aria-hidden />}
                            </span>
                            <span className="book-courier__address-tile-body">{tile.address}</span>
                          </button>
                          {selected && (
                            <button
                              type="button"
                              className="btn btn-primary book-courier__address-next"
                              onClick={() => setStep('box')}
                            >
                              Next
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {addressTiles.length === 0 && (
                      <p className="text-muted text-sm">No delivery address on file for this dealer.</p>
                    )}
                  </div>
                </div>
              )}
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

              <div className="book-courier__field" ref={shipFromRef}>
                <span id="book-courier-ship-from-label">Ship from site</span>
                <button
                  type="button"
                  className={`book-courier__site-trigger${shipFromOpen ? ' is-open' : ''}`}
                  aria-haspopup="listbox"
                  aria-expanded={shipFromOpen}
                  aria-labelledby="book-courier-ship-from-label"
                  onClick={() => setShipFromOpen(open => !open)}
                >
                  <span className="book-courier__site-trigger-copy">
                    <strong>{STAFF_LOGISTICS_SITE_LABELS[draft.shipFromSite]}</strong>
                    {(fromAddresses[draft.shipFromSite] ?? '').trim() ? (
                      <span className="book-courier__site-trigger-address">
                        {fromAddresses[draft.shipFromSite].trim()}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown size={16} strokeWidth={2.25} aria-hidden />
                </button>
                {shipFromOpen && (
                  <div
                    className="book-courier__site-menu"
                    role="listbox"
                    aria-label="Ship from site"
                  >
                    {STAFF_LOGISTICS_SITES.map(site => {
                      const selected = draft.shipFromSite === site;
                      const address = (fromAddresses[site] ?? '').trim();
                      return (
                        <button
                          key={site}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`book-courier__site-option${selected ? ' is-selected' : ''}`}
                          onClick={() => {
                            updateDraft('shipFromSite', site);
                            setShipFromOpen(false);
                          }}
                        >
                          <span className="book-courier__site-option-head">
                            <strong>{STAFF_LOGISTICS_SITE_LABELS[site]}</strong>
                            {selected ? <Check size={14} strokeWidth={2.5} aria-hidden /> : null}
                          </span>
                          {address ? (
                            <span className="book-courier__site-option-address">{address}</span>
                          ) : (
                            <span className="book-courier__site-option-address book-courier__site-option-address--empty">
                              No from-address configured
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="book-courier__boxes">
                {draft.boxes.map((box, index) => (
                  <BoxCard
                    key={box.id}
                    box={box}
                    index={index}
                    isEnvelope={isEnvelope}
                    canRemove={!isEnvelope && draft.boxes.length > 1}
                    onField={(key, value) => updateBoxField(box.id, key, value)}
                    onAddPhoto={file => void addBoxPhoto(box.id, file)}
                    onRemovePhoto={photoId => removeBoxPhoto(box.id, photoId)}
                    onPreview={setPreviewPhoto}
                    onRemoveBox={() => removeBox(box.id)}
                  />
                ))}
              </div>

              {!isEnvelope && (
                <button type="button" className="book-courier__add-box" onClick={addBox}>
                  <Plus size={16} aria-hidden /> Add another box
                </button>
              )}

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
                      <div><dt>No. of Boxes</dt><dd>{draft.boxes.length}</dd></div>
                      <div><dt>Total Actual Weight</dt><dd>{totalActualWeight.toFixed(2)} kg</dd></div>
                      {draft.boxes.map((box, index) => (
                        <div key={box.id}>
                          <dt>Box {index + 1}</dt>
                          <dd>
                            {box.lengthCm && box.widthCm && box.heightCm
                              ? `${box.lengthCm} × ${box.widthCm} × ${box.heightCm} cm · `
                              : ''}
                            {(Number.parseFloat(box.weightKg) || 0).toFixed(2)} kg
                          </dd>
                        </div>
                      ))}
                    </>
                  )}
                </dl>
              </div>

              <div className="book-courier__review-card">
                <div className="book-courier__review-head">
                  <h4>Package Photos</h4>
                </div>
                <div className="book-courier__gallery">
                  {draft.boxes.flatMap((box, boxIndex) => box.photos.map(photo => (
                    <div key={photo.id} className="book-courier__thumb">
                      <button type="button" onClick={() => setPreviewPhoto(photo.url)} aria-label={`Preview box ${boxIndex + 1} photo`}>
                        <img src={photo.url} alt={`Box ${boxIndex + 1}`} />
                      </button>
                      <span>Box {boxIndex + 1}</span>
                    </div>
                  )))}
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!boxesValid}
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

interface BoxCardProps {
  box: ShipmentBoxDraft;
  index: number;
  isEnvelope: boolean;
  canRemove: boolean;
  onField: (key: BoxNumberField, value: string) => void;
  onAddPhoto: (file: File | undefined) => void;
  onRemovePhoto: (photoId: string) => void;
  onPreview: (url: string) => void;
  onRemoveBox: () => void;
}

const BoxCard: React.FC<BoxCardProps> = ({
  box,
  index,
  isEnvelope,
  canRemove,
  onField,
  onAddPhoto,
  onRemovePhoto,
  onPreview,
  onRemoveBox,
}) => {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const volumetric = boxVolumetric(box);

  return (
    <section className="book-courier__box">
      <div className="book-courier__box-head">
        <h4>{isEnvelope ? 'Envelope' : `Box ${index + 1}`}</h4>
        {canRemove && (
          <button type="button" className="book-courier__box-remove" onClick={onRemoveBox} aria-label={`Remove box ${index + 1}`}>
            <Trash2 size={15} aria-hidden />
          </button>
        )}
      </div>

      {!isEnvelope && (
        <>
          <p className="book-courier__box-label">Dimensions (cm)</p>
          <div className="book-courier__dim-cards">
            {([
              ['Length (L)', 'lengthCm'],
              ['Breadth (W)', 'widthCm'],
              ['Height (H)', 'heightCm'],
            ] as Array<[string, BoxNumberField]>).map(([label, key]) => (
              <label className="book-courier__dim-card" key={key}>
                <span className="book-courier__dim-card-title">{label}</span>
                <span className="book-courier__dim-card-value">
                  <input
                    type="number"
                    min="0"
                    value={box[key]}
                    onChange={event => onField(key, event.target.value)}
                    placeholder="0"
                    aria-label={label}
                  />
                  <em>cm</em>
                </span>
              </label>
            ))}
          </div>

          <p className="book-courier__box-label book-courier__box-label--tight">Weight</p>
          <div className="book-courier__weight-cards">
            <label className="book-courier__weight-card">
              <span className="book-courier__weight-card-title"><Lock size={13} aria-hidden /> Actual Weight</span>
              <span className="book-courier__weight-card-value">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={box.weightKg}
                  onChange={event => onField('weightKg', event.target.value)}
                  placeholder="0.00"
                  aria-label="Actual weight in kg"
                />
                <em>kg</em>
              </span>
            </label>
            <div className="book-courier__weight-card">
              <span className="book-courier__weight-card-title"><Package size={13} aria-hidden /> Volumetric Weight</span>
              <span className="book-courier__weight-card-value">
                <strong>{volumetric.toFixed(2)}</strong>
                <em>kg</em>
              </span>
            </div>
          </div>
        </>
      )}

      <p className="book-courier__box-label">
        {isEnvelope ? 'Envelope Photos' : 'Package Photos'}
        <span className="book-courier__box-req"> * inside photo required</span>
      </p>
      <div className="book-courier__photo-grid">
        {box.photos.map((photo, photoIndex) => (
          <div className="book-courier__photo-cell" key={photo.id}>
            <button
              type="button"
              className="book-courier__photo-open"
              onClick={() => onPreview(photo.url)}
              aria-label={`Preview photo ${photoIndex + 1}`}
            >
              <img src={photo.url} alt="" />
            </button>
            <button
              type="button"
              className="book-courier__photo-del"
              onClick={() => onRemovePhoto(photo.id)}
              aria-label={`Remove photo ${photoIndex + 1}`}
            >
              <X size={13} aria-hidden />
            </button>
            <span className="book-courier__photo-cap">
              {photoIndex === 0 ? 'Inside view' : `Photo ${photoIndex + 1}`}
            </span>
          </div>
        ))}
        <button
          type="button"
          className="book-courier__photo-add"
          onClick={() => photoInputRef.current?.click()}
        >
          <Camera size={20} aria-hidden />
          <span>{box.photos.length === 0 ? 'Add inside photo' : 'Add photo'}</span>
          {box.photos.length > 0 && <em className="book-courier__photo-add-opt">Optional</em>}
        </button>
      </div>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={event => {
          onAddPhoto(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </section>
  );
};
