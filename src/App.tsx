import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartProvider';
import { CartFlyProvider } from './context/CartFlyProvider';
import { ConfirmProvider } from './context/ConfirmContext';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { DealerLogin } from './pages/DealerLogin';
import { SuperAdminDashboard } from './pages/admin/SuperAdminDashboard';
import { StaffDashboard } from './pages/staff/StaffDashboard';
import { HrLayout } from './pages/hr/HrLayout';
import { HrStaffListPage } from './pages/hr/HrStaffListPage';
import { HrStaffDetailPage } from './pages/hr/HrStaffDetailPage';
import { HrStaffFormPage } from './pages/hr/HrStaffFormPage';
import { HrMyProfilePage } from './pages/hr/HrMyProfilePage';
import { HrSuperAdminsPage } from './pages/hr/HrSuperAdminsPage';
import { HrRolesPage } from './pages/hr/HrRolesPage';
import { HrWorkReportPage } from './pages/hr/HrWorkReportPage';
import { HrHolidayCalendarPage } from './pages/hr/HrHolidayCalendarPage';
import { AdminDealersList } from './pages/admin/AdminDealersList';
import { AdminDealerAccountsList } from './pages/admin/AdminDealerAccountsList';
import { AdminDealerStaffList } from './pages/admin/AdminDealerStaffList';
import { AdminInvoicesPage } from './pages/admin/AdminInvoicesPage';
import { AdminInvoiceSyncPage } from './pages/admin/AdminInvoiceSyncPage';
import { RoleDashboard, DealerMenuPages } from './pages/dealer/DealerPages';
import { DealerTeamPage } from './pages/dealer/DealerTeamPage';
import { ProfilePage } from './pages/shared/ProfilePage';
import { OpenCatalogPage } from './pages/public/OpenCatalogPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { SpareProductMapPage } from './pages/SpareProductMapPage';
import {
  LegacyProductDetailRedirect,
  LegacySpareDetailRedirect,
  LegacySpareMapRedirect,
} from './components/catalog/LegacyCatalogRedirects';

const LegacyPathRedirect: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const { pathname } = useLocation();
  return <Navigate to={pathname.replace(from, to)} replace />;
};

const catalogRoutes = (
  <>
    <Route path="catalog" element={<DealerMenuPages.Catalog />} />
    <Route path="catalog/map/:productId" element={<SpareProductMapPage />} />
    <Route path="catalog/spare/:productId" element={<ProductDetailPage />} />
    <Route path="catalog/:productId" element={<ProductDetailPage />} />
    <Route path="products" element={<Navigate to="catalog" replace />} />
    <Route path="products/:productId" element={<LegacyProductDetailRedirect />} />
    <Route path="spares" element={<Navigate to="catalog?section=spares" replace />} />
    <Route path="spares/product/:productId" element={<LegacySpareMapRedirect />} />
    <Route path="spares/:productId" element={<LegacySpareDetailRedirect />} />
  </>
);

const superAdminOpsRoutes = (
  <>
    <Route path="orders" element={<DealerMenuPages.Orders />} />
    <Route path="warranty-support" element={<DealerMenuPages.WarrantySupport />} />
    <Route path="warranty-support/:requestId" element={<DealerMenuPages.SupportRequestDetail />} />
    <Route path="verification" element={<DealerMenuPages.Verification />} />
    <Route path="advertisements" element={<DealerMenuPages.Advertisements />} />
    <Route path="logistics" element={<DealerMenuPages.Logistics />} />
    <Route path="loyalty" element={<DealerMenuPages.Loyalty />} />
    <Route path="training" element={<DealerMenuPages.Training />} />
    <Route path="notifications" element={<DealerMenuPages.Notifications />} />
    <Route path="ai-assistant" element={<DealerMenuPages.AiAssistant />} />
  </>
);

