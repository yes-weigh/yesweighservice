import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canManageWarehouseUsers } from '../../lib/staffAccess';
import { UserManagement } from '../shared/UserManagement';

type HrWarehousePageProps = {
  basePath: string;
};

export const HrWarehousePage: React.FC<HrWarehousePageProps> = ({ basePath }) => {
  const { user } = useAuth();

  if (!canManageWarehouseUsers(user)) {
    return <Navigate to={`${basePath}/hr/staff`} replace />;
  }

  return (
    // role="warehouse" is the persisted Firestore/auth role id — keep it.
    // UI copy uses "Stock auditor" (formerly labeled Warehouse in HR).
    <UserManagement
      role="warehouse"
      title="Stock auditor users"
      description="YesStore stock auditors who photograph racks, bins, and items on the floor (warehouse role in code)."
      preferUsernameLogin
    />
  );
};
