import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { SpareProductMapView } from '../components/catalog/SpareProductMapView';
import { useAuth } from '../context/AuthContext';
import { catalogBaseForRole } from '../lib/catalogRoutes';
import { canViewCatalogStock } from '../lib/dealerAccess';
import type { CatalogProduct } from '../types/catalog';

export const SpareProductMapPage: React.FC = () => {
  const { user } = useAuth();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const navState = location.state as {
    preview?: CatalogProduct;
    returnCategoryId?: string;
  } | null;
  const preview = navState?.preview ?? null;
  const returnCategoryId = navState?.returnCategoryId ?? preview?.categoryId ?? '';
  const catalogBase = user ? catalogBaseForRole(user.role) : '/staff/catalog';
  const listPath = returnCategoryId
    ? `${catalogBase}?section=map&category=${encodeURIComponent(returnCategoryId)}`
    : `${catalogBase}?section=map`;
  const sparesBasePath = `${catalogBase}/spare`;
  const canManage = user?.role === 'staff' || user?.role === 'super_admin';
  const showStockQuantity = canManage || canViewCatalogStock(user);

  if (!productId) return null;

  return (
    <div className="page-content fade-in spare-product-map-page">
      <SpareProductMapView
        productId={productId}
        backPath={listPath}
        backLabel="Back to catalog"
        preview={preview && preview.id === productId ? preview : null}
        canManage={canManage}
        showStockQuantity={showStockQuantity}
        sparesBasePath={sparesBasePath}
      />
    </div>
  );
};
