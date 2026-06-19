import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homePathForRole, canUseCart } from '../types';
import { canViewCatalogStock, canViewWarehouseStock } from '../lib/dealerAccess';
import {
  catalogBaseForRole,
  isCatalogSpareDetailPath,
  isLegacySpareDetailPath,
} from '../lib/catalogRoutes';
import { resolveCatalogBack, type CatalogNavState } from '../lib/catalogNav';
import { ProductDetailView } from '../components/catalog/ProductDetailView';

export const ProductDetailPage: React.FC = () => {
  const { user } = useAuth();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const isPublic = location.pathname.startsWith('/oc/');
  const isSpare = isCatalogSpareDetailPath(location.pathname) || isLegacySpareDetailPath(location.pathname);
  const navState = location.state as CatalogNavState | null;
  const preview = navState?.preview ?? null;
  const catalogBase = user ? catalogBaseForRole(user.role) : '/dealer/catalog';

  const { path: backPath, state: backState, label: backLabel } = resolveCatalogBack(
    catalogBase,
    navState,
    isSpare ? 'spare' : 'product',
    isPublic,
  );

  const showWarehouseStock = user?.role === 'staff' || user?.role === 'super_admin' || canViewWarehouseStock(user);
  const showStockQuantity = showWarehouseStock || canViewCatalogStock(user);
  const showCartActions = canUseCart(user?.role);
  const manageSpareLinks = user?.role === 'staff' || user?.role === 'super_admin';
  const canUploadImage = manageSpareLinks;
  const showRelatedLinks =
    !isPublic
    && (manageSpareLinks || user?.role === 'dealer' || user?.role === 'dealer_staff');
  const ordersPath = user ? `${homePathForRole(user.role)}/orders` : '/dealer/orders';
  const productsBasePath = catalogBase;
  const sparesBasePath = `${catalogBase}/spare`;
  const currentNavState = navState;

  if (!productId) {
    return null;
  }

  return (
    <div className={`page-content fade-in ${isPublic ? 'open-catalog-page' : 'product-detail-page-wrap'}`}>
      <ProductDetailView
        productId={productId}
        backPath={backPath}
        backLabel={backLabel}
        backState={backState}
        preview={preview && preview.id === productId ? preview : null}
        variant={isPublic ? 'public' : 'app'}
        showWarehouseStock={showWarehouseStock}
        showStockQuantity={showStockQuantity}
        showCartActions={showCartActions}
        showRelatedLinks={showRelatedLinks}
        manageSpareLinks={manageSpareLinks}
        canUploadImage={canUploadImage}
        productsBasePath={productsBasePath}
        sparesBasePath={sparesBasePath}
        ordersPath={ordersPath}
        currentNavState={currentNavState}
      />
    </div>
  );
};
