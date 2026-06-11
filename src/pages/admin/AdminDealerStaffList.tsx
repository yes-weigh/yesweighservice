import { UserManagement } from '../shared/UserManagement';

export const AdminDealerStaffList = () => (
  <UserManagement
    role="dealer_staff"
    title="Dealer Staff"
    description="Staff assigned to a dealer. Link each user to their reporting dealer."
    showDealerPicker
  />
);
