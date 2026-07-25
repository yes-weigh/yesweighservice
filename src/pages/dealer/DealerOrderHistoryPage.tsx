import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';

/** Legacy portal order history — redirects to Zoho sales orders. */
export const DealerOrderHistoryPage: React.FC = () => {
  const { user } = useAuth();
  const base = user ? homePathForRole(user.role) : '/dealer';
  return <Navigate to={`${base}/sales-orders`} replace />;
};
