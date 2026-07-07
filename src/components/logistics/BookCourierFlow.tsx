import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Barcode,
  Check,
  ChevronLeft,
  FileText,
  Keyboard,
  MapPin,
  Package,
  Printer,
  ScanLine,
  Truck,
} from 'lucide-react';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import {
  BOOK_COURIER_STEPS,
  MOCK_DEALER_ADDRESSES,
  bookingSummaryLines,
  courierSlipFileName,
  createLogisticsBooking,
  emptyBookingDraft,
  formatDealerAddress,
  packingSlipFileName,
  parseCourierBarcode,
  type BookCourierStep,
} from '../../lib/logisticsBooking';
import type { LogisticsBooking, LogisticsBookingDraft } from '../../types/logistics-dispatch';
import { BarcodeScanner } from './BarcodeScanner';

interface BookCourierFlowProps {
  partnerId: LogisticsPartnerId;
  onClose: () => void;
  onComplete: (booking: LogisticsBooking) => void;
}

function StepProgress({ step }: { step: BookCourierStep }) {
  const activeIndex = BOOK_COURIER_STEPS.findIndex(item => item.id === step);
  const visibleSteps = BOOK_COURIER_STEPS.filter(item => item.id !== 'complete');

  return (
    <ol className="book-courier__progress" aria-label="Booking progress">
      {visibleSteps.map((item, index) => {
        const done = index < activeIndex;
        const current = item.id === step;
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
              {done ? <Check size={12} strokeWidth={3} /> : index + 1}
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
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<BookCourierStep>('scan');
  const [draft, setDraft] = useState<LogisticsBookingDraft>(() => emptyBookingDraft(partnerId));
  const [booking, setBooking] = useState<LogisticsBooking | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

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
    setStep('details');
  }, [applyScannedCode]);

  const handleBarcodeSubmit = useCallback(() => {
    applyScannedCode(draft.barcodeRaw);
    setStep('details');
  }, [applyScannedCode, draft.barcodeRaw]);

  const handleConfirmBooking = useCallback(() => {
    const created = createLogisticsBooking(draft);
    if (!created) return;
    setBooking(created);
    setStep('complete');
  }, [draft]);

  const handleGenerateCourierSlip = useCallback(() => {
    if (!booking) return;
    setBooking(prev => prev ? { ...prev, courierSlipGenerated: true } : prev);
  }, [booking]);

  const handleGeneratePackingSlip = useCallback(() => {
    if (!booking) return;
    setBooking(prev => prev ? { ...prev, packingSlipGenerated: true } : prev);
  }, [booking]);

  const handleFinish = useCallback(() => {
    if (booking) onComplete(booking);
  }, [booking, onComplete]);

  const canProceedFromDetails = Boolean(
    draft.consignmentNo.trim() && draft.branch.trim() && draft.serviceType.trim() && draft.bookingDate,
  );
  const canProceedFromAddress = Boolean(draft.deliveryAddressId);
  const canProceedFromPackage = Boolean(draft.numberOfBoxes.trim() && draft.totalWeightKg.trim());

  const summaryLines = useMemo(
    () => (booking ? bookingSummaryLines(booking) : bookingSummaryLines({
      ...draft,
      id: '',
      orderRef: '—',
      deliveryAddress: MOCK_DEALER_ADDRESSES.find(a => a.id === draft.deliveryAddressId) ?? MOCK_DEALER_ADDRESSES[0],
      numberOfBoxes: Number.parseInt(draft.numberOfBoxes, 10) || 0,
      totalWeightKg: Number.parseFloat(draft.totalWeightKg) || 0,
      lengthCm: draft.lengthCm ? Number.parseFloat(draft.lengthCm) : null,
      widthCm: draft.widthCm ? Number.parseFloat(draft.widthCm) : null,
      heightCm: draft.heightCm ? Number.parseFloat(draft.heightCm) : null,
      courierSlipGenerated: false,
      packingSlipGenerated: false,
      status: 'courier_booked',
      createdAt: new Date().toISOString(),
    })),
    [booking, draft],
  );

  const goBack = () => {
    if (step === 'scan') onClose();
    else if (step === 'details') setStep('scan');
    else if (step === 'address') setStep('details');
    else if (step === 'package') setStep('address');
    else if (step === 'review') setStep('package');
    else if (step === 'complete') setStep('review');
  };

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
          <button type="button" className="delivery-method-dialog__back" onClick={goBack} aria-label="Go back">
            <ChevronLeft size={22} aria-hidden />
          </button>
          <div className="delivery-method-dialog__hero">
            <span className="delivery-method-dialog__hero-icon" aria-hidden>
              <Truck size={34} strokeWidth={1.8} />
            </span>
            <h2 id="book-courier-title" className="delivery-method-dialog__title">
              <span>BOOK</span>
              <span className="delivery-method-dialog__title-accent">COURIER</span>
            </h2>
            <p className="delivery-method-dialog__subtitle">{logisticsPartnerLabel(partnerId)}</p>
          </div>
          <span className="delivery-method-dialog__header-spacer" aria-hidden />
        </header>

        <StepProgress step={step} />

        <div className="book-courier__body">
          {step === 'scan' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <ScanLine size={18} aria-hidden />
                Scan courier slip / barcode
              </h3>
              <p className="book-courier__hint text-muted text-sm">
                Scan the consignment barcode on the courier slip, or enter the code manually.
              </p>

              {cameraOpen ? (
                <BarcodeScanner
                  onDetected={handleCameraDetected}
                  onClose={() => setCameraOpen(false)}
                />
              ) : (
                <button
                  type="button"
                  className="book-courier__scan-visual book-courier__scan-visual--button"
                  onClick={() => setCameraOpen(true)}
                >
                  <Barcode size={44} strokeWidth={1.25} aria-hidden />
                  <span>Tap to open camera scanner</span>
                </button>
              )}

              <div className="book-courier__actions">
                {!cameraOpen && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setCameraOpen(true)}
                  >
                    <ScanLine size={16} aria-hidden />
                    Scan with camera
                  </button>
                )}
              </div>

              <div className="book-courier__manual">
                <span className="book-courier__manual-label">
                  <Keyboard size={14} aria-hidden />
                  Or enter manually
                </span>
                <label className="courier-dialog__field">
                  <span>Barcode / slip code</span>
                  <input
                    type="text"
                    value={draft.barcodeRaw}
                    onChange={event => updateDraft('barcodeRaw', event.target.value)}
                    placeholder="Scan or type barcode"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary book-courier__next"
                  disabled={!draft.barcodeRaw.trim()}
                  onClick={handleBarcodeSubmit}
                >
                  Continue with code
                </button>
              </div>
            </section>
          )}

          {step === 'details' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">Courier details</h3>
              <p className="book-courier__hint text-muted text-sm">Auto-filled from scan — verify and edit if needed.</p>
              <label className="courier-dialog__field">
                <span>Logistics partner</span>
                <input type="text" readOnly value={logisticsPartnerLabel(partnerId)} />
              </label>
              <label className="courier-dialog__field">
                <span>Consignment no.</span>
                <input
                  type="text"
                  value={draft.consignmentNo}
                  onChange={event => updateDraft('consignmentNo', event.target.value)}
                  required
                />
              </label>
              <div className="courier-dialog__field-row">
                <label className="courier-dialog__field">
                  <span>Branch</span>
                  <input
                    type="text"
                    value={draft.branch}
                    onChange={event => updateDraft('branch', event.target.value)}
                  />
                </label>
                <label className="courier-dialog__field">
                  <span>Service type</span>
                  <input
                    type="text"
                    value={draft.serviceType}
                    onChange={event => updateDraft('serviceType', event.target.value)}
                  />
                </label>
              </div>
              <label className="courier-dialog__field">
                <span>Booking date</span>
                <input
                  type="date"
                  value={draft.bookingDate}
                  onChange={event => updateDraft('bookingDate', event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedFromDetails}
                onClick={() => setStep('address')}
              >
                Continue
              </button>
            </section>
          )}

          {step === 'address' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <MapPin size={18} aria-hidden />
                Dealer delivery address
              </h3>
              <div className="book-courier__address-list" role="radiogroup" aria-label="Delivery address">
                {MOCK_DEALER_ADDRESSES.map(address => (
                  <label
                    key={address.id}
                    className={`book-courier__address-card${draft.deliveryAddressId === address.id ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="delivery-address"
                      value={address.id}
                      checked={draft.deliveryAddressId === address.id}
                      onChange={() => updateDraft('deliveryAddressId', address.id)}
                    />
                    <span className="book-courier__address-copy">
                      <strong>{address.label}</strong>
                      <span>{formatDealerAddress(address)}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedFromAddress}
                onClick={() => setStep('package')}
              >
                Continue
              </button>
            </section>
          )}

          {step === 'package' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">
                <Package size={18} aria-hidden />
                Package details
              </h3>
              <div className="courier-dialog__field-row">
                <label className="courier-dialog__field">
                  <span>Number of boxes</span>
                  <input
                    type="number"
                    min="1"
                    value={draft.numberOfBoxes}
                    onChange={event => updateDraft('numberOfBoxes', event.target.value)}
                  />
                </label>
                <label className="courier-dialog__field">
                  <span>Total weight (kg)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={draft.totalWeightKg}
                    onChange={event => updateDraft('totalWeightKg', event.target.value)}
                  />
                </label>
              </div>
              <p className="book-courier__hint text-muted text-sm">Dimensions (optional)</p>
              <div className="courier-dialog__field-row book-courier__dims">
                <label className="courier-dialog__field">
                  <span>L (cm)</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.lengthCm}
                    onChange={event => updateDraft('lengthCm', event.target.value)}
                  />
                </label>
                <label className="courier-dialog__field">
                  <span>W (cm)</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.widthCm}
                    onChange={event => updateDraft('widthCm', event.target.value)}
                  />
                </label>
                <label className="courier-dialog__field">
                  <span>H (cm)</span>
                  <input
                    type="number"
                    min="0"
                    value={draft.heightCm}
                    onChange={event => updateDraft('heightCm', event.target.value)}
                  />
                </label>
              </div>
              <label className="courier-dialog__field">
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={event => updateDraft('notes', event.target.value)}
                  placeholder="Fragile, handle with care, etc."
                />
              </label>
              <button
                type="button"
                className="btn btn-primary book-courier__next"
                disabled={!canProceedFromPackage}
                onClick={() => setStep('review')}
              >
                Continue
              </button>
            </section>
          )}

          {step === 'review' && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">Review &amp; confirm</h3>
              <dl className="book-courier__review">
                {summaryLines.map(row => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" className="btn btn-primary book-courier__next" onClick={handleConfirmBooking}>
                Confirm booking
              </button>
            </section>
          )}

          {step === 'complete' && booking && (
            <section className="book-courier__section">
              <h3 className="book-courier__section-title">Booking summary</h3>
              <div className="book-courier__summary-badge">
                <Check size={16} aria-hidden />
                Courier booked · {booking.consignmentNo}
              </div>
              <dl className="book-courier__review">
                {bookingSummaryLines(booking).map(row => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="book-courier__slip-actions">
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm${booking.courierSlipGenerated ? ' is-done' : ''}`}
                  onClick={handleGenerateCourierSlip}
                >
                  <Printer size={14} aria-hidden />
                  {booking.courierSlipGenerated ? 'Courier slip ready' : 'Generate courier slip'}
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm${booking.packingSlipGenerated ? ' is-done' : ''}`}
                  onClick={handleGeneratePackingSlip}
                >
                  <FileText size={14} aria-hidden />
                  {booking.packingSlipGenerated ? 'Packing slip ready' : 'Generate packing slip'}
                </button>
              </div>
              {(booking.courierSlipGenerated || booking.packingSlipGenerated) && (
                <p className="book-courier__slip-names text-muted text-sm">
                  {booking.courierSlipGenerated && courierSlipFileName(booking)}
                  {booking.courierSlipGenerated && booking.packingSlipGenerated && ' · '}
                  {booking.packingSlipGenerated && packingSlipFileName(booking)}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary book-courier__next"
                onClick={handleFinish}
              >
                View booking
              </button>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
