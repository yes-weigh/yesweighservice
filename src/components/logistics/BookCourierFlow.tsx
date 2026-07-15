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
  Printer,
  ScanLine,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { FIRM_NAME } from '../../constants/brand';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { fetchDealerById } from '../../lib/dealers';
import {
  ensureDealersCached,
  peekCachedDealers,
  subscribeDealerCache,
} from '../../lib/dealer-cache';
import {
  prefetchLogisticsGeoFix,
  stampLogisticsPhotoDataUrl,
} from '../../lib/logisticsPhotoStamp';
import {
  BOOK_COURIER_STEPS,
  SHIPMENT_MODES,
  bookStepProgressIndex,
  computeVolumetricWeight,
  draftBoxesHaveRequiredPhotos,
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
import {
  persistLogisticsBooking,
  persistLogisticsBookingDraft,
} from '../../lib/logisticsBookings';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import {
  buildShippingLabelViewModel,
  formatShippingBookingTime,
} from '../../lib/shippingLabel';
import {
  buildCourierSlipFromDraft,
  buildCourierSlipPngBlob,
  shareCourierSlipImage,
} from '../../lib/courierSlipImage';
import { tryPrintShippingLabelsThermal } from '../../lib/logisticsLabelPrint';
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
import { ShippingLabelSheet } from './ShippingLabelSheet';

type BoxNumberField = 'lengthCm' | 'widthCm' | 'heightCm' | 'weightKg';

function newPhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const SHIPPING_LABEL_PRINT_STYLES = `
  @page { margin: 0; size: 100mm 150mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  .sheet {
    width: 100mm;
    height: 150mm;
    margin: 0;
    border: 2px solid #111;
    padding: 4.5mm 4mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .sheet--courier { border-width: 3px; }
  .sheet__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 2px solid #111;
  }
  .sheet__logo { height: 22px; width: auto; object-fit: contain; }
  .sheet__product-line {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .sheet__parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 6px;
  }
  .sheet__party-label {
    display: block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .sheet__party-name {
    display: block;
    font-size: 11px;
    font-weight: 800;
    margin-bottom: 2px;
  }
  .sheet__party-address {
    margin: 0;
    font-size: 9px;
    line-height: 1.3;
    white-space: pre-line;
  }
  .sheet__box-meta,
  .sheet__weights {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 6px;
    padding: 5px 0;
    border-top: 1px solid #111;
    border-bottom: 1px solid #111;
  }
  .sheet__weights { border-top: none; }
  .sheet__box-meta span,
  .sheet__weights span,
  .sheet__dest span,
  .sheet__booking span {
    display: block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 1px;
  }
  .sheet__box-meta strong,
  .sheet__weights strong,
  .sheet__dest strong,
  .sheet__booking strong {
    display: block;
    font-size: 12px;
    font-weight: 800;
  }
  .sheet__carrier {
    display: grid;
    grid-template-columns: 0.9fr 1.1fr;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
    min-height: 48px;
  }
  .sheet__carrier-logo img {
    max-width: 100%;
    max-height: 36px;
    object-fit: contain;
  }
  .sheet__carrier-logo strong { font-size: 12px; font-weight: 800; }
  .sheet__barcode-block { text-align: center; }
  .sheet__barcode-block code {
    display: block;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }
  .sheet__barcode {
    display: flex;
    justify-content: center;
    gap: 1px;
    height: 34px;
  }
  .sheet__barcode i {
    display: block;
    width: 2px;
    background: #111;
    height: 100%;
  }
  .sheet__barcode i:nth-child(3n) { width: 1px; }
  .sheet__barcode i:nth-child(5n) { width: 3px; }
  .sheet__footer {
    display: grid;
    grid-template-columns: 1fr 1.1fr;
    gap: 8px;
    margin-top: auto;
    padding-top: 6px;
    border-top: 2px solid #111;
  }
  .sheet__booking { display: grid; gap: 4px; }
  .sheet__brand {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 2px solid #111;
  }
  .sheet__brand strong { font-size: 18px; letter-spacing: 0.04em; }
  .sheet__brand span { font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .sheet__row { margin: 0 0 8px; font-size: 12px; line-height: 1.35; white-space: pre-line; }
  .sheet__row strong { display: block; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 2px; }
  .sheet__track {
    margin: 12px 0;
    padding: 10px 8px;
    border: 1px dashed #111;
    text-align: center;
  }
  .sheet__track code {
    display: block;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.12em;
    margin-bottom: 6px;
  }
  .sheet__meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid #111;
    font-size: 11px;
  }
  .sheet__meta strong { display: block; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
`;

function printLabelElements(elements: Array<HTMLElement | null>, title: string): void {
  const sheets = elements.filter((el): el is HTMLElement => Boolean(el));
  if (!sheets.length || typeof window === 'undefined') return;
  const win = window.open('', '_blank', 'noopener,noreferrer,width=420,height=620');
  if (!win) return;
  win.document.open();
  win.document.write(
    `<!DOCTYPE html><html><head><title>${title}</title><style>${SHIPPING_LABEL_PRINT_STYLES}</style></head>`
    + `<body>${sheets.map(el => el.outerHTML).join('')}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.onload = () => {
    win.print();
  };
  window.setTimeout(() => {
    try { win.print(); } catch { /* ignore */ }
  }, 250);
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
  initialStep?: BookCourierStep;
  existingBookingId?: string | null;
  onClose: () => void;
  onComplete: (booking: LogisticsBooking) => void;
  /** Called when a draft is persisted and the flow should return to the list. */
  onDraftSaved?: (booking: LogisticsBooking) => void;
  /** Called when a draft is auto-updated while the wizard stays open. */
  onDraftUpdated?: (booking: LogisticsBooking) => void;
}

const AUTO_DRAFT_STEPS: ReadonlyArray<BookCourierStep> = [
  'box',
  'review',
  'label',
  'final_photo',
];

function isAutoDraftStep(step: BookCourierStep): boolean {
  return AUTO_DRAFT_STEPS.includes(step);
}

function StepProgress({ step }: { step: BookCourierStep }) {
  const activeIndex = bookStepProgressIndex(step);
  const total = BOOK_COURIER_STEPS.length;
  const allDone = step === 'complete' || activeIndex >= total;

  return (
    <ol className="book-courier__progress" aria-label="Booking progress">
      {BOOK_COURIER_STEPS.map((item, index) => {
        const done = allDone || index < activeIndex;
        const current = !allDone && index === activeIndex;
        return (
          <li
            key={item.id}
            className={[
              'book-courier__progress-item',
              done ? 'is-done' : '',
              current ? 'is-current' : '',
            ].filter(Boolean).join(' ')}
            aria-current={current ? 'step' : undefined}
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
  initialStep = 'scan',
  existingBookingId = null,
  onClose,
  onComplete,
  onDraftSaved,
  onDraftUpdated,
}) => {
  const [step, setStep] = useState<BookCourierStep>(() => {
    const boxes = initialDraft?.boxes?.length
      ? initialDraft.boxes
      : emptyBookingDraft(partnerId).boxes;
    if (draftBoxesHaveRequiredPhotos(boxes)) return initialStep;
    if (initialStep === 'review' || initialStep === 'label' || initialStep === 'final_photo') {
      return 'box';
    }
    return initialStep;
  });
  const [draft, setDraft] = useState<LogisticsBookingDraft>(() => ({
    ...emptyBookingDraft(partnerId),
    ...initialDraft,
    partnerId,
    boxes: initialDraft?.boxes?.length ? initialDraft.boxes : emptyBookingDraft(partnerId).boxes,
  }));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [draftBookingId, setDraftBookingId] = useState<string | null>(existingBookingId);
  const draftBookingIdRef = useRef<string | null>(existingBookingId);
  draftBookingIdRef.current = draftBookingId;
  const draftSaveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [booking, setBooking] = useState<LogisticsBooking | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dealerQuery, setDealerQuery] = useState(initialDealerQuery ?? '');
  const [dealers, setDealers] = useState<ZohoDealer[]>([]);
  const [dealersLoading, setDealersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editingCourier, setEditingCourier] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [shipFromOpen, setShipFromOpen] = useState(false);
  const [fromAddresses, setFromAddresses] = useState<Record<StaffLogisticsSite, string>>({
    cochin: '',
    head_office: '',
  });
  const shipFromRef = useRef<HTMLDivElement>(null);
  const shippingLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const finalPhotoCaptureInputRef = useRef<HTMLInputElement>(null);
  const [courierSlipPreviewUrl, setCourierSlipPreviewUrl] = useState<string | null>(null);
  const [sharingCourierSlip, setSharingCourierSlip] = useState(false);
  const [courierSlipError, setCourierSlipError] = useState('');

  const selectedDealer = useMemo<LogisticsDealerSnapshot | null>(() => {
    const dealer = dealers.find(item => item.id === draft.zohoCustomerId);
    return dealer ? zohoDealerToSnapshot(dealer) : null;
  }, [dealers, draft.zohoCustomerId]);

  const filteredDealers = useMemo(() => {
    const q = dealerQuery.trim();
    if (!q) return [];
    return dealers
      .filter(dealer => dealerMatchesLogisticsQuery(dealer, q))
      .slice(0, 30);
  }, [dealers, dealerQuery]);

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
  }, [step]);

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

  useEffect(() => {
    if (step === 'box' || step === 'final_photo') {
      prefetchLogisticsGeoFix();
    }
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
    const photoId = newPhotoId();
    const dataUrl = await stampLogisticsPhotoDataUrl(file);
    setDraft(prev => ({
      ...prev,
      boxes: prev.boxes.map(box => (box.id === boxId
        ? { ...box, photos: [...box.photos, { id: photoId, url: dataUrl }] }
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
    const dataUrl = await stampLogisticsPhotoDataUrl(file);
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
        existingBookingId: draftBookingId,
      });
      setBooking(created);
      setStep('complete');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not save shipment.');
    } finally {
      setSaving(false);
    }
  }, [draft, selectedDealer, user, draftBookingId]);

  const persistDraft = useCallback(async (
    wizardStep: BookCourierStep,
    options?: { close?: boolean; draftOverride?: LogisticsBookingDraft },
  ): Promise<LogisticsBooking | null> => {
    const draftToSave = options?.draftOverride ?? draftRef.current;
    if (!selectedDealer) {
      if (options?.close) onClose();
      return null;
    }

    const run = async (): Promise<LogisticsBooking | null> => {
      setSavingDraft(true);
      try {
        const saved = await persistLogisticsBookingDraft({
          draft: draftToSave,
          dealer: selectedDealer,
          createdBy: user,
          existingBookingId: draftBookingIdRef.current,
          wizardStep,
        });
        draftBookingIdRef.current = saved.id;
        setDraftBookingId(saved.id);
        // Keep local photos in sync with uploaded storage paths + download URLs.
        setDraft(prev => ({
          ...prev,
          boxes: prev.boxes.map(box => {
            const savedBox = saved.boxes.find(item => item.id === box.id);
            if (!savedBox?.photos.length) return box;
            if (savedBox.photos.length >= box.photos.length || box.photos.every(p => !p.storagePath)) {
              return {
                ...box,
                photos: savedBox.photos.map((photo, index) => ({
                  id: box.photos[index]?.id ?? `saved-${box.id}-${index}`,
                  url: photo.url || box.photos[index]?.url || '',
                  storagePath: photo.storagePath,
                })),
              };
            }
            return {
              ...box,
              photos: box.photos.map((photo, index) => {
                const savedPhoto = savedBox.photos[index]
                  ?? savedBox.photos.find(item => item.storagePath && item.storagePath === photo.storagePath);
                if (!savedPhoto) return photo;
                return {
                  ...photo,
                  storagePath: savedPhoto.storagePath || photo.storagePath,
                  url: savedPhoto.url || photo.url || '',
                };
              }),
            };
          }),
          finalPackagePhoto: saved.finalPackagePhoto
            ?? (prev.finalPackagePhoto?.startsWith('data:') ? prev.finalPackagePhoto : prev.finalPackagePhoto),
        }));
        if (options?.close) {
          onDraftSaved?.(saved);
        } else {
          onDraftUpdated?.(saved);
        }
        return saved;
      } catch (err) {
        if (options?.close) {
          const leave = window.confirm(
            `${err instanceof Error ? err.message : 'Could not save draft.'}\n\nLeave without saving?`,
          );
          if (leave) onClose();
        } else {
          window.alert(err instanceof Error ? err.message : 'Could not save draft.');
        }
        return null;
      } finally {
        setSavingDraft(false);
      }
    };

    const queued = draftSaveChainRef.current.then(run, run);
    draftSaveChainRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [selectedDealer, user, onClose, onDraftSaved, onDraftUpdated]);

  const requestClose = useCallback(() => {
    if (step === 'complete' || saving) {
      onClose();
      return;
    }
    if (isAutoDraftStep(step) && selectedDealer) {
      void persistDraft(step, { close: true, draftOverride: draftRef.current });
      return;
    }
    onClose();
  }, [step, saving, selectedDealer, persistDraft, onClose]);

  const advanceTo = useCallback(async (
    next: BookCourierStep,
    draftOverride?: LogisticsBookingDraft,
  ) => {
    const nextDraft = draftOverride ?? draftRef.current;
    if (draftOverride) {
      draftRef.current = draftOverride;
      setDraft(draftOverride);
    }
    if (selectedDealer && isAutoDraftStep(next)) {
      const saved = await persistDraft(next, { draftOverride: nextDraft });
      if (!saved) return;
    }
    setStep(next);
  }, [selectedDealer, persistDraft]);

  const handleFinish = useCallback(() => {
    if (booking) onComplete(booking);
  }, [booking, onComplete]);

  const isEnvelope = draft.shipmentMode === 'envelope';
  const canProceedScan = Boolean(draft.barcodeRaw.trim() || draft.consignmentNo.trim());
  const boxesValid = draftBoxesHaveRequiredPhotos(draft.boxes)
    && draft.boxes.every(box => {
      if (isEnvelope) return true;
      return (Number.parseFloat(box.weightKg) || 0) > 0;
    });
  const canProceedBox = boxesValid;
  const showDraftStatus = Boolean(selectedDealer) && isAutoDraftStep(step);
  const totalActualWeight = draft.boxes.reduce(
    (total, box) => total + (Number.parseFloat(box.weightKg) || 0),
    0,
  );
  const totalChargeableWeight = draft.boxes.reduce((sum, box) => {
    const actual = Number.parseFloat(box.weightKg) || 0;
    return sum + Math.max(actual, boxVolumetric(box));
  }, 0);
  const shippingLabelCount = isEnvelope ? 1 : Math.max(1, draft.boxes.length);
  const shippingLabels = useMemo(() => {
    if (!selectedDealer) return [];
    const deliveryAddress = resolveDeliveryAddress(selectedDealer, draft.deliveryAddressKind);
    const fromName = STAFF_LOGISTICS_SITE_LABELS[draft.shipFromSite];
    const fromAddress = (fromAddresses[draft.shipFromSite] || FIRM_NAME).trim();
    const bookingTime = formatShippingBookingTime();
    return Array.from({ length: shippingLabelCount }, (_, index) => {
      const box = draft.boxes[index];
      const boxActual = box ? (Number.parseFloat(box.weightKg) || 0) : totalActualWeight;
      const boxChargeable = box
        ? Math.max(boxActual, boxVolumetric(box))
        : totalChargeableWeight;
      return buildShippingLabelViewModel({
        fromName,
        fromAddress,
        dealer: selectedDealer,
        deliveryAddress,
        numberOfBoxes: shippingLabelCount,
        boxIndex: index + 1,
        grossWeightKg: isEnvelope ? totalActualWeight : boxActual,
        chargeableWeightKg: isEnvelope ? totalChargeableWeight : boxChargeable,
        partnerId,
        consignmentNo: draft.consignmentNo,
        bookingBranch: draft.branch,
        bookingDate: draft.bookingDate,
        bookingTime,
        bookedBy: user.displayName?.trim() || user.loginId?.trim() || 'YESWEIGH',
        shipmentMode: draft.shipmentMode,
      });
    });
  }, [
    selectedDealer,
    draft.deliveryAddressKind,
    draft.shipFromSite,
    draft.consignmentNo,
    draft.branch,
    draft.bookingDate,
    draft.shipmentMode,
    draft.boxes,
    fromAddresses,
    shippingLabelCount,
    totalActualWeight,
    totalChargeableWeight,
    partnerId,
    isEnvelope,
    user.displayName,
    user.loginId,
  ]);

  const handlePrintShippingLabels = useCallback(async () => {
    try {
      const thermal = await tryPrintShippingLabelsThermal(shippingLabels);
      if (thermal.usedThermal) {
        updateDraft('labelGenerated', true);
        return;
      }
    } catch (err) {
      const fallback = window.confirm(
        `${err instanceof Error ? err.message : 'Thermal print failed.'}\n\nPrint with the system dialog instead?`,
      );
      if (!fallback) return;
    }
    printLabelElements(shippingLabelRefs.current, 'Shipping label');
    updateDraft('labelGenerated', true);
  }, [shippingLabels, updateDraft]);

  const courierSlip = useMemo(() => {
    if (!selectedDealer) return null;
    return buildCourierSlipFromDraft({
      partnerId,
      draft,
      dealer: selectedDealer,
      deliveryAddress: resolveDeliveryAddress(selectedDealer, draft.deliveryAddressKind),
      piecesLabel: isEnvelope ? '1 envelope' : `${draft.boxes.length} box(es)`,
      weightKg: totalChargeableWeight || totalActualWeight,
    });
  }, [
    selectedDealer,
    partnerId,
    draft,
    isEnvelope,
    totalChargeableWeight,
    totalActualWeight,
  ]);

  useEffect(() => {
    if (!courierSlip || step !== 'label') {
      setCourierSlipPreviewUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setCourierSlipError('');
    void buildCourierSlipPngBlob(courierSlip)
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setCourierSlipPreviewUrl(objectUrl);
      })
      .catch(err => {
        if (active) {
          setCourierSlipError(err instanceof Error ? err.message : 'Could not build courier slip.');
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courierSlip, step]);

  const handleShareCourierSlip = useCallback(async () => {
    if (!courierSlip) return;
    setSharingCourierSlip(true);
    setCourierSlipError('');
    try {
      await shareCourierSlipImage(courierSlip);
      updateDraft('labelGenerated', true);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCourierSlipError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharingCourierSlip(false);
    }
  }, [courierSlip, updateDraft]);

  const goBack = () => {
    switch (step) {
      case 'scan': onClose(); break;
      case 'address': setStep('scan'); break;
      case 'box': setStep('address'); break;
      case 'review': setStep('box'); break;
      case 'label': setStep('review'); break;
      case 'final_photo': setStep('label'); break;
      case 'complete': break;
      default: onClose();
    }
  };

  const stepNumberLabel = (() => {
    if (step === 'complete') return 'Completed';
    const idx = bookStepProgressIndex(step);
    const current = BOOK_COURIER_STEPS[idx];
    const stage = current?.label ?? 'Step';
    return `${stage} · Step ${idx + 1} of ${BOOK_COURIER_STEPS.length}`;
  })();

  return createPortal(
    <div className="delivery-method-backdrop" role="presentation" onClick={() => void requestClose()}>
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
          {step !== 'complete' ? (
            <button
              type="button"
              className="delivery-method-dialog__close"
              onClick={() => void requestClose()}
              aria-label="Close and return to list"
              disabled={savingDraft || saving}
            >
              <X size={20} aria-hidden />
            </button>
          ) : (
            <span className="delivery-method-dialog__header-spacer" aria-hidden />
          )}
        </header>

        <StepProgress step={step} />

        {showDraftStatus && (
          <div className="book-courier__draft-bar">
            <span className="book-courier__draft-status text-muted text-sm">
              {savingDraft
                ? 'Saving draft…'
                : draftBookingId
                  ? 'Draft saved · closes update the list'
                  : 'Draft saves automatically from this step'}
            </span>
          </div>
        )}

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
                      {dealersLoading && dealers.length === 0 && (
                        <p className="book-courier__suggest-empty text-muted text-sm">Loading dealers…</p>
                      )}
                      {filteredDealers.map(dealer => {
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
                              onClick={() => void advanceTo('box')}
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
                disabled={!canProceedBox || savingDraft}
                onClick={() => void advanceTo('review')}
              >
                {savingDraft ? 'Saving photos…' : 'Confirm & Next'}
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
                      <button type="button" onClick={() => setPreviewPhoto(photo.url)} aria-label={`Preview ${isEnvelope ? 'envelope' : `box ${boxIndex + 1}`} photo`}>
                        <img src={photo.url} alt={isEnvelope ? 'Envelope' : `Box ${boxIndex + 1}`} />
                      </button>
                      <span>{isEnvelope ? 'Envelope' : `Box ${boxIndex + 1}`}</span>
                    </div>
                  )))}
                  {!draftBoxesHaveRequiredPhotos(draft.boxes) && (
                    <p className="text-muted text-sm">No package photo yet. Add one on the Box step to continue.</p>
                  )}
                </div>
              </div>

              {boxesValid ? (
                <button
                  type="button"
                  className="btn btn-primary book-courier__next"
                  onClick={() => void advanceTo('label')}
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary book-courier__next"
                  onClick={() => setStep('box')}
                >
                  Add package photo to continue
                </button>
              )}
            </section>
          )}

          {/* SCREEN 5 — LABELS */}
          {step === 'label' && selectedDealer && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                Print <span className="accent">Labels</span>
              </h3>
              <p className="book-courier__hint text-muted text-sm">
                Print the shipping label on the logistics printer. The courier slip is a shareable image only — it is not sent to the label printer.
              </p>

              <div className="book-courier__label-grid">
                <article className="book-courier__label-card">
                  <header className="book-courier__label-card-head">
                    <h4>
                      Shipping label
                      {shippingLabelCount > 1 ? ` · ${shippingLabelCount} pcs` : ''}
                    </h4>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handlePrintShippingLabels()}
                    >
                      <Printer size={14} aria-hidden />
                      {shippingLabelCount > 1 ? 'Print all' : 'Print'}
                    </button>
                  </header>
                  <div className="book-courier__label-preview book-courier__label-preview--stack">
                    {shippingLabels.map((label, index) => (
                      <ShippingLabelSheet
                        key={`ship-${label.boxIndex}`}
                        label={label}
                        ref={el => {
                          shippingLabelRefs.current[index] = el;
                        }}
                      />
                    ))}
                  </div>
                </article>

                <article className="book-courier__label-card">
                  <header className="book-courier__label-card-head">
                    <h4>Courier slip</h4>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!courierSlip || sharingCourierSlip || !courierSlipPreviewUrl}
                      onClick={() => void handleShareCourierSlip()}
                    >
                      <Share2 size={14} aria-hidden />
                      {sharingCourierSlip ? 'Sharing…' : 'Share'}
                    </button>
                  </header>
                  <div className="book-courier__label-preview book-courier__slip-preview">
                    {courierSlipError && (
                      <p className="book-courier__slip-error">{courierSlipError}</p>
                    )}
                    {courierSlipPreviewUrl ? (
                      <img
                        src={courierSlipPreviewUrl}
                        alt="Courier slip"
                        className="book-courier__slip-image"
                      />
                    ) : (
                      <p className="text-muted text-sm">Preparing courier slip…</p>
                    )}
                  </div>
                  <p className="book-courier__hint text-muted text-sm">
                    Share via WhatsApp or any app — not printed from the label printer.
                  </p>
                </article>
              </div>

              <button
                type="button"
                className="btn btn-primary book-courier__next"
                  onClick={() => {
                    void advanceTo('final_photo', { ...draftRef.current, labelGenerated: true });
                  }}
              >
                Next
              </button>
            </section>
          )}

          {/* SCREEN 6 — FINAL PACKAGE PHOTO */}
          {step === 'final_photo' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                Capture <span className="accent">Outer</span> Package Photo
              </h3>
              <p className="book-courier__hint text-muted text-sm">
                Use the camera to capture proof that the shipping label is pasted correctly on the package.
                GPS and time are stamped on the photo automatically.
              </p>

              {draft.finalPackagePhoto ? (
                <div className="book-courier__final-photo">
                  <img src={draft.finalPackagePhoto} alt="Final package" onClick={() => setPreviewPhoto(draft.finalPackagePhoto)} />
                  <div className="book-courier__final-photo-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => finalPhotoCaptureInputRef.current?.click()}
                    >
                      <Camera size={14} aria-hidden /> Retake
                    </button>
                  </div>
                </div>
              ) : (
                <div className="book-courier__final-photo-actions">
                  <button
                    type="button"
                    className="book-courier__scan-visual book-courier__scan-visual--button"
                    onClick={() => finalPhotoCaptureInputRef.current?.click()}
                  >
                    <Camera size={36} strokeWidth={1.25} aria-hidden />
                    <span>Capture outer package photo</span>
                  </button>
                </div>
              )}
              <input
                ref={finalPhotoCaptureInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={event => {
                  void handleFinalPhotoChange(event.target.files?.[0]);
                  event.target.value = '';
                }}
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
  const photoCaptureInputRef = useRef<HTMLInputElement>(null);
  const volumetric = boxVolumetric(box);
  const actualWeight = Number.parseFloat(box.weightKg) || 0;
  const chargeableWeight = Math.max(actualWeight, volumetric);

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
          <p className="book-courier__box-label">
            Dimensions (cm)
            <span className="book-courier__box-opt"> · optional</span>
          </p>
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
                    placeholder="—"
                    aria-label={`${label} (optional)`}
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
              <span className="book-courier__weight-card-title"><Package size={13} aria-hidden /> Chargeable Weight</span>
              <span className="book-courier__weight-card-value">
                <strong>{chargeableWeight.toFixed(2)}</strong>
                <em>kg</em>
              </span>
            </div>
          </div>
        </>
      )}

      <p className="book-courier__box-label">
        {isEnvelope ? 'Envelope Photos' : 'Package Photos'}
        <span className="book-courier__box-req"> * inside photo required · camera only</span>
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
          onClick={() => photoCaptureInputRef.current?.click()}
        >
          <Camera size={20} aria-hidden />
          <span>{box.photos.length === 0 ? 'Capture inside' : 'Capture'}</span>
          {box.photos.length > 0 && <em className="book-courier__photo-add-opt">Optional</em>}
        </button>
      </div>
      <input
        ref={photoCaptureInputRef}
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
