import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MapPin, X } from 'lucide-react';
import { ewayBillRequiredLabel } from '../../constants/ewayBill';
import {
  invoiceNeedsCustomerPickupEwayVehicle,
  markInvoiceCustomerPickup,
} from '../../lib/invoiceCustomerPickup';
import { shipFromSiteLabel } from '../../lib/logisticsShipFrom';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

type Props = {
  open: boolean;
  invoice: DealerInvoiceDetail;
  customerId: string;
  invoiceId: string;
  shipFromSite: StaffLogisticsSite;
  shipFromLabel: string;
  onClose: () => void;
  onComplete: (result: Awaited<ReturnType<typeof markInvoiceCustomerPickup>>) => void;
};

export const InvoiceCustomerPickupDialog: React.FC<Props> = ({
  open,
  invoice,
  customerId,
  invoiceId,
  shipFromSite,
  shipFromLabel,
  onClose,
  onComplete,
}) => {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ewayRequired = useMemo(
    () => invoiceNeedsCustomerPickupEwayVehicle(invoice),
    [invoice],
  );

  useEffect(() => {
    if (!open) return;
    setVehicleNumber('');
    setSaving(false);
    setError('');
  }, [open, invoiceId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await markInvoiceCustomerPickup({
        customerId,
        invoiceId,
        shipFromSite,
        vehicleNumber: ewayRequired ? vehicleNumber : undefined,
      });
      onComplete(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark customer pickup.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <div
        className="dealers-modal panel glass invoice-customer-pickup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-customer-pickup-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="invoice-customer-pickup-title">Customer pickup</h3>
            <p className="text-muted text-sm">
              {invoice.invoiceNumber || invoiceId}
              {' · '}
              No courier logistics entry
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            aria-label="Close"
            disabled={saving}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <form onSubmit={e => void handleSubmit(e)}>
          <div className="invoice-customer-pickup-dialog__body">
            <p className="text-sm">
              Mark this invoice as collected by the customer from
              {' '}
              <strong>{shipFromLabel || shipFromSiteLabel(shipFromSite)}</strong>.
            </p>

            {ewayRequired ? (
              <>
                <p className="text-muted text-sm">{ewayBillRequiredLabel(invoice.total)}</p>
                <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                  <span>Vehicle number (e-way bill Part B)</span>
                  <input
                    type="text"
                    value={vehicleNumber}
                    onChange={e => setVehicleNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. KL07AB1234"
                    required
                    disabled={saving}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <p className="text-muted text-sm">
                E-way bill is not required for this invoice total.
              </p>
            )}

            {error ? (
              <p className="text-danger text-sm" role="alert">{error}</p>
            ) : null}
          </div>

          <div className="dealers-modal__actions">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <MapPin size={16} aria-hidden />
                  Mark customer pickup
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
