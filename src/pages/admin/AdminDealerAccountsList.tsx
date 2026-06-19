import { UserManagement } from '../shared/UserManagement';

export const AdminDealerAccountsList = () => (
  <UserManagement
    role="dealer"
    title="Dealer portal accounts"
    description="Manage dealer logins and assign standard or company-director access (stock visibility)."
    showDealerPicker={false}
  />
);
