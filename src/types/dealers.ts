export interface ZohoDealer {
  id: string;
  contactName: string;
  firstName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  status: string;
  outstandingReceivable: number;
  unusedCredits: number;
  syncedAt: string | null;
  isFiltered: boolean;
  filterReason: string | null;
  kamId: string | null;
  kamName: string | null;
  dealerStage: string | null;
  billingState: string | null;
  district: string | null;
  zipCode: string | null;
  categories: string[];
  portalUserId: string | null;
  portalUserName: string | null;
  signedIn: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  extraFields?: Record<string, unknown>;
}

export interface Kam {
  id: string;
  name: string;
  phone: string | null;
}

export interface DealerListParams {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  kamId?: string;
  dealerStage?: string;
  dealerStatus?: string;
  billingState?: string;
  district?: string;
  categories?: string;
  signedIn?: 'true' | 'false' | '';
  sortField?: string;
  sortDir?: 'asc' | 'desc';
}

export interface DealerListResponse {
  data: ZohoDealer[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface DealerStats {
  total: number;
  active: number;
  blacklisted: number;
  inactive: number;
  unassignedKam: number;
}

export const DEFAULT_DEALER_CATEGORIES = [
  'Wholesaler',
  'Retailer',
  'Distributor',
  'Direct Enterprise',
];

export const DEALER_STAGES = ['Active', 'Non Active', 'Black listed'] as const;
