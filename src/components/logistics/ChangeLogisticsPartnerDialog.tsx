import React, { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, X } from 'lucide-react';
import {
  LOGISTICS_PARTNERS,
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../../constants/logisticsPartners';
import { ThemeSelect } from '../ThemeSelect';
import {
  CHANGEABLE_LOGISTICS_PARTNER_IDS,
} from '../../lib/logisticsBooking';
import { changeLogisticsBookingPartner } from '../../lib/logisticsBookings';
import type { User } from '../../types';
import type { LogisticsBooking } from '../../types/logistics-dispatch';

type Props = {
  booking: LogisticsBooking;
  user: User;
  onClose: () => void;
  onChanged: (next: LogisticsBooking) => void;
};

function defaultNextPartner(current: LogisticsPartnerId): LogisticsPartnerId {
  if (current === 'st_courier') return 'trackon_surface';
  if (current === 'trackon_air' || current === 'trackon_surface') return 'st_courier';
  return 'trackon_surface';
}

export const ChangeLogisticsPartnerDialog: React.FC<Props> = ({
  booking,
  user,
  onClose,
  onChanged,
}) => {
  const titleId = useId();
  const options = useMemo(
    () => CHANGEABLE_LOGISTICS_PARTNER_IDS
      .filter(id => id !== booking.partnerId)
      .map(id => ({
        value: id,
        label: LOGISTICS_PARTNERS.find(partner => partner.id === id)?.label ?? id,
      })),
    [booking.partnerId],
  );
  const [partnerId, setPartnerId] = useState<LogisticsPartnerId>(
    () => defaultNextPartner(booking.partnerId),
  );
  const [consignmentNo, setConsignmentNo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const ewayWarning = Boolean(
    booking.ewayBillNumber?.trim()
    || (booking.ewayBillStatus && !/cancel|missing|not/i.test(booking.ewayBillStatus)),
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const awb = consignmentNo.trim();
    if (!awb) {
      setError('Enter the Trackon (or new courier) AWB.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const next = await changeLogisticsBookingPartner(
        booking,
        { partnerId, consignmentNo: awb },
        user,
      );
      onChanged(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change courier.');
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="dealers-modal-backdrop logistics-issue-dialog__backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <form
        className="dealers-modal panel logistics-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={event => void handleSubmit(event)}
      >
        <header className="dealers-modal__header">
          <div>
            <h2 id={titleId}>Change courier</h2>
            <p className="text-muted text-sm logistics-issue-dialog__subtitle">
              Switch this booking from {logisticsPartnerLabel(booking.partnerId)} without
              cancelling. Boxes, photos, and the invoice stay. Enter the new AWB.
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="form-field">
          <label htmlFor="change-courier-partner">New courier</label>
          <ThemeSelect
            id="change-courier-partner"
            value={partnerId}
            options={options}
            onChange={value => setPartnerId(value as LogisticsPartnerId)}
            disabled={submitting}
            aria-label="New courier"
          />
        </div>

        <div className="form-field">
          <label htmlFor="change-courier-awb">New AWB / consignment</label>
          <input
            id="change-courier-awb"
            type="text"
            className="input"
            autoComplete="off"
            spellCheck={false}
            value={consignmentNo}
            onChange={event => setConsignmentNo(event.target.value)}
            placeholder={`Not the ${logisticsPartnerLabel(booking.partnerId)} AWB`}
            disabled={submitting}
          />
          {booking.consignmentNo.trim() ? (
            <p className="text-muted text-sm">
              Current {logisticsPartnerLabel(booking.partnerId)} AWB:{' '}
              {booking.consignmentNo.trim()}
            </p>
          ) : null}
        </div>

        {ewayWarning ? (
          <p className="text-sm" role="status">
            An e-way bill is already on this shipment. After switching, update the
            transporter on the e-way bill if GST still shows the old courier.
          </p>
        ) : null}

        {error ? <p className="dealers-modal__error">{error}</p> : null}

        <footer className="dealers-modal__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Keep {logisticsPartnerLabel(booking.partnerId)}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <ArrowRightLeft size={14} aria-hidden />
            {submitting ? 'Changing…' : `Switch to ${logisticsPartnerLabel(partnerId)}`}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
};
