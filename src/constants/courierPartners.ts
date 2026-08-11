import type { CourierPartnerId } from '../types/logistics-dispatch';

export interface CourierPartner {
  id: CourierPartnerId;
  label: string;
  image: string | null;
}

export const COURIER_PARTNERS: CourierPartner[] = [
  { id: 'st_courier', label: 'ST Courier', image: '/logistics/st-courier.png' },
  { id: 'trackon_air', label: 'Trackon Air', image: '/logistics/trackon.png' },
  { id: 'trackon_surface', label: 'Trackon Surface', image: '/logistics/trackon.png' },
  { id: 'delhivery', label: 'Delhivery', image: '/logistics/delhivery.png' },
  { id: 'bluedart_air', label: 'Blue Dart Air', image: '/logistics/bluedart-air.webp' },
  { id: 'bluedart_surface', label: 'Blue Dart Surface', image: '/logistics/bluedart-surface.webp' },
  { id: 'bluedart_domestic', label: 'Blue Dart Domestic', image: '/logistics/bluedart-domestic-priority.webp' },
  { id: 'dtdc', label: 'DTDC', image: '/logistics/dtdc.png' },
  { id: 'ecosafe', label: 'Ecosafe', image: '/logistics/ecosafe.png' },
  { id: 'aps', label: 'Alleppey Parcel Service', image: '/logistics/aps.png' },
  { id: 'personal_collection', label: 'Customer Pickup', image: '/logistics/personal-collection.png' },
];

export function courierPartnerLabel(id: CourierPartnerId): string {
  return COURIER_PARTNERS.find(partner => partner.id === id)?.label ?? id;
}
