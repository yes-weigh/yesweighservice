import { doc, getDoc, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { buildContactLinks } from './phoneLinks';

export type ZohoCustomerDisplayContact = {
  address: string | null;
  /** Billing address when available (may match shipping). */
  billingAddress: string | null;
  gstin: string | null;
  phone: string | null;
  telHref: string | null;
  whatsappHref: string | null;
};

function trimStr(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function addressById(data: DocumentData, preferredAddressId?: string | null): string | null {
  const preferredId = trimStr(preferredAddressId);
  if (!preferredId) return null;
  const rows = Array.isArray(data.zohoAddresses) ? data.zohoAddresses : [];
  const match = rows.find(
    row => String(row?.addressId ?? '').trim() === preferredId && trimStr(row?.formatted),
  );
  return match ? trimStr(match.formatted) : null;
}

function addressFromZohoAddresses(data: DocumentData): string | null {
  const rows = Array.isArray(data.zohoAddresses) ? data.zohoAddresses : [];
  const shipping = rows.find(row => row?.kind === 'shipping' && trimStr(row?.formatted));
  if (shipping) return trimStr(shipping.formatted);
  const billing = rows.find(row => row?.kind === 'billing' && trimStr(row?.formatted));
  if (billing) return trimStr(billing.formatted);
  const any = rows.find(row => trimStr(row?.formatted));
  return any ? trimStr(any.formatted) : null;
}

/** Customer-record fallbacks only — never invent an address from district/ZIP. */
function addressFromCustomer(
  data: DocumentData,
  preferredAddressId?: string | null,
): string | null {
  return (
    // SO/invoice linked address id on the customer book.
    addressById(data, preferredAddressId)
    || trimStr(data.zohoShippingAddress)
    || trimStr(data.shippingAddress)
    || formatRawAddress(data.zohoShippingAddressRaw)
    || trimStr(data.zohoBillingAddress)
    || trimStr(data.billingAddress)
    || formatRawAddress(data.zohoBillingAddressRaw)
    || addressFromZohoAddresses(data)
  );
}

function formatRawAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const addr = raw as Record<string, unknown>;
  const parts = [
    trimStr(addr.attention),
    trimStr(addr.address)?.replace(/\n/g, ', '),
    trimStr(addr.street2),
    trimStr(addr.city),
    trimStr(addr.state),
    trimStr(addr.zip),
    trimStr(addr.country),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function phoneFromCustomer(data: DocumentData): string | null {
  const rawShip = data.zohoShippingAddressRaw as { phone?: unknown } | null | undefined;
  const rawBill = data.zohoBillingAddressRaw as { phone?: unknown } | null | undefined;
  return (
    trimStr(data.mobile)
    || trimStr(data.phone)
    || trimStr(rawShip?.phone)
    || trimStr(rawBill?.phone)
  );
}

function billingAddressFromCustomer(data: DocumentData): string | null {
  return (
    trimStr(data.zohoBillingAddress)
    || trimStr(data.billingAddress)
    || formatRawAddress(data.zohoBillingAddressRaw)
    || null
  );
}

export function contactFromCustomerData(
  data: DocumentData | null | undefined,
  preferredAddress?: string | null,
  preferredAddressId?: string | null,
): ZohoCustomerDisplayContact {
  // Document-provided address always wins; only then fall back to customer addresses.
  const address = trimStr(preferredAddress)
    || (data ? addressFromCustomer(data, preferredAddressId) : null);
  const billingAddress = data ? billingAddressFromCustomer(data) : null;
  const gstin = data
    ? (trimStr(data.zohoGstNo) || trimStr(data.gstNo) || trimStr(data.gstin))
    : null;
  const phone = data ? phoneFromCustomer(data) : null;
  const links = phone ? buildContactLinks(phone) : null;
  return {
    address,
    billingAddress,
    gstin,
    phone,
    telHref: links?.tel ?? null,
    whatsappHref: links?.whatsapp ?? null,
  };
}

export type ResolveZohoCustomerDisplayContactOptions = {
  /** Address already stored on the SO / invoice — highest priority. */
  preferredAddress?: string | null;
  /** Zoho address id from the SO / invoice when the formatted string is missing. */
  preferredAddressId?: string | null;
};

/** Resolve display address + phone links. SO/invoice address wins over customer fallbacks. */
export async function resolveZohoCustomerDisplayContact(
  customerId: string | null | undefined,
  preferredAddressOrOptions?: string | null | ResolveZohoCustomerDisplayContactOptions,
): Promise<ZohoCustomerDisplayContact> {
  const options: ResolveZohoCustomerDisplayContactOptions = (
    preferredAddressOrOptions
    && typeof preferredAddressOrOptions === 'object'
  )
    ? preferredAddressOrOptions
    : { preferredAddress: preferredAddressOrOptions as string | null | undefined };

  const preferredAddress = options.preferredAddress ?? null;
  const preferredAddressId = options.preferredAddressId ?? null;
  const id = String(customerId ?? '').trim();
  if (!id) {
    return contactFromCustomerData(null, preferredAddress, preferredAddressId);
  }
  try {
    const snap = await getDoc(doc(db, 'zohoCustomers', id));
    if (!snap.exists()) {
      return contactFromCustomerData(null, preferredAddress, preferredAddressId);
    }
    return contactFromCustomerData(snap.data(), preferredAddress, preferredAddressId);
  } catch {
    return contactFromCustomerData(null, preferredAddress, preferredAddressId);
  }
}
