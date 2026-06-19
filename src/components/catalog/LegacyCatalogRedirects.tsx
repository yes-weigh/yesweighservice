import { Navigate, useLocation, useParams } from 'react-router-dom';

/** Redirect /role/products/:id → /role/catalog/:id */
export function LegacyProductDetailRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const catalogPath = pathname.replace(/\/products\/[^/]+$/, `/catalog/${productId ?? ''}`);
  return <Navigate to={catalogPath} replace />;
}

/** Redirect /role/spares/:id → /role/catalog/spare/:id */
export function LegacySpareDetailRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const catalogPath = pathname.replace(/\/spares\/[^/]+$/, `/catalog/spare/${productId ?? ''}`);
  return <Navigate to={catalogPath} replace />;
}

/** Redirect /role/spares/product/:id → /role/catalog/map/:id */
export function LegacySpareMapRedirect() {
  const { productId } = useParams<{ productId: string }>();
  const { pathname } = useLocation();
  const catalogPath = pathname.replace(/\/spares\/product\/[^/]+$/, `/catalog/map/${productId ?? ''}`);
  return <Navigate to={catalogPath} replace />;
}
