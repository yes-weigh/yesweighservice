import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  LayoutGrid,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Truck,
  X,
} from 'lucide-react';
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
import { isLogisticsPartnerId } from '../../constants/logisticsPartners';
import type { LogisticsPartnerId } from '../../constants/logisticsPartners';
import {
  ENABLED_LOGISTICS_PARTNER_IDS,
  LOGISTICS_DASHBOARD_STATUSES,
  isIncompleteLogisticsBooking,
  needsFinalPackagePhoto,
} from '../../lib/logisticsBooking';
import {
  bookingToWizardState,
  canCreateLogisticsBooking,
  cancelLogisticsBooking,
  clampWizardStepForDraftPhotos,
  deleteLogisticsBookingPermanently,
  fetchLogisticsBooking,
  subscribeLogisticsBookings,
  updateLogisticsBookingStatus,
  type LogisticsBookingListFilters,
} from '../../lib/logisticsBookings';
import { extractCityState, resolveDestinationPlace } from '../../lib/shippingLabel';
import { logisticsTrackingUrl } from '../../lib/logisticsTracking';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { LogisticsBooking, LogisticsBookingDraft, LogisticsBookingStatus } from '../../types/logistics-dispatch';
import {
  LOGISTICS_ENTRY_STATE_KEY,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';
import type { BookCourierStep } from '../../lib/logisticsBooking';
import { emptyShipmentBoxDraft } from '../../lib/logisticsBooking';
import type { StaffLogisticsSite } from '../../types/staff-logistics';

type FlowStep = 'closed' | 'partner' | 'book';
type CardTone = 'all' | 'incomplete' | 'label' | 'shipped' | 'transit' | 'delivered' | 'exception';
type StatFilterId = 'all' | LogisticsBookingStatus;

const STATUS_STAT_META: ReadonlyArray<{
  id: StatFilterId;
  label: string;
  shortLabel: string;
  Icon: typeof Package;
  tone: CardTone;
}> = [
  { id: 'all', label: 'All', shortLabel: 'All', Icon: LayoutGrid, tone: 'all' },
  { id: 'label_generated', label: 'Label Generated', shortLabel: 'Label', Icon: Tag, tone: 'label' },
  { id: 'shipped', label: 'Shipped', shortLabel: 'Shipped', Icon: PackageCheck, tone: 'shipped' },
  { id: 'in_transit', label: 'In Transit', shortLabel: 'Transit', Icon: Truck, tone: 'transit' },
  { id: 'delivered', label: 'Delivered', shortLabel: 'Delivered', Icon: CheckCircle2, tone: 'delivered' },
  { id: 'cancelled', label: 'Cancelled', shortLabel: 'Cancel', Icon: AlertCircle, tone: 'exception' },
];

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

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function isDefaultDateRange(range: { from: string; to: string }): boolean {
  const defaults = defaultDateRange();
  return range.from === defaults.from && range.to === defaults.to;
}

function bookingTimestamp(booking: LogisticsBooking): number {
  const raw = booking.createdAt || booking.bookingDate || booking.updatedAt;
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) return ms;
  if (/^\d{4}-\d{2}-\d{2}$/.test(booking.bookingDate)) {
    return Date.parse(`${booking.bookingDate}T00:00:00`);
  }
  return 0;
}

function inDateRange(booking: LogisticsBooking, from: string, to: string): boolean {
  const ts = bookingTimestamp(booking);
  if (!ts) return true;
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T23:59:59.999`);
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return ts >= start && ts <= end;
}

function formatShipmentDateTime(booking: LogisticsBooking): string {
  const ts = bookingTimestamp(booking);
  if (!ts) return booking.bookingDate || '—';
  const date = new Date(ts);
  const day = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} | ${time}`;
}

function cardToneForStatus(booking: LogisticsBooking): CardTone {
  if (isIncompleteLogisticsBooking(booking)) return 'incomplete';
  switch (booking.status) {
    case 'label_generated':
      return 'label';
    case 'shipped':
      return 'shipped';
    case 'in_transit':
      return 'transit';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
      return 'exception';
    default:
      return 'incomplete';
  }
}

