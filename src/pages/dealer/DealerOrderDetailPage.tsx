import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';

/** Legacy portal order detail — redirects to Zoho sales orders. */
export const DealerOrderDetailPage: React.FC = () => {
  const { user } = useAuth();
  const { orderId } = useParams<{ orderId: string }>();
  const base = user ? homePathForRole(user.role) : '/dealer';
  void orderId;
  return <Navigate to={`${base}/sales-orders`} replace />;
};
