import {
  isBlueDartLogisticsPartnerId,
  logisticsPartnerLabel,
  type LogisticsPartnerId,
} from '../constants/logisticsPartners';
import { isIncompleteLogisticsBooking } from './logisticsBooking';
import type { StaffLogisticsSite } from '../types/staff-logistics';
import type {
  LogisticsBlueDartPickup,
  LogisticsBooking,
} from '../types/logistics-dispatch';

export type LogisticsPickupKind = 'requested' | 'pending';

export type LogisticsPickupTodayGroup = {
  key: string;
  kind: LogisticsPickupKind;
  partnerId: LogisticsPartnerId;
  partnerLabel: string;
  pickupId: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  locationName: string | null;
  alreadyExisted?: boolean;
  message?: string | null;
  shipFromSite: StaffLogisticsSite;
  bookings: LogisticsBooking[];
  canRequest: boolean;
};

export function isPickupCapablePartner(partnerId: string): boolean {
  return partnerId === 'delhivery' || isBlueDartLogisticsPartnerId(partnerId);
}

export function istCalendarDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function calendarWeekday(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Delhivery same-day cutoff 14:00 IST → tomorrow. */
export function delhiveryExpectedPickupDateIst(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find(part => part.type === type)?.value || '00'
  );
  const hour = Number(get('hour'));
  let ymd = `${get('year')}-${get('month')}-${get('day')}`;
  if (hour >= 14) ymd = addCalendarDays(ymd, 1);
  return ymd;
}

/** Blue Dart RegisterPickup is next IST working day (skip Sunday). */
export function blueDartExpectedPickupDateIst(now = new Date()): string {
  let ymd = addCalendarDays(istCalendarDate(now), 1);
  while (calendarWeekday(ymd) === 0) ymd = addCalendarDays(ymd, 1);
  return ymd;
}

function isClosedForPickup(booking: LogisticsBooking): boolean {
  return booking.status === 'cancelled' || booking.status === 'returned';
}

function hasSuccessfulDelhiveryPickup(booking: LogisticsBooking): boolean {
  return Boolean(booking.delhiveryPickup?.ok && booking.delhiveryPickup.pickupId);
}

function hasRegisteredBlueDartPickup(booking: LogisticsBooking): boolean {
  return Boolean(booking.blueDartPickup?.ok && booking.blueDartPickup.registered);
}

export function bookingPickupDate(booking: LogisticsBooking): string | null {
  const stored = booking.partnerId === 'delhivery'
    ? booking.delhiveryPickup?.pickupDate
    : booking.blueDartPickup?.pickupDate;
  if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored.trim())) {
    return stored.trim();
  }
  const stamp = booking.delhiveryPickup?.requestedAt
    || booking.blueDartPickup?.requestedAt
    || booking.createdAt
    || booking.bookingDate;
  if (!stamp) return null;
  const when = /^\d{4}-\d{2}-\d{2}$/.test(stamp)
    ? new Date(`${stamp}T12:00:00+05:30`)
    : new Date(stamp);
  if (Number.isNaN(when.getTime())) return null;
  if (booking.partnerId === 'delhivery') return delhiveryExpectedPickupDateIst(when);
  if (isBlueDartLogisticsPartnerId(booking.partnerId)) return blueDartExpectedPickupDateIst(when);
  return istCalendarDate(when);
}

export function isPickupRequestToday(
  booking: LogisticsBooking,
  today = istCalendarDate(),
): boolean {
  if (!isPickupCapablePartner(booking.partnerId)) return false;
  if (isIncompleteLogisticsBooking(booking)) return false;
  if (booking.partnerId === 'delhivery') {
    return hasSuccessfulDelhiveryPickup(booking) && bookingPickupDate(booking) === today;
  }
  return hasRegisteredBlueDartPickup(booking) && bookingPickupDate(booking) === today;
}

export function bookingNeedsPickupToday(
  booking: LogisticsBooking,
  today = istCalendarDate(),
): boolean {
  if (!isPickupCapablePartner(booking.partnerId)) return false;
  if (isIncompleteLogisticsBooking(booking)) return false;
  if (isClosedForPickup(booking)) return false;
  if (bookingPickupDate(booking) !== today) return false;
  if (booking.partnerId === 'delhivery') return !hasSuccessfulDelhiveryPickup(booking);
  return !hasRegisteredBlueDartPickup(booking);
}

function matchesPartnerFilter(
  booking: LogisticsBooking,
  partnerFilter: LogisticsPartnerId | '',
): boolean {
  if (!partnerFilter) return isPickupCapablePartner(booking.partnerId);
  return booking.partnerId === partnerFilter;
}

