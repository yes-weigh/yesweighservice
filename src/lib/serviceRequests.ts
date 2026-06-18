/** @deprecated Import from ./dealerSupport instead */
export {
  servicesBasePath,
  supportBasePath,
  createSupportRequest as createServiceRequest,
  fetchDealerSupportRequests as fetchDealerServiceRequests,
} from './dealerSupport';

export type { SupportProductDraft as ServiceRequestDraft } from '../types/dealer-support';
