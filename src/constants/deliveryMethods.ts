export type DeliveryMethodId =
  | 'st_courier'
  | 'trackon'
  | 'delhivery'
  | 'bluedart'
  | 'dtdc'
  | 'ecosafe'
  | 'aps'
  | 'personal_collection'
  | 'own_vehicle';

export interface DeliveryMethod {
  id: DeliveryMethodId;
  label: string;
  image: string;
}

export const DELIVERY_METHODS: DeliveryMethod[] = [
  { id: 'st_courier', label: 'ST COURIER', image: '/logistics/st-courier.svg' },
  { id: 'trackon', label: 'TRACKON', image: '/logistics/trackon.svg' },
  { id: 'delhivery', label: 'DELHIVERY', image: '/logistics/delhivery.svg' },
  { id: 'bluedart', label: 'BLUEDART', image: '/logistics/bluedart.svg' },
  { id: 'dtdc', label: 'DTDC', image: '/logistics/dtdc.svg' },
  { id: 'ecosafe', label: 'ECO SAFE', image: '/logistics/ecosafe.svg' },
  { id: 'aps', label: 'ALLEPPEY PARCEL SERVICE L.L.P', image: '/logistics/aps.svg' },
  { id: 'personal_collection', label: 'PERSONAL COLLECTION', image: '/logistics/personal-collection.svg' },
  { id: 'own_vehicle', label: 'OWN VEHICLE', image: '/logistics/own-vehicle.svg' },
];

export function deliveryMethodLabel(id: DeliveryMethodId): string {
  return DELIVERY_METHODS.find(method => method.id === id)?.label ?? id;
}
