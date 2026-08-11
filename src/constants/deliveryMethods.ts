export type DeliveryMethodId =
  | 'st_courier'
  | 'trackon_air'
  | 'trackon_surface'
  | 'delhivery'
  | 'bluedart_air'
  | 'bluedart_surface'
  | 'bluedart_domestic'
  | 'dtdc'
  | 'ecosafe'
  | 'aps'
  | 'personal_collection';

export interface DeliveryMethod {
  id: DeliveryMethodId;
  label: string;
  image: string;
}

export const DELIVERY_METHODS: DeliveryMethod[] = [
  { id: 'st_courier', label: 'ST COURIER', image: '/logistics/st-courier.png' },
  {
    id: 'trackon_air',
    label: 'TRACKON AIR',
    image: '/logistics/trackon.png',
  },
  {
    id: 'trackon_surface',
    label: 'TRACKON SURFACE',
    image: '/logistics/trackon.png',
  },
  { id: 'delhivery', label: 'DELHIVERY', image: '/logistics/delhivery.png' },
  {
    id: 'bluedart_air',
    label: 'BLUE DART AIR',
    image: '/logistics/bluedart-air.webp',
  },
  {
    id: 'bluedart_surface',
    label: 'BLUE DART SURFACE',
    image: '/logistics/bluedart-surface.webp',
  },
  {
    id: 'bluedart_domestic',
    label: 'BLUE DART DOMESTIC',
    image: '/logistics/bluedart-domestic-priority.webp',
  },
  { id: 'dtdc', label: 'DTDC', image: '/logistics/dtdc.png' },
  { id: 'ecosafe', label: 'ECO SAFE', image: '/logistics/ecosafe.png' },
  { id: 'aps', label: 'ALLEPPEY PARCEL SERVICE L.L.P', image: '/logistics/aps.png' },
  { id: 'personal_collection', label: 'PERSONAL COLLECTION', image: '/logistics/personal-collection.png' },
];

export function deliveryMethodLabel(id: DeliveryMethodId): string {
  return DELIVERY_METHODS.find(method => method.id === id)?.label ?? id;
}
