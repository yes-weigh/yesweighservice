import { DELIVERY_METHODS, type DeliveryMethodId } from './deliveryMethods';
import type { CourierPartnerId } from '../types/logistics-dispatch';

export function deliveryMethodToCourierPartnerId(id: DeliveryMethodId): CourierPartnerId {
  if (id === 'personal_collection') return 'customer_pickup';
  return id;
}

export function courierPartnerToDeliveryMethodId(id: CourierPartnerId): DeliveryMethodId {
  if (id === 'customer_pickup') return 'personal_collection';
  if (id === 'transport_lorry') return 'own_vehicle';
  return id;
}

export { DELIVERY_METHODS };
