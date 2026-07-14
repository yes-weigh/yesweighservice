import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, Plus, Search, SlidersHorizontal, Truck, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  useCatalogPageHeader,
  usePageHeaderSlot,
  useTopBarAction,
} from '../../context/PageHeaderContext';
import { BookCourierFlow } from '../../components/logistics/BookCourierFlow';
import { CourierPartnerPicker } from '../../components/logistics/CourierPartnerPicker';
import { LogisticsBookingDetail } from '../../components/logistics/LogisticsBookingDetail';
import { LOGISTICS_PARTNERS } from '../../constants/logisticsPartners';
import { isLogisticsPartnerId, logisticsPartnerLabel } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import { ENABLED_LOGISTICS_PARTNER_IDS, LOGISTICS_BOOKING_STATUSES } from '../../lib/logisticsBooking';
import {
  canCreateLogisticsBooking,
  cancelLogisticsBooking,
  deleteLogisticsBookingPermanently,
  fetchLogisticsBooking,
  bookingToWizardState,
  subscribeLogisticsBookings,
  updateLogisticsBookingStatus,
  type LogisticsBookingListFilters,
} from '../../lib/logisticsBookings';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { LogisticsBooking, LogisticsBookingDraft, LogisticsBookingStatus } from '../../types/logistics-dispatch';
import {
  LOGISTICS_ENTRY_STATE_KEY,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';
import type { BookCourierStep } from '../../lib/logisticsBooking';
import { emptyShipmentBoxDraft } from '../../lib/logisticsBooking';

type FlowStep = 'closed' | 'partner' | 'book';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

export const LogisticsPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [flowStep, setFlowStep] = useState<FlowStep>('closed');
  const [selectedPartnerId, setSelectedPartnerId] = useState<LogisticsPartnerId | null>(null);
  const [pendingEntry, setPendingEntry] = useState<LogisticsEntryState | null>(null);
  const [resumeBookingId, setResumeBookingId] = useState<string | null>(null);
  const [resumeDraft, setResumeDraft] = useState<Partial<LogisticsBookingDraft> | null>(null);
  const [resumeStep, setResumeStep] = useState<BookCourierStep | undefined>(undefined);
  const [resumeDealerQuery, setResumeDealerQuery] = useState<string | undefined>(undefined);
  const [bookings, setBookings] = useState<LogisticsBooking[]>([]);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<LogisticsBookingListFilters>({
    status: '',
    partnerId: '',
    query: '',
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isMobile = useIsMobile();
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
    setResumeBookingId(null);
    setResumeDraft(null);
    setResumeStep(undefined);
    setResumeDealerQuery(undefined);
  }, []);

  const openResumeDraft = useCallback(async (booking: LogisticsBooking) => {
    if (!canCreate) return;
    setError('');
    try {
      const hydrated = await fetchLogisticsBooking(booking.id) ?? booking;
      const wizard = bookingToWizardState(hydrated);
      const draft: Partial<LogisticsBookingDraft> = {
        ...wizard.draft,
        boxes: wizard.draft.boxes.length ? wizard.draft.boxes : [emptyShipmentBoxDraft()],
      };
      const step = (
        ['scan', 'address', 'box', 'review', 'label', 'final_photo'] as BookCourierStep[]
      ).includes(wizard.step as BookCourierStep)
        ? wizard.step as BookCourierStep
        : 'box';
      setResumeBookingId(hydrated.id);
      setResumeDraft(draft);
      setResumeStep(step);
      setResumeDealerQuery(wizard.dealerQuery);
      setSelectedPartnerId(hydrated.partnerId);
      setPendingEntry(null);
      setActiveBookingId(null);
      setFlowStep('book');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open draft.');
    }
  }, [canCreate]);

  const handlePartnerSelect = useCallback((methodId: string) => {
    if (!isLogisticsPartnerId(methodId)) return;
    if (!ENABLED_LOGISTICS_PARTNER_IDS.includes(methodId)) return;
    setSelectedPartnerId(methodId);
    setFlowStep('book');
  }, []);

  const handleDraftSaved = useCallback((booking: LogisticsBooking) => {
    setBookings(prev => {
      const rest = prev.filter(item => item.id !== booking.id);
      return [booking, ...rest];
    });
    setError('');
    closeFlow();
  }, [closeFlow]);

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

  const showListControls = isOps && !flowOpen && !activeBooking;
  const hasActiveFilters = Boolean(filters.status) || Boolean(filters.partnerId);

  useEffect(() => {
    if (!showListControls) setFiltersOpen(false);
  }, [showListControls]);

  const headerSearch = useMemo(
    () => (
      <div className="catalog-search invoices-header-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          value={filters.query ?? ''}
          onChange={event => setFilters(prev => ({ ...prev, query: event.target.value }))}
          placeholder={isMobile ? 'Search consignment, dealer…' : 'Search consignment, dealer, invoice…'}
          aria-label="Search logistics bookings"
        />
        {filters.query && (
          <button
            type="button"
            className="invoices-header-search__clear"
            onClick={() => setFilters(prev => ({ ...prev, query: '' }))}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
    ),
    [filters.query, isMobile],
  );

  const filterButton = useMemo(
    () => (
      <button
        type="button"
        className={[
          'catalog-header-filter-btn',
          filtersOpen ? 'catalog-header-filter-btn--open' : '',
          hasActiveFilters ? 'catalog-header-filter-btn--active' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setFiltersOpen(open => !open)}
        aria-expanded={filtersOpen}
        aria-haspopup="dialog"
        aria-label="Filter logistics bookings"
        title="Filters"
      >
        <SlidersHorizontal size={20} strokeWidth={2.25} />
      </button>
    ),
    [filtersOpen, hasActiveFilters],
  );

  const addButton = useMemo(
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

  const topBarAction = useMemo(() => {
    const filterEl = showListControls ? filterButton : null;
    if (filterEl && addButton) {
      return (
        <div className="catalog-header-actions">
          {filterEl}
          {addButton}
        </div>
      );
    }
    return filterEl ?? addButton;
  }, [showListControls, filterButton, addButton]);

  useCatalogPageHeader(
    { mobileCompactHeader: isMobile && showListControls },
    true,
  );
  usePageHeaderSlot(headerSearch, showListControls);
  useTopBarAction(topBarAction, !flowOpen && (canCreate || showListControls));

  return (
    <div className="page-content fade-in logistics-page">
      {filtersOpen && showListControls && createPortal(
        <>
          <button
            type="button"
            className="catalog-filter-dropdown__backdrop"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
          <div
            className="catalog-filter-dropdown panel glass logistics-filter-dropdown"
            role="dialog"
            aria-modal="true"
            aria-label="Filter logistics bookings"
          >
            <div className="logistics-filter-dropdown__head">
              <h3>Filters</h3>
              <button
                type="button"
                className="logistics-filter-dropdown__close"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
              >
                <X size={18} />
              </button>
            </div>

            <label className="logistics-filter-field">
              <span>Status</span>
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
            </label>

            <label className="logistics-filter-field">
              <span>Partner</span>
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
            </label>

            <button
              type="button"
              className="logistics-filter-dropdown__clear"
              onClick={() => setFilters(prev => ({ ...prev, status: '', partnerId: '' }))}
              disabled={!hasActiveFilters}
            >
              Clear filters
            </button>
          </div>
        </>,
        document.body,
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
                    onClick={() => {
                      if (booking.status === 'draft') {
                        void openResumeDraft(booking);
                        return;
                      }
                      setActiveBookingId(booking.id);
                    }}
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
          availableIds={ENABLED_LOGISTICS_PARTNER_IDS}
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
          initialDraft={resumeDraft ?? pendingEntry?.draftPatch}
          initialDealerQuery={resumeDealerQuery ?? pendingEntry?.dealerQuery}
          initialStep={resumeStep}
          existingBookingId={resumeBookingId}
          onClose={closeFlow}
          onComplete={handleBookingComplete}
          onDraftSaved={handleDraftSaved}
        />
      )}
    </div>
  );
};
