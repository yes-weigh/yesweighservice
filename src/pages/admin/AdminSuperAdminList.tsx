import { UserManagement } from '../shared/UserManagement';

export const AdminSuperAdminList = () => (
  <UserManagement
    role="super_admin"
    title="Super Admins"
    description="Manage super admin portal accounts. Super admins have full control over staff, dealers, and system settings."
  />
);
