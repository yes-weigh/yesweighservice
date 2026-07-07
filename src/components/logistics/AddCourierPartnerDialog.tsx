import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Truck, Upload } from 'lucide-react';
import { COURIER_PARTNERS } from '../../constants/courierPartners';
import { deliveryMethodToCourierPartnerId } from '../../constants/courierPartnerPicker';
import type { DeliveryMethodId } from '../../constants/deliveryMethods';
import { emptyCourierFormDraft } from '../../lib/logisticsDispatch';
import type { CourierPartnerFormDraft } from '../../types/logistics-dispatch';
import { CourierPartnerPicker } from './CourierPartnerPicker';

interface AddCourierPartnerDialogProps {
  onClose: () => void;
  onContinue: (draft: CourierPartnerFormDraft) => void;
}

export const AddCourierPartnerDialog: React.FC<AddCourierPartnerDialogProps> = ({
  onClose,
  onContinue,
}) => {
  const [step, setStep] = useState<'partner' | 'form'>('partner');
  const [draft, setDraft] = useState<CourierPartnerFormDraft>(emptyCourierFormDraft);

  const selectPartner = useCallback((methodId: string) => {
    setDraft(prev => ({
      ...prev,
      courierPartnerId: deliveryMethodToCourierPartnerId(methodId as DeliveryMethodId),
    }));
    setStep('form');
  }, []);

  const updateField = useCallback(<K extends keyof CourierPartnerFormDraft>(
    key: K,
    value: CourierPartnerFormDraft[K],
  ) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleFile = useCallback((file: File | null) => {
    updateField('lrReceiptFileName', file?.name ?? null);
  }, [updateField]);

  const canContinue = Boolean(
    draft.courierPartnerId
    && draft.trackingNumber.trim()
    && draft.expectedDeliveryDate
    && draft.numberOfBoxes.trim()
    && draft.totalWeightKg.trim(),
  );

  if (step === 'partner') {
    return (
      <CourierPartnerPicker
        onClose={onClose}
        onSelect={selectPartner}
        titleLead="LOGISTIC"
        titleAccent="PARTNER"
        subtitle="Choose your preferred logistic partner"
        ariaLabel="Logistic partners"
      />
    );
  }

  return createPortal(
    <div className="delivery-method-backdrop" role="presentation" onClick={onClose}>
      <div
        className="delivery-method-dialog delivery-method-dialog--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="courier-form-title"
        onClick={event => event.stopPropagation()}
      >
        <span className="delivery-method-dialog__glow delivery-method-dialog__glow--tl" aria-hidden />
        <span className="delivery-method-dialog__glow delivery-method-dialog__glow--br" aria-hidden />

        <header className="delivery-method-dialog__header">
          <button
            type="button"
            className="delivery-method-dialog__back"
            onClick={() => setStep('partner')}
            aria-label="Back to logistic partners"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <div className="delivery-method-dialog__hero">
            <span className="delivery-method-dialog__hero-icon" aria-hidden>
              <Truck size={34} strokeWidth={1.8} />
            </span>
            <h2 id="courier-form-title" className="delivery-method-dialog__title">
              <span>LOGISTIC</span>
              <span className="delivery-method-dialog__title-accent">DETAILS</span>
            </h2>
            <p className="delivery-method-dialog__subtitle">Enter tracking and shipment details</p>
          </div>
          <span className="delivery-method-dialog__header-spacer" aria-hidden />
        </header>

        <form
          className="courier-dialog__form"
          onSubmit={event => {
            event.preventDefault();
            if (canContinue) onContinue(draft);
          }}
        >
          <label className="courier-dialog__field">
            <span>Logistic Partner</span>
            <input
              type="text"
              value={COURIER_PARTNERS.find(item => item.id === draft.courierPartnerId)?.label ?? ''}
              readOnly
            />
          </label>

          <label className="courier-dialog__field">
            <span>Tracking / LR Number</span>
            <input
              type="text"
              value={draft.trackingNumber}
              onChange={event => updateField('trackingNumber', event.target.value)}
              placeholder="Enter tracking or LR number"
              required
            />
          </label>

          <div className="courier-dialog__field-row">
            <label className="courier-dialog__field">
              <span>Freight Charge</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.freightCharge}
                onChange={event => updateField('freightCharge', event.target.value)}
                placeholder="₹ 0.00"
              />
            </label>
            <label className="courier-dialog__field">
              <span>Expected Delivery Date</span>
              <input
                type="date"
                value={draft.expectedDeliveryDate}
                onChange={event => updateField('expectedDeliveryDate', event.target.value)}
                required
              />
            </label>
          </div>

          <div className="courier-dialog__field-row">
            <label className="courier-dialog__field">
              <span>Number of Boxes</span>
              <input
                type="number"
                min="1"
                step="1"
                value={draft.numberOfBoxes}
                onChange={event => updateField('numberOfBoxes', event.target.value)}
                required
              />
            </label>
            <label className="courier-dialog__field">
              <span>Total Weight (kg)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={draft.totalWeightKg}
                onChange={event => updateField('totalWeightKg', event.target.value)}
                required
              />
            </label>
          </div>

          <label className="courier-dialog__field courier-dialog__field--upload">
            <span>Upload LR / Receipt</span>
            <span className="courier-dialog__upload">
              <Upload size={16} aria-hidden />
              <span>{draft.lrReceiptFileName ?? 'Choose file'}</span>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={event => handleFile(event.target.files?.[0] ?? null)}
              />
            </span>
          </label>

          <label className="courier-dialog__field">
            <span>Remarks</span>
            <textarea
              rows={3}
              value={draft.remarks}
              onChange={event => updateField('remarks', event.target.value)}
              placeholder="Optional notes for dispatch team"
            />
          </label>

          <button type="submit" className="btn btn-primary courier-dialog__continue" disabled={!canContinue}>
            Continue
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
};
