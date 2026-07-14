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

export function zohoDealerMobile(dealer: ZohoDealer): string {
  return (
    dealer.mobile?.trim()
    || dealer.zohoPrimaryContact?.mobile?.trim()
    || dealer.whatsappNumber?.trim()
    || dealer.alternateMobile?.trim()
    || dealer.phone?.trim()
    || dealer.zohoPrimaryContact?.phone?.trim()
    || '—'
  );
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

  return {
    zohoCustomerId: dealer.id,
    dealerId: dealer.portalUserId?.trim() || dealer.id,
    name: zohoDealerDisplayName(dealer),
    code: dealer.id,
    contactPerson: zohoDealerContactPerson(dealer),
    mobile: zohoDealerMobile(dealer),
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
