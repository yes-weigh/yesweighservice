import { UserManagement } from '../shared/UserManagement';
import { useAuth } from '../../context/AuthContext';

export const DealerTeamPage = () => {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <UserManagement
      role="dealer_staff"
      title="Dealer Staff"
      description="Add staff under your dealership and choose whether they see warehouse stock levels."
      scopedDealerId={user.uid}
    />
  );
};