export function groupPickupsToday(
  bookings: readonly LogisticsBooking[],
  partnerFilter: LogisticsPartnerId | '',
  today = istCalendarDate(),
): LogisticsPickupTodayGroup[] {
  const scoped = bookings.filter(booking => matchesPartnerFilter(booking, partnerFilter));
  const groups = new Map<string, LogisticsPickupTodayGroup>();

  const upsert = (
    key: string,
    seed: Omit<LogisticsPickupTodayGroup, 'key' | 'bookings'>,
    booking: LogisticsBooking,
  ) => {
    const existing = groups.get(key);
    if (existing) {
      if (!existing.bookings.some(item => item.id === booking.id)) {
        existing.bookings.push(booking);
      }
      return;
    }
    groups.set(key, {
      ...seed,
      key,
      bookings: [booking],
    });
  };

  for (const booking of scoped) {
    if (isPickupRequestToday(booking, today)) {
      if (booking.partnerId === 'delhivery') {
        const pickup = booking.delhiveryPickup;
        const pickupId = pickup?.pickupId?.trim() || '';
        const key = pickupId
          ? `delhivery:${pickupId}`
          : `delhivery:${booking.shipFromSite}:${today}`;
        upsert(key, {
          kind: 'requested',
          partnerId: 'delhivery',
          partnerLabel: logisticsPartnerLabel('delhivery'),
          pickupId: pickupId || null,
          pickupDate: pickup?.pickupDate || today,
          pickupTime: pickup?.pickupTime || null,
          locationName: pickup?.pickupLocationName || null,
          alreadyExisted: pickup?.alreadyExisted,
          message: pickup?.message || null,
          shipFromSite: booking.shipFromSite,
          canRequest: false,
        }, booking);
      } else {
        upsert(`bluedart:${booking.id}`, {
          kind: 'requested',
          partnerId: booking.partnerId,
          partnerLabel: logisticsPartnerLabel(booking.partnerId),
          pickupId: booking.blueDartPickup?.tokenNumber || booking.consignmentNo || null,
          pickupDate: booking.blueDartPickup?.pickupDate || today,
          pickupTime: booking.blueDartPickup?.pickupTime || null,
          locationName: booking.blueDartPickup?.pickupPin
            || booking.blueDartPickup?.originArea
            || null,
          message: booking.blueDartPickup?.message
            || booking.blueDartPickup?.pickupAddress
            || 'Registered with waybill',
          shipFromSite: booking.shipFromSite,
          canRequest: false,
        }, booking);
      }
      continue;
    }

    if (!bookingNeedsPickupToday(booking, today)) continue;

    if (booking.partnerId === 'delhivery') {
      const key = `pending:delhivery:${booking.shipFromSite}:${today}`;
      upsert(key, {
        kind: 'pending',
        partnerId: 'delhivery',
        partnerLabel: logisticsPartnerLabel('delhivery'),
        pickupId: null,
        pickupDate: today,
        pickupTime: null,
        locationName: null,
        message: booking.delhiveryPickup?.message || 'Pickup not requested yet',
        shipFromSite: booking.shipFromSite,
        canRequest: true,
      }, booking);
      continue;
    }

    upsert(`pending:bluedart:${booking.id}`, {
      kind: 'pending',
      partnerId: booking.partnerId,
      partnerLabel: logisticsPartnerLabel(booking.partnerId),
      pickupId: booking.consignmentNo || null,
      pickupDate: today,
      pickupTime: null,
      locationName: null,
      message: booking.blueDartPickup?.message || 'Not registered at booking',
      shipFromSite: booking.shipFromSite,
      canRequest: false,
    }, booking);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'pending' ? -1 : 1;
    const partner = a.partnerLabel.localeCompare(b.partnerLabel);
    if (partner) return partner;
    return (a.locationName || a.shipFromSite).localeCompare(b.locationName || b.shipFromSite);
  });
}

export function countPickupsToday(
  bookings: readonly LogisticsBooking[],
  partnerFilter: LogisticsPartnerId | '',
  today = istCalendarDate(),
): { requested: number; pending: number; total: number } {
  const groups = groupPickupsToday(bookings, partnerFilter, today);
  const requested = groups
    .filter(group => group.kind === 'requested')
    .reduce((sum, group) => sum + group.bookings.length, 0);
  const pending = groups
    .filter(group => group.kind === 'pending')
    .reduce((sum, group) => sum + group.bookings.length, 0);
  return { requested, pending, total: requested + pending };
}

export function mergePickupBookings(
  ...lists: Array<readonly LogisticsBooking[]>
): LogisticsBooking[] {
  const byId = new Map<string, LogisticsBooking>();
  for (const list of lists) {
    for (const booking of list) {
      const existing = byId.get(booking.id);
      if (!existing || String(booking.updatedAt || '') > String(existing.updatedAt || '')) {
        byId.set(booking.id, booking);
      }
    }
  }
  return [...byId.values()];
}

export function toBlueDartPickup(input: {
  registered?: boolean;
  pickupDate?: string | null;
  pickupTime?: string | null;
  message?: string | null;
  requestedAt?: string;
}): LogisticsBlueDartPickup {
  const registered = input.registered === true;
  return {
    ok: registered,
    registered,
    pickupDate: input.pickupDate ?? null,
    pickupTime: input.pickupTime ?? null,
    message: input.message ?? (registered ? 'Registered with waybill' : 'Not registered'),
    requestedAt: input.requestedAt || new Date().toISOString(),
  };
}
