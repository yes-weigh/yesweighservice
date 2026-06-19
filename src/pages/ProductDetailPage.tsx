import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { homePathForRole, canUseCart } from '../types';
import { canViewCatalogStock, canViewWarehouseStock } from '../lib/dealerAccess';
import type { CatalogProduct } from '../types/catalog';
import { ProductDetailView } from '../components/catalog/ProductDetailView';

type SpareDetailNavState = {
  preview?: CatalogProduct;
  returnView?: string;
  parentProductId?: string;
  returnCategoryId?: string;
  parentProductPreview?: CatalogProduct;
};

export const ProductDetailPage: React.FC = () => {
  const { user } = useAuth();
  const { productId } = useParams<{ productId: string }>();
  const location = useLocation();
  const isPublic = location.pathname.startsWith('/oc/');
  const isSpares = /\/spares\/[^/]+$/.test(location.pathname)
    && !/\/spares\/product\//.test(location.pathname);
  const navState = location.state as SpareDetailNavState | null;
  const preview = navState?.preview ?? null;
  const returnView = navState?.returnView;
  const parentProductId = navState?.parentProductId;
  const base = user ? homePathForRole(user.role) : '/dealer';
  const backPath = isPublic
    ? '/oc'
    : isSpares && parentProductId
      ? `${base}/spares/product/${parentProductId}`
      : isSpares
        ? `${location.pathname.replace(/\/[^/]+$/, '')}?view=${returnView === 'unlinked' ? 'unlinked' : 'spares'}`
        : location.pathname.replace(/\/[^/]+$/, '');
  const backState = isSpares && parentProductId
    ? {
        preview: navState?.parentProductPreview ?? null,
        returnCategoryId: navState?.returnCategoryId ?? navState?.parentProductPreview?.categoryId ?? '',
      }
    : null;
  const showWarehouseStock = user?.role === 'staff' || user?.role === 'super_admin' || canViewWarehouseStock(user);
  const showStockQuantity = showWarehouseStock || canViewCatalogStock(user);
  const showCartActions = canUseCart(user?.role);
  const manageSpareLinks = user?.role === 'staff' || user?.role === 'super_admin';
  const canUploadImage = manageSpareLinks;
  const showRelatedLinks =
    !isPublic
    && (manageSpareLinks || user?.role === 'dealer' || user?.role === 'dealer_staff');
  const ordersPath = user ? `${homePathForRole(user.role)}/orders` : '/dealer/orders';
  const productsBasePath = `${base}/products`;
  const sparesBasePath = `${base}/spares`;
  const backLabel = isPublic
    ? 'Back to catalog'
    : isSpares && parentProductId
      ? 'Back to product'
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
      />
    </div>
  );
};
