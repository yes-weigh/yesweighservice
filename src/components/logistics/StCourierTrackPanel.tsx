import React, { useEffect, useState } from 'react';
import { RefreshCw, Truck } from 'lucide-react';
import { LOGISTICS_BRANCH_TRACKING_CONTACTS } from '../../constants/logisticsSettings';
import {
  fetchStCourierShipmentTrack,
  stCourierTrackFromBooking,
  type StCourierTrackResult,
} from '../../lib/stCourierTrack';
import {
  fetchTrackonShipmentTrack,
  trackonTrackFromBooking,
} from '../../lib/trackonTrack';
import {
  fetchDelhiveryShipmentTrack,
  delhiveryTrackFromBooking,
  type DelhiveryTrackResult,
} from '../../lib/delhiveryTrack';
import {
  fetchBlueDartShipmentTrack,
  blueDartTrackFromBooking,
} from '../../lib/blueDartApi';
import { formatLogisticsDateTime, formatLogisticsDateTimeLabel } from '../../lib/logisticsDateTime';
import type {
  LogisticsCourierDeliveryOffice,
  LogisticsCourierTrack,
} from '../../types/logistics-dispatch';
import { isStaffLogisticsSite, type StaffLogisticsSite } from '../../types/staff-logistics';

export type CourierTrackProvider = 'st_courier' | 'trackon' | 'delhivery' | 'bluedart';

type CourierTrackResult = StCourierTrackResult | DelhiveryTrackResult;

interface StCourierTrackPanelProps {
  awb: string;
  bookingId?: string | null;
  /** Defaults to ST Courier. Pass `trackon` for Trackon air/surface bookings. */
  provider?: CourierTrackProvider;
  /** Ship-from site — picks the booking-office contact under history. */
  shipFromSite?: StaffLogisticsSite | string | null;
  /** Persisted destination office from ST pincode search (filled once on create). */
  courierDeliveryOffice?: LogisticsCourierDeliveryOffice | null;
  /** Persisted Firestore snapshot — shown as-is until the user refreshes. */
  cachedTrack?: LogisticsCourierTrack | null;
  onTrackUpdated?: (track: CourierTrackResult) => void;
}

function branchContactForSite(
  provider: CourierTrackProvider,
  site: string | null | undefined,
): string | null {
  if (!isStaffLogisticsSite(site)) return null;
  const contact = LOGISTICS_BRANCH_TRACKING_CONTACTS[provider]?.[site]?.trim();
  return contact || null;
}

function phoneHrefFromContact(contact: string): string | null {
  const match = /(?:PH(?:O(?:NE)?)?|TEL)\s*:?\s*([0-9]{8,15})/i.exec(contact);
  return match?.[1] ? `tel:${match[1]}` : null;
}

export const StCourierTrackPanel: React.FC<StCourierTrackPanelProps> = ({
  awb,
  bookingId,
  provider = 'st_courier',
  shipFromSite,
  courierDeliveryOffice,
  cachedTrack,
  onTrackUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CourierTrackResult | null>(() => {
    if (provider === 'trackon') return trackonTrackFromBooking(cachedTrack);
    if (provider === 'delhivery') return delhiveryTrackFromBooking(cachedTrack);
    if (provider === 'bluedart') return blueDartTrackFromBooking(cachedTrack);
    return stCourierTrackFromBooking(cachedTrack);
  });

  // Keep panel in sync with Firestore booking data (no live courier fetch on open).
  useEffect(() => {
    setResult(
      provider === 'trackon'
        ? trackonTrackFromBooking(cachedTrack)
        : provider === 'delhivery'
          ? delhiveryTrackFromBooking(cachedTrack)
          : provider === 'bluedart'
            ? blueDartTrackFromBooking(cachedTrack)
            : stCourierTrackFromBooking(cachedTrack),
    );
    // Failed tracks map to Booked — don't surface raw courier error text.
    setError('');
  }, [cachedTrack, provider]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const next = provider === 'trackon'
        ? await fetchTrackonShipmentTrack(awb, { bookingId })
        : provider === 'delhivery'
          ? await fetchDelhiveryShipmentTrack(awb, { bookingId })
          : provider === 'bluedart'
            ? await fetchBlueDartShipmentTrack({ awb, bookingId })
            : await fetchStCourierShipmentTrack(awb, { bookingId });
      setResult(next);
      onTrackUpdated?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch status.');
    } finally {
      setLoading(false);
    }
  };

  const fetchedLabel = formatLogisticsDateTime(result?.fetchedAt);
  const hasSnapshot = Boolean(result);
  const branchContact = branchContactForSite(provider, shipFromSite);
  const bookingPhoneHref = branchContact ? phoneHrefFromContact(branchContact) : null;
  const deliveryOffice = courierDeliveryOffice?.communication?.trim() || null;
  const deliveryPhoneHref = deliveryOffice ? phoneHrefFromContact(deliveryOffice) : null;

  return (
    <section className="logistics-booking__track-panel" aria-label="Shipment tracking">
        <div className="logistics-booking__track-panel-head logistics-booking__section-head" data-section-label="Tracking">
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
                {result.bookedAt && (
                  <div><dt>Booked</dt><dd>{formatLogisticsDateTimeLabel(result.bookedAt)}</dd></div>
                )}
                {result.deliveredAt && (
                  <div><dt>Delivered</dt><dd>{formatLogisticsDateTimeLabel(result.deliveredAt)}</dd></div>
                )}
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
                            <time className="logistics-booking__track-timeline-at">
                              {formatLogisticsDateTimeLabel(item.at)}
                            </time>
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
    </section>
  );
};
