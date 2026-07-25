import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';

/** Legacy portal order detail — redirects to Zoho sales orders list. */
export const StaffOrderDetailPage: React.FC = () => {
  const { user } = useAuth();
  const { orderId } = useParams<{ orderId: string }>();
  const base = user ? homePathForRole(user.role) : '/staff';
  // Old portal ids are not Zoho SO ids — send users to the SO list.
  void orderId;
  return <Navigate to={`${base}/sales-orders`} replace />;
};
