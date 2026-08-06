export type DeliveryMethodId =
  | 'st_courier'
  | 'trackon'
  | 'delhivery'
  | 'bluedart_air'
  | 'bluedart_surface'
  | 'bluedart_domestic'
  | 'dtdc'
  | 'ecosafe'
  | 'aps'
  | 'personal_collection'
  | 'own_vehicle';

export interface DeliveryMethod {
  id: DeliveryMethodId;
  label: string;
  image: string;
  tagline: string;
}

export const DELIVERY_METHODS: DeliveryMethod[] = [
  { id: 'st_courier', label: 'ST COURIER', image: '/logistics/st-courier.png', tagline: 'Kerala & Tamil Nadu' },
  { id: 'trackon', label: 'TRACKON', image: '/logistics/trackon.png', tagline: 'Tamil Nadu' },
  { id: 'delhivery', label: 'DELHIVERY', image: '/logistics/delhivery.png', tagline: 'All India' },
  {
    id: 'bluedart_air',
    label: 'BLUE DART AIR',
    image: '/logistics/bluedart-air.webp',
    tagline: 'BDAIR · Express air',
  },
  {
    id: 'bluedart_surface',
    label: 'BLUE DART SURFACE',
    image: '/logistics/bluedart-surface.webp',
    tagline: 'BDFRC · Ground / Surface',
  },
  {
    id: 'bluedart_domestic',
    label: 'BLUE DART DOMESTIC',
    image: '/logistics/bluedart-domestic-priority.webp',
    tagline: 'BDDP · Domestic Priority',
  },
  { id: 'dtdc', label: 'DTDC', image: '/logistics/dtdc.png', tagline: 'Kerala' },
  { id: 'ecosafe', label: 'ECO SAFE', image: '/logistics/ecosafe.png', tagline: 'Bangalore' },
  { id: 'aps', label: 'ALLEPPEY PARCEL SERVICE L.L.P', image: '/logistics/aps.png', tagline: 'Kerala' },
  { id: 'personal_collection', label: 'PERSONAL COLLECTION', image: '/logistics/personal-collection.png', tagline: 'Customer pickup at counter' },
  { id: 'own_vehicle', label: 'OWN VEHICLE', image: '/logistics/own-vehicle.png', tagline: 'Delivered by our fleet' },
];

export function deliveryMethodLabel(id: DeliveryMethodId): string {
  return DELIVERY_METHODS.find(method => method.id === id)?.label ?? id;
}
