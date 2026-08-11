import React, { useEffect, useState } from 'react';
import { Link2, Loader2, PenLine, Truck, X } from 'lucide-react';
import {
  LOGISTICS_PARTNERS,
  logisticsPartnerImage,
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../../constants/logisticsPartners';
import { formatInvoiceDate } from '../../lib/invoices';
import {
  ENABLED_LOGISTICS_PARTNER_IDS,
} from '../../lib/logisticsBooking';
import {
  linkLogisticsBookingToInvoice,
  listUnlinkedLogisticsBookingsForPartner,
  recordInvoiceLogisticsBooking,
} from '../../lib/logisticsBookings';
import {
  resolveDelhiveryFreightBillingModeFromInvoice,
} from '../../lib/logisticsPrefill';
import { formatLogisticsDateTimeLabel } from '../../lib/logisticsDateTime';
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
  /** When true (no freight line), show partner picker. */
  allowPartnerPick?: boolean;
  shipFromSite?: StaffLogisticsSite | null;
  user: User;
  onClose: () => void;
  onCreated: (booking: LogisticsBooking) => void;
};

const PICKABLE_PARTNERS = LOGISTICS_PARTNERS.filter(partner => (
  ENABLED_LOGISTICS_PARTNER_IDS.includes(partner.id)
  && partner.id !== 'delhivery'
));

function formatBookingDate(value: string): string {
  return formatLogisticsDateTimeLabel(value);
}

