import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { dealerOrderErrorMessage } from './dealerOrders';

const functions = getFunctions(app, 'asia-south1');

export type ShippingAddressKind = 'billing' | 'shipping' | 'additional';

export interface ShippingAddress {
  addressId: string | null;
  kind: ShippingAddressKind | string;
  label: string;
  formatted: string | null;
  attention: string | null;
  address: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
}

export type NewShippingAddressInput = {
  attention: string;
  address: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
};

export type ShippingSelection =
  | { mode: 'saved'; addressId: string }
  | { mode: 'kind'; kind: 'billing' | 'shipping' }
  | { mode: 'new'; newAddress: NewShippingAddressInput };

async function call<TReq, TRes>(name: string, data?: TReq, timeout = 60_000): Promise<TRes> {
  const callable = httpsCallable<TReq | undefined, TRes>(functions, name, { timeout });
  const result = await callable(data);
  return result.data;
}

export async function listDealerShippingAddresses(): Promise<ShippingAddress[]> {
  try {
    const res = await call<undefined, { addresses?: ShippingAddress[] }>(
      'listDealerShippingAddresses',
    );
    return Array.isArray(res.addresses) ? res.addresses : [];
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function addDealerShippingAddress(
  address: NewShippingAddressInput,
): Promise<ShippingAddress> {
  try {
    const res = await call<{ address: NewShippingAddressInput }, { address: ShippingAddress }>(
      'addDealerShippingAddress',
      { address },
    );
    return res.address;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function listCustomerShippingAddresses(
  customerId: string,
): Promise<ShippingAddress[]> {
  try {
    const res = await call<{ customerId: string }, { addresses?: ShippingAddress[] }>(
      'listCustomerShippingAddresses',
      { customerId },
    );
    return Array.isArray(res.addresses) ? res.addresses : [];
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export async function addCustomerShippingAddress(
  customerId: string,
  address: NewShippingAddressInput,
): Promise<ShippingAddress> {
  try {
    const res = await call<
      { customerId: string; address: NewShippingAddressInput },
      { address: ShippingAddress }
    >('addCustomerShippingAddress', { customerId, address });
    return res.address;
  } catch (err) {
    throw new Error(dealerOrderErrorMessage(err));
  }
}

export function shippingSelectionPayload(selection: ShippingSelection): {
  addressId?: string;
  kind?: string;
  newAddress?: NewShippingAddressInput;
} {
  if (selection.mode === 'saved') return { addressId: selection.addressId };
  if (selection.mode === 'kind') return { kind: selection.kind };
  return { newAddress: selection.newAddress };
}

export const EMPTY_NEW_ADDRESS: NewShippingAddressInput = {
  attention: '',
  address: '',
  street2: '',
  city: '',
  state: '',
  zip: '',
  country: 'India',
  phone: '',
};

export function validateNewShippingAddress(
  addr: NewShippingAddressInput,
): string | null {
  if (!addr.attention.trim()) return 'Attention / contact name is required.';
  if (!addr.address.trim()) return 'Address line 1 is required.';
  if (!addr.city.trim()) return 'City is required.';
  if (!addr.state.trim()) return 'State is required.';
  if (!/^\d{6}$/.test(addr.zip.trim())) return 'PIN code must be a 6-digit number.';
  if (!addr.country.trim()) return 'Country is required.';
  if (!addr.phone.trim()) return 'Phone is required.';
  return null;
}
