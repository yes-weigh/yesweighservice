import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartProvider';
import { CartFlyProvider } from './context/CartFlyProvider';
import { ConfirmProvider } from './context/ConfirmContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { SuperAdminDashboard } from './pages/admin/SuperAdminDashboard';
import { StaffDashboard } from './pages/staff/StaffDashboard';
import { AdminStaffList } from './pages/admin/AdminStaffList';
import { AdminDealersList } from './pages/admin/AdminDealersList';
import { AdminDealerStaffList } from './pages/admin/AdminDealerStaffList';
import { RoleDashboard, DealerMenuPages } from './pages/dealer/DealerPages';
import { DealerTeamPage } from './pages/dealer/DealerTeamPage';
import { ProfilePage } from './pages/shared/ProfilePage';
import { OpenCatalogPage } from './pages/public/OpenCatalogPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { SpareProductMapPage } from './pages/SpareProductMapPage';

const LegacyPathRedirect: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(from, to)} replace />;
};

const portalMenuRoutes = (
  <>
    <Route path="service" element={<Navigate to="../services" replace />} />
    <Route path="services" element={<DealerMenuPages.Services />} />
    <Route path="returns" element={<DealerMenuPages.Returns />} />
    <Route path="complaints" element={<DealerMenuPages.Complaints />} />
    <Route path="invoices" element={<DealerMenuPages.Invoices />} />
    <Route path="orders" element={<DealerMenuPages.Orders />} />
    <Route path="products" element={<DealerMenuPages.Products />} />
    <Route path="products/:productId" element={<ProductDetailPage />} />
    <Route path="spares" element={<DealerMenuPages.Spares />} />
    <Route path="spares/product/:productId" element={<SpareProductMapPage />} />
    <Route path="spares/:productId" element={<ProductDetailPage />} />
    <Route path="verification" element={<DealerMenuPages.Verification />} />
    <Route path="advertisements" element={<DealerMenuPages.Advertisements />} />
    <Route path="training" element={<DealerMenuPages.Training />} />
    <Route path="notifications" element={<DealerMenuPages.Notifications />} />
    <Route path="ai-assistant" element={<DealerMenuPages.AiAssistant />} />
  </>
);

const dealerRoutes = (
  <>
    <Route index element={<RoleDashboard />} />
    {portalMenuRoutes}
    <Route path="team" element={<DealerTeamPage />} />
    <Route path="profile" element={<ProfilePage />} />
  </>
);

const App: React.FC = () => (
  <AuthProvider>
    <CartProvider>
    <CartFlyProvider>
    <ConfirmProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/oc" element={<OpenCatalogPage />} />
          <Route path="/oc/:productId" element={<ProductDetailPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/admin/*" element={<Navigate to="/super-admin" replace />} />
          <Route path="/director-staff/*" element={<LegacyPathRedirect from="/director-staff" to="/dealer-staff" />} />
          <Route path="/director/*" element={<LegacyPathRedirect from="/director" to="/dealer" />} />
          <Route path="/super-admin/directors/*" element={<Navigate to="/super-admin/dealers" replace />} />
          <Route path="/super-admin/director-staff/*" element={<Navigate to="/super-admin/dealer-staff" replace />} />
          <Route path="/staff/directors/*" element={<Navigate to="/staff/dealers" replace />} />
          <Route path="/staff/director-staff/*" element={<Navigate to="/staff/dealers" replace />} />

          <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
            <Route path="/super-admin" element={<Layout />}>
              <Route index element={<SuperAdminDashboard />} />
              <Route path="products" element={<DealerMenuPages.Products />} />
              <Route path="products/:productId" element={<ProductDetailPage />} />
              <Route path="spares" element={<DealerMenuPages.Spares />} />
              <Route path="spares/product/:productId" element={<SpareProductMapPage />} />
              <Route path="spares/:productId" element={<ProductDetailPage />} />
              <Route path="staff" element={<AdminStaffList />} />
              <Route path="dealers/*" element={<AdminDealersList />} />
              <Route path="dealer-staff" element={<AdminDealerStaffList />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['staff']} />}>
            <Route path="/staff" element={<Layout />}>
              <Route index element={<StaffDashboard />} />
              <Route path="tasks" element={<DealerMenuPages.Tasks />} />
              {portalMenuRoutes}
              <Route path="leads" element={<DealerMenuPages.Leads />} />
              <Route path="dealers/*" element={<AdminDealersList />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['dealer']} />}>
            <Route path="/dealer" element={<Layout />}>
              {dealerRoutes}
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['dealer_staff']} />}>
            <Route path="/dealer-staff" element={<Layout />}>
              <Route index element={<RoleDashboard />} />
              <Route path="service" element={<DealerMenuPages.Services />} />
              <Route path="returns" element={<DealerMenuPages.Returns />} />
              <Route path="products" element={<DealerMenuPages.Products />} />
              <Route path="products/:productId" element={<ProductDetailPage />} />
              <Route path="spares" element={<DealerMenuPages.Spares />} />
              <Route path="spares/product/:productId" element={<SpareProductMapPage />} />
              <Route path="spares/:productId" element={<ProductDetailPage />} />
              <Route path="orders" element={<DealerMenuPages.Orders />} />
              <Route path="verification" element={<DealerMenuPages.Verification />} />
              <Route path="advertisements" element={<DealerMenuPages.Advertisements />} />
              <Route path="training" element={<DealerMenuPages.Training />} />
              <Route path="notifications" element={<DealerMenuPages.Notifications />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>
        </Routes>
      </Router>
    </ConfirmProvider>
    </CartFlyProvider>
    </CartProvider>
  </AuthProvider>
);

export default App;
