import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { homePathForRole } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { supportBasePath } from '../../lib/dealerSupport';

/** Redirect legacy /services, /returns, /complaints, /service paths to unified hub */
export const LegacySupportRedirect: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';
  return <Navigate to={base} replace state={location.state} />;
};

/** Redirect legacy /services/new and /service/new with state preserved */
export const LegacySupportNewRedirect: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const base = user ? supportBasePath(user.role) : '/dealer/warranty-support';
  return <Navigate to={base} replace state={location.state} />;
};

/** Staff portal placeholder for warranty hub */
export const StaffSupportPlaceholder: React.FC = () => {
  const { user } = useAuth();
  const home = user ? homePathForRole(user.role) : '/staff';
  return <Navigate to={home} replace />;
};
