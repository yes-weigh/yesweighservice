import React, { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  homePathForRole,
  canWriteCatalogMediaForUser,
  canEditCatalogProductImageForUser,
  isMediaRole,
} from '../types';
import { canViewCatalogStock, canViewWarehouseStock } from '../lib/dealerAccess';
import { canSuperAdminWrite } from '../lib/staffAccess';
import { canUseOrderCart, isCatalogProductCartable, orderCartPathForUser } from '../lib/salesOrderSegments';
import { canNavigateBackInApp } from '../lib/navigation';
import {
  catalogBaseForRole,
  isCatalogSpareDetailPath,
  isLegacySpareDetailPath,
} from '../lib/catalogRoutes';
import { resolveCatalogBack, type CatalogNavState } from '../lib/catalogNav';
import { ProductDetailView } from '../components/catalog/ProductDetailView';
import { MEDIA_PRODUCT_DETAIL_TABS } from '../components/catalog/ProductDetailTabs';

export const ProductDetailPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const isPublic = location.pathname.startsWith('/oc/');
  const isSpare = isCatalogSpareDetailPath(location.pathname) || isLegacySpareDetailPath(location.pathname);
  const navState = location.state as CatalogNavState | null;
  const preview = navState?.preview ?? null;
  const catalogBase = user ? catalogBaseForRole(user.role) : '/dealer/catalog';
  const mediaOnly = isMediaRole(user?.role);

  const { path: backPath, state: backState, label: backLabel } = resolveCatalogBack(
    catalogBase,
    navState,
    isSpare ? 'spare' : 'product',
    isPublic,
  );

  const showWarehouseStock = !mediaOnly
    && (user?.role === 'staff' || user?.role === 'super_admin' || canViewWarehouseStock(user));
  const showStockQuantity = !mediaOnly && (showWarehouseStock || canViewCatalogStock(user));
  const showCartActions = !mediaOnly && canUseOrderCart(user);
  const isCartable = useCallback(
    (product: { categoryId?: string | null; categoryName?: string | null }) => (
      isCatalogProductCartable(user, product)
    ),
    [user],
  );
  const manageSpareLinks = !mediaOnly && (
    user?.role === 'staff' || canSuperAdminWrite(user)
  );
  const canEditProductDetails = manageSpareLinks;
  const canEditProductImages = canEditCatalogProductImageForUser(user);
  const canSetInactive = canSuperAdminWrite(user);
  const showAuditedStock = !mediaOnly && (user?.role === 'staff' || user?.role === 'super_admin');
  const showRelatedLinks =
    !isPublic
    && !mediaOnly
    && (manageSpareLinks || user?.role === 'dealer' || user?.role === 'dealer_staff');
  const home = user ? homePathForRole(user.role) : '/dealer';
  const ordersPath = orderCartPathForUser(user, home);
  const productsBasePath = catalogBase;
  const sparesBasePath = `${catalogBase}/spare`;
  const currentNavState = navState;

  const handleInactiveSuccess = useCallback(() => {
    if (canNavigateBackInApp()) {
      navigate(-1);
      return;
    }
    if (backState) navigate(backPath, { state: backState });
    else navigate(backPath);
  }, [backPath, backState, navigate]);

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
        isSpareDetail={isSpare}
        showWarehouseStock={showWarehouseStock}
        showStockQuantity={showStockQuantity}
        showAuditedStock={showAuditedStock}
        showCartActions={showCartActions}
        isCartable={isCartable}
        showRelatedLinks={showRelatedLinks}
        manageSpareLinks={manageSpareLinks}
        canEditProductDetails={canEditProductDetails}
        canEditProductImages={canEditProductImages}
        canSetInactive={canSetInactive}
        onInactiveSuccess={handleInactiveSuccess}
        productsBasePath={productsBasePath}
        sparesBasePath={sparesBasePath}
        ordersPath={ordersPath}
        currentNavState={currentNavState}
        visibleTabs={mediaOnly ? MEDIA_PRODUCT_DETAIL_TABS : undefined}
        canWriteMedia={canWriteCatalogMediaForUser(user)}
        mediaActorUid={user?.uid ?? ''}
        mediaActorName={user?.displayName}
      />
    </div>
  );
};
