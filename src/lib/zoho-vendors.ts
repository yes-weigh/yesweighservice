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

export async function searchZohoVendors(query: string, page = 1): Promise<ZohoVendorOption[]> {
  const callable = httpsCallable<
    { query?: string; page?: number; perPage?: number },
    { vendors?: ZohoVendorOption[] }
  >(functions, 'searchZohoVendors', { timeout: 30_000 });
  try {
    const result = await callable({
      query: query.trim(),
      page,
      perPage: 25,
    });
    return Array.isArray(result.data?.vendors) ? result.data.vendors : [];
  } catch (err) {
    throw new Error(invoiceErrorMessage(err));
  }
}
