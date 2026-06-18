import React from 'react';
import { PagePlaceholder } from '../../components/PagePlaceholder';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';
import { DealerDashboard } from './DealerDashboard';
import { OrdersPage } from './OrdersPage';
import { ProductsPage } from './ProductsPage';
import { SparesPage } from './SparesPage';
import { InvoicesPage } from './InvoicesPage';
import { InvoiceDetailLayout } from './InvoiceDetailLayout';
import { InvoiceDocumentPage } from './InvoiceDocumentPage';
import { InvoicePdfViewerPage } from './InvoicePdfViewerPage';
import { InvoiceSectionPlaceholderPage } from './InvoiceSectionPlaceholderPage';
import { WarrantySupportPage } from './WarrantySupportPage';
import { SupportRequestDetailPage } from './SupportRequestDetailPage';

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
          YesWeigh Service portal — your workspace for verification, quality, and
          customer operations under the YesWeigh brand.
        </p>
      </div>
    </div>
  );
};

export const DealerMenuPages = {
  WarrantySupport: WarrantySupportPage,
  SupportRequestDetail: SupportRequestDetailPage,
  /** @deprecated Use WarrantySupport */
  Services: WarrantySupportPage,
  /** @deprecated Use WarrantySupport */
  ServiceRequestNew: WarrantySupportPage,
  /** @deprecated Redirects to WarrantySupport */
  Returns: WarrantySupportPage,
  /** @deprecated Redirects to WarrantySupport */
  Complaints: WarrantySupportPage,
  Invoices: DealerInvoicesRoute,
  InvoiceDetail: DealerInvoiceDetailRoute,
  InvoiceDocument: InvoiceDocumentPage,
  InvoicePdfViewer: InvoicePdfViewerPage,
  InvoicePayments: () => <InvoiceSectionPlaceholderPage section="payments" />,
  InvoiceLogistic: () => <InvoiceSectionPlaceholderPage section="logistic" />,
  InvoiceQc: () => <InvoiceSectionPlaceholderPage section="qc" />,
  Products: ProductsPage,
  Orders: OrdersPage,
  Spares: SparesPage,
  Verification: () => (
    <PagePlaceholder
      title="Verifications"
      description="Track verification workflows, stamping records, and compliance checkpoints."
    />
  ),
  Advertisements: () => (
    <PagePlaceholder
      title="Advertisement"
      description="Create and manage promotional content and dealership advertisements."
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
      description="Your YesWeigh AI assistant for service guidance, documentation lookup, and operational support."
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
};
