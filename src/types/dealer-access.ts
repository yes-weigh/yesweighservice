export type DealerTier = 'standard' | 'director';

export const DEALER_TIERS: DealerTier[] = ['standard', 'director'];

export const DEALER_TIER_LABELS: Record<DealerTier, string> = {
  standard: 'Standard dealer',
  director: 'Company director',
};

export const DEALER_TIER_DESCRIPTIONS: Record<DealerTier, string> = {
  standard: 'Browse catalog and place orders — stock quantities stay hidden',
  director: 'Company director access — see warehouse stock levels across the catalog',
};

export type DealerPermission =
  | 'catalog.stock_view'
  | 'catalog.warehouse_view';

export const ALL_DEALER_PERMISSIONS: DealerPermission[] = [
  'catalog.stock_view',
  'catalog.warehouse_view',
];

export const DEALER_PERMISSION_LABELS: Record<DealerPermission, string> = {
  'catalog.stock_view': 'View stock quantities',
  'catalog.warehouse_view': 'View warehouse breakdown',
};

export const DEALER_PERMISSION_GROUPS: Array<{
  id: string;
  label: string;
  permissions: DealerPermission[];
}> = [
  {
    id: 'catalog',
    label: 'Catalog visibility',
    permissions: ['catalog.stock_view', 'catalog.warehouse_view'],
  },
];

export const DEALER_TIER_DEFAULT_PERMISSIONS: Record<DealerTier, DealerPermission[]> = {
  standard: [],
  director: ['catalog.stock_view', 'catalog.warehouse_view'],
};

export type DealerAccessMode = 'tier' | 'custom';

export type DealerAccessProfile = {
  tier: DealerTier;
  accessMode: DealerAccessMode;
  permissions: DealerPermission[];
};

export const DEFAULT_DEALER_ACCESS: DealerAccessProfile = {
  tier: 'standard',
  accessMode: 'tier',
  permissions: [],
};
