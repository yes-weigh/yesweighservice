const ALL_STAFF_PERMISSIONS = [
  'dealers.view', 'dealers.edit', 'dealers.sync', 'leads.view', 'leads.manage',
  'support.view', 'support.manage', 'support.service', 'support.return', 'support.complaint',
  'orders.view', 'orders.manage', 'catalog.view', 'catalog.manage', 'catalog.sync',
  'staff.manage', 'hr.view', 'hr.manage', 'tasks.view', 'invoices.view',
  'logistics.view', 'loyalty.view', 'verification.view', 'verification.manage', 'advertisements.view',
];

const DEPARTMENT_DEFAULT_PERMISSIONS = {
  sales: ['dealers.view', 'leads.view', 'leads.manage', 'catalog.view', 'invoices.view', 'loyalty.view', 'tasks.view', 'advertisements.view'],
  service: ['support.view', 'support.manage', 'support.service', 'support.complaint', 'verification.view', 'verification.manage', 'catalog.view'],
  logistics: ['orders.view', 'orders.manage', 'support.view', 'support.return', 'invoices.view', 'logistics.view', 'loyalty.view', 'catalog.view'],
  admin: ALL_STAFF_PERMISSIONS,
};

const DEPARTMENT_SUPPORT_TYPES = {
  sales: [],
  service: ['service', 'complaint'],
  logistics: ['return'],
  admin: 'all',
};

function resolveStaffPermissions(userData) {
  if (!userData || userData.role !== 'staff') return [];
  const accessMode = userData.staffAccessMode ?? 'role';
  const permissions = Array.isArray(userData.staffPermissions) ? userData.staffPermissions : [];
  if ((accessMode === 'custom' || accessMode === 'role') && permissions.length > 0) {
    const set = new Set(permissions);
    return ALL_STAFF_PERMISSIONS.filter(permission => set.has(permission));
  }
  const department = userData.staffDepartment ?? 'admin';
  return DEPARTMENT_DEFAULT_PERMISSIONS[department] ?? DEPARTMENT_DEFAULT_PERMISSIONS.admin;
}

export function allowedSupportTypesForUserData(userData) {
  if (!userData) return [];
  if (userData.role === 'super_admin') return 'all';
  if (userData.role !== 'staff') return [];

  const department = userData.staffDepartment ?? 'admin';
  const deptTypes = DEPARTMENT_SUPPORT_TYPES[department] ?? [];
  const permissions = resolveStaffPermissions(userData);

  if (!permissions.includes('support.view') && !permissions.includes('support.manage')) {
    return [];
  }

  if (deptTypes === 'all') return 'all';

  const allowed = new Set(deptTypes);
  if (permissions.includes('support.service')) allowed.add('service');
  if (permissions.includes('support.return')) allowed.add('return');
  if (permissions.includes('support.complaint')) allowed.add('complaint');
  return [...allowed];
}

export function canReceiveSupportTicketNotification(userData, requestType) {
  const allowed = allowedSupportTypesForUserData(userData);
  if (allowed === 'all') return true;
  return allowed.includes(requestType);
}

export function isOpsRole(role) {
  return role === 'staff' || role === 'super_admin';
}

export function isDealerSideRole(role) {
  return role === 'dealer' || role === 'dealer_staff';
}
