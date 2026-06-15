import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../types';
import type { CatalogProduct } from '../types/catalog';
import { ProductDetailView } from '../components/catalog/ProductDetailView';

export const ProductDetailPage: React.FC = () => {
  const { user } = useAuth();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const isPublic = location.pathname.startsWith('/oc/');
  const isSpares = /\/spares\/[^/]+$/.test(location.pathname);
  const backPath = isPublic ? '/oc' : location.pathname.replace(/\/[^/]+$/, '');
  const preview = (location.state as { preview?: CatalogProduct } | null)?.preview ?? null;
  const showWarehouseStock = user?.role === 'staff' || user?.role === 'super_admin';
  const showCartActions = user?.role === 'dealer' || user?.role === 'dealer_staff';
  const manageSpareLinks = user?.role === 'staff' || user?.role === 'super_admin';
  const showRelatedLinks =
    !isPublic
    && (manageSpareLinks || user?.role === 'dealer' || user?.role === 'dealer_staff');
  const ordersPath = user ? `${homePathForRole(user.role)}/orders` : '/dealer/orders';
  const base = user ? homePathForRole(user.role) : '/dealer';
  const productsBasePath = `${base}/products`;
  const sparesBasePath = `${base}/spares`;
  const backLabel = isPublic
    ? 'Back to catalog'
    : isSpares
      ? 'Back to spares'
      : 'Back to products';

  if (!productId) {
    return null;
  }

  return (
    <div className={`page-content fade-in ${isPublic ? 'open-catalog-page' : 'product-detail-page-wrap'}`}>
      <ProductDetailView
        productId={productId}
        backPath={backPath}
        backLabel={backLabel}
        preview={preview && preview.id === productId ? preview : null}
        variant={isPublic ? 'public' : 'app'}
        showWarehouseStock={showWarehouseStock}
        showCartActions={showCartActions}
        showRelatedLinks={showRelatedLinks}
        manageSpareLinks={manageSpareLinks}
        productsBasePath={productsBasePath}
        sparesBasePath={sparesBasePath}
        ordersPath={ordersPath}
      />
    </div>
  );
};
