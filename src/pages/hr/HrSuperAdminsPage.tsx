import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isLocalhostDev } from '../../lib/isLocalhost';
import { canManageSuperAdminsInHr } from '../../lib/staffAccess';
import { UserManagement } from '../shared/UserManagement';

type HrSuperAdminsPageProps = {
  basePath: string;
};

export const HrSuperAdminsPage: React.FC<HrSuperAdminsPageProps> = ({ basePath }) => {
  const { user } = useAuth();

  if (!canManageSuperAdminsInHr(user)) {
    return <Navigate to={`${basePath}/hr/staff`} replace />;
  }

  return (
    <UserManagement
      role="super_admin"
      title="Super Admins"
      description={
        isLocalhostDev()
          ? 'Manage super admin accounts and access (Full vs View only). Access controls are only shown on localhost.'
          : 'Manage super admin accounts. Only visible to super admins within HR.'
      }
    />
  );
};
