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
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
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
  STANDALONE_LOGISTICS_PARTNER_IDS,
  LOGISTICS_DASHBOARD_STATUSES,
  isIncompleteLogisticsBooking,
  isPipelineEnabledPartner,
  needsFinalPackagePhoto,
} from '../../lib/logisticsBooking';
import {
  bookingToWizardState,
  canCreateLogisticsBooking,
  canDeleteLogisticsBooking,
  cancelLogisticsBooking,
  returnLogisticsBooking,
  clampWizardStepForDraftPhotos,
  compareLogisticsBookingsByBookingDateDesc,
  deleteLogisticsBookingPermanently,
  fetchLogisticsBooking,
  subscribeLogisticsBookings,
  syncLogisticsShipFromAddressesToAllBookings,
  updateLogisticsBookingStatus,
  type LogisticsBookingListFilters,
} from '../../lib/logisticsBookings';
import { formatCurrency } from '../../lib/catalog';
import { ewayBillListChip } from '../../constants/ewayBill';
import {
  loadLogisticsFreightCompare,
  type LogisticsFreightCompare,
} from '../../lib/logisticsFreightCompare';
import { loadLogisticsCourierRates } from '../../lib/logisticsCourierRates';
import { loadLogisticsSettings } from '../../lib/logisticsSettings';
import { resolveDestinationPlace } from '../../lib/shippingLabel';
import { isInternalOpsUser } from '../../lib/staffAccess';
import type { LogisticsBooking, LogisticsBookingDraft, LogisticsBookingStatus } from '../../types/logistics-dispatch';
import {
  LOGISTICS_ENTRY_STATE_KEY,
  LOGISTICS_OPEN_BOOKING_STATE_KEY,
  type LogisticsEntryState,
} from '../../lib/logisticsPrefill';
import type { BookCourierStep } from '../../lib/logisticsBooking';
import { emptyShipmentBoxDraft } from '../../lib/logisticsBooking';
import type { LogisticsCourierRates } from '../../types/logistics-courier-rates';
import { staffLogisticsSiteLabel } from '../../types/staff-logistics';

type FlowStep = 'closed' | 'partner' | 'book';
type CardTone = 'all' | 'incomplete' | 'label' | 'transit' | 'delivered' | 'exception';
type StatFilterId = 'all' | LogisticsBookingStatus;
/** Freight payment Diff filter: + under-billed, − over-billed, 0 balanced. */
type FreightDiffFilter = '' | 'under_billed' | 'over_billed' | 'balanced';

const LIST_PAGE_SIZE = 10;
const FREIGHT_DIFF_FILTER_OPTIONS: ReadonlyArray<{ id: FreightDiffFilter; label: string }> = [
  { id: '', label: 'All variances' },
  { id: 'under_billed', label: 'Under-billed' },
  { id: 'over_billed', label: 'Over-billed' },
  { id: 'balanced', label: 'Zero balance' },
];

function matchesFreightDiffFilter(
  freight: LogisticsFreightCompare | undefined,
  filter: FreightDiffFilter,
): boolean {
  if (!filter) return true;
  if (!freight || freight.isFod || freight.differenceInr == null) return false;
  if (filter === 'under_billed') return freight.differenceInr > 0;
  if (filter === 'over_billed') return freight.differenceInr < 0;
  return freight.differenceInr === 0;
}