function statusBadgeLabel(booking: LogisticsBooking): string {
  if (isIncompleteLogisticsBooking(booking)) return 'Incomplete';
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.status === 'label_generated') return 'Label Generated';
  if (booking.status === 'shipped') return 'Shipped';
  if (booking.status === 'in_transit') return 'In Transit';
  if (booking.status === 'delivered') return 'Delivered';
  return booking.status;
}

const ORIGIN_PLACE_FALLBACK: Record<StaffLogisticsSite, string> = {
  cochin: 'Kochi, Kerala',
  head_office: 'Head Office',
};

function originPlaceLabel(booking: LogisticsBooking): string {
  const fromAddress = booking.shipFromAddress?.trim() || '';
  return extractCityState(fromAddress)
    || ORIGIN_PLACE_FALLBACK[booking.shipFromSite]
    || 'Origin';
}

function destinationPlaceLabel(booking: LogisticsBooking): string {
  return resolveDestinationPlace(booking.dealer, booking.deliveryAddress);
}

function packageCountLabel(booking: LogisticsBooking): string {
  if (booking.shipmentMode === 'envelope') {
    return '1 envelope';
  }
  const count = Math.max(1, Number(booking.numberOfBoxes) || booking.boxes?.length || 1);
  return count === 1 ? '1 box' : `${count} boxes`;
}

