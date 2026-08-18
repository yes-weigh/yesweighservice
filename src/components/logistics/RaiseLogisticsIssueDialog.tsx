import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MessageSquareWarning, X } from 'lucide-react';
import { raiseLogisticsIssueTicket } from '../../lib/raiseLogisticsIssueTicket';
import { homePathForRole } from '../../types';
import type { User } from '../../types';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';

type Props = {
  booking: LogisticsBooking;
  user: User;
  onClose: () => void;
  onCreated: (next: LogisticsBooking) => void;
};

export const RaiseLogisticsIssueDialog: React.FC<Props> = ({
  booking,
  user,
  onClose,
  onCreated,
}) => {
  const navigate = useNavigate();
  const titleId = useId();
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const awb = (
    booking.partnerId === 'delhivery'
      ? (booking.consignmentNo || booking.trackingNo)
      : (booking.trackingNo || booking.consignmentNo)
  ).trim() || '—';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = description.trim();
    if (!text) {
      setError('Describe the issue to continue.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await raiseLogisticsIssueTicket({
        bookingId: booking.id,
        description: text,
      });
      const next: LogisticsBooking = {
        ...booking,
        supportRequestId: result.linkedBooking
          ? result.requestId
          : (booking.supportRequestId || result.requestId),
        supportRequestNumber: result.linkedBooking
          ? result.requestNumber
          : (booking.supportRequestNumber || result.requestNumber),
        updatedAt: new Date().toISOString(),
      };
      onCreated(next);
      onClose();
      navigate(`${homePathForRole(user.role)}/warranty-support/${result.requestId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not raise issue ticket.';
      setError(message.replace(/^FirebaseError:\s*/i, ''));
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
      <div
        className="dealers-modal panel logistics-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dealers-modal__header">
          <div>
            <h2 id={titleId}>Raise complaint</h2>
            <p className="text-muted text-sm logistics-issue-dialog__subtitle">
              Creates a Logistics &amp; Delivery complaint in Warranty &amp; Support with this
              shipment’s details.
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

        <dl className="logistics-issue-dialog__meta">
          <div>
            <dt>Shipment</dt>
            <dd>{awb}</dd>
          </div>
          <div>
            <dt>Partner</dt>
            <dd>{logisticsPartnerLabel(booking.partnerId)}</dd>
          </div>
          <div>
            <dt>Dealer</dt>
            <dd>{booking.dealer.name || '—'}</dd>
          </div>
        </dl>

        <form className="dealers-modal__form" onSubmit={event => void handleSubmit(event)}>
          <label className="dealers-modal__field">
            <span>What is the issue?</span>
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={5}
              placeholder="e.g. Package damaged on delivery, wrong destination, delayed beyond ETA…"
              disabled={submitting}
              autoFocus
              required
            />
          </label>

          {error && (
            <p className="logistics-issue-dialog__error" role="alert">{error}</p>
          )}

          <div className="logistics-issue-dialog__actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <MessageSquareWarning size={16} aria-hidden />
              {submitting ? 'Creating…' : 'Create complaint'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
