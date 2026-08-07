import { Navigate, useLocation, useParams } from 'react-router-dom';

/** Redirect legacy /role/catalog… → /role/products… (path + query). */
export function LegacyCatalogRootRedirect() {
  const { pathname, search } = useLocation();
  const next = pathname.replace(/\/catalog(\/|$)/, '/products$1');
  return <Navigate to={`${next}${search}`} replace />;
}

/** Redirect /role/catalog/:id → /role/products/:id */
export function LegacyCatalogProductDetailRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const productsPath = pathname.replace(/\/catalog\/[^/]+$/, `/products/${productId ?? ''}`);
  return <Navigate to={productsPath} replace />;
}

/** Redirect /role/catalog/spare/:id → /role/products/spare/:id */
export function LegacyCatalogSpareDetailRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const productsPath = pathname.replace(
    /\/catalog\/spare\/[^/]+$/,
    `/products/spare/${productId ?? ''}`,
  );
  return <Navigate to={productsPath} replace />;
}

/** Redirect /role/catalog/map/:id → /role/products/map/:id */
export function LegacyCatalogMapRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const productsPath = pathname.replace(
    /\/catalog\/map\/[^/]+$/,
    `/products/map/${productId ?? ''}`,
  );
  return <Navigate to={productsPath} replace />;
}

/** Redirect /role/spares/:id → /role/products/spare/:id */
export function LegacySpareDetailRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const productsPath = pathname.replace(/\/spares\/[^/]+$/, `/products/spare/${productId ?? ''}`);
  return <Navigate to={productsPath} replace />;
}

/** Redirect /role/spares/product/:id → /role/products/map/:id */
export function LegacySpareMapRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const productsPath = pathname.replace(
    /\/spares\/product\/[^/]+$/,
    `/products/map/${productId ?? ''}`,
  );
  return <Navigate to={productsPath} replace />;
}
