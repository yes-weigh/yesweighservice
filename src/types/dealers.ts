export interface ZohoContactPerson {
  id: string | null;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  isPrimary: boolean;
  isAddedInPortal: boolean;
}

export interface ZohoAddressRaw {
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  state_code?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  phone?: string;
}

export interface ZohoDealer {
  id: string;
  contactName: string;
  firstName: string | null;
  companyName: string | null;
  email: string | null;
  zohoEmail?: string | null;
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
  portalLoginId?: string | null;
  signedIn: boolean;
  /** Local overlay — not synced back to Zoho */
  designation?: string | null;
  alternateMobile?: string | null;
  whatsappNumber?: string | null;
  dealerType?: string | null;
  firmType?: string | null;
  creditLimit?: number | null;
  priceLevel?: string | null;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  googleMapsUrl?: string | null;
  canBuySpares?: boolean;
  orderPayOffline?: boolean;
  orderPayOnline?: boolean;
  adminApprovalRequired?: boolean;
  maxOrderLimit?: number | null;
  /** Read-only fields synced from Zoho Inventory */
  zohoGstNo?: string | null;
  zohoGstTreatment?: string | null;
  zohoPanNo?: string | null;
  zohoPlaceOfContact?: string | null;
  zohoPlaceOfContactLabel?: string | null;
  zohoPaymentTermsLabel?: string | null;
  zohoCurrencyCode?: string | null;
  zohoPortalStatus?: string | null;
  zohoPortalStatusLabel?: string | null;
  zohoWebsite?: string | null;
  zohoCustomFields?: unknown[];
  zohoTags?: string[];
  zohoCreatedTime?: string | null;
  zohoLastModifiedTime?: string | null;
  zohoCustomerSubType?: string | null;
  zohoCustomerCreditLimit?: number | null;
  zohoLegalName?: string | null;
  zohoBillingAddress?: string | null;
  zohoShippingAddress?: string | null;
  zohoBillingAddressRaw?: ZohoAddressRaw | null;
  zohoShippingAddressRaw?: ZohoAddressRaw | null;
  zohoContactPersons?: ZohoContactPerson[];
  zohoPrimaryContact?: ZohoContactPerson | null;
  zohoCreditLimit?: number | null;
  zohoPricebookName?: string | null;
  zohoOwnerName?: string | null;
  zohoTaxName?: string | null;
  zohoTaxPercentage?: number | null;
  zohoBranchName?: string | null;
  zohoLocationName?: string | null;
  zohoNotes?: string | null;
  zohoIsLinkedWithZohoCrm?: boolean;
  zohoPrimaryContactId?: string | null;
  zohoHasTransaction?: boolean;
  zohoDetailSyncedAt?: string | null;
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

export const DEALER_TYPES = ['Authorized Dealer', 'Distributor', 'Retailer', 'Enterprise'] as const;

export const FIRM_TYPES = [
  'Proprietorship',
  'Partnership',
  'Private Limited',
  'LLP',
  'Other',
] as const;

export const PRICE_LEVELS = ['Dealer Price', 'Wholesale Price', 'Retail Price'] as const;
