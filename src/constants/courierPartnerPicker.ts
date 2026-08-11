import { DELIVERY_METHODS, type DeliveryMethodId } from './deliveryMethods';
import type { CourierPartnerId } from '../types/logistics-dispatch';

export function deliveryMethodToCourierPartnerId(id: DeliveryMethodId): CourierPartnerId {
  return id;
}

export function courierPartnerToDeliveryMethodId(id: CourierPartnerId): DeliveryMethodId {
  return id;
}

export { DELIVERY_METHODS };