function showsRoute(status: LogisticsBookingStatus): boolean {
  return status === 'label_generated' || status === 'shipped' || status === 'in_transit';
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
  const [statusFilter, setStatusFilter] = useState<LogisticsBookingStatus | ''>('');
  const [dateRange, setDateRange] = useState(defaultDateRange);

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
      // Status is filtered client-side so summary tiles stay stable.
      { partnerId: filters.partnerId, query: filters.query },
    );
    return unsubscribe;
  }, [user, filters.partnerId, filters.query]);

  const datedBookings = useMemo(
    () => bookings.filter(booking => inDateRange(booking, dateRange.from, dateRange.to)),
    [bookings, dateRange.from, dateRange.to],
  );

  const pipelineBookings = useMemo(
    () => datedBookings.filter(booking => !isIncompleteLogisticsBooking(booking)),
    [datedBookings],
  );

  const rangedBookings = useMemo(() => {
    const activeStatus = statusFilter || filters.status || '';
    const source = activeStatus ? pipelineBookings : datedBookings;
    if (!activeStatus) return source;
    return source.filter(booking => booking.status === activeStatus);
  }, [datedBookings, pipelineBookings, filters.status, statusFilter]);

  const stats = useMemo(() => {
    const counts: Record<StatFilterId, number> = {
      all: datedBookings.length,
      label_generated: 0,
      shipped: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const booking of pipelineBookings) {
      counts[booking.status] += 1;
    }
    return counts;
  }, [datedBookings.length, pipelineBookings]);

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
      const rawStep = needsFinalPackagePhoto(hydrated)
        ? 'final_photo' as BookCourierStep
        : (
          ['scan', 'address', 'box', 'review', 'label', 'final_photo'] as BookCourierStep[]
        ).includes(wizard.step as BookCourierStep)
          ? wizard.step as BookCourierStep
          : 'box';
      const step = clampWizardStepForDraftPhotos(rawStep, draft.boxes ?? []);
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

  const handleDraftUpdated = useCallback((booking: LogisticsBooking) => {
    setBookings(prev => {
      const rest = prev.filter(item => item.id !== booking.id);
      return [booking, ...rest];
    });
    setResumeBookingId(booking.id);
    setError('');
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
    const ok = window.confirm(
      'Permanently delete this logistics booking from Firestore? Photos will be removed too. This cannot be undone.',
    );
    if (!ok) return;
    try {
      await deleteLogisticsBookingPermanently(bookingId, user);
      setBookings(prev => prev.filter(item => item.id !== bookingId));
      setActiveBookingId(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete shipment.');
    }
  }, [user]);

  const openBooking = useCallback((booking: LogisticsBooking) => {
    if (isIncompleteLogisticsBooking(booking) || needsFinalPackagePhoto(booking)) {
      void openResumeDraft(booking);
      return;
    }
    setActiveBookingId(booking.id);
    void fetchLogisticsBooking(booking.id)
      .then(hydrated => {
        if (hydrated) handleUpdateBooking(hydrated);
      })
      .catch(() => undefined);
  }, [openResumeDraft, handleUpdateBooking]);

  const closeBooking = useCallback(() => {
    setActiveBookingId(null);
  }, []);

  const applyStatFilter = useCallback((status: StatFilterId) => {
    setFilters(prev => ({ ...prev, status: '' }));
    if (status === 'all') {
      setStatusFilter('');
      return;
    }
    setStatusFilter(prev => (prev === status ? '' : status));
  }, []);

  const showListControls = isOps && !flowOpen && !activeBooking;
  const hasActiveFilters = Boolean(filters.status)
    || Boolean(filters.partnerId)
    || Boolean(statusFilter)
    || !isDefaultDateRange(dateRange);
  const hasSearchQuery = Boolean(filters.query?.trim());

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
    {
      mobileCompactHeader: isMobile && showListControls,
      subtitle: !flowOpen && !activeBooking ? 'All Shipments' : null,
      showBack: Boolean(activeBooking) && !flowOpen,
      onBack: closeBooking,
    },
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

            <div className="logistics-filter-field logistics-filter-field--dates" role="group" aria-label="Shipment date range">
              <span>Date range</span>
              <div className="logistics-filter-dates">
                <label>
                  <span>From</span>
                  <input
                    type="date"
                    value={dateRange.from}
                    max={dateRange.to}
                    onChange={event => setDateRange(prev => ({ ...prev, from: event.target.value }))}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={dateRange.to}
                    min={dateRange.from}
                    onChange={event => setDateRange(prev => ({ ...prev, to: event.target.value }))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="logistics-filter-dates__preset"
                onClick={() => setDateRange(defaultDateRange())}
              >
                <CalendarDays size={14} aria-hidden />
                Last 30 days
              </button>
            </div>

            <label className="logistics-filter-field">
              <span>Status</span>
              <select
                value={filters.status ?? ''}
                onChange={event => {
                  setStatusFilter('');
                  setFilters(prev => ({
                    ...prev,
                    status: event.target.value as LogisticsBookingStatus | '',
                  }));
                }}
              >
                <option value="">All statuses</option>
                {LOGISTICS_DASHBOARD_STATUSES.map(item => (
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
              onClick={() => {
                setStatusFilter('');
                setDateRange(defaultDateRange());
                setFilters(prev => ({ ...prev, status: '', partnerId: '' }));
              }}
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
      ) : (
        <div className="logistics-page__dashboard">
          <div className="logistics-page__stats" role="group" aria-label="Shipment summary">
            {STATUS_STAT_META.map(stat => {
              const count = stats[stat.id];
              const active = stat.id === 'all'
                ? !statusFilter && !filters.status
                : statusFilter === stat.id
                  || (!statusFilter && filters.status === stat.id);
              const empty = count === 0 && !active;
              return (
                <button
                  key={stat.id}
                  type="button"
                  className={[
                    'logistics-page__stat',
                    `logistics-page__stat--${stat.tone}`,
                    active ? 'is-active' : '',
                    empty ? 'is-empty' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => applyStatFilter(stat.id)}
                  title={stat.label}
                  aria-pressed={active}
                >
                  <strong>{count}</strong>
                  <span>
                    <stat.Icon size={11} aria-hidden />
                    <em>{stat.shortLabel}</em>
                  </span>
                </button>
              );
            })}
          </div>

          {rangedBookings.length === 0 ? (
            <div className="logistics-page__empty panel glass">
              <Truck size={40} aria-hidden />
              <h3>{hasActiveFilters || hasSearchQuery ? 'No matching shipments' : 'No shipments in range'}</h3>
              <p className="text-muted text-sm">
                {hasActiveFilters || hasSearchQuery
                  ? 'Try clearing filters or search to see more logistics bookings.'
                  : canCreate
                    ? 'Book courier shipments, generate slips, and track delivery from booking to doorstep.'
                    : 'Your courier shipments will appear here once booked by YesOne logistics.'}
              </p>
              {(hasActiveFilters || hasSearchQuery) ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setStatusFilter('');
                    setFilters({ status: '', partnerId: '', query: '' });
                  }}
                >
                  Clear filters
                </button>
              ) : canCreate ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openFlow}>
                  Add Logistics
                </button>
              ) : null}
            </div>
          ) : (
            <section className="logistics-page__list" aria-label="Logistics bookings">
              <ul className="logistics-page__entries">
                {rangedBookings.map(booking => {
                  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
                  const tone = cardToneForStatus(booking);
                  const waybill = booking.trackingNo || booking.consignmentNo || '—';
                  const trackUrl = logisticsTrackingUrl(booking.partnerId, waybill);
                  return (
                    <li key={booking.id}>
                      <article className={`logistics-shipment logistics-shipment--${tone}`}>
                        <button
                          type="button"
                          className="logistics-shipment__main"
                          onClick={() => openBooking(booking)}
                        >
                          <span className="logistics-shipment__logo" aria-hidden>
                            {partner ? (
                              <img src={partner.image} alt="" />
                            ) : (
                              <Package size={20} />
                            )}
                          </span>

                          <div className="logistics-shipment__body">
                            <strong className="logistics-shipment__tracking">
                              {trackUrl ? (
                                <a
                                  href={trackUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={event => event.stopPropagation()}
                                >
                                  {waybill}
                                </a>
                              ) : (
                                waybill
                              )}
                            </strong>

                            <span className="logistics-shipment__dealer">{booking.dealer.name}</span>

                            {showsRoute(booking.status) ? (
                              <div className="logistics-shipment__route">
                                <span className="logistics-shipment__place logistics-shipment__place--from">
                                  <MapPin size={12} aria-hidden />
                                  <span>{originPlaceLabel(booking)}</span>
                                </span>
                                <span className="logistics-shipment__route-arrow" aria-hidden>→</span>
                                <span className="logistics-shipment__place logistics-shipment__place--to">
                                  <MapPin size={12} aria-hidden />
                                  <span>{destinationPlaceLabel(booking)}</span>
                                </span>
                              </div>
                            ) : booking.status === 'delivered' ? (
                              <div className="logistics-shipment__outcome logistics-shipment__outcome--delivered">
                                <CheckCircle2 size={14} aria-hidden />
                                <span>Delivered on {formatShipmentDateTime(booking)}</span>
                              </div>
                            ) : booking.status === 'cancelled' ? (
                              <div className="logistics-shipment__outcome logistics-shipment__outcome--exception">
                                <AlertCircle size={14} aria-hidden />
                                <span>Exception · {formatShipmentDateTime(booking)}</span>
                              </div>
                            ) : null}

                            <div className="logistics-shipment__meta">
                              <span className="logistics-shipment__meta-info">
                                <CalendarDays size={12} aria-hidden />
                                <span>{formatShipmentDateTime(booking)}</span>
                                <span className="logistics-shipment__sep" aria-hidden>·</span>
                                <Package size={12} aria-hidden />
                                <span>{packageCountLabel(booking)}</span>
                              </span>
                              <span className={`logistics-shipment__badge logistics-shipment__badge--${tone}`}>
                                {statusBadgeLabel(booking)}
                              </span>
                            </div>
                          </div>

                          <ChevronRight size={18} className="logistics-shipment__chevron" aria-hidden />
                        </button>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {flowStep === 'partner' && (
        <CourierPartnerPicker
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
          onDraftUpdated={handleDraftUpdated}
        />
      )}
    </div>
  );
};
