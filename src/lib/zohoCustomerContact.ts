import { doc, getDoc, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { buildContactLinks } from './phoneLinks';

export type ZohoCustomerDisplayContact = {
  address: string | null;
  phone: string | null;
  telHref: string | null;
  whatsappHref: string | null;
};

function trimStr(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
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

function locationFallback(data: DocumentData): string | null {
  const parts = [
    trimStr(data.district),
    trimStr(data.billingState),
    trimStr(data.zipCode),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function addressFromCustomer(data: DocumentData): string | null {
  return (
    trimStr(data.zohoShippingAddress)
    || trimStr(data.shippingAddress)
    || trimStr(data.zohoBillingAddress)
    || trimStr(data.billingAddress)
    || addressFromZohoAddresses(data)
    || locationFallback(data)
  );
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

export function contactFromCustomerData(
  data: DocumentData | null | undefined,
  preferredAddress?: string | null,
): ZohoCustomerDisplayContact {
  const address = trimStr(preferredAddress) || (data ? addressFromCustomer(data) : null);
  const phone = data ? phoneFromCustomer(data) : null;
  const links = phone ? buildContactLinks(phone) : null;
  return {
    address,
    phone,
    telHref: links?.tel ?? null,
    whatsappHref: links?.whatsapp ?? null,
  };
}

/** Resolve display address (shipping → billing) + phone links for a Zoho customer. */
export async function resolveZohoCustomerDisplayContact(
  customerId: string | null | undefined,
  preferredAddress?: string | null,
): Promise<ZohoCustomerDisplayContact> {
  const id = String(customerId ?? '').trim();
  if (!id) {
    return contactFromCustomerData(null, preferredAddress);
  }
  try {
    const snap = await getDoc(doc(db, 'zohoCustomers', id));
    if (!snap.exists()) {
      return contactFromCustomerData(null, preferredAddress);
    }
    return contactFromCustomerData(snap.data(), preferredAddress);
  } catch {
    return contactFromCustomerData(null, preferredAddress);
  }
}
