import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, Search, Truck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { BookCourierFlow } from '../../components/logistics/BookCourierFlow';
import { CourierPartnerPicker } from '../../components/logistics/CourierPartnerPicker';
import { LogisticsBookingDetail } from '../../components/logistics/LogisticsBookingDetail';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { isLogisticsPartnerId, logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { LOGISTICS_BOOKING_STATUSES } from '../../lib/logisticsBooking';
import {
  canCreateLogisticsBooking,
  cancelLogisticsBooking,
  deleteLogisticsBookingPermanently,
  subscribeLogisticsBookings,
  updateLogisticsBookingStatus,
  type LogisticsBookingListFilters,
} from '../../lib/logisticsBookings';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { LogisticsBooking, LogisticsBookingStatus } from '../../types/logistics-dispatch';
import {
  LOGISTICS_ENTRY_STATE_KEY,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';

type FlowStep = 'closed' | 'partner' | 'book';

export const LogisticsPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [flowStep, setFlowStep] = useState<FlowStep>('closed');
  const [selectedPartnerId, setSelectedPartnerId] = useState<LogisticsPartnerId | null>(null);
  const [pendingEntry, setPendingEntry] = useState<LogisticsEntryState | null>(null);
  const [bookings, setBookings] = useState<LogisticsBooking[]>([]);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<LogisticsBookingListFilters>({
    status: '',
    partnerId: '',
    query: '',
  });

  const isOps = user ? isInternalOpsUser(user) : false;
  const canCreate = user ? canCreateLogisticsBooking(user) : false;

  const activeBooking = useMemo(
    () => bookings.find(item => item.id === activeBookingId) ?? null,
    [bookings, activeBookingId],
  );

  const flowOpen = flowStep !== 'closed';

  useEffect(() => {
    if (!canCreate) return;
    const state = location.state as Record<string, unknown> | null;
    const entry = state?.[LOGISTICS_ENTRY_STATE_KEY] as LogisticsEntryState | undefined;
    if (!entry?.draftPatch) return;
    setPendingEntry(entry);
    setFlowStep('partner');
    setSelectedPartnerId(null);
    navigate(location.pathname, { replace: true, state: null });
  }, [canCreate, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsubscribe = subscribeLogisticsBookings(
      user,
      next => {
        setBookings(next);
        setLoading(false);
        setError('');
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
      filters,
    );
    return unsubscribe;
  }, [user, filters.status, filters.partnerId, filters.query]);

  const openFlow = useCallback(() => {
    setFlowStep('partner');
    setSelectedPartnerId(null);
  }, []);

  const closeFlow = useCallback(() => {
    setFlowStep('closed');
    setSelectedPartnerId(null);
    setPendingEntry(null);
  }, []);

  const handlePartnerSelect = useCallback((methodId: string) => {
    if (!isLogisticsPartnerId(methodId)) return;
    setSelectedPartnerId(methodId);
    setFlowStep('book');
  }, []);

  const handleBookingComplete = useCallback((booking: LogisticsBooking) => {
    setBookings(prev => {
      const rest = prev.filter(item => item.id !== booking.id);
      return [booking, ...rest];
    });
    setActiveBookingId(booking.id);
    closeFlow();
  }, [closeFlow]);

  const handleUpdateBooking = useCallback((next: LogisticsBooking) => {
    setBookings(prev => prev.map(item => (item.id === next.id ? next : item)));
  }, []);

  const handleAdvanceStatus = useCallback(async (
    booking: LogisticsBooking,
    status: LogisticsBookingStatus,
  ) => {
    if (!user) return;
    try {
      const updated = await updateLogisticsBookingStatus(booking, status, user);
      handleUpdateBooking(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    }
  }, [user, handleUpdateBooking]);

  const handleCancel = useCallback(async (booking: LogisticsBooking) => {
    if (!user) return;
    try {
      const updated = await cancelLogisticsBooking(booking, user);
      handleUpdateBooking(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel shipment.');
    }
  }, [user, handleUpdateBooking]);

  const handleDelete = useCallback(async (bookingId: string) => {
    if (!user) return;
    try {
      await deleteLogisticsBookingPermanently(bookingId, user);
      setBookings(prev => prev.filter(item => item.id !== bookingId));
      setActiveBookingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete shipment.');
    }
  }, [user]);

  const topBarAction = useMemo(
    () => (canCreate ? (
      <button
        type="button"
        className="cart-header-btn cart-header-btn--primary"
        onClick={openFlow}
        aria-label="Add logistics"
        title="Add logistics"
      >
        <Plus size={22} />
      </button>
    ) : null),
    [canCreate, openFlow],
  );

  useTopBarAction(topBarAction, !flowOpen && canCreate);

  return (
    <div className="page-content fade-in logistics-page">
      {isOps && (
        <section className="logistics-page__filters panel glass" aria-label="Logistics filters">
          <label className="logistics-page__filter-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={filters.query ?? ''}
              onChange={event => setFilters(prev => ({ ...prev, query: event.target.value }))}
              placeholder="Search consignment, dealer, invoice…"
            />
          </label>
          <select
            value={filters.status ?? ''}
            onChange={event => setFilters(prev => ({
              ...prev,
              status: event.target.value as LogisticsBookingStatus | '',
            }))}
          >
            <option value="">All statuses</option>
            {LOGISTICS_BOOKING_STATUSES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <select
            value={filters.partnerId ?? ''}
            onChange={event => setFilters(prev => ({
              ...prev,
              partnerId: event.target.value as LogisticsPartnerId | '',
            }))}
          >
            <option value="">All partners</option>
            {LOGISTICS_PARTNERS.map(partner => (
              <option key={partner.id} value={partner.id}>{partner.label}</option>
            ))}
          </select>
        </section>
      )}

      {error && <p className="logistics-page__error text-sm">{error}</p>}

      {loading ? (
        <div className="logistics-page__empty panel glass">
          <div className="loader-ring" />
        </div>
      ) : activeBooking ? (
        <LogisticsBookingDetail
          booking={activeBooking}
          isOps={isOps}
          onUpdate={handleUpdateBooking}
          onAdvanceStatus={status => void handleAdvanceStatus(activeBooking, status)}
          onCancel={() => void handleCancel(activeBooking)}
          onDelete={() => void handleDelete(activeBooking.id)}
        />
      ) : bookings.length === 0 ? (
        <div className="logistics-page__empty panel glass">
          <Truck size={40} aria-hidden />
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            {canCreate
              ? 'Book courier shipments, generate slips, and track delivery from booking to doorstep.'
              : 'Your courier shipments will appear here once booked by YesOne logistics.'}
          </p>
          {canCreate && (
            <button type="button" className="btn btn-primary btn-sm" onClick={openFlow}>
              Add Logistics
            </button>
          )}
        </div>
      ) : (
        <section className="logistics-page__list panel glass" aria-label="Logistics bookings">
          <h3 className="logistics-page__list-title">Logistics bookings</h3>
          <ul className="logistics-page__entries">
            {bookings.map(booking => {
              const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
              const statusLabel = LOGISTICS_BOOKING_STATUSES.find(item => item.id === booking.status)?.label;
              return (
                <li key={booking.id}>
                  <button
                    type="button"
                    className="logistics-page__entry logistics-page__entry--button"
                    onClick={() => setActiveBookingId(booking.id)}
                  >
                    <span className="logistics-page__entry-logo-wrap" aria-hidden>
                      {partner ? (
                        <img src={partner.image} alt="" className="logistics-page__entry-logo" />
                      ) : (
                        <Package size={18} />
                      )}
                    </span>
                    <div className="logistics-page__entry-copy">
                      <strong>{logisticsPartnerLabel(booking.partnerId)}</strong>
                      <span className="text-muted text-sm">
                        {booking.dealer.name} · {booking.trackingNo}
                      </span>
                      <span className={`logistics-page__entry-status logistics-page__entry-status--${booking.status}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeBooking && bookings.length > 1 && (
        <button
          type="button"
          className="btn btn-secondary btn-sm logistics-page__back-list"
          onClick={() => setActiveBookingId(null)}
        >
          View all bookings
        </button>
      )}

      {flowStep === 'partner' && (
        <CourierPartnerPicker
          partners={LOGISTICS_PARTNERS}
          titleLead="LOGISTIC"
          titleAccent="PARTNER"
          subtitle="Select a logistics partner to book courier"
          ariaLabel="Logistics partners"
          onClose={closeFlow}
          onSelect={handlePartnerSelect}
        />
      )}

      {flowStep === 'book' && selectedPartnerId && user && (
        <BookCourierFlow
          partnerId={selectedPartnerId}
          user={user}
          initialDraft={pendingEntry?.draftPatch}
          initialDealerQuery={pendingEntry?.dealerQuery}
          onClose={closeFlow}
          onComplete={handleBookingComplete}
        />
      )}
    </div>
  );
};