export const InvoiceAddLrDialog: React.FC<Props> = ({
  open,
  invoice,
  invoiceId,
  zohoCustomerId,
  partnerId,
  allowPartnerPick = false,
  shipFromSite,
  user,
  onClose,
  onCreated,
}) => {
  const [mode, setMode] = useState<Mode>('choose');
  const [selectedPartnerId, setSelectedPartnerId] = useState<LogisticsPartnerId>(partnerId);
  const [lrn, setLrn] = useState('');
  const [boxCount, setBoxCount] = useState('1');
  const [candidates, setCandidates] = useState<LogisticsBooking[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const activePartnerId = allowPartnerPick ? selectedPartnerId : partnerId;
  const delhiveryLinkOnly = activePartnerId === 'delhivery';

  useEffect(() => {
    if (!open) return;
    setSelectedPartnerId(partnerId);
    setLrn('');
    setBoxCount('1');
    setCandidates([]);
    setSelectedId('');
    setLinkQuery('');
    setError('');
    setSaving(false);
    setLoadingList(false);
    setMode(partnerId === 'delhivery' ? 'link' : 'choose');
  }, [open, partnerId, invoice]);

  useEffect(() => {
    if (!open || mode !== 'link') return;
    let cancelled = false;
    setLoadingList(true);
    setError('');
    void listUnlinkedLogisticsBookingsForPartner(activePartnerId, {
      preferZohoCustomerId: zohoCustomerId,
    })
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
  }, [open, mode, activePartnerId, zohoCustomerId]);

  if (!open) return null;

  const filtered = linkQuery.trim()
    ? candidates.filter(b => {
      const q = linkQuery.trim().toLowerCase();
      return (
        b.consignmentNo.toLowerCase().includes(q)
        || b.trackingNo.toLowerCase().includes(q)
        || b.dealer.name.toLowerCase().includes(q)
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
        partnerId: activePartnerId,
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
        invoiceValueInr: invoice.total,
        freightBillingMode: activePartnerId === 'delhivery'
          ? resolveDelhiveryFreightBillingModeFromInvoice(invoice)
          : undefined,
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
          <h3 id="invoice-add-lr-title">
            {delhiveryLinkOnly ? 'Link Delhivery LR' : 'Manual logistics'}
          </h3>
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
            <div className="invoice-manual-logistics-invoice-head">
              <p className="invoice-manual-logistics-invoice-head__number">
                {invoice.invoiceNumber}
              </p>
              <p className="invoice-manual-logistics-invoice-head__date">
                {invoice.date ? formatInvoiceDate(invoice.date) : '—'}
              </p>
            </div>
            <p className="text-muted text-sm">
              {allowPartnerPick
                ? 'No freight line on this invoice — pick the delivery partner first.'
                : 'No courier API automation.'}
            </p>
            {allowPartnerPick && (
              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Delivery partner</span>
                <select
                  value={selectedPartnerId}
                  onChange={e => setSelectedPartnerId(e.target.value as LogisticsPartnerId)}
                >
                  {PICKABLE_PARTNERS.map(partner => (
                    <option key={partner.id} value={partner.id}>
                      {partner.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                  <em>
                    Attach an existing unlinked
                    {' '}
                    {logisticsPartnerLabel(activePartnerId)}
                    {' '}
                    booking
                  </em>
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
            <div className="invoice-manual-logistics-invoice-head">
              <p className="invoice-manual-logistics-invoice-head__number">
                {invoice.invoiceNumber}
              </p>
              <p className="invoice-manual-logistics-invoice-head__date">
                {invoice.date ? formatInvoiceDate(invoice.date) : '—'}
              </p>
            </div>
            <p className="text-muted text-sm">
              {`Save tracking (${logisticsPartnerLabel(activePartnerId)}).`}
            </p>
            {allowPartnerPick && (
              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Delivery partner</span>
                <select
                  value={selectedPartnerId}
                  onChange={e => setSelectedPartnerId(e.target.value as LogisticsPartnerId)}
                  disabled={saving}
                >
                  {PICKABLE_PARTNERS.map(partner => (
                    <option key={partner.id} value={partner.id}>
                      {partner.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <div className="invoice-manual-logistics-invoice-head">
              <p className="invoice-manual-logistics-invoice-head__number">
                {invoice.invoiceNumber}
              </p>
              <p className="invoice-manual-logistics-invoice-head__date">
                {invoice.date ? formatInvoiceDate(invoice.date) : '—'}
              </p>
            </div>
            <p className="text-muted text-sm">
              {delhiveryLinkOnly
                ? 'Delhivery LRs must be created via Book Courier from the invoice. Link an existing unlinked LR here if the shipment was booked outside this flow.'
                : (
                  <>
                    Unlinked
                    {' '}
                    {logisticsPartnerLabel(activePartnerId)}
                    {' '}
                    entries — pick one to attach.
                  </>
                )}
            </p>
            {allowPartnerPick && !delhiveryLinkOnly && (
              <label className="settings-courier-rates__field settings-courier-rates__field--plain">
                <span>Delivery partner</span>
                <select
                  value={selectedPartnerId}
                  onChange={e => setSelectedPartnerId(e.target.value as LogisticsPartnerId)}
                  disabled={saving || loadingList}
                >
                  {PICKABLE_PARTNERS.map(partner => (
                    <option key={partner.id} value={partner.id}>
                      {partner.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="settings-courier-rates__field settings-courier-rates__field--plain">
              <span>Search</span>
              <input
                type="search"
                value={linkQuery}
                onChange={e => setLinkQuery(e.target.value)}
                disabled={saving || loadingList}
                placeholder="Tracking / dealer / order ref"
              />
            </label>
            <div className="invoice-manual-logistics-link-list" role="listbox" aria-label="Unlinked logistics">
              {loadingList ? (
                <p className="text-muted text-sm">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="text-muted text-sm">
                  No unlinked
                  {' '}
                  {logisticsPartnerLabel(activePartnerId)}
                  {' '}
                  logistics entries found.
                </p>
              ) : (
                filtered.map(booking => {
                  const selected = booking.id === selectedId;
                  const sameCustomer = booking.dealer.zohoCustomerId.trim() === zohoCustomerId.trim();
                  const partnerImg = logisticsPartnerImage(booking.partnerId);
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
                      <span className="invoice-manual-logistics-link-list__icon" aria-hidden>
                        {partnerImg ? (
                          <img src={partnerImg} alt="" />
                        ) : (
                          <Truck size={22} strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="invoice-manual-logistics-link-list__body">
                        <strong className="invoice-manual-logistics-link-list__date">
                          {formatBookingDate(booking.bookingDate)}
                        </strong>
                        <span className="invoice-manual-logistics-link-list__tracking">
                          {booking.consignmentNo || booking.trackingNo || '—'}
                        </span>
                        <span className="invoice-manual-logistics-link-list__meta">
                          {booking.dealer.name || 'Unknown dealer'}
                          {sameCustomer ? ' · this customer' : ''}
                          {booking.numberOfBoxes
                            ? ` · ${booking.numberOfBoxes} box${booking.numberOfBoxes === 1 ? '' : 'es'}`
                            : ''}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {error ? <p className="dealers-modal__error">{error}</p> : null}
            <div className="dealers-modal__actions">
              {!delhiveryLinkOnly ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setMode('choose'); setError(''); }}
                  disabled={saving}
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}
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
