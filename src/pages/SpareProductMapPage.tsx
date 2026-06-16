import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { SpareProductMapView } from '../components/catalog/SpareProductMapView';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../types';
import type { CatalogProduct } from '../types/catalog';

export const SpareProductMapPage: React.FC = () => {
  const { user } = useAuth();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const preview = (location.state as { preview?: CatalogProduct } | null)?.preview ?? null;
  const base = user ? homePathForRole(user.role) : '/staff';
  const listPath = `${base}/spares`;
  const sparesBasePath = `${base}/spares`;
  const canManage = user?.role === 'staff' || user?.role === 'super_admin';
  const showStockQuantity = canManage;

  if (!productId) return null;

  return (
    <div className="page-content fade-in spare-product-map-page">
      <SpareProductMapView
        productId={productId}
        backPath={listPath}
        backLabel="Back to spares"
        preview={preview && preview.id === productId ? preview : null}
        canManage={canManage}
        showStockQuantity={showStockQuantity}
        sparesBasePath={sparesBasePath}
      />
    </div>
  );
};
