import type { CourierPartnerId } from '../types/logistics-dispatch';

export interface CourierPartner {
  id: CourierPartnerId;
  label: string;
  image: string | null;
}

export const COURIER_PARTNERS: CourierPartner[] = [
  { id: 'st_courier', label: 'ST Courier', image: '/logistics/st-courier.png' },
  { id: 'trackon', label: 'Trackon', image: '/logistics/trackon.png' },
  { id: 'delhivery', label: 'Delhivery', image: '/logistics/delhivery.png' },
  { id: 'bluedart', label: 'Blue Dart', image: '/logistics/bluedart.png' },
  { id: 'dtdc', label: 'DTDC', image: '/logistics/dtdc.png' },
  { id: 'ecosafe', label: 'Ecosafe', image: '/logistics/ecosafe.png' },
  { id: 'aps', label: 'Alleppey Parcel Service', image: '/logistics/aps.png' },
  { id: 'personal_collection', label: 'Customer Pickup', image: '/logistics/personal-collection.png' },
  { id: 'own_vehicle', label: 'Own Vehicle', image: '/logistics/own-vehicle.png' },
  { id: 'transport_lorry', label: 'Transport / Lorry', image: '/logistics/own-vehicle.png' },
];

export function courierPartnerLabel(id: CourierPartnerId): string {
  return COURIER_PARTNERS.find(partner => partner.id === id)?.label ?? id;
}
