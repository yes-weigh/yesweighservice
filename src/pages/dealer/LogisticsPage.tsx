import React, { useCallback, useMemo, useState } from 'react';
import { Package, Plus, Truck } from 'lucide-react';
import { useTopBarAction } from '../../context/PageHeaderContext';
import { BookCourierFlow } from '../../components/logistics/BookCourierFlow';
import { CourierPartnerPicker } from '../../components/logistics/CourierPartnerPicker';
import { LogisticsBookingDetail } from '../../components/logistics/LogisticsBookingDetail';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { isLogisticsPartnerId, logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { LOGISTICS_BOOKING_STATUSES } from '../../lib/logisticsBooking';
import type { LogisticsBooking } from '../../types/logistics-dispatch';

type FlowStep = 'closed' | 'partner' | 'book';

export const LogisticsPage: React.FC = () => {
  const [flowStep, setFlowStep] = useState<FlowStep>('closed');
  const [selectedPartnerId, setSelectedPartnerId] = useState<LogisticsPartnerId | null>(null);
  const [bookings, setBookings] = useState<LogisticsBooking[]>([]);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);

  const activeBooking = useMemo(
    () => bookings.find(item => item.id === activeBookingId) ?? null,
    [bookings, activeBookingId],
  );

  const flowOpen = flowStep !== 'closed';

  const openFlow = useCallback(() => {
    setFlowStep('partner');
    setSelectedPartnerId(null);
  }, []);

  const closeFlow = useCallback(() => {
    setFlowStep('closed');
    setSelectedPartnerId(null);
  }, []);

  const handlePartnerSelect = useCallback((methodId: string) => {
    if (!isLogisticsPartnerId(methodId)) return;
    setSelectedPartnerId(methodId);
    setFlowStep('book');
  }, []);

  const handleBookingComplete = useCallback((booking: LogisticsBooking) => {
    setBookings(prev => [booking, ...prev]);
    setActiveBookingId(booking.id);
    closeFlow();
  }, [closeFlow]);

  const handleUpdateBooking = useCallback((next: LogisticsBooking) => {
    setBookings(prev => prev.map(item => (item.id === next.id ? next : item)));
  }, []);

  const handleAdvanceStatus = useCallback((booking: LogisticsBooking, status: LogisticsBooking['status']) => {
    handleUpdateBooking({ ...booking, status });
  }, [handleUpdateBooking]);

  const topBarAction = useMemo(
    () => (
      <button
        type="button"
        className="cart-header-btn cart-header-btn--primary"
        onClick={openFlow}
        aria-label="Add logistics"
        title="Add logistics"
      >
        <Plus size={22} />
      </button>
    ),
    [openFlow],
  );

  useTopBarAction(topBarAction, !flowOpen);

  return (
    <div className="page-content fade-in logistics-page">
      {activeBooking ? (
        <LogisticsBookingDetail
          booking={activeBooking}
          onUpdate={handleUpdateBooking}
          onAdvanceStatus={status => handleAdvanceStatus(activeBooking, status)}
        />
      ) : bookings.length === 0 ? (
        <div className="logistics-page__empty panel glass">
          <Truck size={40} aria-hidden />
          <h3>Logistics</h3>
          <p className="text-muted text-sm">
            Book courier shipments, generate slips, and track delivery from booking to doorstep.
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openFlow}>
            Add Logistics
          </button>
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
                        {booking.orderRef} · {booking.consignmentNo}
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

      {flowStep === 'book' && selectedPartnerId && (
        <BookCourierFlow
          partnerId={selectedPartnerId}
          onClose={closeFlow}
          onComplete={handleBookingComplete}
        />
      )}
    </div>
  );
};
