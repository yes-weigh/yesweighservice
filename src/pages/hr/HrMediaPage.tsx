import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canManageWarehouseUsers } from '../../lib/staffAccess';
import { UserManagement } from '../shared/UserManagement';

type HrMediaPageProps = {
  basePath: string;
};

export const HrMediaPage: React.FC<HrMediaPageProps> = ({ basePath }) => {
  const { user } = useAuth();

  if (!canManageWarehouseUsers(user)) {
    return <Navigate to={`${basePath}/hr/staff`} replace />;
  }

  return (
    <UserManagement
      role="media"
      title="Media users"
      description="Catalog media editors who manage product images, files, and notes."
      preferUsernameLogin
    />
  );
};