const portalMenuRoutes = (
  <>
    <Route path="warranty-support" element={<DealerMenuPages.WarrantySupport />} />
    <Route path="warranty-support/:requestId" element={<DealerMenuPages.SupportRequestDetail />} />
    <Route path="invoices" element={<DealerMenuPages.Invoices />} />
    <Route path="invoices/:invoiceId" element={<DealerMenuPages.InvoiceDetail />}>
      <Route index element={<Navigate to="invoice" replace />} />
      <Route path="invoice">
        <Route index element={<DealerMenuPages.InvoiceDocument />} />
        <Route path="view" element={<DealerMenuPages.InvoicePdfViewer />} />
      </Route>
      <Route path="payments" element={<DealerMenuPages.InvoicePayments />} />
      <Route path="logistic" element={<DealerMenuPages.InvoiceLogistic />} />
      <Route path="qc" element={<DealerMenuPages.InvoiceQc />} />
    </Route>
    <Route path="orders" element={<DealerMenuPages.Orders />} />
    {catalogRoutes}
    <Route path="verification" element={<DealerMenuPages.Verification />} />
    <Route path="advertisements" element={<DealerMenuPages.Advertisements />} />
    <Route path="logistics" element={<DealerMenuPages.Logistics />} />
    <Route path="loyalty" element={<DealerMenuPages.Loyalty />} />
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
          <Route path="/dealer-login" element={<DealerLogin />} />
          <Route path="/oc" element={<OpenCatalogPage />} />
          <Route path="/oc/:productId" element={<ProductDetailPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/admin/*" element={<Navigate to="/super-admin" replace />} />
          <Route path="/director-staff/*" element={<LegacyPathRedirect from="/director-staff" to="/dealer-staff" />} />
          <Route path="/director/*" element={<LegacyPathRedirect from="/director" to="/dealer" />} />
          <Route path="/super-admin/directors/*" element={<Navigate to="/super-admin/dealers" replace />} />
          <Route path="/super-admin/director-staff/*" element={<Navigate to="/super-admin/dealers" replace />} />
          <Route path="/staff/directors/*" element={<Navigate to="/staff/dealers" replace />} />
          <Route path="/staff/director-staff/*" element={<Navigate to="/staff/dealers" replace />} />

          <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
            <Route path="/super-admin" element={<Layout />}>
              <Route index element={<SuperAdminDashboard />} />
              {catalogRoutes}
              <Route path="staff" element={<Navigate to="/super-admin/hr/staff" replace />} />
              <Route path="super-admins" element={<Navigate to="/super-admin/hr/super-admins" replace />} />
              <Route path="dealers/*" element={<AdminDealersList />} />
              <Route path="hr/dealers/*" element={<LegacyPathRedirect from="/super-admin/hr/dealers" to="/super-admin/dealers" />} />
              <Route path="dealer-staff" element={<AdminDealerStaffList />} />
              <Route path="hr" element={<HrLayout basePath="/super-admin" />}>
                <Route path="staff" element={<HrStaffListPage basePath="/super-admin" />} />
                <Route path="staff/new" element={<HrStaffFormPage basePath="/super-admin" />} />
                <Route path="staff/:uid" element={<HrStaffDetailPage basePath="/super-admin" />} />
                <Route path="staff/:uid/edit" element={<HrStaffFormPage basePath="/super-admin" />} />
                <Route path="report" element={<HrWorkReportPage basePath="/super-admin" />} />
                <Route path="holidays" element={<HrHolidayCalendarPage />} />
                <Route path="super-admins" element={<HrSuperAdminsPage basePath="/super-admin" />} />
                <Route path="roles" element={<HrRolesPage />} />
                <Route path="me" element={<HrMyProfilePage />} />
              </Route>
              <Route path="dealer-accounts" element={<AdminDealerAccountsList />} />
              <Route path="invoices" element={<AdminInvoicesPage />} />
              <Route path="invoices/sync" element={<AdminInvoiceSyncPage />} />
              {superAdminOpsRoutes}
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
              <Route path="hr" element={<HrLayout basePath="/staff" />}>
                <Route path="staff" element={<HrStaffListPage basePath="/staff" />} />
                <Route path="staff/new" element={<HrStaffFormPage basePath="/staff" />} />
                <Route path="staff/:uid" element={<HrStaffDetailPage basePath="/staff" />} />
                <Route path="staff/:uid/edit" element={<HrStaffFormPage basePath="/staff" />} />
                <Route path="report" element={<HrWorkReportPage basePath="/staff" />} />
                <Route path="holidays" element={<HrHolidayCalendarPage />} />
                <Route path="me" element={<HrMyProfilePage />} />
              </Route>
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
              <Route path="warranty-support" element={<DealerMenuPages.WarrantySupport />} />
              <Route path="warranty-support/:requestId" element={<DealerMenuPages.SupportRequestDetail />} />
              <Route path="invoices" element={<DealerMenuPages.Invoices />} />
              <Route path="invoices/:invoiceId" element={<DealerMenuPages.InvoiceDetail />}>
                <Route index element={<Navigate to="invoice" replace />} />
                <Route path="invoice">
                  <Route index element={<DealerMenuPages.InvoiceDocument />} />
                  <Route path="view" element={<DealerMenuPages.InvoicePdfViewer />} />
                </Route>
                <Route path="payments" element={<DealerMenuPages.InvoicePayments />} />
                <Route path="logistic" element={<DealerMenuPages.InvoiceLogistic />} />
                <Route path="qc" element={<DealerMenuPages.InvoiceQc />} />
              </Route>
              {catalogRoutes}
              <Route path="orders" element={<DealerMenuPages.Orders />} />
              <Route path="verification" element={<DealerMenuPages.Verification />} />
              <Route path="advertisements" element={<DealerMenuPages.Advertisements />} />
              <Route path="logistics" element={<DealerMenuPages.Logistics />} />
              <Route path="loyalty" element={<DealerMenuPages.Loyalty />} />
              <Route path="ai-assistant" element={<DealerMenuPages.AiAssistant />} />
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
