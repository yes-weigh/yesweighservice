import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { landingPathForRole, type Role } from '../types';

interface ProtectedRouteProps {
  allowedRoles: Role[];
  loginPath?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, loginPath = '/signup' }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="full-screen-loader-container">
        <div className="loader-ring" />
      </div>
    );
  }

  if (!user) return <Navigate to={loginPath} replace />;

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={landingPathForRole(user.role)} replace />;
  }

  return <Outlet />;
};
