import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { invoiceErrorMessage } from './invoices';

const functions = getFunctions(app, 'asia-south1');

export type ZohoVendorOption = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  gstNo: string | null;
  currencyCode: string;
  status: string;
  city: string | null;
  state: string | null;
  address: string | null;
};

export async function searchZohoVendors(query = '', page = 1): Promise<ZohoVendorOption[]> {
  const callable = httpsCallable<
    { query?: string; page?: number; perPage?: number; all?: boolean },
    { vendors?: ZohoVendorOption[] }
  >(functions, 'searchZohoVendors', { timeout: 60_000 });
  try {
    const needle = query.trim();
    const result = await callable({
      query: needle,
      page,
      perPage: 50,
      all: false,
    });
    return Array.isArray(result.data?.vendors) ? result.data.vendors : [];
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}

/** Load every active Zoho vendor (pages until Zoho has no more). */
export async function listAllZohoVendors(): Promise<ZohoVendorOption[]> {
  const seen = new Set<string>();
  const all: ZohoVendorOption[] = [];
  for (let page = 1; page <= 40; page += 1) {
    const rows = await searchZohoVendors('', page);
    for (const row of rows) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      all.push(row);
    }
    if (rows.length < 50) break;
  }
  return all;
}
