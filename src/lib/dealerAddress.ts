import type { ZohoAddressRaw, ZohoDealer } from '../types/dealers';

export type DealerAddress = {
  attention: string;
  phone: string;
  address: string;
  street2: string;
  city: string;
  zip: string;
  state: string;
  country: string;
  district: string;
};

export function emptyDealerAddress(): DealerAddress {
  return {
    attention: '',
    phone: '',
    address: '',
    street2: '',
    city: '',
    zip: '',
    state: '',
    country: 'India',
    district: '',
  };
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function formatDealerAddress(addr: DealerAddress): string {
  return [addr.attention, addr.address, addr.street2, addr.city, addr.state, addr.zip, addr.country]
    .map(text)
    .filter(Boolean)
    .join(', ');
}

export function dealerAddressSignature(addr: DealerAddress): string {
  return [
    addr.attention,
    addr.phone,
    addr.address,
    addr.street2,
    addr.city,
    addr.zip,
    addr.state,
    addr.country,
    addr.district,
  ].map(value => text(value).toLowerCase()).join('|');
}

export function dealerAddressesMatch(left: DealerAddress, right: DealerAddress): boolean {
  return dealerAddressSignature(left) === dealerAddressSignature(right);
}

export function dealerAddressFromRaw(
  raw: ZohoAddressRaw | null | undefined,
  extras: { district?: string | null; zip?: string | null; state?: string | null; formatted?: string | null } = {},
): DealerAddress {
  const formatted = text(extras.formatted);
  return {
    attention: text(raw?.attention),
    phone: text(raw?.phone),
    address: text(raw?.address) || formatted,
    street2: text(raw?.street2),
    city: text(raw?.city),
    zip: text(raw?.zip || extras.zip).replace(/\D/g, '').slice(0, 6),
    state: text(raw?.state || extras.state),
    country: text(raw?.country) || 'India',
    district: text(extras.district),
  };
}

export function dealerAddressFromDealer(
  dealer: ZohoDealer,
  which: 'billing' | 'shipping',
): DealerAddress {
  if (which === 'shipping') {
    return dealerAddressFromRaw(dealer.zohoShippingAddressRaw, {
      formatted: dealer.zohoShippingAddress || dealer.shippingAddress,
    });
  }
  return dealerAddressFromRaw(dealer.zohoBillingAddressRaw, {
    district: dealer.district,
    zip: dealer.zipCode,
    state: dealer.billingState,
    formatted: dealer.zohoBillingAddress || dealer.billingAddress,
  });
}

export function dealerAddressToZoho(addr: DealerAddress): Record<string, string> {
  return {
    attention: text(addr.attention),
    phone: text(addr.phone),
    address: text(addr.address),
    street2: text(addr.street2),
    city: text(addr.city),
    zip: text(addr.zip).replace(/\D/g, '').slice(0, 6),
    state: text(addr.state),
    country: text(addr.country) || 'India',
  };
}
