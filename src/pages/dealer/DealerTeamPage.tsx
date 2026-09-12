import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCatalogPageHeader } from '../../context/PageHeaderContext';
import { isDealerAdminStaff } from '../../lib/dealerAccess';
import { DealerTeamRoster } from '../../components/dealers/DealerTeamRoster';

export const DealerTeamPage: React.FC = () => {
  const { user } = useAuth();
  useCatalogPageHeader({ title: 'Team' });

  const dealerAccountUid = user?.role === 'dealer'
    ? user.uid
    : (user?.dealerId?.trim() || null);
  const canManage = user?.role === 'dealer' || isDealerAdminStaff(user);

  return (
    <DealerTeamRoster
      dealerAccountUid={dealerAccountUid}
      canManage={canManage}
      passwordReset="owner"
      dealerAccess={user ? {
        dealerTier: user.dealerTier,
        dealerAccessMode: user.dealerAccessMode,
        dealerPermissions: user.dealerPermissions,
      } : null}
    />
  );
};
