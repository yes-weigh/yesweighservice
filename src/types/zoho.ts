export interface ZohoCatalogItem {
  id: string;
  name: string;
  sku: string;
  rate: number;
  status: string;
  unit: string;
  type: string;
  description: string;
  groupId?: string;
  groupName?: string;
}

export interface ZohoItemGroup {
  id: string;
  name: string;
  description: string;
  status: string;
  unit: string;
  itemCount: number;
  items: ZohoCatalogItem[];
}

export interface ZohoCatalogStats {
  totalItems: number;
  totalGroups: number;
  activeItems: number;
  activeGroups: number;
}

export interface ZohoCatalogResponse {
  organizationId: string;
  syncedAt: string;
  stats: ZohoCatalogStats;
  items: ZohoCatalogItem[];
  itemGroups: ZohoItemGroup[];
}
