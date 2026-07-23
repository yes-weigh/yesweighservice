import React from 'react';
import { PagePlaceholder } from '../../components/PagePlaceholder';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';
import { DealerDashboard } from './DealerDashboard';
import { OrdersPage } from './OrdersPage';
import { DealerOrderHistoryPage } from './DealerOrderHistoryPage';
import { DealerOrderDetailPage } from './DealerOrderDetailPage';
import { StaffOrderDetailPage } from '../staff/StaffOrderDetailPage';
import { CatalogPage } from './CatalogPage';
import { InvoicesPage } from './InvoicesPage';
import { InvoiceDetailLayout } from './InvoiceDetailLayout';
import { InvoiceDocumentPage } from './InvoiceDocumentPage';
import { InvoicePdfViewerPage } from './InvoicePdfViewerPage';
import { InvoiceSectionPlaceholderPage } from './InvoiceSectionPlaceholderPage';
import { WarrantySupportPage } from './WarrantySupportPage';
import { SupportRequestDetailPage } from './SupportRequestDetailPage';
import { ComplaintGuidelinesPage } from './ComplaintGuidelinesPage';
import { LogisticsPage } from './LogisticsPage';

function DealerInvoicesRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <InvoicesPage />;
  }
  return (
    <PagePlaceholder
      title="Invoice"
      description="Create, send, and manage customer invoices and billing records."
    />
  );
}

function DealerInvoiceDetailRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <InvoiceDetailLayout />;
  }
  return (
    <PagePlaceholder
      title="Invoice"
      description="Create, send, and manage customer invoices and billing records."
    />
  );
}

function OrderDetailRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <DealerOrderDetailPage />;
  }
  return <StaffOrderDetailPage />;
}

function OrderHistoryRoute() {
  const { user } = useAuth();
  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <DealerOrderHistoryPage />;
  }
  return <OrdersPage />;
}

export const RoleDashboard: React.FC = () => {
  const { user } = useAuth();

  if (user?.role === 'dealer' || user?.role === 'dealer_staff') {
    return <DealerDashboard basePath={homePathForRole(user.role)} />;
  }

  return (
    <div className="page-content fade-in">
      <div className="panel glass">
        <h2>Welcome, {user?.displayName}</h2>
        <p className="text-muted mt-4">
          YesOne Platform — your workspace for verification, quality, and
          customer operations under the YesOne brand.
        </p>
      </div>
    </div>
  );
};

export const DealerMenuPages = {
  WarrantySupport: WarrantySupportPage,
  SupportRequestDetail: SupportRequestDetailPage,
  ComplaintGuidelines: ComplaintGuidelinesPage,
  Invoices: DealerInvoicesRoute,
  InvoiceDetail: DealerInvoiceDetailRoute,
  InvoiceDocument: InvoiceDocumentPage,
  InvoicePdfViewer: InvoicePdfViewerPage,
  InvoicePayments: () => <InvoiceSectionPlaceholderPage section="payments" />,
  InvoiceLogistic: () => <InvoiceSectionPlaceholderPage section="logistic" />,
  InvoiceQc: () => <InvoiceSectionPlaceholderPage section="qc" />,
  Products: CatalogPage,
  Spares: CatalogPage,
  Catalog: CatalogPage,
  Orders: OrdersPage,
  OrderHistory: OrderHistoryRoute,
  OrderDetail: OrderDetailRoute,
  Verification: () => (
    <PagePlaceholder
      title="Verification"
      description="Track verification workflows, stamping records, and compliance checkpoints."
    />
  ),
  Advertisements: () => (
    <PagePlaceholder
      title="Media Center"
      description="Promotional content, dealership media assets, and campaign materials."
    />
  ),
  Logistics: LogisticsPage,
  Loyalty: () => (
    <PagePlaceholder
      title="Loyalty"
      description="Dealer loyalty points, rewards, and tier benefits."
    />
  ),
  Training: () => (
    <PagePlaceholder
      title="Trainings"
      description="Assign and monitor staff training modules and certification progress."
    />
  ),
  Notifications: () => (
    <PagePlaceholder
      title="Notifications"
      description="Service alerts, renewal reminders, and operational updates."
    />
  ),
  AiAssistant: () => (
    <PagePlaceholder
      title="AI assistance"
      description="Your YesOne AI assistant for service guidance, documentation lookup, and operational support."
    />
  ),
  Leads: () => (
    <PagePlaceholder
      title="Leads"
      description="Track sales leads, inquiries, and follow-ups across dealers and regions."
    />
  ),
  Tasks: () => (
    <PagePlaceholder
      title="Tasks"
      description="Assign, track, and complete daily work items across your team."
    />
  ),
  SalesOrders: () => (
    <PagePlaceholder
      title="Sales order"
      description="Sales orders will appear here. This section is coming soon."
    />
  ),
};
