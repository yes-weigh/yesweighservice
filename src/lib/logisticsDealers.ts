import type { ZohoAddressRaw, ZohoDealer } from '../types/dealers';
import type { DeliveryAddressKind, LogisticsDealerSnapshot } from '../types/logistics-dispatch';

export function formatZohoAddressMultiline(
  formatted: string | null | undefined,
  raw: ZohoAddressRaw | null | undefined,
): string {
  if (formatted?.trim()) return formatted.trim();
  if (!raw) return '—';
  const parts = [
    raw.address,
    raw.street2,
    [raw.city, raw.state, raw.zip].filter(Boolean).join(', '),
    raw.country,
  ].filter(part => Boolean(part && String(part).trim()));
  return parts.join('\n') || '—';
}

export function zohoDealerContactPerson(dealer: ZohoDealer): string {
  const primary = dealer.zohoPrimaryContact;
  if (primary?.name?.trim()) return primary.name.trim();
  const parts = [dealer.firstName, dealer.contactName].filter(Boolean);
  return parts[0]?.trim() || '—';
}

function cleanPhone(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed === '—') return null;
  // Keep values that look like a phone (at least 8 digits).
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return trimmed;
}

/** Pull a phone-like token from free-form address / notes text. */
export function extractPhoneFromText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const match = text.match(/(?:\+?\d[\d\s\-()]{7,}\d)/);
  return match ? cleanPhone(match[0]) : null;
}

/**
 * Receiver phone preference for logistics labels:
 * shipping address → billing address → contact person → anywhere else in dealer data.
 */
export function resolveReceiverPhone(dealer: ZohoDealer): string {
  const contactPersons = dealer.zohoContactPersons ?? [];
  const candidates: Array<string | null | undefined> = [
    dealer.zohoShippingAddressRaw?.phone,
    extractPhoneFromText(dealer.zohoShippingAddress ?? dealer.shippingAddress),
    dealer.zohoBillingAddressRaw?.phone,
    extractPhoneFromText(dealer.zohoBillingAddress ?? dealer.billingAddress),
    dealer.zohoPrimaryContact?.mobile,
    dealer.zohoPrimaryContact?.phone,
    ...contactPersons.flatMap(person => [person.mobile, person.phone]),
    dealer.mobile,
    dealer.whatsappNumber,
    dealer.alternateMobile,
    dealer.phone,
    extractPhoneFromText(dealer.zohoNotes),
  ];
  for (const value of candidates) {
    const phone = cleanPhone(value);
    if (phone) return phone;
  }
  return '—';
}

/** @deprecated Prefer resolveReceiverPhone — kept for existing imports. */
export function zohoDealerMobile(dealer: ZohoDealer): string {
  return resolveReceiverPhone(dealer);
}

/** Resolve phone from a persisted booking snapshot (same preference order). */
export function resolveReceiverPhoneFromSnapshot(dealer: LogisticsDealerSnapshot): string {
  const candidates: Array<string | null | undefined> = [
    dealer.shippingPhone,
    extractPhoneFromText(dealer.shippingAddress),
    dealer.billingPhone,
    extractPhoneFromText(dealer.billingAddress),
    dealer.mobile,
    extractPhoneFromText(dealer.contactPerson),
  ];
  for (const value of candidates) {
    const phone = cleanPhone(value);
    if (phone) return phone;
  }
  return '—';
}

export function zohoDealerDisplayName(dealer: ZohoDealer): string {
  return dealer.companyName?.trim() || dealer.contactName?.trim() || dealer.id;
}

export function zohoDealerToSnapshot(dealer: ZohoDealer): LogisticsDealerSnapshot {
  const shippingAddress = formatZohoAddressMultiline(
    dealer.zohoShippingAddress ?? dealer.shippingAddress,
    dealer.zohoShippingAddressRaw,
  );
  const billingAddress = formatZohoAddressMultiline(
    dealer.zohoBillingAddress ?? dealer.billingAddress,
    dealer.zohoBillingAddressRaw,
  );
  const destinationCity = (
    dealer.zohoShippingAddressRaw?.city
    || dealer.zohoBillingAddressRaw?.city
    || dealer.district
    || ''
  ).trim();

  const shippingPhone = cleanPhone(dealer.zohoShippingAddressRaw?.phone)
    || extractPhoneFromText(dealer.zohoShippingAddress ?? dealer.shippingAddress)
    || undefined;
  const billingPhone = cleanPhone(dealer.zohoBillingAddressRaw?.phone)
    || extractPhoneFromText(dealer.zohoBillingAddress ?? dealer.billingAddress)
    || undefined;

  return {
    zohoCustomerId: dealer.id,
    dealerId: dealer.portalUserId?.trim() || dealer.id,
    name: zohoDealerDisplayName(dealer),
    code: dealer.id,
    contactPerson: zohoDealerContactPerson(dealer),
    mobile: resolveReceiverPhone(dealer),
    ...(shippingPhone ? { shippingPhone } : {}),
    ...(billingPhone ? { billingPhone } : {}),
    shippingAddress,
    billingAddress,
    ...(destinationCity ? { destinationCity } : {}),
  };
}

export function resolveDeliveryAddress(
  dealer: LogisticsDealerSnapshot,
  kind: DeliveryAddressKind,
): string {
  return kind === 'billing' ? dealer.billingAddress : dealer.shippingAddress;
}

export function dealerMatchesLogisticsQuery(dealer: ZohoDealer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const snapshot = zohoDealerToSnapshot(dealer);
  const haystack = [
    snapshot.name,
    snapshot.code,
    snapshot.contactPerson,
    snapshot.mobile,
    dealer.email,
    dealer.zohoEmail,
    dealer.phone,
    snapshot.shippingAddress,
    snapshot.billingAddress,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
