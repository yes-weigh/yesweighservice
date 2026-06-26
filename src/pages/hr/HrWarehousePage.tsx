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
    <UserManagement
      role="warehouse"
      title="Warehouse users"
      description="YesStore warehouse staff who photograph racks, bins, and items on the floor."
      preferUsernameLogin
    />
  );
};
