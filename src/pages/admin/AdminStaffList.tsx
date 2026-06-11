import { UserManagement } from '../shared/UserManagement';

export const AdminStaffList = () => (
  <UserManagement
    role="staff"
    title="Staff"
    description="YesWeigh internal staff who support service operations."
  />
);