const STATUS_STAT_META: ReadonlyArray<{
  id: StatFilterId;
  label: string;
  shortLabel: string;
  Icon: typeof Package;
  tone: CardTone;
}> = [
  { id: 'all', label: 'All', shortLabel: 'All', Icon: LayoutGrid, tone: 'all' },
  { id: 'label_generated', label: 'Booked', shortLabel: 'Booked', Icon: Tag, tone: 'label' },
  { id: 'in_transit', label: 'In Transit', shortLabel: 'Transit', Icon: Truck, tone: 'transit' },
  { id: 'delivered', label: 'Delivered', shortLabel: 'Delivered', Icon: CheckCircle2, tone: 'delivered' },
  { id: 'cancelled', label: 'Cancelled', shortLabel: 'Cancel', Icon: AlertCircle, tone: 'exception' },
  { id: 'returned', label: 'Returned', shortLabel: 'Returned', Icon: Undo2, tone: 'exception' },
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

function formatInstantDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const date = new Date(ms);
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

/** Earliest courier scan — used when bookedAt is missing. */
function earliestTrackHistoryAt(booking: LogisticsBooking): string | null {
  const history = booking.courierTrack?.history;
  if (!Array.isArray(history) || !history.length) return null;
  let best: string | null = null;
  let bestMs = Infinity;
  for (const item of history) {
    const at = String(item?.at || '').trim();
    if (!at) continue;
    const ms = Date.parse(at);
    if (!Number.isNaN(ms) && ms < bestMs) {
      bestMs = ms;
      best = at;
    }
  }
  return best;
}

/** Shipment booking instant — never createdAt/updatedAt/trackFetchedAt. */
function bookingTimestamp(booking: LogisticsBooking): number {
  const bookedAt = booking.courierTrack?.bookedAt?.trim()
    || earliestTrackHistoryAt(booking);
  if (bookedAt) {
    const fromTrack = Date.parse(bookedAt);
    if (!Number.isNaN(fromTrack)) return fromTrack;
  }
  const bookingDate = String(booking.bookingDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return Date.parse(`${bookingDate}T00:00:00`);
  }
  if (bookingDate) {
    const parsed = Date.parse(bookingDate);
    if (!Number.isNaN(parsed)) return parsed;
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
  const bookedAt = booking.courierTrack?.bookedAt?.trim()
    || earliestTrackHistoryAt(booking);
  if (bookedAt) {
    const withTime = formatInstantDateTime(bookedAt);
    if (withTime) return withTime;
  }
  const bookingDate = String(booking.bookingDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    const date = new Date(`${bookingDate}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      // Date-only booking — do not invent a clock time from createdAt.
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
  }
  if (bookingDate) return bookingDate;
  return '—';
}

function formatDeliveredDateTime(booking: LogisticsBooking): string {
  const deliveredAt = booking.courierTrack?.deliveredAt?.trim();
  if (deliveredAt) {
    const withTime = formatInstantDateTime(deliveredAt);
    if (withTime) return withTime;
  }
  return formatShipmentDateTime(booking);
}

/** Last ST / Trackon track sync label for list tiles (not tracked / failed / time). */
function lastTrackedLabel(booking: LogisticsBooking): {
  text: string;
  tone: 'ok' | 'failed' | 'missing';
} | null {
  const trackedPartner = (
    booking.partnerId === 'st_courier'
    || booking.partnerId === 'trackon_air'
    || booking.partnerId === 'trackon_surface'
  );
  if (!trackedPartner) return null;
  const track = booking.courierTrack;
  const fetchedAt = formatInstantDateTime(track?.fetchedAt || booking.trackFetchedAt);
  if (!track && !booking.trackFetchedAt) {
    return { text: 'Not tracked', tone: 'missing' };
  }
  if (track && track.ok === false) {
    // Failed track is shown as Booked — no extra track line.
    return null;
  }
  if (fetchedAt) {
    return { text: `Last tracked ${fetchedAt}`, tone: 'ok' };
  }
  return { text: 'Not tracked', tone: 'missing' };
}

function cardToneForStatus(booking: LogisticsBooking): CardTone {
  if (isIncompleteLogisticsBooking(booking)) return 'incomplete';
  switch (booking.status) {
    case 'label_generated':
      return 'label';
    case 'in_transit':
      return 'transit';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
    case 'returned':
      return 'exception';
    default:
      return 'incomplete';
  }
}

function statusBadgeLabel(booking: LogisticsBooking): string {
  if (isIncompleteLogisticsBooking(booking)) return 'Incomplete';
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.status === 'returned') return 'Returned';
  if (booking.status === 'label_generated') return 'Booked';
  if (booking.status === 'in_transit') return 'In Transit';
  if (booking.status === 'delivered') return 'Delivered';
  return booking.status;
}

function originPlaceLabel(booking: LogisticsBooking): string {
  // List cards: site only (Cochin / Head Office) — not the full ship-from street address.
  return staffLogisticsSiteLabel(booking.shipFromSite);
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
  return status === 'label_generated' || status === 'in_transit';
}

let shipFromSessionSyncStarted = false;

export const LogisticsPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
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
  const [freightDiffFilter, setFreightDiffFilter] = useState<FreightDiffFilter>('');
  const [dateRange, setDateRange] = useState(defaultDateRange);
  /** Draft values in the Filters panel — applied only via Apply. */
  const [draftDateRange, setDraftDateRange] = useState(defaultDateRange);
  const [draftStatus, setDraftStatus] = useState<LogisticsBookingStatus | ''>('');
  const [draftPartnerId, setDraftPartnerId] = useState<LogisticsPartnerId | ''>('');
  const [draftFreightDiffFilter, setDraftFreightDiffFilter] = useState<FreightDiffFilter>('');
  const [page, setPage] = useState(1);
  /** Super-admin only — trash on list/detail stays hidden until enabled in Filters. */
  const [showDeleteButtons, setShowDeleteButtons] = useState(false);
  const [courierRates, setCourierRates] = useState<LogisticsCourierRates | null>(null);
  const [freightByBookingId, setFreightByBookingId] = useState<
    Record<string, LogisticsFreightCompare>
  >({});

  const isMobile = useIsMobile();
  const isOps = user ? isInternalOpsUser(user) : false;
  const canCreate = user ? canCreateLogisticsBooking(user) : false;
  const canSuperDelete = user ? canDeleteLogisticsBooking(user) : false;
  const showTileDelete = canSuperDelete && showDeleteButtons;

  useEffect(() => {
    if (!canSuperDelete && showDeleteButtons) setShowDeleteButtons(false);
  }, [canSuperDelete, showDeleteButtons]);

  const activeBooking = useMemo(
    () => bookings.find(item => item.id === activeBookingId) ?? null,
    [bookings, activeBookingId],
  );

  const flowOpen = flowStep !== 'closed';

  useEffect(() => {
    const state = location.state as Record<string, unknown> | null;
    if (!state) return;

    const openBookingId = typeof state[LOGISTICS_OPEN_BOOKING_STATE_KEY] === 'string'
      ? String(state[LOGISTICS_OPEN_BOOKING_STATE_KEY]).trim()
      : '';
    if (openBookingId) {
      navigate(location.pathname, { replace: true, state: null });
      setFlowStep('closed');
      setSelectedPartnerId(null);
      setPendingEntry(null);
      setResumeBookingId(null);
      setResumeDraft(null);
      setResumeStep(undefined);
      setResumeDealerQuery(undefined);
      setActiveBookingId(openBookingId);
      void fetchLogisticsBooking(openBookingId)
        .then(hydrated => {
          if (!hydrated) return;
          setBookings(prev => {
            const rest = prev.filter(item => item.id !== hydrated.id);
            return [hydrated, ...rest];
          });
          setActiveBookingId(hydrated.id);
        })
        .catch(() => undefined);
      return;
    }

    if (!canCreate) return;
    const entry = state[LOGISTICS_ENTRY_STATE_KEY] as LogisticsEntryState | undefined;
    if (!entry?.draftPatch) return;
    setPendingEntry(entry);
    const preferred = entry.draftPatch.partnerId;
    const preferredOk = Boolean(preferred && isPipelineEnabledPartner(preferred));
    // Freight-derived partner locks the picker; no-freight invoices let ops choose.
    if (preferredOk && entry.lockPartner !== false) {
      setSelectedPartnerId(preferred!);
      setFlowStep('book');
    } else {
      setSelectedPartnerId(preferredOk ? preferred! : null);
      setFlowStep('partner');
    }
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

  /** Once per session: push Sites ship-from addresses onto all bookings for ops. */
  useEffect(() => {
    if (!user || !isOps || shipFromSessionSyncStarted) return;
    shipFromSessionSyncStarted = true;
    let cancelled = false;
    void (async () => {
      try {
        const settings = await loadLogisticsSettings();
        const hasAddress = Object.values(settings.fromAddresses).some(value => Boolean(value?.trim()));
        if (cancelled || !hasAddress) return;
        await syncLogisticsShipFromAddressesToAllBookings(settings.fromAddresses);
      } catch {
        /* list subscription still works; detail can apply per booking */
      }
    })();
    return () => { cancelled = true; };
  }, [user, isOps]);

  const datedBookings = useMemo(
    () => bookings.filter(booking => inDateRange(booking, dateRange.from, dateRange.to)),
    [bookings, dateRange.from, dateRange.to],
  );

  const pipelineBookings = useMemo(
    () => datedBookings.filter(booking => !isIncompleteLogisticsBooking(booking)),
    [datedBookings],
  );

  const statusFilteredBookings = useMemo(() => {
    const activeStatus = statusFilter || filters.status || '';
    const source = activeStatus ? pipelineBookings : datedBookings;
    const filtered = activeStatus
      ? source.filter(booking => booking.status === activeStatus)
      : source;
    return [...filtered].sort(compareLogisticsBookingsByBookingDateDesc);
  }, [datedBookings, pipelineBookings, filters.status, statusFilter]);

  const rangedBookings = useMemo(() => {
    if (!freightDiffFilter) return statusFilteredBookings;
    return statusFilteredBookings.filter(booking => (
      matchesFreightDiffFilter(freightByBookingId[booking.id], freightDiffFilter)
    ));
  }, [statusFilteredBookings, freightByBookingId, freightDiffFilter]);

  useEffect(() => {
    setPage(1);
  }, [
    statusFilter,
    filters.status,
    filters.partnerId,
    filters.query,
    freightDiffFilter,
    dateRange.from,
    dateRange.to,
  ]);

  const totalPages = Math.max(1, Math.ceil(rangedBookings.length / LIST_PAGE_SIZE));
  const pageBookings = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return rangedBookings.slice(start, start + LIST_PAGE_SIZE);
  }, [rangedBookings, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    let cancelled = false;
    void loadLogisticsCourierRates()
      .then(rates => {
        if (!cancelled) setCourierRates(rates);
      })
      .catch(() => {
        if (!cancelled) setCourierRates(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // When filtering by freight Diff, load compare for the full status-filtered set.
    const pool = freightDiffFilter ? statusFilteredBookings : pageBookings;
    const targets = pool.filter(
      booking => booking.invoiceId?.trim() && !freightByBookingId[booking.id],
    );
    if (!targets.length) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, LogisticsFreightCompare> = {};
      await Promise.all(targets.map(async booking => {
        try {
          next[booking.id] = await loadLogisticsFreightCompare(booking, {
            isOps,
            rates: courierRates,
          });
        } catch {
          // Skip failed cards; detail view can retry.
        }
      }));
      if (!cancelled && Object.keys(next).length) {
        setFreightByBookingId(prev => ({ ...prev, ...next }));
      }
    })();
    return () => { cancelled = true; };
  }, [
    pageBookings,
    statusFilteredBookings,
    freightDiffFilter,
    freightByBookingId,
    isOps,
    courierRates,
  ]);

  const stats = useMemo(() => {
    const counts: Record<StatFilterId, number> = {
      all: datedBookings.length,
      label_generated: 0,
      in_transit: 0,
      delivered: 0,
      cancelled: 0,
      returned: 0,
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

  const handleUpdateBooking = useCallback((next: LogisticsBooking) => {
    setBookings(prev => prev.map(item => (item.id === next.id ? next : item)));
  }, []);

  const openResumeDraft = useCallback((booking: LogisticsBooking) => {
    if (!canCreate) return;
    setError('');
    // Open immediately with list data — photo URLs hydrate inside the wizard.
    const wizard = bookingToWizardState(booking);
    const draft: Partial<LogisticsBookingDraft> = {
      ...wizard.draft,
      boxes: wizard.draft.boxes.length ? wizard.draft.boxes : [emptyShipmentBoxDraft()],
    };
    const rawStep = needsFinalPackagePhoto(booking)
      ? 'final_photo' as BookCourierStep
      : (
        ['scan', 'address', 'box', 'review', 'label', 'final_photo'] as BookCourierStep[]
      ).includes(wizard.step as BookCourierStep)
        ? wizard.step as BookCourierStep
        : 'box';
    const step = clampWizardStepForDraftPhotos(rawStep, draft.boxes ?? []);
    setResumeBookingId(booking.id);
    setResumeDraft(draft);
    setResumeStep(step);
    setResumeDealerQuery(wizard.dealerQuery);
    setSelectedPartnerId(booking.partnerId);
    setPendingEntry(null);
    setActiveBookingId(null);
    setFlowStep('book');

    void fetchLogisticsBooking(booking.id)
      .then(hydrated => {
        if (hydrated) handleUpdateBooking(hydrated);
      })
      .catch(() => undefined);
  }, [canCreate, handleUpdateBooking]);

  const handlePartnerSelect = useCallback((methodId: string) => {
    if (!isLogisticsPartnerId(methodId)) return;
    if (!STANDALONE_LOGISTICS_PARTNER_IDS.includes(methodId)) return;
    setSelectedPartnerId(methodId);
    setResumeStep(undefined);
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

  const handleReturn = useCallback(async (booking: LogisticsBooking) => {
    if (!user) return;
    try {
      const updated = await returnLogisticsBooking(booking, user);
      handleUpdateBooking(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark shipment returned.');
    }
  }, [user, handleUpdateBooking]);

  const handleDelete = useCallback(async (bookingId: string) => {
    if (!user) return;
    const booking = bookings.find(item => item.id === bookingId);
    const label = booking?.consignmentNo?.trim()
      || booking?.invoiceNumber?.trim()
      || booking?.orderRef?.trim()
      || 'this booking';
    const ok = await confirm({
      title: 'Delete logistics booking',
      message: `Permanently delete ${label}? Photos will be removed too. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteLogisticsBookingPermanently(bookingId, user);
      setBookings(prev => prev.filter(item => item.id !== bookingId));
      setActiveBookingId(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete shipment.');
    }
  }, [user, bookings, confirm]);

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

  // Detail replaces the list on the same route — reset scroll so it doesn't open mid-page.
  useEffect(() => {
    if (!activeBookingId) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeBookingId]);

  const applyStatFilter = useCallback((status: StatFilterId) => {
    setFilters(prev => ({ ...prev, status: '' }));
    if (status === 'all') {
      setStatusFilter('');
      return;
    }
    setStatusFilter(prev => (prev === status ? '' : status));
  }, []);

  const openFiltersPanel = useCallback(() => {
    setDraftDateRange(dateRange);
    setDraftStatus(filters.status ?? '');
    setDraftPartnerId(filters.partnerId ?? '');
    setDraftFreightDiffFilter(freightDiffFilter);
    setFiltersOpen(true);
  }, [dateRange, filters.status, filters.partnerId, freightDiffFilter]);

  const applyFiltersPanel = useCallback(() => {
    setDateRange(draftDateRange);
    setFreightDiffFilter(draftFreightDiffFilter);
    setStatusFilter('');
    setFilters(prev => ({
      ...prev,
      status: draftStatus,
      partnerId: draftPartnerId,
    }));
    setFiltersOpen(false);
  }, [draftDateRange, draftFreightDiffFilter, draftStatus, draftPartnerId]);

  const clearFiltersPanel = useCallback(() => {
    const nextRange = defaultDateRange();
    setDraftDateRange(nextRange);
    setDraftStatus('');
    setDraftPartnerId('');
    setDraftFreightDiffFilter('');
    setDateRange(nextRange);
    setFreightDiffFilter('');
    setStatusFilter('');
    setFilters(prev => ({ ...prev, status: '', partnerId: '' }));
  }, []);

  const showListControls = isOps && !flowOpen && !activeBooking;
  const hasActiveFilters = Boolean(filters.status)
    || Boolean(filters.partnerId)
    || Boolean(statusFilter)
    || Boolean(freightDiffFilter)
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
        onClick={() => {
          if (filtersOpen) setFiltersOpen(false);
          else openFiltersPanel();
        }}
        aria-expanded={filtersOpen}
        aria-haspopup="dialog"
        aria-label="Filter logistics bookings"
        title="Filters"
      >
        <SlidersHorizontal size={20} strokeWidth={2.25} />
      </button>
    ),
    [filtersOpen, hasActiveFilters, openFiltersPanel],
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
                    value={draftDateRange.from}
                    max={draftDateRange.to}
                    onChange={event => setDraftDateRange(prev => ({ ...prev, from: event.target.value }))}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    type="date"
                    value={draftDateRange.to}
                    min={draftDateRange.from}
                    onChange={event => setDraftDateRange(prev => ({ ...prev, to: event.target.value }))}
                  />
                </label>
              </div>
              <button
                type="button"
                className="logistics-filter-dates__preset"
                onClick={() => setDraftDateRange(defaultDateRange())}
              >
                <CalendarDays size={14} aria-hidden />
                Last 30 days
              </button>
            </div>

            <label className="logistics-filter-field">
              <span>Status</span>
              <select
                value={draftStatus}
                onChange={event => {
                  setDraftStatus(event.target.value as LogisticsBookingStatus | '');
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
                value={draftPartnerId}
                onChange={event => setDraftPartnerId(event.target.value as LogisticsPartnerId | '')}
              >
                <option value="">All partners</option>
                {LOGISTICS_PARTNERS.map(partner => (
                  <option key={partner.id} value={partner.id}>{partner.label}</option>
                ))}
              </select>
            </label>

            <fieldset className="logistics-filter-field logistics-filter-radios">
              <legend>Payment difference</legend>
              <div className="logistics-filter-radios__list" role="radiogroup" aria-label="Payment difference">
                {FREIGHT_DIFF_FILTER_OPTIONS.map(option => {
                  const inputId = `logistics-freight-diff-${option.id || 'all'}`;
                  return (
                    <label key={option.id || 'all'} className="logistics-filter-radios__option" htmlFor={inputId}>
                      <input
                        id={inputId}
                        type="radio"
                        name="logistics-freight-diff"
                        value={option.id}
                        checked={draftFreightDiffFilter === option.id}
                        onChange={() => setDraftFreightDiffFilter(option.id)}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {canSuperDelete && (
              <label className="logistics-filter-supermode">
                <span className="logistics-filter-supermode__copy">
                  <strong>Show delete buttons</strong>
                  <em>Permanently wipe booking + photos from the list</em>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showDeleteButtons}
                  className={[
                    'logistics-filter-supermode__switch',
                    showDeleteButtons ? 'logistics-filter-supermode__switch--on' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setShowDeleteButtons(prev => !prev)}
                >
                  <span className="logistics-filter-supermode__knob" />
                </button>
              </label>
            )}

            <div className="logistics-filter-dropdown__actions">
              <button
                type="button"
                className="logistics-filter-dropdown__clear"
                onClick={clearFiltersPanel}
                disabled={!hasActiveFilters
                  && !draftStatus
                  && !draftPartnerId
                  && !draftFreightDiffFilter
                  && isDefaultDateRange(draftDateRange)}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary logistics-filter-dropdown__apply"
                onClick={applyFiltersPanel}
              >
                Apply
              </button>
            </div>
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
          onReturn={() => void handleReturn(activeBooking)}
          onDelete={showTileDelete
            ? () => void handleDelete(activeBooking.id)
            : undefined}
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
                    setDateRange(defaultDateRange());
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
                {pageBookings.map(booking => {
                  const partner = LOGISTICS_PARTNERS.find(item => item.id === booking.partnerId);
                  const tone = cardToneForStatus(booking);
                  const waybill = booking.trackingNo || booking.consignmentNo || '—';
                  const freight = freightByBookingId[booking.id];
                  const productItems = freight?.items.filter(
                    item => !item.isFreight && !item.isStampingFee,
                  ) ?? [];
                  const tracked = lastTrackedLabel(booking);
                  const ewayChip = ewayBillListChip(booking, {
                    invoiceTotalInclGst: freight?.invoiceTotalInclGst ?? null,
                  });
                  return (
                    <li key={booking.id}>
                      <article
                        className={`logistics-shipment logistics-shipment--${tone}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openBooking(booking)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openBooking(booking);
                          }
                        }}
                      >
                        <div className="logistics-shipment__main">
                          <span className="logistics-shipment__logo" aria-hidden>
                            {partner ? (
                              <img src={partner.image} alt="" />
                            ) : (
                              <Package size={20} />
                            )}
                          </span>

                          <div className="logistics-shipment__body">
                            <div className="logistics-shipment__top">
                              <div className="logistics-shipment__top-left">
                                <strong className="logistics-shipment__tracking">{waybill}</strong>
                                <span className="logistics-shipment__dealer">{booking.dealer.name}</span>
                              </div>
                              {(freight?.paidFreightInr != null
                                || freight?.actualFreightInr != null) && (
                                <div className="logistics-shipment__freight">
                                  {freight.isFod ? (
                                    <span className="logistics-shipment__freight-fod">
                                      FOD{' '}
                                      {freight.actualFreightInr != null
                                        ? formatCurrency(freight.actualFreightInr)
                                        : '—'}
                                    </span>
                                  ) : (
                                    <>
                                      <span>
                                        Paid{' '}
                                        {freight.paidFreightInr != null
                                          ? formatCurrency(freight.paidFreightInr)
                                          : '—'}
                                      </span>
                                      <span>
                                        Actual{' '}
                                        {freight.actualFreightInr != null
                                          ? formatCurrency(freight.actualFreightInr)
                                          : '—'}
                                      </span>
                                      {freight.differenceInr != null && (
                                        <span
                                          className={[
                                            'logistics-shipment__freight-diff',
                                            freight.differenceInr > 0
                                              ? 'is-under'
                                              : freight.differenceInr < 0
                                                ? 'is-over'
                                                : 'is-matched',
                                          ].join(' ')}
                                        >
                                          Diff {formatCurrency(freight.differenceInr)}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {productItems.length > 0 && (
                              <span className="logistics-shipment__invoice-items">
                                {productItems
                                  .map(item => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
                                  .join(', ')}
                              </span>
                            )}

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
                                <span>Delivered on {formatDeliveredDateTime(booking)}</span>
                              </div>
                            ) : booking.status === 'cancelled' ? (
                              <div className="logistics-shipment__outcome logistics-shipment__outcome--exception">
                                <AlertCircle size={14} aria-hidden />
                                <span>Cancelled · {formatShipmentDateTime(booking)}</span>
                              </div>
                            ) : booking.status === 'returned' ? (
                              <div className="logistics-shipment__outcome logistics-shipment__outcome--exception">
                                <Undo2 size={14} aria-hidden />
                                <span>Returned · {formatShipmentDateTime(booking)}</span>
                              </div>
                            ) : null}

                            {tracked && (
                              <p
                                className={`logistics-shipment__tracked logistics-shipment__tracked--${tracked.tone}`}
                              >
                                {tracked.text}
                              </p>
                            )}

                            <div className="logistics-shipment__meta">
                              <span className="logistics-shipment__meta-info">
                                <CalendarDays size={12} aria-hidden />
                                <span>{formatShipmentDateTime(booking)}</span>
                                <span className="logistics-shipment__sep" aria-hidden>·</span>
                                <Package size={12} aria-hidden />
                                <span>{packageCountLabel(booking)}</span>
                                {ewayChip ? (
                                  <>
                                    <span className="logistics-shipment__sep" aria-hidden>·</span>
                                    <span
                                      className={[
                                        'logistics-shipment__eway',
                                        ewayChip.tone === 'done'
                                          ? 'is-done'
                                          : ewayChip.tone === 'cancelled'
                                            ? 'is-cancelled'
                                            : 'is-missing',
                                      ].join(' ')}
                                    >
                                      {ewayChip.label}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                              <span className={`logistics-shipment__badge logistics-shipment__badge--${tone}`}>
                                {statusBadgeLabel(booking)}
                              </span>
                            </div>
                          </div>

                          <div className="logistics-shipment__trail">
                            {showTileDelete && (
                              <button
                                type="button"
                                className="logistics-shipment__delete"
                                aria-label={`Delete booking ${waybill}`}
                                title="Delete permanently"
                                onClick={event => {
                                  event.stopPropagation();
                                  void handleDelete(booking.id);
                                }}
                              >
                                <Trash2 size={16} aria-hidden />
                              </button>
                            )}
                            <ChevronRight size={18} className="logistics-shipment__chevron" aria-hidden />
                          </div>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
              {totalPages > 1 && (
                <footer className="invoices-pagination invoices-pagination--sticky logistics-page__pagination">
                  <span className="invoices-pagination__info text-muted text-sm">
                    {pageBookings.length
                      ? `${(page - 1) * LIST_PAGE_SIZE + 1}–${(page - 1) * LIST_PAGE_SIZE + pageBookings.length}`
                      : '0'}
                    {' of '}
                    {rangedBookings.length.toLocaleString('en-IN')}
                  </span>
                  <div className="invoices-pagination__btns">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage(p => p - 1)}
                    >
                      Prev
                    </button>
                    <span className="invoices-pagination__page text-sm">
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </footer>
              )}
            </section>
          )}
        </div>
      )}

      {flowStep === 'partner' && (
        <CourierPartnerPicker
          availableIds={STANDALONE_LOGISTICS_PARTNER_IDS}
          titleLead="LOGISTIC"
          titleAccent="PARTNER"
          subtitle="Select a logistics partner to book courier (Delhivery: use Book Courier from the invoice)"
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
