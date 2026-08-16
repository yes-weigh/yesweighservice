import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, Truck, X } from 'lucide-react';
import { LOGISTICS_PARTNERS, logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { useAuth } from '../../context/AuthContext';
import { createDelhiveryPickupRequest } from '../../lib/delhiveryB2b';
import { formatLogisticsDateTimeLabel } from '../../lib/logisticsDateTime';
import {
  fetchLogisticsBookingsByPickupDate,
  updateLogisticsBookingsDelhiveryPickup,
} from '../../lib/logisticsBookings';
import {
  countPickupsToday,
  groupPickupsToday,
  isPickupCapablePartner,
  istCalendarDate,
  mergePickupBookings,
  type LogisticsPickupTodayGroup,
} from '../../lib/logisticsPickupsToday';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { staffLogisticsSiteLabel } from '../../types/staff-logistics';
import type { LogisticsBooking, LogisticsDelhiveryPickup } from '../../types/logistics-dispatch';

type Props = {
  bookings: LogisticsBooking[];
  partnerFilter: LogisticsPartnerId | '';
  onClose: () => void;
  onOpenBooking: (booking: LogisticsBooking) => void;
  onBookingsUpdated: (bookings: LogisticsBooking[]) => void;
};

function partnerLogo(partnerId: string): string | null {
  return LOGISTICS_PARTNERS.find(partner => partner.id === partnerId)?.image ?? null;
}

export const LogisticsPickupsTodayDialog: React.FC<Props> = ({
  bookings,
  partnerFilter,
  onClose,
  onOpenBooking,
  onBookingsUpdated,
}) => {
  const { user } = useAuth();
  const isOps = user ? isInternalOpsUser(user) : false;
  const today = useMemo(() => istCalendarDate(), []);
  const [extraBookings, setExtraBookings] = useState<LogisticsBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestingKey, setRequestingKey] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !requestingKey) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, requestingKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchLogisticsBookingsByPickupDate(today)
      .then(rows => {
        if (active) setExtraBookings(rows);
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load today’s pickups.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [today]);

  const merged = useMemo(
    () => mergePickupBookings(bookings, extraBookings),
    [bookings, extraBookings],
  );
  const groups = useMemo(
    () => groupPickupsToday(merged, partnerFilter, today),
    [merged, partnerFilter, today],
  );
  const counts = useMemo(
    () => countPickupsToday(merged, partnerFilter, today),
    [merged, partnerFilter, today],
  );
  const partnerTitle = partnerFilter
    ? logisticsPartnerLabel(partnerFilter)
    : 'All partners';
  const capable = !partnerFilter || isPickupCapablePartner(partnerFilter);

  const requestGroup = useCallback(async (group: LogisticsPickupTodayGroup) => {
    if (!user || !isOps || !group.canRequest) return;
    setRequestingKey(group.key);
    setError('');
    try {
      const boxes = group.bookings.reduce((sum, booking) => (
        sum + Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1)
      ), 0);
      const result = await createDelhiveryPickupRequest({
        shipFromSite: group.shipFromSite,
        expectedPackageCount: Math.max(1, boxes),
        pickupDate: group.pickupDate || today,
      });
      const pickup: LogisticsDelhiveryPickup = {
        ok: result.ok === true,
        alreadyExisted: result.alreadyExisted === true,
        pickupId: result.pickupId?.trim() || null,
        pickupLocationName: result.pickupLocationName ?? null,
        pickupDate: result.pickupDate ?? group.pickupDate ?? today,
        pickupTime: result.pickupTime ?? null,
        expectedPackageCount: result.expectedPackageCount ?? boxes,
        message: result.message ?? null,
        requestedAt: result.requestedAt || new Date().toISOString(),
      };
      const updated = await updateLogisticsBookingsDelhiveryPickup(group.bookings, pickup, user);
      onBookingsUpdated(updated);
      setExtraBookings(prev => mergePickupBookings(prev, updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create pickup request.');
    } finally {
      setRequestingKey('');
    }
  }, [isOps, onBookingsUpdated, today, user]);

  const pendingGroups = groups.filter(group => group.kind === 'pending' && group.canRequest);
  const requestAll = useCallback(async () => {
    for (const group of pendingGroups) {
      await requestGroup(group);
    }
  }, [pendingGroups, requestGroup]);

  return createPortal(
    <div className="dealers-modal-backdrop" role="presentation" onClick={() => !requestingKey && onClose()}>
      <div
        className="dealers-modal panel glass logistics-pickups-today"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logistics-pickups-today-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="dealers-modal__header">
          <div>
            <h3 id="logistics-pickups-today-title">Pickup requests today</h3>
            <p className="text-muted text-sm">
              {formatLogisticsDateTimeLabel(today)} · {partnerTitle}
              {counts.total
                ? ` · ${counts.requested} requested${counts.pending ? `, ${counts.pending} pending` : ''}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            className="dealers-modal__close"
            aria-label="Close"
            disabled={Boolean(requestingKey)}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="logistics-pickups-today__body">
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          {loading ? (
            <p className="text-muted text-sm">Loading today’s pickups…</p>
          ) : !capable ? (
            <p className="text-muted text-sm">
              {partnerTitle} has no pickup API. Choose Delhivery or Blue Dart, or clear the partner filter.
            </p>
          ) : groups.length === 0 ? (
            <p className="text-muted text-sm">
              No pickup requests for today{partnerFilter ? ` on ${partnerTitle}` : ''}.
            </p>
          ) : (
            <ul className="logistics-pickups-today__groups">
              {groups.map(group => {
                const logo = partnerLogo(group.partnerId);
                const busy = requestingKey === group.key;
                return (
                  <li key={group.key} className={`logistics-pickups-today__group is-${group.kind}`}>
                    <div className="logistics-pickups-today__group-head">
                      <span className="logistics-pickups-today__logo" aria-hidden>
                        {logo ? <img src={logo} alt="" /> : <Truck size={16} />}
                      </span>
                      <div className="logistics-pickups-today__group-meta">
                        <strong>
                          {group.kind === 'pending' ? 'Needs pickup' : 'Requested'}
                          {' · '}
                          {group.partnerLabel}
                        </strong>
                        <span>
                          {staffLogisticsSiteLabel(group.shipFromSite)}
                          {group.locationName ? ` · ${group.locationName}` : ''}
                          {group.pickupId ? ` · ${group.pickupId}` : ''}
                          {group.alreadyExisted ? ' · already open' : ''}
                        </span>
                        {group.message ? <em>{group.message}</em> : null}
                      </div>
                      {isOps && group.canRequest ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={Boolean(requestingKey)}
                          onClick={() => { void requestGroup(group); }}
                        >
                          {busy ? 'Requesting…' : 'Request pickup'}
                        </button>
                      ) : null}
                    </div>
                    <ul className="logistics-pickups-today__shipments">
                      {group.bookings.map(booking => (
                        <li key={booking.id}>
                          <button
                            type="button"
                            className="logistics-pickups-today__shipment"
                            onClick={() => {
                              onOpenBooking(booking);
                              onClose();
                            }}
                          >
                            <Package size={14} aria-hidden />
                            <span>
                              <strong>{booking.consignmentNo || booking.trackingNo || '—'}</strong>
                              <small>
                                {booking.dealer.name}
                                {booking.dealer.contactPerson ? ` · ${booking.dealer.contactPerson}` : ''}
                                {' · '}
                                {Math.max(1, booking.numberOfBoxes || booking.boxes.length || 1)} boxes
                              </small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {isOps && pendingGroups.length > 1 ? (
          <div className="dealers-modal__actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={Boolean(requestingKey)}
              onClick={() => { void requestAll(); }}
            >
              Request all missing Delhivery pickups
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
