import React, { useEffect, useState } from 'react';
import { Link2, Loader2, PenLine, X } from 'lucide-react';
import { logisticsPartnerLabel, type LogisticsPartnerId } from '../../constants/logisticsPartners';
import {
  linkLogisticsBookingToInvoice,
  listUnlinkedLogisticsBookingsForCustomer,
  recordInvoiceLogisticsBooking,
} from '../../lib/logisticsBookings';
import type { User } from '../../types';
import type { DealerInvoiceDetail } from '../../types/invoices';
import type { LogisticsBooking } from '../../types/logistics-dispatch';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

type Mode = 'choose' | 'manual' | 'link';

type Props = {
  open: boolean;
  invoice: DealerInvoiceDetail;
  invoiceId: string;
  zohoCustomerId: string;
  partnerId: LogisticsPartnerId;
  shipFromSite?: StaffLogisticsSite | null;
  user: User;
  onClose: () => void;
  onCreated: (booking: LogisticsBooking) => void;
};

function formatBookingDate(value: string): string {
  const raw = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return value || '—';
  const [y, m, d] = raw.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export const InvoiceAddLrDialog: React.FC<Props> = ({
  open,
  invoice,
  invoiceId,
  zohoCustomerId,
  partnerId,
  shipFromSite,
  user,
  onClose,
  onCreated,
}) => {
  const [mode, setMode] = useState<Mode>('choose');
  const [lrn, setLrn] = useState('');
  const [boxCount, setBoxCount] = useState('1');
  const [candidates, setCandidates] = useState<LogisticsBooking[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('choose');
    setLrn('');
    setBoxCount('1');
    setCandidates([]);
    setSelectedId('');
    setLinkQuery('');
    setError('');
    setSaving(false);
    setLoadingList(false);
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'link') return;
    let cancelled = false;
    setLoadingList(true);
    setError('');
    void listUnlinkedLogisticsBookingsForCustomer(zohoCustomerId)
      .then(rows => {
        if (cancelled) return;
        setCandidates(rows);
        setSelectedId(rows[0]?.id ?? '');
      })
      .catch(err => {
        if (cancelled) return;
        setCandidates([]);
        setError(err instanceof Error ? err.message : 'Could not load logistics entries.');
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, zohoCustomerId]);

  if (!open) return null;

  const filtered = linkQuery.trim()
    ? candidates.filter(b => {
      const q = linkQuery.trim().toLowerCase();
      return (
        b.consignmentNo.toLowerCase().includes(q)
        || b.trackingNo.toLowerCase().includes(q)
        || logisticsPartnerLabel(b.partnerId).toLowerCase().includes(q)
        || b.orderRef.toLowerCase().includes(q)
      );
    })
    : candidates;

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const booking = await recordInvoiceLogisticsBooking({
        invoice,
        invoiceId,
        zohoCustomerId,
        consignmentNo: lrn,
        boxCount: Number(boxCount),
        createdBy: user,
        partnerId,
        shipFromSite,
      });
      onCreated(booking);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create logistics entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setError('Select a logistics entry to link.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const booking = await linkLogisticsBookingToInvoice({
        bookingId: selectedId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        zohoCustomerId,
        user,
      });
      onCreated(booking);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link logistics entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="dealers-modal-backdrop"
      onClick={saving ? undefined : onClose}
      role="presentation"
    >
      <div
        className="dealers-modal panel glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-add-lr-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="dealers-modal__header">
          <h3 id="invoice-add-lr-title">Manual logistics</h3>
          <button
            type="button"
            className="dealers-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {mode === 'choose' ? (
          <>
            <p className="text-muted text-sm" style={{ marginTop: 0 }}>
              For
              {' '}
              {invoice.invoiceNumber}
              . No courier API automation.
            </p>
            <div className="invoice-manual-logistics-modes">
              <button
                type="button"
                className="invoice-manual-logistics-modes__card"
                onClick={() => setMode('manual')}
              >
                <PenLine size={20} aria-hidden />
                <span>
                  <strong>Enter tracking</strong>
                  <em>New entry with tracking number and box count</em>
                </span>
              </button>
              <button
                type="button"
                className="invoice-manual-logistics-modes__card"
                onClick={() => setMode('link')}
              >
                <Link2 size={20} aria-hidden />
                <span>
                  <strong>Link logistics</strong>
                  <em>Attach an existing unlinked booking for this customer</em>
                </span>
              </button>
            </div>
            <div className="dealers-modal__actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {mode === 'manual' ? (
          <form onSubmit={e => void handleManualSubmit(e)}>
            <p className="text-muted text-sm" style={{ marginTop: 0 }}>
              Save tracking for
              {' '}
              {invoice.invoiceNumber}
              {' '}
              (
              {logisticsPartnerLabel(partnerId)}
              ).
            </p>
            <label className="settings-courier-rates__field settings-courier-rates__field--plain">
              <span>Tracking number</span>
              <input
                type="text"
                value={lrn}
                onChange={e => setLrn(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                required
                disabled={saving}
                placeholder="LR / AWB / consignment no."
              />
            </label>
            <label
              className="settings-courier-rates__field settings-courier-rates__field--plain"
              style={{ marginTop: 12 }}
            >
              <span>Box count</span>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={boxCount}
                onChange={e => setBoxCount(e.target.value)}
                required
                disabled={saving}
              />
            </label>
            {error ? <p className="dealers-modal__error">{error}</p> : null}
            <div className="dealers-modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setMode('choose'); setError(''); }}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !lrn.trim()}
              >
                {saving ? <Loader2 size={16} className="spin" aria-hidden /> : null}
                Create entry
              </button>
            </div>
          </form>
        ) : null}

        {mode === 'link' ? (
          <form onSubmit={e => void handleLinkSubmit(e)}>
            <p className="text-muted text-sm" style={{ marginTop: 0 }}>
              Unlinked logistics for this customer — pick one to attach to
              {' '}
              {invoice.invoiceNumber}
              .
            </p>
            <label className="settings-courier-rates__field settings-courier-rates__field--plain">
              <span>Search</span>
              <input
                type="search"
                value={linkQuery}
                onChange={e => setLinkQuery(e.target.value)}
                disabled={saving || loadingList}
                placeholder="Tracking / partner"
              />
            </label>
            <div className="invoice-manual-logistics-link-list" role="listbox" aria-label="Unlinked logistics">
              {loadingList ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-muted text-sm">
                  No unlinked logistics entries for this customer.
                </p>
              ) : (
                filtered.map(booking => {
                  const selected = booking.id === selectedId;
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`invoice-manual-logistics-link-list__row${selected ? ' is-selected' : ''}`}
                      onClick={() => setSelectedId(booking.id)}
                      disabled={saving}
                    >
                      <strong>{booking.consignmentNo || booking.trackingNo || '—'}</strong>
                      <span>
                        {logisticsPartnerLabel(booking.partnerId)}
                        {' · '}
                        {formatBookingDate(booking.bookingDate)}
                        {booking.numberOfBoxes
                          ? ` · ${booking.numberOfBoxes} box${booking.numberOfBoxes === 1 ? '' : 'es'}`
                          : ''}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {error ? <p className="dealers-modal__error">{error}</p> : null}
            <div className="dealers-modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setMode('choose'); setError(''); }}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || loadingList || !selectedId}
              >
                {saving ? <Loader2 size={16} className="spin" aria-hidden /> : null}
                Link to invoice
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
};
