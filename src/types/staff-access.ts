import type { SupportRequestType } from './dealer-support';

export type StaffDepartment = 'sales' | 'service' | 'logistics' | 'admin';

export const STAFF_DEPARTMENTS: StaffDepartment[] = ['sales', 'service', 'logistics', 'admin'];

export const STAFF_DEPARTMENT_LABELS: Record<StaffDepartment, string> = {
  sales: 'Sales',
  service: 'Service',
  logistics: 'Logistics',
  admin: 'Admin',
};

export const STAFF_DEPARTMENT_DESCRIPTIONS: Record<StaffDepartment, string> = {
  sales: 'Dealers, leads, and account relationships',
  service: 'Repairs, complaints, and warranty support',
  logistics: 'Orders, RMA, and dispatch',
  admin: 'Catalog, staff, and organisation-wide operations',
};

export type StaffPermission =
  | 'dealers.view'
  | 'dealers.edit'
  | 'dealers.sync'
  | 'leads.view'
  | 'leads.manage'
  | 'support.view'
  | 'support.manage'
  | 'support.service'
  | 'support.return'
  | 'support.complaint'
  | 'orders.view'
  | 'orders.manage'
  | 'catalog.view'
  | 'catalog.manage'
  | 'catalog.sync'
  | 'staff.manage'
  | 'hr.view'
  | 'hr.manage'
  | 'tasks.view'
  | 'invoices.view'
  | 'verification.view'
  | 'verification.manage'
  | 'advertisements.view';

export const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  'dealers.view',
  'dealers.edit',
  'dealers.sync',
  'leads.view',
  'leads.manage',
  'support.view',
  'support.manage',
  'support.service',
  'support.return',
  'support.complaint',
  'orders.view',
  'orders.manage',
  'catalog.view',
  'catalog.manage',
  'catalog.sync',
  'staff.manage',
  'hr.view',
  'hr.manage',
  'tasks.view',
  'invoices.view',
  'verification.view',
  'verification.manage',
  'advertisements.view',
];

export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  'dealers.view': 'View dealers',
  'dealers.edit': 'Edit dealers',
  'dealers.sync': 'Sync dealers from Zoho',
  'leads.view': 'View leads',
  'leads.manage': 'Manage leads',
  'support.view': 'View support tickets',
  'support.manage': 'Manage ticket status & chat',
  'support.service': 'Service / repair tickets',
  'support.return': 'Replacement / RMA tickets',
  'support.complaint': 'Complaint tickets',
  'orders.view': 'View orders',
  'orders.manage': 'Manage orders',
  'catalog.view': 'Browse catalog',
  'catalog.manage': 'Edit catalog & spares',
  'catalog.sync': 'Sync catalog from Zoho',
  'staff.manage': 'Manage staff roles',
  'hr.view': 'View HR staff directory',
  'hr.manage': 'Manage HR staff & documents',
  'tasks.view': 'View tasks',
  'invoices.view': 'View invoices',
  'verification.view': 'View verifications',
  'verification.manage': 'Manage verifications',
  'advertisements.view': 'View advertisements',
};

export const STAFF_PERMISSION_GROUPS: Array<{
  id: string;
  label: string;
  permissions: StaffPermission[];
}> = [
  {
    id: 'dealers',
    label: 'Dealers',
    permissions: ['dealers.view', 'dealers.edit', 'dealers.sync'],
  },
  {
    id: 'leads',
    label: 'Leads',
    permissions: ['leads.view', 'leads.manage'],
  },
  {
    id: 'support',
    label: 'Warranty & support',
    permissions: [
      'support.view',
      'support.manage',
      'support.service',
      'support.return',
      'support.complaint',
    ],
  },
  {
    id: 'orders',
    label: 'Orders & logistics',
    permissions: ['orders.view', 'orders.manage'],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    permissions: ['catalog.view', 'catalog.manage', 'catalog.sync'],
  },
  {
    id: 'hr',
    label: 'Human resources',
    permissions: ['hr.view', 'hr.manage', 'staff.manage'],
  },
  {
    id: 'org',
    label: 'Organisation',
    permissions: ['tasks.view'],
  },
  {
    id: 'other',
    label: 'Other',
    permissions: [
      'invoices.view',
      'verification.view',
      'verification.manage',
      'advertisements.view',
    ],
  },
];

export const DEPARTMENT_DEFAULT_PERMISSIONS: Record<StaffDepartment, StaffPermission[]> = {
  sales: [
    'dealers.view',
    'leads.view',
    'leads.manage',
    'catalog.view',
    'invoices.view',
    'tasks.view',
    'advertisements.view',
  ],
  service: [
    'support.view',
    'support.manage',
    'support.service',
    'support.complaint',
    'verification.view',
    'verification.manage',
    'catalog.view',
  ],
  logistics: [
    'orders.view',
    'orders.manage',
    'support.view',
    'support.return',
    'invoices.view',
    'catalog.view',
  ],
  admin: [...ALL_STAFF_PERMISSIONS],
};

export const DEPARTMENT_SUPPORT_TYPES: Record<StaffDepartment, SupportRequestType[] | 'all'> = {
  sales: [],
  service: ['service', 'complaint'],
  logistics: ['return'],
  admin: 'all',
};

export type StaffAccessMode = 'role' | 'custom' | 'department';

export type StaffAccessProfile = {
  department: StaffDepartment;
  accessMode: StaffAccessMode;
  roleId: string | null;
  permissions: StaffPermission[];
  kamId: string | null;
  teamId: string | null;
};

export const DEFAULT_STAFF_ACCESS: StaffAccessProfile = {
  department: 'admin',
  accessMode: 'role',
  roleId: null,
  permissions: [],
  kamId: null,
  teamId: null,
};
