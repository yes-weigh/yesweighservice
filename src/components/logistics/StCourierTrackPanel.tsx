import React, { useEffect, useState } from 'react';
import { RefreshCw, Truck } from 'lucide-react';
import { LOGISTICS_BRANCH_TRACKING_CONTACTS } from '../../constants/logisticsSettings';
import {
  fetchStCourierShipmentTrack,
  stCourierTrackFromBooking,
  type StCourierTrackResult,
} from '../../lib/stCourierTrack';
import type {
  LogisticsCourierDeliveryOffice,
  LogisticsCourierTrack,
} from '../../types/logistics-dispatch';
import { isStaffLogisticsSite, type StaffLogisticsSite } from '../../types/staff-logistics';

interface StCourierTrackPanelProps {
  awb: string;
  bookingId?: string | null;
  /** Ship-from site — picks the booking-office contact under history. */
  shipFromSite?: StaffLogisticsSite | string | null;
  /** Persisted destination office from ST pincode search (filled once on create). */
  courierDeliveryOffice?: LogisticsCourierDeliveryOffice | null;
  /** Persisted Firestore snapshot — shown as-is until the user refreshes. */
  cachedTrack?: LogisticsCourierTrack | null;
  onTrackUpdated?: (track: StCourierTrackResult) => void;
}

function formatFetchedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function branchContactForSite(site: string | null | undefined): string | null {
  if (!isStaffLogisticsSite(site)) return null;
  const contact = LOGISTICS_BRANCH_TRACKING_CONTACTS[site]?.trim();
  return contact || null;
}

function phoneHrefFromContact(contact: string): string | null {
  const match = /PH\s*:?\s*([0-9]{8,15})/i.exec(contact);
  return match?.[1] ? `tel:${match[1]}` : null;
}

export const StCourierTrackPanel: React.FC<StCourierTrackPanelProps> = ({
  awb,
  bookingId,
  shipFromSite,
  courierDeliveryOffice,
  cachedTrack,
  onTrackUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StCourierTrackResult | null>(
    () => stCourierTrackFromBooking(cachedTrack),
  );

  // Keep panel in sync with Firestore booking data (no live ST fetch on open).
  useEffect(() => {
    setResult(stCourierTrackFromBooking(cachedTrack));
    // Failed tracks map to Booked — don't surface raw courier error text.
    setError('');
  }, [cachedTrack]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchStCourierShipmentTrack(awb, { bookingId });
      setResult(next);
      onTrackUpdated?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch status.');
    } finally {
      setLoading(false);
    }
  };

  const fetchedLabel = formatFetchedAt(result?.fetchedAt);
  const hasSnapshot = Boolean(result);
  const branchContact = branchContactForSite(shipFromSite);
  const bookingPhoneHref = branchContact ? phoneHrefFromContact(branchContact) : null;
  const deliveryOffice = courierDeliveryOffice?.communication?.trim() || null;
  const deliveryPhoneHref = deliveryOffice ? phoneHrefFromContact(deliveryOffice) : null;

  return (
    <section className="logistics-booking__track-panel" aria-label="Shipment tracking">
      <div className="logistics-booking__card logistics-booking__card--wide">
        <div className="logistics-booking__track-panel-head">
          <h4>
            <Truck size={16} aria-hidden />
            Tracking
            {fetchedLabel ? (
              <span className="logistics-booking__track-panel-updated">
                · Updated {fetchedLabel}
                {loading ? ' · Refreshing…' : ''}
              </span>
            ) : loading ? (
              <span className="logistics-booking__track-panel-updated">· Refreshing…</span>
            ) : (
              <span className="logistics-booking__track-panel-updated">· Not tracked yet</span>
            )}
          </h4>
          <div className="logistics-booking__track-panel-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh tracking"
              title="Refresh tracking"
            >
              <RefreshCw size={14} className={loading ? 'is-spin' : undefined} aria-hidden />
              Refresh
            </button>
          </div>
        </div>

        <div className="logistics-booking__track-panel-body">
          {!hasSnapshot && !loading && !error && (
            <p className="text-muted text-sm">
              No tracking data saved yet. Use Refresh to fetch the latest status.
            </p>
          )}
          {error && (
            <p className="logistics-booking__track-panel-error">{error}</p>
          )}
          {result?.ok && (
            <>
              {result.status && (
                <p className="logistics-booking__track-panel-status">{result.status}</p>
              )}
              <dl className="logistics-booking__track-panel-meta">
                {result.origin && <div><dt>Origin</dt><dd>{result.origin}</dd></div>}
                {result.destination && <div><dt>Destination</dt><dd>{result.destination}</dd></div>}
                {result.consignmentType && <div><dt>Consignment</dt><dd>{result.consignmentType}</dd></div>}
                {result.bookedAt && <div><dt>Booked</dt><dd>{result.bookedAt}</dd></div>}
                {result.deliveredAt && <div><dt>Delivered</dt><dd>{result.deliveredAt}</dd></div>}
              </dl>
              {result.history.length > 0 ? (
                <div className="logistics-booking__track-panel-history">
                  <h5>Tracking history</h5>
                  <ol className="logistics-booking__track-timeline">
                    {result.history.map((item, index) => (
                      <li
                        key={`${item.at}-${item.activity}-${index}`}
                        className={index === 0 ? 'is-latest' : undefined}
                      >
                        <span className="logistics-booking__track-timeline-dot" aria-hidden />
                        <div className="logistics-booking__track-timeline-copy">
                          <strong>{item.activity || 'Update'}</strong>
                          {item.location ? (
                            <span className="logistics-booking__track-timeline-location">
                              {item.location}
                            </span>
                          ) : null}
                          {item.at ? (
                            <time className="logistics-booking__track-timeline-at">{item.at}</time>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-muted text-sm">
                  Tracking history not available for this AWB.
                </p>
              )}
            </>
          )}

          {branchContact && (
            <div className="logistics-booking__track-branch-contact">
              <h5>
                <Truck size={14} aria-hidden />
                Courier booking office
              </h5>
              <p>{branchContact}</p>
              {bookingPhoneHref && (
                <a href={bookingPhoneHref} className="logistics-booking__track-branch-phone">
                  Call {bookingPhoneHref.replace(/^tel:/, '')}
                </a>
              )}
            </div>
          )}

          {deliveryOffice && (
            <div className="logistics-booking__track-branch-contact logistics-booking__track-delivery-office">
              <h5>
                <Truck size={14} aria-hidden />
                Courier delivery office
              </h5>
              <p>{deliveryOffice}</p>
              {deliveryPhoneHref && (
                <a href={deliveryPhoneHref} className="logistics-booking__track-branch-phone">
                  Call {deliveryPhoneHref.replace(/^tel:/, '')}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
